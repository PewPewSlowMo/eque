# WebSocket JWT-handshake + rooms + payload sanitization

**Дата:** 2026-05-30
**Статус:** approved (брэйнсторм завершён)
**Автор сессии:** Claude (Opus 4.7) совместно с Danik

## Контекст

`apps/backend/src/events/events.gateway.ts` принимает любые WebSocket-соединения без аутентификации. `this.server.emit()` рассылает каждое событие очереди всем подключённым клиентам. Это создаёт две независимые проблемы:

1. **Утечка PII через payload `queue:called`.** Сейчас при вызове пациента бэк отправляет `{ cabinetId, cabinetNumber, entry: { patient: { firstName, lastName, middleName }, displayConsent, queueNumber, ... } }` ВСЕМ подключённым сокетам. Маскировка по `displayConsent` сделана клиентом (`useCallNotifications.ts:98-104`) — то есть ФИО уже утекли по проводу до того, как клиент решает их не показывать. Любой в локальной сети может в одну строчку JS подписаться на сокет и логировать ФИО всех вызываемых пациентов. Это нарушает медицинскую тайну и обходит ADR-019 (displayConsent).

2. **Нет JWT-handshake и нет room-based рассылки.** На текущей нагрузке (~50 пользователей) не заметно, но при росте отделений и числа врачей рассылка «каждый получает каждое событие» начнёт тормозить. Также нет журнала «кто был подключён» — расследование инцидентов невозможно.

См. также: ADR-006 (история WebSocket-решения), ADR-019 (displayConsent), Gotcha-4 (WebSocket без авторизации).

## Цели

- Анонимные WebSocket-соединения отклоняются на этапе handshake
- PII (ФИО пациентов) никогда не передаётся клиентам, которые не должны её видеть
- Сотрудники получают события только в рамках своей зоны ответственности (по роли и `departmentId`/`doctorId`)
- Публичные табло продолжают работать без авторизации пользователя — но требуют валидный slug
- Минимальное вмешательство в frontend-логику (TTS, refetch-паттерн через tRPC сохраняется)
- Никаких миграций БД, никаких изменений в схеме

## Не-цели

- Реализация тестов на `EventsGateway` (нет инфраструктуры тестов, отложено в техдолг #5)
- Полная замена `socket.io` на другую систему
- Push-уведомления, SMS, email — отдельный техдолг
- Изменение поведения киоска (он не подписан на WS)

## Архитектурные решения

### 1. Handshake и аутентификация

При входящем соединении (`EventsGateway.handleConnection`) сервер читает `socket.handshake.auth`:

- Если есть `token` → `TrpcService.verifyToken(token)` → `AuthUser` или `null`
- Иначе если есть `boardSlug` → `prisma.displayBoard.findUnique({ where: { slug }, select: { id: true, cabinets: { select: { id: true } } } })`
- Если оба отсутствуют ИЛИ оба невалидны → `socket.disconnect(true)` с reason `'unauthorized'`
- Если оба присутствуют одновременно → приоритет `token`, `boardSlug` игнорируется

Результат сохраняется в `socket.data`:

```typescript
type SocketData =
  | { kind: 'staff'; user: AuthUser }
  | { kind: 'board'; slug: string; cabinetIds: string[] };
```

#### Клиентская сторона

`apps/frontend/src/lib/socket.ts` принимает явный режим:

```typescript
type AuthMode =
  | { kind: 'staff'; token: string }
  | { kind: 'board'; slug: string };

export function getSocket(mode: AuthMode): Socket;
export function disconnectSocket(): void;
```

При `connect_error` с reason `unauthorized` клиент выполняет `window.location.reload()` — это устраняет необходимость ручного F5 на устройствах после деплоя (см. раздел «Миграция»).

`UserContext.logout` вызывает `disconnectSocket()` перед очисткой `localStorage`.

### 2. Модель комнат

При успешном handshake сервер автоматически кладёт сокет в комнаты по его контексту:

| Контекст сокета | Комнаты |
|---|---|
| staff с ролью `ADMIN`, `DIRECTOR`, `REGISTRAR`, `CALL_CENTER` | `staff:all` |
| staff с ролью `DEPT_REGISTRAR`, `DEPARTMENT_HEAD` | `department:{user.departmentId}` |
| staff с ролью `DOCTOR` | `doctor:{user.id}` |
| board с валидным slug | `board:{slug}` |

Клиент не управляет подпиской на комнаты — это решает только сервер на основе handshake.

### 3. Стратегия эмита

Универсальный `events.emit(event, data)` удаляется. Появляются типизированные методы:

```typescript
class EventsGateway {
  emitQueueUpdated(args: {
    doctorId: string;
    departmentId: string | null;
    entryId: string;
    cabinetId?: string | null;
  }): void;

  emitQueueCalled(args: {
    doctorId: string;
    departmentId: string | null;
    cabinetId: string;
    cabinetNumber: string;
    entry: QueueEntryWithPatient;  // для серверной формовки board-payload
  }): void;

  emitAssignmentChanged(args: {
    type: 'assignment:created' | 'assignment:ended';
    doctorId: string;
    departmentId: string | null;
    cabinetId: string | null;
  }): void;

  refreshBoardCache(): Promise<void>;
  disconnectBoard(slug: string): void;  // принудительный disconnect всех сокетов board:{slug}
}
```

Внутри каждого метода сервер собирает целевые комнаты:

```
staffRooms = ['staff:all', `department:${departmentId}`, `doctor:${doctorId}`]
boardRooms = lookup boards that include cabinetId (через in-memory cache)
```

Эмит идёт двумя вызовами с **разными payload'ами**:

```typescript
this.server.to(staffRooms).emit(eventName, staffPayload);
this.server.to(boardRooms).emit(eventName, boardPayload);
```

### 4. Payload sanitization

Бэк формирует два разных payload'а — staff никогда не получает PII (refetch'ит через tRPC), board получает только то, что разрешено публично.

#### Для staff-комнат — trigger-only, без PII

```typescript
type StaffEvent = {
  type: 'queue:updated' | 'queue:called' | 'assignment:created' | 'assignment:ended';
  doctorId: string;
  departmentId: string | null;
  entryId?: string;
  cabinetId?: string | null;
}
```

Staff-клиенты (`useQueueSocket.ts`) уже игнорируют payload и просто инвалидируют react-query — серверные tRPC-проверки сами защитят данные.

#### Для board-комнат — pre-masked по `displayConsent`

```typescript
type BoardCallEvent = {
  cabinetId: string;
  cabinetNumber: string;
  queueNumber: number;
  patientFirstName: string | null;  // null если displayConsent=false
  patientLastName: string | null;
  patientMiddleName: string;        // '' если displayConsent=false
}
```

Серверная логика в `emitQueueCalled`:

```typescript
const noConsent = entry.displayConsent === false;
const boardPayload: BoardCallEvent = {
  cabinetId, cabinetNumber, queueNumber: entry.queueNumber,
  patientFirstName:  noConsent ? null : entry.patient.firstName,
  patientLastName:   noConsent ? null : entry.patient.lastName,
  patientMiddleName: noConsent ? ''   : entry.patient.middleName ?? '',
};
```

Принцип: payload'ы конструируются явно (allowlist полей), никаких `{ ...entry }` спредов. Новое поле в `entry` не утечёт автоматически.

#### Shared типы

`apps/backend/src/events/event-types.ts` — экспортирует `StaffEvent`, `BoardCallEvent`. Фронт импортирует через workspace-dep type-only:

```typescript
import type { BoardCallEvent } from 'backend/src/events/event-types';
```

### 5. Кэш board cabinets

`EventsGateway` держит in-memory `Map<cabinetId, Set<slug>>` для быстрого роутинга board-событий:

```typescript
private boardCache: Map<string, Set<string>> = new Map();

async refreshBoardCache(): Promise<void>;
```

Вызовы:
- `onModuleInit()` — построить кэш при старте (блокирует start приложения до завершения)
- `displayBoards.router.ts` после `create`/`update`/`delete`/изменения связи `cabinets` → `eventsGateway.refreshBoardCache()`

При удалении табло — также `eventsGateway.disconnectBoard(slug)` для принудительного отключения подписанных сокетов.

### 6. Изменения в роутерах

15 call site'ов переписываются под новый API. Для получения `departmentId` и `cabinetId` дозапрашиваются поля в существующих Prisma-запросах (через `include`/`select`) — без дополнительных round-trip'ов в БД.

| Файл | Текущий вызов | Новый вызов |
|---|---|---|
| `queue.router.ts` (12 мест) | `events.emit('queue:updated', { doctorId, entry })` | `events.emitQueueUpdated({ doctorId, departmentId, entryId, cabinetId? })` |
| `queue.router.ts` (вызовы `queue:called`) | `events.emit('queue:called', {...})` | `events.emitQueueCalled({ doctorId, departmentId, cabinetId, cabinetNumber, entry })` |
| `kiosk.router.ts:153` | `events.emit('queue:updated', { doctorId, entry })` | `events.emitQueueUpdated(...)` |
| `assignments.router.ts:103, 137` | `events.emit('assignment:created'/'ended', assignment)` | `events.emitAssignmentChanged({ type, doctorId, departmentId, cabinetId })` |
| `displayBoards.router.ts` (новое) | — | После `create/update/delete` → `events.refreshBoardCache()`. После `delete` → `events.disconnectBoard(slug)` |

## Обработка ошибок

| Ситуация | Поведение |
|---|---|
| `auth` пустой/невалидный | `socket.disconnect(true, 'unauthorized')`. Клиент: `window.location.reload()` |
| Token есть, но JWT просрочен | Disconnect. UserContext редиректит на login при следующем tRPC-запросе |
| boardSlug не существует | Disconnect. Browser-table показывает текущий UI без обновлений |
| User меняет роль во время сессии | Документируем как known issue — права применяются при следующем логине. Force-reconnect не реализуем (редкий кейс) |
| Token истёк во время работы | tRPC вернёт 401 → UserContext → logout → disconnectSocket |
| Удалили табло, к которому подключены сокеты | `eventsGateway.disconnectBoard(slug)` форсированно отключает сокеты в комнате |
| Изменили `cabinets` табло | `refreshBoardCache()` — существующие соединения сохраняются, новые события учитывают новый набор |
| Бэк перезапустился | socket.io-client реконнектится с тем же `auth` автоматически |
| Кэш не успел построиться | `onModuleInit()` блокирующий — окно «ноль событий» невозможно |

## Миграция и развёртывание

### Схема БД

Не меняется. JWT-токены (7 дней) продолжают работать.

### Действия на устройствах после деплоя

Auto-reload-on-unauthorized снимает необходимость ручного F5. Оператор может пройти и убедиться, но автомата достаточно:

| Устройство | Что произойдёт |
|---|---|
| Табло в холле | `connect_error('unauthorized')` → `location.reload()` → новый код подключится с `boardSlug` |
| Рабочее место (любая роль) | Аналогично — auto-reload, после reload использует свежий `token` |
| Киоск самозаписи | Не подписан на WS, не затронут. Можно reload для свежей сборки, но не обязательно |

### Окно «нет real-time»

Между рестартом бэка и моментом, когда устройство перезагрузилось, у пользователя нет push-уведомлений (но tRPC работает). Рекомендуется деплой ночью (~4:00, когда табло сами reload по таймеру в `useCallNotifications.ts:122-131`).

## План верификации (smoke test)

Помимо обычной проверки логов контейнеров и tsc:

1. **Anonymous denied:** в консоли браузера `io(WS_URL)` без `auth` → должен сразу `disconnect`
2. **Board slug works:** `io(WS_URL, { auth: { boardSlug: 'real' } })` + `socket.on('queue:called')` → событие приходит при ручном `callNext` в регистратуре
3. **Wrong slug denied:** `io(WS_URL, { auth: { boardSlug: 'fake' } })` → disconnect
4. **Staff token works:** залогиниться, регистратура обновляется в реальном времени
5. **No PII over wire (staff):** DevTools → Network → WS frames → `queue:called` для staff НЕ должен содержать `patient.firstName` (только `entryId`)
6. **No PII over wire (board, no consent):** `queue:called` для board при `displayConsent=false` → `patientFirstName: null`, `patientMiddleName: ''`
7. **PII present (board, consent=true):** `queue:called` для board при `displayConsent=true` → имена есть
8. **TTS works (consent=true):** запись через киоск с согласием → callNext → табло проговаривает имя
9. **TTS works (consent=false):** запись без согласия → табло проговаривает «Номер X, кабинет Y»
10. **Doctor scoping:** два врача из разных отделений залогинены. callNext врача A — в DevTools у врача B WS-frame не приходит
11. **Board scoping:** два табло разных кабинетов. callNext в кабинете табло A — на табло B TTS не запускается
12. **Auto-reload on unauthorized:** инвалидировать token (выйти и удалить из localStorage без `disconnectSocket`) → дождаться рестарта бэка → страница должна сама перезагрузиться

## Альтернативы, рассмотренные и отклонённые

- **Slug + short-lived JWT для табло** (вместо slug-as-capability) — отклонено за переусложнение. Slug уже фактически секрет, знание которого = право на просмотр публичного экрана в холле.
- **Минимальные комнаты `staff:all` + `board:{slug}`** (без `doctor:`, `department:`) — отклонено. Решает privacy, но не scalability — врач продолжал бы получать события всех 50 коллег.
- **Trigger-only payload везде** (включая TTS) — отклонено. Дополнительный refetch при каждом callNext добавляет 50-100ms задержки до начала TTS в холле.
- **Оставить payload как есть, надеяться на room-роутинг** — отклонено. Одна ошибка в роутинге = утечка PII через board:{slug}-комнату.

## Связанные документы

- ADR-006 (eque-decisions.md) — исходное решение по WebSocket
- ADR-019 (eque-decisions.md) — displayConsent
- Gotcha-4 (eque-patterns.md) — WebSocket без авторизации
- Техдолг #5 — отсутствие тестов (отложенный first candidate для покрытия `EventsGateway`)
