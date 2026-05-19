# Analytics Module Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Добавить модуль аналитики для ролей ADMIN, DIRECTOR и DEPT_HEAD — оперативный мониторинг (живые данные) и исторические отчёты (агрегация за период).

**Architecture:** Новый tRPC роутер `analytics.router.ts` на бэкенде с двумя процедурами. Один переиспользуемый `AnalyticsTab.tsx` на фронтенде, встраиваемый в AdminPanel и DepartmentHeadView через проп `lockedDeptId`.

**Tech Stack:** NestJS + tRPC + Prisma (backend), React + Vite + Tailwind CSS (frontend), без внешних charting-библиотек.

---

## Роли и доступ

| Роль | Доступ | deptId |
|------|--------|--------|
| ADMIN | Вся клиника + провал в любое отделение | optional |
| DIRECTOR | Вся клиника + провал в любое отделение | optional |
| DEPT_HEAD | Только своё отделение | locked (из JWT) |

DEPT_HEAD передаёт свой `departmentId` из UserContext. Бэкенд проверяет: если роль DEPT_HEAD и `deptId` не совпадает с их отделением — ошибка 403.

---

## Backend

### Файл: `apps/backend/src/modules/analytics/analytics.router.ts`

Регистрируется в `apps/backend/src/trpc/trpc.router.ts` как `analytics`.

### Процедура 1: `analytics.getOperational`

**Input:**
```typescript
z.object({
  deptId: z.string().optional(), // undefined = вся клиника
})
```

**Логика:**
- Берём всех докторов отделения (или всей клиники)
- Для каждого врача считаем активные записи на сегодня со статусами WAITING_ARRIVAL, ARRIVED, CALLED, IN_PROGRESS
- Статус врача:
  - `active` — есть запись IN_PROGRESS
  - `free` — есть записи сегодня, но нет IN_PROGRESS
  - `off` — нет записей на сегодня
- `avgWaitMinutes` — среднее `(now - arrivedAt)` для записей со статусом ARRIVED
- `latePatients` — WAITING_ARRIVAL записи где `(now - scheduledAt) > 30 мин`

**Output:**
```typescript
{
  summary: {
    totalWaiting: number,      // WAITING_ARRIVAL + ARRIVED
    doctorsActive: number,     // статус active
    doctorsTotal: number,
    latePatients: number,      // ждут > 30 мин
  },
  doctors: Array<{
    id: string,
    lastName: string,
    firstName: string,
    middleName: string | null,
    specialty: string | null,
    status: 'active' | 'free' | 'off',
    queueLength: number,       // WAITING_ARRIVAL + ARRIVED
    avgWaitMinutes: number | null,
  }>
}
```

### Процедура 2: `analytics.getHistorical`

**Input:**
```typescript
z.object({
  deptId: z.string().optional(),
  from: z.string(), // YYYY-MM-DD
  to: z.string(),   // YYYY-MM-DD включительно
})
```

**Логика:**
- Выборка QueueEntry где `scheduledAt >= from` и `scheduledAt <= to+1день` (или `createdAt` для WALK_IN)
- Фильтр по `doctor.departmentId` если `deptId` передан
- Все агрегаты считаются через Prisma на стороне БД где возможно, остальное в JS

**Output:**
```typescript
{
  totals: {
    scheduled: number,         // все записи за период
    completed: number,         // status = COMPLETED
    noShow: number,            // status = NO_SHOW
    cancelled: number,         // status = CANCELLED
    completionRate: number,    // completed / scheduled * 100
    noShowRate: number,        // noShow / scheduled * 100
  },
  timing: {
    avgWaitMinutes: number | null,      // arrivedAt → calledAt
    avgDurationMinutes: number | null,  // startedAt → completedAt
    avgLatenessMinutes: number | null,  // arrivedAt - scheduledAt (только SCHEDULED, только > 0)
    avgResponseMinutes: number | null,  // среднее время между completedAt и следующим calledAt у того же врача
  },
  byPriority: Array<{
    priority: 'EMERGENCY' | 'INPATIENT' | 'SCHEDULED' | 'WALK_IN',
    count: number,
    pct: number,
  }>,
  bySource: Array<{
    source: 'REGISTRAR' | 'CALL_CENTER' | 'KIOSK' | 'DOCTOR_SELF',
    count: number,
    pct: number,
  }>,
  byCancelReason: Array<{
    reason: string,  // cancelReason или 'Не указана'
    count: number,
  }>,
  byDay: Array<{
    date: string,        // YYYY-MM-DD
    completed: number,
    noShow: number,
    total: number,
  }>,
}
```

---

## Frontend

### Новые файлы

```
apps/frontend/src/components/analytics/
  AnalyticsTab.tsx        — главный компонент, dept selector для ADMIN/DIRECTOR
  OperationalPanel.tsx    — живые данные, refetchInterval 30 сек
  HistoricalPanel.tsx     — агрегаты за период
  PeriodSelector.tsx      — кнопки + произвольный диапазон
```

### `AnalyticsTab.tsx`

**Props:**
```typescript
interface AnalyticsTabProps {
  lockedDeptId?: string  // передаётся DEPT_HEAD, не передаётся ADMIN/DIRECTOR
}
```

- Если `lockedDeptId` не передан: вверху дропдаун отделений (загружается через `trpc.departments.getAll`). Опции: «Вся клиника» (value = undefined) + каждое отделение.
- Если передан: дропдаун скрыт, `deptId` = `lockedDeptId`.
- Две кнопки-таба: **Оперативная** / **Историческая**. По умолчанию открыта Оперативная.

### `OperationalPanel.tsx`

**Props:** `{ deptId?: string }`

Запрос: `trpc.analytics.getOperational.useQuery({ deptId }, { refetchInterval: 30_000 })`

**Верхняя строка — 3 карточки:**
- «Ожидают» — `summary.totalWaiting`
- «Врачей на приёме» — `summary.doctorsActive / summary.doctorsTotal`
- «С опозданием» — `summary.latePatients` (красный цвет если > 0)

**Таблица врачей** (колонки: ФИО, Специальность, Статус, Очередь, Сред. ожидание):
- Статус: цветной бейдж — зелёный «Принимает», жёлтый «Свободен», серый «Не вышел»
- Сортировка: сначала `active`, потом `free`, потом `off`

### `HistoricalPanel.tsx`

**Props:** `{ deptId?: string }`

Состояние: `period: 'today' | 'week' | 'month' | 'custom'`, `from: string`, `to: string`.

При смене периода `from/to` пересчитываются:
- `today`: from = to = today
- `week`: from = -6 дней, to = today
- `month`: from = -29 дней, to = today
- `custom`: пользователь вводит вручную

Запрос: `trpc.analytics.getHistorical.useQuery({ deptId, from, to })`

**`PeriodSelector`** — 4 кнопки + два `<input type="date">` (показываются только при `custom`).

**Строка 1 — карточки итогов** (5 карточек):
- Выполнено, Запланировано, % выполнения, % неявок, Отмены

**Строка 2 — карточки времени** (4 карточки):
- Среднее ожидание, Средний приём, Среднее опоздание, Время реакции врача

**Блок «Разбивка»** — две колонки рядом:

*По приоритетам:*
```
ЭКСТРЕННЫЕ   ██ 5%
ПЛАНОВЫЕ     ████████████████ 72%
ЖИВАЯ        ████████ 23%
```

*По источникам:*
```
Регистратура ████████████ 55%
Киоск        ████████ 35%
Колл-центр   ██ 8%
Врач сам     █ 2%
```

Полоски — `<div>` с `width: N%`, цвет через Tailwind.

**Блок «Отмены по причинам»** — список `reason: count`, только если `byCancelReason.length > 0`.

**Блок «Нагрузка по дням»** — вертикальный список дней, на каждый день две полоски:
- Зелёная: выполнено (ширина = completed / max * 100%)
- Красная: неявки (ширина = noShow / max * 100%)
- Подпись даты слева (формат: «19 мая»)

### Интеграция в существующие компоненты

**`apps/frontend/src/components/AdminPanel.tsx`:**
- Добавить таб «Аналитика» в список табов
- Рендерить `<AnalyticsTab />` (без `lockedDeptId`)

**`apps/frontend/src/components/DepartmentHeadView.tsx`:**
- Добавить таб «Аналитика» в список табов (или переключатель если нет табов)
- Рендерить `<AnalyticsTab lockedDeptId={user.departmentId} />`

---

## Что не входит в эту итерацию

- Экспорт (Excel/PDF)
- Тепловая карта по часам/дням недели
- Топ врачей по throughput
- Push-уведомления при превышении порогов
