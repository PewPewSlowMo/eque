import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

// Numeric sort order for queue priorities
const PRIORITY_ORDER: Record<string, number> = {
  EMERGENCY: 1,
  INPATIENT: 2,
  SCHEDULED: 3,
  WALK_IN: 4,
};

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

const QueuePriorityEnum = z.enum(['EMERGENCY', 'INPATIENT', 'SCHEDULED', 'WALK_IN']);
const PatientCategoryEnum = z.enum([
  'PAID_ONCE',
  'PAID_CONTRACT',
  'OSMS',
  'CONTINGENT',
  'EMPLOYEE',
]);

// Shared patient select shape used in all includes
const PATIENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  phone: true,
};

export const createQueueRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({
    // Active queue for a doctor (WAITING_ARRIVAL, ARRIVED, CALLED, IN_PROGRESS)
    getByDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string() }))
      .query(async ({ input }) => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const entries = await prisma.queueEntry.findMany({
          where: {
            doctorId: input.doctorId,
            OR: [
              { status: { in: ['WAITING_ARRIVAL', 'ARRIVED', 'CALLED', 'IN_PROGRESS'] } },
              {
                status: { in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
                createdAt: { gte: todayStart, lte: todayEnd },
              },
            ],
          },
          include: {
            patient: { select: PATIENT_SELECT },
            service: { select: { id: true, name: true, durationMinutes: true } },
          },
        });

        // Active statuses first (by priority/arrived), then finished sorted by completedAt desc
        const active   = entries.filter(e => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status));
        const finished = entries.filter(e =>  ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(e.status));

        active.sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 99;
          const pb = PRIORITY_ORDER[b.priority] ?? 99;
          if (pa !== pb) return pa - pb;
          const ta = a.arrivedAt?.getTime() ?? a.createdAt.getTime();
          const tb = b.arrivedAt?.getTime() ?? b.createdAt.getTime();
          return ta - tb;
        });

        finished.sort((a, b) =>
          (b.completedAt?.getTime() ?? b.updatedAt.getTime()) -
          (a.completedAt?.getTime() ?? a.updatedAt.getTime()),
        );

        return [...active, ...finished];
      }),

    // Add patient to queue (REGISTRAR or CALL_CENTER)
    add: trpc.protectedProcedure
      .input(
        z.object({
          doctorId: z.string(),
          patientId: z.string(),
          priority: QueuePriorityEnum,
          category: PatientCategoryEnum,
          serviceId: z.string(),
          scheduledAt: z.string().datetime().optional(),
          source: z.enum(['REGISTRAR', 'CALL_CENTER']),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Look up category settings to determine initial status and payment requirement
        const catSettings = await prisma.categorySettings.findUnique({
          where: { category: input.category },
        });

        // EMERGENCY or category without arrival confirmation → immediately ARRIVED
        const requiresArrival = catSettings?.requiresArrivalConfirmation ?? true;
        const isImmediateArrival = input.priority === 'EMERGENCY' || !requiresArrival;

        const initialStatus = isImmediateArrival ? 'ARRIVED' : 'WAITING_ARRIVAL';
        const arrivedAt = isImmediateArrival ? new Date() : undefined;

        // PAID_ONCE requires payment → paymentConfirmed=false
        const requiresPayment = catSettings?.requiresPaymentConfirmation ?? false;
        const paymentConfirmed = !requiresPayment;

        const doctorService = await prisma.doctorService.findUnique({
          where: { doctorId_serviceId: { doctorId: input.doctorId, serviceId: input.serviceId } },
        });
        if (!doctorService) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Выбранная услуга не назначена этому врачу',
          });
        }

        // Atomic: compute queue number and create entry in one transaction to avoid race conditions
        const entry = await prisma.$transaction(async (tx) => {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(todayStart);
          todayEnd.setDate(todayEnd.getDate() + 1);

          const last = await tx.queueEntry.findFirst({
            where: { doctorId: input.doctorId, createdAt: { gte: todayStart, lt: todayEnd } },
            orderBy: { queueNumber: 'desc' },
            select: { queueNumber: true },
          });
          const queueNumber = (last?.queueNumber ?? 0) + 1;

          return tx.queueEntry.create({
            data: {
              doctorId: input.doctorId,
              patientId: input.patientId,
              priority: input.priority,
              category: input.category,
              serviceId: input.serviceId,
              queueNumber,
              status: initialStatus,
              source: input.source,
              createdById: ctx.user!.id,
              requiresArrivalConfirmation: requiresArrival,
              paymentConfirmed,
              scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
              arrivedAt,
              notes: input.notes,
            } as any,
            include: { patient: { select: PATIENT_SELECT } },
          });
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'created',
            newStatus: initialStatus,
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: input.doctorId, entry });
        return entry;
      }),

    // Confirm patient arrival (registrar marks patient as arrived at desk)
    confirmArrival: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (entry.status !== 'WAITING_ARRIVAL') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя подтвердить приход: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { status: 'ARRIVED', arrivedAt: new Date() },
          include: { patient: { select: PATIENT_SELECT } },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'arrival_confirmed',
            oldStatus: 'WAITING_ARRIVAL',
            newStatus: 'ARRIVED',
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Confirm payment (registrar, for PAID_ONCE category)
    confirmPayment: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (TERMINAL_STATUSES.includes(entry.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя подтвердить оплату: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { paymentConfirmed: true },
          include: { patient: { select: PATIENT_SELECT } },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'payment_confirmed',
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Doctor calls next patient.
    // Previous IN_PROGRESS patients remain until explicitly completed.
    callNext: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Get all ARRIVED + payment confirmed
        const candidates = await prisma.queueEntry.findMany({
          where: {
            doctorId: input.doctorId,
            status: 'ARRIVED',
            paymentConfirmed: true,
          },
          include: { patient: { select: PATIENT_SELECT } },
        });

        if (candidates.length === 0) {
          return { called: null, message: 'Нет пациентов в очереди' };
        }

        // Sort by priority ASC → arrivedAt ASC
        candidates.sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 99;
          const pb = PRIORITY_ORDER[b.priority] ?? 99;
          if (pa !== pb) return pa - pb;
          return (a.arrivedAt?.getTime() ?? a.createdAt.getTime()) - (b.arrivedAt?.getTime() ?? b.createdAt.getTime());
        });

        const next = candidates[0];
        const called = await prisma.queueEntry.update({
          where: { id: next.id },
          data: { status: 'IN_PROGRESS', calledAt: new Date(), startedAt: new Date() },
          include: { patient: { select: PATIENT_SELECT } },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: next.id,
            action: 'called',
            oldStatus: 'ARRIVED',
            newStatus: 'IN_PROGRESS',
            userId: ctx.user!.id,
          } as any,
        });

        const callNextAssignment = await prisma.doctorAssignment.findFirst({
          where: { doctorId: input.doctorId, isActive: true },
          include: { cabinet: { select: { id: true, number: true } } },
        });

        events.emit('queue:called', {
          doctorId:      input.doctorId,
          cabinetId:     callNextAssignment?.cabinetId ?? null,
          cabinetNumber: callNextAssignment?.cabinet.number ?? null,
          entry:         called,
        });
        events.emit('queue:updated', { doctorId: input.doctorId, entry: called });
        return { called };
      }),

    // Doctor calls a specific patient by entryId (selective call).
    callSpecific: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({
          where: { id: input.entryId },
          include: { patient: { select: PATIENT_SELECT } },
        });
        if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись не найдена' });
        if (entry.status !== 'ARRIVED') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Пациент ещё не прибыл' });
        }

        const called = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { status: 'IN_PROGRESS', calledAt: new Date(), startedAt: new Date() },
          include: { patient: { select: PATIENT_SELECT } },
        });
        await prisma.queueHistory.create({
          data: {
            queueEntryId: input.entryId,
            action: 'called_specific',
            oldStatus: 'ARRIVED',
            newStatus: 'IN_PROGRESS',
            userId: ctx.user!.id,
          } as any,
        });

        const callSpecificAssignment = await prisma.doctorAssignment.findFirst({
          where: { doctorId: entry.doctorId, isActive: true },
          include: { cabinet: { select: { id: true, number: true } } },
        });

        events.emit('queue:called', {
          doctorId:      entry.doctorId,
          cabinetId:     callSpecificAssignment?.cabinetId ?? null,
          cabinetNumber: callSpecificAssignment?.cabinet.number ?? null,
          entry:         called,
        });
        events.emit('queue:updated', { doctorId: entry.doctorId, entry: called });
        return { called };
      }),

    // Re-announce current IN_PROGRESS patient on the display board (no status change)
    callRepeat: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ input }) => {
        const entry = await prisma.queueEntry.findUnique({
          where: { id: input.entryId },
          include: { patient: { select: PATIENT_SELECT } },
        });
        if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись не найдена' });

        const assignment = await prisma.doctorAssignment.findFirst({
          where: { doctorId: entry.doctorId, isActive: true },
          include: { cabinet: { select: { id: true, number: true } } },
        });

        events.emit('queue:called', {
          doctorId:      entry.doctorId,
          cabinetId:     assignment?.cabinetId ?? null,
          cabinetNumber: assignment?.cabinet.number ?? null,
          entry,
        });
        return { ok: true };
      }),

    // Complete appointment (doctor presses "Done")
    complete: trpc.protectedProcedure
      .input(z.object({ entryId: z.string(), notes: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (!['IN_PROGRESS', 'ARRIVED'].includes(entry.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя завершить: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            notes: input.notes ?? entry.notes,
          },
          include: { patient: { select: PATIENT_SELECT } },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'completed',
            oldStatus: entry.status,
            newStatus: 'COMPLETED',
            userId: ctx.user!.id,
            notes: input.notes,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Cancel queue entry (registrar or doctor)
    cancel: trpc.protectedProcedure
      .input(z.object({ entryId: z.string(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя отменить: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { status: 'CANCELLED', cancelReason: input.reason },
          include: { patient: { select: PATIENT_SELECT } },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'cancelled',
            oldStatus: entry.status,
            newStatus: 'CANCELLED',
            userId: ctx.user!.id,
            notes: input.reason,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // Mark no-show (patient didn't arrive)
    markNoShow: trpc.protectedProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const entry = await prisma.queueEntry.findUnique({ where: { id: input.entryId } });
        if (!entry) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Запись очереди не найдена' });
        }
        if (!['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Нельзя отметить неявку: статус ${entry.status}`,
          });
        }

        const updated = await prisma.queueEntry.update({
          where: { id: input.entryId },
          data: { status: 'NO_SHOW' },
          include: { patient: { select: PATIENT_SELECT } },
        });

        await prisma.queueHistory.create({
          data: {
            queueEntryId: entry.id,
            action: 'no_show',
            oldStatus: entry.status,
            newStatus: 'NO_SHOW',
            userId: ctx.user!.id,
          } as any,
        });

        events.emit('queue:updated', { doctorId: entry.doctorId, entry: updated });
        return updated;
      }),

    // All active entries for registrar queue tab (with optional date / department filters)
    getForRegistrar: trpc.protectedProcedure
      .input(z.object({
        date:         z.string().optional(), // ISO date "2026-04-27"
        departmentId: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const where: any = { status: { notIn: TERMINAL_STATUSES as any } };

        if (input.date) {
          const d = new Date(input.date);
          d.setHours(0, 0, 0, 0);
          const next = new Date(d);
          next.setDate(next.getDate() + 1);
          where.OR = [
            { scheduledAt: { gte: d, lt: next } },
            { scheduledAt: null, createdAt: { gte: d, lt: next } },
          ];
        }

        if (input.departmentId) {
          where.doctor = { departmentId: input.departmentId };
        }

        return prisma.queueEntry.findMany({
          where,
          include: {
            patient: { select: PATIENT_SELECT },
            doctor:  { select: { id: true, firstName: true, lastName: true, specialty: true } },
          },
          orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
        });
      }),

    // Active (non-terminal) entries for a patient (for registrar patient panel)
    getByPatient: trpc.protectedProcedure
      .input(z.object({ patientId: z.string() }))
      .query(async ({ input }) => {
        return prisma.queueEntry.findMany({
          where: {
            patientId: input.patientId,
            status: { notIn: TERMINAL_STATUSES as any },
          },
          include: {
            patient: { select: PATIENT_SELECT },
            doctor: { select: { id: true, firstName: true, lastName: true, specialty: true } },
          },
          orderBy: { scheduledAt: 'asc' },
        });
      }),

    // Scheduled slot counts per doctor per date (for registrar calendar grid)
    getScheduledSlots: trpc.protectedProcedure
      .input(
        z.object({
          startDate: z.string(), // ISO date "2026-04-25"
          endDate: z.string(),   // ISO date "2026-05-01"
        }),
      )
      .query(async ({ input }) => {
        const start = new Date(input.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(input.endDate);
        end.setHours(23, 59, 59, 999);

        const entries = await prisma.queueEntry.findMany({
          where: {
            scheduledAt: { gte: start, lte: end },
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          },
          select: { doctorId: true, scheduledAt: true },
        });

        // { [doctorId]: { [dateISO]: count } }
        const result: Record<string, Record<string, number>> = {};
        for (const e of entries) {
          if (!e.scheduledAt) continue;
          const date = e.scheduledAt.toISOString().slice(0, 10);
          if (!result[e.doctorId]) result[e.doctorId] = {};
          result[e.doctorId][date] = (result[e.doctorId][date] ?? 0) + 1;
        }
        return result;
      }),

    // Booked times for a doctor on a specific date (for time slot picker)
    getScheduledTimes: trpc.protectedProcedure
      .input(
        z.object({
          doctorId: z.string(),
          date: z.string(), // ISO date "2026-04-25"
        }),
      )
      .query(async ({ input }) => {
        const date = new Date(input.date);
        date.setHours(0, 0, 0, 0);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        const entries = await prisma.queueEntry.findMany({
          where: {
            doctorId: input.doctorId,
            scheduledAt: { gte: date, lt: nextDay },
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          },
          select: { scheduledAt: true },
        });

        // Return ISO timestamp strings; frontend converts to local HH:MM
        return entries
          .filter((e) => e.scheduledAt)
          .map((e) => e.scheduledAt!.toISOString());
      }),

    // Daily stats (for department head / director)
    dailyStats: trpc.protectedProcedure
      .input(
        z.object({
          doctorId: z.string().optional(),
          date: z.string().optional(), // ISO date string e.g. "2026-04-25"
        }),
      )
      .query(async ({ input }) => {
        const date = input.date ? new Date(input.date) : new Date();
        date.setHours(0, 0, 0, 0);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        const where: any = { createdAt: { gte: date, lt: nextDay } };
        if (input.doctorId) where.doctorId = input.doctorId;

        return prisma.queueEntry.groupBy({
          by: ['status', 'priority'],
          where,
          _count: { _all: true },
        });
      }),
  });
};
