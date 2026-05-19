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
