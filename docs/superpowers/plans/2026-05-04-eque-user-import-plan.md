# Mass User Import from Excel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to download an Excel template, fill in multiple users, upload the file, preview valid/invalid rows, and confirm bulk creation.

**Architecture:** REST `GET /api/users/template` generates an xlsx workbook via exceljs with dropdowns for role and department. REST `POST /api/users/import/preview` parses the uploaded file (multer memoryStorage) and validates rows. tRPC `users.importBatch` bulk-creates the validated users with bcrypt hashing. Frontend: three-step dialog (upload → preview table → confirm).

**Tech Stack:** NestJS, exceljs, multer (memoryStorage), bcrypt, tRPC/Zod, Prisma, React + shadcn/ui Dialog/Table/Button

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `apps/backend/src/modules/users/users-import.controller.ts` | Create | REST: GET template, POST preview |
| `apps/backend/src/modules/users/users-import.module.ts` | Create | NestJS module wiring controller + PrismaModule |
| `apps/backend/src/modules/users/users.router.ts` | Modify | Add `importBatch` tRPC mutation |
| `apps/backend/src/app.module.ts` | Modify | Import `UsersImportModule` |
| `apps/frontend/src/components/admin/UserImportDialog.tsx` | Create | Three-step import dialog |
| `apps/frontend/src/components/admin/UsersTab.tsx` | Modify | Add "Импорт из Excel" button |

---

### Task 1: Install exceljs and scaffold UsersImportModule

**Files:**
- Create: `apps/backend/src/modules/users/users-import.controller.ts`
- Create: `apps/backend/src/modules/users/users-import.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Install exceljs**

```bash
cd /home/administrator/projects_danik
pnpm add exceljs --filter backend
docker exec eque-backend sh -c "cd /app && pnpm install"
```

Expected: `apps/backend/package.json` has `"exceljs"` entry; no install errors in Docker.

- [ ] **Step 2: Create the controller file**

Create `apps/backend/src/modules/users/users-import.controller.ts`:

```typescript
import {
  Controller, Get, Post,
  Res, Req,
  UploadedFile, UseInterceptors,
  UnauthorizedException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../database/prisma.service';
import { TrpcService } from '../../trpc/trpc.service';

const ROLES = ['ADMIN', 'REGISTRAR', 'CALL_CENTER', 'DOCTOR', 'DEPARTMENT_HEAD', 'DIRECTOR'];
const CATEGORIES = ['PAID_ONCE', 'PAID_CONTRACT', 'OSMS', 'CONTINGENT', 'EMPLOYEE'];

const REQUIRED = ['lastName', 'firstName', 'username', 'password', 'role'] as const;

function extractUser(req: any) {
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
  const user = TrpcService.verifyToken(auth.substring(7));
  if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Только ADMIN');
  return user;
}

export interface PreviewRow {
  _rowNum: number;
  _errors: string[];
  lastName: string;
  firstName: string;
  middleName: string;
  username: string;
  password: string;
  role: string;
  specialty: string;
  departmentName: string;
  allowedCategories: string[];
  acceptedCategories: string[];
}

function parseCategories(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(s => CATEGORIES.includes(s));
}

async function parseWorkbook(buffer: Buffer, departments: { id: string; name: string }[]): Promise<PreviewRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Пользователи');
  if (!sheet) throw new BadRequestException('Лист "Пользователи" не найден в файле');

  const rows: PreviewRow[] = [];
  const usernamesInFile = new Set<string>();

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    const cell = (col: number) => String(row.getCell(col).value ?? '').trim();

    const lastName   = cell(1);
    const firstName  = cell(2);
    const middleName = cell(3);
    const username   = cell(4);
    const password   = cell(5);
    const role       = cell(6);
    const specialty  = cell(7);
    const deptName   = cell(8);
    const allowedRaw = cell(9);
    const acceptedRaw = cell(10);

    // Skip completely empty rows
    if (!lastName && !firstName && !username && !password && !role) return;

    const errors: string[] = [];

    if (!lastName)  errors.push('Фамилия обязательна');
    if (!firstName) errors.push('Имя обязательно');
    if (!username)  errors.push('Логин обязателен');
    if (!password)  errors.push('Пароль обязателен');
    if (!role)      errors.push('Роль обязательна');
    if (role && !ROLES.includes(role)) errors.push(`Неверная роль: ${role}`);

    if (username) {
      if (usernamesInFile.has(username)) {
        errors.push(`Дублирующийся логин в файле: ${username}`);
      } else {
        usernamesInFile.add(username);
      }
    }

    const dept = departments.find(d => d.name === deptName);
    if (deptName && !dept) errors.push(`Отделение не найдено: ${deptName}`);

    rows.push({
      _rowNum: rowNum,
      _errors: errors,
      lastName,
      firstName,
      middleName,
      username,
      password,
      role,
      specialty,
      departmentName: deptName,
      allowedCategories: parseCategories(allowedRaw),
      acceptedCategories: parseCategories(acceptedRaw),
    });
  });

  return rows;
}

@Controller('api/users')
export class UsersImportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('template')
  async downloadTemplate(@Req() req: any, @Res() res: any) {
    extractUser(req);

    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'eque';

    const sheet = workbook.addWorksheet('Пользователи');
    sheet.columns = [
      { header: 'Фамилия*',             key: 'lastName',          width: 22 },
      { header: 'Имя*',                 key: 'firstName',         width: 18 },
      { header: 'Отчество',             key: 'middleName',        width: 22 },
      { header: 'Логин*',               key: 'username',          width: 18 },
      { header: 'Пароль*',              key: 'password',          width: 18 },
      { header: 'Роль*',                key: 'role',              width: 18 },
      { header: 'Специальность',        key: 'specialty',         width: 22 },
      { header: 'Отделение',            key: 'department',        width: 28 },
      { header: 'Разреш. категории',    key: 'allowedCategories', width: 35 },
      { header: 'Принимаем. категории', key: 'acceptedCategories',width: 35 },
    ];

    // Bold header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' },
    };

    // Role dropdown (column F = 6)
    sheet.dataValidations.add('F2:F10000', {
      type: 'list',
      allowBlank: true,
      showErrorMessage: true,
      error: `Выберите одно из: ${ROLES.join(', ')}`,
      formulae: [`"${ROLES.join(',')}"`],
    });

    // Department dropdown via hidden sheet
    if (departments.length > 0) {
      const deptSheet = workbook.addWorksheet('_Departments');
      deptSheet.state = 'hidden';
      departments.forEach((d, i) => {
        deptSheet.getCell(i + 1, 1).value = d.name;
      });
      sheet.dataValidations.add('H2:H10000', {
        type: 'list',
        allowBlank: true,
        showErrorMessage: true,
        error: 'Выберите отделение из списка',
        formulae: [`_Departments!$A$1:$A$${departments.length}`],
      });
    }

    // Sample row
    sheet.addRow({
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: 'Иванович',
      username: 'ivanov',
      password: 'password123',
      role: 'DOCTOR',
      specialty: 'Терапевт',
      department: departments[0]?.name ?? '',
      allowedCategories: '',
      acceptedCategories: 'OSMS,PAID_ONCE',
    });

    // Categories hint row (row 3)
    const hintRow = sheet.addRow([
      '-- Доступные категории: PAID_ONCE, PAID_CONTRACT, OSMS, CONTINGENT, EMPLOYEE (через запятую) --',
    ]);
    hintRow.font = { italic: true, color: { argb: 'FF808080' } };
    sheet.mergeCells(`A${hintRow.number}:J${hintRow.number}`);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="users-template.xlsx"',
    );
    await workbook.xlsx.write(res as any);
    res.end();
  }

  @Post('import/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (/\.xlsx$/i.test(file.originalname)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Только .xlsx файлы'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async previewImport(@Req() req: any, @UploadedFile() file: any) {
    extractUser(req);
    if (!file) throw new BadRequestException('Файл не загружен');

    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true },
    });

    // Check for existing usernames in DB
    const rows = await parseWorkbook(file.buffer, departments);
    const usernames = rows.map(r => r.username).filter(Boolean);
    const existing = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { username: true },
    });
    const existingSet = new Set(existing.map(u => u.username));

    for (const row of rows) {
      if (row.username && existingSet.has(row.username)) {
        row._errors.push(`Логин уже существует в системе: ${row.username}`);
      }
    }

    const validCount = rows.filter(r => r._errors.length === 0).length;
    const errorCount = rows.filter(r => r._errors.length > 0).length;

    return { rows, validCount, errorCount };
  }
}
```

- [ ] **Step 3: Create UsersImportModule**

Create `apps/backend/src/modules/users/users-import.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UsersImportController } from './users-import.controller';
import { TrpcModule } from '../../trpc/trpc.module';

@Module({
  imports: [TrpcModule],   // PrismaModule is @Global — PrismaService injected automatically
  controllers: [UsersImportController],
})
export class UsersImportModule {}
```

- [ ] **Step 4: Register module in AppModule**

Modify `apps/backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';
import { SoundsModule } from './modules/display/sounds.module';
import { UsersImportModule } from './modules/users/users-import.module';

@Module({
  imports: [PrismaModule, TrpcModule, EventsModule, SoundsModule, UsersImportModule],
})
export class AppModule {}
```

- [ ] **Step 5: Build backend and verify no TypeScript errors**

```bash
cd /home/administrator/projects_danik
docker exec eque-backend sh -c "cd /app/apps/backend && pnpm add exceljs && npx tsc --noEmit 2>&1 | head -30"
```

Expected: no errors (or only pre-existing ones unrelated to new files).

- [ ] **Step 6: Restart backend**

```bash
docker restart eque-backend && sleep 5
```

- [ ] **Step 7: Verify GET template endpoint**

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"username":"admin","password":"admin"}}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['json']['token'])")

curl -s -o /tmp/template.xlsx \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3002/api/users/template

file /tmp/template.xlsx
```

Expected: `Zip archive data` (xlsx is a zip file).

- [ ] **Step 8: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/backend/src/modules/users/users-import.controller.ts \
        apps/backend/src/modules/users/users-import.module.ts \
        apps/backend/src/app.module.ts \
        apps/backend/package.json \
        pnpm-lock.yaml
git commit -m "feat(users): REST контроллер импорта — GET шаблон + POST preview"
git push
```

---

### Task 2: Add importBatch tRPC mutation

**Files:**
- Modify: `apps/backend/src/modules/users/users.router.ts`

- [ ] **Step 1: Add the importBatch mutation**

Open `apps/backend/src/modules/users/users.router.ts` and add the following mutation inside the `trpc.router({...})` object, after the `getDoctors` procedure:

```typescript
    importBatch: trpc.protectedProcedure
      .input(z.object({
        users: z.array(z.object({
          username:           z.string().min(1),
          password:           z.string().min(1),
          firstName:          z.string().min(1),
          lastName:           z.string().min(1),
          middleName:         z.string().optional(),
          role:               z.nativeEnum(UserRole),
          specialty:          z.string().optional(),
          departmentName:     z.string().optional(),
          allowedCategories:  z.array(z.nativeEnum(PatientCategory)).optional(),
          acceptedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });

        // Resolve department names → IDs once
        const deptNames = [...new Set(
          input.users.map(u => u.departmentName).filter(Boolean) as string[]
        )];
        const departments = deptNames.length > 0
          ? await prisma.department.findMany({
              where: { name: { in: deptNames } },
              select: { id: true, name: true },
            })
          : [];
        const deptMap = new Map(departments.map(d => [d.name, d.id]));

        let created = 0;
        const errors: string[] = [];

        for (const u of input.users) {
          try {
            const hashed = await bcrypt.hash(u.password, 10);
            await prisma.user.create({
              data: {
                username:   u.username,
                password:   hashed,
                firstName:  u.firstName,
                lastName:   u.lastName,
                middleName: u.middleName || undefined,
                role:       u.role,
                specialty:  u.specialty || undefined,
                departmentId: u.departmentName ? deptMap.get(u.departmentName) ?? undefined : undefined,
                allowedCategories:  u.allowedCategories  ?? [],
                acceptedCategories: u.acceptedCategories ?? [],
              } as any,
            });
            created++;
          } catch (e: any) {
            errors.push(`${u.username}: ${e.message}`);
          }
        }

        return { created, errors };
      }),
```

- [ ] **Step 2: Rebuild and restart**

```bash
docker restart eque-backend && sleep 6
```

- [ ] **Step 3: Verify tRPC procedure exists**

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"username":"admin","password":"admin"}}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['json']['token'])")

curl -s -X POST http://localhost:3002/trpc/users.importBatch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"json":{"users":[]}}' | python3 -m json.tool
```

Expected: `{"result":{"data":{"json":{"created":0,"errors":[]}}}}` (empty batch returns 0 created).

- [ ] **Step 4: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/backend/src/modules/users/users.router.ts
git commit -m "feat(users): tRPC users.importBatch — пакетное создание пользователей"
git push
```

---

### Task 3: Frontend UserImportDialog component

**Files:**
- Create: `apps/frontend/src/components/admin/UserImportDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `apps/frontend/src/components/admin/UserImportDialog.tsx`:

```typescript
import { useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const BACKEND_BASE = (import.meta.env.VITE_TRPC_URL || 'http://localhost:3002/trpc').replace('/trpc', '');

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Администратор',
  DIRECTOR: 'Директор',
  REGISTRAR: 'Регистратор',
  CALL_CENTER: 'Колл-центр',
  DOCTOR: 'Врач',
  DEPARTMENT_HEAD: 'Завотделением',
};

interface PreviewRow {
  _rowNum: number;
  _errors: string[];
  lastName: string;
  firstName: string;
  middleName: string;
  username: string;
  password: string;
  role: string;
  specialty: string;
  departmentName: string;
  allowedCategories: string[];
  acceptedCategories: string[];
}

interface PreviewResult {
  rows: PreviewRow[];
  validCount: number;
  errorCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'upload' | 'preview' | 'done';

export function UserImportDialog({ open, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const importBatch = trpc.users.importBatch.useMutation({
    onSuccess: (result) => {
      utils.users.getAll.invalidate();
      toast.success(`Создано пользователей: ${result.created}`);
      if (result.errors.length > 0) {
        toast.warning(`Ошибки при создании: ${result.errors.join('; ')}`);
      }
      setStep('done');
      onImported();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleClose = () => {
    setStep('upload');
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
    onClose();
  };

  const downloadTemplate = async () => {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(`${BACKEND_BASE}/api/users/template`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast.error('Ошибка загрузки шаблона'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BACKEND_BASE}/api/users/import/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.message ?? 'Ошибка разбора файла'); return; }
      setPreview(json);
      setStep('preview');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleConfirm = () => {
    if (!preview) return;
    const validRows = preview.rows.filter(r => r._errors.length === 0);
    if (validRows.length === 0) { toast.error('Нет валидных строк для импорта'); return; }
    importBatch.mutate({
      users: validRows.map(r => ({
        username:           r.username,
        password:           r.password,
        firstName:          r.firstName,
        lastName:           r.lastName,
        middleName:         r.middleName || undefined,
        role:               r.role as any,
        specialty:          r.specialty || undefined,
        departmentName:     r.departmentName || undefined,
        allowedCategories:  r.allowedCategories as any,
        acceptedCategories: r.acceptedCategories as any,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Импорт пользователей из Excel</DialogTitle>
        </DialogHeader>

        {/* STEP: upload */}
        {step === 'upload' && (
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Скачайте шаблон, заполните данные пользователей и загрузите файл для проверки.
            </p>
            <Button variant="outline" onClick={downloadTemplate} className="self-start">
              Скачать шаблон (.xlsx)
            </Button>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                {uploading ? 'Анализируем файл...' : 'Загрузите заполненный шаблон'}
              </p>
              <Button
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Загрузка...' : 'Выбрать файл'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        )}

        {/* STEP: preview */}
        {step === 'preview' && preview && (
          <>
            <div className="flex items-center gap-4 py-2 shrink-0">
              <span className="text-sm">
                <span className="font-semibold text-emerald-600">{preview.validCount}</span> валидных
              </span>
              {preview.errorCount > 0 && (
                <span className="text-sm">
                  <span className="font-semibold text-red-600">{preview.errorCount}</span> с ошибками (не будут импортированы)
                </span>
              )}
              <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => {
                setStep('upload');
                setPreview(null);
                if (fileRef.current) fileRef.current.value = '';
              }}>
                ← Загрузить другой файл
              </Button>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-muted z-10">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium border-b">№</th>
                    <th className="text-left px-2 py-1.5 font-medium border-b">Фамилия Имя</th>
                    <th className="text-left px-2 py-1.5 font-medium border-b">Логин</th>
                    <th className="text-left px-2 py-1.5 font-medium border-b">Роль</th>
                    <th className="text-left px-2 py-1.5 font-medium border-b">Специальность</th>
                    <th className="text-left px-2 py-1.5 font-medium border-b">Отделение</th>
                    <th className="text-left px-2 py-1.5 font-medium border-b">Ошибки</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const hasErrors = row._errors.length > 0;
                    return (
                      <tr
                        key={row._rowNum}
                        className={hasErrors ? 'bg-red-50' : 'hover:bg-muted/30'}
                      >
                        <td className="px-2 py-1.5 border-b text-muted-foreground">{row._rowNum}</td>
                        <td className="px-2 py-1.5 border-b">
                          {row.lastName} {row.firstName}
                          {row.middleName ? ` ${row.middleName}` : ''}
                        </td>
                        <td className="px-2 py-1.5 border-b font-mono">{row.username}</td>
                        <td className="px-2 py-1.5 border-b">{ROLE_LABEL[row.role] ?? row.role}</td>
                        <td className="px-2 py-1.5 border-b text-muted-foreground">{row.specialty || '—'}</td>
                        <td className="px-2 py-1.5 border-b text-muted-foreground">{row.departmentName || '—'}</td>
                        <td className="px-2 py-1.5 border-b text-red-600">
                          {hasErrors ? row._errors.join('; ') : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* STEP: done */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="text-4xl">✓</span>
            <p className="text-sm text-muted-foreground">Импорт завершён успешно.</p>
          </div>
        )}

        <DialogFooter className="shrink-0">
          {step === 'preview' && (
            <Button
              onClick={handleConfirm}
              disabled={importBatch.isPending || preview?.validCount === 0}
            >
              {importBatch.isPending
                ? 'Создание...'
                : `Создать ${preview?.validCount ?? 0} пользователей`}
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            {step === 'done' ? 'Закрыть' : 'Отмена'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/frontend/src/components/admin/UserImportDialog.tsx
git commit -m "feat(users): UserImportDialog — загрузка, preview, подтверждение импорта"
git push
```

---

### Task 4: Wire UserImportDialog into UsersTab

**Files:**
- Modify: `apps/frontend/src/components/admin/UsersTab.tsx`

- [ ] **Step 1: Add import button and dialog to UsersTab**

Replace the contents of `apps/frontend/src/components/admin/UsersTab.tsx` with:

```typescript
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { Button } from '@/components/ui/button';
import { UserDialog } from './UserDialog';
import { UserImportDialog } from './UserImportDialog';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Администратор',
  DIRECTOR: 'Директор',
  REGISTRAR: 'Регистратор',
  CALL_CENTER: 'Колл-центр',
  DOCTOR: 'Врач',
  DEPARTMENT_HEAD: 'Завотделением',
};

export function UsersTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: users = [], isLoading, refetch } = trpc.users.getAll.useQuery();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (u: any) => { setEditing(u); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Импорт из Excel
          </Button>
          <Button onClick={openCreate}>Создать пользователя</Button>
        </div>
      )}

      {(users as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет пользователей</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">ФИО</th>
                <th className="text-left px-4 py-2 font-medium">Логин</th>
                <th className="text-left px-4 py-2 font-medium">Роль</th>
                <th className="text-left px-4 py-2 font-medium">Отделение</th>
                {isAdmin && <th className="px-4 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(users as any[]).map((u: any) => (
                <tr key={u.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2">
                    {u.lastName} {u.firstName}
                    {u.middleName ? ` ${u.middleName}` : ''}
                    {!u.isActive && (
                      <span className="ml-1 text-xs text-muted-foreground">(неактивен)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{u.username}</td>
                  <td className="px-4 py-2">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.department?.name ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                        Изменить
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserDialog open={dialogOpen} onClose={() => setDialogOpen(false)} user={editing} />
      <UserImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => { refetch(); setImportOpen(false); }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds without errors**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: End-to-end manual test**

1. Open the admin panel → Users tab
2. Click "Импорт из Excel" → dialog opens
3. Click "Скачать шаблон (.xlsx)" → file downloads
4. Open the file in Excel/LibreOffice → verify dropdowns work for Роль and Отделение
5. Fill in 2-3 test rows (one valid, one with missing required field)
6. Upload the file → preview table appears
7. Verify: valid rows highlighted normally, invalid rows in red with error messages
8. Click "Создать N пользователей" → success toast
9. Verify new users appear in the Users tab table
10. Try uploading a file with a duplicate username → verify error shown in preview

- [ ] **Step 4: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/frontend/src/components/admin/UsersTab.tsx
git commit -m "feat(users): кнопка 'Импорт из Excel' в UsersTab + интеграция UserImportDialog"
git push
```
