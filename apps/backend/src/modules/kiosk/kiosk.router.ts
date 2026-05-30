import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { PatientCategory } from '@prisma/client';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

// Returns {y, m, d} for the current date in Kazakhstan (UTC+5).
// The server runs in UTC; patients are in UTC+5, so we shift before extracting date parts.
function kzToday(): { y: number; m: number; d: number } {
  const kz = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return { y: kz.getUTCFullYear(), m: kz.getUTCMonth(), d: kz.getUTCDate() };
}

const PAID_CATEGORIES: PatientCategory[] = ['PAID_ONCE', 'PAID_CONTRACT'];

export const createKioskRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({

    // ── Public: get kiosk config + waiting count ──────────────────────────
    getConfig: trpc.procedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const kiosk = await prisma.kiosk.findUnique({
          where: { slug: input.slug },
          include: {
            doctor:  { select: { firstName: true, lastName: true } },
            service: { select: { name: true } },
          },
        });
        if (!kiosk) throw new TRPCError({ code: 'NOT_FOUND', message: 'Киоск не найден' });

        const { y, m, d } = kzToday();
        const kzDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayStart = new Date(kzDateStr + 'T00:00:00+05:00');
        const dayEnd   = new Date(kzDateStr + 'T23:59:59+05:00');

        const [waitingCount, todayCount] = await Promise.all([
          prisma.queueEntry.count({
            where: {
              doctorId: kiosk.doctorId,
              status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
              OR: [
                { scheduledAt: { gte: dayStart, lt: dayEnd } },
                { scheduledAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
              ],
            },
          }),
          prisma.queueEntry.count({
            where: { kioskId: kiosk.id, createdAt: { gte: dayStart, lt: dayEnd } },
          }),
        ]);

        const spotsLeft: number | null = kiosk.dailyLimit != null
          ? Math.max(0, kiosk.dailyLimit - todayCount)
          : null;

        return {
          name:        kiosk.name,
          doctorName:  `${kiosk.doctor.lastName} ${kiosk.doctor.firstName}`,
          serviceName: kiosk.service.name,
          active:      kiosk.active,
          waitingCount,
          spotsLeft,
        };
      }),

    // ── Public: add patient to walk-in queue ──────────────────────────────
    addToQueue: trpc.procedure
      .input(z.object({
        slug:           z.string(),
        lastName:       z.string().min(1),
        firstName:      z.string().min(1),
        middleName:     z.string().min(1).optional(),
        displayConsent: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        const kiosk = await prisma.kiosk.findUnique({
          where: { slug: input.slug },
          include: { doctor: { select: { departmentId: true } } },
        });
        if (!kiosk) throw new TRPCError({ code: 'NOT_FOUND', message: 'Киоск не найден' });
        if (!kiosk.active) throw new TRPCError({ code: 'FORBIDDEN', message: 'Киоск недоступен' });

        const lastName   = input.lastName.trim().toUpperCase();
        const firstName  = input.firstName.trim();
        const middleName = input.middleName?.trim() || undefined;

        // Day boundaries in Kazakhstan (UTC+5) — used for queueNumber computation
        const { y, m, d } = kzToday();
        const kzDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayStart = new Date(kzDateStr + 'T00:00:00+05:00');
        const dayEnd   = new Date(kzDateStr + 'T23:59:59+05:00');

        const entry = await prisma.$transaction(async (tx) => {
          // Find or create patient inside transaction
          let patient = await tx.patient.findFirst({
            where: {
              lastName:  { equals: lastName,  mode: 'insensitive' },
              firstName: { equals: firstName, mode: 'insensitive' },
            },
          });
          if (!patient) {
            patient = await tx.patient.create({
              data: { lastName, firstName, middleName, categories: [kiosk.defaultCategory] },
            });
          }

          const last = await tx.queueEntry.findFirst({
            where: {
              doctorId: kiosk.doctorId,
              OR: [
                { scheduledAt: { gte: dayStart, lt: dayEnd } },
                { scheduledAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
              ],
            },
            orderBy: { queueNumber: 'desc' },
            select: { queueNumber: true },
          });
          const queueNumber = (last?.queueNumber ?? 0) + 1;

          if (kiosk.dailyLimit != null) {
            const todayCount = await tx.queueEntry.count({
              where: { kioskId: kiosk.id, createdAt: { gte: dayStart, lt: dayEnd } },
            });
            if (todayCount >= kiosk.dailyLimit) {
              throw new TRPCError({ code: 'FORBIDDEN', message: 'Запись на сегодня закрыта: лимит исчерпан' });
            }
          }

          return tx.queueEntry.create({
            data: {
              doctorId:                    kiosk.doctorId,
              patientId:                   patient.id,
              serviceId:                   kiosk.serviceId,
              priority:                    'WALK_IN',
              source:                      'KIOSK',
              category:                    kiosk.defaultCategory,
              status:                      'ARRIVED',
              arrivedAt:                   new Date(),
              requiresArrivalConfirmation: false,
              paymentConfirmed:            !PAID_CATEGORIES.includes(kiosk.defaultCategory),
              scheduledAt:                 null,
              createdById:                 null,
              kioskId:                     kiosk.id,
              queueNumber,
              displayConsent:              input.displayConsent,
            } as any,
          });
        });

        events.emitQueueUpdated({
          doctorId:     kiosk.doctorId,
          departmentId: kiosk.doctor?.departmentId ?? null,
          entryId:      entry.id,
        });
        return { queueNumber: entry.queueNumber };
      }),

    // ── Admin: list all kiosk points ──────────────────────────────────────
    list: trpc.protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.kiosk.findMany({
          include: {
            doctor:  { select: { firstName: true, lastName: true } },
            service: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        });
      }),

    // ── Admin: create kiosk point ─────────────────────────────────────────
    create: trpc.protectedProcedure
      .input(z.object({
        name:            z.string().min(1),
        slug:            z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug: только строчные латинские буквы, цифры и дефис'),
        doctorId:        z.string(),
        serviceId:       z.string(),
        defaultCategory: z.nativeEnum(PatientCategory).default('OSMS'),
        active:          z.boolean().default(true),
        dailyLimit:      z.number().int().positive().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.kiosk.create({ data: input as any });
      }),

    // ── Admin: update kiosk point ─────────────────────────────────────────
    update: trpc.protectedProcedure
      .input(z.object({
        id:              z.string(),
        name:            z.string().min(1).optional(),
        slug:            z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
        doctorId:        z.string().optional(),
        serviceId:       z.string().optional(),
        defaultCategory: z.nativeEnum(PatientCategory).optional(),
        active:          z.boolean().optional(),
        dailyLimit:      z.number().int().positive().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        const { id, ...data } = input;
        return prisma.kiosk.update({ where: { id }, data });
      }),

    // ── Admin: delete kiosk point ─────────────────────────────────────────
    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.kiosk.delete({ where: { id: input.id } });
      }),
  });
};
