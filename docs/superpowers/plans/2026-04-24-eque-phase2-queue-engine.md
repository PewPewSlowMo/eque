# СЭО Phase 2: Queue Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать backend-движок очереди: 4 новых tRPC-роутера (shifts, settings, assignments, queue) с WebSocket-событиями через EventsGateway.

**Architecture:** Каждый роутер — отдельный файл-фабрика `create*Router(trpc, prisma, events?)`. Все роутеры подключаются в `trpc.router.ts`. Приоритет вызова пациентов: EMERGENCY(1) → INPATIENT(2) → SCHEDULED(3) → WALK_IN(4); внутри приоритета — FIFO по `arrivedAt`. Каждое изменение статуса записывает строку в `QueueHistory` и бросает событие через `EventsGateway.emit()`.

**Tech Stack:** NestJS, tRPC v11, Prisma 5, PostgreSQL, Socket.io, Zod

---

## Файловая структура

```
apps/backend/src/modules/
  shifts/
    shifts.router.ts          # CRUD шаблонов смен
  settings/
    settings.router.ts        # Чтение и обновление CategorySettings
  assignments/
    assignments.router.ts     # Назначить врача в кабинет / снять назначение
  queue/
    queue.router.ts           # Добавить в очередь, подтвердить приход, вызвать следующего, завершить, отменить
apps/backend/src/trpc/
  trpc.router.ts              # MODIFY: добавить 4 новых роутера
```

> **Паттерн Prisma `as any`**: В проекте уже принято — при создании/обновлении Prisma-записей с опциональными scalar-полями (типа `departmentId`) добавлять `as any` к объекту `data`, чтобы обойти конфликт XOR-типов `CreateInput` vs `UncheckedCreateInput`. Пример из `cabinets.router.ts`:
> ```ts
> return prisma.cabinet.create({ data: input as any });
> ```

---

### Task 1: Shifts Router

**Files:**
- Create: `apps/backend/src/modules/shifts/shifts.router.ts`
- Modify: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 1: Создать файл роутера**

```typescript
// apps/backend/src/modules/shifts/shifts.router.ts
import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createShiftsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    list: trpc.protectedProcedure.query(async () => {
      return prisma.shiftTemplate.findMany({ orderBy: { startTime: 'asc' } });
    }),

    create: trpc.protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат: HH:MM'),
          endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат: HH:MM'),
        }),
      )
      .mutation(async ({ input }) => {
        return prisma.shiftTemplate.create({ data: input });
      }),

    update: trpc.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).optional(),
          startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return prisma.shiftTemplate.update({ where: { id }, data });
      }),

    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        return prisma.shiftTemplate.delete({ where: { id: input.id } });
      }),
  });
};
```

- [ ] **Step 2: Добавить в root router**

Открыть `apps/backend/src/trpc/trpc.router.ts`. Добавить импорт после существующих:

```typescript
import { createShiftsRouter } from '../modules/shifts/shifts.router';
```

В объект `appRouter` добавить поле `shifts`:

```typescript
appRouter = this.trpc.router({
  health: this.trpc.procedure.query(() => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })),
  auth: createAuthRouter(this.trpc, this.prisma),
  users: createUsersRouter(this.trpc, this.prisma),
  departments: createDepartmentsRouter(this.trpc, this.prisma),
  cabinets: createCabinetsRouter(this.trpc, this.prisma),
  patients: createPatientsRouter(this.trpc, this.prisma),
  shifts: createShiftsRouter(this.trpc, this.prisma),
  // остальные добавятся в следующих задачах
});
```

- [ ] **Step 3: Проверить компиляцию**

```bash
cd /home/administrator/projects_danik && pnpm --filter backend build 2>&1 | tail -5
```

Ожидаем: последняя строка содержит `Successfully compiled` или `webpack compiled` без `error TS`.

- [ ] **Step 4: Smoke-тест shifts**

```bash
# Получить токен admin
TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123!"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['token'])")

# Список шаблонов смен (из seed: "Утренняя", "Дневная")
curl -s http://localhost:3002/trpc/shifts.list \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('count:', len(d['result']['data']))"
```

Ожидаем: `count: 2`

- [ ] **Step 5: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(shifts): роутер шаблонов смен" && git push
```

---

### Task 2: Settings Router

**Files:**
- Create: `apps/backend/src/modules/settings/settings.router.ts`
- Modify: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 1: Создать файл роутера**

```typescript
// apps/backend/src/modules/settings/settings.router.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const PatientCategoryEnum = z.enum([
  'PAID_ONCE',
  'PAID_CONTRACT',
  'OSMS',
  'CONTINGENT',
  'EMPLOYEE',
]);

export const createSettingsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    // Все настройки категорий (для отображения в AdminPanel)
    getCategorySettings: trpc.protectedProcedure.query(async () => {
      return prisma.categorySettings.findMany({ orderBy: { category: 'asc' } });
    }),

    // Обновить настройку одной категории (только ADMIN)
    updateCategorySettings: trpc.protectedProcedure
      .input(
        z.object({
          category: PatientCategoryEnum,
          requiresArrivalConfirmation: z.boolean(),
          requiresPaymentConfirmation: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user!.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Только для администратора' });
        }
        return prisma.categorySettings.update({
          where: { category: input.category },
          data: {
            requiresArrivalConfirmation: input.requiresArrivalConfirmation,
            requiresPaymentConfirmation: input.requiresPaymentConfirmation,
          },
        });
      }),
  });
};
```

- [ ] **Step 2: Добавить в root router**

Импорт:
```typescript
import { createSettingsRouter } from '../modules/settings/settings.router';
```

Поле в `appRouter`:
```typescript
settings: createSettingsRouter(this.trpc, this.prisma),
```

- [ ] **Step 3: Проверить компиляцию**

```bash
cd /home/administrator/projects_danik && pnpm --filter backend build 2>&1 | tail -5
```

Ожидаем: без `error TS`.

- [ ] **Step 4: Smoke-тест settings**

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123!"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['token'])")

curl -s http://localhost:3002/trpc/settings.getCategorySettings \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(x['category'], x['requiresArrivalConfirmation']) for x in d['result']['data']]"
```

Ожидаем: 5 строк — по одной на категорию.

- [ ] **Step 5: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(settings): роутер настроек категорий пациентов" && git push
```

---

### Task 3: Assignments Router

**Files:**
- Create: `apps/backend/src/modules/assignments/assignments.router.ts`
- Modify: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 1: Создать файл роутера**

```typescript
// apps/backend/src/modules/assignments/assignments.router.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

export const createAssignmentsRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({
    // Все активные назначения (для табло/регистратора/заведующего)
    getActive: trpc.protectedProcedure.query(async () => {
      return prisma.doctorAssignment.findMany({
        where: { isActive: true },
        include: {
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              middleName: true,
              specialty: true,
              departmentId: true,
            },
          },
          cabinet: { select: { id: true, number: true, name: true } },
          shiftTemplate: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
        orderBy: { startTime: 'desc' },
      });
    }),

    // Текущее назначение конкретного врача
    getForDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string() }))
      .query(async ({ input }) => {
        return prisma.doctorAssignment.findFirst({
          where: { doctorId: input.doctorId, isActive: true },
          include: {
            cabinet: { select: { id: true, number: true, name: true } },
            shiftTemplate: { select: { id: true, name: true, startTime: true, endTime: true } },
          },
        });
      }),

    // Назначить врача в кабинет (заведующий или админ)
    // Автоматически закрывает предыдущее активное назначение этого врача.
    assign: trpc.protectedProcedure
      .input(
        z.object({
          doctorId: z.string(),
          cabinetId: z.string(),
          shiftTemplateId: z.string().optional(),
          startTime: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const allowedRoles = ['ADMIN', 'DEPARTMENT_HEAD'];
        if (!allowedRoles.includes(ctx.user!.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет прав на назначение врача' });
        }

        // Завершить предыдущее активное назначение врача
        await prisma.doctorAssignment.updateMany({
          where: { doctorId: input.doctorId, isActive: true },
          data: { isActive: false, endTime: new Date() },
        });

        const assignment = await prisma.doctorAssignment.create({
          data: {
            doctorId: input.doctorId,
            cabinetId: input.cabinetId,
            shiftTemplateId: input.shiftTemplateId ?? null,
            startTime: input.startTime ? new Date(input.startTime) : new Date(),
            isActive: true,
            createdById: ctx.user!.id,
          } as any,
          include: {
            doctor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                specialty: true,
              },
            },
            cabinet: { select: { id: true, number: true, name: true } },
          },
        });

        events.emit('assignment:created', assignment);
        return assignment;
      }),

    // Завершить назначение (врач уходит / конец смены)
    unassign: trpc.protectedProcedure
      .input(z.object({ assignmentId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const allowedRoles = ['ADMIN', 'DEPARTMENT_HEAD', 'DOCTOR'];
        if (!allowedRoles.includes(ctx.user!.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет прав на снятие назначения' });
        }

        const existing = await prisma.doctorAssignment.findUnique({
          where: { id: input.assignmentId },
        });
        if (!existing || !existing.isActive) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Активное назначение не найдено' });
        }

        const assignment = await prisma.doctorAssignment.update({
          where: { id: input.assignmentId },
          data: { isActive: false, endTime: new Date() },
          include: {
            doctor: {
              select: { id: true, firstName: true, lastName: true },
            },
            cabinet: { select: { id: true, number: true, name: true } },
          },
        });

        events.emit('assignment:ended', assignment);
        return assignment;
      }),
  });
};
```

- [ ] **Step 2: Добавить в root router**

Импорт:
```typescript
import { createAssignmentsRouter } from '../modules/assignments/assignments.router';
```

Поле в `appRouter` (обрати внимание: `eventsGateway` уже инжектируется в конструкторе `TrpcRouter`):
```typescript
assignments: createAssignmentsRouter(this.trpc, this.prisma, this.eventsGateway),
```

- [ ] **Step 3: Проверить компиляцию**

```bash
cd /home/administrator/projects_danik && pnpm --filter backend build 2>&1 | tail -5
```

Ожидаем: без `error TS`.

- [ ] **Step 4: Smoke-тест assignments**

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123!"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['token'])")

# Активные назначения (пустой список, пока не назначили)
curl -s http://localhost:3002/trpc/assignments.getActive \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('active assignments:', len(d['result']['data']))"
```

Ожидаем: `active assignments: 0`

- [ ] **Step 5: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(assignments): роутер назначений врача в кабинет" && git push
```

---

### Task 4: Queue Router

**Files:**
- Create: `apps/backend/src/modules/queue/queue.router.ts`
- Modify: `apps/backend/src/trpc/trpc.router.ts`

Ключевая логика:
- `EMERGENCY` → `status = ARRIVED` сразу (без ожидания прихода), вызывается первым
- Остальные приоритеты → `status = WAITING_ARRIVAL` если категория требует подтверждения прихода, иначе сразу `ARRIVED`
- `paymentConfirmed = false` если категория требует оплаты (PAID_ONCE), иначе `true`
- `callNext` вызывает следующего только из `ARRIVED` + `paymentConfirmed = true`

- [ ] **Step 1: Создать файл роутера**

```typescript
// apps/backend/src/modules/queue/queue.router.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

// Числовой порядок приоритетов для сортировки
const PRIORITY_ORDER: Record<string, number> = {
  EMERGENCY: 1,
  INPATIENT: 2,
  SCHEDULED: 3,
  WALK_IN: 4,
};

// Следующий порядковый номер в очереди к врачу на сегодня
async function getNextQueueNumber(prisma: PrismaService, doctorId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const last = await prisma.queueEntry.findFirst({
    where: { doctorId, createdAt: { gte: todayStart, lt: todayEnd } },
    orderBy: { queueNumber: 'desc' },
    select: { queueNumber: true },
  });
  return (last?.queueNumber ?? 0) + 1;
}

const QueuePriorityEnum = z.enum(['EMERGENCY', 'INPATIENT', 'SCHEDULED', 'WALK_IN']);
const PatientCategoryEnum = z.enum([
  'PAID_ONCE',
  'PAID_CONTRACT',
  'OSMS',
  'CONTINGENT',
  'EMPLOYEE',
]);

export const createQueueRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({
    // Текущая очередь к врачу (все активные статусы)
    getByDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string() }))
      .query(async ({ input }) => {
        const entries = await prisma.queueEntry.findMany({
          where: {
            doctorId: input.doctorId,
            status: { in: ['WAITING_ARRIVAL', 'ARRIVED', 'CALLED', 'IN_PROGRESS'] },
          },
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                phone: true,
              },
            },
          },
        });

        // Сортировка: приоритет ASC → arrivedAt ASC (FIFO внутри приоритета)
        return entries.sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 99;
          const pb = PRIORITY_ORDER[b.priority] ?? 99;
          if (pa !== pb) return pa - pb;
          const ta = a.arrivedAt?.getTime() ?? a.createdAt.getTime();
          const tb = b.arrivedAt?.getTime() ?? b.createdAt.getTime();
          return ta - tb;
        });
      }),

    // Добавить пациента в очередь (регистратор или колл-центр)
    add: trpc.protectedProcedure
      .input(
        z.object({
          doctorId: z.string(),
          patientId: z.string(),
          priority: QueuePriorityEnum,
          category: PatientCategoryEnum,
          scheduledAt: z.string().datetime().optional(),
          source: z.enum(['REGISTRAR', 'CALL_CENTER']),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Получить настройки категории из БД
        const catSettings = await prisma.categorySettings.findUnique({
          where: { category: input.category },
        });

        // EMERGENCY или категория без требования подтверждения → сразу ARRIVED
        const requiresArrival = catSettings?.requiresArrivalConfirmation ?? true;
        const isImmediateArrival = input.priority === 'EMERGENCY' || !requiresArrival;

        const initialStatus = isImmediateArrival ? 'ARRIVED' : 'WAITING_ARRIVAL';
        const arrivedAt = isImmediateArrival ? new Date() : undefined;

        // PAID_ONCE требует оплаты — ставим paymentConfirmed=false
        const requiresPayment = catSettings?.requiresPaymentConfirmation ?? false;
        const paymentConfirmed = !requiresPayment;

        const queueNumber = await getNextQueueNumber(prisma, input.doctorId);

        const entry = await prisma.queueEntry.create({
          data: {
            doctorId: input.doctorId,
            patientId: input.patientId,
            priority: input.priority,
            category: input.category,
            queueNumber,
            status: initialStatus,
            source: input.source,
            createdById: ctx.user!.id,
            requiresArrivalConfirmation: requiresArrival,
            paymentConfirmed,
            scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
            arrivedAt,
            notes: input.notes,
          } as any,
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                phone: true,
              },
            },
          },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'created',
            newStatus: initialStatus,
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: input.doctorId, entry });
        return entry;
      }),

    // Подтвердить приход пациента (регистратор отмечает у стойки)
    confirmArrival: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (entry.status !== 'WAITING_ARRIVAL') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя подтвердить приход: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { status: 'ARRIVED', arrivedAt: new Date() },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, middleName: true },
            },
          },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'arrival_confirmed',
            oldStatus: 'WAITING_ARRIVAL',
            newStatus: 'ARRIVED',
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Подтвердить оплату (регистратор, только для PAID_ONCE)
    confirmPayment: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { paymentConfirmed: true },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, middleName: true },
            },
          },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'payment_confirmed',
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Врач вызывает следующего пациента
    // Автоматически завершает текущего IN_PROGRESS пациента.
    callNext: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Завершить текущего IN_PROGRESS (если есть)
        const inProgress = await prisma.queueEntry.findFirst({
          where: { doctorId: input.doctorId, status: 'IN_PROGRESS' },
        });
        if (inProgress) {
          await prisma.queueEntry.update({
            where: { id: inProgress.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
          await prisma.queueHistory.create({
            data: {
              queueEntryId: inProgress.id,
              action: 'auto_completed_on_call_next',
              oldStatus: 'IN_PROGRESS',
              newStatus: 'COMPLETED',
              userId: ctx.user!.id,
            } as any,
          });
        }

        // Найти следующего: ARRIVED + paymentConfirmed=true
        const candidates = await prisma.queueEntry.findMany({
          where: {
            doctorId: input.doctorId,
            status: 'ARRIVED',
            paymentConfirmed: true,
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, middleName: true },
            },
          },
        });

        if (candidates.length === 0) {
          return { called: null, message: 'Нет пациентов в очереди' };
        }

        // Сортировка: приоритет ASC → arrivedAt ASC
        candidates.sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 99;
          const pb = PRIORITY_ORDER[b.priority] ?? 99;
          if (pa !== pb) return pa - pb;
          return (a.arrivedAt?.getTime() ?? 0) - (b.arrivedAt?.getTime() ?? 0);
        });

        const next = candidates[0];
        const called = await prisma.queueEntry.update({
          where: { id: next.id },
          data: { status: 'IN_PROGRESS', calledAt: new Date() },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, middleName: true },
            },
          },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: next.id,
            action: 'called',
            oldStatus: 'ARRIVED',
            newStatus: 'IN_PROGRESS',
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:called', { doctorId: input.doctorId, entry: called });
        events.emit('queue:updated', { doctorId: input.doctorId, entry: called });
        return { called };
      }),

    // Завершить приём (врач нажимает "Завершить")
    complete: trpc.protectedProcedure
      .input(z.object({ entryId: z.string(), notes: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (!['IN_PROGRESS', 'ARRIVED'].includes(entry.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя завершить: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            notes: input.notes ?? entry.notes,
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, middleName: true },
            },
          },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'completed',
            oldStatus: entry.status,
            newStatus: 'COMPLETED',
            userId: ctx.user!.id,
            notes: input.notes,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Отменить запись (регистратор или врач)
    cancel: trpc.protectedProcedure
      .input(z.object({ entryId: z.string(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя отменить: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { status: 'CANCELLED', cancelReason: input.reason },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, middleName: true },
            },
          },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'cancelled',
            oldStatus: entry.status,
            newStatus: 'CANCELLED',
            userId: ctx.user!.id,
            notes: input.reason,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Отметить неявку (пациент не пришёл)
    markNoShow: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (!['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя отметить неявку: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { status: 'NO_SHOW' },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, middleName: true },
            },
          },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'no_show',
            oldStatus: entry.status,
            newStatus: 'NO_SHOW',
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Дневная статистика (для заведующего / директора)
    dailyStats: trpc.protectedProcedure
      .input(
        z.object({
          doctorId: z.string().optional(),
          date: z.string().optional(), // ISO date string, напр. "2026-04-24"
        }),
      )
      .query(async ({ input }) => {
        const date = input.date ? new Date(input.date) : new Date();
        date.setHours(0, 0, 0, 0);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        const where: any = { createdAt: { gte: date, lt: nextDay } };
        if (input.doctorId) where.doctorId = input.doctorId;

        return prisma.queueEntry.groupBy({
          by: ['status', 'priority'],
          where,
          _count: { _all: true },
        });
      }),
  });
};
```

- [ ] **Step 2: Добавить в root router**

Импорт:
```typescript
import { createQueueRouter } from '../modules/queue/queue.router';
```

Поле в `appRouter`:
```typescript
queue: createQueueRouter(this.trpc, this.prisma, this.eventsGateway),
```

- [ ] **Step 3: Проверить компиляцию**

```bash
cd /home/administrator/projects_danik && pnpm --filter backend build 2>&1 | tail -5
```

Ожидаем: без `error TS`.

- [ ] **Step 4: Smoke-тест queue — добавить в очередь и вызвать**

```bash
# Авторизация как регистратор
TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"registrar1","password":"password123"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['token'])")

# Взять id первого врача
DOCTOR_ID=$(curl -s http://localhost:3002/trpc/users.getAll \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); docs=[u for u in d['result']['data'] if u['role']=='DOCTOR']; print(docs[0]['id'])")
echo "Doctor: $DOCTOR_ID"

# Взять id первого пациента
PATIENT_ID=$(curl -s "http://localhost:3002/trpc/patients.search?input=%7B%22query%22%3A%22%D0%9F%22%7D" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data'][0]['id'])")
echo "Patient: $PATIENT_ID"

# Добавить пациента в очередь с приоритетом WALK_IN
ENTRY=$(curl -s -X POST http://localhost:3002/trpc/queue.add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"patientId\":\"$PATIENT_ID\",\"priority\":\"WALK_IN\",\"category\":\"OSMS\",\"source\":\"REGISTRAR\"}")
echo "$ENTRY" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d['result']['data']; print('status:', e['status'], '| queueNumber:', e['queueNumber'])"
```

Ожидаем: `status: ARRIVED | queueNumber: 1` (OSMS по умолчанию не требует подтверждения прихода в seed).

- [ ] **Step 5: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(queue): движок очереди с приоритетами и WebSocket событиями" && git push
```

---

### Task 5: Финальный smoke-тест полного цикла

**Files:** только проверка, файлы не меняются.

- [ ] **Step 1: Убедиться что бэкенд запущен**

```bash
curl -s http://localhost:3002/trpc/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['status'])"
```

Ожидаем: `ok`

- [ ] **Step 2: Назначить врача в кабинет (заведующий)**

```bash
# Авторизация как заведующий
HEAD_TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"head1","password":"password123"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['token'])")

# Взять данные
REG_TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"registrar1","password":"password123"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['token'])")

DOCTOR_ID=$(curl -s http://localhost:3002/trpc/users.getAll \
  -H "Authorization: Bearer $REG_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); docs=[u for u in d['result']['data'] if u['role']=='DOCTOR']; print(docs[0]['id'])")

CABINET_ID=$(curl -s http://localhost:3002/trpc/cabinets.getAll \
  -H "Authorization: Bearer $REG_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data'][0]['id'])")

# Назначить
ASSIGN=$(curl -s -X POST http://localhost:3002/trpc/assignments.assign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HEAD_TOKEN" \
  -d "{\"doctorId\":\"$DOCTOR_ID\",\"cabinetId\":\"$CABINET_ID\"}")
echo "$ASSIGN" | python3 -c "import sys,json; d=json.load(sys.stdin); a=d['result']['data']; print('assigned:', a['doctor']['lastName'], '→ каб.', a['cabinet']['number'])"
```

Ожидаем: `assigned: <фамилия врача> → каб. <номер>`

- [ ] **Step 3: Проверить активные назначения**

```bash
curl -s http://localhost:3002/trpc/assignments.getActive \
  -H "Authorization: Bearer $REG_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('active:', len(d['result']['data']))"
```

Ожидаем: `active: 1`

- [ ] **Step 4: Вызвать следующего пациента (авторизоваться как врач)**

```bash
DOCTOR_TOKEN=$(curl -s -X POST http://localhost:3002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"doctor1","password":"password123"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['data']['token'])")

curl -s -X POST http://localhost:3002/trpc/queue.callNext \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  -d "{\"doctorId\":\"$DOCTOR_ID\"}" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d['result']['data']; print('called:', r.get('called',{}).get('patient',{}).get('lastName','нет') if r.get('called') else r.get('message'))"
```

Ожидаем: фамилия пациента или `Нет пациентов в очереди`.

- [ ] **Step 5: Коммит (если не было изменений в Step 4, коммит не нужен)**

Если на этапе тестирования пришлось что-то поправить:

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "fix(queue): правки после smoke-теста" && git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Назначение врача в кабинет → `assignments.assign` / `assignments.unassign`
- ✅ Просмотр активных назначений → `assignments.getActive` / `assignments.getForDoctor`
- ✅ Постановка в очередь с приоритетами → `queue.add`
- ✅ Приоритетная сортировка EMERGENCY>INPATIENT>SCHEDULED>WALK_IN → `PRIORITY_ORDER` в `getByDoctor` и `callNext`
- ✅ Подтверждение прихода → `queue.confirmArrival`
- ✅ Подтверждение оплаты (PAID_ONCE) → `queue.confirmPayment`
- ✅ Вызов следующего → `queue.callNext`
- ✅ Завершение приёма → `queue.complete`
- ✅ Отмена записи → `queue.cancel`
- ✅ Отметка неявки → `queue.markNoShow`
- ✅ История изменений → `QueueHistory` записывается в каждой мутации
- ✅ WebSocket события → `events.emit()` после каждой мутации
- ✅ Настройки категорий → `settings.getCategorySettings` / `settings.updateCategorySettings`
- ✅ Шаблоны смен → `shifts.list` / `shifts.create` / `shifts.update` / `shifts.delete`
- ✅ Дневная статистика → `queue.dailyStats`

**Placeholder scan:** нет TBD, все шаги содержат полный код.

**Type consistency:** `createQueueRouter`, `createAssignmentsRouter`, `createSettingsRouter`, `createShiftsRouter` — единообразные сигнатуры. `as any` применяется везде где нужен Prisma XOR.

---

**План сохранён в `docs/superpowers/plans/2026-04-24-eque-phase2-queue-engine.md`. Два варианта выполнения:**

**1. Subagent-Driven (рекомендуется)** — отдельный агент на каждую задачу, проверка между задачами

**2. Inline Execution** — выполнение в текущей сессии через executing-plans с чекпоинтами

**Какой подход выбираете?**
