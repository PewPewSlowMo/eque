# Schedule Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Excel-based import and export of doctor work schedules (matrix format: rows = doctors, columns = days of month) with conflict warnings and role-scoped access.

**Architecture:** New NestJS REST controller handles export (GET), preview (POST), and commit (POST). File stays on the client between preview and commit — same re-upload pattern as `users-import.controller.ts`. Year/month stored in a hidden `_Meta` sheet so the parser doesn't guess. Frontend dialog is self-contained: department + period selectors, preview table, confirm.

**Tech Stack:** NestJS, ExcelJS, Multer, Prisma, React, shadcn/ui, tRPC (only for cache invalidation on the frontend)

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `apps/backend/src/modules/schedules/schedules-import.controller.ts` | Create | Export + preview + commit REST endpoints |
| `apps/backend/src/modules/schedules/schedules-import.module.ts` | Create | NestJS module wrapping the controller |
| `apps/backend/src/app.module.ts` | Modify | Register SchedulesImportModule |
| `apps/frontend/src/components/admin/ScheduleImportDialog.tsx` | Create | Import/export dialog with preview table |
| `apps/frontend/src/components/admin/ScheduleTab.tsx` | Modify | Add Export + Import buttons |

---

### Task 1: Backend controller

**Files:**
- Create: `apps/backend/src/modules/schedules/schedules-import.controller.ts`

- [ ] **Step 1: Create the controller file**

Create `apps/backend/src/modules/schedules/schedules-import.controller.ts`:

```typescript
import {
  Controller, Get, Post,
  Req, Res, Query,
  UploadedFile, UseInterceptors,
  UnauthorizedException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../database/prisma.service';
import { TrpcService } from '../../trpc/trpc.service';

const VALID_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function extractUser(req: any) {
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
  const user = TrpcService.verifyToken(auth.substring(7));
  if (!user || !['ADMIN', 'DEPARTMENT_HEAD'].includes(user.role)) {
    throw new ForbiddenException('Только ADMIN или DEPARTMENT_HEAD');
  }
  return user;
}

// "08:00-14:30" or "08:00-14:30/11:00-12:00/13:00-13:15"
// First range = work hours. Each subsequent range = a break.
function parseCell(raw: string): {
  startTime: string;
  endTime: string;
  breaks: { startTime: string; endTime: string }[];
} | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const rangeRe = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
  const parts = trimmed.split('/');
  if (!rangeRe.test(parts[0])) return null;
  const [startTime, endTime] = parts[0].split('-');
  const breaks: { startTime: string; endTime: string }[] = [];
  for (let i = 1; i < parts.length; i++) {
    if (!rangeRe.test(parts[i])) return null;
    const [bs, be] = parts[i].split('-');
    breaks.push({ startTime: bs, endTime: be });
  }
  return { startTime, endTime, breaks };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface ParsedRow {
  doctorId: string;
  doctorName: string;
  date: string;       // YYYY-MM-DD
  startTime: string;
  endTime: string;
  breaks: { startTime: string; endTime: string }[];
  hasConflict: boolean;
  errors: string[];
}

@Controller('api/schedules')
export class SchedulesImportController {
  constructor(private readonly prisma: PrismaService) {}

  private assertDeptAccess(user: any, departmentId: string) {
    if (user.role === 'ADMIN') return;
    if (user.role === 'DEPARTMENT_HEAD' && user.departmentId === departmentId) return;
    throw new ForbiddenException('Нет доступа к этому отделению');
  }

  // ── Export ───────────────────────────────────────────────────────────────
  @Get('export')
  async exportSchedule(
    @Req() req: any,
    @Res() res: any,
    @Query('departmentId') departmentId: string,
    @Query('year') yearStr: string,
    @Query('month') monthStr: string,
  ) {
    const user = extractUser(req);
    if (!departmentId || !yearStr || !monthStr) {
      throw new BadRequestException('departmentId, year, month обязательны');
    }
    this.assertDeptAccess(user, departmentId);

    const year  = parseInt(yearStr,  10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Неверный год или месяц');
    }

    const days      = daysInMonth(year, month);
    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month - 1, days);

    const doctors = await this.prisma.user.findMany({
      where: { departmentId, role: 'DOCTOR', isActive: true },
      select: { id: true, firstName: true, lastName: true, middleName: true },
      orderBy: { lastName: 'asc' },
    });

    const schedules = await (this.prisma as any).doctorDaySchedule.findMany({
      where: {
        doctorId: { in: doctors.map((d: any) => d.id) },
        date: { gte: startDate, lte: endDate },
      },
      include: { breaks: { orderBy: { startTime: 'asc' } } },
    });

    // doctorId → date-string → schedule
    const schedMap = new Map<string, Map<string, any>>();
    for (const s of schedules) {
      const d = new Date(s.date);
      const key = isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (!schedMap.has(s.doctorId)) schedMap.set(s.doctorId, new Map());
      schedMap.get(s.doctorId)!.set(key, s);
    }

    const workbook = new ExcelJS.Workbook();

    // Hidden metadata sheet: row 1 = year, row 2 = month
    const meta = workbook.addWorksheet('_Meta');
    meta.state = 'hidden';
    meta.getCell('A1').value = year;
    meta.getCell('A2').value = month;

    const sheet = workbook.addWorksheet('График');

    // Column widths + hide doctorId column
    sheet.getColumn(1).width  = 0.1;
    sheet.getColumn(1).hidden = true;
    sheet.getColumn(2).width  = 30;
    for (let d = 1; d <= days; d++) sheet.getColumn(d + 2).width = 15;

    // Header row
    const headerRow = sheet.addRow([
      '',
      'Врач',
      ...Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0')),
    ]);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };

    // Hint row
    const hintRow = sheet.addRow(['', 'Формат: 08:00-14:30 или 08:00-14:30/11:00-12:00 (перерыв)']);
    hintRow.font = { italic: true, color: { argb: 'FF808080' } };
    sheet.mergeCells(`B${hintRow.number}:${String.fromCharCode(66 + days)}${hintRow.number}`);

    // Doctor rows
    for (const doc of doctors) {
      const fullName = [doc.lastName, doc.firstName, doc.middleName].filter(Boolean).join(' ');
      const rowData: any[] = [doc.id, fullName];

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
        if (colNum > 2 && cell.value) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
        }
      });
    }

    const monthPad = String(month).padStart(2, '0');
    res.setHeader('Content-Type', VALID_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="schedule-${year}-${monthPad}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  // ── Shared parser ─────────────────────────────────────────────────────────
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

    const days = daysInMonth(year, month);
    const rows: ParsedRow[] = [];

    sheet.eachRow((row, rowNum) => {
      if (rowNum <= 2) return; // skip header + hint
      const doctorId   = String(row.getCell(1).value ?? '').trim();
      const doctorName = String(row.getCell(2).value ?? '').trim();
      if (!doctorId) return;

      for (let d = 1; d <= days; d++) {
        const cellVal = String(row.getCell(d + 2).value ?? '').trim();
        if (!cellVal) continue;

        const dateStr = isoDate(year, month, d);
        const parsed  = parseCell(cellVal);
        if (!parsed) {
          rows.push({
            doctorId, doctorName, date: dateStr,
            startTime: '', endTime: '', breaks: [],
            hasConflict: false,
            errors: [`День ${String(d).padStart(2,'0')}: неверный формат "${cellVal}"`],
          });
          continue;
        }
        rows.push({
          doctorId, doctorName, date: dateStr,
          startTime: parsed.startTime, endTime: parsed.endTime, breaks: parsed.breaks,
          hasConflict: false, errors: [],
        });
      }
    });

    return { year, month, rows };
  }

  private async enrichRows(rows: ParsedRow[], userRole: string, userDeptId: string | null | undefined) {
    const doctorIds = [...new Set(rows.map(r => r.doctorId))];
    const doctors   = await this.prisma.user.findMany({
      where: { id: { in: doctorIds } },
      select: { id: true, departmentId: true },
    });
    const docMap = new Map(doctors.map(d => [d.id, d]));

    for (const row of rows) {
      if (row.errors.length > 0) continue;
      const doc = docMap.get(row.doctorId);
      if (!doc) { row.errors = [...row.errors, 'Врач не найден в системе']; continue; }
      if (userRole === 'DEPARTMENT_HEAD' && doc.departmentId !== userDeptId) {
        row.errors = [...row.errors, 'Врач не из вашего отделения'];
      }
    }

    // Conflict detection
    const validRows = rows.filter(r => r.errors.length === 0);
    if (validRows.length > 0) {
      const existing = await (this.prisma as any).doctorDaySchedule.findMany({
        where: { OR: validRows.map(r => ({ doctorId: r.doctorId, date: new Date(r.date) })) },
        select: { doctorId: true, date: true },
      });
      const conflictSet = new Set(
        existing.map((s: any) => {
          const d = new Date(s.date);
          return `${s.doctorId}|${isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())}`;
        }),
      );
      for (const row of validRows) {
        row.hasConflict = conflictSet.has(`${row.doctorId}|${row.date}`);
      }
    }
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      /\.xlsx$/i.test(file.originalname) && file.mimetype === VALID_MIME
        ? cb(null, true)
        : cb(new BadRequestException('Только .xlsx файлы'), false);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  async previewImport(@Req() req: any, @UploadedFile() file: any) {
    const user = extractUser(req);
    if (!file) throw new BadRequestException('Файл не загружен');

    const { rows } = await this.parseWorkbook(file.buffer);
    await this.enrichRows(rows, user.role, user.departmentId);

    return {
      rows,
      validCount:    rows.filter(r => r.errors.length === 0).length,
      conflictCount: rows.filter(r => r.errors.length === 0 && r.hasConflict).length,
      errorCount:    rows.filter(r => r.errors.length > 0).length,
    };
  }

  // ── Commit ────────────────────────────────────────────────────────────────
  @Post('import/commit')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      /\.xlsx$/i.test(file.originalname) && file.mimetype === VALID_MIME
        ? cb(null, true)
        : cb(new BadRequestException('Только .xlsx файлы'), false);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  async commitImport(@Req() req: any, @UploadedFile() file: any) {
    const user = extractUser(req);
    if (!file) throw new BadRequestException('Файл не загружен');

    const { rows } = await this.parseWorkbook(file.buffer);
    await this.enrichRows(rows, user.role, user.departmentId);

    const validRows = rows.filter(r => r.errors.length === 0);
    let upserted = 0;
    const errors: string[] = [];

    for (const row of validRows) {
      try {
        const date = new Date(row.date);
        await this.prisma.$transaction(async (tx: any) => {
          const existing = await tx.doctorDaySchedule.findFirst({
            where: { doctorId: row.doctorId, date },
            select: { id: true },
          });
          let scheduleId: string;
          if (existing) {
            await tx.dayScheduleBreak.deleteMany({ where: { scheduleId: existing.id } });
            await tx.doctorDaySchedule.update({
              where: { id: existing.id },
              data: { startTime: row.startTime, endTime: row.endTime },
            });
            scheduleId = existing.id;
          } else {
            const created = await tx.doctorDaySchedule.create({
              data: { doctorId: row.doctorId, date, startTime: row.startTime, endTime: row.endTime },
            });
            scheduleId = created.id;
          }
          if (row.breaks.length > 0) {
            await tx.dayScheduleBreak.createMany({
              data: row.breaks.map((b: any) => ({
                scheduleId, startTime: b.startTime, endTime: b.endTime, label: null,
              })),
            });
          }
        });
        upserted++;
      } catch (e: any) {
        errors.push(`${row.doctorName} ${row.date}: ${e.message}`);
      }
    }

    return { upserted, errors };
  }
}
```

- [ ] **Step 2: Verify the file was created**

```bash
ls apps/backend/src/modules/schedules/schedules-import.controller.ts
```

Expected: file listed.

---

### Task 2: NestJS module + app.module registration

**Files:**
- Create: `apps/backend/src/modules/schedules/schedules-import.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create the module**

Create `apps/backend/src/modules/schedules/schedules-import.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SchedulesImportController } from './schedules-import.controller';
import { TrpcModule } from '../../trpc/trpc.module';

@Module({
  imports: [TrpcModule],   // PrismaModule is @Global — PrismaService injected automatically
  controllers: [SchedulesImportController],
})
export class SchedulesImportModule {}
```

- [ ] **Step 2: Register in app.module.ts**

In `apps/backend/src/app.module.ts`, add the import and module:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';
import { SoundsModule } from './modules/display/sounds.module';
import { UsersImportModule } from './modules/users/users-import.module';
import { SchedulesImportModule } from './modules/schedules/schedules-import.module';

@Module({
  imports: [PrismaModule, TrpcModule, EventsModule, SoundsModule, UsersImportModule, SchedulesImportModule],
})
export class AppModule {}
```

- [ ] **Step 3: Restart backend and verify routes are registered**

```bash
docker restart eque-backend && sleep 12 && docker logs eque-backend --tail 15 2>&1
```

Expected: logs contain lines like:
```
Mapped {/api/schedules/export, GET} route
Mapped {/api/schedules/import/preview, POST} route
Mapped {/api/schedules/import/commit, POST} route
Nest application successfully started
```

- [ ] **Step 4: Smoke-test export endpoint**

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['result']['data']['token'])")

DEPT=$(curl -s "http://localhost:3002/trpc/departments.getAll" \
  -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; data=json.load(sys.stdin); print(data['result']['data'][0]['id'])")

curl -s -o /tmp/test-schedule.xlsx -w "%{http_code}" \
  "http://localhost:3002/api/schedules/export?departmentId=$DEPT&year=2026&month=5" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` and `/tmp/test-schedule.xlsx` created (non-empty).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/schedules/schedules-import.controller.ts \
        apps/backend/src/modules/schedules/schedules-import.module.ts \
        apps/backend/src/app.module.ts
git commit -m "feat(schedules): REST контроллер экспорт/импорт графиков через Excel"
git push
```

---

### Task 3: Frontend — ScheduleImportDialog

**Files:**
- Create: `apps/frontend/src/components/admin/ScheduleImportDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `apps/frontend/src/components/admin/ScheduleImportDialog.tsx`:

```typescript
import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const BACKEND_BASE = (
  import.meta.env.VITE_TRPC_URL || 'http://localhost:3002/trpc'
).replace('/trpc', '');

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

interface PreviewRow {
  doctorId: string;
  doctorName: string;
  date: string;
  startTime: string;
  endTime: string;
  breaks: { startTime: string; endTime: string }[];
  hasConflict: boolean;
  errors: string[];
}

interface PreviewResult {
  rows: PreviewRow[];
  validCount: number;
  conflictCount: number;
  errorCount: number;
}

type Step = 'idle' | 'preview' | 'done';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultDeptId?: string;
  defaultYear?: number;
  defaultMonth?: number;
}

export function ScheduleImportDialog({
  open, onClose, defaultDeptId = '', defaultYear, defaultMonth,
}: Props) {
  const { user } = useUser();
  const isDeptHead = user?.role === 'DEPARTMENT_HEAD';

  const today = new Date();
  const [deptId,  setDeptId]  = useState(defaultDeptId);
  const [year,    setYear]    = useState(defaultYear  ?? today.getFullYear());
  const [month,   setMonth]   = useState(defaultMonth ?? today.getMonth() + 1);
  const [file,    setFile]    = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [step,    setStep]    = useState<Step>('idle');
  const [loading, setLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: departments = [] } = trpc.departments.getAll.useQuery(
    undefined,
    { enabled: open && !isDeptHead },
  );

  // DEPARTMENT_HEAD is locked to their own department
  const effectiveDeptId = isDeptHead ? (user?.departmentId ?? '') : deptId;

  function reset() {
    setFile(null);
    setPreview(null);
    setStep('idle');
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleExport() {
    if (!effectiveDeptId) { toast.error('Выберите отделение'); return; }
    const token = localStorage.getItem('auth_token');
    const url = `${BACKEND_BASE}/api/schedules/export?departmentId=${effectiveDeptId}&year=${year}&month=${month}`;
    fetch(url, { headers: { authorization: token ? `Bearer ${token}` : '' } })
      .then((res) => {
        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `schedule-${year}-${String(month).padStart(2, '0')}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch((err) => toast.error(err.message ?? 'Ошибка скачивания'));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setStep('idle');
    await uploadPreview(selected);
  }

  async function uploadPreview(selectedFile: File) {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const formData = new FormData();
      formData.append('file', selectedFile);
      const res = await fetch(`${BACKEND_BASE}/api/schedules/import/preview`, {
        method: 'POST',
        headers: { authorization: token ? `Bearer ${token}` : '' },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Ошибка сервера: ${res.status}`);
      }
      const data: PreviewResult = await res.json();
      setPreview(data);
      setStep('preview');
    } catch (err: any) {
      toast.error(err.message ?? 'Ошибка загрузки файла');
      reset();
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!file || !preview) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BACKEND_BASE}/api/schedules/import/commit`, {
        method: 'POST',
        headers: { authorization: token ? `Bearer ${token}` : '' },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Ошибка сервера: ${res.status}`);
      }
      const result: { upserted: number; errors: string[] } = await res.json();
      if (result.upserted > 0) {
        toast.success(`Записей сохранено: ${result.upserted}`);
        utils.schedules.getForDepartmentMonth.invalidate();
        utils.schedules.getForDateRange.invalidate();
      }
      result.errors.forEach((err) => toast.error(err));
      setStep('done');
    } catch (err: any) {
      toast.error(err.message ?? 'Ошибка импорта');
    } finally {
      setLoading(false);
    }
  }

  const hasValid    = (preview?.validCount    ?? 0) > 0;
  const hasErrors   = (preview?.errorCount    ?? 0) > 0;
  const hasConflicts= (preview?.conflictCount ?? 0) > 0;

  // Group preview rows by doctor name for cleaner display
  const groupedRows: Record<string, PreviewRow[]> = {};
  for (const row of (preview?.rows ?? [])) {
    if (!groupedRows[row.doctorName]) groupedRows[row.doctorName] = [];
    groupedRows[row.doctorName].push(row);
  }

  const yearOptions = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Экспорт / Импорт графиков</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Department + period selectors */}
          <div className="flex flex-wrap gap-3 items-end">
            {!isDeptHead && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Отделение</label>
                <select
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  className="text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9 min-w-[200px]"
                >
                  <option value="">— выберите —</option>
                  {(departments as any[]).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
            {isDeptHead && (
              <div className="text-sm text-muted-foreground py-1.5">
                Отделение: <span className="font-medium text-foreground">{user?.department?.name ?? user?.departmentId}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Год</label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                className="text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Месяц</label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                className="text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1}>{name}</option>
                ))}
              </select>
            </div>

            <Button variant="outline" size="sm" onClick={handleExport} disabled={!effectiveDeptId}>
              Скачать / Экспорт
            </Button>
          </div>

          {/* Import file picker */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              {file ? 'Заменить файл' : 'Загрузить для импорта (.xlsx)'}
            </Button>
            {file && (
              <span className="text-sm text-muted-foreground truncate max-w-xs">{file.name}</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {loading && <p className="text-sm text-muted-foreground">Обработка файла...</p>}

          {/* Preview */}
          {step === 'preview' && preview && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm flex-wrap">
                <span className="text-green-600 font-medium">Корректных: {preview.validCount}</span>
                {hasConflicts && (
                  <span className="text-yellow-600 font-medium">
                    Перезапишет существующие: {preview.conflictCount}
                  </span>
                )}
                {hasErrors && (
                  <span className="text-destructive font-medium">С ошибками: {preview.errorCount}</span>
                )}
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Врач</th>
                      <th className="text-left px-3 py-2 font-medium">Дата</th>
                      <th className="text-left px-3 py-2 font-medium">График</th>
                      <th className="text-left px-3 py-2 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.rows.map((row, idx) => {
                      const hasErr = row.errors.length > 0;
                      return (
                        <tr
                          key={idx}
                          className={hasErr ? 'bg-destructive/5' : row.hasConflict ? 'bg-yellow-50' : 'hover:bg-muted/50'}
                        >
                          <td className="px-3 py-1.5">{row.doctorName}</td>
                          <td className="px-3 py-1.5 tabular-nums">{row.date}</td>
                          <td className="px-3 py-1.5 font-mono">
                            {!hasErr && `${row.startTime}–${row.endTime}`}
                            {!hasErr && row.breaks.length > 0 && (
                              <span className="text-muted-foreground ml-1">
                                ({row.breaks.map((b) => `${b.startTime}-${b.endTime}`).join(', ')})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {hasErr ? (
                              <span className="text-destructive">{row.errors.join('; ')}</span>
                            ) : row.hasConflict ? (
                              <span className="text-yellow-600">⚠ перезапишет</span>
                            ) : (
                              <span className="text-green-600">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!hasValid && (
                <p className="text-sm text-destructive">
                  Нет корректных записей для импорта. Исправьте ошибки в файле.
                </p>
              )}
            </div>
          )}

          {step === 'done' && (
            <p className="text-sm text-green-600 font-medium">
              Импорт завершён. Можно закрыть окно или загрузить следующий файл.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Закрыть</Button>
          {step === 'preview' && hasValid && (
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? 'Импорт...' : `Импортировать ${preview!.validCount} зап.`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/admin/ScheduleImportDialog.tsx
git commit -m "feat(schedules): ScheduleImportDialog — экспорт и импорт графиков через Excel"
git push
```

---

### Task 4: ScheduleTab — Export + Import buttons

**Files:**
- Modify: `apps/frontend/src/components/admin/ScheduleTab.tsx`

- [ ] **Step 1: Add import and export buttons to ScheduleTab**

In `apps/frontend/src/components/admin/ScheduleTab.tsx`:

Add the import at the top of the file, after the existing imports:
```typescript
import { useUser } from '@/contexts/UserContext';
import { ScheduleImportDialog } from './ScheduleImportDialog';
```

Inside `ScheduleTab()`, add after the existing `const [deptId, setDeptId] = useState('')` line:
```typescript
  const { user } = useUser();
  const isDeptHead = user?.role === 'DEPARTMENT_HEAD';
  const [importOpen, setImportOpen] = useState(false);
```

In the controls `<div className="flex items-center gap-3 flex-wrap">`, add Export and Import buttons at the end (after the month navigation div):
```tsx
        <div className="flex gap-2 ml-auto">
          <Button
            size="sm"
            variant="outline"
            disabled={!deptId}
            onClick={() => setImportOpen(true)}
          >
            Импорт / Экспорт
          </Button>
        </div>
```

Add the dialog just before the closing `</div>` of the component return:
```tsx
      <ScheduleImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        defaultDeptId={deptId || undefined}
        defaultYear={year}
        defaultMonth={month}
      />
```

Also import `Button` at the top — check if it's already imported. If not, add:
```typescript
import { Button } from '@/components/ui/button';
```

- [ ] **Step 2: Handle DEPARTMENT_HEAD auto-department**

DEPARTMENT_HEAD users don't select a department in ScheduleTab — the deptId comes from their profile. Make sure the `deptId` is populated for them. Add this effect after the `useState` declarations:

```typescript
  useEffect(() => {
    if (isDeptHead && user?.departmentId && !deptId) {
      setDeptId(user.departmentId);
    }
  }, [isDeptHead, user?.departmentId]);
```

This requires adding `useEffect` to the existing import if not already there — `ScheduleTab.tsx` already imports `useState, useRef, useEffect` so it's already available.

- [ ] **Step 3: Verify frontend compiles**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit 2>&1 | grep -v "collides" | grep "error" | head -10
```

Expected: no new errors (pre-existing tRPC collision warnings can be ignored).

- [ ] **Step 4: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/frontend/src/components/admin/ScheduleTab.tsx
git commit -m "feat(schedules): кнопки Импорт/Экспорт в ScheduleTab"
git push
```
