# eque — Архитектурная документация для передачи знаний

> Документ составлен по реальному коду на 27.05.2026.  
> ~284 коммита, проект в активной разработке.

---

## 1. Текущее состояние

### Что полностью работает

| Модуль | Статус |
|--------|--------|
| Авторизация (JWT, 7 ролей) | ✅ |
| Регистратура — запись пациентов (живая + по слотам) | ✅ |
| Регистратура отделения (DEPT_REGISTRAR, доступ только к своему отделению) | ✅ |
| Колл-центр | ✅ (та же RegistrarView) |
| Рабочее место врача (вызов, приём, завершение, no-show) | ✅ |
| Врач с самозаписью (DoctorSelfRegistrarView) | ✅ |
| Заведующий отделением — мониторинг, аналитика | ✅ |
| Панель администратора (пользователи, отделения, кабинеты, услуги, настройки) | ✅ |
| Электронное табло (/board/:slug) — активные вызовы + очередь по кабинетам | ✅ |
| Киоск самозаписи (/kiosk/:slug) — живая очередь без регистрации | ✅ |
| Граф работы врача — день, перерывы, слоты (10–90 мин) | ✅ |
| Импорт/экспорт расписания через Excel (.xlsx) | ✅ |
| Импорт пользователей через Excel | ✅ |
| Аналитика оперативная (текущий день, статусы по врачам) | ✅ |
| Аналитика историческая (диапазон дат, нагрузка, no-show, тайминги) | ✅ |
| Резервное копирование БД (экспорт/импорт JSON) | ✅ |
| Real-time обновления (WebSocket / Socket.IO) | ✅ |
| Звуковые уведомления на табло (MP3-файл или TTS-шаблон) | ✅ |

### Что не реализовано / заглушки

- **Нет тестов** — ни одного файла `*.spec.ts` или `*.test.ts`. `turbo.json` прописал таск `test`, но он ничего не запускает.
- **Нет роль DIRECTOR** в роутинге `App.tsx` — рендерится `<AdminPanel />`, отдельного представления нет.
- **Нет уведомлений** при переходе пациента через статусы (SMS, push, email).
- **Нет управления правами внутри ролей** — что может REGISTRAR жёстко вшито в код, не настраивается через UI.
- **Нет пагинации** в длинных списках (пациенты, история) — при большой БД возможны проблемы производительности.
- **Платёжная интеграция** — поле `paymentConfirmed` есть, логика флага реализована, но реальный процессинг не подключён.
- **Аудит** — `QueueHistory` ведётся, но UI просмотра истории конкретной записи не реализован.
- **`packages/shared`** практически пуст — только словари лейблов. Типы между бэком и фронтом не шарятся.

---

## 2. Архитектура монорепо

```
eque/
├── apps/
│   ├── backend/        NestJS + tRPC + Prisma
│   └── frontend/       React + Vite + Tailwind
├── packages/
│   └── shared/         Только константы-лейблы (QUEUE_PRIORITY_LABELS и т.д.)
├── docker-compose.yml
├── package.json        pnpm workspaces root
├── pnpm-workspace.yaml
└── turbo.json
```

**Сборочный инструмент:** pnpm 9 + Turborepo 2. Запуск через `pnpm dev` из корня запускает оба приложения параллельно.

### Backend (`apps/backend`)

```
src/
├── main.ts                  bootstrap: CORS, body-parser для import, static assets
├── app.module.ts            импортирует все модули
├── database/
│   ├── prisma.module.ts     глобальный PrismaModule
│   └── prisma.service.ts    extends PrismaClient, Injectable
├── trpc/
│   ├── trpc.service.ts      initTRPC, protectedProcedure, verifyToken
│   └── trpc.router.ts       корневой роутер — собирает все sub-роутеры
├── events/
│   └── events.gateway.ts    WebSocket Gateway (Socket.IO), emit() для всех клиентов
└── modules/
    ├── auth/                login, me
    ├── users/               CRUD + импорт из .xlsx
    ├── departments/         CRUD
    ├── cabinets/            CRUD
    ├── patients/            CRUD, поиск по ФИО
    ├── queue/               вся логика очереди (add, call, complete, cancel, ...)
    ├── schedules/           графики врачей + импорт/экспорт .xlsx
    ├── assignments/         назначения врач↔кабинет
    ├── shifts/              шаблоны смен
    ├── services/            медицинские услуги
    ├── settings/            CategorySettings (требования по категориям)
    ├── display/             display.router.ts + sounds.controller.ts
    ├── displayBoards/       CRUD табло
    ├── kiosk/               публичный и admin API киоска
    ├── analytics/           оперативная + историческая аналитика
    └── backup/              export/import JSON всей БД
```

### Frontend (`apps/frontend`)

```
src/
├── App.tsx                  роутинг (pathname-based вручную, без react-router)
├── contexts/
│   └── UserContext.tsx       auth state + localStorage
├── lib/
│   ├── trpc.ts              tRPC клиент (httpBatchLink)
│   ├── socket.ts            синглтон Socket.IO клиента
│   ├── inputNormalizers.ts  нормализация ФИО (Кирилл + латиница, upper/trim)
│   └── utils.ts             cn() для Tailwind
├── components/
│   ├── Login.tsx
│   ├── Layout.tsx
│   ├── RegistrarView.tsx    регистратура + колл-центр (один компонент)
│   ├── DoctorView.tsx       рабочее место врача
│   ├── DoctorSelfRegistrarView.tsx  врач с self-register
│   ├── DepartmentHeadView.tsx
│   ├── AdminPanel.tsx       обёртка вкладок администратора
│   ├── DisplayBoard.tsx     старый компонент предпросмотра (используется в AdminView)
│   ├── admin/               BackupTab, BoardsTab, ScheduleTab, UsersTab, ...
│   ├── analytics/           AnalyticsTab, OperationalPanel, HistoricalPanel, PeriodSelector
│   ├── board/               BoardView, ActiveCallsPanel, QueuePanel, CallOverlay, ...
│   ├── doctor/              CurrentPatientCard, DoctorQueueList
│   ├── head/                AssignDoctorDialog, DoctorQueueCard
│   ├── kiosk/               KioskPage
│   ├── registrar/           AddToQueueForm, PatientSearch, QueueEntryRow, WaitingList, ...
│   └── ui/                  shadcn-подобные примитивы (Button, Dialog, Input, ...)
```

---

## 3. Стек технологий

| Слой | Технология |
|------|-----------|
| Runtime | Node.js ≥ 22 |
| Backend framework | NestJS 10 |
| API-протокол | tRPC 11 (typesafe RPC поверх HTTP batch) |
| ORM | Prisma 6 + PostgreSQL 17 |
| Real-time | Socket.IO 4 (NestJS WebSocketGateway) |
| Auth | JWT (jsonwebtoken), bcrypt для паролей |
| Файловые операции | multer (upload), exceljs (xlsx) |
| Frontend framework | React 18 + Vite 6 |
| Стилизация | Tailwind CSS 3 + Radix UI примитивы |
| Data fetching | tRPC react-query + TanStack React Query 5 |
| Уведомления UI | sonner (toast) |
| Формы | react-hook-form |
| Валидация | Zod (и на бэке, и на фронте) |
| Контейнеризация | Docker + docker-compose |

---

## 4. Ключевые архитектурные решения

### 4.1 tRPC вместо REST

**Решение:** API реализован через tRPC, а не REST/OpenAPI.

**Обоснование:** End-to-end типизация без генерации кода. Роутер определяет схему (Zod), клиент получает типы автоматически через `AppRouter`.

**Критическая оговорка:** В `apps/frontend/src/lib/trpc.ts` клиент создан с `createTRPCReact<any>()`. Это обнуляет всё преимущество типизации. Причина: бэк и фронт в разных Docker-контейнерах, типы не шарятся через пакет. Пока живут с `any` — компилятор TS на фронте не видит ошибки в названиях процедур.

**Правильное решение:** вынести `AppRouter` в `packages/shared` и импортировать на фронте. Это задача высокого приоритета для будущего.

### 4.2 Паттерн createXxxRouter

Вся бизнес-логика в бэкенде — не в Injectable-сервисах, а в фабричных функциях:

```typescript
export const createQueueRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({ ... });
};
```

**Почему так:** NestJS используется как DI-контейнер и HTTP-сервер, но логика не привязана к декораторам NestJS — это облегчает потенциальный переезд. Зависимости пробрасываются явно, не через `@Inject`.

**Следствие:** Нет NestJS-сервисов, нет `@Injectable()` классов с логикой. Вся логика в файлах `*.router.ts`.

### 4.3 Два типа API (tRPC + REST-контроллеры)

Большинство API — tRPC. Исключения — NestJS REST контроллеры:
- `backup.controller.ts` — GET/POST для скачивания/загрузки JSON-файла
- `schedules-import.controller.ts` — multipart/form-data upload XLSX
- `sounds.controller.ts` — upload MP3-файлов
- `users-import.controller.ts` — upload XLSX пользователей

**Причина:** tRPC работает через HTTP batch запросы с JSON-телом. Для бинарных файлов (multipart) и файлового скачивания (stream) нужен обычный Express-контроллер.

### 4.4 JWT в localStorage

**Решение:** Токен хранится в `localStorage`, не в httpOnly cookie.

**Компромисс:** XSS-уязвимость — вредоносный JS может украсть токен. Принято осознанно: это медицинская интранет-система, не публичный интернет-сервис. Преимущество: проще реализовать, работает без CSRF-защиты.

### 4.5 Временна́я зона Казахстан (UTC+5)

KZ_OFFSET_MS = `5 * 60 * 60 * 1000` захардкожен в нескольких местах:
- `analytics.router.ts` — `kzDate()` функция
- `display.router.ts` — `dayStart` для фильтра очереди
- `kiosk.router.ts` — `kzToday()`

**Обоснование:** Сервер работает в UTC, пациенты — в UTC+5. Фильтр "сегодня" должен считаться по казахстанскому календарю, а не UTC.

**Паттерн:**
```typescript
const KZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const kzNow = new Date(new Date().getTime() + KZ_OFFSET_MS);
const todayStr = kzNow.toISOString().slice(0, 10); // "YYYY-MM-DD" по KZ
const dayStart = new Date(todayStr + 'T00:00:00+05:00');
```

### 4.6 WebSocket — broadcast всем клиентам

`EventsGateway.emit(event, data)` вызывает `this.server.emit()` — рассылает **всем подключённым клиентам**, без фильтрации по роли или пользователю. Клиент сам решает, нужен ли ему этот ивент.

**Следствие:** Если на сайте 50 врачей, событие `queue:updated` от любого действия получат все 50. Это не масштабируется при росте нагрузки. Правильно — rooms `doctor:{id}`.

### 4.7 queueNumber — не глобальный

`queueNumber` назначается атомарно внутри транзакции, считается как `max(queueNumber) + 1` в пределах одного врача за один день. Разные врачи могут иметь одинаковые номера.

### 4.8 Роутинг без react-router

В `App.tsx` роутинг реализован вручную через `window.location.pathname` и `useState`:
```typescript
const [path, setPath] = useState(() => window.location.pathname);
if (path.startsWith('/board/')) { ... }
if (path.startsWith('/kiosk/')) { ... }
```

Работает, но ломается при прямом переходе в браузере на `/board/abc` без SPA-redirect настройки. В dev это работает через Vite dev сервер.

---

## 5. База данных (Prisma Schema)

### Основные модели и связи

```
User ──────────────────────────────────────────────────┐
  ├─ role: ADMIN|DIRECTOR|REGISTRAR|DEPT_REGISTRAR|    │
  │        CALL_CENTER|DOCTOR|DEPARTMENT_HEAD           │
  ├─ departmentId → Department                          │
  ├─ allowedCategories: PatientCategory[]  (регистраторы)│
  ├─ acceptedCategories: PatientCategory[] (врачи)      │
  └─ selfRegister: bool  (врач сам записывает себя)     │
                                                         │
Department ──────────── Cabinet ─────────────────────── │
  └─ users[]              └─ assignments[]              │
                           └─ boards[] (DisplayBoard)   │
                                                         │
DoctorAssignment                                         │
  doctorId → User                                        │
  cabinetId → Cabinet                                    │
  startTime/endTime, isActive                            │
                                                         │
DoctorDaySchedule                                        │
  doctorId, date (@db.Date)                              │
  startTime, endTime (строки "08:00")                    │
  slotMinutes (10-90)                                    │
  breaks[] → DayScheduleBreak                            │
                                                         │
QueueEntry ◄──────────────────────────────────────────┘
  doctorId, patientId, serviceId, kioskId?
  priority: EMERGENCY|INPATIENT|SCHEDULED|WALK_IN
  status: WAITING_ARRIVAL|ARRIVED|CALLED|IN_PROGRESS|
          COMPLETED|NO_SHOW|CANCELLED
  source: REGISTRAR|CALL_CENTER|KIOSK|DOCTOR_SELF
  scheduledAt? (null = живая очередь)
  arrivedAt, calledAt, startedAt, completedAt
  queueNumber (per-doctor per-day)
  history[] → QueueHistory
```

### Жизненный цикл QueueEntry

```
WAITING_ARRIVAL ──confirmArrival──► ARRIVED ──callNext/callSpecific──► CALLED
                                                                          │
                                    ◄──────────────────────────────────── │
                                                              startAppointment
                                                                          │
                                                                     IN_PROGRESS
                                                                          │
                                                                      complete
                                                                          │
                                                                      COMPLETED

Из любого не-terminal: cancel → CANCELLED
                        markNoShow → NO_SHOW
```

**Терминальные статусы:** `COMPLETED`, `CANCELLED`, `NO_SHOW`.

### Поле `scheduledAt` для живой очереди

Для живой очереди (`priority = WALK_IN`) поле `scheduledAt` остаётся `null`. Но фронт в `TimePicker` устанавливает его в полдень выбранного дня (`12:00`) для отображения даты. Это позволяет показывать дату без отображения времени. **Важно:** не трактуй `scheduledAt != null` как гарантию того, что это плановая запись — для `WALK_IN` это может быть искусственный timestamp.

---

## 6. Бизнес-логика очереди

### Приоритеты (сортировка)

```typescript
PRIORITY_ORDER = { EMERGENCY: 1, INPATIENT: 2, SCHEDULED: 3, WALK_IN: 4 }
```

Экстренные вызываются первыми. Среди одинакового приоритета — по времени прихода (`arrivedAt ?? createdAt`).

### Статусная логика при создании

При `queue.add` начальный статус определяется по `CategorySettings`:
- Если категория требует подтверждения прихода → `WAITING_ARRIVAL`
- Иначе (или `EMERGENCY`) → сразу `ARRIVED`

Дефолты:
- `PAID_ONCE` → `requiresArrivalConfirmation=true`, `requiresPaymentConfirmation=true`
- `EMPLOYEE` → обе `false` (сотрудник сразу `ARRIVED`, оплата не нужна)
- Остальные → arrival required, payment not required

### callNext логика

1. Берёт все `ARRIVED + paymentConfirmed=true` за сегодня
2. Сортирует по priority → arrivedAt
3. Обновляет первого: `CALLED`, ставит `calledAt`
4. Эмитит `queue:called` → WebSocket → табло показывает overlay

### DEPT_REGISTRAR ограничения

В `queue.add`: проверяет, что врач из того же `departmentId` что и регистратор.
В `queue.getForRegistrar`: игнорирует `departmentId` из запроса, всегда фильтрует по `ctx.user.departmentId`.

---

## 7. Инфраструктура

### Порты

| Сервис | Внутренний | Внешний (хост) |
|--------|-----------|----------------|
| PostgreSQL | 5432 | **5433** |
| Redis | 6379 | **6380** |
| Backend (NestJS) | 3001 | **3002** |
| Frontend (Vite) | 3003 | **3003** |
| Adminer | 8080 | **8081** |

### Переменные окружения

**Backend** (устанавливается через docker-compose env):
```
DATABASE_URL=postgresql://eque_admin:eque_dev_password@postgres:5432/eque
REDIS_URL=redis://redis:6379          # подключён, но Redis не используется активно
PORT=3001
HOST=0.0.0.0
JWT_SECRET=change-me-in-production-32-chars-min
CORS_ORIGIN=http://localhost:3003,http://localhost:5173,http://192.168.10.213:3003
```

**Frontend** (передаётся в Vite как VITE_*):
```
VITE_TRPC_URL=http://192.168.10.213:3002/trpc
VITE_WS_URL=http://192.168.10.213:3002
```

`192.168.10.213` — IP сервера разработки. В продакшне надо менять на реальный домен.

### Статические файлы

Бэкенд раздаёт `apps/backend/public/` как статику (`app.useStaticAssets`). Загруженные MP3-файлы звуков табло сохраняются в `public/sounds/` и доступны по `/sounds/:uuid.mp3`.

### Docker Volumes

- `postgres_data` — данные PostgreSQL персистентны между перезапусками
- `redis_data` — Redis данные
- Исходный код монтируется через bind mounts: `./apps/backend:/app/apps/backend` — поэтому hot reload работает без пересборки образа

### Redis

Redis прописан в docker-compose и `REDIS_URL` передаётся бэкенду, но в коде нет ни одного `import ... from 'redis'` или `ioredis`. Зарезервировано для кэширования/очередей в будущем.

---

## 8. Паттерны разработки

### Как добавить новый tRPC роутер

1. Создай файл `apps/backend/src/modules/xxx/xxx.router.ts`:

```typescript
import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createXxxRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    list: trpc.protectedProcedure
      .input(z.object({ filter: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        // ctx.user — текущий пользователь (AuthUser)
        // ctx.prisma — PrismaService (или используй параметр prisma напрямую)
        return prisma.xxxModel.findMany({ where: { ... } });
      }),

    create: trpc.protectedProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        return prisma.xxxModel.create({ data: input });
      }),
  });
};
```

2. Зарегистрируй в `apps/backend/src/trpc/trpc.router.ts`:

```typescript
import { createXxxRouter } from '../modules/xxx/xxx.router';
// ...
appRouter = this.trpc.router({
  // ...
  xxx: createXxxRouter(this.trpc, this.prisma),
});
```

3. **Не нужно** создавать NestJS модуль — `TrpcModule` сам получает `PrismaService` через DI.

### Именование процедур

- `list` / `getAll` — получить коллекцию
- `getById` / `getBySlug` — получить по ID/slug
- `getByXxx` — получить с фильтрацией
- `create` / `add` — создание
- `update` — обновление
- `delete` — удаление
- Действия: `callNext`, `confirmArrival`, `markNoShow`, `saveDay` — глагол+объект

### Обработка ошибок

Всегда кидай `TRPCError` с осмысленным `message` на русском:

```typescript
throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись не найдена' });
throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
throw new TRPCError({ code: 'BAD_REQUEST', message: 'Нельзя выполнить: статус COMPLETED' });
```

Для REST-контроллеров — NestJS исключения: `UnauthorizedException`, `ForbiddenException`, `BadRequestException`.

### Транзакции для атомарных операций

При вычислении queueNumber всегда используй `prisma.$transaction`:

```typescript
const entry = await prisma.$transaction(async (tx) => {
  const last = await tx.queueEntry.findFirst({ ... orderBy: { queueNumber: 'desc' } });
  const queueNumber = (last?.queueNumber ?? 0) + 1;
  return tx.queueEntry.create({ data: { ..., queueNumber } });
});
```

### Emit WebSocket после мутаций

После любого изменения очереди обязательно:

```typescript
events.emit('queue:updated', { doctorId: entry.doctorId, entry });
// Для вызова пациента дополнительно:
events.emit('queue:called', { doctorId, cabinetId, cabinetNumber, entry });
```

### Формат имени пациента в UI

Стандарт проекта — `Имя Фа.` (первое имя полностью + первые 2 буквы фамилии + точка):

```typescript
function formatName(firstName: string, lastName: string) {
  const last = lastName.length > 0 ? lastName.slice(0, 2) + '.' : '';
  return { first: firstName, last };
}
// Рендер: {first} <span style={{ color: '#94a3b8' }}>{last}</span>
```

### Форматирование дат и времени

- Только дата: `toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })` → "26.05"
- Дата + время: `toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })` → "26.05, 14:30"
- Только время: `toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })` → "14:30"
- Для `WALK_IN` показывать только дату, **никогда** не время (время = полдень, артефакт реализации)

### Нормализация ФИО

```typescript
// apps/frontend/src/lib/inputNormalizers.ts
normalizeFio(raw) // → убирает лишние символы (только кириллица, латиница, пробел, дефис, апостроф)
                  // → каждое слово с заглавной буквы
```

Фамилии в `kiosk.router.ts` хранятся в `UPPER_CASE` (`.toUpperCase()`), в остальных местах — через нормализатор.

---

## 9. Табло (Display Board)

### Маршрут

`/board/:slug` — публичная страница, аутентификация не нужна. tRPC процедура `display.getBySlug` также публичная (`trpc.procedure`, не `protectedProcedure`).

### Архитектура Board UI

```
BoardView
├── BoardHeader (название, время)
├── ActiveCallsPanel  ← CALLED / IN_PROGRESS пациенты
│     Формат: Имя Фа. → каб. 5
└── QueuePanel       ← WAITING_ARRIVAL / ARRIVED за сегодня (UTC+5)
      Группировка по кабинету
      Позиционный номер внутри кабинета (1, 2, 3...)
      Автоскролл при >8 записях
```

### Звуковые уведомления (`useCallNotifications`)

При получении `queue:called` по WebSocket:
- **SOUND режим:** воспроизводит MP3 с URL `board.soundUrl`
- **TTS режим:** использует `board.ttsTemplate` с заменой `{lastName}` и `{cabinet}`, вызывает Web Speech API (`speechSynthesis`)
- Показывает `CallOverlay` (большой экран с именем и кабинетом)

---

## 10. Киоск самозаписи

`/kiosk/:slug` — публичная страница для touch-экрана в холле.

Пациент вводит ФИО → система находит или создаёт пациента (case-insensitive поиск) → создаёт `QueueEntry` со статусом `ARRIVED` (без подтверждения прихода) → возвращает `queueNumber`.

**Дневной лимит:** `Kiosk.dailyLimit` — если установлен, при превышении отклоняет с "лимит исчерпан". Счётчик считается по `kioskId + createdAt за сегодня (UTC)`.

---

## 11. Аналитика

### Оперативная (`getOperational`)

Только ADMIN, DIRECTOR, DEPARTMENT_HEAD. Показывает текущее состояние: сколько врачей принимают прямо сейчас, очереди по врачам, опоздавшие пациенты (>30 мин без вызова).

### Историческая (`getHistorical`)

Диапазон дат. Включает:
- Воронка: запланировано → пришли → завершено
- Тайминги: среднее ожидание, длительность приёма, опоздание пациентов, реакция врача
- No-show по врачам (рейтинг)
- Нагрузка по часам, по дням недели, по дням
- Загрузка врачей (фактическое vs нормативное время)

---

## 12. Известные проблемы и технический долг

### Критические

| Проблема | Где | Что делать |
|----------|-----|-----------|
| tRPC типизирован как `any` | `apps/frontend/src/lib/trpc.ts` | Вынести `AppRouter` в `packages/shared`, убрать `any` |
| WebSocket без авторизации и комнат | `events.gateway.ts` | Добавить JWT-верификацию при `handleConnection`, использовать rooms `doctor:{id}` |
| `(prisma as any)` в `schedules.router.ts` | Весь файл | Регенерировать Prisma-клиент или поправить tsconfig |
| `(ctx.user as any)` в `queue.router.ts` | Строки 131, 562 | Правильно типизировать Context |

### Важные

| Проблема | Где | Что делать |
|----------|-----|-----------|
| Нет тестов вообще | Весь проект | Начать с unit-тестов queue.router.ts |
| backup export: нет лимита на размер ответа при огромной БД | `backup.controller.ts` | Добавить streaming или разбить на части |
| `queueNumber` расчёт в транзакции — race condition при высокой нагрузке | `queue.router.ts:145` | PostgreSQL SERIAL или advisory lock |
| Нет пагинации в `/api/backup/export` | `backup.controller.ts` | Уже починено try/catch, но данных может быть ≫ RAM |
| Роутинг без react-router | `App.tsx` | Подключить react-router-dom |
| Прямой переход `/board/slug` работает только при наличии SPA fallback | nginx/vite config | Настроить try_files в nginx для прода |

### Незначительные

- `schedules.router.ts` использует `(prisma as any)` вместо типизированного Prisma — возможно из-за устаревшего `prisma generate`
- `UserContext` при рестарте страницы берёт пользователя из `localStorage` без re-verify токена на сервере — истёкший токен будет отклонён только при первом tRPC-запросе
- `DEPT_REGISTRAR` в `USER_ROLE_LABELS` в `packages/shared` отсутствует (добавлен позже, словарь не обновили)

---

## 13. С чего начать новому разработчику

### Шаг 1 — Запустить проект (15 минут)

```bash
# Клонировать
git clone https://github.com/PewPewSlowMo/eque.git
cd eque

# Запустить сервисы (Postgres, Redis, Backend, Frontend)
docker-compose up -d

# Проверить что всё поднялось
docker ps
# Должны быть: eque-backend, eque-frontend, eque-postgres, eque-redis

# Наполнить тестовыми данными (только первый раз)
docker exec eque-backend sh -c "cd /app && pnpm --filter backend prisma db seed"

# Открыть в браузере
# Frontend: http://192.168.10.213:3003
# Adminer:  http://192.168.10.213:8081  (eque_admin / eque_dev_password / eque)
```

**Тестовые логины:**
- `admin` / `admin123`
- `registrar1` / `reg123`
- `head1` / `head123`
- `doctor1` / `doc123`

### Шаг 2 — Понять модель данных (30 минут)

Открой `apps/backend/prisma/schema.prisma`. Прочти все модели. Ключевые связи: `User ↔ DoctorAssignment ↔ Cabinet`, `QueueEntry → Patient, Doctor, Service, Kiosk`.

Потом посмотри миграции в `prisma/migrations/` — хронология добавленных фич.

### Шаг 3 — Проследить полный flow записи пациента

1. `RegistrarView.tsx` → `PatientSearch` → выбор пациента
2. `AddToQueueForm` → выбор врача, даты, слота, категории
3. `trpc.queue.add.useMutation()` → `queue.router.ts:add`
4. Транзакция: `queueNumber`, создание `QueueEntry`, запись в `QueueHistory`
5. `events.emit('queue:updated', ...)` → WebSocket → все экраны обновляются

### Шаг 4 — Понять тип пользователя в контексте

```typescript
// trpc.service.ts
interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  departmentId?: string | null;
  selfRegister?: boolean;
}

// В роутере:
const { ctx } = input; // ctx.user — AuthUser или undefined (если публичная процедура)
```

### Шаг 5 — Добавить простую фичу (пример: новое поле в пользователе)

1. `schema.prisma` — добавить поле
2. `pnpm db:migrate` — создать и применить миграцию
3. `apps/backend/src/modules/users/users.router.ts` — добавить в `create`/`update` мутации
4. `apps/backend/src/modules/auth/auth.router.ts` — добавить в `login` response и JWT payload если нужно
5. `apps/frontend/src/contexts/UserContext.tsx` — добавить в `AuthUser` интерфейс
6. `apps/frontend/src/components/admin/UserDialog.tsx` — добавить поле в форму

### Шаг 6 — Частые команды

```bash
# Смотреть логи бэкенда (с hot reload)
docker logs eque-backend -f

# Открыть Prisma Studio (GUI для БД)
pnpm db:studio  # открывает http://localhost:5555

# Применить миграцию в dev
pnpm db:migrate

# TypeScript проверка
cd apps/backend && npx tsc --noEmit
cd apps/frontend && npx tsc --noEmit

# Git: каждый коммит сразу пушим
git add -A && git commit -m "тип(область): описание" && git push
```

---

## 14. Структура коммитов

Формат: `тип(область): описание на русском`

| Тип | Когда |
|-----|-------|
| `feat` | новая функциональность |
| `fix` | исправление бага |
| `refactor` | рефакторинг без изменения поведения |
| `docs` | документация |
| `chore` | зависимости, конфигурация |

Примеры из истории:
```
feat(board): группировка очереди по кабинету с порядковыми номерами
fix(board): формат имени в активных вызовах — Имя Фа. вместо Фамилия И.
fix(backup): try/catch в экспорте + Content-Length + compact JSON
feat(schedules): добавлен слот 10 минут в выборе длительности
```

---

## 15. Быстрая карта файлов для частых задач

| Задача | Файлы |
|--------|-------|
| Изменить права доступа роли | `queue.router.ts` (проверки role), `App.tsx` (renderView) |
| Добавить поле в очередь | `schema.prisma`, `queue.router.ts:add`, `RegistrarView.tsx:AddToQueueForm` |
| Изменить сортировку очереди | `queue.router.ts:PRIORITY_ORDER`, `queue.router.ts:callNext` |
| Добавить новый статус | `schema.prisma:QueueEntryStatus`, `queue.router.ts:TERMINAL_STATUSES`, все switch/includes |
| Изменить внешний вид табло | `board/QueuePanel.tsx`, `board/ActiveCallsPanel.tsx`, `board/BoardHeader.tsx` |
| Изменить звуки/TTS | `board/useCallNotifications.ts`, `modules/displayBoards/displayBoards.router.ts` |
| Изменить слоты расписания | `admin/ScheduleTab.tsx:SLOT_OPTIONS`, `schedules.router.ts:saveDay.slotMinutes` |
| Изменить бизнес-правила категорий | `AdminPanel → CategoriesTab.tsx`, `settings.router.ts`, `queue.router.ts:add` (catSettings) |
| Добавить поле в аналитику | `analytics.router.ts`, `analytics/OperationalPanel.tsx` или `HistoricalPanel.tsx` |
