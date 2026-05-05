# Services CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Service catalog with doctor assignment, required service selection when registering queue entries, and an elapsed-time timer on the doctor's patient card.

**Architecture:** New `Service` + `DoctorService` models in Prisma. New `services.router.ts` for CRUD. `queue.router.ts` gains `serviceId` on `add` and `startedAt` on `callNext`/`callSpecific`. Frontend: `ServicesTab`, `ServiceDialog`, doctor-service assignment in `UserDialog`, service picker in `AddToQueueForm`, timer in `CurrentPatientCard` and `DoctorQueueList`.

**Tech Stack:** NestJS, tRPC, Prisma/PostgreSQL, React, Tailwind, shadcn/ui

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `apps/backend/prisma/schema.prisma` | Modify | Add Service, DoctorService models; add serviceId + startedAt to QueueEntry; add DoctorService relation to User |
| `apps/backend/prisma/migrations/…` | Create (auto) | Prisma migration SQL |
| `apps/backend/src/modules/services/services.router.ts` | Create | CRUD for services + doctor assignment |
| `apps/backend/src/trpc/trpc.router.ts` | Modify | Register services router |
| `apps/backend/src/modules/queue/queue.router.ts` | Modify | Add serviceId to add; startedAt to callNext/callSpecific; service include in getByDoctor |
| `apps/frontend/src/components/admin/ServicesTab.tsx` | Create | Table of services with CRUD actions |
| `apps/frontend/src/components/admin/ServiceDialog.tsx` | Create | Create/edit service modal |
| `apps/frontend/src/components/AdminPanel.tsx` | Modify | Add "Услуги" tab (ADMIN + DEPARTMENT_HEAD) |
| `apps/frontend/src/components/admin/UserDialog.tsx` | Modify | Add doctor-service assignment section |
| `apps/frontend/src/components/registrar/AddToQueueForm.tsx` | Modify | Add service selector (required) |
| `apps/frontend/src/components/doctor/CurrentPatientCard.tsx` | Modify | Add service name + elapsed timer |
| `apps/frontend/src/components/doctor/DoctorQueueList.tsx` | Modify | Add compact timer for IN_PROGRESS rows |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add Service model to schema**

In `apps/backend/prisma/schema.prisma`, after the `CategorySettings` block (around line 287), add:

```prisma
// ============================================================================
// SERVICES
// ============================================================================

model Service {
  id              String          @id @default(cuid())
  name            String
  description     String?
  durationMinutes Int
  paymentCategory PatientCategory
  isActive        Boolean         @default(true)

  doctors      DoctorService[]
  queueEntries QueueEntry[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("services")
}

model DoctorService {
  doctorId  String
  serviceId String
  doctor    User    @relation(fields: [doctorId], references: [id], onDelete: Cascade)
  service   Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@id([doctorId, serviceId])
  @@map("doctor_services")
}
```

- [ ] **Step 2: Add doctorServices relation to User model**

In the `User` model, after the `doctorDaySchedules DoctorDaySchedule[]` line, add:

```prisma
  doctorServices     DoctorService[]
```

- [ ] **Step 3: Add serviceId and startedAt to QueueEntry**

In the `QueueEntry` model, after the `arrivedAt DateTime?` line, add:

```prisma
  startedAt   DateTime?
  serviceId   String?
  service     Service?  @relation(fields: [serviceId], references: [id])
```

- [ ] **Step 4: Run migration**

```bash
cd /home/administrator/projects_danik/apps/backend
docker exec eque-backend sh -c "cd /app/apps/backend && npx prisma migrate dev --name add_services_and_started_at"
```

Expected output: `✔ Generated Prisma Client` and `The following migration(s) have been applied`.

- [ ] **Step 5: Verify migration applied**

```bash
docker exec eque-backend sh -c "cd /app/apps/backend && npx prisma migrate status"
```

Expected: `Database schema is up to date!`

- [ ] **Step 6: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(services): Prisma модели Service, DoctorService, serviceId и startedAt на QueueEntry"
git push
```

---

### Task 2: services.router.ts + register in trpc.router.ts

**Files:**
- Create: `apps/backend/src/modules/services/services.router.ts`
- Modify: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 1: Create the services router**

Create `apps/backend/src/modules/services/services.router.ts`:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { PatientCategory, UserRole } from '@prisma/client';

const ALLOWED_ROLES: UserRole[] = ['ADMIN', 'DEPARTMENT_HEAD'];

const PatientCategoryEnum = z.nativeEnum(PatientCategory);

export const createServicesRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({

    getAll: trpc.protectedProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: input?.includeInactive ? {} : { isActive: true },
          orderBy: { name: 'asc' },
        });
      }),

    create: trpc.protectedProcedure
      .input(z.object({
        name:            z.string().min(1),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1),
        paymentCategory: PatientCategoryEnum,
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        return prisma.service.create({ data: input });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id:              z.string(),
        name:            z.string().min(1).optional(),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1).optional(),
        paymentCategory: PatientCategoryEnum.optional(),
        isActive:        z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { id, ...data } = input;
        return prisma.service.update({ where: { id }, data });
      }),

    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const linked = await prisma.queueEntry.count({ where: { serviceId: input.id } });
        if (linked > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Услуга используется в ${linked} записях очереди — сначала деактивируйте`,
          });
        }
        await prisma.service.delete({ where: { id: input.id } });
        return { ok: true };
      }),

    assignToDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string(), serviceId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        await prisma.doctorService.upsert({
          where: { doctorId_serviceId: { doctorId: input.doctorId, serviceId: input.serviceId } },
          create: { doctorId: input.doctorId, serviceId: input.serviceId },
          update: {},
        });
        return { ok: true };
      }),

    removeFromDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string(), serviceId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        await prisma.doctorService.deleteMany({
          where: { doctorId: input.doctorId, serviceId: input.serviceId },
        });
        return { ok: true };
      }),

    getForDoctor: trpc.protectedProcedure
      .input(z.object({
        doctorId:        z.string(),
        paymentCategory: PatientCategoryEnum.optional(),
      }))
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: {
            isActive: true,
            doctors: { some: { doctorId: input.doctorId } },
            ...(input.paymentCategory ? { paymentCategory: input.paymentCategory } : {}),
          },
          orderBy: { name: 'asc' },
        });
      }),

  });
};
```

- [ ] **Step 2: Register in trpc.router.ts**

In `apps/backend/src/trpc/trpc.router.ts`, add the import after the existing imports:

```typescript
import { createServicesRouter } from '../modules/services/services.router';
```

Then add to the `appRouter` object after `schedules`:

```typescript
    services: createServicesRouter(this.trpc, this.prisma),
```

- [ ] **Step 3: Restart and verify**

```bash
docker restart eque-backend && sleep 8

TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"username":"admin","password":"admin"}}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['json']['token'])")

curl -s -X GET "http://localhost:3002/trpc/services.getAll" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: `{"result":{"data":{"json":[]}}}`

- [ ] **Step 4: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/backend/src/modules/services/services.router.ts \
        apps/backend/src/trpc/trpc.router.ts
git commit -m "feat(services): tRPC services router — CRUD + назначение врачу"
git push
```

---

### Task 3: queue.router.ts — serviceId + startedAt + service include

**Files:**
- Modify: `apps/backend/src/modules/queue/queue.router.ts`

- [ ] **Step 1: Add serviceId to the `add` procedure input schema**

Find the `add` procedure input in `queue.router.ts`. It starts with `z.object({`. Add `serviceId: z.string()` to the input:

```typescript
      .input(
        z.object({
          doctorId:    z.string(),
          patientId:   z.string(),
          priority:    QueuePriorityEnum,
          category:    PatientCategoryEnum,
          serviceId:   z.string(),                              // ← ADD THIS LINE
          scheduledAt: z.string().datetime().optional(),
          source:      z.enum(['REGISTRAR', 'CALL_CENTER']),
          notes:       z.string().optional(),
        }),
      )
```

- [ ] **Step 2: Pass serviceId when creating QueueEntry**

Inside the `add` mutation, find the `tx.queueEntry.create` call. In the `data` object, add `serviceId: input.serviceId`:

```typescript
          return tx.queueEntry.create({
            data: {
              doctorId:    input.doctorId,
              patientId:   input.patientId,
              priority:    input.priority,
              category:    input.category,
              serviceId:   input.serviceId,                    // ← ADD THIS LINE
              queueNumber,
              status:      initialStatus,
              source:      input.source,
              createdById: ctx.user!.id,
              requiresArrivalConfirmation: requiresArrival,
              paymentConfirmed,
              scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
              arrivedAt,
              notes:       input.notes,
            } as any,
            include: { patient: { select: PATIENT_SELECT } },
          });
```

- [ ] **Step 3: Validate service belongs to doctor**

Inside the `add` mutation, before the `$transaction` block (after the `catSettings` lookup), add:

```typescript
        // Validate service belongs to doctor
        const doctorService = await prisma.doctorService.findUnique({
          where: { doctorId_serviceId: { doctorId: input.doctorId, serviceId: input.serviceId } },
        });
        if (!doctorService) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Выбранная услуга не назначена этому врачу',
          });
        }
```

- [ ] **Step 4: Set startedAt on IN_PROGRESS transition in callNext**

Find the `callNext` procedure. Find the `prisma.queueEntry.update` call where `status: 'IN_PROGRESS'` is set. Add `startedAt: new Date()`:

```typescript
          data: { status: 'IN_PROGRESS', calledAt: new Date(), startedAt: new Date() },
```

- [ ] **Step 5: Set startedAt on IN_PROGRESS transition in callSpecific**

Find the `callSpecific` procedure. Find the same `prisma.queueEntry.update` call with `status: 'IN_PROGRESS'`. Add `startedAt: new Date()`:

```typescript
          data: { status: 'IN_PROGRESS', calledAt: new Date(), startedAt: new Date() },
```

- [ ] **Step 6: Add service include to getByDoctor**

Find `getByDoctor`. Find the `prisma.queueEntry.findMany` call. Update the `include` to include service:

```typescript
          include: {
            patient: { select: PATIENT_SELECT },
            service: { select: { id: true, name: true, durationMinutes: true } },
          },
```

Apply this change to BOTH the `findMany` call inside the `where` block (there is one `findMany` in `getByDoctor`).

- [ ] **Step 7: Restart and verify**

```bash
docker restart eque-backend && sleep 8
docker logs eque-backend --tail 10
```

Expected: no errors in logs. The `add` procedure now requires `serviceId`.

- [ ] **Step 8: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/backend/src/modules/queue/queue.router.ts
git commit -m "feat(queue): serviceId обязателен при добавлении в очередь, startedAt при IN_PROGRESS, service в getByDoctor"
git push
```

---

### Task 4: Frontend ServicesTab + ServiceDialog

**Files:**
- Create: `apps/frontend/src/components/admin/ServicesTab.tsx`
- Create: `apps/frontend/src/components/admin/ServiceDialog.tsx`

- [ ] **Step 1: Create ServiceDialog**

Create `apps/frontend/src/components/admin/ServiceDialog.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CATEGORY_OPTIONS = [
  { value: 'PAID_ONCE',     label: 'Платный (разово)' },
  { value: 'PAID_CONTRACT', label: 'По договору' },
  { value: 'OSMS',          label: 'ОМС' },
  { value: 'CONTINGENT',    label: 'Контингент' },
  { value: 'EMPLOYEE',      label: 'Сотрудник' },
];

interface ServiceRecord {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  paymentCategory: string;
  isActive: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  service?: ServiceRecord | null;
}

export function ServiceDialog({ open, onClose, service }: Props) {
  const isEdit = !!service;

  const [name, setName]           = useState('');
  const [description, setDesc]    = useState('');
  const [duration, setDuration]   = useState('30');
  const [category, setCategory]   = useState('OSMS');

  useEffect(() => {
    if (open) {
      setName(service?.name ?? '');
      setDesc(service?.description ?? '');
      setDuration(String(service?.durationMinutes ?? 30));
      setCategory(service?.paymentCategory ?? 'OSMS');
    }
  }, [open, service]);

  const utils = trpc.useUtils();

  const create = trpc.services.create.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга создана');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = trpc.services.update.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга обновлена');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Название обязательно'); return; }
    const durationMinutes = parseInt(duration, 10);
    if (isNaN(durationMinutes) || durationMinutes < 1) {
      toast.error('Длительность должна быть >= 1 мин'); return;
    }
    if (isEdit) {
      update.mutate({
        id: service!.id,
        name: name.trim(),
        description: description.trim() || undefined,
        durationMinutes,
        paymentCategory: category as any,
      });
    } else {
      create.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        durationMinutes,
        paymentCategory: category as any,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать услугу' : 'Новая услуга'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Название *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Консультация терапевта"
            />
          </div>

          <div className="space-y-1">
            <Label>Описание</Label>
            <Input
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Необязательно"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Длительность (мин) *</Label>
              <Input
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Категория оплаты *</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-sm px-2 py-1.5 rounded border border-border bg-white outline-none h-9"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create ServicesTab**

Create `apps/frontend/src/components/admin/ServicesTab.tsx`:

```typescript
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ServiceDialog } from './ServiceDialog';

const CATEGORY_LABEL: Record<string, string> = {
  PAID_ONCE:     'Платный (разово)',
  PAID_CONTRACT: 'По договору',
  OSMS:          'ОМС',
  CONTINGENT:    'Контингент',
  EMPLOYEE:      'Сотрудник',
};

export function ServicesTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState<any>(null);

  const { data: services = [], isLoading } = trpc.services.getAll.useQuery(
    { includeInactive: true },
  );
  const utils = trpc.useUtils();

  const deactivate = trpc.services.update.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга деактивирована');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteService = trpc.services.delete.useMutation({
    onSuccess: () => {
      utils.services.getAll.invalidate();
      toast.success('Услуга удалена');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit   = (s: any) => { setEditing(s); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>Добавить услугу</Button>
      </div>

      {(services as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет услуг</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Длительность</th>
                <th className="text-left px-4 py-2 font-medium">Категория оплаты</th>
                <th className="text-left px-4 py-2 font-medium">Статус</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(services as any[]).map((s: any) => (
                <tr
                  key={s.id}
                  className={`hover:bg-muted/50 ${!s.isActive ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-2 font-medium">
                    {s.name}
                    {s.description && (
                      <div className="text-xs text-muted-foreground font-normal">{s.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{s.durationMinutes} мин</td>
                  <td className="px-4 py-2">{CATEGORY_LABEL[s.paymentCategory] ?? s.paymentCategory}</td>
                  <td className="px-4 py-2">
                    {s.isActive
                      ? <span className="text-xs text-emerald-600 font-medium">Активна</span>
                      : <span className="text-xs text-muted-foreground">Неактивна</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                        Изменить
                      </Button>
                      {s.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deactivate.isPending}
                          onClick={() => deactivate.mutate({ id: s.id, isActive: false })}
                        >
                          Деакт.
                        </Button>
                      )}
                      {!s.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deleteService.isPending}
                          onClick={() => {
                            if (confirm(`Удалить услугу "${s.name}"?`)) {
                              deleteService.mutate({ id: s.id });
                            }
                          }}
                        >
                          Удалить
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ServiceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        service={editing}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/frontend/src/components/admin/ServicesTab.tsx \
        apps/frontend/src/components/admin/ServiceDialog.tsx
git commit -m "feat(services): ServicesTab + ServiceDialog — CRUD для услуг"
git push
```

---

### Task 5: AdminPanel "Услуги" tab + UserDialog doctor services

**Files:**
- Modify: `apps/frontend/src/components/AdminPanel.tsx`
- Modify: `apps/frontend/src/components/admin/UserDialog.tsx`

- [ ] **Step 1: Add ServicesTab to AdminPanel**

In `apps/frontend/src/components/AdminPanel.tsx`:

Add the import after existing imports:
```typescript
import { ServicesTab } from './admin/ServicesTab';
```

In `TabsList`, add after the `departments` trigger (both triggers are inside `{isAdmin && ...}`):
```tsx
          {(isAdmin || user?.role === 'DEPARTMENT_HEAD') && (
            <TabsTrigger value="services">Услуги</TabsTrigger>
          )}
```

Add the tab content after the departments content block:
```tsx
        {(isAdmin || user?.role === 'DEPARTMENT_HEAD') && (
          <TabsContent value="services" className="pt-4">
            <ServicesTab />
          </TabsContent>
        )}
```

- [ ] **Step 2: Add doctor-services section to UserDialog**

In `apps/frontend/src/components/admin/UserDialog.tsx`, add new state for the doctor services section and the section itself. This section only appears when `role === 'DOCTOR'` (create) or `editUser?.role === 'DOCTOR'` (edit).

Add these hooks at the top of `UserDialog` component (after existing hooks):

```typescript
  const { data: allServices = [] } = trpc.services.getAll.useQuery(
    undefined,
    { enabled: open && (role === 'DOCTOR' || editUser?.role === 'DOCTOR') },
  );

  const { data: doctorServices = [], refetch: refetchDoctorServices } =
    trpc.services.getForDoctor.useQuery(
      { doctorId: editUser?.id ?? '' },
      { enabled: open && !!editUser?.id && editUser?.role === 'DOCTOR' },
    );

  const [addServiceId, setAddServiceId] = useState('');

  const assignService = trpc.services.assignToDoctor.useMutation({
    onSuccess: () => {
      refetchDoctorServices();
      setAddServiceId('');
      toast.success('Услуга добавлена врачу');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeService = trpc.services.removeFromDoctor.useMutation({
    onSuccess: () => {
      refetchDoctorServices();
      toast.success('Услуга удалена у врача');
    },
    onError: (e: any) => toast.error(e.message),
  });
```

Add the services section to the JSX, inside the `<div className="space-y-4 py-2">`, after the `acceptedCategories` block:

```tsx
          {(role === 'DOCTOR' || editUser?.role === 'DOCTOR') && editUser?.id && (
            <div className="space-y-2">
              <Label>Услуги врача</Label>
              {(doctorServices as any[]).length === 0 && (
                <p className="text-xs text-muted-foreground">Нет привязанных услуг</p>
              )}
              <div className="space-y-1">
                {(doctorServices as any[]).map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-muted/50">
                    <span>{s.name} <span className="text-xs text-muted-foreground">· {s.durationMinutes} мин</span></span>
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => removeService.mutate({ doctorId: editUser!.id, serviceId: s.id })}
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <select
                  value={addServiceId}
                  onChange={(e) => setAddServiceId(e.target.value)}
                  className="flex-1 text-sm px-2 py-1.5 rounded border border-border bg-white outline-none"
                >
                  <option value="">— добавить услугу —</option>
                  {(allServices as any[])
                    .filter((s: any) => !(doctorServices as any[]).some((ds: any) => ds.id === s.id))
                    .map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!addServiceId || assignService.isPending}
                  onClick={() => {
                    if (addServiceId) assignService.mutate({ doctorId: editUser!.id, serviceId: addServiceId });
                  }}
                >
                  Добавить
                </Button>
              </div>
            </div>
          )}
```

- [ ] **Step 3: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/frontend/src/components/AdminPanel.tsx \
        apps/frontend/src/components/admin/UserDialog.tsx
git commit -m "feat(services): вкладка Услуги в AdminPanel, привязка услуг в UserDialog"
git push
```

---

### Task 6: AddToQueueForm — service selector

**Files:**
- Modify: `apps/frontend/src/components/registrar/AddToQueueForm.tsx`

- [ ] **Step 1: Add serviceId state and service query**

In `AddToQueueForm.tsx`, add `serviceId` state after the existing state declarations:

```typescript
  const [serviceId, setServiceId] = useState('');
```

Add the services query (after the `assignments` query):

```typescript
  const { data: availableServices = [] } = trpc.services.getForDoctor.useQuery(
    { doctorId, paymentCategory: category as any },
    { enabled: !!(doctorId && category) },
  );
```

- [ ] **Step 2: Reset serviceId when doctor or category changes**

Update the `onValueChange` handlers for doctor and category selects to also reset `serviceId`:

For doctor select, change `onValueChange={setDoctorId}` to:
```typescript
onValueChange={(v) => { setDoctorId(v); setServiceId(''); }}
```

For category select, change `onValueChange={setCategory}` to:
```typescript
onValueChange={(v) => { setCategory(v); setServiceId(''); }}
```

Also reset `serviceId` in `onSuccess` of `addMutation`:
```typescript
      setServiceId('');
```

- [ ] **Step 3: Add service select field to the form**

After the `priority/category` grid block and before the `scheduledAt` block, add the service selector:

```tsx
      {doctorId && category && (
        <div className="space-y-1">
          <Label>Услуга *</Label>
          <Select
            value={serviceId}
            onValueChange={setServiceId}
            disabled={(availableServices as any[]).length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={
                (availableServices as any[]).length === 0
                  ? 'Нет услуг для данной категории'
                  : 'Выберите услугу...'
              } />
            </SelectTrigger>
            <SelectContent>
              {(availableServices as any[]).map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {s.durationMinutes} мин
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
```

- [ ] **Step 4: Make serviceId required in canSubmit**

Update the `canSubmit` line to include `serviceId`:

```typescript
  const canSubmit = patient && doctorId && priority && category && serviceId && !addMutation.isPending;
```

- [ ] **Step 5: Pass serviceId to queue.add mutation**

In `addMutation.mutate({...})`, add `serviceId`:

```typescript
          addMutation.mutate({
            doctorId,
            patientId: patient!.id,
            priority:  priority as any,
            category:  category as any,
            serviceId,                                          // ← ADD THIS
            source:    source as any,
            scheduledAt: priority === 'SCHEDULED' && scheduledAt
              ? new Date(scheduledAt).toISOString()
              : undefined,
            notes: notes || undefined,
          })
```

- [ ] **Step 6: Verify frontend builds**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new type errors.

- [ ] **Step 7: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/frontend/src/components/registrar/AddToQueueForm.tsx
git commit -m "feat(queue): выбор услуги обязателен при добавлении в очередь"
git push
```

---

### Task 7: Doctor view — service name + elapsed timer

**Files:**
- Modify: `apps/frontend/src/components/doctor/CurrentPatientCard.tsx`
- Modify: `apps/frontend/src/components/doctor/DoctorQueueList.tsx`

- [ ] **Step 1: Add useElapsedMinutes hook to CurrentPatientCard**

In `apps/frontend/src/components/doctor/CurrentPatientCard.tsx`, add imports and the hook:

```typescript
import { useEffect, useState } from 'react';
```

Add the hook function before the `CurrentPatientCard` component:

```typescript
function useElapsedMinutes(startedAt: string | null | undefined): number {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000) : 0,
  );

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
    }, 30_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}
```

- [ ] **Step 2: Update QueueEntry interface in CurrentPatientCard**

Update the `QueueEntry` interface to include service and startedAt:

```typescript
interface QueueEntry {
  id: string;
  queueNumber: number;
  priority: string;
  category?: string | null;
  startedAt?: string | null;
  service?: { id: string; name: string; durationMinutes: number } | null;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}
```

- [ ] **Step 3: Add timer and service name to CurrentPatientCard JSX**

Inside `CurrentPatientCard`, after the `const categoryLabel` line, add:

```typescript
  const elapsed        = useElapsedMinutes(entry.startedAt);
  const duration       = entry.service?.durationMinutes ?? 0;
  const pct            = duration > 0 ? elapsed / duration : 0;
  const timerColor     = pct < 0.8 ? '#86efac' : pct <= 1.0 ? '#fde68a' : '#fca5a5';
```

In the JSX, after the `categoryLabel` span block and before the closing of that flex div, add service name and timer:

```tsx
        {entry.service && (
          <>
            <span className="text-[9px] text-white/30">·</span>
            <span className="text-[9px] text-white/70 font-medium">{entry.service.name}</span>
          </>
        )}
```

After `</div>` of the flex items row (after the category/service line), add the timer block:

```tsx
      {entry.service && entry.startedAt && (
        <div className="flex items-center gap-1.5 mb-2">
          <span
            className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,.25)', color: timerColor }}
          >
            {elapsed} / {duration} мин
          </span>
        </div>
      )}
```

- [ ] **Step 4: Add compact timer to DoctorQueueList for IN_PROGRESS rows**

In `apps/frontend/src/components/doctor/DoctorQueueList.tsx`, add `useEffect` and `useState` to the imports:

```typescript
import { useEffect, useState } from 'react';
```

Add the same `useElapsedMinutes` hook function before the `DoctorQueueList` component:

```typescript
function useElapsedMinutes(startedAt: string | null | undefined): number {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000) : 0,
  );
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
    }, 30_000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}
```

Update the `QueueEntry` interface in `DoctorQueueList.tsx` to include `startedAt` and `service`:

```typescript
interface QueueEntry {
  id: string;
  queueNumber: number;
  status: string;
  priority: string;
  paymentConfirmed: boolean;
  scheduledAt?: string | null;
  waitMinutes?: number;
  startedAt?: string | null;
  service?: { id: string; name: string; durationMinutes: number } | null;
  patient: { firstName: string; lastName: string; middleName?: string | null };
}
```

Since `useElapsedMinutes` is a hook and hooks can't be called inside `renderEntry` (which is a regular function, not a component), extract an inline `EntryTimer` sub-component just above `renderEntry`:

```typescript
  function EntryTimer({ startedAt, duration }: { startedAt: string | null | undefined; duration: number }) {
    const elapsed = useElapsedMinutes(startedAt);
    const pct = duration > 0 ? elapsed / duration : 0;
    const color = pct < 0.8 ? 'text-emerald-600' : pct <= 1.0 ? 'text-yellow-600' : 'text-red-600';
    return (
      <span className={`text-[8px] font-bold tabular-nums ${color}`}>
        {elapsed}/{duration}м
      </span>
    );
  }
```

In `renderEntry`, inside the `<div className="flex flex-col items-end gap-1 shrink-0">` block, after the `waitMinutes` span, add:

```tsx
          {entry.status === 'IN_PROGRESS' && entry.service && (
            <EntryTimer startedAt={entry.startedAt} duration={entry.service.durationMinutes} />
          )}
```

- [ ] **Step 5: Verify frontend builds**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
cd /home/administrator/projects_danik
git add apps/frontend/src/components/doctor/CurrentPatientCard.tsx \
        apps/frontend/src/components/doctor/DoctorQueueList.tsx
git commit -m "feat(doctor): название услуги и таймер приёма в карточке пациента"
git push
```
