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
        if (user.role === 'DEPARTMENT_HEAD' && !user.departmentId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Отделение не назначено' });
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

        const sortedStats = [...doctorStats].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

        return {
          summary: { totalWaiting, doctorsActive, doctorsTotal: doctors.length, latePatients },
          doctors: sortedStats,
        };
      }),

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
        if (user.role === 'DEPARTMENT_HEAD' && !user.departmentId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Отделение не назначено' });
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
          const sorted = [...dEntries].sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());
          for (let i = 0; i < sorted.length - 1; i++) {
            const gap = (sorted[i + 1].calledAt!.getTime() - sorted[i].completedAt!.getTime()) / 60000;
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

  });
};
