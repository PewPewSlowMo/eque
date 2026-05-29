# Services Refactor: ServiceCategory Join Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Service.paymentCategory` (one category per service) with a `ServiceCategory` join table (many categories per service), merge duplicate services by name, and build a unified one-window admin UI.

**Architecture:** Prisma schema change + manual data-migration SQL (merge duplicates, reassign FK refs, drop old column) + backend router update (categories array in/out, new `setDoctors` mutation) + full rewrite of ServiceDialog with category checkboxes and doctor multi-select grouped by department.

**Tech Stack:** Prisma, PostgreSQL, NestJS, tRPC, React, Tailwind, shadcn/ui

---

## File Map

| File | Change |
|---|---|
| `apps/backend/prisma/schema.prisma` | Remove `paymentCategory` from `Service`; add `ServiceCategory` model |
| `apps/backend/prisma/migrations/<ts>_service_categories/migration.sql` | DDL + data migration SQL |
| `apps/backend/src/modules/services/services.router.ts` | Update all procedures; add `setDoctors` |
| `apps/frontend/src/components/admin/ServiceDialog.tsx` | Full rewrite: categories checkboxes + doctors by dept |
| `apps/frontend/src/components/admin/ServicesTab.tsx` | Show `categories[]` pills; remove `paymentCategory` column |
| `apps/frontend/src/components/registrar/AddToQueueForm.tsx` | `paymentCategory` → `category` in `getForDoctor` call |
| `apps/frontend/src/components/RegistrarView.tsx` | `paymentCategory` → `category` in `getForDoctor` call |

---

## Task 1: Update Prisma Schema

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Edit schema — remove `paymentCategory`, add `ServiceCategory`**

Replace the `Service` model and add `ServiceCategory` in `schema.prisma`:

```prisma
model Service {
  id              String            @id @default(cuid())
  name            String
  description     String?
  durationMinutes Int
  isActive        Boolean           @default(true)

  categories   ServiceCategory[]
  doctors      DoctorService[]
  queueEntries QueueEntry[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("services")
}

model ServiceCategory {
  id        String          @id @default(cuid())
  serviceId String
  category  PatientCategory

  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([serviceId, category])
  @@map("service_categories")
}
```

`DoctorService` model stays unchanged.

- [ ] **Step 2: Create migration with data migration SQL (create-only, don't run yet)**

```bash
cd apps/backend
pnpm prisma migrate dev --create-only --name service_categories
```

Expected: creates `prisma/migrations/<timestamp>_service_categories/migration.sql` with auto-generated DDL. Open it — it will contain `ALTER TABLE "services" DROP COLUMN "paymentCategory"` and `CREATE TABLE "service_categories"`. We need to insert data migration steps BEFORE the DROP COLUMN.

- [ ] **Step 3: Edit the generated migration.sql to add data migration**

Open the generated file and replace its contents entirely with the following (which includes DDL + data migration in correct order):

```sql
-- Step 1: Create service_categories table
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "category" "PatientCategory" NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_categories_serviceId_category_key"
    ON "service_categories"("serviceId", "category");

ALTER TABLE "service_categories"
    ADD CONSTRAINT "service_categories_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 2: Migrate existing paymentCategory → service_categories rows
-- (one row per existing service, using its current paymentCategory)
INSERT INTO "service_categories" ("id", "serviceId", "category")
SELECT gen_random_uuid()::text, "id", "paymentCategory"
FROM "services";

-- Step 3: Merge duplicate services (same name → keep max durationMinutes)
-- For each name group: pick the "winner" (max duration, then min createdAt to break ties),
-- collect all categories from all duplicates into winner, reassign FKs, delete losers.

DO $$
DECLARE
  grp RECORD;
  winner_id TEXT;
  loser RECORD;
BEGIN
  -- Iterate over names that have duplicates
  FOR grp IN
    SELECT name FROM "services" GROUP BY name HAVING COUNT(*) > 1
  LOOP
    -- Pick winner: max durationMinutes; on tie pick oldest (min createdAt)
    SELECT id INTO winner_id
    FROM "services"
    WHERE name = grp.name
    ORDER BY "durationMinutes" DESC, "createdAt" ASC
    LIMIT 1;

    -- Update winner's durationMinutes to the max (already is, but explicit)
    UPDATE "services"
    SET "durationMinutes" = (
      SELECT MAX("durationMinutes") FROM "services" WHERE name = grp.name
    )
    WHERE id = winner_id;

    -- For each loser in the group
    FOR loser IN
      SELECT id FROM "services"
      WHERE name = grp.name AND id <> winner_id
    LOOP
      -- Copy loser's categories to winner (ignore duplicates via ON CONFLICT)
      INSERT INTO "service_categories" ("id", "serviceId", "category")
      SELECT gen_random_uuid()::text, winner_id, sc.category
      FROM "service_categories" sc
      WHERE sc."serviceId" = loser.id
      ON CONFLICT ("serviceId", "category") DO NOTHING;

      -- Reassign DoctorService rows
      INSERT INTO "doctor_services" ("doctorId", "serviceId")
      SELECT ds."doctorId", winner_id
      FROM "doctor_services" ds
      WHERE ds."serviceId" = loser.id
      ON CONFLICT DO NOTHING;

      DELETE FROM "doctor_services" WHERE "serviceId" = loser.id;

      -- Reassign QueueEntry rows
      UPDATE "queue_entries"
      SET "serviceId" = winner_id
      WHERE "serviceId" = loser.id;

      -- Delete loser's categories then the loser itself
      DELETE FROM "service_categories" WHERE "serviceId" = loser.id;
      DELETE FROM "services" WHERE id = loser.id;
    END LOOP;
  END LOOP;
END $$;

-- Step 4: Drop old paymentCategory column
ALTER TABLE "services" DROP COLUMN "paymentCategory";
```

- [ ] **Step 4: Run the migration**

```bash
cd apps/backend
pnpm prisma migrate dev
```

Expected output: `The following migration(s) have been applied: ..._service_categories` with no errors. If there's an error, read it carefully — most likely a constraint issue in the DO block.

- [ ] **Step 5: Regenerate Prisma client**

```bash
cd apps/backend
pnpm prisma generate
```

Expected: `Generated Prisma Client` success message.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(db): заменить paymentCategory на join-таблицу ServiceCategory, смержить дубли"
```

---

## Task 2: Update Backend Router

**Files:**
- Modify: `apps/backend/src/modules/services/services.router.ts`

- [ ] **Step 1: Rewrite the router**

Replace the entire file content:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { PatientCategory, UserRole } from '@prisma/client';

const ALLOWED_ROLES: UserRole[] = ['ADMIN', 'DEPARTMENT_HEAD'];

const PatientCategoryEnum = z.nativeEnum(PatientCategory);

const CATEGORIES_INCLUDE = {
  categories: { select: { category: true } },
} as const;

export const createServicesRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({

    getAll: trpc.protectedProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: input?.includeInactive ? {} : { isActive: true },
          include: CATEGORIES_INCLUDE,
          orderBy: { name: 'asc' },
        });
      }),

    create: trpc.protectedProcedure
      .input(z.object({
        name:            z.string().min(1),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1),
        categories:      z.array(PatientCategoryEnum).min(1),
        doctorIds:       z.array(z.string()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { categories, doctorIds, ...serviceData } = input;
        return prisma.$transaction(async (tx) => {
          const service = await tx.service.create({
            data: {
              ...serviceData,
              categories: {
                create: categories.map((category) => ({ category })),
              },
            },
            include: CATEGORIES_INCLUDE,
          });
          if (doctorIds && doctorIds.length > 0) {
            await tx.doctorService.createMany({
              data: doctorIds.map((doctorId) => ({ doctorId, serviceId: service.id })),
              skipDuplicates: true,
            });
          }
          return service;
        });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id:              z.string(),
        name:            z.string().min(1).optional(),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1).optional(),
        categories:      z.array(PatientCategoryEnum).min(1).optional(),
        isActive:        z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { id, categories, ...serviceData } = input;
        return prisma.$transaction(async (tx) => {
          if (categories) {
            await tx.serviceCategory.deleteMany({ where: { serviceId: id } });
            await tx.serviceCategory.createMany({
              data: categories.map((category) => ({ serviceId: id, category })),
            });
          }
          return tx.service.update({
            where: { id },
            data: serviceData,
            include: CATEGORIES_INCLUDE,
          });
        });
      }),

    // Atomically replace all doctor assignments for a service
    setDoctors: trpc.protectedProcedure
      .input(z.object({
        serviceId: z.string(),
        doctorIds: z.array(z.string()),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        return prisma.$transaction(async (tx) => {
          await tx.doctorService.deleteMany({ where: { serviceId: input.serviceId } });
          if (input.doctorIds.length > 0) {
            await tx.doctorService.createMany({
              data: input.doctorIds.map((doctorId) => ({ doctorId, serviceId: input.serviceId })),
              skipDuplicates: true,
            });
          }
          return { ok: true };
        });
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
        doctorId: z.string(),
        category: PatientCategoryEnum.optional(),
      }))
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: {
            isActive: true,
            doctors: { some: { doctorId: input.doctorId } },
            ...(input.category
              ? { categories: { some: { category: input.category } } }
              : {}),
          },
          include: CATEGORIES_INCLUDE,
          orderBy: { name: 'asc' },
        });
      }),

    // Returns doctor IDs assigned to a service (for the edit dialog)
    getDoctorIds: trpc.protectedProcedure
      .input(z.object({ serviceId: z.string() }))
      .query(async ({ input }) => {
        const rows = await prisma.doctorService.findMany({
          where: { serviceId: input.serviceId },
          select: { doctorId: true },
        });
        return rows.map((r) => r.doctorId);
      }),

  });
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend
pnpm tsc --noEmit
```

Expected: no errors. If `ServiceCategory` is not found, re-run `pnpm prisma generate`.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/services/services.router.ts
git commit -m "feat(services): categories[] join table, setDoctors mutation, getForDoctor by category"
```

---

## Task 3: Update Frontend — RegistrarView and AddToQueueForm

**Files:**
- Modify: `apps/frontend/src/components/RegistrarView.tsx`
- Modify: `apps/frontend/src/components/registrar/AddToQueueForm.tsx`

The `getForDoctor` input changed: `paymentCategory` → `category`.

- [ ] **Step 1: Fix RegistrarView.tsx**

Find this block (around line 113–115):

```typescript
const { data: servicesData = [] } = trpc.services.getForDoctor.useQuery({
  doctorId: doctor.id,
  paymentCategory: category as any,
```

Replace with:

```typescript
const { data: servicesData = [] } = trpc.services.getForDoctor.useQuery({
  doctorId: doctor.id,
  category: category as any,
```

- [ ] **Step 2: Fix AddToQueueForm.tsx**

Find this block (around line 42–43):

```typescript
const { data: availableServices = [] } = trpc.services.getForDoctor.useQuery(
  { doctorId, paymentCategory: category as any },
```

Replace with:

```typescript
const { data: availableServices = [] } = trpc.services.getForDoctor.useQuery(
  { doctorId, category: category as any },
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/frontend
pnpm tsc --noEmit
```

Expected: no type errors for these files (there may still be errors from ServiceDialog.tsx — that's Task 4).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/RegistrarView.tsx \
        apps/frontend/src/components/registrar/AddToQueueForm.tsx
git commit -m "fix(registrar): getForDoctor — paymentCategory → category"
```

---

## Task 4: Rewrite ServiceDialog

**Files:**
- Modify: `apps/frontend/src/components/admin/ServiceDialog.tsx`

New dialog: two sections — (1) name/duration/description + category checkboxes, (2) doctors grouped by department with checkboxes. One Save button saves all atomically.

- [ ] **Step 1: Rewrite ServiceDialog.tsx**

Replace the entire file:

```tsx
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
  { value: 'OSMS',          label: 'ОСМС' },
  { value: 'CONTINGENT',    label: 'Контингент' },
  { value: 'EMPLOYEE',      label: 'Сотрудник' },
];

interface ServiceRecord {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  isActive: boolean;
  categories: { category: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  service?: ServiceRecord | null;
}

export function ServiceDialog({ open, onClose, service }: Props) {
  const isEdit = !!service;

  const [name, setName]               = useState('');
  const [description, setDesc]        = useState('');
  const [duration, setDuration]       = useState('30');
  const [categories, setCategories]   = useState<Set<string>>(new Set(['OSMS']));
  const [doctorIds, setDoctorIds]     = useState<Set<string>>(new Set());

  const { data: allDoctors = [] } = trpc.users.getDoctors.useQuery(undefined, { enabled: open });
  const { data: assignedIds = [] } = trpc.services.getDoctorIds.useQuery(
    { serviceId: service?.id ?? '' },
    { enabled: isEdit && open && !!service?.id },
  );

  useEffect(() => {
    if (!open) return;
    setName(service?.name ?? '');
    setDesc(service?.description ?? '');
    setDuration(String(service?.durationMinutes ?? 30));
    setCategories(new Set((service?.categories ?? []).map((c) => c.category)));
    setDoctorIds(new Set(assignedIds as string[]));
  }, [open, service, assignedIds]);

  const utils = trpc.useUtils();

  const create = trpc.services.create.useMutation({
    onSuccess: async (created: any) => {
      await setDoctors.mutateAsync({ serviceId: created.id, doctorIds: [...doctorIds] });
      utils.services.getAll.invalidate();
      toast.success('Услуга создана');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = trpc.services.update.useMutation({
    onSuccess: async () => {
      await setDoctors.mutateAsync({ serviceId: service!.id, doctorIds: [...doctorIds] });
      utils.services.getAll.invalidate();
      toast.success('Услуга обновлена');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setDoctors = trpc.services.setDoctors.useMutation({
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending || setDoctors.isPending;

  const toggleCategory = (val: string) => {
    setCategories((prev) => {
      const next = new Set(prev);
      next.has(val) ? next.delete(val) : next.add(val);
      return next;
    });
  };

  const toggleDoctor = (id: string) => {
    setDoctorIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Название обязательно'); return; }
    const durationMinutes = parseInt(duration, 10);
    if (isNaN(durationMinutes) || durationMinutes < 1) {
      toast.error('Длительность должна быть >= 1 мин'); return;
    }
    if (categories.size === 0) { toast.error('Выберите хотя бы одну категорию'); return; }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      durationMinutes,
      categories: [...categories] as any[],
    };

    if (isEdit) {
      update.mutate({ id: service!.id, ...payload });
    } else {
      create.mutate({ ...payload, doctorIds: [...doctorIds] });
    }
  };

  // Group doctors by department
  const doctors = allDoctors as any[];
  const deptMap = new Map<string, { name: string; doctors: any[] }>();
  const noDept: any[] = [];
  for (const d of doctors) {
    if (d.department) {
      if (!deptMap.has(d.department.id)) {
        deptMap.set(d.department.id, { name: d.department.name, doctors: [] });
      }
      deptMap.get(d.department.id)!.doctors.push(d);
    } else {
      noDept.push(d);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать услугу' : 'Новая услуга'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label>Название *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Консультация терапевта"
              />
            </div>
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
              <Label>Описание</Label>
              <Input
                value={description}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label>Категории пациентов *</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer select-none transition-colors ${
                    categories.has(opt.value)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={categories.has(opt.value)}
                    onChange={() => toggleCategory(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Doctors */}
          <div className="space-y-2">
            <Label>Врачи</Label>
            <div className="border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
              {[...deptMap.entries()].map(([deptId, dept]) => (
                <div key={deptId}>
                  <div className="px-3 py-1.5 bg-muted text-xs font-semibold text-muted-foreground sticky top-0">
                    {dept.name}
                  </div>
                  {dept.doctors.map((d: any) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={doctorIds.has(d.id)}
                        onChange={() => toggleDoctor(d.id)}
                      />
                      {d.lastName} {d.firstName} {d.middleName ?? ''}
                      {d.specialty ? <span className="text-xs text-muted-foreground ml-1">· {d.specialty}</span> : null}
                    </label>
                  ))}
                </div>
              ))}
              {noDept.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 bg-muted text-xs font-semibold text-muted-foreground">
                    Без отделения
                  </div>
                  {noDept.map((d: any) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={doctorIds.has(d.id)}
                        onChange={() => toggleDoctor(d.id)}
                      />
                      {d.lastName} {d.firstName} {d.middleName ?? ''}
                    </label>
                  ))}
                </div>
              )}
              {doctors.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">Нет врачей</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/frontend
pnpm tsc --noEmit
```

Expected: no errors related to `ServiceDialog.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/admin/ServiceDialog.tsx
git commit -m "feat(admin): новый ServiceDialog — категории чекбоксами, врачи по отделениям"
```

---

## Task 5: Update ServicesTab

**Files:**
- Modify: `apps/frontend/src/components/admin/ServicesTab.tsx`

Replace the single "Категория оплаты" column with "Категории" showing pills.

- [ ] **Step 1: Update ServicesTab.tsx**

Replace the entire file:

```tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ServiceDialog } from './ServiceDialog';

const CATEGORY_LABEL: Record<string, string> = {
  PAID_ONCE:     'Платный',
  PAID_CONTRACT: 'Договор',
  OSMS:          'ОСМС',
  CONTINGENT:    'Контингент',
  EMPLOYEE:      'Сотрудник',
};

const CATEGORY_CLS: Record<string, string> = {
  PAID_ONCE:     'bg-blue-50 text-blue-700',
  PAID_CONTRACT: 'bg-indigo-50 text-indigo-700',
  OSMS:          'bg-teal-50 text-teal-700',
  CONTINGENT:    'bg-purple-50 text-purple-700',
  EMPLOYEE:      'bg-slate-100 text-slate-600',
};

export function ServicesTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState<any>(null);
  const [showInactive, setShowInactive] = useState(false);

  const { data: services = [], isLoading } = trpc.services.getAll.useQuery(
    { includeInactive: true },
  );
  const utils = trpc.useUtils();

  const deactivate = trpc.services.update.useMutation({
    onSuccess: () => { utils.services.getAll.invalidate(); toast.success('Услуга деактивирована'); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteService = trpc.services.delete.useMutation({
    onSuccess: () => { utils.services.getAll.invalidate(); toast.success('Услуга удалена'); },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit   = (s: any) => { setEditing(s); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  const visibleServices = (services as any[]).filter(
    (s: any) => showInactive || s.isActive !== false,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Показать деактивированные
        </label>
        <Button onClick={openCreate}>Добавить услугу</Button>
      </div>

      {visibleServices.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет услуг</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Длит.</th>
                <th className="text-left px-4 py-2 font-medium">Категории</th>
                <th className="text-left px-4 py-2 font-medium">Статус</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleServices.map((s: any) => (
                <tr key={s.id} className={`hover:bg-muted/50 ${!s.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2 font-medium">
                    {s.name}
                    {s.description && (
                      <div className="text-xs text-muted-foreground font-normal">{s.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{s.durationMinutes} мин</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(s.categories as { category: string }[]).map(({ category }) => (
                        <span
                          key={category}
                          className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_CLS[category] ?? 'bg-slate-100 text-slate-600'}`}
                        >
                          {CATEGORY_LABEL[category] ?? category}
                        </span>
                      ))}
                    </div>
                  </td>
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

- [ ] **Step 2: Verify TypeScript + build**

```bash
cd apps/frontend
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/admin/ServicesTab.tsx
git commit -m "feat(admin): ServicesTab — показывать категории плашками вместо одного поля"
```

---

## Task 6: Final verification

- [ ] **Step 1: Start dev servers and smoke-test**

```bash
cd /home/administrator/projects_danik
pnpm dev
```

Check in browser:
1. Открыть Admin → Услуги — список загружается, у каждой услуги видны плашки категорий
2. Нажать "Добавить услугу" — открывается диалог с чекбоксами категорий и списком врачей по отделениям
3. Создать услугу с 2 категориями и 2 врачами → появляется в списке
4. Нажать "Изменить" → категории и врачи загружаются корректно, можно изменить
5. В регистратуре → запись пациента → выбор врача → список услуг фильтруется по категории пациента

- [ ] **Step 2: Final commit if any small fixes were needed**

```bash
git add -A
git commit -m "fix(services): правки после smoke-test"
git push
```
