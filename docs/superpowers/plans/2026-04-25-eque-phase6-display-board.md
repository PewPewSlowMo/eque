# СЭО Phase 6: Display Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать публичное табло электронной очереди — страница `/board` без авторизации, показывает кабинет, текущего вызванного пациента и очередь в реальном времени.

**Architecture:** На бэкенде добавляем `display.router.ts` с процедурой `getBoard` на `trpc.procedure` (не `protectedProcedure`) — работает без токена. Фронтенд вызывает `trpc.display.getBoard.useQuery` и слушает Socket.io события `queue:called`/`queue:updated` для мгновенной инвалидации. `App.tsx` уже рендерит `<DisplayBoard />` для маршрута `/board` без проверки авторизации — роутинг не требует изменений.

**Tech Stack:** NestJS + tRPC + Prisma (backend), React 18 + Vite + Tailwind (frontend), socket.io-client

---

## Файловая структура

```
apps/backend/src/
  modules/display/
    display.router.ts    CREATE  publicProcedure getBoard — назначения + текущий вызов
  trpc/
    trpc.router.ts       MODIFY  добавить display роутер

apps/frontend/src/
  components/
    DisplayBoard.tsx     MODIFY  заглушка → TV-дружелюбное табло
```

> **Не трогаем** `App.tsx` — там уже есть `PUBLIC_ROUTES = ['/board']` и `<DisplayBoard />`.
>
> **Соглашения проекта:**
> - `trpc.procedure` — уже публичная процедура (без middleware авторизации)
> - `trpc.protectedProcedure` — требует JWT, для табло не подходит
> - `getSocket()` из `@/lib/socket` работает без токена
> - tRPC клиент на фронте шлёт пустой `Authorization: ''` при отсутствии токена — публичные процедуры обрабатывают такой запрос нормально

---

### Task 1: Backend — display.router.ts + регистрация

**Files:**
- Create: `apps/backend/src/modules/display/display.router.ts`
- Modify: `apps/backend/src/trpc/trpc.router.ts`

`getBoard` загружает все активные назначения и для каждого — текущего пациента (CALLED или IN_PROGRESS) и количество ожидающих. Всё в одном запросе через `Promise.all`.

- [ ] **Step 1: Создать display.router.ts**

```typescript
// apps/backend/src/modules/display/display.router.ts
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createDisplayRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getBoard: trpc.procedure.query(async () => {
      const assignments = await prisma.doctorAssignment.findMany({
        where: { isActive: true },
        include: {
          doctor: {
            select: { id: true, firstName: true, lastName: true, specialty: true },
          },
          cabinet: { select: { id: true, number: true, name: true } },
        },
        orderBy: { startTime: 'desc' },
      });

      return Promise.all(
        assignments.map(async (a) => {
          const current = await prisma.queueEntry.findFirst({
            where: {
              doctorId: a.doctorId,
              status: { in: ['CALLED', 'IN_PROGRESS'] },
            },
            include: {
              patient: { select: { firstName: true, lastName: true } },
            },
            orderBy: { calledAt: 'desc' },
          });

          const waitingCount = await prisma.queueEntry.count({
            where: {
              doctorId: a.doctorId,
              status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
            },
          });

          return {
            assignmentId: a.id,
            doctor: a.doctor,
            cabinet: a.cabinet,
            current: current
              ? {
                  queueNumber: current.queueNumber,
                  status: current.status,
                  priority: current.priority,
                  patientLastName: current.patient.lastName,
                }
              : null,
            waitingCount,
          };
        }),
      );
    }),
  });
};
```

- [ ] **Step 2: Зарегистрировать роутер в trpc.router.ts**

Добавить import в начало файла `apps/backend/src/trpc/trpc.router.ts` (после существующих imports):

```typescript
import { createDisplayRouter } from '../modules/display/display.router';
```

Добавить в `appRouter` (после `queue:` строки):

```typescript
display: createDisplayRouter(this.trpc, this.prisma),
```

Итоговый `appRouter` будет выглядеть:

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
  settings: createSettingsRouter(this.trpc, this.prisma),
  assignments: createAssignmentsRouter(this.trpc, this.prisma, this.eventsGateway),
  queue: createQueueRouter(this.trpc, this.prisma, this.eventsGateway),
  display: createDisplayRouter(this.trpc, this.prisma),
});
```

- [ ] **Step 3: Проверить компиляцию бэкенда**

```bash
cd /home/administrator/projects_danik && pnpm --filter backend exec tsc --noEmit 2>&1 | head -20
```

Ожидаем: нет ошибок.

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(display): публичный роутер для табло очереди" && git push
```

---

### Task 2: Frontend — DisplayBoard.tsx

**Files:**
- Modify: `apps/frontend/src/components/DisplayBoard.tsx`

TV-дружелюбное табло: тёмный фон, крупный шрифт. Сетка карточек — одна на врача. Каждая карточка: синяя шапка с номером кабинета, ФИО врача, большой номер вызванного пациента. Socket.io инвалидирует запрос при `queue:called` и `queue:updated`.

- [ ] **Step 1: Заменить заглушку**

```tsx
// apps/frontend/src/components/DisplayBoard.tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { getSocket } from '@/lib/socket';

const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: 'text-red-400',
  INPATIENT:  'text-orange-400',
  SCHEDULED:  'text-yellow-400',
  WALK_IN:    'text-green-400',
};

function Clock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-2xl font-mono text-gray-300">
      {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

export function DisplayBoard() {
  const queryClient = useQueryClient();

  const { data: board = [], isLoading } = trpc.display.getBoard.useQuery(
    undefined,
    { refetchInterval: 15_000 },
  );

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [['display', 'getBoard']] });
    };
    socket.on('queue:called', refresh);
    socket.on('queue:updated', refresh);
    return () => {
      socket.off('queue:called', refresh);
      socket.off('queue:updated', refresh);
    };
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-xl">Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-wide">Электронная очередь</h1>
        <Clock />
      </div>

      {(board as any[]).length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-xl">Нет активных врачей</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {(board as any[]).map((item: any) => (
            <div
              key={item.assignmentId}
              className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden"
            >
              <div className="bg-blue-700 px-4 py-3 flex items-center justify-between">
                <span className="text-2xl font-bold">Каб. {item.cabinet.number}</span>
                {item.waitingCount > 0 && (
                  <span className="text-sm bg-blue-900 rounded-full px-2 py-0.5">
                    {item.waitingCount} ожид.
                  </span>
                )}
              </div>

              <div className="px-4 pt-3 pb-2 border-b border-gray-800">
                <p className="font-semibold text-sm text-gray-200">
                  {item.doctor.lastName} {item.doctor.firstName}
                </p>
                {item.doctor.specialty && (
                  <p className="text-xs text-gray-500">{item.doctor.specialty}</p>
                )}
              </div>

              <div className="px-4 py-4 min-h-[88px] flex items-center">
                {item.current ? (
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-5xl font-black leading-none ${PRIORITY_COLOR[item.current.priority] ?? 'text-white'}`}
                    >
                      {item.current.queueNumber}
                    </span>
                    <div>
                      <p className="text-lg font-bold leading-tight">
                        {item.current.patientLastName}
                      </p>
                      <p className="text-xs text-gray-400">
                        {item.current.status === 'CALLED' ? 'Вызван' : 'На приёме'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-600 text-sm">Нет вызова</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript-проверка фронта**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend exec tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Ожидаем: нет ошибок в новом файле.

- [ ] **Step 3: Проверить сборку**

```bash
cd /home/administrator/projects_danik && pnpm --filter frontend build 2>&1 | tail -10
```

Ожидаем: сборка без ошибок.

- [ ] **Step 4: Коммит**

```bash
cd /home/administrator/projects_danik && git add -A && git commit -m "feat(display): табло электронной очереди" && git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Публичная страница без авторизации → `trpc.procedure` (не `protectedProcedure`) в `display.router.ts`; App.tsx уже рендерит `DisplayBoard` для `/board`
- ✅ Кабинет врача → `cabinet.number` в карточке
- ✅ ФИО врача → `doctor.lastName` + `doctor.firstName`
- ✅ Текущий вызванный пациент (CALLED или IN_PROGRESS) → `current` поле из `getBoard`
- ✅ Номер очереди → `current.queueNumber` (большой шрифт)
- ✅ Приоритет → цвет номера через `PRIORITY_COLOR`
- ✅ Real-time → Socket.io `queue:called` + `queue:updated` инвалидируют запрос
- ✅ Резервный polling → `refetchInterval: 15_000`
- ✅ TV-friendly UI → тёмный фон, большие шрифты, clock

**Placeholder scan:** нет TBD, весь код полный.

**Type consistency:** `item.current.patientLastName` — ровно то поле, которое возвращает `display.router.ts` (`patientLastName: current.patient.lastName`). `item.assignmentId`, `item.doctor`, `item.cabinet`, `item.waitingCount` — все поля согласованы между роутером и компонентом.
