# Display Board Constructor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать конструктор именованных табло электронной очереди: ADMIN создаёт доски через AdminPanel, каждая доска доступна по `/board/:slug` без авторизации и отображает активные вызовы + очередь по привязанным кабинетам с аудио-оповещением.

**Architecture:** Backend — новые Prisma-модели `DisplayBoard`/`DisplayBoardCabinet`, tRPC-роутер `displayBoards` (CRUD), расширение `display.router.ts` процедурой `getBySlug` (публичная), REST-эндпоинт `/api/sounds/upload` с Multer, обогащение `queue:called` события `cabinetId`/`cabinetNumber` через lookup `DoctorAssignment`. Frontend — набор компонентов в `board/`, хук `useCallNotifications` с очередью уведомлений и аудио, компоненты `BoardsTab`/`BoardDialog` в AdminPanel.

**Tech Stack:** NestJS + tRPC + Prisma (backend), React + Vite + Tailwind + shadcn/ui (frontend), Socket.IO, Web Speech API, Multer, pnpm monorepo.

---

## File Map

### Создать
- `apps/backend/src/modules/displayBoards/displayBoards.router.ts`
- `apps/backend/src/modules/display/sounds.controller.ts`
- `apps/backend/src/modules/display/sounds.module.ts`
- `apps/frontend/src/components/board/BoardView.tsx`
- `apps/frontend/src/components/board/BoardHeader.tsx`
- `apps/frontend/src/components/board/ActiveCallsPanel.tsx`
- `apps/frontend/src/components/board/QueuePanel.tsx`
- `apps/frontend/src/components/board/CallOverlay.tsx`
- `apps/frontend/src/components/board/useCallNotifications.ts`
- `apps/frontend/src/components/admin/BoardsTab.tsx`
- `apps/frontend/src/components/admin/BoardDialog.tsx`

### Изменить
- `apps/backend/prisma/schema.prisma` — добавить модели DisplayBoard, DisplayBoardCabinet, back-relation в Cabinet
- `apps/backend/src/modules/display/display.router.ts` — добавить `getBySlug`
- `apps/backend/src/modules/queue/queue.router.ts` — обогатить `queue:called` payload в `callNext` и `callSpecific`
- `apps/backend/src/trpc/trpc.router.ts` — зарегистрировать `displayBoards`
- `apps/backend/src/app.module.ts` — добавить `SoundsModule`
- `apps/backend/src/main.ts` — настроить static assets для `/public`
- `apps/frontend/src/App.tsx` — роутинг `/board/:slug`
- `apps/frontend/src/components/AdminPanel.tsx` — вкладка "Табло"

---

## Task 1: Prisma schema — DisplayBoard + миграция

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Добавить модели в schema.prisma**

Открой `apps/backend/prisma/schema.prisma`. Найди строку с `model Cabinet` (строка ~138). Добавь обратную связь в модель Cabinet — вставь `boards DisplayBoardCabinet[]` перед `createdAt`:

```prisma
model Cabinet {
  id           String  @id @default(cuid())
  number       String  @unique
  name         String?
  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id])
  isActive     Boolean @default(true)

  assignments DoctorAssignment[]
  boards      DisplayBoardCabinet[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("cabinets")
}
```

Затем в конец файла (перед последней закрывающей скобкой, если есть, или просто в конец) добавь:

```prisma
// ============================================================================
// DISPLAY BOARDS
// ============================================================================

model DisplayBoard {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  columns     Int      @default(3)
  audioMode   String   @default("SOUND")
  ttsTemplate String   @default("{lastName} пройдите в кабинет {cabinet}")
  soundUrl    String?
  cabinets    DisplayBoardCabinet[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("display_boards")
}

model DisplayBoardCabinet {
  boardId   String
  cabinetId String
  board     DisplayBoard @relation(fields: [boardId],   references: [id], onDelete: Cascade)
  cabinet   Cabinet      @relation(fields: [cabinetId], references: [id])

  @@id([boardId, cabinetId])
  @@map("display_board_cabinets")
}
```

- [ ] **Step 2: Запустить миграцию**

```bash
cd apps/backend && npx prisma migrate dev --name display_boards
```

Ожидаемый вывод:
```
✔ Generated Prisma Client
The following migration(s) have been created and applied from new schema changes:
migrations/YYYYMMDDHHMMSS_display_boards/
```

- [ ] **Step 3: Убедиться что Prisma Client сгенерирован**

```bash
cd apps/backend && npx prisma generate
```

Ожидаемый вывод: `✔ Generated Prisma Client`

- [ ] **Step 4: Коммит**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(db): модели DisplayBoard и DisplayBoardCabinet"
```

---

## Task 2: displayBoards tRPC router + регистрация

**Files:**
- Create: `apps/backend/src/modules/displayBoards/displayBoards.router.ts`
- Modify: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 1: Создать router**

Создай файл `apps/backend/src/modules/displayBoards/displayBoards.router.ts`:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const BoardInput = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Только строчные латинские буквы, цифры и дефис'),
  columns: z.number().int().min(2).max(4).default(3),
  audioMode: z.enum(['SOUND', 'SOUND_TTS']).default('SOUND'),
  ttsTemplate: z.string().default('{lastName} пройдите в кабинет {cabinet}'),
  soundUrl: z.string().optional(),
  cabinetIds: z.array(z.string()),
});

export const createDisplayBoardsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async ({ ctx }) => {
      if (!['ADMIN', 'DIRECTOR'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
      }
      return prisma.displayBoard.findMany({
        include: {
          cabinets: {
            include: { cabinet: { select: { id: true, number: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

    create: trpc.protectedProcedure
      .input(BoardInput)
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { cabinetIds, ...data } = input;
        return prisma.displayBoard.create({
          data: {
            ...data,
            cabinets: {
              create: cabinetIds.map((cabinetId) => ({ cabinetId })),
            },
          },
          include: {
            cabinets: {
              include: { cabinet: { select: { id: true, number: true, name: true } } },
            },
          },
        });
      }),

    update: trpc.protectedProcedure
      .input(z.object({ id: z.string() }).merge(BoardInput.partial()))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { id, cabinetIds, ...data } = input;
        return prisma.$transaction(async (tx) => {
          if (cabinetIds !== undefined) {
            await tx.displayBoardCabinet.deleteMany({ where: { boardId: id } });
            await tx.displayBoardCabinet.createMany({
              data: cabinetIds.map((cabinetId) => ({ boardId: id, cabinetId })),
            });
          }
          return tx.displayBoard.update({
            where: { id },
            data,
            include: {
              cabinets: {
                include: { cabinet: { select: { id: true, number: true, name: true } } },
              },
            },
          });
        });
      }),

    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        return prisma.displayBoard.delete({ where: { id: input.id } });
      }),
  });
};
```

- [ ] **Step 2: Зарегистрировать в trpc.router.ts**

Открой `apps/backend/src/trpc/trpc.router.ts`. Добавь импорт после последнего `import`:

```typescript
import { createDisplayBoardsRouter } from '../modules/displayBoards/displayBoards.router';
```

Добавь в `appRouter` после строки с `display:`:

```typescript
    displayBoards: createDisplayBoardsRouter(this.trpc, this.prisma),
```

- [ ] **Step 3: Проверить что бэкенд собирается**

```bash
cd apps/backend && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Step 4: Коммит**

```bash
git add apps/backend/src/modules/displayBoards/ apps/backend/src/trpc/trpc.router.ts
git commit -m "feat(displayBoards): tRPC CRUD роутер"
```

---

## Task 3: display.router.ts — добавить getBySlug (публичный)

**Files:**
- Modify: `apps/backend/src/modules/display/display.router.ts`

- [ ] **Step 1: Добавить getBySlug в display.router.ts**

Открой `apps/backend/src/modules/display/display.router.ts`. Добавь `getBySlug` в объект роутера после существующего `getBoard`:

```typescript
    getBySlug: trpc.procedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const board = await prisma.displayBoard.findUnique({
          where: { slug: input.slug },
          include: {
            cabinets: {
              include: { cabinet: { select: { id: true, number: true, name: true } } },
            },
          },
        });

        if (!board) throw new TRPCError({ code: 'NOT_FOUND', message: 'Табло не найдено' });

        const cabinetIds = board.cabinets.map((c) => c.cabinetId);

        // Get active doctor assignments for these cabinets
        const assignments = await prisma.doctorAssignment.findMany({
          where: { cabinetId: { in: cabinetIds }, isActive: true },
          include: { cabinet: { select: { id: true, number: true, name: true } } },
        });

        const doctorIds = assignments.map((a) => a.doctorId);
        const cabinetByDoctorId = Object.fromEntries(
          assignments.map((a) => [a.doctorId, a.cabinet]),
        );

        // Active calls: IN_PROGRESS or CALLED
        const activeEntries = await prisma.queueEntry.findMany({
          where: { doctorId: { in: doctorIds }, status: { in: ['CALLED', 'IN_PROGRESS'] } },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: { calledAt: 'asc' },
        });

        // Queue: WAITING_ARRIVAL and ARRIVED
        const queueEntries = await prisma.queueEntry.findMany({
          where: { doctorId: { in: doctorIds }, status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] } },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: [{ createdAt: 'asc' }],
        });

        const activeCalls = activeEntries.map((e) => ({
          cabinetNumber: cabinetByDoctorId[e.doctorId]?.number ?? '?',
          cabinetName:   cabinetByDoctorId[e.doctorId]?.name ?? null,
          patientLastName:  e.patient.lastName,
          patientFirstName: e.patient.firstName,
          calledAt: e.calledAt,
        }));

        const queue = queueEntries.map((e) => ({
          queueNumber:      e.queueNumber,
          priority:         e.priority,
          patientLastName:  e.patient.lastName,
          patientFirstName: e.patient.firstName,
          cabinetNumber:    cabinetByDoctorId[e.doctorId]?.number ?? '?',
        }));

        return {
          board: {
            id:          board.id,
            name:        board.name,
            slug:        board.slug,
            columns:     board.columns,
            audioMode:   board.audioMode,
            ttsTemplate: board.ttsTemplate,
            soundUrl:    board.soundUrl,
          },
          cabinetIds,
          activeCalls,
          queue,
        };
      }),
```

Также добавь в начало файла импорты, которых нет:

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
```

(Если уже есть — не дублировать.)

- [ ] **Step 2: Проверить компиляцию**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 3: Коммит**

```bash
git add apps/backend/src/modules/display/display.router.ts
git commit -m "feat(display): getBySlug — публичный endpoint для табло по slug"
```

---

## Task 4: Обогатить queue:called — добавить cabinetId/cabinetNumber

**Files:**
- Modify: `apps/backend/src/modules/queue/queue.router.ts`

Сейчас `queue:called` эмитирует `{ doctorId, entry }`. Нужно добавить `cabinetId` и `cabinetNumber`, чтобы фронт мог фильтровать события по кабинету.

- [ ] **Step 1: Изменить callNext — lookup DoctorAssignment перед emit**

Найди в `queue.router.ts` строки (около 270-275):

```typescript
        events.emit('queue:called', { doctorId: input.doctorId, entry: called });
        events.emit('queue:updated', { doctorId: input.doctorId, entry: called });
        return { called };
      }),
```

Замени на:

```typescript
        const assignment = await prisma.doctorAssignment.findFirst({
          where: { doctorId: input.doctorId, isActive: true },
          include: { cabinet: { select: { id: true, number: true } } },
        });

        events.emit('queue:called', {
          doctorId: input.doctorId,
          cabinetId:     assignment?.cabinetId ?? null,
          cabinetNumber: assignment?.cabinet.number ?? null,
          entry: called,
        });
        events.emit('queue:updated', { doctorId: input.doctorId, entry: called });
        return { called };
      }),
```

- [ ] **Step 2: Изменить callSpecific — аналогично**

Найди в `queue.router.ts` строки около 325-330 (конец callSpecific):

```typescript
        events.emit('queue:called', { doctorId: entry.doctorId, entry: called });
        events.emit('queue:updated', { doctorId: entry.doctorId, entry: called });
        return { called };
      }),
```

Замени на:

```typescript
        const assignment = await prisma.doctorAssignment.findFirst({
          where: { doctorId: entry.doctorId, isActive: true },
          include: { cabinet: { select: { id: true, number: true } } },
        });

        events.emit('queue:called', {
          doctorId: entry.doctorId,
          cabinetId:     assignment?.cabinetId ?? null,
          cabinetNumber: assignment?.cabinet.number ?? null,
          entry: called,
        });
        events.emit('queue:updated', { doctorId: entry.doctorId, entry: called });
        return { called };
      }),
```

- [ ] **Step 3: Проверить компиляцию**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 4: Коммит**

```bash
git add apps/backend/src/modules/queue/queue.router.ts
git commit -m "feat(queue): обогатить queue:called событие cabinetId и cabinetNumber"
```

---

## Task 5: Sounds upload — REST controller + static serving

**Files:**
- Create: `apps/backend/src/modules/display/sounds.controller.ts`
- Create: `apps/backend/src/modules/display/sounds.module.ts`
- Modify: `apps/backend/src/app.module.ts`
- Modify: `apps/backend/src/main.ts`

- [ ] **Step 1: Установить multer**

```bash
cd apps/backend && pnpm add multer @types/multer
```

Ожидаемый вывод: пакеты добавлены в `apps/backend/package.json`.

- [ ] **Step 2: Создать директорию для звуков**

```bash
mkdir -p apps/backend/public/sounds
touch apps/backend/public/sounds/.gitkeep
```

- [ ] **Step 3: Создать sounds.controller.ts**

Создай `apps/backend/src/modules/display/sounds.controller.ts`:

```typescript
import {
  Controller, Post, UploadedFile, UseInterceptors,
  UnauthorizedException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Req } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { TrpcService } from '../../trpc/trpc.service';

@Controller('api/sounds')
export class SoundsController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(__dirname, '..', '..', '..', '..', 'public', 'sounds'),
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (/\.(mp3|wav|ogg)$/.test(file.originalname.toLowerCase())) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Только .mp3, .wav, .ogg'), false);
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  uploadSound(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    const auth = req.headers.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    const user = TrpcService.verifyToken(auth.substring(7));
    if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Только ADMIN');

    if (!file) throw new BadRequestException('Файл не загружен');

    return { soundUrl: `/sounds/${file.filename}` };
  }
}
```

- [ ] **Step 4: Создать sounds.module.ts**

Создай `apps/backend/src/modules/display/sounds.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SoundsController } from './sounds.controller';
import { TrpcModule } from '../../trpc/trpc.module';

@Module({
  imports: [TrpcModule],
  controllers: [SoundsController],
})
export class SoundsModule {}
```

- [ ] **Step 5: Зарегистрировать SoundsModule в AppModule**

Открой `apps/backend/src/app.module.ts`. Замени полностью:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';
import { SoundsModule } from './modules/display/sounds.module';

@Module({
  imports: [PrismaModule, TrpcModule, EventsModule, SoundsModule],
})
export class AppModule {}
```

- [ ] **Step 6: Настроить static assets в main.ts**

Открой `apps/backend/src/main.ts`. Замени полностью:

```typescript
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { TrpcRouter } from './trpc/trpc.router';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Serve uploaded sound files from public/
  app.useStaticAssets(join(__dirname, '..', 'public'));

  const trpc = app.get(TrpcRouter);
  await trpc.applyMiddleware(app);

  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  console.log(`🚀 Backend: http://localhost:${port}`);
  console.log(`🔗 tRPC: http://localhost:${port}/trpc`);
}

bootstrap();
```

- [ ] **Step 7: Проверить компиляцию**

```bash
cd apps/backend && npx tsc --noEmit
```

- [ ] **Step 8: Коммит**

```bash
git add apps/backend/src/modules/display/sounds.controller.ts \
        apps/backend/src/modules/display/sounds.module.ts \
        apps/backend/src/app.module.ts \
        apps/backend/src/main.ts \
        apps/backend/public/sounds/.gitkeep \
        apps/backend/package.json
git commit -m "feat(sounds): REST endpoint загрузки звуковых файлов"
```

---

## Task 6: App.tsx — роутинг /board/:slug

**Files:**
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Обновить App.tsx**

Открой `apps/frontend/src/App.tsx`. Добавь импорт `BoardView` рядом с существующим `DisplayBoard`:

```typescript
import { DisplayBoard } from '@/components/DisplayBoard';
import { BoardView } from '@/components/board/BoardView';
```

Найди и удали строку:

```typescript
const PUBLIC_ROUTES = ['/board'];
```

Найди:

```typescript
  if (PUBLIC_ROUTES.includes(path)) return <DisplayBoard />;
```

Замени на:

```typescript
  if (path.startsWith('/board/')) {
    const slug = path.replace('/board/', '').split('/')[0];
    return <BoardView slug={slug} />;
  }
```

Строку `case 'board': return <DisplayBoard />;` в `renderView()` **не трогай** — это вкладка "Табло" в интерфейсе ADMIN (глобальное табло, остаётся без изменений).

После правок верхняя часть `AppContent` должна выглядеть так:

```typescript
  if (path.startsWith('/board/')) {
    const slug = path.replace('/board/', '').split('/')[0];
    return <BoardView slug={slug} />;
  }

  if (isLoading) { ... }
  if (!user) return <Login />;
```

- [ ] **Step 3: Коммит**

```bash
git add apps/frontend/src/App.tsx
git commit -m "feat(routing): /board/:slug → BoardView"
```

---

## Task 7: useCallNotifications — очередь уведомлений + аудио

**Files:**
- Create: `apps/frontend/src/components/board/useCallNotifications.ts`

- [ ] **Step 1: Создать хук**

Создай `apps/frontend/src/components/board/useCallNotifications.ts`:

```typescript
import { useEffect, useRef, useCallback } from 'react';
import { getSocket } from '@/lib/socket';

export interface CallEvent {
  cabinetId: string | null;
  cabinetNumber: string | null;
  patientLastName: string;
  patientFirstName: string;
}

interface BoardAudio {
  audioMode: string;
  ttsTemplate: string;
  soundUrl: string | null | undefined;
}

interface Options {
  cabinetIds: string[];
  board: BoardAudio;
  backendBaseUrl: string;
  onCall: (event: CallEvent) => void;
}

export function useCallNotifications({ cabinetIds, board, backendBaseUrl, onCall }: Options) {
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const queueRef = useRef<CallEvent[]>([]);
  const processingRef = useRef(false);
  const cabinetIdsRef = useRef(cabinetIds);
  const onCallRef = useRef(onCall);

  useEffect(() => { cabinetIdsRef.current = cabinetIds; }, [cabinetIds]);
  useEffect(() => { onCallRef.current = onCall; }, [onCall]);

  const playAudio = useCallback((event: CallEvent) => {
    if (!board.soundUrl) return;

    const audio = audioRef.current;
    audio.src = `${backendBaseUrl}${board.soundUrl}`;

    if (board.audioMode === 'SOUND_TTS') {
      audio.onended = () => {
        const text = board.ttsTemplate
          .replace('{lastName}', event.patientLastName)
          .replace('{cabinet}', event.cabinetNumber ?? '');
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        window.speechSynthesis.speak(utterance);
      };
    } else {
      audio.onended = null;
    }

    audio.play().catch(() => {
      // Autoplay blocked — TTS only fallback
      if (board.audioMode === 'SOUND_TTS') {
        const text = board.ttsTemplate
          .replace('{lastName}', event.patientLastName)
          .replace('{cabinet}', event.cabinetNumber ?? '');
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        window.speechSynthesis.speak(utterance);
      }
    });
  }, [board, backendBaseUrl]);

  const processNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) { processingRef.current = false; return; }

    processingRef.current = true;
    playAudio(next);
    onCallRef.current(next);
  }, [playAudio]);

  // Expose processNext so CallOverlay can trigger it after dismiss
  const onOverlayDismissed = useCallback(() => {
    processingRef.current = false;
    processNext();
  }, [processNext]);

  useEffect(() => {
    const socket = getSocket();

    const handleCalled = (data: any) => {
      if (!data.cabinetId || !cabinetIdsRef.current.includes(data.cabinetId)) return;

      const event: CallEvent = {
        cabinetId:        data.cabinetId,
        cabinetNumber:    data.cabinetNumber,
        patientLastName:  data.entry?.patient?.lastName ?? '',
        patientFirstName: data.entry?.patient?.firstName ?? '',
      };

      queueRef.current.push(event);
      if (!processingRef.current) processNext();
    };

    socket.on('queue:called', handleCalled);
    return () => { socket.off('queue:called', handleCalled); };
  }, [processNext]);

  // Chrome 24/7: speechSynthesis keepalive
  useEffect(() => {
    const id = setInterval(() => window.speechSynthesis.resume(), 10_000);
    return () => clearInterval(id);
  }, []);

  // Chrome 24/7: daily reload at 04:00
  useEffect(() => {
    const now = new Date();
    const next4am = new Date(now);
    next4am.setHours(4, 0, 0, 0);
    if (next4am <= now) next4am.setDate(next4am.getDate() + 1);
    const ms = next4am.getTime() - now.getTime();
    const id = setTimeout(() => window.location.reload(), ms);
    return () => clearTimeout(id);
  }, []);

  return { onOverlayDismissed };
}
```

- [ ] **Step 2: Коммит**

```bash
git add apps/frontend/src/components/board/useCallNotifications.ts
git commit -m "feat(board): useCallNotifications — очередь вызовов + аудио"
```

---

## Task 8: CallOverlay — полноэкранный оверлей вызова

**Files:**
- Create: `apps/frontend/src/components/board/CallOverlay.tsx`

- [ ] **Step 1: Создать компонент**

Создай `apps/frontend/src/components/board/CallOverlay.tsx`:

```typescript
import { useEffect } from 'react';
import type { CallEvent } from './useCallNotifications';

interface Props {
  calls: CallEvent[];   // 1–3 активных вызова для показа
  onDismiss: () => void;
}

const SIZE = {
  one:   { patient: 145, arrow: 311, cabNum: 221, cabLabel: 62,  gap: 24, padding: '0 60px' },
  two:   { patient: 129, arrow: 238, cabNum: 168, cabLabel: 46,  gap: 20, padding: '0 48px' },
  three: { patient: 95,  arrow: 182, cabNum: 124, cabLabel: 34,  gap: 16, padding: '0 40px' },
} as const;

const CLS_MAP: Record<number, keyof typeof SIZE> = { 1: 'one', 2: 'two', 3: 'three' };

export function CallOverlay({ calls, onDismiss }: Props) {
  useEffect(() => {
    const id = setTimeout(onDismiss, 5_000);
    return () => clearTimeout(id);
  }, [calls, onDismiss]);

  if (calls.length === 0) return null;

  const key = CLS_MAP[Math.min(calls.length, 3)] ?? 'three';
  const sz = SIZE[key];

  return (
    <>
      <style>{`
        @keyframes bg-pulse {
          0%   { background: rgba(0,0,0,.93); }
          100% { background: rgba(0,18,14,.97); }
        }
        @keyframes strip-border {
          0%   { border-color: rgba(179,145,104,.08); box-shadow: none; }
          100% { border-color: rgba(179,145,104,.75); box-shadow: 0 0 28px rgba(179,145,104,.1); }
        }
        @keyframes gold-flash {
          0%   { opacity: .7; text-shadow: none; }
          100% { opacity: 1;  text-shadow: 0 0 30px rgba(179,145,104,.5); }
        }
        @keyframes arrow-move {
          0%   { color: rgba(255,255,255,.2); transform: translateY(-8%) translateX(-5px); }
          100% { color: rgba(255,255,255,.75); transform: translateY(-8%) translateX(5px); }
        }
      `}</style>

      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', flexDirection: 'column',
          animation: 'bg-pulse 0.5s ease-in-out infinite alternate',
          fontFamily: 'Montserrat, Segoe UI, system-ui, sans-serif',
        }}
        onClick={onDismiss}
      >
        {calls.slice(0, 3).map((call, i) => (
          <div
            key={i}
            style={{
              flex: 1, display: 'flex', flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center',
              gap: sz.gap, padding: sz.padding,
              borderBottom: i < calls.length - 1 ? '1px solid rgba(255,255,255,.06)' : 'none',
              position: 'relative',
            }}
          >
            {/* Border glow overlay */}
            <div style={{
              position: 'absolute', inset: '8px 16px', borderRadius: 14,
              animation: 'strip-border 0.5s ease-in-out infinite alternate',
              border: '2px solid transparent', pointerEvents: 'none',
            }} />

            {/* Patient name */}
            <span style={{
              flexShrink: 0, whiteSpace: 'nowrap',
              fontWeight: 900, color: '#B39168', lineHeight: 1,
              fontSize: sz.patient,
              animation: 'gold-flash 0.5s ease-in-out infinite alternate',
            }}>
              {call.patientLastName} {call.patientFirstName.charAt(0)}.
            </span>

            {/* Arrow */}
            <span style={{
              flexShrink: 0, alignSelf: 'center',
              lineHeight: 0.6, overflow: 'hidden',
              fontSize: sz.arrow,
              animation: 'arrow-move 0.5s ease-in-out infinite alternate',
            }}>
              →
            </span>

            {/* Cabinet */}
            <span style={{
              flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 10,
              lineHeight: 1, alignSelf: 'center',
            }}>
              <span style={{ fontWeight: 900, color: '#ffffff', fontSize: sz.cabNum }}>
                {call.cabinetNumber}
              </span>
              <span style={{ fontWeight: 400, color: 'rgba(255,255,255,.55)', fontSize: sz.cabLabel }}>
                каб.
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Коммит**

```bash
git add apps/frontend/src/components/board/CallOverlay.tsx
git commit -m "feat(board): CallOverlay — полноэкранный оверлей вызова"
```

---

## Task 9: BoardHeader + ActiveCallsPanel + QueuePanel

**Files:**
- Create: `apps/frontend/src/components/board/BoardHeader.tsx`
- Create: `apps/frontend/src/components/board/ActiveCallsPanel.tsx`
- Create: `apps/frontend/src/components/board/QueuePanel.tsx`

- [ ] **Step 1: Создать BoardHeader.tsx**

```typescript
import { useState, useEffect } from 'react';

interface Props {
  boardName: string;
}

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontWeight: 700, color: '#B39168', fontSize: 36, fontFamily: 'Montserrat, sans-serif', letterSpacing: '0.04em' }}>
      {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

export function BoardHeader({ boardName }: Props) {
  return (
    <div
      style={{
        height: 120, flexShrink: 0, background: '#00685B',
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center', padding: '0 32px',
      }}
    >
      {/* Left: logo */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img src="/logo.png" alt="" style={{ height: 72, objectFit: 'contain' }} />
      </div>

      {/* Center: board name */}
      <div style={{
        color: '#ffffff', fontWeight: 800, fontSize: 42,
        fontFamily: 'Montserrat, sans-serif', textAlign: 'center', letterSpacing: '0.01em',
      }}>
        {boardName}
      </div>

      {/* Right: clock */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <Clock />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Создать ActiveCallsPanel.tsx**

```typescript
interface ActiveCall {
  cabinetNumber: string;
  cabinetName: string | null;
  patientLastName: string;
  patientFirstName: string;
  calledAt: Date | string | null;
}

interface Props {
  calls: ActiveCall[];
}

export function ActiveCallsPanel({ calls }: Props) {
  return (
    <div style={{
      flex: '0 0 67%', display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,.06)', overflow: 'hidden',
      padding: '24px 32px', gap: 16,
    }}>
      <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 22, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        Активные вызовы
      </div>

      {calls.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 32, fontWeight: 500 }}>Ожидайте вызова</span>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
          {calls.map((call, i) => (
            <div
              key={i}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                gap: 20, padding: '12px 24px', borderRadius: 12,
                background: 'rgba(0,104,91,.15)', border: '1px solid rgba(0,104,91,.3)',
              }}
            >
              <span style={{ color: '#B39168', fontWeight: 800, fontSize: 48, lineHeight: 1, flexShrink: 0 }}>
                {call.patientLastName} {call.patientFirstName.charAt(0)}.
              </span>
              <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 72, lineHeight: 0.6, overflow: 'hidden', flexShrink: 0 }}>
                →
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                <span style={{ color: '#ffffff', fontWeight: 900, fontSize: 72, lineHeight: 1 }}>
                  {call.cabinetNumber}
                </span>
                <span style={{ color: 'rgba(255,255,255,.45)', fontSize: 20 }}>каб.</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Создать QueuePanel.tsx**

```typescript
import { useMemo } from 'react';

interface QueueEntry {
  queueNumber: number;
  priority: string;
  patientLastName: string;
  patientFirstName: string;
  cabinetNumber: string;
}

interface Props {
  queue: QueueEntry[];
  columns: number;
}

const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: '#ef4444',
  INPATIENT:  '#f97316',
  SCHEDULED:  '#eab308',
  WALK_IN:    '#22c55e',
};

const SCROLL_THRESHOLD = 8;

export function QueuePanel({ queue, columns }: Props) {
  const shouldScroll = queue.length > SCROLL_THRESHOLD;

  // Double the list for seamless CSS infinite scroll
  const displayList = useMemo(
    () => shouldScroll ? [...queue, ...queue] : queue,
    [queue, shouldScroll],
  );

  const scrollDuration = queue.length * 3; // 3s per item

  return (
    <div style={{
      flex: '0 0 33%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', padding: '24px 20px', gap: 12,
    }}>
      <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 22, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8, flexShrink: 0 }}>
        Очередь
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {shouldScroll && (
          <style>{`
            @keyframes scroll-up {
              0%   { transform: translateY(0); }
              100% { transform: translateY(-50%); }
            }
          `}</style>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 6,
            ...(shouldScroll ? {
              animation: `scroll-up ${scrollDuration}s linear infinite`,
            } : {}),
          }}
        >
          {displayList.map((entry, i) => (
            <div
              key={i}
              style={{
                display: 'flex', flexDirection: 'column',
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span style={{ color: 'rgba(255,255,255,.45)', fontSize: 13 }}>#{entry.queueNumber}</span>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLOR[entry.priority] ?? '#6b7280', flexShrink: 0 }} />
              </div>
              <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 16, marginTop: 2, lineHeight: 1.2 }}>
                {entry.patientLastName} {entry.patientFirstName.charAt(0)}.
              </span>
              <span style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginTop: 2 }}>
                каб. {entry.cabinetNumber}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/src/components/board/BoardHeader.tsx \
        apps/frontend/src/components/board/ActiveCallsPanel.tsx \
        apps/frontend/src/components/board/QueuePanel.tsx
git commit -m "feat(board): BoardHeader, ActiveCallsPanel, QueuePanel"
```

---

## Task 10: BoardView — корневой компонент табло

**Files:**
- Create: `apps/frontend/src/components/board/BoardView.tsx`

- [ ] **Step 1: Создать BoardView.tsx**

```typescript
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { getSocket } from '@/lib/socket';
import { useEffect } from 'react';
import { BoardHeader } from './BoardHeader';
import { ActiveCallsPanel } from './ActiveCallsPanel';
import { QueuePanel } from './QueuePanel';
import { CallOverlay } from './CallOverlay';
import { useCallNotifications } from './useCallNotifications';
import type { CallEvent } from './useCallNotifications';

interface Props {
  slug: string;
}

const BACKEND_BASE =
  (import.meta.env.VITE_TRPC_URL as string | undefined)?.replace('/trpc', '') ??
  'http://localhost:3002';

export function BoardView({ slug }: Props) {
  const queryClient = useQueryClient();
  const [overlayQueue, setOverlayQueue] = useState<CallEvent[]>([]);

  const { data, isLoading, isError } = trpc.display.getBySlug.useQuery(
    { slug },
    { staleTime: Infinity, gcTime: Infinity, retry: 3 },
  );

  const handleCall = useCallback((event: CallEvent) => {
    setOverlayQueue([event]);
  }, []);

  const { onOverlayDismissed } = useCallNotifications({
    cabinetIds: data?.cabinetIds ?? [],
    board: data?.board ?? { audioMode: 'SOUND', ttsTemplate: '', soundUrl: null },
    backendBaseUrl: BACKEND_BASE,
    onCall: handleCall,
  });

  const handleDismiss = useCallback(() => {
    setOverlayQueue([]);
    onOverlayDismissed();
    queryClient.invalidateQueries({ queryKey: [['display', 'getBySlug']] });
  }, [onOverlayDismissed, queryClient]);

  // Refresh on queue:updated
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [['display', 'getBySlug']] });
    };
    socket.on('queue:updated', refresh);
    return () => { socket.off('queue:updated', refresh); };
  }, [queryClient]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117', color: 'rgba(255,255,255,.3)', fontSize: 24 }}>
        Загрузка...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117', color: '#ef4444', fontSize: 24 }}>
        Табло не найдено
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0d1117', fontFamily: 'Montserrat, Segoe UI, sans-serif',
      overflow: 'hidden',
    }}>
      <BoardHeader boardName={data.board.name} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ActiveCallsPanel calls={data.activeCalls as any} />
        <QueuePanel queue={data.queue as any} columns={data.board.columns} />
      </div>

      {overlayQueue.length > 0 && (
        <CallOverlay calls={overlayQueue} onDismiss={handleDismiss} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Коммит**

```bash
git add apps/frontend/src/components/board/BoardView.tsx
git commit -m "feat(board): BoardView — корневой компонент публичного табло"
```

---

## Task 11: BoardDialog — диалог создания/редактирования доски

**Files:**
- Create: `apps/frontend/src/components/admin/BoardDialog.tsx`

- [ ] **Step 1: Создать BoardDialog.tsx**

```typescript
import { useEffect, useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const BACKEND_BASE =
  (import.meta.env.VITE_TRPC_URL as string | undefined)?.replace('/trpc', '') ??
  'http://localhost:3002';

interface Board {
  id: string;
  name: string;
  slug: string;
  columns: number;
  audioMode: string;
  ttsTemplate: string;
  soundUrl?: string | null;
  cabinets: Array<{ cabinetId: string; cabinet: { id: string; number: string; name?: string | null } }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  board?: Board | null;
}

export function BoardDialog({ open, onClose, board }: Props) {
  const isEdit = !!board;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [columns, setColumns] = useState('3');
  const [audioMode, setAudioMode] = useState<'SOUND' | 'SOUND_TTS'>('SOUND');
  const [ttsTemplate, setTtsTemplate] = useState('{lastName} пройдите в кабинет {cabinet}');
  const [selectedCabIds, setSelectedCabIds] = useState<string[]>([]);
  const [soundUrl, setSoundUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: cabinets = [] } = trpc.cabinets.getAll.useQuery();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open) {
      setName(board?.name ?? '');
      setSlug(board?.slug ?? '');
      setColumns(String(board?.columns ?? 3));
      setAudioMode((board?.audioMode as 'SOUND' | 'SOUND_TTS') ?? 'SOUND');
      setTtsTemplate(board?.ttsTemplate ?? '{lastName} пройдите в кабинет {cabinet}');
      setSelectedCabIds(board?.cabinets.map((c) => c.cabinetId) ?? []);
      setSoundUrl(board?.soundUrl ?? null);
    }
  }, [open, board]);

  const create = trpc.displayBoards.create.useMutation({
    onSuccess: () => { utils.displayBoards.getAll.invalidate(); toast.success('Табло создано'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = trpc.displayBoards.update.useMutation({
    onSuccess: () => { utils.displayBoards.getAll.invalidate(); toast.success('Табло обновлено'); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const isPending = create.isPending || update.isPending || uploading;

  const toggleCabinet = (id: string) => {
    setSelectedCabIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const token = localStorage.getItem('auth_token') ?? '';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BACKEND_BASE}/api/sounds/upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error('Ошибка загрузки');
      const json = await res.json();
      setSoundUrl(json.soundUrl);
      toast.success('Файл загружен');
    } catch (e: any) {
      toast.error(e.message ?? 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Название обязательно'); return; }
    if (!slug.trim()) { toast.error('Slug обязателен'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { toast.error('Slug: только строчные латинские буквы, цифры и дефис'); return; }
    if (selectedCabIds.length === 0) { toast.error('Выберите хотя бы один кабинет'); return; }

    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      columns: Number(columns),
      audioMode,
      ttsTemplate,
      soundUrl: soundUrl ?? undefined,
      cabinetIds: selectedCabIds,
    };

    if (isEdit) {
      update.mutate({ id: board!.id, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать табло' : 'Новое табло'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Табло 1 этажа" />
          </div>

          {/* Slug */}
          <div className="space-y-1">
            <Label>Slug (URL) *</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="floor-1" />
            <p className="text-xs text-muted-foreground">Публичный адрес: /board/{slug || 'slug'}</p>
          </div>

          {/* Cabinets multi-select */}
          <div className="space-y-1">
            <Label>Кабинеты *</Label>
            <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
              {(cabinets as any[]).length === 0 && (
                <p className="text-sm text-muted-foreground">Нет кабинетов</p>
              )}
              {(cabinets as any[]).map((c: any) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selectedCabIds.includes(c.id)}
                    onChange={() => toggleCabinet(c.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{c.number}{c.name ? ` — ${c.name}` : ''}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Columns */}
          <div className="space-y-1">
            <Label>Колонки очереди</Label>
            <Select value={columns} onValueChange={setColumns}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 колонки</SelectItem>
                <SelectItem value="3">3 колонки</SelectItem>
                <SelectItem value="4">4 колонки</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Audio mode */}
          <div className="space-y-1">
            <Label>Режим аудио</Label>
            <div className="flex gap-4 pt-1">
              {(['SOUND', 'SOUND_TTS'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={audioMode === mode}
                    onChange={() => setAudioMode(mode)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">
                    {mode === 'SOUND' ? 'Только звук' : 'Звук + речь'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Sound file upload */}
          <div className="space-y-1">
            <Label>Звуковой файл (.mp3 / .wav)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Загрузка...' : soundUrl ? 'Заменить файл' : 'Выбрать файл'}
              </Button>
              {soundUrl && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">{soundUrl}</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.wav,.ogg"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* TTS template (only SOUND_TTS) */}
          {audioMode === 'SOUND_TTS' && (
            <div className="space-y-1">
              <Label>Шаблон речи</Label>
              <textarea
                value={ttsTemplate}
                onChange={(e) => setTtsTemplate(e.target.value)}
                className="w-full border rounded-md p-2 text-sm resize-none bg-background"
                rows={2}
                placeholder="{lastName} пройдите в кабинет {cabinet}"
              />
              <p className="text-xs text-muted-foreground">Переменные: {'{lastName}'}, {'{cabinet}'}</p>
            </div>
          )}
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

- [ ] **Step 2: Коммит**

```bash
git add apps/frontend/src/components/admin/BoardDialog.tsx
git commit -m "feat(admin): BoardDialog — диалог создания/редактирования табло"
```

---

## Task 12: BoardsTab + AdminPanel wire-up

**Files:**
- Create: `apps/frontend/src/components/admin/BoardsTab.tsx`
- Modify: `apps/frontend/src/components/AdminPanel.tsx`

- [ ] **Step 1: Создать BoardsTab.tsx**

```typescript
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useUser } from '@/contexts/UserContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BoardDialog } from './BoardDialog';

const AUDIO_MODE_LABEL: Record<string, string> = {
  SOUND:     'Только звук',
  SOUND_TTS: 'Звук + речь',
};

export function BoardsTab() {
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';

  const { data: boards = [], isLoading } = trpc.displayBoards.getAll.useQuery();
  const utils = trpc.useUtils();

  const del = trpc.displayBoards.delete.useMutation({
    onSuccess: () => { utils.displayBoards.getAll.invalidate(); toast.success('Табло удалено'); },
    onError: (e: any) => toast.error(e.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (b: any) => { setEditing(b); setDialogOpen(true); };

  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка...</p>;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Создать табло</Button>
        </div>
      )}

      {(boards as any[]).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Нет табло</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium">Slug</th>
                <th className="text-left px-4 py-2 font-medium">Кабинеты</th>
                <th className="text-left px-4 py-2 font-medium">Колонки</th>
                <th className="text-left px-4 py-2 font-medium">Режим</th>
                {isAdmin && <th className="px-4 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(boards as any[]).map((b: any) => (
                <tr key={b.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2 font-medium">{b.name}</td>
                  <td className="px-4 py-2">
                    <a
                      href={`/board/${b.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline font-mono text-xs"
                    >
                      /board/{b.slug}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {(b.cabinets as any[]).map((c: any) => c.cabinet.number).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{b.columns}</td>
                  <td className="px-4 py-2 text-muted-foreground">{AUDIO_MODE_LABEL[b.audioMode] ?? b.audioMode}</td>
                  {isAdmin && (
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => openEdit(b)}>
                          Изменить
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={del.isPending}
                          onClick={() => {
                            if (confirm(`Удалить табло "${b.name}"?`)) {
                              del.mutate({ id: b.id });
                            }
                          }}
                        >
                          Удалить
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BoardDialog open={dialogOpen} onClose={() => setDialogOpen(false)} board={editing} />
    </div>
  );
}
```

- [ ] **Step 2: Добавить вкладку в AdminPanel.tsx**

Открой `apps/frontend/src/components/AdminPanel.tsx`. Добавь импорт:

```typescript
import { BoardsTab } from './admin/BoardsTab';
```

В `<TabsList>` добавь новый триггер (после `<TabsTrigger value="stats">`):

```tsx
          <TabsTrigger value="boards">Табло</TabsTrigger>
```

После блока `<TabsContent value="stats">` добавь:

```tsx
        <TabsContent value="boards" className="pt-4">
          <BoardsTab />
        </TabsContent>
```

- [ ] **Step 3: Проверить TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/src/components/admin/BoardsTab.tsx \
        apps/frontend/src/components/AdminPanel.tsx
git commit -m "feat(admin): вкладка Табло в AdminPanel + BoardsTab"
```

---

## Финальная проверка

- [ ] **Запустить проект**

```bash
cd /home/administrator/projects_danik && pnpm dev
```

- [ ] **Проверить AdminPanel**

1. Войти как ADMIN
2. Перейти в Администрирование → вкладка "Табло"
3. Нажать "Создать табло", заполнить: name=`Тест`, slug=`test`, выбрать кабинеты, загрузить .mp3
4. Убедиться что табло создано в таблице

- [ ] **Проверить публичное табло**

1. Открыть новую вкладку: `http://localhost:3000/board/test`
2. Убедиться что показывается шапка с названием, левая и правая панели
3. Войти как врач, вызвать пациента → убедиться что оверлей появляется и звук играет

- [ ] **Финальный коммит**

```bash
git add -A
git commit -m "feat(board): конструктор табло — полная реализация Фазы 8"
```
