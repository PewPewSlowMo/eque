# Per-Doctor Slot Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to configure slot duration (slotMinutes) per doctor per day, persist it in the schedule, warn when existing bookings exist, and remap bookings to new slots on confirmation.

**Architecture:** `slotMinutes` is stored on `DoctorDaySchedule` (per-day, most flexible). The ScheduleTab shows a per-doctor selector in the sticky name column that mass-updates all scheduled days for that doctor in the current month. The import/export template gains a "Шаг (мин)" column (column 3) with backwards-compatible detection. RegistrarView's `slotsFromSchedule` reads `slotMinutes` from the schedule object instead of the hardcoded 15.

**Tech Stack:** NestJS + tRPC + Prisma (backend), React + Vite + Tailwind (frontend), ExcelJS (import/export)

---

## File Map

| File | Change |
|------|--------|
| `apps/backend/prisma/schema.prisma` | Add `slotMinutes Int @default(15)` to `DoctorDaySchedule` |
| `apps/backend/src/modules/schedules/schedules.router.ts` | Add `slotMinutes` to `saveDay` input/data; add `getBookedDatesInRange` query; add `setSlotMinutesForRange` mutation |
| `apps/backend/src/modules/schedules/schedules-import.controller.ts` | Export: add "Шаг (мин)" col 3, shift days to col 4+. Import: detect & parse new column format |
| `apps/frontend/src/components/admin/ScheduleTab.tsx` | Add `slotMinutes` select in doctor sticky cell + `slotMinutes` field in `CellEditor` + confirmation dialog |
| `apps/frontend/src/components/RegistrarView.tsx` | Use `sched.slotMinutes ?? 15` in `slotsFromSchedule`; update type signature |

---

## Task 1: DB Migration — add `slotMinutes` to `DoctorDaySchedule`

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add the field**

In `apps/backend/prisma/schema.prisma`, inside the `DoctorDaySchedule` model, add the new field after `endTime`:

```prisma
model DoctorDaySchedule {
  id        String             @id @default(cuid())
  doctorId  String
  doctor    User               @relation(fields: [doctorId], references: [id])
  date      DateTime           @db.Date
  startTime String
  endTime   String
  slotMinutes Int              @default(15)   // ← new
  breaks    DayScheduleBreak[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([doctorId, date])
  @@index([date])
  @@map("doctor_day_schedules")
}
```

- [ ] **Step 2: Run migration**

```bash
cd apps/backend
npx prisma migrate dev --name add_slot_minutes_to_schedule
```

Expected output: `✔  Your database is now in sync with your schema.`

- [ ] **Step 3: Verify generated migration SQL**

Check `apps/backend/prisma/migrations/*/migration.sql` contains:
```sql
ALTER TABLE "doctor_day_schedules" ADD COLUMN "slotMinutes" INTEGER NOT NULL DEFAULT 15;
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(db): добавлено поле slotMinutes в DoctorDaySchedule"
```

---

## Task 2: Backend — update `schedules.router.ts`

**Files:**
- Modify: `apps/backend/src/modules/schedules/schedules.router.ts`

Three changes: (A) `slotMinutes` in `saveDay`, (B) new `getBookedDatesInRange` query, (C) new `setSlotMinutesForRange` mutation.

- [ ] **Step 1: Update `saveDay` — input schema**

In `saveDay`, change the `.input(z.object({...}))` to include `slotMinutes`:

```typescript
saveDay: trpc.protectedProcedure
  .input(z.object({
    doctorId:    z.string(),
    date:        z.string(),
    startTime:   z.string().regex(/^\d{2}:\d{2}$/),
    endTime:     z.string().regex(/^\d{2}:\d{2}$/),
    slotMinutes: z.number().int().min(5).max(60).default(15),   // ← new
    breaks:      z.array(breakSchema).default([]),
  }))
```

- [ ] **Step 2: Update `saveDay` — persist `slotMinutes`**

In the `update` and `create` branches inside the transaction, add `slotMinutes`:

```typescript
// update branch
await (tx as any).doctorDaySchedule.update({
  where: { id: existing.id },
  data: {
    startTime:   input.startTime,
    endTime:     input.endTime,
    slotMinutes: input.slotMinutes,   // ← new
  },
});

// create branch
const created = await (tx as any).doctorDaySchedule.create({
  data: {
    doctorId:    input.doctorId,
    date,
    startTime:   input.startTime,
    endTime:     input.endTime,
    slotMinutes: input.slotMinutes,   // ← new
  },
});
```

- [ ] **Step 3: Add helper — `generateSlots`**

Add this pure helper function at the top of the file (after the `breakSchema` definition), replicating frontend logic for use in the remap mutation:

```typescript
function generateSlots(
  startTime: string,
  endTime: string,
  slotMinutes: number,
  breaks: { startTime: string; endTime: string }[],
): string[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;
  const breakRanges = breaks.map(b => {
    const [bs, bsm] = b.startTime.split(':').map(Number);
    const [be, bem] = b.endTime.split(':').map(Number);
    return [bs * 60 + bsm, be * 60 + bem] as [number, number];
  });
  const slots: string[] = [];
  for (let m = startMins; m < endMins; m += slotMinutes) {
    if (!breakRanges.some(([s, e]) => m >= s && m < e)) {
      slots.push(
        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
      );
    }
  }
  return slots;
}
```

- [ ] **Step 4: Add `getBookedDatesInRange` query**

Add after the `deleteDay` procedure (before the closing `});`):

```typescript
// Returns dates (YYYY-MM-DD) that have at least one scheduled booking
getBookedDatesInRange: trpc.protectedProcedure
  .input(z.object({
    doctorId: z.string(),
    dateFrom: z.string(),   // YYYY-MM-DD
    dateTo:   z.string(),   // YYYY-MM-DD
  }))
  .query(async ({ input }) => {
    const start = new Date(input.dateFrom);
    start.setHours(0, 0, 0, 0);
    const end = new Date(input.dateTo);
    end.setHours(23, 59, 59, 999);

    const entries = await prisma.queueEntry.findMany({
      where: {
        doctorId: input.doctorId,
        scheduledAt: { gte: start, lte: end },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { scheduledAt: true },
    });

    const dates = new Set<string>();
    for (const e of entries) {
      if (e.scheduledAt) dates.add(e.scheduledAt.toISOString().slice(0, 10));
    }
    return [...dates].sort();
  }),
```

- [ ] **Step 5: Add `setSlotMinutesForRange` mutation**

Add after `getBookedDatesInRange`:

```typescript
// Update slotMinutes for all scheduled days in range.
// If reschedule=true, round existing bookings to nearest new slot.
setSlotMinutesForRange: trpc.protectedProcedure
  .input(z.object({
    doctorId:    z.string(),
    dateFrom:    z.string(),   // YYYY-MM-DD
    dateTo:      z.string(),   // YYYY-MM-DD
    slotMinutes: z.number().int().min(5).max(60),
    reschedule:  z.boolean().default(false),
  }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user?.role !== 'ADMIN') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Только администратор' });
    }

    const start = new Date(input.dateFrom);
    start.setHours(0, 0, 0, 0);
    const end = new Date(input.dateTo);
    end.setHours(23, 59, 59, 999);

    const schedules = await (prisma as any).doctorDaySchedule.findMany({
      where: { doctorId: input.doctorId, date: { gte: start, lte: end } },
      include: { breaks: true },
    });

    await prisma.$transaction(async (tx: any) => {
      for (const sched of schedules) {
        await tx.doctorDaySchedule.update({
          where: { id: sched.id },
          data: { slotMinutes: input.slotMinutes },
        });

        if (input.reschedule) {
          const newSlots = generateSlots(
            sched.startTime, sched.endTime, input.slotMinutes,
            sched.breaks,
          );
          if (!newSlots.length) continue;

          const dayStart = new Date(sched.date);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(sched.date);
          dayEnd.setHours(23, 59, 59, 999);

          const bookings = await tx.queueEntry.findMany({
            where: {
              doctorId: input.doctorId,
              scheduledAt: { gte: dayStart, lte: dayEnd },
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            },
            select: { id: true, scheduledAt: true },
          });

          for (const booking of bookings) {
            if (!booking.scheduledAt) continue;
            const bh = booking.scheduledAt.getHours();
            const bm = booking.scheduledAt.getMinutes();
            const targetMins = bh * 60 + bm;

            // Find nearest slot
            let bestSlot = newSlots[0];
            let bestDist = Infinity;
            for (const s of newSlots) {
              const [sh, sm] = s.split(':').map(Number);
              const dist = Math.abs(sh * 60 + sm - targetMins);
              if (dist < bestDist) { bestDist = dist; bestSlot = s; }
            }

            const [rh, rm] = bestSlot.split(':').map(Number);
            const remapped = new Date(booking.scheduledAt);
            remapped.setHours(rh, rm, 0, 0);
            await tx.queueEntry.update({
              where: { id: booking.id },
              data: { scheduledAt: remapped },
            });
          }
        }
      }
    });

    return { updated: schedules.length };
  }),
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/schedules/schedules.router.ts
git commit -m "feat(schedules): slotMinutes в saveDay, getBookedDatesInRange, setSlotMinutesForRange"
```

---

## Task 3: Backend — update import/export for `slotMinutes` column

**Files:**
- Modify: `apps/backend/src/modules/schedules/schedules-import.controller.ts`

**Format change:**
- Old: `[hidden doctorId] | [Врач] | [01] | [02] | ...`
- New: `[hidden doctorId] | [Врач] | [Шаг (мин)] | [01] | [02] | ...`

Backwards-compatible: if col-3 header is NOT `Шаг (мин)`, treat file as old format (days start at col 3).

- [ ] **Step 1: Update `ParsedRow` interface to include `slotMinutes`**

```typescript
export interface ParsedRow {
  doctorId:    string;
  doctorName:  string;
  date:        string;
  startTime:   string;
  endTime:     string;
  slotMinutes: number;        // ← new
  breaks:      { startTime: string; endTime: string }[];
  hasConflict: boolean;
  errors:      string[];
}
```

- [ ] **Step 2: Update `exportSchedule` — add "Шаг (мин)" column**

Find the column-widths block and header row in `exportSchedule`, change:

```typescript
// Column widths — add col 3 for slotMinutes, shift days to col 4+
sheet.getColumn(1).width  = 0.1;
sheet.getColumn(1).hidden = true;
sheet.getColumn(2).width  = 30;
sheet.getColumn(3).width  = 10;                         // ← new: slotMinutes
for (let d = 1; d <= days; d++) sheet.getColumn(d + 3).width = 15;   // was d+2

// Header row — insert 'Шаг (мин)' at position 3
const headerRow = sheet.addRow([
  '',
  'Врач',
  'Шаг (мин)',                                          // ← new
  ...Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0')),
]);
```

Also update the hint row to merge one more column:

```typescript
const hintRow = sheet.addRow([
  '', 'Формат: 08:00-14:30 или 08:00-14:30/11:00-12:00 (перерыв)', '', '',
]);
hintRow.font = { italic: true, color: { argb: 'FF808080' } };
sheet.mergeCells(`B${hintRow.number}:${String.fromCharCode(67 + days)}${hintRow.number}`);
// Note: was 66 (=B), now 67 (=C) as start — merge from B to last day col
```

In the doctor rows loop, insert `slotMinutes` as the third cell. Compute it from `schedMap` (use 15 as default if no schedules):

```typescript
for (const doc of doctors) {
  const fullName = [doc.lastName, doc.firstName, doc.middleName].filter(Boolean).join(' ');

  // Derive slotMinutes: use the value from the first scheduled day, default 15
  const docSchedules = [...(schedMap.get(doc.id)?.values() ?? [])];
  const slotMins = docSchedules.length > 0 ? (docSchedules[0].slotMinutes ?? 15) : 15;

  const rowData: any[] = [doc.id, fullName, slotMins];      // ← slotMins inserted

  for (let d = 1; d <= days; d++) {
    const dateStr = isoDate(year, month, d);
    const sched   = schedMap.get(doc.id)?.get(dateStr);
    if (sched) {
      let cell = `${sched.startTime}-${sched.endTime}`;
      for (const b of sched.breaks) cell += `/${b.startTime}-${b.endTime}`;
      rowData.push(cell);
    } else {
      rowData.push('');
    }
  }

  const r = sheet.addRow(rowData);
  r.eachCell((cell, colNum) => {
    if (colNum > 3 && cell.value) {                          // was > 2, now > 3
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
    }
  });
}
```

- [ ] **Step 3: Update `parseWorkbook` — detect format + parse `slotMinutes`**

Replace the existing `parseWorkbook` method body with this version that auto-detects old vs new format:

```typescript
private async parseWorkbook(buffer: Buffer): Promise<{ year: number; month: number; rows: ParsedRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const meta = workbook.getWorksheet('_Meta');
  if (!meta) throw new BadRequestException('Лист "_Meta" не найден — скачайте шаблон заново');
  const year  = meta.getCell('A1').value as number;
  const month = meta.getCell('A2').value as number;
  if (!year || !month) throw new BadRequestException('Неверные метаданные в файле');

  const sheet = workbook.getWorksheet('График');
  if (!sheet) throw new BadRequestException('Лист "График" не найден');

  // Detect format: new files have "Шаг (мин)" as column 3 header
  const col3Header = String(sheet.getRow(1).getCell(3).value ?? '').trim();
  const hasSlotCol = col3Header === 'Шаг (мин)';
  const dayOffset  = hasSlotCol ? 3 : 2;   // days start at col (dayOffset+1)

  const days = daysInMonth(year, month);
  const rows: ParsedRow[] = [];

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;  // skip header + hint
    const doctorId   = String(row.getCell(1).value ?? '').trim();
    const doctorName = String(row.getCell(2).value ?? '').trim();
    if (!doctorId) return;

    // Parse slotMinutes (only in new format)
    let slotMinutes = 15;
    if (hasSlotCol) {
      const raw = Number(row.getCell(3).value);
      if (!isNaN(raw) && raw >= 5 && raw <= 60) slotMinutes = raw;
    }

    for (let d = 1; d <= days; d++) {
      const cellVal = String(row.getCell(d + dayOffset).value ?? '').trim();
      if (!cellVal) continue;

      const dateStr = isoDate(year, month, d);
      const parsed  = parseCell(cellVal);
      if (!parsed) {
        rows.push({
          doctorId, doctorName, date: dateStr,
          startTime: '', endTime: '', slotMinutes, breaks: [],
          hasConflict: false,
          errors: [`День ${String(d).padStart(2,'0')}: неверный формат "${cellVal}"`],
        });
        continue;
      }
      rows.push({
        doctorId, doctorName, date: dateStr,
        startTime: parsed.startTime, endTime: parsed.endTime,
        slotMinutes,
        breaks: parsed.breaks,
        hasConflict: false, errors: [],
      });
    }
  });

  return { year, month, rows };
}
```

- [ ] **Step 4: Update `commitImport` — persist `slotMinutes`**

In `commitImport`, inside the transaction, add `slotMinutes` to the update and create calls:

```typescript
if (existing) {
  await tx.dayScheduleBreak.deleteMany({ where: { scheduleId: existing.id } });
  await tx.doctorDaySchedule.update({
    where: { id: existing.id },
    data: { startTime: row.startTime, endTime: row.endTime, slotMinutes: row.slotMinutes },  // ← slotMinutes
  });
  scheduleId = existing.id;
} else {
  const created = await tx.doctorDaySchedule.create({
    data: {
      doctorId: row.doctorId, date,
      startTime: row.startTime, endTime: row.endTime,
      slotMinutes: row.slotMinutes,                                                           // ← slotMinutes
    },
  });
  scheduleId = created.id;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/schedules/schedules-import.controller.ts
git commit -m "feat(import): добавлен столбец 'Шаг (мин)' в шаблон импорта расписания"
```

---

## Task 4: Frontend — `RegistrarView.tsx` — use `slotMinutes` from schedule

**Files:**
- Modify: `apps/frontend/src/components/RegistrarView.tsx:9-26`

- [ ] **Step 1: Update `slotsFromSchedule` type + logic**

Replace the existing function signature and step constant:

```typescript
function slotsFromSchedule(sched: {
  startTime: string;
  endTime: string;
  slotMinutes?: number;   // ← new
  breaks: Array<{ startTime: string; endTime: string }>;
}): string[] {
  const [sh, sm] = sched.startTime.split(':').map(Number);
  const [eh, em] = sched.endTime.split(':').map(Number);
  const startMins  = sh * 60 + sm;
  const endMins    = eh * 60 + em;
  const step       = sched.slotMinutes ?? 15;              // ← use configured step
  const breakRanges = sched.breaks.map(b => {
    const [bs, bsm] = b.startTime.split(':').map(Number);
    const [be, bem] = b.endTime.split(':').map(Number);
    return [bs * 60 + bsm, be * 60 + bem] as [number, number];
  });
  const slots: string[] = [];
  for (let m = startMins; m < endMins; m += step) {        // ← was m += 15
    if (!breakRanges.some(([s, e]) => m >= s && m < e)) {
      slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
  }
  return slots;
}
```

No other changes needed in this file — `slotMinutes` is returned by default from Prisma `findMany` and is already in the schedule objects passed to `slotsFromSchedule`.

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/RegistrarView.tsx
git commit -m "feat(registrar): slotsFromSchedule использует slotMinutes из расписания"
```

---

## Task 5: Frontend — `ScheduleTab.tsx` — `slotMinutes` UI

**Files:**
- Modify: `apps/frontend/src/components/admin/ScheduleTab.tsx`

Three UI changes:
1. `CellEditor` — add `slotMinutes` field
2. Doctor sticky cell — add compact `slotMinutes` select to the right of the name
3. Confirmation dialog for changing `slotMinutes` when bookings exist

- [ ] **Step 1: Update `CellEditor` — add `slotMinutes` state + input**

Change the `CellEditor` props interface and internal state:

```typescript
function CellEditor({
  doctorName, date, existing, anchorEl,
  onSave, onDelete, onClose,
}: {
  doctorName: string;
  date: string;
  existing: {
    startTime: string;
    endTime: string;
    slotMinutes: number;   // ← new
    breaks: BreakItem[];
  } | null;
  anchorEl: HTMLElement;
  onSave: (start: string, end: string, slotMinutes: number, breaks: BreakItem[]) => void;  // ← updated
  onDelete: () => void;
  onClose: () => void;
}) {
  const [startTime,   setStartTime]   = useState(existing?.startTime   ?? '08:00');
  const [endTime,     setEndTime]     = useState(existing?.endTime     ?? '14:00');
  const [slotMinutes, setSlotMinutes] = useState(existing?.slotMinutes ?? 15);    // ← new
  const [breaks,      setBreaks]      = useState<BreakItem[]>(existing?.breaks ?? []);
```

Add `slotMinutes` select inside the `<div className="p-3 space-y-2">` block, after the start/end time row:

```tsx
{/* Slot duration */}
<div className="flex items-center gap-2">
  <span className="text-[9px] text-muted-foreground w-[16px]">Шаг</span>
  <select
    value={slotMinutes}
    onChange={e => setSlotMinutes(Number(e.target.value))}
    className="flex-1 text-[10px] px-2 py-1 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white"
  >
    {[5, 10, 15, 20, 30].map(m => (
      <option key={m} value={m}>{m} мин</option>
    ))}
  </select>
</div>
```

Update the Save button call:

```tsx
<button onClick={() => onSave(startTime, endTime, slotMinutes, breaks)}
```

- [ ] **Step 2: Update `ScheduleTab` — `editing` state + `onSave` handler**

The `existing` type in the `editing` state needs `slotMinutes`:

```typescript
const [editing, setEditing] = useState<{
  doctorId: string;
  doctorName: string;
  date: string;
  existing: { startTime: string; endTime: string; slotMinutes: number; breaks: BreakItem[] } | null;
  anchorEl: HTMLElement;
} | null>(null);
```

In the `onSave` callback passed to `CellEditor`, add `slotMinutes`:

```tsx
onSave={(start, end, slotMinutes, brs) => saveDay.mutate({
  doctorId:    editing.doctorId,
  date:        editing.date,
  startTime:   start,
  endTime:     end,
  slotMinutes,              // ← new
  breaks:      brs,
})}
```

In the `onClick` handler that opens the editor, pass `slotMinutes` from `sched`:

```typescript
existing: sched ? {
  startTime:   sched.startTime,
  endTime:     sched.endTime,
  slotMinutes: sched.slotMinutes ?? 15,    // ← new
  breaks:      sched.breaks.map((b: any) => ({
    startTime: b.startTime, endTime: b.endTime, label: b.label ?? '',
  })),
} : null,
```

- [ ] **Step 3: Add confirmation dialog state + `SlotMinutesConfirmDialog` component**

Add near the top of the file (after `BreakItem` type):

```typescript
const SLOT_OPTIONS = [5, 10, 15, 20, 30] as const;
```

Add `SlotMinutesConfirmDialog` component:

```tsx
function SlotMinutesConfirmDialog({
  doctorName, bookedDates, slotMinutes,
  onConfirm, onSkip, onCancel,
}: {
  doctorName: string;
  bookedDates: string[];
  slotMinutes: number;
  onConfirm: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onCancel} />
      <div className="fixed z-50 bg-white shadow-2xl p-4 w-[300px]"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', borderRadius: '6px 20px 20px 6px', border: '1.5px solid #fcd34d' }}>
        <div className="text-[10px] font-bold text-amber-700 mb-2">
          ⚠ Есть записи пациентов
        </div>
        <p className="text-[9px] text-foreground mb-1">
          У врача <span className="font-semibold">{doctorName}</span> есть записи на даты:
        </p>
        <div className="text-[9px] text-muted-foreground mb-3 font-mono">
          {bookedDates.join(', ')}
        </div>
        <p className="text-[9px] text-foreground mb-3">
          Перезаписать автоматически на ближайший слот по {slotMinutes} мин?
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="text-[9px] px-2.5 py-1 border border-border rounded text-muted-foreground hover:bg-slate-100">
            Отмена
          </button>
          <button onClick={onSkip}
            className="text-[9px] px-2.5 py-1 border border-border rounded text-foreground hover:bg-slate-100">
            Изменить без переноса
          </button>
          <button onClick={onConfirm}
            className="text-[9px] font-semibold text-white px-3 py-1"
            style={{ background: '#00685B', borderRadius: '3px 12px 12px 3px' }}>
            Перенести
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Add per-doctor slot minutes selector in sticky cell**

Add state variables in `ScheduleTab`:

```typescript
const [slotConfirm, setSlotConfirm] = useState<{
  doctorId: string;
  doctorName: string;
  slotMinutes: number;
  bookedDates: string[];
} | null>(null);

const setSlotMut = trpc.schedules.setSlotMinutesForRange.useMutation({
  onSuccess: () => {
    utils.schedules.getForDepartmentMonth.invalidate();
    utils.schedules.getForDateRange.invalidate();
    toast.success('Шаг слота обновлён');
    setSlotConfirm(null);
  },
  onError: (e: any) => toast.error(e.message),
});

// Month date range helpers (used in slot-change flow)
const monthFrom = `${year}-${String(month).padStart(2,'0')}-01`;
const lastDay   = new Date(year, month, 0).getDate();
const monthTo   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
```

Add a helper to compute the dominant `slotMinutes` for a doctor in the current month:

```typescript
function doctorSlotMinutes(docId: string): number {
  const docScheds = schedules.filter((s: any) => s.doctorId === docId);
  if (!docScheds.length) return 15;
  // Use the most common value; if tie, use first
  const counts: Record<number, number> = {};
  for (const s of docScheds) {
    const v = s.slotMinutes ?? 15;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
}
```

Add `handleSlotMinutesChange` handler:

```typescript
const handleSlotMinutesChange = async (doc: any, newSlotMinutes: number) => {
  // Check for bookings first
  const booked: string[] = await utils.schedules.getBookedDatesInRange.fetch({
    doctorId: doc.id,
    dateFrom: monthFrom,
    dateTo:   monthTo,
  });

  if (booked.length > 0) {
    setSlotConfirm({
      doctorId:    doc.id,
      doctorName:  `${doc.lastName} ${doc.firstName[0]}.`,
      slotMinutes: newSlotMinutes,
      bookedDates: booked,
    });
  } else {
    setSlotMut.mutate({ doctorId: doc.id, dateFrom: monthFrom, dateTo: monthTo, slotMinutes: newSlotMinutes, reschedule: false });
  }
};
```

In the doctor row `<td>` sticky cell, add the slot select to the right of the name block:

```tsx
<td className="sticky left-0 z-[5] bg-white border-b border-r border-border px-2 py-2">
  <div className="flex items-center gap-2">
    <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
      style={{ background: '#00685B' }}>
      {doc.lastName[0]}{doc.firstName[0]}
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-semibold text-foreground truncate">
        {doc.lastName} {doc.firstName[0]}.
      </div>
      {doc.specialty && (
        <div className="text-[8px] text-muted-foreground truncate">{doc.specialty}</div>
      )}
    </div>
    {/* Slot minutes selector */}
    <select
      value={doctorSlotMinutes(doc.id)}
      onChange={e => handleSlotMinutesChange(doc, Number(e.target.value))}
      title="Шаг слота"
      className="text-[8px] px-1 py-0.5 border border-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary shrink-0"
      style={{ minWidth: '46px' }}
    >
      {SLOT_OPTIONS.map(m => (
        <option key={m} value={m}>{m} мин</option>
      ))}
    </select>
  </div>
</td>
```

- [ ] **Step 5: Render `SlotMinutesConfirmDialog` + wire up mutations**

At the bottom of the `ScheduleTab` return, before the closing `</div>`, add:

```tsx
{slotConfirm && (
  <SlotMinutesConfirmDialog
    doctorName={slotConfirm.doctorName}
    bookedDates={slotConfirm.bookedDates}
    slotMinutes={slotConfirm.slotMinutes}
    onConfirm={() => setSlotMut.mutate({
      doctorId:    slotConfirm.doctorId,
      dateFrom:    monthFrom,
      dateTo:      monthTo,
      slotMinutes: slotConfirm.slotMinutes,
      reschedule:  true,
    })}
    onSkip={() => setSlotMut.mutate({
      doctorId:    slotConfirm.doctorId,
      dateFrom:    monthFrom,
      dateTo:      monthTo,
      slotMinutes: slotConfirm.slotMinutes,
      reschedule:  false,
    })}
    onCancel={() => setSlotConfirm(null)}
  />
)}
```

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/admin/ScheduleTab.tsx
git commit -m "feat(schedule-tab): настройка шага слота для врача с предупреждением при наличии записей"
```

---

## Task 6: Build verification

- [ ] **Step 1: Build backend**

```bash
cd apps/backend
npx tsc --noEmit
```

Expected: no errors. If TypeScript errors appear, fix them (usually `(prisma as any)` casts or missing `slotMinutes` in mutation data).

- [ ] **Step 2: Build frontend**

```bash
cd apps/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verify UI end-to-end (manual)**

1. Open ScheduleTab for a department
2. Observe the slotMinutes select (default 15 мин) to the right of each doctor name
3. Change a doctor's slotMinutes (when no bookings) — grid updates, toast "Шаг слота обновлён"
4. Add a booking for that doctor via RegistrarView, then return to ScheduleTab and change slotMinutes — confirmation dialog appears
5. Click "Перенести" — booking time remaps to nearest new slot
6. Export schedule to Excel — verify col C shows "Шаг (мин)" header with correct values
7. Re-import the exported file — verify slotMinutes is preserved

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: финальная проверка slotMinutes per-doctor"
git push
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| `slotMinutes` per doctor, настраивается при формировании графика | Tasks 1, 2, 5 |
| Столбец "шаг" в шаблон импорта | Task 3 |
| UI справа от ФИО врача | Task 5 Step 4 |
| Предупреждение при наличии записей | Task 5 Steps 3–5 |
| "перезаписать автоматически" | Task 2 Step 5 (`setSlotMinutesForRange` with `reschedule=true`) |
| `slotsFromSchedule` использует настроенный шаг | Task 4 |

All requirements covered. ✓

### Placeholder scan

No TBD/TODO found. All code steps contain actual implementation. ✓

### Type consistency

- `CellEditor.onSave` signature updated in both definition (Task 5 Step 1) and call site (Task 5 Step 2) ✓
- `existing.slotMinutes` passed in the `onClick` (Task 5 Step 2) matches the updated `existing` type (Task 5 Step 1) ✓
- `ParsedRow.slotMinutes` added to interface (Task 3 Step 1), used in `parseWorkbook` (Task 3 Step 3), and in `commitImport` (Task 3 Step 4) ✓
- `saveDay` input `slotMinutes` (Task 2 Step 1) persisted to DB (Task 2 Step 2) ✓
- `setSlotMinutesForRange` procedure name used consistently across Task 2 Step 5 and Task 5 Steps 4–5 ✓
- `getBookedDatesInRange` procedure name used consistently across Task 2 Step 4 and Task 5 Step 4 ✓
