# Kiosk Daily Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional daily entry limit to each kiosk — when the limit is reached, the kiosk shows a "closed" screen and the backend rejects new entries.

**Architecture:** Add `dailyLimit Int?` to the `Kiosk` Prisma model (null = no limit). The backend counts all `QueueEntry` rows with `kioskId = kiosk.id` and `createdAt` within today's Kazakhstan calendar day (UTC+5). The count-and-create happens inside one `$transaction` for atomicity. `getConfig` returns a new `spotsLeft: number | null` field that the kiosk UI uses to gate the welcome screen and show a "Closed" full-screen state.

**Tech Stack:** Prisma (PostgreSQL), NestJS tRPC router, React + inline styles (no Tailwind in KioskPage), Tailwind (KioskManager admin panel)

---

## File Map

| File | Change |
|------|--------|
| `apps/backend/prisma/schema.prisma` | Add `dailyLimit Int?` to `Kiosk` model |
| `apps/backend/src/modules/kiosk/kiosk.router.ts` | `getConfig` → spotsLeft; `addToQueue` → limit check in tx; zod schemas |
| `apps/frontend/src/components/kiosk/KioskPage.tsx` | New "limit exhausted" full-screen; spotsLeft display on welcome screen |
| `apps/frontend/src/components/admin/KioskManager.tsx` | `dailyLimit` field in `KioskForm`, dialog input, table column |

---

### Task 1: Schema — add `dailyLimit` to Kiosk + migrate

**Files:**
- Modify: `apps/backend/prisma/schema.prisma:388-404`

- [ ] **Step 1: Add field to Kiosk model**

In `apps/backend/prisma/schema.prisma`, find the `model Kiosk` block (lines 388–404) and add `dailyLimit` after `active`:

```prisma
model Kiosk {
  id              String          @id @default(cuid())
  slug            String          @unique
  name            String
  doctorId        String
  serviceId       String
  defaultCategory PatientCategory @default(OSMS)
  active          Boolean         @default(true)
  dailyLimit      Int?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  doctor       User         @relation("KioskDoctor", fields: [doctorId], references: [id], onDelete: Restrict)
  service      Service      @relation(fields: [serviceId], references: [id], onDelete: Restrict)
  queueEntries QueueEntry[]

  @@map("kiosks")
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd apps/backend && npx prisma migrate dev --name add_kiosk_daily_limit
```

Expected output: `The following migration(s) have been created and applied from new schema changes: ... add_kiosk_daily_limit`

If the Docker container holds the database, run this from the host where DATABASE_URL points to the container port (5433):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/eque" \
  cd apps/backend && npx prisma migrate dev --name add_kiosk_daily_limit
```

- [ ] **Step 3: Verify migration file was created**

```bash
ls apps/backend/prisma/migrations/ | tail -1
```

Expected: a new directory ending in `_add_kiosk_daily_limit`

- [ ] **Step 4: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(kiosk): добавить поле dailyLimit в модель Kiosk"
```

---

### Task 2: Backend — `kiosk.router.ts` (getConfig + addToQueue + zod)

**Files:**
- Modify: `apps/backend/src/modules/kiosk/kiosk.router.ts`

Context: `kzToday()` already exists at the top of the file and returns `{y, m, d}` for Kazakhstan UTC+5.

- [ ] **Step 1: Update `getConfig` to return `spotsLeft`**

In `getConfig` (lines 26–59), replace the `return` statement and add the `todayCount` / `spotsLeft` computation. The existing `dayStart`/`dayEnd` block is already there (lines 37–39); add the count and new return right after `waitingCount`:

```typescript
// ── Public: get kiosk config + waiting count ──────────────────────────
getConfig: trpc.procedure
  .input(z.object({ slug: z.string() }))
  .query(async ({ input }) => {
    const kiosk = await prisma.kiosk.findUnique({
      where: { slug: input.slug },
      include: {
        doctor:  { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
    });
    if (!kiosk) throw new TRPCError({ code: 'NOT_FOUND', message: 'Киоск не найден' });

    const { y, m, d } = kzToday();
    const dayStart = new Date(Date.UTC(y, m, d));
    const dayEnd   = new Date(Date.UTC(y, m, d + 1));

    const [waitingCount, todayCount] = await Promise.all([
      prisma.queueEntry.count({
        where: {
          doctorId: kiosk.doctorId,
          status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
          OR: [
            { scheduledAt: { gte: dayStart, lt: dayEnd } },
            { scheduledAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
          ],
        },
      }),
      prisma.queueEntry.count({
        where: { kioskId: kiosk.id, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
    ]);

    const spotsLeft: number | null = kiosk.dailyLimit != null
      ? Math.max(0, kiosk.dailyLimit - todayCount)
      : null;

    return {
      name:        kiosk.name,
      doctorName:  `${kiosk.doctor.lastName} ${kiosk.doctor.firstName}`,
      serviceName: kiosk.service.name,
      active:      kiosk.active,
      waitingCount,
      spotsLeft,
    };
  }),
```

- [ ] **Step 2: Add limit check inside `addToQueue` transaction**

In `addToQueue` (lines 62–132), inside the `prisma.$transaction` callback, add the limit check right after the `last` query for `queueNumber` (after line 108 `const queueNumber = ...`) and before `tx.queueEntry.create`:

```typescript
const entry = await prisma.$transaction(async (tx) => {
  // Find or create patient inside transaction
  let patient = await tx.patient.findFirst({
    where: {
      lastName:  { equals: lastName,  mode: 'insensitive' },
      firstName: { equals: firstName, mode: 'insensitive' },
    },
  });
  if (!patient) {
    patient = await tx.patient.create({
      data: { lastName, firstName, middleName, categories: [kiosk.defaultCategory] },
    });
  }

  const last = await tx.queueEntry.findFirst({
    where: {
      doctorId: kiosk.doctorId,
      OR: [
        { scheduledAt: { gte: dayStart, lt: dayEnd } },
        { scheduledAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
      ],
    },
    orderBy: { queueNumber: 'desc' },
    select: { queueNumber: true },
  });
  const queueNumber = (last?.queueNumber ?? 0) + 1;

  if (kiosk.dailyLimit != null) {
    const todayCount = await tx.queueEntry.count({
      where: { kioskId: kiosk.id, createdAt: { gte: dayStart, lt: dayEnd } },
    });
    if (todayCount >= kiosk.dailyLimit) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Запись на сегодня закрыта: лимит исчерпан' });
    }
  }

  return tx.queueEntry.create({
    data: {
      doctorId:                    kiosk.doctorId,
      patientId:                   patient.id,
      serviceId:                   kiosk.serviceId,
      priority:                    'WALK_IN',
      source:                      'KIOSK',
      category:                    kiosk.defaultCategory,
      status:                      'ARRIVED',
      arrivedAt:                   new Date(),
      requiresArrivalConfirmation: false,
      paymentConfirmed:            !PAID_CATEGORIES.includes(kiosk.defaultCategory),
      scheduledAt:                 null,
      createdById:                 null,
      kioskId:                     kiosk.id,
      queueNumber,
    } as any,
  });
});
```

- [ ] **Step 3: Add `dailyLimit` to `create` zod schema**

In `create` (line ~149), add `dailyLimit` to the input object:

```typescript
create: trpc.protectedProcedure
  .input(z.object({
    name:            z.string().min(1),
    slug:            z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug: только строчные латинские буквы, цифры и дефис'),
    doctorId:        z.string(),
    serviceId:       z.string(),
    defaultCategory: z.nativeEnum(PatientCategory).default('OSMS'),
    active:          z.boolean().default(true),
    dailyLimit:      z.number().int().positive().nullable().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
    return prisma.kiosk.create({ data: input as any });
  }),
```

- [ ] **Step 4: Add `dailyLimit` to `update` zod schema**

In `update` (line ~163), add `dailyLimit`:

```typescript
update: trpc.protectedProcedure
  .input(z.object({
    id:              z.string(),
    name:            z.string().min(1).optional(),
    slug:            z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
    doctorId:        z.string().optional(),
    serviceId:       z.string().optional(),
    defaultCategory: z.nativeEnum(PatientCategory).optional(),
    active:          z.boolean().optional(),
    dailyLimit:      z.number().int().positive().nullable().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
    const { id, ...data } = input;
    return prisma.kiosk.update({ where: { id }, data });
  }),
```

- [ ] **Step 5: Verify backend compiles**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/kiosk/kiosk.router.ts
git commit -m "feat(kiosk): getConfig возвращает spotsLeft, addToQueue проверяет лимит"
```

---

### Task 3: Frontend — `KioskPage.tsx` (limit exhausted screen + spotsLeft display)

**Files:**
- Modify: `apps/frontend/src/components/kiosk/KioskPage.tsx:211-246`

Context: The file uses inline `React.CSSProperties` styles throughout (no Tailwind). The existing full-screen guard blocks are at lines 191–220 (loading, error, inactive). The welcome screen starts at line 223.

- [ ] **Step 1: Add "limit exhausted" full-screen state**

After the `// Inactive` block (after line 220 `);`), add a new guard block:

```tsx
// Limit exhausted
if (config.spotsLeft === 0) return (
  <div style={{ ...baseStyle, justifyContent:'center', gap:'clamp(8px,1.5vh,16px)',
    padding:'clamp(20px,4vw,60px)' }}>
    <Logo />
    <div style={{ color:'white', fontSize:'clamp(20px,3.5vmin,40px)', fontWeight:800,
      textAlign:'center', lineHeight:1.2 }}>
      Жазылу жабық
    </div>
    <div style={{ color:'rgba(255,255,255,.6)', fontSize:'clamp(14px,2.2vmin,24px)',
      textAlign:'center' }}>
      Запись закрыта
    </div>
    <div style={{ color:'rgba(255,255,255,.4)', fontSize:'clamp(12px,1.8vmin,20px)',
      textAlign:'center', marginTop:'8px', lineHeight:1.5 }}>
      Бүгінгі лимит таусылды<br/>
      Дневной лимит записей исчерпан
    </div>
  </div>
);
```

- [ ] **Step 2: Show "Осталось мест" on welcome screen**

In the welcome screen (lines 222–246), after the `waitingCount` display `<div>` (line 240–244), add a `spotsLeft` indicator. Replace the existing footer `<div>`:

```tsx
// ── Screen: Welcome ──────────────────────────────────────────────────────
if (screen === 'welcome') return (
  <div style={{ ...baseStyle, justifyContent:'space-evenly',
    padding:'clamp(20px,4vh,60px) clamp(20px,4vw,60px)' }}>
    <Logo />
    <div style={{ color:'white', fontSize:'clamp(24px,5vmin,60px)', fontWeight:800,
      lineHeight:1.15, textAlign:'center' }}>
      {config.name}
    </div>
    <button onClick={() => setScreen('entry')} style={s({
      background:'#B39168', border:'2px solid #a07d54',
      borderRadius:'clamp(10px,1.5vmin,18px)', color:'white', fontWeight:800, cursor:'pointer',
      padding:'clamp(16px,3vh,36px) clamp(40px,8vw,100px)',
      fontSize:'clamp(20px,3.5vmin,42px)', lineHeight:1.3,
    })}>
      Кезекке тұру<br/>
      <span style={{ fontWeight:400, fontSize:'.7em', opacity:.8 }}>Встать в очередь</span>
    </button>
    <div style={{ color:'rgba(255,255,255,.5)', fontSize:'clamp(12px,1.8vmin,20px)' }}>
      {config.waitingCount > 0
        ? `Қазір ${config.waitingCount} адам күтуде / Сейчас ожидают ${config.waitingCount} чел.`
        : 'Кезек бос / Очередь свободна'}
    </div>
    {config.spotsLeft != null && config.spotsLeft > 0 && (
      <div style={{ color:'#B39168', fontSize:'clamp(11px,1.7vmin,18px)', textAlign:'center' }}>
        Қалған орын: {config.spotsLeft} / Осталось мест: {config.spotsLeft}
      </div>
    )}
  </div>
);
```

- [ ] **Step 3: Verify frontend compiles**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/kiosk/KioskPage.tsx
git commit -m "feat(kiosk): экран «Запись закрыта» и счётчик оставшихся мест"
```

---

### Task 4: Frontend — `KioskManager.tsx` (dailyLimit in form + table)

**Files:**
- Modify: `apps/frontend/src/components/admin/KioskManager.tsx`

Context: The admin panel uses Tailwind + shadcn/ui components (`Input`, `Label`, `Button`, `Dialog`). The `KioskForm` interface is at line 39. The `EMPTY` constant is at line 48. `KioskDialog` initialises form state at line 61. `handleSubmit` is at line 90.

- [ ] **Step 1: Update `KioskForm` interface and `EMPTY`**

Replace the `KioskForm` interface and `EMPTY` constant (lines 39–51):

```typescript
interface KioskForm {
  name: string;
  slug: string;
  doctorId: string;
  serviceId: string;
  defaultCategory: string;
  active: boolean;
  dailyLimit: string;
}

const EMPTY: KioskForm = {
  name:'', slug:'', doctorId:'', serviceId:'',
  defaultCategory:'OSMS', active:true, dailyLimit:'',
};
```

- [ ] **Step 2: Update `KioskDialog` initial state to include `dailyLimit`**

Replace the `useState<KioskForm>` initialiser (lines 61–66):

```typescript
const [form, setForm] = useState<KioskForm>(editing
  ? {
      name:            editing.name,
      slug:            editing.slug,
      doctorId:        editing.doctorId,
      serviceId:       editing.serviceId,
      defaultCategory: editing.defaultCategory,
      active:          editing.active,
      dailyLimit:      editing.dailyLimit != null ? String(editing.dailyLimit) : '',
    }
  : EMPTY
);
```

- [ ] **Step 3: Update `handleSubmit` to parse `dailyLimit`**

Replace `handleSubmit` (lines 90–103):

```typescript
const handleSubmit = () => {
  if (!form.name.trim())    { toast.error('Укажите название'); return; }
  if (!form.slug.trim())    { toast.error('Укажите slug'); return; }
  if (!/^[a-z0-9-]+$/.test(form.slug)) { toast.error('Slug: только строчные латинские буквы, цифры и дефис'); return; }
  if (!form.doctorId)       { toast.error('Выберите врача'); return; }
  if (!form.serviceId)      { toast.error('Выберите услугу'); return; }

  let dailyLimit: number | null = null;
  if (form.dailyLimit !== '') {
    const parsed = parseInt(form.dailyLimit, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      toast.error('Лимит должен быть целым положительным числом');
      return;
    }
    dailyLimit = parsed;
  }

  const data = {
    name:            form.name,
    slug:            form.slug,
    doctorId:        form.doctorId,
    serviceId:       form.serviceId,
    defaultCategory: form.defaultCategory,
    active:          form.active,
    dailyLimit,
  };
  if (editing) {
    update.mutate({ id: editing.id, ...data });
  } else {
    create.mutate(data as any);
  }
};
```

- [ ] **Step 4: Add `dailyLimit` input field in dialog**

In `KioskDialog` JSX, after the `active` checkbox block (after line 167 `</div>`), add:

```tsx
<div>
  <Label>Дневной лимит записей (необязательно)</Label>
  <Input
    type="number"
    min={1}
    value={form.dailyLimit}
    onChange={e => set('dailyLimit', e.target.value)}
    placeholder="Без ограничений"
  />
  <p className="text-xs text-muted-foreground mt-1">
    Оставьте пустым — лимита нет
  </p>
</div>
```

- [ ] **Step 5: Add "Лимит/день" column to the kiosk table**

In the `<thead>` (line ~226), add a new `<th>` after "Статус":

```tsx
<th className="text-left px-4 py-2 font-medium">Лимит/день</th>
```

In the `<tbody>` row (line ~247), add a new `<td>` after the status `<td>`:

```tsx
<td className="px-4 py-2 text-muted-foreground">
  {k.dailyLimit != null ? k.dailyLimit : '—'}
</td>
```

- [ ] **Step 6: Verify frontend compiles**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/admin/KioskManager.tsx
git commit -m "feat(kiosk): поле dailyLimit в форме и таблице KioskManager"
```

---

### Manual Verification Checklist

After all tasks are complete, start the dev stack and verify:

```bash
# In the project root:
docker compose up -d eque-postgres
pnpm dev
```

**Test 1 — No limit (default behaviour)**
1. Open `/admin` → KioskManager — verify new "Лимит/день" column shows "—"
2. Open the kiosk URL `/kiosk/<slug>` — welcome screen shows no spots counter
3. Register a patient — succeeds normally

**Test 2 — Limit > 0 with spots available**
1. Edit a kiosk, set Лимит/день = 5
2. Open the kiosk URL — welcome screen shows "Осталось мест: 5"
3. Register a patient — succeeds, spotsLeft decreases to 4 on next poll (30 s) or page refresh

**Test 3 — Limit exhausted**
1. Set Лимит/день = 1 on a test kiosk
2. Register one patient via the kiosk
3. Reload the kiosk page — full-screen "Жазылу жабық / Запись закрыта" appears
4. Try to register again via curl / direct mutation — FORBIDDEN error

**Test 4 — Remove limit**
1. Edit the kiosk, clear the limit field
2. Reload the kiosk — welcome screen returns, no spotsLeft shown

```bash
git push
```
