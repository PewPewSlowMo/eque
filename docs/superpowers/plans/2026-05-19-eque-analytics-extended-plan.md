# Analytics Extended Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить существующий модуль аналитики новыми индикаторами операционного дашборда и аналитики приёмов согласно спеку `docs/superpowers/specs/2026-05-19-analytics-extended-design.md`.

**Architecture:** Расширение in-place — добавляем новые поля в ответы существующих процедур `analytics.getOperational` и `analytics.getHistorical`. Никаких новых процедур. Frontend-компоненты обновляются синхронно. Один дополнительный DB-запрос (`DoctorDaySchedule`) в каждой процедуре.

**Tech Stack:** NestJS + tRPC + Prisma (backend), React + Tailwind CSS (frontend). Тестов в проекте нет — верификация ручная через браузер.

---

## Контекст для исполнителя

Монорепо: `apps/backend` (NestJS + tRPC), `apps/frontend` (React + Vite).

Ключевые файлы:
- `apps/backend/src/modules/analytics/analytics.router.ts` — единственный файл бэкенда (254 строки)
- `apps/frontend/src/components/analytics/OperationalPanel.tsx`
- `apps/frontend/src/components/analytics/HistoricalPanel.tsx`

Схема Prisma: `apps/backend/prisma/schema.prisma`. Модели: `QueueEntry`, `DoctorDaySchedule` (поля: `doctorId`, `date @db.Date`, `startTime`, `endTime`, `slotMinutes`, `breaks: DayScheduleBreak[]`), `DayScheduleBreak` (поля: `startTime`, `endTime`).

Докер: `docker exec eque-backend sh -c "cd /app && <cmd>"`.  
Фронтенд dev-сервер: `http://192.168.10.213:3003`.

---

## Task 1: Backend — расширить `getOperational`

**Files:**
- Modify: `apps/backend/src/modules/analytics/analytics.router.ts`

### Что добавляем

В `summary`: `statusBreakdown` (разбивка по статусам за сегодня) и `maxWaitMinutes` (максимальное текущее ожидание).

В каждый элемент `doctors[]`: `lateCount` (опоздавших у врача, вместо старого агрегата), `avgDurationToday`, `normativeMinutes`, новый статус `'break'`.

- [ ] **Step 1: Добавить `startedAt` и `completedAt` в select entries**

В блоке `getOperational`, найти существующий запрос `prisma.queueEntry.findMany` (около строки 47). Добавить два поля в `select`:

```ts
select: {
  doctorId: true,
  status: true,
  arrivedAt: true,
  scheduledAt: true,
  createdAt: true,
  startedAt: true,    // добавить
  completedAt: true,  // добавить
},
```

- [ ] **Step 2: Добавить запрос `DoctorDaySchedule` после запроса entries**

После строки `const entries = await prisma.queueEntry.findMany(...)` добавить:

```ts
const schedules = await prisma.doctorDaySchedule.findMany({
  where: { doctorId: { in: doctorIds }, date: dayStart },
  include: { breaks: true },
});
const scheduleByDoctor = new Map(schedules.map(s => [s.doctorId, s]));
```

`dayStart` уже вычислен выше: `new Date(todayStr + 'T00:00:00.000Z')`. Prisma сравнивает `@db.Date` по дате, время игнорируется.

- [ ] **Step 3: Вычислить `statusBreakdown` и `maxWaitMinutes`**

После блока `const entriesByDoctor = new Map(...)` добавить:

```ts
const statusBreakdown = {
  waitingArrival: entries.filter(e => e.status === 'WAITING_ARRIVAL').length,
  arrived:        entries.filter(e => e.status === 'ARRIVED').length,
  called:         entries.filter(e => e.status === 'CALLED').length,
  inProgress:     entries.filter(e => e.status === 'IN_PROGRESS').length,
  completedToday: entries.filter(e => e.status === 'COMPLETED').length,
  noShowToday:    entries.filter(e => e.status === 'NO_SHOW').length,
};

const waitTimes = entries
  .filter(e => e.status === 'ARRIVED' && e.arrivedAt)
  .map(e => Math.floor((now.getTime() - e.arrivedAt!.getTime()) / 60000));
const maxWaitMinutes = waitTimes.length > 0 ? Math.max(...waitTimes) : null;
```

- [ ] **Step 4: Обновить `ORDER` и вычисление статуса врача в `doctorStats`**

Заменить существующую строку `const ORDER = { active: 0, free: 1, off: 2 } as const;`:

```ts
const ORDER = { active: 0, break: 1, free: 2, off: 3 } as const;
```

Внутри `doctors.map(d => {...})`, заменить блок вычисления `status`, `latePatients` и `avgWaitMinutes`:

```ts
// Было:
const hasInProgress = dEntries.some(e => e.status === 'IN_PROGRESS');
const hasToday = dEntries.length > 0;
const status: 'active' | 'free' | 'off' = hasInProgress ? 'active' : hasToday ? 'free' : 'off';

// Стало:
const hasInProgress = dEntries.some(e => e.status === 'IN_PROGRESS');
const hasToday = dEntries.length > 0;
const schedule = scheduleByDoctor.get(d.id);
const normativeMinutes = schedule?.slotMinutes ?? null;
const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
const isOnBreak = schedule
  ? schedule.breaks.some(b => {
      const [bH, bM] = b.startTime.split(':').map(Number);
      const [eH, eM] = b.endTime.split(':').map(Number);
      return nowMinutes >= bH * 60 + bM && nowMinutes < eH * 60 + eM;
    })
  : false;
const status: 'active' | 'break' | 'free' | 'off' =
  hasInProgress ? 'active' : isOnBreak ? 'break' : hasToday ? 'free' : 'off';
```

- [ ] **Step 5: Добавить `lateCount`, `avgDurationToday` в тело `doctorStats.map`**

После блока `const avgWaitMinutes = ...` добавить:

```ts
const lateCount = dEntries.filter(e => {
  if (e.status !== 'WAITING_ARRIVAL' && e.status !== 'ARRIVED') return false;
  const ref = e.arrivedAt ?? e.scheduledAt ?? e.createdAt;
  return now.getTime() - ref.getTime() > LATE_THRESHOLD_MS;
}).length;

const completedDurations = dEntries
  .filter(e => e.status === 'COMPLETED' && e.startedAt && e.completedAt)
  .map(e => (e.completedAt!.getTime() - e.startedAt!.getTime()) / 60000);
const avgDurationToday = completedDurations.length > 0
  ? Math.round(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
  : null;
```

- [ ] **Step 6: Обновить счётчики `doctorsActive` и `latePatients`**

Заменить существующие строки:
```ts
// Было:
if (status === 'active') doctorsActive++;
totalWaiting += queueLength;
latePatients += late;

// Стало:
if (status === 'active') doctorsActive++;
totalWaiting += queueLength;
latePatients += lateCount;
```

Удалить старую переменную `const late = ...` — она заменена `lateCount`.

- [ ] **Step 7: Обновить return doctorStats — добавить новые поля**

В конце `.map(d => {...})` заменить return:

```ts
// Было:
return { id: d.id, lastName: d.lastName, firstName: d.firstName, middleName: d.middleName,
  specialty: d.specialty, status, queueLength, avgWaitMinutes };

// Стало:
return { id: d.id, lastName: d.lastName, firstName: d.firstName, middleName: d.middleName,
  specialty: d.specialty, status, queueLength, avgWaitMinutes,
  lateCount, avgDurationToday, normativeMinutes };
```

- [ ] **Step 8: Обновить return процедуры — добавить `statusBreakdown` и `maxWaitMinutes`**

```ts
// Было:
return {
  summary: { totalWaiting, doctorsActive, doctorsTotal: doctors.length, latePatients },
  doctors: sortedStats,
};

// Стало:
return {
  summary: { totalWaiting, doctorsActive, doctorsTotal: doctors.length, latePatients,
    statusBreakdown, maxWaitMinutes },
  doctors: sortedStats,
};
```

- [ ] **Step 9: Запустить бэкенд и проверить**

```bash
docker exec eque-backend sh -c "cd /app && node -e \"console.log('ok')\""
```

Открыть `http://192.168.10.213:3003` → войти как ADMIN → вкладка «Аналитика» → «Оперативная». В консоли браузера не должно быть ошибок. Данные в карточках должны обновиться (пусть нули — важно что нет 500).

- [ ] **Step 10: Коммит**

```bash
git add apps/backend/src/modules/analytics/analytics.router.ts
git commit -m "feat(analytics): расширить getOperational — статусы, максимум ожидания, перерыв, нормативы"
git push
```

---

## Task 2: Backend — расширить `getHistorical`

**Files:**
- Modify: `apps/backend/src/modules/analytics/analytics.router.ts`

### Что добавляем

В `totals`: поле `arrived`. Новые секции ответа: `noShowByDoctor`, `byHour`, `byDayOfWeek`, `doctorWorkload`.

- [ ] **Step 1: Вычислить `arrived` и собрать `doctorIdsFromEntries`**

После блока `const total = entries.length; const completed = ...` добавить:

```ts
const arrived = entries.filter(e => e.arrivedAt != null).length;

// Собираем doctorIds из записей (нужны для join и workload)
const noShowByDoctorMap = new Map<string, { noShow: number; total: number }>();
for (const e of entries) {
  if (!noShowByDoctorMap.has(e.doctorId)) noShowByDoctorMap.set(e.doctorId, { noShow: 0, total: 0 });
  const rec = noShowByDoctorMap.get(e.doctorId)!;
  rec.total++;
  if (e.status === 'NO_SHOW') rec.noShow++;
}
const doctorIdsFromEntries = [...noShowByDoctorMap.keys()];
```

- [ ] **Step 2: Параллельно загрузить данные врачей и расписания**

После строки `doctorIdsFromEntries` добавить:

```ts
const [doctorUsers, workloadSchedules] = await Promise.all([
  prisma.user.findMany({
    where: { id: { in: doctorIdsFromEntries } },
    select: { id: true, lastName: true, firstName: true, specialty: true },
  }),
  prisma.doctorDaySchedule.findMany({
    where: {
      doctorId: { in: doctorIdsFromEntries },
      date: {
        gte: new Date(input.from + 'T00:00:00.000Z'),
        lte: new Date(input.to   + 'T00:00:00.000Z'),
      },
    },
    include: { breaks: true },
  }),
]);
const doctorUserMap = new Map(doctorUsers.map(u => [u.id, u]));
```

- [ ] **Step 3: Вычислить `noShowByDoctor`**

После `doctorUserMap` добавить:

```ts
const noShowByDoctor = doctorIdsFromEntries
  .map(id => {
    const stats = noShowByDoctorMap.get(id)!;
    const u = doctorUserMap.get(id);
    return {
      doctorId: id,
      lastName:  u?.lastName  ?? '',
      firstName: u?.firstName ?? '',
      specialty: u?.specialty ?? null,
      noShow:    stats.noShow,
      total:     stats.total,
      noShowRate: stats.total > 0 ? Math.round(stats.noShow / stats.total * 100) : 0,
    };
  })
  .sort((a, b) => b.noShowRate - a.noShowRate || b.noShow - a.noShow);
```

- [ ] **Step 4: Вычислить `byHour`**

```ts
const hourMap = new Map<number, { total: number; completed: number; noShow: number }>();
for (const e of entries) {
  const hour = (e.scheduledAt ?? e.createdAt).getUTCHours();
  if (!hourMap.has(hour)) hourMap.set(hour, { total: 0, completed: 0, noShow: 0 });
  const h = hourMap.get(hour)!;
  h.total++;
  if (e.status === 'COMPLETED') h.completed++;
  if (e.status === 'NO_SHOW')   h.noShow++;
}
const byHour = [...hourMap.entries()]
  .map(([hour, v]) => ({ hour, ...v }))
  .sort((a, b) => a.hour - b.hour);
```

- [ ] **Step 5: Вычислить `byDayOfWeek`**

```ts
const DOW_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dowMap = new Map<number, { total: number; completed: number; noShow: number }>();
for (const e of entries) {
  const dow = (e.scheduledAt ?? e.createdAt).getUTCDay();
  if (!dowMap.has(dow)) dowMap.set(dow, { total: 0, completed: 0, noShow: 0 });
  const rec = dowMap.get(dow)!;
  rec.total++;
  if (e.status === 'COMPLETED') rec.completed++;
  if (e.status === 'NO_SHOW')   rec.noShow++;
}
const byDayOfWeek = [...dowMap.entries()]
  .map(([weekday, v]) => ({ weekday, label: DOW_LABELS[weekday], ...v }))
  .sort((a, b) => a.weekday - b.weekday);
```

- [ ] **Step 6: Вычислить `doctorWorkload`**

Добавить вспомогательную функцию перед `createAnalyticsRouter` (в начале файла, после импортов):

```ts
function parseMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
```

Вычислить `completedByDoctor` и `actualMinutesByDoctor` из entries:

```ts
const completedByDoctor   = new Map<string, number>();
const actualMinutesByDoctor = new Map<string, number>();
for (const e of entries) {
  if (e.status === 'COMPLETED') {
    completedByDoctor.set(e.doctorId, (completedByDoctor.get(e.doctorId) ?? 0) + 1);
    if (e.startedAt && e.completedAt) {
      const mins = (e.completedAt.getTime() - e.startedAt.getTime()) / 60000;
      actualMinutesByDoctor.set(e.doctorId, (actualMinutesByDoctor.get(e.doctorId) ?? 0) + mins);
    }
  }
}

// Группируем расписания по врачу
const schedulesByDoctor = new Map<string, typeof workloadSchedules>();
for (const s of workloadSchedules) {
  if (!schedulesByDoctor.has(s.doctorId)) schedulesByDoctor.set(s.doctorId, []);
  schedulesByDoctor.get(s.doctorId)!.push(s);
}

const doctorWorkload = doctorIdsFromEntries
  .map(id => {
    const u = doctorUserMap.get(id);
    const dSchedules = schedulesByDoctor.get(id) ?? [];

    let slotsTotal = 0;
    let scheduledMinutes = 0;
    for (const s of dSchedules) {
      const workStart  = parseMinutes(s.startTime);
      const workEnd    = parseMinutes(s.endTime);
      const breakMins  = s.breaks.reduce(
        (sum, b) => sum + parseMinutes(b.endTime) - parseMinutes(b.startTime), 0,
      );
      const workingMins = Math.max(0, workEnd - workStart - breakMins);
      slotsTotal        += Math.floor(workingMins / s.slotMinutes);
      scheduledMinutes  += workingMins;
    }

    const completed    = completedByDoctor.get(id) ?? 0;
    const actualMinutes = Math.round(actualMinutesByDoctor.get(id) ?? 0);

    return {
      doctorId:  id,
      lastName:  u?.lastName  ?? '',
      firstName: u?.firstName ?? '',
      specialty: u?.specialty ?? null,
      completed,
      slotsTotal,
      slotsUsed:            completed,
      workloadBySlotsPct:   slotsTotal       > 0 ? Math.round(completed      / slotsTotal       * 100) : 0,
      scheduledMinutes,
      actualMinutes,
      workloadByTimePct:    scheduledMinutes > 0 ? Math.round(actualMinutes  / scheduledMinutes * 100) : 0,
    };
  })
  .sort((a, b) => b.workloadBySlotsPct - a.workloadBySlotsPct);
```

- [ ] **Step 7: Обновить `return` процедуры**

```ts
// Было:
return {
  totals: { scheduled: total, completed, noShow, cancelled,
    completionRate: ..., noShowRate: ... },
  timing: { ... },
  byPriority, bySource, byCancelReason, byDay,
};

// Стало:
return {
  totals: { scheduled: total, completed, noShow, arrived, cancelled,
    completionRate: total > 0 ? Math.round(completed / total * 100) : 0,
    noShowRate:     total > 0 ? Math.round(noShow    / total * 100) : 0 },
  timing: { avgWaitMinutes, avgDurationMinutes, avgLatenessMinutes, avgResponseMinutes },
  byPriority, bySource, byCancelReason, byDay,
  noShowByDoctor, byHour, byDayOfWeek, doctorWorkload,
};
```

- [ ] **Step 8: Проверить что бэкенд компилируется**

```bash
docker logs eque-backend --tail=20
```

Ожидаем: нет ошибок TypeScript. Если есть — исправить до коммита.

- [ ] **Step 9: Проверить через браузер**

Открыть «Аналитика» → «Историческая». Никаких ошибок в консоли. Данные загружаются.

- [ ] **Step 10: Коммит**

```bash
git add apps/backend/src/modules/analytics/analytics.router.ts
git commit -m "feat(analytics): расширить getHistorical — неявки по врачам, по часам, по дням недели, загрузка"
git push
```

---

## Task 3: Frontend — обновить `OperationalPanel.tsx`

**Files:**
- Modify: `apps/frontend/src/components/analytics/OperationalPanel.tsx`

Полностью заменить содержимое файла:

- [ ] **Step 1: Заменить содержимое `OperationalPanel.tsx`**

```tsx
import { trpc } from '@/lib/trpc';

interface Props {
  deptId?: string;
}

function StatCard({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className="flex-1 min-w-[120px] bg-white border border-border rounded-lg p-4 shadow-sm">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${warn ? 'text-red-600' : 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  break:  'bg-blue-50 text-blue-600',
  free:   'bg-amber-50 text-amber-700',
  off:    'bg-slate-100 text-slate-500',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Принимает',
  break:  'На перерыве',
  free:   'Свободен',
  off:    'Не вышел',
};

const STATUS_CHIPS = [
  { key: 'waitingArrival', label: 'Ожидают прихода', dot: 'bg-slate-400' },
  { key: 'arrived',        label: 'Пришли',           dot: 'bg-blue-400' },
  { key: 'called',         label: 'Вызваны',           dot: 'bg-amber-400' },
  { key: 'inProgress',     label: 'В кабинете',        dot: 'bg-emerald-500' },
  { key: 'completedToday', label: 'Завершено',          dot: 'bg-teal-500' },
  { key: 'noShowToday',    label: 'Неявки',             dot: 'bg-red-400' },
] as const;

export function OperationalPanel({ deptId }: Props) {
  const { data, isLoading } = trpc.analytics.getOperational.useQuery(
    { deptId },
    { refetchInterval: 30_000 },
  );

  if (isLoading) return <div className="text-sm text-muted-foreground py-10 text-center">Загрузка...</div>;
  if (!data) return null;

  const { summary, doctors } = data as any;
  const sb = summary.statusBreakdown as Record<string, number>;

  return (
    <div className="space-y-4">
      {/* Строка статусов */}
      <div className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map(({ key, label, dot }) => (
          <div key={key} className="flex items-center gap-1.5 bg-white border border-border rounded-full px-3 py-1 shadow-sm">
            <div className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
            <span className="text-xs text-muted-foreground">{label}:</span>
            <span className="text-xs font-semibold text-foreground tabular-nums">{sb[key] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Сводные карточки */}
      <div className="flex gap-3 flex-wrap">
        <StatCard label="Ожидают" value={summary.totalWaiting} />
        <StatCard label="Врачей на приёме" value={summary.doctorsActive} sub={`из ${summary.doctorsTotal}`} />
        <StatCard label="С опозданием" value={summary.latePatients} warn={summary.latePatients > 0} sub="> 30 мин" />
        <StatCard
          label="Макс. ожидание"
          value={summary.maxWaitMinutes != null ? `${summary.maxWaitMinutes} мин` : '—'}
          warn={summary.maxWaitMinutes != null && summary.maxWaitMinutes > 60}
        />
      </div>

      {/* Таблица врачей */}
      {doctors.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Нет врачей</div>
      ) : (
        <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b border-border">
                {['ФИО', 'Специальность', 'Статус', 'Очередь', 'Сред. ожидание', 'Норматив', 'Ср. приём', 'Опоздавших'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(doctors as any[]).map((d: any) => (
                <tr key={d.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">
                    {d.lastName} {d.firstName}{d.middleName ? ` ${d.middleName[0]}.` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{d.specialty ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[d.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm tabular-nums text-foreground">{d.queueLength}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground tabular-nums">
                    {d.avgWaitMinutes != null ? `${d.avgWaitMinutes} мин` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground tabular-nums">
                    {d.normativeMinutes != null ? `${d.normativeMinutes} мин` : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-sm tabular-nums ${
                    d.avgDurationToday != null && d.normativeMinutes != null && d.avgDurationToday > d.normativeMinutes * 1.2
                      ? 'text-red-600 font-semibold'
                      : 'text-muted-foreground'
                  }`}>
                    {d.avgDurationToday != null ? `${d.avgDurationToday} мин` : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-sm tabular-nums ${d.lateCount > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                    {d.lateCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Проверить в браузере**

Открыть «Аналитика» → «Оперативная». Убедиться:
- Чипы статусов отображаются горизонтальной строкой
- Карточка «Макс. ожидание» появилась
- Таблица врачей содержит 8 колонок (ФИО, Специальность, Статус, Очередь, Сред. ожидание, Норматив, Ср. приём, Опоздавших)
- Статус «На перерыве» бейдж синий
- Нет ошибок в консоли браузера

- [ ] **Step 3: Коммит**

```bash
git add apps/frontend/src/components/analytics/OperationalPanel.tsx
git commit -m "feat(analytics): OperationalPanel — чипы статусов, макс. ожидание, норматив, перерыв"
git push
```

---

## Task 4: Frontend — обновить `HistoricalPanel.tsx`

**Files:**
- Modify: `apps/frontend/src/components/analytics/HistoricalPanel.tsx`

Полностью заменить содержимое файла:

- [ ] **Step 1: Заменить содержимое `HistoricalPanel.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import { trpc } from '@/lib/trpc';
import { PeriodSelector, type Period } from './PeriodSelector';

interface Props {
  deptId?: string;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex-1 min-w-[110px] bg-white border border-border rounded-lg p-4 shadow-sm">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренные',
  INPATIENT:  'Стационарные',
  SCHEDULED:  'Плановые',
  WALK_IN:    'Живая очередь',
};
const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: '#ef4444',
  INPATIENT:  '#f59e0b',
  SCHEDULED:  '#10b981',
  WALK_IN:    '#6366f1',
};
const SOURCE_LABEL: Record<string, string> = {
  REGISTRAR:   'Регистратура',
  CALL_CENTER: 'Колл-центр',
  KIOSK:       'Киоск',
  DOCTOR_SELF: 'Врач сам',
};
const SOURCE_COLOR: Record<string, string> = {
  REGISTRAR:   '#10b981',
  CALL_CENTER: '#6366f1',
  KIOSK:       '#f59e0b',
  DOCTOR_SELF: '#8b5cf6',
};

function BarRow({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-2 last:mb-0">
      <div className="text-sm text-slate-600 w-32 shrink-0">{label}</div>
      <div className="flex-1 h-2 rounded-full overflow-hidden bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-xs text-muted-foreground tabular-nums w-16 text-right">{count} ({pct}%)</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{children}</div>;
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function workloadColor(pct: number): string {
  if (pct < 70)  return 'text-amber-600';
  if (pct <= 90) return 'text-emerald-600';
  return 'text-red-600';
}

export function HistoricalPanel({ deptId }: Props) {
  const today = toIso(new Date());
  const weekAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 6); return toIso(d); })();

  const [period, setPeriod] = useState<Period>('week');
  const [from, setFrom]     = useState(weekAgo);
  const [to, setTo]         = useState(today);

  function handlePeriod(p: Period, f: string, t: string) {
    setPeriod(p); setFrom(f); setTo(t);
  }

  const { data, isLoading } = trpc.analytics.getHistorical.useQuery(
    { deptId, from, to },
    { enabled: !!from && !!to },
  );

  const d = data as any;
  const maxDay = d ? Math.max(...(d.byDay as any[]).map((x: any) => x.total), 1) : 1;
  const maxHour = d && d.byHour.length > 0 ? Math.max(...(d.byHour as any[]).map((x: any) => x.total), 1) : 1;
  const maxDow  = d && d.byDayOfWeek.length > 0 ? Math.max(...(d.byDayOfWeek as any[]).map((x: any) => x.total), 1) : 1;

  return (
    <div className="space-y-4">
      <PeriodSelector period={period} from={from} to={to} onChange={handlePeriod} />

      {isLoading && <div className="text-sm text-muted-foreground py-10 text-center">Загрузка...</div>}

      {d && (
        <>
          {/* Итоговые показатели */}
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Выполнено"     value={d.totals.completed} />
            <StatCard label="Пришли"        value={d.totals.arrived} />
            <StatCard label="Запланировано" value={d.totals.scheduled} />
            <StatCard label="% выполнения"  value={`${d.totals.completionRate}%`} />
            <StatCard label="% неявок"      value={`${d.totals.noShowRate}%`} />
            <StatCard label="Отменено"      value={d.totals.cancelled} />
          </div>

          {/* Временны́е показатели */}
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Сред. ожидание"   value={d.timing.avgWaitMinutes     != null ? `${d.timing.avgWaitMinutes} мин`     : '—'} />
            <StatCard label="Сред. приём"       value={d.timing.avgDurationMinutes != null ? `${d.timing.avgDurationMinutes} мин` : '—'} />
            <StatCard label="Сред. опоздание"   value={d.timing.avgLatenessMinutes != null ? `${d.timing.avgLatenessMinutes} мин` : '—'} />
            <StatCard label="Реакция врача"     value={d.timing.avgResponseMinutes != null ? `${d.timing.avgResponseMinutes} мин` : '—'} />
          </div>

          {/* Разбивки по приоритетам и источникам */}
          {(d.byPriority.length > 0 || d.bySource.length > 0) && (
            <div className="flex gap-4 flex-wrap">
              {d.byPriority.length > 0 && (
                <div className="flex-1 min-w-[240px] bg-white border border-border rounded-lg p-4 shadow-sm">
                  <SectionTitle>По приоритетам</SectionTitle>
                  {(d.byPriority as any[]).map((p: any) => (
                    <BarRow key={p.priority} label={PRIORITY_LABEL[p.priority] ?? p.priority}
                      count={p.count} pct={p.pct} color={PRIORITY_COLOR[p.priority] ?? '#6b7280'} />
                  ))}
                </div>
              )}
              {d.bySource.length > 0 && (
                <div className="flex-1 min-w-[240px] bg-white border border-border rounded-lg p-4 shadow-sm">
                  <SectionTitle>По источникам</SectionTitle>
                  {(d.bySource as any[]).map((s: any) => (
                    <BarRow key={s.source} label={SOURCE_LABEL[s.source] ?? s.source}
                      count={s.count} pct={s.pct} color={SOURCE_COLOR[s.source] ?? '#6b7280'} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Отмены по причинам */}
          {d.byCancelReason.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Отмены по причинам</SectionTitle>
              {(d.byCancelReason as any[]).map((r: any) => (
                <div key={r.reason} className="flex justify-between items-center text-sm py-1 border-b border-border last:border-0">
                  <span className="text-slate-600">{r.reason}</span>
                  <span className="font-semibold tabular-nums text-foreground">{r.count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Нагрузка по дням */}
          {d.byDay.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Нагрузка по дням</SectionTitle>
              <div className="space-y-2">
                {(d.byDay as any[]).map((day: any) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground w-16 shrink-0">{formatDay(day.date)}</div>
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="h-2 rounded-full overflow-hidden bg-muted">
                        <div className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${day.completed / maxDay * 100}%` }} />
                      </div>
                      <div className="h-2 rounded-full overflow-hidden bg-muted">
                        <div className="h-full rounded-full bg-red-400 transition-all"
                          style={{ width: `${day.noShow / maxDay * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                      {day.completed}/{day.noShow}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-3">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-emerald-500" /><span className="text-xs text-muted-foreground">Выполнено</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-red-400" /><span className="text-xs text-muted-foreground">Неявки</span></div>
              </div>
            </div>
          )}

          {/* Неявки по врачам */}
          {d.noShowByDoctor.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Неявки по врачам</SectionTitle>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['ФИО', 'Специальность', 'Неявки', 'Всего', '% неявок'].map(h => (
                      <th key={h} className={`text-xs font-semibold text-muted-foreground pb-2 ${h === 'ФИО' || h === 'Специальность' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.noShowByDoctor as any[]).map((doc: any) => (
                    <tr key={doc.doctorId} className="border-t border-border">
                      <td className="py-2 text-sm text-foreground">{doc.lastName} {doc.firstName}</td>
                      <td className="py-2 text-sm text-muted-foreground">{doc.specialty ?? '—'}</td>
                      <td className="py-2 text-sm tabular-nums text-right text-red-600 font-semibold">{doc.noShow}</td>
                      <td className="py-2 text-sm tabular-nums text-right text-muted-foreground">{doc.total}</td>
                      <td className="py-2 text-sm tabular-nums text-right font-semibold text-foreground">{doc.noShowRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Распределение по часам */}
          {d.byHour.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Распределение по часам</SectionTitle>
              <div className="space-y-1.5">
                {(d.byHour as any[]).map((h: any) => (
                  <div key={h.hour} className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground w-12 shrink-0 tabular-nums">
                      {String(h.hour).padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 h-2 rounded-full overflow-hidden bg-muted">
                      <div className="h-full rounded-full bg-blue-400 transition-all"
                        style={{ width: `${h.total / maxHour * 100}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums w-8 text-right">{h.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Распределение по дням недели */}
          {d.byDayOfWeek.length > 0 && (
            <div className="bg-white border border-border rounded-lg p-4 shadow-sm">
              <SectionTitle>Распределение по дням недели</SectionTitle>
              <div className="space-y-1.5">
                {(d.byDayOfWeek as any[]).map((day: any) => (
                  <div key={day.weekday} className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground w-8 shrink-0">{day.label}</div>
                    <div className="flex-1 h-2 rounded-full overflow-hidden bg-muted">
                      <div className="h-full rounded-full bg-indigo-400 transition-all"
                        style={{ width: `${day.total / maxDow * 100}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums w-8 text-right">{day.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Загрузка врачей */}
          {d.doctorWorkload.length > 0 && (
            <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="p-4 pb-2">
                <SectionTitle>Загрузка врачей</SectionTitle>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    {['ФИО', 'Специальность', 'Принято', 'Слоты план', 'Загрузка (слоты)', 'Время план (мин)', 'Время факт (мин)', 'Загрузка (время)'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.doctorWorkload as any[]).map((doc: any) => (
                    <tr key={doc.doctorId} className="border-t border-border hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">{doc.lastName} {doc.firstName}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{doc.specialty ?? '—'}</td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-foreground">{doc.completed}</td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
                        {doc.slotsTotal > 0 ? doc.slotsTotal : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-sm tabular-nums font-semibold ${doc.slotsTotal > 0 ? workloadColor(doc.workloadBySlotsPct) : 'text-muted-foreground'}`}>
                        {doc.slotsTotal > 0 ? `${doc.workloadBySlotsPct}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
                        {doc.scheduledMinutes > 0 ? doc.scheduledMinutes : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
                        {doc.actualMinutes > 0 ? doc.actualMinutes : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-sm tabular-nums font-semibold ${doc.scheduledMinutes > 0 ? workloadColor(doc.workloadByTimePct) : 'text-muted-foreground'}`}>
                        {doc.scheduledMinutes > 0 ? `${doc.workloadByTimePct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.totals.scheduled === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">Нет данных за выбранный период</div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Проверить в браузере**

Открыть «Аналитика» → «Историческая». Убедиться:
- Карточка «Пришли» появилась в первом ряду
- При наличии данных отображаются секции «Неявки по врачам», «Распределение по часам», «Распределение по дням недели», «Загрузка врачей»
- Цвета загрузки: жёлтый < 70%, зелёный 70–90%, красный > 90%
- Нет ошибок в консоли браузера

- [ ] **Step 3: Коммит**

```bash
git add apps/frontend/src/components/analytics/HistoricalPanel.tsx
git commit -m "feat(analytics): HistoricalPanel — неявки по врачам, по часам, по дням недели, загрузка"
git push
```

---

## Финальная проверка

- [ ] Войти как ADMIN → «Аналитика» → «Оперативная»: чипы, 4 карточки, 8 колонок в таблице
- [ ] Войти как ADMIN → «Аналитика» → «Историческая» → переключить период: все секции отображаются корректно
- [ ] Войти как DEPARTMENT_HEAD → вкладка «Аналитика»: данные только по своему отделению, нет фильтра сверху
- [ ] Консоль браузера: ноль ошибок
- [ ] `docker logs eque-backend --tail=30`: нет TypeScript-ошибок и исключений
