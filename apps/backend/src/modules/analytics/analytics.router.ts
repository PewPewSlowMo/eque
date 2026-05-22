import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR', 'DEPARTMENT_HEAD'] as const;
const LATE_THRESHOLD_MS = 30 * 60 * 1000; // 30 минут
const KZ_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5 (Kazakhstan)

function parseMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Shift a UTC timestamp to KZ local time for extracting hours/weekdays
function kzDate(dt: Date): Date {
  return new Date(dt.getTime() + KZ_OFFSET_MS);
}

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
        const kzNow = kzDate(now);
        const nowMinutes = kzNow.getUTCHours() * 60 + kzNow.getUTCMinutes();
        const todayStr = kzNow.toISOString().slice(0, 10); // YYYY-MM-DD in KZ time
        // dayStart/dayEnd as KZ-midnight boundaries for QueueEntry timestamp queries
        const dayStart = new Date(todayStr + 'T00:00:00+05:00');
        const dayEnd   = new Date(todayStr + 'T23:59:59+05:00');
        // dayStartDate: UTC midnight of the KZ calendar date — for @db.Date field comparisons
        const dayStartDate = new Date(todayStr + 'T00:00:00.000Z');

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
            startedAt: true,
            completedAt: true,
          },
        });

        const schedules = await prisma.doctorDaySchedule.findMany({
          where: { doctorId: { in: doctorIds }, date: dayStartDate },
          include: { breaks: true },
        });
        const scheduleByDoctor = new Map(schedules.map(s => [s.doctorId, s]));

        const entriesByDoctor = new Map<string, typeof entries>();
        for (const e of entries) {
          if (!entriesByDoctor.has(e.doctorId)) entriesByDoctor.set(e.doctorId, []);
          entriesByDoctor.get(e.doctorId)!.push(e);
        }

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

        let totalWaiting = 0;
        let doctorsActive = 0;
        let latePatients = 0;

        const ORDER = { active: 0, break: 1, free: 2, off: 3 } as const;

        const doctorStats = doctors.map(d => {
          const dEntries = entriesByDoctor.get(d.id) ?? [];

          const hasInProgress = dEntries.some(e => e.status === 'IN_PROGRESS');
          const hasToday = dEntries.length > 0;
          const schedule = scheduleByDoctor.get(d.id);
          const normativeMinutes = schedule?.slotMinutes ?? null;
          const isOnBreak = schedule
            ? schedule.breaks.some(b => {
                const [bH, bM] = b.startTime.split(':').map(Number);
                const [eH, eM] = b.endTime.split(':').map(Number);
                return nowMinutes >= bH * 60 + bM && nowMinutes < eH * 60 + eM;
              })
            : false;
          const status: 'active' | 'break' | 'free' | 'off' =
            hasInProgress ? 'active' : isOnBreak ? 'break' : hasToday ? 'free' : 'off';

          const waiting = dEntries.filter(e => e.status === 'WAITING_ARRIVAL' || e.status === 'ARRIVED');
          const queueLength = waiting.length;

          const arrivedEntries = dEntries.filter(e => e.status === 'ARRIVED' && e.arrivedAt);
          const avgWaitMinutes = arrivedEntries.length > 0
            ? Math.round(arrivedEntries.reduce((s, e) => s + (now.getTime() - e.arrivedAt!.getTime()) / 60000, 0) / arrivedEntries.length)
            : null;

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

          if (status === 'active') doctorsActive++;
          totalWaiting += queueLength;
          latePatients += lateCount;

          return { id: d.id, lastName: d.lastName, firstName: d.firstName, middleName: d.middleName,
            specialty: d.specialty, status, queueLength, avgWaitMinutes,
            lateCount, avgDurationToday, normativeMinutes };
        });

        const sortedStats = [...doctorStats].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

        return {
          summary: { totalWaiting, doctorsActive, doctorsTotal: doctors.length, latePatients,
            statusBreakdown, maxWaitMinutes },
          doctors: sortedStats,
        };
      }),

    getHistorical: trpc.protectedProcedure
      .input(z.object({
        deptId: z.string().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

        const fromDate = new Date(input.from + 'T00:00:00+05:00');
        const toDate   = new Date(input.to   + 'T23:59:59+05:00');
        if (fromDate > toDate) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Дата начала не может быть позже даты конца' });
        }

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

        const arrived = entries.filter(e => e.arrivedAt != null).length;

        const noShowByDoctorMap = new Map<string, { noShow: number; total: number }>();
        for (const e of entries) {
          if (!noShowByDoctorMap.has(e.doctorId)) noShowByDoctorMap.set(e.doctorId, { noShow: 0, total: 0 });
          const rec = noShowByDoctorMap.get(e.doctorId)!;
          rec.total++;
          if (e.status === 'NO_SHOW') rec.noShow++;
        }
        const doctorIdsFromEntries = [...noShowByDoctorMap.keys()];

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

        const hourMap = new Map<number, { total: number; completed: number; noShow: number }>();
        for (const e of entries) {
          const hour = kzDate(e.scheduledAt ?? e.createdAt).getUTCHours();
          if (!hourMap.has(hour)) hourMap.set(hour, { total: 0, completed: 0, noShow: 0 });
          const h = hourMap.get(hour)!;
          h.total++;
          if (e.status === 'COMPLETED') h.completed++;
          if (e.status === 'NO_SHOW')   h.noShow++;
        }
        const byHour = [...hourMap.entries()]
          .map(([hour, v]) => ({ hour, ...v }))
          .sort((a, b) => a.hour - b.hour);

        const DOW_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dowMap = new Map<number, { total: number; completed: number; noShow: number }>();
        for (const e of entries) {
          const dow = kzDate(e.scheduledAt ?? e.createdAt).getUTCDay();
          if (!dowMap.has(dow)) dowMap.set(dow, { total: 0, completed: 0, noShow: 0 });
          const rec = dowMap.get(dow)!;
          rec.total++;
          if (e.status === 'COMPLETED') rec.completed++;
          if (e.status === 'NO_SHOW')   rec.noShow++;
        }
        const byDayOfWeek = [...dowMap.entries()]
          .map(([weekday, v]) => ({ weekday, label: DOW_LABELS[weekday], ...v }))
          .sort((a, b) => a.weekday - b.weekday);

        const completedByDoctor    = new Map<string, number>();
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
              if (s.slotMinutes > 0) slotsTotal += Math.floor(workingMins / s.slotMinutes);
              scheduledMinutes += workingMins;
            }

            const completedCount = completedByDoctor.get(id) ?? 0;
            const actualMinutes  = Math.round(actualMinutesByDoctor.get(id) ?? 0);

            return {
              doctorId:  id,
              lastName:  u?.lastName  ?? '',
              firstName: u?.firstName ?? '',
              specialty: u?.specialty ?? null,
              completed: completedCount,
              slotsTotal,
              slotsUsed:           completedCount,
              workloadBySlotsPct:  slotsTotal       > 0 ? Math.round(completedCount  / slotsTotal       * 100) : 0,
              scheduledMinutes,
              actualMinutes,
              workloadByTimePct:   scheduledMinutes > 0 ? Math.round(actualMinutes   / scheduledMinutes * 100) : 0,
            };
          })
          .sort((a, b) => b.workloadBySlotsPct - a.workloadBySlotsPct);

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
          totals: { scheduled: total, completed, noShow, arrived, cancelled,
            completionRate: total > 0 ? Math.round(completed / total * 100) : 0,
            noShowRate:     total > 0 ? Math.round(noShow    / total * 100) : 0 },
          timing: { avgWaitMinutes, avgDurationMinutes, avgLatenessMinutes, avgResponseMinutes },
          byPriority, bySource, byCancelReason, byDay,
          noShowByDoctor, byHour, byDayOfWeek, doctorWorkload,
        };
      }),

  });
};
