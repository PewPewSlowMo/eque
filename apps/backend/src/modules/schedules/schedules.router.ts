import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const breakSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат: HH:MM'),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/, 'Формат: HH:MM'),
  label:     z.string().optional(),
});

const daySchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/),
  breaks:    z.array(breakSchema).default([]),
});

export const createSchedulesRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getForDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string() }))
      .query(async ({ input }) => {
        return prisma.doctorSchedule.findMany({
          where: { doctorId: input.doctorId, isActive: true },
          include: { breaks: { orderBy: { startTime: 'asc' } } },
          orderBy: { dayOfWeek: 'asc' },
        });
      }),

    getAll: trpc.protectedProcedure.query(async () => {
      return prisma.doctorSchedule.findMany({
        where: { isActive: true },
        include: {
          doctor: {
            select: { id: true, firstName: true, lastName: true, middleName: true, specialty: true },
          },
          breaks: { orderBy: { startTime: 'asc' } },
        },
        orderBy: [{ doctorId: 'asc' }, { dayOfWeek: 'asc' }],
      });
    }),

    saveWeeklySchedule: trpc.protectedProcedure
      .input(z.object({
        doctorId: z.string(),
        days: z.array(daySchema),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Только администратор может изменять графики' });
        }

        await prisma.$transaction(async (tx) => {
          const existing = await (tx as any).doctorSchedule.findMany({
            where: { doctorId: input.doctorId },
            select: { id: true },
          });

          if (existing.length > 0) {
            await (tx as any).scheduleBreak.deleteMany({
              where: { scheduleId: { in: existing.map((s: any) => s.id) } },
            });
            await (tx as any).doctorSchedule.deleteMany({
              where: { doctorId: input.doctorId },
            });
          }

          for (const day of input.days) {
            const schedule = await (tx as any).doctorSchedule.create({
              data: {
                doctorId: input.doctorId,
                dayOfWeek: day.dayOfWeek,
                startTime: day.startTime,
                endTime:   day.endTime,
                isActive:  true,
              },
            });

            if (day.breaks.length > 0) {
              await (tx as any).scheduleBreak.createMany({
                data: day.breaks.map((b: any) => ({
                  scheduleId: schedule.id,
                  startTime:  b.startTime,
                  endTime:    b.endTime,
                  label:      b.label ?? null,
                })),
              });
            }
          }
        });

        return { success: true };
      }),
  });
};
