# WebSocket JWT-handshake + Rooms + Payload Sanitization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть утечку PII через WebSocket, ввести JWT-handshake для staff и slug-handshake для публичных табло, ввести room-based роутинг событий по ролям и `departmentId`/`doctorId`.

**Architecture:** EventsGateway проверяет `socket.handshake.auth` (token для staff, boardSlug для табло), кладёт сокеты в комнаты (`staff:all` / `department:{id}` / `doctor:{id}` / `board:{slug}`). Новые типизированные эмит-методы формируют **два разных payload'а** на каждое событие — staff получает thin-event без PII (refetch через tRPC), board получает pre-masked event с учётом `displayConsent`. В памяти `EventsGateway` живёт кэш `Map<cabinetId, Set<slug>>` для роутинга board-событий.

**Tech Stack:** NestJS 10 + socket.io 4, JWT через `TrpcService.verifyToken`, Prisma 6, React 18, socket.io-client. Тесты не пишутся (нет инфраструктуры тестов — техдолг #5), верификация через `tsc --noEmit` + docker logs + ручной smoke-test по чеклисту из спеки.

**Spec:** `docs/superpowers/specs/2026-05-30-websocket-jwt-rooms-design.md`

---

## File Structure

**Backend:**
- **Create** `apps/backend/src/events/event-types.ts` — shared типы payload'ов
- **Modify** `apps/backend/src/events/events.module.ts` — экспорт остаётся
- **Modify** `apps/backend/src/events/events.gateway.ts` — handshake, комнаты, типизированные методы, кэш
- **Modify** `apps/backend/src/modules/queue/queue.router.ts` — 12 call site'ов
- **Modify** `apps/backend/src/modules/kiosk/kiosk.router.ts` — 1 call site
- **Modify** `apps/backend/src/modules/assignments/assignments.router.ts` — 2 call site'a
- **Modify** `apps/backend/src/modules/displayBoards/displayBoards.router.ts` — интеграция с кэшем + disconnectBoard

**Frontend:**
- **Modify** `apps/frontend/src/lib/socket.ts` — auth-aware singleton, auto-reload
- **Modify** `apps/frontend/src/contexts/UserContext.tsx` — disconnect на logout
- **Modify** `apps/frontend/src/components/registrar/useQueueSocket.ts` — передача token
- **Modify** `apps/frontend/src/components/board/BoardView.tsx` — передача slug, socket.on с использованием обновлённого API
- **Modify** `apps/frontend/src/components/board/useCallNotifications.ts` — новая форма payload, удаление клиентской маскировки
- **Modify** `apps/frontend/src/components/DisplayBoard.tsx` — передача token (это staff-клиент, не board!)

---

## Pre-flight check

- [ ] **Step 1: Убедиться, что контейнеры запущены и `tsc --noEmit` чист на обеих сторонах**

```bash
docker ps --filter "name=eque" --format "{{.Names}}\t{{.Status}}"
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit && echo BACKEND_OK
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit && echo FRONTEND_OK
```

Expected: все контейнеры `Up`, оба tsc печатают `*_OK`. Если нет — диагностировать и починить ДО начала работы.

---

## Task 1: Shared event-types.ts

**Files:**
- Create: `apps/backend/src/events/event-types.ts`

- [ ] **Step 1: Создать файл с типами**

```typescript
// apps/backend/src/events/event-types.ts

export type StaffEventType =
  | 'queue:updated'
  | 'queue:called'
  | 'assignment:created'
  | 'assignment:ended';

/**
 * Payload для staff-комнат (`staff:all`, `department:*`, `doctor:*`).
 * НЕ содержит PII пациента. Клиент использует как trigger для refetch через tRPC.
 */
export interface StaffEvent {
  type: StaffEventType;
  doctorId: string;
  departmentId: string | null;
  entryId?: string;
  cabinetId?: string | null;
}

/**
 * Payload для board-комнат (`board:{slug}`).
 * Содержит ФИО ТОЛЬКО если у пациента `displayConsent=true`.
 * Сервер маскирует ДО отправки — клиент уже не решает.
 */
export interface BoardCallEvent {
  cabinetId: string;
  cabinetNumber: string;
  queueNumber: number;
  patientFirstName: string | null;  // null если displayConsent=false
  patientLastName: string | null;
  patientMiddleName: string;        // '' если displayConsent=false (для совместимости с TTS template)
}
```

- [ ] **Step 2: Проверить tsc на обеих сторонах**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit
```

Expected: оба чисто.

- [ ] **Step 3: Коммит**

```bash
cd /home/administrator/projects_danik
git add apps/backend/src/events/event-types.ts
git commit -m "feat(events): добавить shared типы для payload'ов WS"
```

---

## Task 2: EventsGateway — PrismaService injection + board cache infrastructure

**Files:**
- Modify: `apps/backend/src/events/events.gateway.ts`

**Контекст:** Сейчас `EventsGateway` без зависимостей. Нужно внедрить `PrismaService` для построения кэша. `PrismaModule` уже `@Global()` — автоматически доступен в DI. `OnModuleInit` строит кэш при старте.

- [ ] **Step 1: Заменить содержимое `events.gateway.ts`**

Полностью заменить файл на:

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnModuleInit, Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';

const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];

@Injectable()
@WebSocketGateway({ cors: { origin: corsOrigins, credentials: true } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server!: Server;

  /** Карта: cabinetId → набор slug'ов табло, которые включают этот кабинет. */
  private boardCache: Map<string, Set<string>> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refreshBoardCache();
  }

  /**
   * Перестраивает кэш cabinet → boards. Вызывается из onModuleInit и
   * после CRUD-операций над DisplayBoard.
   */
  async refreshBoardCache(): Promise<void> {
    const boards = await this.prisma.displayBoard.findMany({
      select: {
        slug: true,
        cabinets: { select: { cabinetId: true } },
      },
    });
    const next: Map<string, Set<string>> = new Map();
    for (const b of boards) {
      for (const c of b.cabinets) {
        if (!next.has(c.cabinetId)) next.set(c.cabinetId, new Set());
        next.get(c.cabinetId)!.add(b.slug);
      }
    }
    this.boardCache = next;
  }

  /**
   * Принудительно отключает все сокеты в комнате `board:{slug}`.
   * Вызывается при удалении табло.
   */
  disconnectBoard(slug: string): void {
    const room = `board:${slug}`;
    const sockets = this.server.sockets.adapter.rooms.get(room);
    if (!sockets) return;
    for (const socketId of sockets) {
      const socket = this.server.sockets.sockets.get(socketId);
      socket?.disconnect(true);
    }
  }

  handleConnection(client: Socket) {
    console.log(`[WS] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[WS] Client disconnected: ${client.id}`);
  }

  /**
   * @deprecated Use typed emit methods (emitQueueUpdated, emitQueueCalled, emitAssignmentChanged).
   * Сохранён временно для роутеров, которые ещё не мигрированы.
   */
  emit(event: string, data: any) {
    this.server.emit(event, data);
  }

  /**
   * @deprecated Use emitQueueCalled with cabinet info.
   */
  emitToDoctor(doctorId: string, event: string, data: any) {
    this.server.to(`doctor:${doctorId}`).emit(event, data);
  }
}
```

- [ ] **Step 2: Backend tsc + проверка hot-reload**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
docker logs eque-backend --tail 30 2>&1 | grep -E "error|ERROR|Nest application|Database connected" | tail -10
```

Expected: tsc чист, в логах `Database connected` + `Nest application successfully started` (после hot-reload). Если ошибка `displayBoardCabinet` или подобное про связь — проверить точное имя поля в `schema.prisma`:

```bash
grep -A2 "model DisplayBoard\b\|model DisplayBoardCabinet" /home/administrator/projects_danik/apps/backend/prisma/schema.prisma
```

Поле связи в `DisplayBoard.cabinets` это `DisplayBoardCabinet[]`, у которого есть `cabinetId`. Если переименовано — поправить `select: { cabinets: { select: { cabinetId: true } } }`.

- [ ] **Step 3: Коммит**

```bash
git add apps/backend/src/events/events.gateway.ts
git commit -m "feat(events): добавить PrismaService и board cache infrastructure"
```

---

## Task 3: displayBoards.router.ts — refresh cache + disconnectBoard

**Files:**
- Modify: `apps/backend/src/modules/displayBoards/displayBoards.router.ts`

**Контекст:** Сейчас фабрика `createDisplayBoardsRouter` принимает `(trpc, prisma)`. Нужно добавить третий параметр `eventsGateway` и вызывать `refreshBoardCache()` после create/update/delete, плюс `disconnectBoard(slug)` после delete.

- [ ] **Step 1: Расширить сигнатуру роутера**

В `displayBoards.router.ts` заменить:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
```

на:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';
```

И заменить:

```typescript
export const createDisplayBoardsRouter = (trpc: TrpcService, prisma: PrismaService) => {
```

на:

```typescript
export const createDisplayBoardsRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
```

- [ ] **Step 2: Добавить вызов refreshBoardCache после create**

Внутри `create.mutation` после `prisma.displayBoard.create({...})`, перед `return`:

Найти существующий блок:
```typescript
try {
  return await prisma.displayBoard.create({
    data: { ... },
    include: { ... },
  });
} catch (e: any) { ... }
```

Заменить на:
```typescript
try {
  const created = await prisma.displayBoard.create({
    data: {
      ...data,
      cabinets: {
        create: cabinetIds.map((cabinetId) => ({ cabinetId })),
      },
    } as any,
    include: {
      cabinets: {
        include: { cabinet: { select: { id: true, number: true, name: true } } },
      },
    },
  });
  await events.refreshBoardCache();
  return created;
} catch (e: any) {
  if (e?.code === 'P2002') {
    throw new TRPCError({ code: 'CONFLICT', message: 'Табло с таким slug уже существует' });
  }
  throw e;
}
```

- [ ] **Step 3: Добавить refreshBoardCache после update (в транзакции)**

Внутри `update.mutation`, в блоке `prisma.$transaction(async (tx) => { ... })`, ПОСЛЕ `return tx.displayBoard.update({...})` — нет, transaction нельзя `await` сторонний side-effect. Нужно вынести refresh ПОСЛЕ транзакции.

Заменить весь `update.mutation` (строки 62-91) на:

```typescript
update: trpc.protectedProcedure
  .input(z.object({ id: z.string() }).merge(BoardInput.partial()))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== 'ADMIN') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
    }
    const { id, cabinetIds, ...data } = input;
    const updated = await prisma.$transaction(async (tx) => {
      if (cabinetIds !== undefined) {
        await tx.displayBoardCabinet.deleteMany({ where: { boardId: id } });
        await tx.displayBoardCabinet.createMany({
          data: cabinetIds.map((cabinetId) => ({ boardId: id, cabinetId })),
        });
      }
      try {
        return await tx.displayBoard.update({
          where: { id },
          data: data as any,
          include: {
            cabinets: {
              include: { cabinet: { select: { id: true, number: true, name: true } } },
            },
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Табло с таким slug уже существует' });
        }
        throw e;
      }
    });
    await events.refreshBoardCache();
    return updated;
  }),
```

- [ ] **Step 4: Добавить disconnectBoard + refresh в delete**

Заменить `delete.mutation` (строки 94-101) на:

```typescript
delete: trpc.protectedProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== 'ADMIN') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
    }
    const board = await prisma.displayBoard.findUnique({
      where: { id: input.id },
      select: { slug: true },
    });
    const result = await prisma.displayBoard.delete({ where: { id: input.id } });
    if (board) {
      events.disconnectBoard(board.slug);
    }
    await events.refreshBoardCache();
    return result;
  }),
```

- [ ] **Step 5: Прокинуть `eventsGateway` в фабрику из `trpc.router.ts`**

В `apps/backend/src/trpc/trpc.router.ts` найти строку:

```typescript
displayBoards: createDisplayBoardsRouter(this.trpc, this.prisma),
```

Заменить на:

```typescript
displayBoards: createDisplayBoardsRouter(this.trpc, this.prisma, this.eventsGateway),
```

- [ ] **Step 6: Backend tsc + docker logs**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
docker logs eque-backend --tail 20 2>&1 | tail -10
```

Expected: tsc чист, бэк перезапустился без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add apps/backend/src/modules/displayBoards/displayBoards.router.ts apps/backend/src/trpc/trpc.router.ts
git commit -m "feat(displayBoards): инвалидировать board cache и отключать сокеты при CRUD"
```

---

## Task 4: EventsGateway — типизированные emit методы (broadcast-режим)

**Files:**
- Modify: `apps/backend/src/events/events.gateway.ts`

**Контекст:** Добавляем типизированные методы `emitQueueUpdated`, `emitQueueCalled`, `emitAssignmentChanged`. Они **пока ещё** работают через `this.server.emit()` (broadcast), а не через комнаты. Это сделано осознанно — даёт возможность мигрировать роутеры в следующем шаге без поломки клиентов. Комнаты и payload-сплит включим в Task 6, скоординированно с фронтом. Старый `emit()` оставляем — удалим в Task 11.

В `emitQueueCalled` уже сейчас делаем server-side маскировку по `displayConsent`, потому что board-клиент будет читать новую форму payload'а с Task 7 (тоже скоординировано).

- [ ] **Step 1: Добавить импорты и тип для entry с пациентом**

В начале `events.gateway.ts` после существующих импортов:

```typescript
import type { StaffEvent, BoardCallEvent } from './event-types';
```

- [ ] **Step 2: Добавить типизированные методы внутри класса**

Внутри класса `EventsGateway`, перед `@deprecated emit(...)`, вставить:

```typescript
/**
 * Сигнал "очередь у врача изменилась" — staff-клиенты делают refetch через tRPC.
 * Board-клиенты получают сигнал refresh для `display.getBySlug`.
 */
emitQueueUpdated(args: {
  doctorId: string;
  departmentId: string | null;
  entryId: string;
  cabinetId?: string | null;
}): void {
  const staffPayload: StaffEvent = {
    type: 'queue:updated',
    doctorId: args.doctorId,
    departmentId: args.departmentId,
    entryId: args.entryId,
    cabinetId: args.cabinetId ?? null,
  };
  // Phase 4 (Task 6): switch to room-based routing. For now broadcast.
  this.server.emit('queue:updated', staffPayload);
}

/**
 * Сигнал "пациент вызван" — staff-клиенты делают refetch, board-клиенты получают
 * замаскированный payload для немедленного TTS.
 */
emitQueueCalled(args: {
  doctorId: string;
  departmentId: string | null;
  cabinetId: string;
  cabinetNumber: string;
  entry: {
    id: string;
    queueNumber: number;
    displayConsent: boolean;
    patient: {
      firstName: string;
      lastName: string;
      middleName: string | null;
    };
  };
}): void {
  const staffPayload: StaffEvent = {
    type: 'queue:called',
    doctorId: args.doctorId,
    departmentId: args.departmentId,
    entryId: args.entry.id,
    cabinetId: args.cabinetId,
  };

  const noConsent = args.entry.displayConsent === false;
  const boardPayload: BoardCallEvent = {
    cabinetId: args.cabinetId,
    cabinetNumber: args.cabinetNumber,
    queueNumber: args.entry.queueNumber,
    patientFirstName:  noConsent ? null : args.entry.patient.firstName,
    patientLastName:   noConsent ? null : args.entry.patient.lastName,
    patientMiddleName: noConsent ? ''   : (args.entry.patient.middleName ?? ''),
  };

  // Phase 4 (Task 6): switch to two separate room-targeted emits.
  // For now, broadcast staffPayload only — board still reads legacy `data.entry.patient.*`
  // until Task 7 updates the client. To avoid breaking the client in this transitional
  // commit, we keep broadcasting BOTH the new staffPayload AND the legacy payload.
  this.server.emit('queue:called', { ...staffPayload, ...boardPayload });
}

/**
 * Сигнал "назначение врач↔кабинет создано/завершено".
 */
emitAssignmentChanged(args: {
  type: 'assignment:created' | 'assignment:ended';
  doctorId: string;
  departmentId: string | null;
  cabinetId: string | null;
}): void {
  const staffPayload: StaffEvent = {
    type: args.type,
    doctorId: args.doctorId,
    departmentId: args.departmentId,
    cabinetId: args.cabinetId,
  };
  // Phase 4 (Task 6): switch to room-based.
  this.server.emit(args.type, staffPayload);
}
```

**Заметка:** временный `{ ...staffPayload, ...boardPayload }` в `emitQueueCalled` нужен потому, что во время Task 5 (миграция роутеров) клиент ещё ожидает старый формат `data.entry.patient.*`. Мы фиксим в Task 6/7. **Это технический долг живёт только между Task 4 и Task 7.**

- [ ] **Step 3: Backend tsc + docker logs**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
docker logs eque-backend --tail 15 2>&1 | tail -10
```

Expected: tsc чист, бэк работает. Новые методы пока не используются — это просто dead code, но компилируется.

- [ ] **Step 4: Коммит**

```bash
git add apps/backend/src/events/events.gateway.ts
git commit -m "feat(events): добавить типизированные emit-методы (broadcast-режим)"
```

---

## Task 5: Мигрировать роутеры на типизированные методы

**Files:**
- Modify: `apps/backend/src/modules/queue/queue.router.ts`
- Modify: `apps/backend/src/modules/kiosk/kiosk.router.ts`
- Modify: `apps/backend/src/modules/assignments/assignments.router.ts`

**Контекст:** 15 call site'ов перевести на новые методы. Сейчас они не имеют `departmentId`/`cabinetId` — нужно подгрузить через `include`/`select` в существующих Prisma-запросах.

### 5.1 — queue.router.ts

- [ ] **Step 1: Найти все вызовы `events.emit` в queue.router.ts**

```bash
grep -n "events\.emit" /home/administrator/projects_danik/apps/backend/src/modules/queue/queue.router.ts
```

Должно быть 12 строк (195, 230, 263, 324, 330, 367, 373, 403, 422, 467, 503, 538 — точные номера могут отличаться, всегда полагаться на текущий вывод grep).

- [ ] **Step 2: Заменить `events.emit('queue:updated', { doctorId, entry })` на `events.emitQueueUpdated(...)`**

Для каждого вызова `events.emit('queue:updated', { doctorId: X, entry: Y })`:

1. **Проверить, что у `Y` (entry или его источник) уже есть `doctor.departmentId`** в include. Если нет — добавить в ближайший `findUnique`/`findFirst`/`update`/`create`:

```typescript
include: {
  doctor: { select: { departmentId: true } },
  // ... остальные include
}
```

2. Заменить вызов:

```typescript
// БЫЛО:
events.emit('queue:updated', { doctorId: input.doctorId, entry });

// СТАЛО:
events.emitQueueUpdated({
  doctorId: input.doctorId,  // или entry.doctorId — что было в оригинале
  departmentId: entry.doctor?.departmentId ?? null,
  entryId: entry.id,
  cabinetId: null,  // или передать если известно из контекста (callNext/callSpecific знают)
});
```

**Конкретный пример** для `queue.add` (строка ~195):

Найти:
```typescript
events.emit('queue:updated', { doctorId: input.doctorId, entry });
```

В блоке выше (Prisma запрос, который создаёт `entry`) убедиться что есть `include: { doctor: { select: { departmentId: true } } }`. Если в `tx.queueEntry.create({ data: {...} })` нет include — добавить ниже после транзакции:

```typescript
const entryWithDoctor = await prisma.queueEntry.findUnique({
  where: { id: entry.id },
  include: { doctor: { select: { departmentId: true } } },
});

events.emitQueueUpdated({
  doctorId: input.doctorId,
  departmentId: entryWithDoctor?.doctor?.departmentId ?? null,
  entryId: entry.id,
});
```

Или (предпочтительнее, без лишнего запроса) — добавить `include` сразу в `tx.queueEntry.create`:

```typescript
return tx.queueEntry.create({
  data: { ... },
  include: { doctor: { select: { departmentId: true } } },
});
```

И тогда `entry.doctor.departmentId` доступен сразу.

- [ ] **Step 3: Заменить `events.emit('queue:called', {...})` на `events.emitQueueCalled(...)`**

`queue:called` вызывается в `callNext`, `callSpecific`, и возможно в других местах. У этих процедур уже известны `cabinetId` и `cabinetNumber` (передаются в текущем emit). Нужно дополнительно подгрузить `patient` и `displayConsent` если их нет в `entry`.

**Пример** для `callNext` (строки ~324, ~330):

Найти текущий блок:
```typescript
events.emit('queue:called', {
  doctorId: input.doctorId,
  cabinetId: assignment.cabinetId,
  cabinetNumber: assignment.cabinet.number,
  entry: called,
});
events.emit('queue:updated', { doctorId: input.doctorId, entry: called });
```

Убедиться, что `called` уже включает `patient` (firstName, lastName, middleName), `displayConsent`, и `doctor.departmentId`:

```typescript
const called = await prisma.queueEntry.update({
  where: { id: nextEntry.id },
  data: { ... },
  include: {
    patient:  { select: { firstName: true, lastName: true, middleName: true } },
    doctor:   { select: { departmentId: true } },
    // displayConsent уже scalar поле, не нужен include
  },
});
```

Затем заменить два emit на:

```typescript
events.emitQueueCalled({
  doctorId: input.doctorId,
  departmentId: called.doctor?.departmentId ?? null,
  cabinetId: assignment.cabinetId,
  cabinetNumber: assignment.cabinet.number,
  entry: {
    id: called.id,
    queueNumber: called.queueNumber,
    displayConsent: called.displayConsent,
    patient: {
      firstName: called.patient.firstName,
      lastName: called.patient.lastName,
      middleName: called.patient.middleName,
    },
  },
});
events.emitQueueUpdated({
  doctorId: input.doctorId,
  departmentId: called.doctor?.departmentId ?? null,
  entryId: called.id,
  cabinetId: assignment.cabinetId,
});
```

Повторить **для каждого блока** `events.emit('queue:called', ...)` в файле (обычно 3 — `callNext`, `callSpecific`, и ещё одно место по grep'у).

- [ ] **Step 4: tsc контроль после правок queue.router.ts**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit 2>&1 | head -30
```

Если есть ошибки `Property 'doctor' does not exist on type ...` — значит, в одном из мест не добавили `include: { doctor: ... }`. Исправить.

Если есть `Object literal may only specify known properties, and 'queueNumber' does not exist in type` — значит, тип `entry.patient` или `entry.queueNumber` где-то не загружен. Проверить include.

- [ ] **Step 5: docker logs**

```bash
docker logs eque-backend --tail 15 2>&1 | tail -10
```

Expected: бэк перезапустился без ошибок. Если в логах `[WS]` события приходят (например, при операциях в UI) — связь работает.

### 5.2 — kiosk.router.ts

- [ ] **Step 6: Заменить единственный emit в kiosk.router.ts**

Найти строку 153:
```typescript
events.emit('queue:updated', { doctorId: kiosk.doctorId, entry });
```

Проверить блок выше — где загружается `kiosk`, добавить `doctor: { select: { departmentId: true } }`:

```typescript
const kiosk = await prisma.kiosk.findUnique({
  where: { slug: input.slug },
  include: {
    doctor: { select: { departmentId: true } },
    service: true,  // если было раньше
    // ...
  },
});
```

Заменить emit:

```typescript
events.emitQueueUpdated({
  doctorId: kiosk.doctorId,
  departmentId: kiosk.doctor?.departmentId ?? null,
  entryId: entry.id,
});
```

- [ ] **Step 7: tsc + docker logs**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
docker logs eque-backend --tail 10 2>&1 | tail -5
```

### 5.3 — assignments.router.ts

- [ ] **Step 8: Заменить два emit в assignments.router.ts**

Найти строки 103, 137 (или текущие):
```typescript
events.emit('assignment:created', assignment);
// ...
events.emit('assignment:ended', assignment);
```

Для каждого — убедиться, что в include `assignment` есть `doctor: { select: { departmentId: true } }` (если нет — добавить). Затем:

```typescript
events.emitAssignmentChanged({
  type: 'assignment:created',  // или 'assignment:ended'
  doctorId: assignment.doctorId,
  departmentId: assignment.doctor?.departmentId ?? null,
  cabinetId: assignment.cabinetId,
});
```

- [ ] **Step 9: Финальный tsc + smoke check**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit && echo BACKEND_OK
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit && echo FRONTEND_OK
docker logs eque-backend --tail 20 2>&1 | grep -E "error|started|connected" | tail -10
```

Expected: оба `*_OK`, бэк запущен. В этот момент 100% серверного кода переведено на новые методы. Старый `emit()` и `emitToDoctor()` не используются — но пока остаются как deprecated (удалим в Task 11).

- [ ] **Step 10: Коммит**

```bash
git add apps/backend/src/modules/queue/queue.router.ts \
        apps/backend/src/modules/kiosk/kiosk.router.ts \
        apps/backend/src/modules/assignments/assignments.router.ts
git commit -m "refactor(routers): мигрировать 15 emit call sites на типизированные методы"
```

- [ ] **Step 11: Ручная проверка работающего табло**

Открыть в браузере `http://192.168.10.213:3003/board/<любой-существующий-slug>` И в другой вкладке регистратуру. Записать пациента → callNext. Табло должно показать активный вызов **и** проговорить TTS/звук.

Если работает — отлично, переходим к Task 6. Если **не** работает — диагностировать (в этой точке клиент всё ещё ждёт `data.entry.patient.*`, а сервер отдаёт `{...staffPayload, ...boardPayload}` — поля `patientFirstName` есть, но `entry.patient` тоже должен быть, потому что в Task 4 мы добавили временный `{ ...staffPayload, ...boardPayload }` — но этот спред НЕ содержит `entry.patient.*`!). Если TTS не работает — это ОЖИДАЕМО, исправится в Task 6 + 7.

---

## Task 6: EventsGateway — room-based роутинг + payload sanitization

**Files:**
- Modify: `apps/backend/src/events/events.gateway.ts`

**Контекст:** Переходим от `this.server.emit()` к routed emit'у с разделением payload'ов. Сокеты ещё не в комнатах (handshake обновим в Task 8), но и так делаем переход — пока что комнаты пустые, события «вникуда». **Это ОЖИДАЕМО** — Task 7 обновит клиента, Task 8 наполнит комнаты.

- [ ] **Step 1: Добавить helper-метод вычисления board-rooms**

В `events.gateway.ts` внутри класса добавить:

```typescript
private getBoardRoomsForCabinet(cabinetId: string | null | undefined): string[] {
  if (!cabinetId) return [];
  const slugs = this.boardCache.get(cabinetId);
  if (!slugs) return [];
  return Array.from(slugs).map((slug) => `board:${slug}`);
}

private getStaffRoomsFor(args: { doctorId: string; departmentId: string | null }): string[] {
  const rooms = ['staff:all', `doctor:${args.doctorId}`];
  if (args.departmentId) rooms.push(`department:${args.departmentId}`);
  return rooms;
}
```

- [ ] **Step 2: Обновить `emitQueueUpdated` на routed**

Заменить тело метода:

```typescript
emitQueueUpdated(args: {
  doctorId: string;
  departmentId: string | null;
  entryId: string;
  cabinetId?: string | null;
}): void {
  const staffPayload: StaffEvent = {
    type: 'queue:updated',
    doctorId: args.doctorId,
    departmentId: args.departmentId,
    entryId: args.entryId,
    cabinetId: args.cabinetId ?? null,
  };
  const staffRooms = this.getStaffRoomsFor(args);

  this.server.to(staffRooms).emit('queue:updated', staffPayload);
  // queue:updated может выстреливать без cabinetId (создание записи, confirmArrival и т.д.).
  // Шлём всем табло в общую `board:all` — табло сами рефетчат свой scope через display.getBySlug.
  // Payload пустой — board просто триггерит refetch.
  this.server.to('board:all').emit('queue:updated', {});
}
```

- [ ] **Step 3: Обновить `emitQueueCalled` на routed с двумя payload'ами**

Заменить тело метода:

```typescript
emitQueueCalled(args: {
  doctorId: string;
  departmentId: string | null;
  cabinetId: string;
  cabinetNumber: string;
  entry: {
    id: string;
    queueNumber: number;
    displayConsent: boolean;
    patient: {
      firstName: string;
      lastName: string;
      middleName: string | null;
    };
  };
}): void {
  const staffPayload: StaffEvent = {
    type: 'queue:called',
    doctorId: args.doctorId,
    departmentId: args.departmentId,
    entryId: args.entry.id,
    cabinetId: args.cabinetId,
  };

  const noConsent = args.entry.displayConsent === false;
  const boardPayload: BoardCallEvent = {
    cabinetId: args.cabinetId,
    cabinetNumber: args.cabinetNumber,
    queueNumber: args.entry.queueNumber,
    patientFirstName:  noConsent ? null : args.entry.patient.firstName,
    patientLastName:   noConsent ? null : args.entry.patient.lastName,
    patientMiddleName: noConsent ? ''   : (args.entry.patient.middleName ?? ''),
  };

  const staffRooms = this.getStaffRoomsFor(args);
  const boardRooms = this.getBoardRoomsForCabinet(args.cabinetId);

  this.server.to(staffRooms).emit('queue:called', staffPayload);
  if (boardRooms.length > 0) {
    this.server.to(boardRooms).emit('queue:called', boardPayload);
  }
}
```

- [ ] **Step 4: Обновить `emitAssignmentChanged` на routed**

```typescript
emitAssignmentChanged(args: {
  type: 'assignment:created' | 'assignment:ended';
  doctorId: string;
  departmentId: string | null;
  cabinetId: string | null;
}): void {
  const staffPayload: StaffEvent = {
    type: args.type,
    doctorId: args.doctorId,
    departmentId: args.departmentId,
    cabinetId: args.cabinetId,
  };
  const staffRooms = this.getStaffRoomsFor(args);
  this.server.to(staffRooms).emit(args.type, staffPayload);
  // assignment меняет cabinet doctor'а → табло могут перестать/начать показывать врача.
  // Шлём в board:all с пустым payload, табло рефетчат display.getBySlug и пересчитывают свой scope.
  this.server.to('board:all').emit(args.type, {});
}
```

- [ ] **Step 5: tsc + docker logs**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
docker logs eque-backend --tail 10 2>&1 | tail -5
```

Expected: tsc чист, бэк работает. **Важно:** в данный момент клиенты НЕ получают события очереди, потому что сокеты ещё не вступают в комнаты (handshake обновим только в Task 10). UI «замораживается» до Task 10. **Не пугаться** — это контролируемое промежуточное состояние, которое разморозится в Task 10 после миграции handshake.

- [ ] **Step 6: Коммит**

```bash
git add apps/backend/src/events/events.gateway.ts
git commit -m "feat(events): room-based роутинг + раздельные payload'ы staff/board"
```

---

## Task 7: Frontend useCallNotifications — читать BoardCallEvent

**Files:**
- Modify: `apps/frontend/src/components/board/useCallNotifications.ts`

**Контекст:** Клиент перестаёт сам маскировать — сервер уже отдаёт нужную форму.

- [ ] **Step 1: Обновить тип импорта и handleCalled**

В `apps/frontend/src/components/board/useCallNotifications.ts`:

Заменить блок handleCalled (строки 95-110) на:

```typescript
const handleCalled = (data: any) => {
  if (!data.cabinetId || !cabinetIdsRef.current.includes(data.cabinetId)) return;

  const event: CallEvent = {
    cabinetId:         data.cabinetId,
    cabinetNumber:     data.cabinetNumber,
    patientLastName:   data.patientLastName ?? null,
    patientFirstName:  data.patientFirstName ?? null,
    patientMiddleName: data.patientMiddleName ?? '',
    queueNumber:       data.queueNumber ?? null,
  };

  queueRef.current.push(event);
  if (!processingRef.current) processNext();
};
```

Маскировка по `displayConsent` удаляется (это уже сделал сервер). Клиент не получает поле `displayConsent` — оно остаётся приватным.

- [ ] **Step 2: Frontend tsc**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit
```

Expected: чисто. Тип `CallEvent` (в файле выше, строки 4-11) уже совпадает по полям.

- [ ] **Step 3: Коммит**

```bash
git add apps/frontend/src/components/board/useCallNotifications.ts
git commit -m "refactor(board): читать pre-masked BoardCallEvent с сервера"
```

---

## Task 8: Frontend — auth-aware lib/socket.ts

**Files:**
- Modify: `apps/frontend/src/lib/socket.ts`

**Контекст:** Singleton принимает `auth` режим, переподключается при смене режима. Auto-reload-on-unauthorized.

- [ ] **Step 1: Заменить содержимое `lib/socket.ts`**

Полностью заменить:

```typescript
import { io, Socket } from 'socket.io-client';

export type AuthMode =
  | { kind: 'staff'; token: string }
  | { kind: 'board'; slug: string };

let socket: Socket | null = null;
let currentMode: AuthMode | null = null;

function sameMode(a: AuthMode, b: AuthMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'staff' && b.kind === 'staff') return a.token === b.token;
  if (a.kind === 'board' && b.kind === 'board') return a.slug === b.slug;
  return false;
}

export function getSocket(mode: AuthMode): Socket {
  if (socket && currentMode && sameMode(currentMode, mode)) return socket;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentMode = mode;
  socket = io(import.meta.env.VITE_WS_URL || 'http://localhost:3002', {
    transports: ['websocket'],
    autoConnect: true,
    auth: mode.kind === 'staff'
      ? { token: mode.token }
      : { boardSlug: mode.slug },
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized' || err.message?.startsWith?.('unauthorized')) {
      // Не зацикливать ретрай — отключаемся и форсируем reload для подхвата нового кода/токена
      socket?.disconnect();
      socket = null;
      currentMode = null;
      // Чуть-чуть задержки чтобы не сделать reload до того, как пользователь успел увидеть UI
      setTimeout(() => window.location.reload(), 1000);
    }
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  currentMode = null;
}
```

- [ ] **Step 2: Frontend tsc (ожидаются ошибки в потребителях)**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: TS-ошибки в 4 файлах: `useQueueSocket.ts`, `BoardView.tsx`, `useCallNotifications.ts`, `DisplayBoard.tsx` — все на тему «argument of type ... not assignable to AuthMode». Это нормально, чиним в следующем шаге.

- [ ] **Step 3: Коммит (поломанная сборка — фикс в Task 9)**

Делаем коммит на промежуточном состоянии, чтобы изменения lib/socket.ts были логически отделены от потребителей.

```bash
git add apps/frontend/src/lib/socket.ts
git commit -m "refactor(socket): auth-aware singleton + auto-reload-on-unauthorized

Введён обязательный параметр AuthMode (staff с token либо board с slug).
Потребители обновляются следующим коммитом — фронт временно не компилируется."
```

---

## Task 9: Frontend — обновить всех потребителей socket

**Files:**
- Modify: `apps/frontend/src/components/registrar/useQueueSocket.ts`
- Modify: `apps/frontend/src/components/board/BoardView.tsx`
- Modify: `apps/frontend/src/components/board/useCallNotifications.ts`
- Modify: `apps/frontend/src/components/DisplayBoard.tsx`

### 9.1 — useQueueSocket.ts (staff)

- [ ] **Step 1: Передавать token**

Заменить содержимое `apps/frontend/src/components/registrar/useQueueSocket.ts`:

```typescript
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';

export function useQueueSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;  // не залогинены — WS не нужен

    const socket = getSocket({ kind: 'staff', token });

    const handleQueueUpdated = () => {
      queryClient.invalidateQueries({ queryKey: [['queue', 'getByDoctor']] });
      queryClient.invalidateQueries({ queryKey: [['assignments', 'getActive']] });
    };

    socket.on('queue:updated', handleQueueUpdated);
    socket.on('queue:called', handleQueueUpdated);
    socket.on('assignment:created', handleQueueUpdated);
    socket.on('assignment:ended', handleQueueUpdated);

    return () => {
      socket.off('queue:updated', handleQueueUpdated);
      socket.off('queue:called', handleQueueUpdated);
      socket.off('assignment:created', handleQueueUpdated);
      socket.off('assignment:ended', handleQueueUpdated);
    };
  }, [queryClient]);
}
```

### 9.2 — useCallNotifications.ts (board)

- [ ] **Step 2: Принимать slug из props и передавать в getSocket**

В `apps/frontend/src/components/board/useCallNotifications.ts`:

Расширить interface `Options`:

```typescript
interface Options {
  slug: string;                // <-- НОВОЕ
  cabinetIds: string[];
  board: BoardAudio;
  backendBaseUrl: string;
  onCall: (event: CallEvent) => void;
}
```

В сигнатуре функции добавить `slug`:

```typescript
export function useCallNotifications({ slug, cabinetIds, board, backendBaseUrl, onCall }: Options) {
```

В useEffect где `const socket = getSocket();` (строка 93) заменить на:

```typescript
const socket = getSocket({ kind: 'board', slug });
```

### 9.3 — BoardView.tsx (board)

- [ ] **Step 3: Передавать slug в useCallNotifications и в getSocket**

В `apps/frontend/src/components/board/BoardView.tsx` найти вызов `useCallNotifications({ ... })` и добавить `slug`:

```typescript
const { onOverlayDismissed } = useCallNotifications({
  slug,            // <-- из props BoardView
  cabinetIds,
  board,
  backendBaseUrl,
  onCall: ...,
});
```

Найти строку `socket.on('queue:updated', refresh)` (строка ~51). Перед ней добавить:

```typescript
const socket = getSocket({ kind: 'board', slug });
```

Если уже есть `const socket = getSocket();` — заменить эту строку. Убедиться, что `getSocket` импортирован:

```typescript
import { getSocket } from '@/lib/socket';
```

### 9.4 — DisplayBoard.tsx (это STAFF клиент!)

- [ ] **Step 4: Передавать token (DisplayBoard это admin panel, не публичное табло)**

В `apps/frontend/src/components/DisplayBoard.tsx` заменить `const socket = getSocket();` (строка 35) на:

```typescript
const token = localStorage.getItem('auth_token');
if (!token) return;
const socket = getSocket({ kind: 'staff', token });
```

Поскольку это внутри useEffect, weight рефактор:

```typescript
useEffect(() => {
  const token = localStorage.getItem('auth_token');
  if (!token) return;
  const socket = getSocket({ kind: 'staff', token });
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
```

- [ ] **Step 5: Frontend tsc — должен пройти чисто**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit && echo FRONTEND_OK
```

Expected: `FRONTEND_OK`. Если ошибки — самая частая: забыли передать `slug` в `useCallNotifications` из BoardView. Проверить пропы.

- [ ] **Step 6: Smoke check в браузере**

Открыть в браузере регистратуру и табло (`/board/<slug>`). Действие в регистратуре → callNext. **Это всё ещё не должно работать** — потому что сервер (Task 6) уже шлёт в комнаты, а сокеты ещё не в комнатах (handshake обновим в Task 10). UI будет молчать. **Это ожидаемо.** Идём дальше.

- [ ] **Step 7: Коммит**

```bash
git add apps/frontend/src/components/registrar/useQueueSocket.ts \
        apps/frontend/src/components/board/BoardView.tsx \
        apps/frontend/src/components/board/useCallNotifications.ts \
        apps/frontend/src/components/DisplayBoard.tsx
git commit -m "refactor(socket-consumers): передавать auth (token/slug) в getSocket"
```

---

## Task 10: EventsGateway — JWT/slug handshake + room joining

**Files:**
- Modify: `apps/backend/src/events/events.gateway.ts`

**Контекст:** Финальный flip. Handshake проверяет auth, кладёт в комнаты. Анонимы отвергнуты. Этот шаг **разморозит** UI (Task 6+9 уже подготовлены).

- [ ] **Step 1: Импорт AuthUser и TrpcService.verifyToken**

В начале `events.gateway.ts`:

```typescript
import { TrpcService } from '../trpc/trpc.service';
// AuthUser определён в trpc.service.ts — проверь, экспортируется ли. Если нет — добавь export.
```

Проверить:
```bash
grep -n "AuthUser\|export.*AuthUser" /home/administrator/projects_danik/apps/backend/src/trpc/trpc.service.ts
```

Если интерфейс не экспортируется — добавить `export` перед `interface AuthUser` в `trpc.service.ts`.

- [ ] **Step 2: Определить тип socket.data**

В `events.gateway.ts`, перед классом `EventsGateway`:

```typescript
import type { AuthUser } from '../trpc/trpc.service';

type SocketContext =
  | { kind: 'staff'; user: AuthUser }
  | { kind: 'board'; slug: string; cabinetIds: string[] };
```

- [ ] **Step 3: Переписать handleConnection с auth-логикой**

Заменить:

```typescript
handleConnection(client: Socket) {
  console.log(`[WS] Client connected: ${client.id}`);
}
```

На:

```typescript
async handleConnection(client: Socket) {
  const auth = client.handshake.auth as { token?: string; boardSlug?: string };

  // Приоритет token. Если он есть — игнорируем boardSlug.
  if (auth.token) {
    const user = TrpcService.verifyToken(auth.token);
    if (!user) {
      console.log(`[WS] Rejected: invalid token (${client.id})`);
      client.disconnect(true);
      return;
    }
    const context: SocketContext = { kind: 'staff', user };
    client.data = context;
    this.joinStaffRooms(client, user);
    console.log(`[WS] Staff connected: ${user.username} (${user.role})`);
    return;
  }

  if (auth.boardSlug) {
    const board = await this.prisma.displayBoard.findUnique({
      where: { slug: auth.boardSlug },
      select: { id: true, cabinets: { select: { cabinetId: true } } },
    });
    if (!board) {
      console.log(`[WS] Rejected: unknown board slug ${auth.boardSlug} (${client.id})`);
      client.emit('connect_error', { message: 'unauthorized: unknown board' });
      client.disconnect(true);
      return;
    }
    const cabinetIds = board.cabinets.map((c) => c.cabinetId);
    const context: SocketContext = { kind: 'board', slug: auth.boardSlug, cabinetIds };
    client.data = context;
    // board:{slug} — для TTS-критичного queue:called с cabinet-фильтром
    // board:all — для общих refetch-триггеров queue:updated и assignment:*
    client.join(`board:${auth.boardSlug}`);
    client.join('board:all');
    console.log(`[WS] Board connected: ${auth.boardSlug} (cabinets=${cabinetIds.length})`);
    return;
  }

  console.log(`[WS] Rejected: no credentials (${client.id})`);
  client.emit('connect_error', { message: 'unauthorized: no credentials' });
  client.disconnect(true);
}

private joinStaffRooms(client: Socket, user: AuthUser): void {
  const wideAccessRoles = ['ADMIN', 'DIRECTOR', 'REGISTRAR', 'CALL_CENTER'];
  if (wideAccessRoles.includes(user.role)) {
    client.join('staff:all');
  } else if (user.role === 'DEPT_REGISTRAR' || user.role === 'DEPARTMENT_HEAD') {
    if (user.departmentId) client.join(`department:${user.departmentId}`);
  } else if (user.role === 'DOCTOR') {
    client.join(`doctor:${user.id}`);
  }
}
```

**Важно для emit-роутинга:** в Task 6 мы используем `getStaffRoomsFor()` который кладёт события в `staff:all`, `doctor:X`, `department:Y` для каждого события очереди. Но `DEPT_REGISTRAR` НЕ в `staff:all`. Это правильно — он не должен видеть события чужих отделений. Но **`DOCTOR`** в `doctor:{id}` не получит события **другого** врача, который только что записал пациента — ему и не надо. Если врач сам себя обновляет — событие летит в `doctor:{его_id}` через `getStaffRoomsFor({doctorId: его_id})`. Должно работать.

Двойной check: `DEPARTMENT_HEAD` сидит только в `department:{id}` — события для врача его отделения попадут (потому что emit ставит `department:${doctorDeptId}`). ✓

- [ ] **Step 4: tsc + docker logs**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
docker logs eque-backend --tail 30 2>&1 | tail -15
```

Expected: tsc чист. В логах при первом подключении залогиненного клиента — `[WS] Staff connected: <username> (<role>)`. При подключении табло — `[WS] Board connected: <slug>`.

- [ ] **Step 5: Smoke test в браузере — критический момент**

1. Открыть регистратуру (`http://192.168.10.213:3003`) → залогиниться
2. В другой вкладке открыть `/board/<существующий-slug>`
3. В третьей вкладке открыть кабинет врача (если есть локально)
4. В регистратуре записать пациента к врачу, кабинет которого включён в табло → callNext
5. Проверить:
   - В регистратуре список очереди обновился (real-time через WS)
   - На табло активный вызов появился, TTS проговорил
   - Если есть аккаунт врача — врач получил уведомление

Если что-то не работает — диагностика:
- `docker logs eque-backend --tail 50` — смотреть, какие комнаты использует emit, какие сокеты в каких комнатах
- DevTools → Network → WS frames — смотреть, какие payload'ы приходят клиенту

- [ ] **Step 6: Проверить, что анонимные сокеты отвергаются**

Открыть DevTools на любой странице, в Console:

```javascript
const s = io('http://192.168.10.213:3002', { transports: ['websocket'] });
s.on('connect_error', (e) => console.log('REJECTED:', e.message));
```

Expected: в консоли `REJECTED: unauthorized: no credentials` (или сразу disconnect). Если соединение установилось — handshake-проверка не работает.

- [ ] **Step 7: Коммит**

```bash
git add apps/backend/src/events/events.gateway.ts apps/backend/src/trpc/trpc.service.ts
git commit -m "feat(events): JWT/slug handshake + room joining (anonymous отклоняются)"
```

---

## Task 11: UserContext — disconnect socket на logout

**Files:**
- Modify: `apps/frontend/src/contexts/UserContext.tsx`

- [ ] **Step 1: Импорт disconnectSocket и вызов в logout**

В `apps/frontend/src/contexts/UserContext.tsx`:

Добавить импорт после строки 1:

```typescript
import { disconnectSocket } from '@/lib/socket';
```

Заменить функцию `logout` (строки 54-58):

```typescript
const logout = () => {
  disconnectSocket();
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  setUser(null);
};
```

- [ ] **Step 2: Frontend tsc**

```bash
cd /home/administrator/projects_danik/apps/frontend && npx tsc --noEmit && echo FRONTEND_OK
```

- [ ] **Step 3: Коммит**

```bash
git add apps/frontend/src/contexts/UserContext.tsx
git commit -m "fix(auth): отключать WebSocket при logout"
```

---

## Task 12: Cleanup — удалить устаревшие методы

**Files:**
- Modify: `apps/backend/src/events/events.gateway.ts`

- [ ] **Step 1: Удалить методы `emit()` и `emitToDoctor()`**

В `events.gateway.ts` найти и удалить блоки:

```typescript
/**
 * @deprecated Use typed emit methods ...
 */
emit(event: string, data: any) {
  this.server.emit(event, data);
}

/**
 * @deprecated Use emitQueueCalled with cabinet info.
 */
emitToDoctor(doctorId: string, event: string, data: any) {
  this.server.to(`doctor:${doctorId}`).emit(event, data);
}
```

- [ ] **Step 2: Подтвердить отсутствие потребителей**

```bash
grep -rn "events\.emit\b\|events\.emitToDoctor\b\|eventsGateway\.emit\b\|eventsGateway\.emitToDoctor\b" \
  /home/administrator/projects_danik/apps/backend/src 2>/dev/null
```

Expected: пусто. Если что-то находится — мигрировать на типизированный метод и снова попробовать удалить.

- [ ] **Step 3: tsc + docker logs**

```bash
cd /home/administrator/projects_danik/apps/backend && npx tsc --noEmit
docker logs eque-backend --tail 10 2>&1 | tail -5
```

- [ ] **Step 4: Коммит**

```bash
git add apps/backend/src/events/events.gateway.ts
git commit -m "chore(events): удалить устаревшие emit() и emitToDoctor()"
```

---

## Task 13: Финальный smoke test по чеклисту спеки

**Контекст:** Полная проверка функционала по чеклисту из `docs/superpowers/specs/2026-05-30-websocket-jwt-rooms-design.md`, секция «План верификации».

- [ ] **Step 1: Anonymous WS denied**

В DevTools-консоли любой страницы:
```javascript
const s = io('http://192.168.10.213:3002', { transports: ['websocket'] });
s.on('connect_error', e => console.log('REJECT:', e.message));
s.on('disconnect', r => console.log('DISCONNECT:', r));
```
Expected: `REJECT: unauthorized: no credentials` ИЛИ disconnect в течение секунды.

- [ ] **Step 2: Board slug works**

Открыть `/board/<реальный-slug>` в браузере. В консоли:
```javascript
io.sockets // (или из React DevTools на BoardView)
```
Не критично — главное проверить шаг 8 ниже.

- [ ] **Step 3: Wrong slug denied**

В DevTools:
```javascript
const s = io('http://192.168.10.213:3002', {
  transports: ['websocket'],
  auth: { boardSlug: 'definitely-not-a-real-slug-12345' },
});
s.on('connect_error', e => console.log('REJECT:', e.message));
s.on('disconnect', r => console.log('DISCONNECT:', r));
```
Expected: `REJECT: unauthorized: unknown board` ИЛИ disconnect.

- [ ] **Step 4: Staff token works**

Залогиниться как регистратор → подключиться к Socket через DevTools (или просто использовать UI). В логах бэка: `[WS] Staff connected: <username> (REGISTRAR)`. Открытие регистратуры → список очереди обновляется в реальном времени при действиях в другой вкладке.

- [ ] **Step 5: No PII over wire (staff)**

В DevTools → Network → выбрать WS-frame → во время callNext в регистратуре смотреть на входящий `queue:called`. Структура:
```json
{ "type": "queue:called", "doctorId": "...", "departmentId": "...", "entryId": "...", "cabinetId": "..." }
```
**НЕ должно быть** `patient`, `firstName`, `lastName`, `entry.patient.*`. Если есть — staffPayload собирается неправильно.

- [ ] **Step 6: No PII over wire (board, no consent)**

Сделать запись через киоск с **отказом** от displayConsent. В DevTools на странице `/board/<slug>` смотреть WS-frame для `queue:called` после callNext:
```json
{ "cabinetId": "...", "cabinetNumber": "...", "queueNumber": ...,
  "patientFirstName": null, "patientLastName": null, "patientMiddleName": "" }
```

- [ ] **Step 7: PII present (board, consent=true)**

Сделать запись через регистратора (всегда consent=true). После callNext WS-frame на табло:
```json
{ "patientFirstName": "Имя", "patientLastName": "Фамилия", "patientMiddleName": "..." }
```

- [ ] **Step 8: TTS works (consent=true)**

Запись через регистратора → callNext → табло проговаривает «Имя Фа., кабинет N» или согласно `ttsTemplate`.

- [ ] **Step 9: TTS works (consent=false)**

Запись через киоск БЕЗ согласия → callNext → табло проговаривает «Номер N, кабинет M».

- [ ] **Step 10: Doctor scoping**

Залогиниться двумя браузерами как два разных врача из разных отделений (`doctor1` и `doctor2` если есть, либо создать тестового). CallNext врача A. В DevTools → WS-frames у врача B: НЕ должно быть события.

- [ ] **Step 11: Board scoping**

Открыть два табло разных кабинетов (`/board/slug1` и `/board/slug2`). CallNext в кабинете табло 1. На табло 2 TTS НЕ запускается, обновлений нет.

- [ ] **Step 12: Auto-reload-on-unauthorized**

В DevTools страницы регистратора:
```javascript
localStorage.removeItem('auth_token');
```
(токен удалён, но сокет ещё подключён). Затем рестартануть бэк:
```bash
docker restart eque-backend
```

Сокет реконнектится без токена → `unauthorized` → клиент через 1 сек делает `window.location.reload()` → страница перезагружается → редирект на login. Expected: страница сама перезагрузилась.

- [ ] **Step 13: Если всё прошло — финальный коммит-маркер (опционально)**

```bash
cd /home/administrator/projects_danik
git log --oneline | head -15
```

Никаких изменений в коде — только убедиться, что вся фича в истории и последний коммит — это Task 12.

---

## После плана

- Обновить вики:
  - `~/.wiki/wiki/projects/eque/eque-hot.md` — снять техдолг #2 (WebSocket)
  - `~/.wiki/wiki/projects/eque/eque-decisions.md` — пометить ADR-006 как `resolved`, добавить ADR-021 о новой архитектуре
  - `~/.wiki/wiki/projects/eque/eque-patterns.md` — обновить Gotcha-4 (resolved), добавить паттерн WS-handshake
- Деплой рекомендован ночью (~04:00), когда табло сами reload по таймеру (`useCallNotifications.ts:122-131`)
- Уведомить Danik о необходимости F5 на устройствах, если деплой днём (auto-reload должен сработать сам, но руками надёжнее)

---

## Self-review notes

**Spec coverage check:**
- ADR-006 утечка через emit — Task 6 (раздельные payload'ы)
- Anonymous denied — Task 10 (handshake reject)
- Slug-as-capability — Task 10
- Rooms по ролям — Task 10 `joinStaffRooms`
- Board cache — Task 2 + Task 3
- Auto-reload — Task 8
- Logout disconnects — Task 11
- displayConsent server-side — Task 6 `emitQueueCalled`
- Smoke tests из спеки — Task 13

**Type consistency:** все методы используют единые сигнатуры из `event-types.ts` (StaffEvent, BoardCallEvent). Имена комнат (`staff:all`, `department:${id}`, `doctor:${id}`, `board:${slug}`) согласованы между handshake (Task 10) и emit (Task 6).

**Scope:** одна связная итерация, без посторонних рефакторингов.
