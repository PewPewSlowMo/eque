# Display Board Constructor — Design Spec

## Goal

Конструктор табло электронной очереди: администратор создаёт именованные доски с привязкой к кабинетам, каждая доска доступна по публичному URL `/board/:slug` без авторизации для отображения на TV.

## Architecture

### Backend

**Prisma — новые модели:**

```prisma
model DisplayBoard {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  columns     Int      @default(3)        // 2 | 3 | 4 — колонки в правой панели очереди
  audioMode   String   @default("SOUND")  // "SOUND" | "SOUND_TTS"
  ttsTemplate String   @default("{lastName} пройдите в кабинет {cabinet}")
  soundUrl    String?                     // обязателен для обоих режимов
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

Cabinet модель получает обратную связь: `boards DisplayBoardCabinet[]`.

**tRPC — новые роутеры:**

`displayBoards` (защищённый, `apps/backend/src/modules/displayBoards/displayBoards.router.ts`):
- `getAll` — ADMIN | DIRECTOR, возвращает все доски с `cabinets[]`
- `create` — ADMIN only, входные данные: `{ name, slug, columns, audioMode, ttsTemplate, cabinetIds[] }`
- `update` — ADMIN only, входные данные: `{ id, ...same fields }`
- `delete` — ADMIN only

`display` (существующий файл `display.router.ts`) — добавить процедуру:
- `getBySlug({ slug })` — `trpc.procedure` (без авторизации), возвращает конфиг доски + текущую очередь по привязанным кабинетам

Загрузка звука — **REST-эндпоинт** (не tRPC, tRPC не поддерживает multipart):
- `POST /api/sounds/upload` — NestJS controller с `@UploadedFile()` + Multer, ADMIN only (JWT guard)
- Сохраняет в `apps/backend/public/sounds/<uuid>.<ext>`, возвращает `{ soundUrl: "/sounds/<uuid>.<ext>" }`
- Новый файл: `apps/backend/src/modules/display/sounds.controller.ts`

Существующую `getBoard` не трогаем (используется старым `DisplayBoard.tsx` / вкладкой Табло).

**Структура ответа `getBySlug`:**

```ts
{
  board: { id, name, slug, columns, audioMode, ttsTemplate, soundUrl },
  cabinetIds: string[],
  activeCalls: Array<{
    cabinetNumber: string,
    cabinetName: string | null,
    patientLastName: string,
    patientFirstName: string,
    calledAt: Date,
  }>,
  queue: Array<{
    queueNumber: number,
    priority: string,
    patientLastName: string,
    patientFirstName: string,
    cabinetNumber: string,
  }>,
}
```

### Frontend

**Роутинг (`apps/frontend/src/App.tsx`):**

Текущее: `/board` → `<DisplayBoard />` (один глобальный стенд).  
После: `/board/:slug` → `<BoardView slug={slug} />`.

Паттерн: простой `window.location.pathname` split — без react-router, как весь текущий роутинг проекта.

Правило публичного маршрута: если `path.startsWith('/board/')` → рендер `<BoardView />` без авторизации.

**Новые файлы:**

```
apps/frontend/src/components/
  board/
    BoardView.tsx          — корневой компонент публичного табло
    BoardHeader.tsx        — шапка: лого + название + часы
    ActiveCallsPanel.tsx   — левая панель 67%, список активных вызовов
    QueuePanel.tsx         — правая панель 33%, скролящаяся очередь
    CallOverlay.tsx        — полноэкранный оверлей вызова
    useCallNotifications.ts — хук очереди уведомлений + аудио
  admin/
    BoardsTab.tsx          — вкладка в AdminPanel
    BoardDialog.tsx        — диалог создания/редактирования доски
```

### Роутинг звука

- **SOUND**: `new Audio(board.soundUrl).play()` при каждом вызове через `useRef<HTMLAudioElement>` (один экземпляр, `.src` меняется).
- **TTS**: `window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))`, шаблон `{lastName}` и `{cabinet}` заменяются.

---

## UI Components

### AdminPanel — вкладка "Табло"

Добавляется новый `<TabsTrigger value="boards">Табло</TabsTrigger>` (виден ADMIN и DIRECTOR).

**BoardsTab.tsx:**
- Таблица: Название | Slug | Кабинеты | Колонки | Режим | Действия
- Кнопка "Создать табло" — только `isAdmin`
- Строка: кнопки "Редактировать" и "Удалить" — только `isAdmin`
- Ошибки мутаций (FORBIDDEN для DIRECTOR) — `toast.error(err.message)`

**BoardDialog.tsx** (модальное окно):

Поля:
| Поле | Тип | Описание |
|------|-----|----------|
| name | text | Название табло |
| slug | text | URL-идентификатор (латиница, дефис) |
| cabinetIds | multi-select | Привязанные кабинеты (из `cabinets.getAll`) |
| columns | select 2/3/4 | Колонки правой панели |
| audioMode | radio | `SOUND` — только файл; `SOUND_TTS` — файл + речь |
| soundFile | file input | загрузка `.mp3`/`.wav` (обязательно для обоих режимов) |
| ttsTemplate | textarea | (только `SOUND_TTS`) шаблон, переменные `{lastName}`, `{cabinet}` |

### BoardView — публичное табло

**Шапка (BoardHeader):**  
120px высота, фон `#00685B`. Grid `1fr auto 1fr`:
- Левая ячейка: лого `<img src="/logo.png">` (Vite сервирует из `public/`)
- Центр: название доски, белый жирный
- Правая ячейка: часы `HH:MM`, цвет `#B39168`, выровнены по правому краю

**Левая панель — ActiveCallsPanel (67%):**

Список пациентов со статусом `CALLED` по кабинетам данной доски.  
Каждая карточка: фамилия-имя пациента (крупно, золото) + "→ каб. N" (белый).  
Если вызовов нет — заглушка "Ожидайте вызова".

**Правая панель — QueuePanel (33%):**

Плоский список всех `WAITING` / `ARRIVED` по кабинетам доски.  
CSS auto-scroll: `@keyframes scroll-up` с удвоенным списком для бесконечной прокрутки.  
Если очередь ≤ 8 строк — прокрутка отключена (список статичен).  
Колонки: настраивается через `board.columns` (2/3/4 колонки CSS grid).

**CallOverlay:**

Рендерится поверх всего (`position:fixed; inset:0; z-index:100`).  
Показывает 1–3 одновременных вызова горизонтальными полосами.  
Каждая полоса: `[Фамилия Им. (gold)] [→ (анимированный)] [N каб. (white)]`.  
Размеры (итоговые из мокапа):

| Вызовов | Пациент | Стрелка | Кабинет |
|---------|---------|---------|---------|
| 1 | 145px | 311px | 221px |
| 2 | 129px | 238px | 168px |
| 3 | 95px | 182px | 124px |

Стрелка: `line-height:0.6; overflow:hidden; transform:translateY(-8%)`.  
Авто-скрытие через 5 секунд.

---

## Notification Queue & Audio (useCallNotifications)

Socket события `queue:called` сейчас эмитируют `{ doctorId, entry }`, где кабинет хранится в `DoctorAssignment`, а не в `QueueEntry`.

**Требуется обогатить событие на бэкенде:** в `callNext` и `callSpecific` перед `events.emit('queue:called', ...)` сделать lookup активного `DoctorAssignment` для `doctorId` и добавить в payload `{ cabinetId, cabinetNumber }`.

Итоговый payload события: `{ doctorId, cabinetId, cabinetNumber, entry }`.

Фильтрация на фронте: событие учитывается только если `cabinetId ∈ board.cabinetIds`.

Хук ведёт очередь уведомлений `Ref<CallEvent[]>`:
1. Новый `queue:called` → push в очередь.
2. Если оверлей не показан → взять из очереди и показать.
3. После 5с авто-скрытие → взять следующий из очереди (если есть) → показать.

Это гарантирует, что ни один вызов не будет пропущен при одновременных событиях.

Аудио при каждом уведомлении:
- **SOUND**: `audioRef.current.src = board.soundUrl; audioRef.current.play()`
- **SOUND_TTS**: то же, плюс после окончания файла (`audio.onended`) — `speechSynthesis.speak(new SpeechSynthesisUtterance(text))` где `text` = шаблон с подстановкой `{lastName}` и `{cabinet}`.

---

## Chrome 24/7 Stability

| Проблема | Решение |
|----------|---------|
| TTS зависает в Chrome через несколько часов | `setInterval(() => speechSynthesis.resume(), 10_000)` |
| Memory leak при многократном `new Audio()` | Один `useRef<HTMLAudioElement>`, только меняем `.src` |
| Накопление stale socket listeners | Именованные функции + `socket.off(event, fn)` в cleanup |
| React Query cache рефетчит конфиг | `staleTime: Infinity, gcTime: Infinity` для `getBySlug` |
| Браузер деградирует за ночь | `setTimeout(() => window.location.reload(), msUntil4am)` |

---

## Data Flow

```
TV Browser (no auth)
  └─ GET /board/slug-name
      └─ BoardView mounts
          ├─ trpc.display.getBySlug("slug-name") → board config + initial queue
          └─ socket.on("queue:called")  → useCallNotifications → overlay + audio
          └─ socket.on("queue:updated") → refetch getBySlug (invalidate)
```

```
Admin (ADMIN role)
  └─ AdminPanel → вкладка "Табло"
      ├─ trpc.displayBoards.getAll() → список досок
      ├─ [Создать] → BoardDialog → trpc.displayBoards.create()
      └─ [Редактировать] → BoardDialog → trpc.displayBoards.update()
      └─ [Удалить] → trpc.displayBoards.delete()
```

---

## File Map

### Создать
- `apps/backend/src/modules/displayBoards/displayBoards.router.ts`
- `apps/backend/src/modules/display/sounds.controller.ts`
- `apps/frontend/src/components/board/BoardView.tsx`
- `apps/frontend/src/components/board/BoardHeader.tsx`
- `apps/frontend/src/components/board/ActiveCallsPanel.tsx`
- `apps/frontend/src/components/board/QueuePanel.tsx`
- `apps/frontend/src/components/board/CallOverlay.tsx`
- `apps/frontend/src/components/board/useCallNotifications.ts`
- `apps/frontend/src/components/admin/BoardsTab.tsx`
- `apps/frontend/src/components/admin/BoardDialog.tsx`
- `apps/backend/prisma/migrations/YYYYMMDD_display_boards/migration.sql`

### Изменить
- `apps/backend/prisma/schema.prisma` — добавить `DisplayBoard`, `DisplayBoardCabinet`, обратную связь в `Cabinet`
- `apps/backend/src/modules/display/display.router.ts` — добавить `getBySlug`, `uploadSound`
- `apps/backend/src/trpc/trpc.router.ts` — зарегистрировать `displayBoards` роутер (паттерн: как остальные `createXxxRouter`)
- `apps/backend/src/app.module.ts` — зарегистрировать `SoundsController`
- `apps/frontend/src/App.tsx` — `/board/:slug` роутинг
- `apps/frontend/src/components/AdminPanel.tsx` — добавить вкладку "Табло"
- `apps/frontend/src/lib/trpc.ts` (если нужно) — тип для нового роутера
