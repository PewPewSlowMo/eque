# Analytics Extended Design — Блоки 1 и 2

## Цель

Расширить существующий модуль аналитики новыми индикаторами операционного дашборда и аналитики приёмов. Антифрод-дашборд (блок 3) откладывается на отдельный спек.

## Архитектура

Подход: расширение in-place. Существующие процедуры `analytics.getOperational` и `analytics.getHistorical` дополняются новыми полями в ответе. Никаких новых процедур, никакого дублирования роутера. Frontend-компоненты `OperationalPanel` и `HistoricalPanel` обновляются синхронно.

Один дополнительный DB-запрос в каждой процедуре: `DoctorDaySchedule` + `DayScheduleBreak` для расчёта нормативов, перерывов и загрузки.

## Стек

NestJS + tRPC + Prisma (backend), React + Tailwind CSS (frontend). Внешние библиотеки графиков не используются — CSS-бары как в существующем коде.

---

## Backend: `getOperational`

### Новые поля в `summary`

```ts
statusBreakdown: {
  waitingArrival: number   // статус WAITING_ARRIVAL, за сегодня
  arrived: number          // статус ARRIVED, за сегодня
  called: number           // статус CALLED, за сегодня
  inProgress: number       // статус IN_PROGRESS, за сегодня
  completedToday: number   // статус COMPLETED, за сегодня
  noShowToday: number      // статус NO_SHOW, за сегодня
}
maxWaitMinutes: number | null   // максимум (now − arrivedAt) среди всех ARRIVED прямо сейчас, в минутах
```

### Новые поля на каждый элемент `doctors[]`

```ts
status: 'active' | 'free' | 'off' | 'break'
// 'break' — если текущее время UTC попадает в окно DayScheduleBreak врача на сегодня
// Приоритет: active > break > free > off

lateCount: number
// Количество пациентов в статусе WAITING_ARRIVAL или ARRIVED у этого врача,
// ожидающих > 30 мин (now − max(arrivedAt, scheduledAt, createdAt))

avgDurationToday: number | null
// Среднее (completedAt − startedAt) в минутах для COMPLETED-записей врача за сегодня

normativeMinutes: number | null
// DoctorDaySchedule.slotMinutes для врача на сегодняшнюю дату. null если расписания нет.
```

### Дополнительный DB-запрос

```ts
prisma.doctorDaySchedule.findMany({
  where: { doctorId: { in: doctorIds }, date: todayDate },
  include: { breaks: true },
})
```

Результат хранится в Map<doctorId, schedule> для O(1) доступа при сборке `doctorStats`.

Определение `isOnBreak`:
```ts
const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
const isOnBreak = schedule.breaks.some(b => {
  const [bH, bM] = b.startTime.split(':').map(Number);
  const [eH, eM] = b.endTime.split(':').map(Number);
  return nowMinutes >= bH * 60 + bM && nowMinutes < eH * 60 + eM;
});
```

Статус с учётом перерыва:
```ts
const status = hasInProgress ? 'active'
  : isOnBreak ? 'break'
  : hasToday  ? 'free'
  : 'off';
```

Порядок сортировки: `{ active: 0, break: 1, free: 2, off: 3 }`.

---

## Backend: `getHistorical`

### Новое поле в `totals`

```ts
arrived: number   // записи где arrivedAt != null
```

### Новые секции в ответе

#### `noShowByDoctor`

```ts
noShowByDoctor: Array<{
  doctorId: string
  lastName: string
  firstName: string
  specialty: string | null
  noShow: number
  total: number
  noShowRate: number   // Math.round(noShow / total * 100), 0 если total = 0
}>
```

Источник: существующий массив `entries`, группировка по `doctorId`. Join с данными врача через отдельный запрос `prisma.user.findMany({ where: { id: { in: doctorIdsFromEntries } } })`. Сортировка по убыванию `noShowRate`, затем по убыванию `noShow`.

#### `byHour`

```ts
byHour: Array<{
  hour: number       // 0–23, UTC-час из scheduledAt ?? createdAt
  total: number
  completed: number
  noShow: number
}>
```

Группировка: `(entry.scheduledAt ?? entry.createdAt).getUTCHours()`. Результат отсортирован по возрастанию `hour`. Включаются только часы, где `total > 0`.

#### `byDayOfWeek`

```ts
byDayOfWeek: Array<{
  weekday: number    // 0=Вс, 1=Пн, ... 6=Сб (Date.prototype.getUTCDay())
  label: string      // 'Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'
  total: number
  completed: number
  noShow: number
}>
```

Группировка: `(entry.scheduledAt ?? entry.createdAt).getUTCDay()`. Результат отсортирован по `weekday`. Включаются только дни, где `total > 0`.

#### `doctorWorkload`

```ts
doctorWorkload: Array<{
  doctorId: string
  lastName: string
  firstName: string
  specialty: string | null
  completed: number
  // Загрузка по слотам:
  slotsTotal: number          // Σ floor(рабочихМинут / slotMinutes) по дням периода
  slotsUsed: number           // = completed
  workloadBySlotsPct: number  // Math.round(slotsUsed / slotsTotal * 100), 0 если slotsTotal = 0
  // Загрузка по времени:
  scheduledMinutes: number    // Σ (рабочихМинут − минутыПерерывов) по дням периода
  actualMinutes: number       // Σ (completedAt − startedAt) для COMPLETED-записей, в минутах
  workloadByTimePct: number   // Math.round(actualMinutes / scheduledMinutes * 100), 0 если scheduledMinutes = 0
}>
```

**Расчёт `scheduledMinutes` и `slotsTotal` для одного дня:**
```ts
function parseMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

const workStart  = parseMinutes(schedule.startTime);
const workEnd    = parseMinutes(schedule.endTime);
const breakMins  = schedule.breaks.reduce((s, b) =>
  s + parseMinutes(b.endTime) - parseMinutes(b.startTime), 0);
const workingMins = Math.max(0, workEnd - workStart - breakMins);
const slots = Math.floor(workingMins / schedule.slotMinutes);
```

Дополнительный DB-запрос:
```ts
prisma.doctorDaySchedule.findMany({
  where: {
    doctorId: { in: doctorIdsFromEntries },
    date: { gte: fromDate, lte: toDate },   // fromDate/toDate как Date (не DateTime)
  },
  include: { breaks: true },
})
```

Врачи без расписания в период: включаются в `doctorWorkload` с `slotsTotal=0`, `scheduledMinutes=0`, `workloadBySlotsPct=0`, `workloadByTimePct=0`. Сортировка по убыванию `workloadBySlotsPct`.

---

## Frontend: `OperationalPanel`

### Строка статусов

Новый блок между заголовком и stat-карточками. Горизонтальный flex-ряд цветных чипов:

```
[● Ожидают прихода: 12]  [● Пришли: 5]  [● Вызваны: 3]  [● В кабинете: 4]  [● Завершено: 47]  [● Неявки: 2]
```

Цвета кружков: `waitingArrival` — slate, `arrived` — blue, `called` — amber, `inProgress` — emerald, `completedToday` — teal, `noShowToday` — red. Чипы некликабельны.

### Новая stat-карточка

`maxWaitMinutes` добавляется в существующий ряд карточек. `warn=true` (красный текст) если > 60 мин.

### Таблица врачей — новые колонки

Добавляются три столбца справа:

| … | Норматив | Ср. приём | Опоздавших |
|---|----------|-----------|-----------|

- **Норматив**: `normativeMinutes` мин или `—` если null.
- **Ср. приём**: `avgDurationToday` мин или `—` если null. Красный если `avgDurationToday > normativeMinutes * 1.2`.
- **Опоздавших**: `lateCount`, красный если > 0.

**Статусный бейдж** `'break'`: `bg-blue-50 text-blue-600` с текстом «На перерыве».

---

## Frontend: `HistoricalPanel`

### Totals

В существующем ряду stat-карточек добавляется карточка «Пришли» (`arrived`).

### Новые секции (в порядке отображения после существующих)

#### Неявки по врачам

Таблица `bg-white border border-border rounded-lg p-4 shadow-sm`. Колонки: ФИО / Специальность / Неявки / Всего / % неявок. Сортировка по убыванию %. Показывается только если `noShowByDoctor.length > 0`.

#### Распределение по часам

CSS-бары, ось X — часы. Каждый час: один бар-ряд аналогично существующему `byDay`. Показывается только если `byHour.length > 0`.

#### Распределение по дням недели

CSS-бары, ось X — дни недели (label). Показывается только если `byDayOfWeek.length > 0`.

#### Загрузка врачей

Таблица. Колонки: ФИО / Специальность / Принято / Слоты (план/факт/%) / Время план (мин) / Время факт (мин) / Загрузка по времени (%).

Цвет `workloadBySlotsPct`:
- `< 70%` — `text-amber-600`
- `70–90%` — `text-emerald-600`
- `> 90%` — `text-red-600`

Показывается только если `doctorWorkload.length > 0`.

---

## Файлы, которые изменяются

| Файл | Действие |
|------|---------|
| `apps/backend/src/modules/analytics/analytics.router.ts` | Расширить `getOperational` и `getHistorical` |
| `apps/frontend/src/components/analytics/OperationalPanel.tsx` | Новые колонки, строка статусов, карточка maxWait |
| `apps/frontend/src/components/analytics/HistoricalPanel.tsx` | Новые секции: noShowByDoctor, byHour, byDayOfWeek, doctorWorkload |

Остальные файлы (`AnalyticsTab`, `PeriodSelector`, `AdminPanel`, `DepartmentHeadView`) не изменяются.

---

## Что не входит в этот спек

- Антифрод-дашборд (блок 3) — отдельный спек
- Логирование переносов в `QueueHistory` — подготовка для антифрода, не нужна здесь
- Тепловая карта и топ врачей — отложены ранее
