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
        const dayStart = new Date(Date.UTC(y, m, d));
        const dayEnd   = new Date(Date.UTC(y, m, d + 1));

        const waitingCount = await prisma.queueEntry.count({
          where: {
            doctorId: kiosk.doctorId,
            status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
            OR: [
              { scheduledAt: { gte: dayStart, lt: dayEnd } },
              { scheduledAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
            ],
          },
        });

        return {
          name:        kiosk.name,
          doctorName:  `${kiosk.doctor.lastName} ${kiosk.doctor.firstName}`,
          serviceName: kiosk.service.name,
          active:      kiosk.active,
          waitingCount,
        };
      }),

    // ── Public: add patient to walk-in queue ──────────────────────────────
    addToQueue: trpc.procedure
      .input(z.object({
        slug:        z.string(),
        lastName:    z.string().min(1),
        firstName:   z.string().min(1),
        middleName:  z.string().min(1).optional(),
      }))
      .mutation(async ({ input }) => {
        const kiosk = await prisma.kiosk.findUnique({ where: { slug: input.slug } });
        if (!kiosk) throw new TRPCError({ code: 'NOT_FOUND', message: 'Киоск не найден' });
        if (!kiosk.active) throw new TRPCError({ code: 'FORBIDDEN', message: 'Киоск недоступен' });

        const lastName   = input.lastName.trim().toUpperCase();
        const firstName  = input.firstName.trim();
        const middleName = input.middleName?.trim() || undefined;

        // UTC midnight of today in Kazakhstan (UTC+5) — server runs in UTC
        const { y, m, d } = kzToday();
        const scheduledAt = new Date(Date.UTC(y, m, d));
        const dayEnd      = new Date(Date.UTC(y, m, d + 1));

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
                { scheduledAt: { gte: scheduledAt, lt: dayEnd } },
                { scheduledAt: null, createdAt: { gte: scheduledAt, lt: dayEnd } },
              ],
            },
            orderBy: { queueNumber: 'desc' },
            select: { queueNumber: true },
          });
          const queueNumber = (last?.queueNumber ?? 0) + 1;

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
              scheduledAt,
              createdById:                 null,
              kioskId:                     kiosk.id,
              queueNumber,
            } as any,
          });
        });

        events.emit('queue:updated', { doctorId: kiosk.doctorId, entry });
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
