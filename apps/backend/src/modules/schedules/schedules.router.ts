import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const breakSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/),
  label:     z.string().optional(),
});

export const createSchedulesRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({

    // For RegistrarView calendar: all schedules in a date range
    getForDateRange: trpc.protectedProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => {
        return (prisma as any).doctorDaySchedule.findMany({
          where: {
            date: {
              gte: new Date(input.startDate),
              lte: new Date(input.endDate),
            },
          },
          include: { breaks: { orderBy: { startTime: 'asc' } } },
        });
      }),

    // For department schedule grid
    getForDepartmentMonth: trpc.protectedProcedure
      .input(z.object({
        departmentId: z.string(),
        year:  z.number().int(),
        month: z.number().int().min(1).max(12),
      }))
      .query(async ({ input }) => {
        const { departmentId, year, month } = input;
        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 0);   // last day of month

        const doctors = await prisma.user.findMany({
          where: { departmentId, role: 'DOCTOR', isActive: true },
          select: { id: true, firstName: true, lastName: true, middleName: true, specialty: true },
          orderBy: { lastName: 'asc' },
        });

        const schedules = await (prisma as any).doctorDaySchedule.findMany({
          where: {
            doctorId: { in: doctors.map((d: any) => d.id) },
            date: { gte: startDate, lte: endDate },
          },
          include: { breaks: { orderBy: { startTime: 'asc' } } },
        });

        return { doctors, schedules };
      }),

    // Upsert a single day's schedule
    saveDay: trpc.protectedProcedure
      .input(z.object({
        doctorId:  z.string(),
        date:      z.string(),  // ISO "YYYY-MM-DD"
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime:   z.string().regex(/^\d{2}:\d{2}$/),
        breaks:    z.array(breakSchema).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Только администратор' });
        }
        const date = new Date(input.date);

        await prisma.$transaction(async (tx) => {
          const existing = await (tx as any).doctorDaySchedule.findFirst({
            where: { doctorId: input.doctorId, date },
            select: { id: true },
          });

          let scheduleId: string;

          if (existing) {
            await (tx as any).dayScheduleBreak.deleteMany({ where: { scheduleId: existing.id } });
            await (tx as any).doctorDaySchedule.update({
              where: { id: existing.id },
              data: { startTime: input.startTime, endTime: input.endTime },
            });
            scheduleId = existing.id;
          } else {
            const created = await (tx as any).doctorDaySchedule.create({
              data: { doctorId: input.doctorId, date, startTime: input.startTime, endTime: input.endTime },
            });
            scheduleId = created.id;
          }

          if (input.breaks.length > 0) {
            await (tx as any).dayScheduleBreak.createMany({
              data: input.breaks.map((b: any) => ({
                scheduleId,
                startTime: b.startTime,
                endTime:   b.endTime,
                label:     b.label ?? null,
              })),
            });
          }
        });

        return { success: true };
      }),

    // Delete a day's schedule
    deleteDay: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string(), date: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Только администратор' });
        }
        const entry = await (prisma as any).doctorDaySchedule.findFirst({
          where: { doctorId: input.doctorId, date: new Date(input.date) },
          select: { id: true },
        });
        if (!entry) return { success: true };

        await (prisma as any).dayScheduleBreak.deleteMany({ where: { scheduleId: entry.id } });
        await (prisma as any).doctorDaySchedule.delete({ where: { id: entry.id } });
        return { success: true };
      }),
  });
};
