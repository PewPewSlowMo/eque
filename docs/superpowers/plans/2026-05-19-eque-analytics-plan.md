# Analytics Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить модуль аналитики (оперативный + исторический) для ролей ADMIN, DIRECTOR, DEPARTMENT_HEAD с отдельным табом в AdminPanel и DepartmentHeadView.

**Architecture:** Новый tRPC роутер `analytics.router.ts` с двумя процедурами (`getOperational`, `getHistorical`). На фронтенде — четыре компонента в `src/components/analytics/`, встраиваемых через единый `AnalyticsTab`. Проект не имеет тестового фреймворка — верификация через ручной запуск контейнеров.

**Tech Stack:** NestJS + tRPC + Prisma, React + Vite + Tailwind CSS, без внешних charting-библиотек.

---

## Файловая структура

**Создать:**
- `apps/backend/src/modules/analytics/analytics.router.ts`
- `apps/frontend/src/components/analytics/PeriodSelector.tsx`
- `apps/frontend/src/components/analytics/OperationalPanel.tsx`
- `apps/frontend/src/components/analytics/HistoricalPanel.tsx`
- `apps/frontend/src/components/analytics/AnalyticsTab.tsx`

**Изменить:**
- `apps/backend/src/trpc/trpc.router.ts` — зарегистрировать `analytics`
- `apps/frontend/src/components/AdminPanel.tsx` — добавить таб «Аналитика»
- `apps/frontend/src/components/DepartmentHeadView.tsx` — добавить таб «Аналитика»

---

## Task 1: Backend — analytics.router.ts с getOperational

**Files:**
- Create: `apps/backend/src/modules/analytics/analytics.router.ts`

- [ ] **Step 1: Создать файл роутера**

```typescript
// apps/backend/src/modules/analytics/analytics.router.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR', 'DEPARTMENT_HEAD'] as const;
const LATE_THRESHOLD_MS = 30 * 60 * 1000; // 30 минут

export const createAnalyticsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({

    getOperational: trpc.protectedProcedure
      .input(z.object({ deptId: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        const { user } = ctx;
        if (!(ALLOWED_ROLES as readonly string[]).includes(user.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        if (user.role === 'DEPARTMENT_HEAD' && input.deptId && input.deptId !== user.departmentId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа к этому отделению' });
        }

        const effectiveDeptId: string | undefined =
          user.role === 'DEPARTMENT_HEAD'
            ? (user.departmentId ?? undefined)
            : (input.deptId || undefined);

        const now = new Date();
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        const doctors = await prisma.user.findMany({
          where: {
            role: 'DOCTOR',
            isActive: true,
            ...(effectiveDeptId ? { departmentId: effectiveDeptId } : {}),
          },
          select: { id: true, firstName: true, lastName: true, middleName: true, specialty: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        });

        const doctorIds = doctors.map(d => d.id);

        const entries = await prisma.queueEntry.findMany({
          where: {
            doctorId: { in: doctorIds },
            OR: [
              { status: { in: ['CALLED', 'IN_PROGRESS', 'WAITING_ARRIVAL', 'ARRIVED'] } },
              { scheduledAt: { gte: dayStart, lte: dayEnd } },
              { scheduledAt: null, createdAt: { gte: dayStart, lte: dayEnd } },
            ],
          },
          select: {
            doctorId: true,
            status: true,
            arrivedAt: true,
            scheduledAt: true,
            createdAt: true,
          },
        });

        const entriesByDoctor = new Map<string, typeof entries>();
        for (const e of entries) {
          if (!entriesByDoctor.has(e.doctorId)) entriesByDoctor.set(e.doctorId, []);
          entriesByDoctor.get(e.doctorId)!.push(e);
        }

        let totalWaiting = 0;
        let doctorsActive = 0;
        let latePatients = 0;

        const ORDER = { active: 0, free: 1, off: 2 } as const;

        const doctorStats = doctors.map(d => {
          const dEntries = entriesByDoctor.get(d.id) ?? [];

          const hasInProgress = dEntries.some(e => e.status === 'IN_PROGRESS');
          const hasToday = dEntries.length > 0;
          const status: 'active' | 'free' | 'off' = hasInProgress ? 'active' : hasToday ? 'free' : 'off';

          const waiting = dEntries.filter(e => e.status === 'WAITING_ARRIVAL' || e.status === 'ARRIVED');
          const queueLength = waiting.length;

          const arrivedEntries = dEntries.filter(e => e.status === 'ARRIVED' && e.arrivedAt);
          const avgWaitMinutes = arrivedEntries.length > 0
            ? Math.round(arrivedEntries.reduce((s, e) => s + (now.getTime() - e.arrivedAt!.getTime()) / 60000, 0) / arrivedEntries.length)
            : null;

          const late = dEntries.filter(e => {
            if (e.status !== 'WAITING_ARRIVAL') return false;
            const ref = e.scheduledAt ?? e.createdAt;
            return now.getTime() - ref.getTime() > LATE_THRESHOLD_MS;
          }).length;

          if (status === 'active') doctorsActive++;
          totalWaiting += queueLength;
          latePatients += late;

          return { id: d.id, lastName: d.lastName, firstName: d.firstName, middleName: d.middleName,
            specialty: d.specialty, status, queueLength, avgWaitMinutes };
        });

        doctorStats.sort((a, b) => ORDER[a.status] - ORDER[b.status]);

        return {
          summary: { totalWaiting, doctorsActive, doctorsTotal: doctors.length, latePatients },
          doctors: doctorStats,
        };
      }),

  });
};
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

Ожидаем: нет ошибок (или ошибки только в других файлах).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/analytics/analytics.router.ts
git commit -m "feat(analytics): getOperational — оперативная аналитика по врачам"
```

---

## Task 2: Backend — добавить getHistorical в analytics.router.ts

**Files:**
- Modify: `apps/backend/src/modules/analytics/analytics.router.ts`

- [ ] **Step 1: Добавить процедуру getHistorical**

Добавить после процедуры `getOperational` (перед финальной закрывающей скобкой `});`):

```typescript
    getHistorical: trpc.protectedProcedure
      .input(z.object({
        deptId: z.string().optional(),
        from: z.string(), // YYYY-MM-DD
        to: z.string(),   // YYYY-MM-DD включительно
      }))
      .query(async ({ input, ctx }) => {
        const { user } = ctx;
        if (!(ALLOWED_ROLES as readonly string[]).includes(user.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        if (user.role === 'DEPARTMENT_HEAD' && input.deptId && input.deptId !== user.departmentId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа к этому отделению' });
        }

        const effectiveDeptId: string | undefined =
          user.role === 'DEPARTMENT_HEAD'
            ? (user.departmentId ?? undefined)
            : (input.deptId || undefined);

        const fromDate = new Date(input.from + 'T00:00:00');
        const toDate   = new Date(input.to   + 'T23:59:59.999');

        const entries = await prisma.queueEntry.findMany({
          where: {
            ...(effectiveDeptId ? { doctor: { departmentId: effectiveDeptId } } : {}),
            OR: [
              { scheduledAt: { gte: fromDate, lte: toDate } },
              { scheduledAt: null, createdAt: { gte: fromDate, lte: toDate } },
            ],
          },
          select: {
            status: true, priority: true, source: true, cancelReason: true,
            arrivedAt: true, calledAt: true, startedAt: true, completedAt: true,
            scheduledAt: true, createdAt: true, doctorId: true,
          },
        });

        const total     = entries.length;
        const completed = entries.filter(e => e.status === 'COMPLETED').length;
        const noShow    = entries.filter(e => e.status === 'NO_SHOW').length;
        const cancelled = entries.filter(e => e.status === 'CANCELLED').length;

        // Среднее время ожидания: arrivedAt → calledAt
        const waitTimes = entries
          .filter(e => e.arrivedAt && e.calledAt)
          .map(e => (e.calledAt!.getTime() - e.arrivedAt!.getTime()) / 60000);
        const avgWaitMinutes = waitTimes.length > 0
          ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : null;

        // Средняя длительность приёма: startedAt → completedAt
        const durations = entries
          .filter(e => e.startedAt && e.completedAt)
          .map(e => (e.completedAt!.getTime() - e.startedAt!.getTime()) / 60000);
        const avgDurationMinutes = durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

        // Среднее опоздание пациента (только SCHEDULED, только положительное)
        const latenesses = entries
          .filter(e => e.priority === 'SCHEDULED' && e.arrivedAt && e.scheduledAt)
          .map(e => (e.arrivedAt!.getTime() - e.scheduledAt!.getTime()) / 60000)
          .filter(v => v > 0);
        const avgLatenessMinutes = latenesses.length > 0
          ? Math.round(latenesses.reduce((a, b) => a + b, 0) / latenesses.length) : null;

        // Время реакции врача: промежуток между completedAt[i] и calledAt[i+1] у того же врача
        const completedEntries = entries.filter(e => e.completedAt && e.calledAt);
        const byDoctor = new Map<string, typeof completedEntries>();
        for (const e of completedEntries) {
          if (!byDoctor.has(e.doctorId)) byDoctor.set(e.doctorId, []);
          byDoctor.get(e.doctorId)!.push(e);
        }
        const responseTimes: number[] = [];
        for (const [, dEntries] of byDoctor) {
          dEntries.sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());
          for (let i = 0; i < dEntries.length - 1; i++) {
            const gap = (dEntries[i + 1].calledAt!.getTime() - dEntries[i].completedAt!.getTime()) / 60000;
            if (gap >= 0 && gap < 60) responseTimes.push(gap);
          }
        }
        const avgResponseMinutes = responseTimes.length > 0
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;

        // Разбивка по приоритетам
        const priorityCounts = new Map<string, number>();
        for (const e of entries) priorityCounts.set(e.priority, (priorityCounts.get(e.priority) ?? 0) + 1);
        const byPriority = (['EMERGENCY', 'INPATIENT', 'SCHEDULED', 'WALK_IN'] as const)
          .map(p => ({ priority: p, count: priorityCounts.get(p) ?? 0,
            pct: total > 0 ? Math.round((priorityCounts.get(p) ?? 0) / total * 100) : 0 }))
          .filter(p => p.count > 0);

        // Разбивка по источникам
        const sourceCounts = new Map<string, number>();
        for (const e of entries) sourceCounts.set(e.source, (sourceCounts.get(e.source) ?? 0) + 1);
        const bySource = (['REGISTRAR', 'CALL_CENTER', 'KIOSK', 'DOCTOR_SELF'] as const)
          .map(s => ({ source: s, count: sourceCounts.get(s) ?? 0,
            pct: total > 0 ? Math.round((sourceCounts.get(s) ?? 0) / total * 100) : 0 }))
          .filter(s => s.count > 0);

        // Отмены по причинам
        const reasonCounts = new Map<string, number>();
        for (const e of entries.filter(e => e.status === 'CANCELLED')) {
          const r = e.cancelReason || 'Не указана';
          reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
        }
        const byCancelReason = Array.from(reasonCounts.entries())
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count);

        // Нагрузка по дням
        const dayMap = new Map<string, { completed: number; noShow: number; total: number }>();
        for (const e of entries) {
          const date = (e.scheduledAt ?? e.createdAt).toISOString().slice(0, 10);
          if (!dayMap.has(date)) dayMap.set(date, { completed: 0, noShow: 0, total: 0 });
          const day = dayMap.get(date)!;
          day.total++;
          if (e.status === 'COMPLETED') day.completed++;
          if (e.status === 'NO_SHOW') day.noShow++;
        }
        const byDay = Array.from(dayMap.entries())
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date));

        return {
          totals: { scheduled: total, completed, noShow, cancelled,
            completionRate: total > 0 ? Math.round(completed / total * 100) : 0,
            noShowRate: total > 0 ? Math.round(noShow / total * 100) : 0 },
          timing: { avgWaitMinutes, avgDurationMinutes, avgLatenessMinutes, avgResponseMinutes },
          byPriority, bySource, byCancelReason, byDay,
        };
      }),
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/analytics/analytics.router.ts
git commit -m "feat(analytics): getHistorical — историческая аналитика за период"
```

---

## Task 3: Backend — зарегистрировать analytics в trpc.router.ts

**Files:**
- Modify: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 1: Добавить импорт**

В конец блока импортов в `apps/backend/src/trpc/trpc.router.ts` добавить строку:

```typescript
import { createAnalyticsRouter } from '../modules/analytics/analytics.router';
```

- [ ] **Step 2: Зарегистрировать роутер**

В объекте `appRouter` (после `kiosk: createKioskRouter(...)`) добавить:

```typescript
    analytics: createAnalyticsRouter(this.trpc, this.prisma),
```

- [ ] **Step 3: Пересобрать и проверить в Docker**

```bash
docker exec eque-backend sh -c "cd /app && node dist/src/main.js" 2>&1 | head -5
```

Или перезапустить контейнер:

```bash
docker compose restart backend
```

Ожидаем: backend стартует без ошибок.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/trpc/trpc.router.ts
git commit -m "feat(analytics): зарегистрировать analytics роутер в tRPC"
```

---

## Task 4: Frontend — PeriodSelector.tsx

**Files:**
- Create: `apps/frontend/src/components/analytics/PeriodSelector.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
// apps/frontend/src/components/analytics/PeriodSelector.tsx

export type Period = 'today' | 'week' | 'month' | 'custom';

interface Props {
  period: Period;
  from: string;
  to: string;
  onChange: (period: Period, from: string, to: string) => void;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function PeriodSelector({ period, from, to, onChange }: Props) {
  const today = toIso(new Date());

  function select(p: Period) {
    if (p === 'today')  { onChange(p, today, today); return; }
    if (p === 'week')   { const d = new Date(); d.setDate(d.getDate() - 6); onChange(p, toIso(d), today); return; }
    if (p === 'month')  { const d = new Date(); d.setDate(d.getDate() - 29); onChange(p, toIso(d), today); return; }
    onChange(p, from, to);
  }

  const btnBase = 'text-[9px] font-semibold px-2.5 py-1 transition-colors';
  const active  = { background: 'rgba(0,104,91,.3)', color: '#00a08f', borderRadius: '3px 10px 10px 3px' };
  const inactive = { color: 'rgba(255,255,255,.5)', background: 'transparent' };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(['today', 'week', 'month', 'custom'] as Period[]).map(p => (
        <button key={p} className={btnBase} style={period === p ? active : inactive} onClick={() => select(p)}>
          {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Период'}
        </button>
      ))}
      {period === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date" value={from}
            onChange={e => onChange('custom', e.target.value, to)}
            className="text-[9px] px-1.5 py-0.5 outline-none"
            style={{ background: '#12151e', border: '1px solid #252831', borderRadius: 4, color: '#e2e8f0' }}
          />
          <span className="text-[9px] text-slate-500">—</span>
          <input
            type="date" value={to}
            onChange={e => onChange('custom', from, e.target.value)}
            className="text-[9px] px-1.5 py-0.5 outline-none"
            style={{ background: '#12151e', border: '1px solid #252831', borderRadius: 4, color: '#e2e8f0' }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/analytics/PeriodSelector.tsx
git commit -m "feat(analytics): PeriodSelector — выбор периода для исторической аналитики"
```

---

## Task 5: Frontend — OperationalPanel.tsx

**Files:**
- Create: `apps/frontend/src/components/analytics/OperationalPanel.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
// apps/frontend/src/components/analytics/OperationalPanel.tsx
import { trpc } from '@/lib/trpc';

interface Props {
  deptId?: string;
}

function StatCard({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className="flex-1 min-w-[100px] p-3 rounded"
      style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.25)' }}>
      <div className="text-[8px] text-slate-500 mb-1">{label}</div>
      <div className={`text-[20px] font-bold tabular-nums ${warn ? 'text-red-400' : 'text-slate-100'}`}>{value}</div>
      {sub && <div className="text-[8px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  active: '#00a08f',
  free:   '#B39168',
  off:    '#4b5563',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Принимает',
  free:   'Свободен',
  off:    'Не вышел',
};

export function OperationalPanel({ deptId }: Props) {
  const { data, isLoading } = trpc.analytics.getOperational.useQuery(
    { deptId },
    { refetchInterval: 30_000 },
  );

  if (isLoading) return <div className="text-[10px] text-slate-500 py-8 text-center">Загрузка...</div>;
  if (!data) return null;

  const { summary, doctors } = data as any;

  return (
    <div className="space-y-4">
      {/* Сводные карточки */}
      <div className="flex gap-3 flex-wrap">
        <StatCard label="Ожидают" value={summary.totalWaiting} />
        <StatCard label="Врачей на приёме" value={summary.doctorsActive} sub={`из ${summary.doctorsTotal}`} />
        <StatCard label="С опозданием" value={summary.latePatients} warn={summary.latePatients > 0} sub="> 30 мин" />
      </div>

      {/* Таблица врачей */}
      {doctors.length === 0 ? (
        <div className="text-[10px] text-slate-500 text-center py-6">Нет врачей</div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid rgba(0,104,91,.2)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: 'rgba(0,104,91,.1)' }}>
                {['ФИО', 'Специальность', 'Статус', 'Очередь', 'Сред. ожидание'].map(h => (
                  <th key={h} className="text-left text-[8px] font-semibold text-slate-400 px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(doctors as any[]).map((d: any) => (
                <tr key={d.id} style={{ borderTop: '1px solid rgba(255,255,255,.04)' }}>
                  <td className="px-3 py-2 text-[10px] text-slate-200">
                    {d.lastName} {d.firstName}{d.middleName ? ` ${d.middleName[0]}.` : ''}
                  </td>
                  <td className="px-3 py-2 text-[9px] text-slate-400">{d.specialty ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: STATUS_COLOR[d.status] + '22', color: STATUS_COLOR[d.status] }}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-200 tabular-nums">{d.queueLength}</td>
                  <td className="px-3 py-2 text-[9px] text-slate-400 tabular-nums">
                    {d.avgWaitMinutes != null ? `${d.avgWaitMinutes} мин` : '—'}
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

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/analytics/OperationalPanel.tsx
git commit -m "feat(analytics): OperationalPanel — живые данные по врачам"
```

---

## Task 6: Frontend — HistoricalPanel.tsx

**Files:**
- Create: `apps/frontend/src/components/analytics/HistoricalPanel.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
// apps/frontend/src/components/analytics/HistoricalPanel.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PeriodSelector, type Period } from './PeriodSelector';

interface Props {
  deptId?: string;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex-1 min-w-[90px] p-3 rounded"
      style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.25)' }}>
      <div className="text-[8px] text-slate-500 mb-1">{label}</div>
      <div className="text-[18px] font-bold tabular-nums text-slate-100">{value}</div>
      {sub && <div className="text-[8px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const PRIORITY_LABEL: Record<string, string> = {
  EMERGENCY: 'Экстренные',
  INPATIENT: 'Стационарные',
  SCHEDULED: 'Плановые',
  WALK_IN:   'Живая очередь',
};
const PRIORITY_COLOR: Record<string, string> = {
  EMERGENCY: '#ef4444',
  INPATIENT: '#f59e0b',
  SCHEDULED: '#00a08f',
  WALK_IN:   '#6366f1',
};
const SOURCE_LABEL: Record<string, string> = {
  REGISTRAR:   'Регистратура',
  CALL_CENTER: 'Колл-центр',
  KIOSK:       'Киоск',
  DOCTOR_SELF: 'Врач сам',
};
const SOURCE_COLOR: Record<string, string> = {
  REGISTRAR:   '#00a08f',
  CALL_CENTER: '#6366f1',
  KIOSK:       '#f59e0b',
  DOCTOR_SELF: '#B39168',
};

function BarRow({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <div className="text-[9px] text-slate-400 w-[110px] shrink-0">{label}</div>
      <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.07)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[8px] text-slate-500 tabular-nums w-[36px] text-right">{count} / {pct}%</div>
    </div>
  );
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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

  return (
    <div className="space-y-4">
      <PeriodSelector period={period} from={from} to={to} onChange={handlePeriod} />

      {isLoading && <div className="text-[10px] text-slate-500 py-8 text-center">Загрузка...</div>}

      {d && (
        <>
          {/* Итоги */}
          <div className="flex gap-2 flex-wrap">
            <StatCard label="Выполнено"    value={d.totals.completed} />
            <StatCard label="Запланировано" value={d.totals.scheduled} />
            <StatCard label="% выполнения"  value={`${d.totals.completionRate}%`} />
            <StatCard label="% неявок"      value={`${d.totals.noShowRate}%`} />
            <StatCard label="Отменено"      value={d.totals.cancelled} />
          </div>

          {/* Временны́е показатели */}
          <div className="flex gap-2 flex-wrap">
            <StatCard label="Сред. ожидание"      value={d.timing.avgWaitMinutes != null ? `${d.timing.avgWaitMinutes} мин` : '—'} />
            <StatCard label="Сред. приём"          value={d.timing.avgDurationMinutes != null ? `${d.timing.avgDurationMinutes} мин` : '—'} />
            <StatCard label="Сред. опоздание"      value={d.timing.avgLatenessMinutes != null ? `${d.timing.avgLatenessMinutes} мин` : '—'} />
            <StatCard label="Время реакции врача"  value={d.timing.avgResponseMinutes != null ? `${d.timing.avgResponseMinutes} мин` : '—'} />
          </div>

          {/* Разбивки */}
          {(d.byPriority.length > 0 || d.bySource.length > 0) && (
            <div className="flex gap-4 flex-wrap">
              {d.byPriority.length > 0 && (
                <div className="flex-1 min-w-[200px] p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
                  <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">По приоритетам</div>
                  {(d.byPriority as any[]).map((p: any) => (
                    <BarRow key={p.priority} label={PRIORITY_LABEL[p.priority] ?? p.priority}
                      count={p.count} pct={p.pct} color={PRIORITY_COLOR[p.priority] ?? '#6b7280'} />
                  ))}
                </div>
              )}
              {d.bySource.length > 0 && (
                <div className="flex-1 min-w-[200px] p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
                  <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">По источникам</div>
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
            <div className="p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
              <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">Отмены по причинам</div>
              {(d.byCancelReason as any[]).map((r: any) => (
                <div key={r.reason} className="flex justify-between text-[9px] mb-1">
                  <span className="text-slate-400">{r.reason}</span>
                  <span className="text-slate-200 font-semibold tabular-nums">{r.count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Нагрузка по дням */}
          {d.byDay.length > 0 && (
            <div className="p-3 rounded" style={{ background: '#12151e', border: '1px solid rgba(0,104,91,.2)' }}>
              <div className="text-[8px] font-semibold text-slate-400 mb-2 uppercase tracking-wide">Нагрузка по дням</div>
              <div className="space-y-1.5">
                {(d.byDay as any[]).map((day: any) => (
                  <div key={day.date} className="flex items-center gap-2">
                    <div className="text-[9px] text-slate-500 w-[52px] shrink-0">{formatDay(day.date)}</div>
                    <div className="flex-1 flex flex-col gap-0.5">
                      <div className="h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.07)' }}>
                        <div className="h-full rounded-full" style={{ width: `${day.completed / maxDay * 100}%`, background: '#00a08f' }} />
                      </div>
                      <div className="h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.07)' }}>
                        <div className="h-full rounded-full" style={{ width: `${day.noShow / maxDay * 100}%`, background: '#ef4444' }} />
                      </div>
                    </div>
                    <div className="text-[8px] text-slate-500 tabular-nums w-[36px] text-right">
                      {day.completed}/{day.noShow}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-2">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: '#00a08f' }} /><span className="text-[8px] text-slate-500">Выполнено</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: '#ef4444' }} /><span className="text-[8px] text-slate-500">Неявки</span></div>
              </div>
            </div>
          )}

          {d.totals.scheduled === 0 && (
            <div className="text-[10px] text-slate-500 text-center py-6">Нет данных за выбранный период</div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/analytics/HistoricalPanel.tsx
git commit -m "feat(analytics): HistoricalPanel — исторические отчёты за период"
```

---

## Task 7: Frontend — AnalyticsTab.tsx

**Files:**
- Create: `apps/frontend/src/components/analytics/AnalyticsTab.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
// apps/frontend/src/components/analytics/AnalyticsTab.tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { OperationalPanel } from './OperationalPanel';
import { HistoricalPanel } from './HistoricalPanel';

interface Props {
  lockedDeptId?: string;
}

export function AnalyticsTab({ lockedDeptId }: Props) {
  const [mode, setMode] = useState<'operational' | 'historical'>('operational');
  const [selectedDeptId, setSelectedDeptId] = useState<string | undefined>(undefined);

  const { data: departments = [] } = trpc.departments.getAll.useQuery(
    { includeInactive: false },
    { enabled: !lockedDeptId },
  );

  const deptId = lockedDeptId ?? selectedDeptId;

  const btnBase = 'text-[9px] font-semibold px-3 py-1.5 transition-colors';
  const activeStyle = { background: 'rgba(0,104,91,.3)', color: '#00a08f', borderRadius: '3px 10px 10px 3px' };
  const inactiveStyle = { color: 'rgba(255,255,255,.5)', background: 'transparent' };

  return (
    <div className="space-y-3">
      {/* Фильтр отделения (только для ADMIN/DIRECTOR) */}
      {!lockedDeptId && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-slate-500">Отделение:</span>
          <select
            value={selectedDeptId ?? ''}
            onChange={e => setSelectedDeptId(e.target.value || undefined)}
            className="text-[9px] px-2 py-1 outline-none"
            style={{ background: '#12151e', border: '1px solid #252831', borderRadius: 4, color: '#e2e8f0' }}
          >
            <option value="">Вся клиника</option>
            {(departments as any[]).map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Переключатель режимов */}
      <div className="flex items-center gap-1">
        <button className={btnBase} style={mode === 'operational' ? activeStyle : inactiveStyle}
          onClick={() => setMode('operational')}>
          Оперативная
        </button>
        <button className={btnBase} style={mode === 'historical' ? activeStyle : inactiveStyle}
          onClick={() => setMode('historical')}>
          Историческая
        </button>
      </div>

      {/* Панели */}
      {mode === 'operational' ? (
        <OperationalPanel deptId={deptId} />
      ) : (
        <HistoricalPanel deptId={deptId} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/analytics/AnalyticsTab.tsx
git commit -m "feat(analytics): AnalyticsTab — главный компонент с переключателем режимов"
```

---

## Task 8: Frontend — интеграция в AdminPanel.tsx

**Files:**
- Modify: `apps/frontend/src/components/AdminPanel.tsx`

AdminPanel использует `Tabs` из shadcn UI. Аналитику показываем ADMIN и DIRECTOR.

- [ ] **Step 1: Добавить импорт**

В начало файла `apps/frontend/src/components/AdminPanel.tsx` добавить:

```tsx
import { AnalyticsTab } from './analytics/AnalyticsTab';
```

- [ ] **Step 2: Добавить переменную isDirector**

После строки `const isDeptHead = user?.role === 'DEPARTMENT_HEAD';` добавить:

```tsx
  const isDirector = user?.role === 'DIRECTOR';
```

- [ ] **Step 3: Добавить TabsTrigger**

В `<TabsList>`, после `{isAdmin && <TabsTrigger value="backup">Бэкап</TabsTrigger>}` добавить:

```tsx
          {(isAdmin || isDirector) && <TabsTrigger value="analytics">Аналитика</TabsTrigger>}
```

- [ ] **Step 4: Добавить TabsContent**

Перед закрывающим `</Tabs>` добавить:

```tsx
        {(isAdmin || isDirector) && (
          <TabsContent value="analytics" className="pt-4">
            <AnalyticsTab />
          </TabsContent>
        )}
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/AdminPanel.tsx
git commit -m "feat(analytics): добавить таб Аналитика в AdminPanel"
```

---

## Task 9: Frontend — интеграция в DepartmentHeadView.tsx

**Files:**
- Modify: `apps/frontend/src/components/DepartmentHeadView.tsx`

DepartmentHeadView использует кастомный переключатель (`tab: 'plan' | 'list'`). Добавляем `'analytics'`.

- [ ] **Step 1: Добавить импорт**

В начало `DepartmentHeadView.tsx` добавить:

```tsx
import { AnalyticsTab } from './analytics/AnalyticsTab';
```

- [ ] **Step 2: Расширить тип tab**

Найти строку:
```tsx
  const [tab, setTab] = useState<'plan' | 'list'>('plan');
```
Заменить на:
```tsx
  const [tab, setTab] = useState<'plan' | 'list' | 'analytics'>('plan');
```

- [ ] **Step 3: Добавить кнопку в переключатель**

Найти блок с кнопками `setTab('plan')` и `setTab('list')`. Рядом с ними добавить кнопку:

```tsx
          <button onClick={() => setTab('analytics')}
            className={`text-[9px] font-semibold px-2.5 py-1 transition-colors ${tab === 'analytics' ? 'text-white' : 'text-slate-500'}`}>
            Аналитика
          </button>
```

- [ ] **Step 4: Добавить рендер панели**

В месте где рендерится содержимое (рядом с `{tab === 'plan' ? (...)`) добавить ветку для аналитики. Найти конец условного рендера (обычно это `)} : (...)`) и добавить:

```tsx
      {tab === 'analytics' && (
        <div className="p-3 overflow-y-auto flex-1">
          <AnalyticsTab lockedDeptId={departmentId || undefined} />
        </div>
      )}
```

- [ ] **Step 5: Проверить в браузере**

Убедиться что:
1. Таб «Аналитика» появился в DepartmentHeadView
2. Таб «Аналитика» появился в AdminPanel
3. Оперативная панель показывает врачей
4. Историческая панель отображает данные за неделю
5. Фильтр отделения работает в AdminPanel

- [ ] **Step 6: Commit и push**

```bash
git add apps/frontend/src/components/DepartmentHeadView.tsx
git commit -m "feat(analytics): добавить таб Аналитика в DepartmentHeadView"
git push
```
