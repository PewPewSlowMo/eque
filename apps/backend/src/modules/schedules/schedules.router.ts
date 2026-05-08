import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const breakSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/),
  label:     z.string().optional(),
});

function generateSlots(
  startTime: string,
  endTime: string,
  slotMinutes: number,
  breaks: { startTime: string; endTime: string }[],
): string[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;
  const breakRanges = breaks.map(b => {
    const [bs, bsm] = b.startTime.split(':').map(Number);
    const [be, bem] = b.endTime.split(':').map(Number);
    return [bs * 60 + bsm, be * 60 + bem] as [number, number];
  });
  const slots: string[] = [];
  for (let m = startMins; m < endMins; m += slotMinutes) {
    if (!breakRanges.some(([s, e]) => m >= s && m < e)) {
      slots.push(
        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
      );
    }
  }
  return slots;
}

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
        doctorId:    z.string(),
        date:        z.string(),  // ISO "YYYY-MM-DD"
        startTime:   z.string().regex(/^\d{2}:\d{2}$/),
        endTime:     z.string().regex(/^\d{2}:\d{2}$/),
        slotMinutes: z.number().int().min(15).max(90).default(15),
        breaks:      z.array(breakSchema).default([]),
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
              data: { startTime: input.startTime, endTime: input.endTime, slotMinutes: input.slotMinutes },
            });
            scheduleId = existing.id;
          } else {
            const created = await (tx as any).doctorDaySchedule.create({
              data: { doctorId: input.doctorId, date, startTime: input.startTime, endTime: input.endTime, slotMinutes: input.slotMinutes },
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

    // Returns dates (YYYY-MM-DD) that have at least one scheduled booking
    getBookedDatesInRange: trpc.protectedProcedure
      .input(z.object({
        doctorId: z.string(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }))
      .query(async ({ input }) => {
        const start = new Date(input.dateFrom);
        start.setHours(0, 0, 0, 0);
        const end = new Date(input.dateTo);
        end.setHours(23, 59, 59, 999);

        const entries = await prisma.queueEntry.findMany({
          where: {
            doctorId: input.doctorId,
            scheduledAt: { gte: start, lte: end },
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          },
          select: { scheduledAt: true },
        });

        const dates = new Set<string>();
        for (const e of entries) {
          if (e.scheduledAt) {
            const d = e.scheduledAt;
            const localDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            dates.add(localDate);
          }
        }
        return [...dates].sort();
      }),

    // Update slotMinutes for all scheduled days in range.
    // If reschedule=true, round existing bookings to nearest new slot.
    setSlotMinutesForRange: trpc.protectedProcedure
      .input(z.object({
        doctorId:    z.string(),
        dateFrom:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        slotMinutes: z.number().int().min(15).max(90),
        reschedule:  z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Только администратор' });
        }

        const start = new Date(input.dateFrom);
        start.setHours(0, 0, 0, 0);
        const end = new Date(input.dateTo);
        end.setHours(23, 59, 59, 999);

        let updatedCount = 0;
        await prisma.$transaction(async (tx: any) => {
          const schedules = await tx.doctorDaySchedule.findMany({
            where: { doctorId: input.doctorId, date: { gte: start, lte: end } },
            include: { breaks: true },
          });
          updatedCount = schedules.length;
          for (const sched of schedules) {
            await tx.doctorDaySchedule.update({
              where: { id: sched.id },
              data: { slotMinutes: input.slotMinutes },
            });

            if (input.reschedule) {
              const newSlots = generateSlots(
                sched.startTime, sched.endTime, input.slotMinutes,
                sched.breaks,
              );
              if (!newSlots.length) continue;

              const dayStart = new Date(sched.date);
              dayStart.setHours(0, 0, 0, 0);
              const dayEnd = new Date(sched.date);
              dayEnd.setHours(23, 59, 59, 999);

              const bookings = await tx.queueEntry.findMany({
                where: {
                  doctorId: input.doctorId,
                  scheduledAt: { gte: dayStart, lte: dayEnd },
                  status: { notIn: ['CANCELLED', 'NO_SHOW'] },
                },
                select: { id: true, scheduledAt: true },
              });

              for (const booking of bookings) {
                if (!booking.scheduledAt) continue;
                const bh = booking.scheduledAt.getHours();
                const bm = booking.scheduledAt.getMinutes();
                const targetMins = bh * 60 + bm;

                let bestSlot = newSlots[0];
                let bestDist = Infinity;
                for (const s of newSlots) {
                  const [sh, sm] = s.split(':').map(Number);
                  const dist = Math.abs(sh * 60 + sm - targetMins);
                  if (dist < bestDist) { bestDist = dist; bestSlot = s; }
                }

                const [rh, rm] = bestSlot.split(':').map(Number);
                const remapped = new Date(booking.scheduledAt);
                remapped.setHours(rh, rm, 0, 0);
                await tx.queueEntry.update({
                  where: { id: booking.id },
                  data: { scheduledAt: remapped },
                });
              }
            }
          }
        });

        return { updated: updatedCount };
      }),
  });
};
