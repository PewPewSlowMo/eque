import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { PatientCategory } from '@prisma/client';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

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

        const now = new Date();
        const dayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayEnd   = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));

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
        middleName:  z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const kiosk = await prisma.kiosk.findUnique({ where: { slug: input.slug } });
        if (!kiosk || !kiosk.active) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Киоск недоступен' });
        }

        const lastName   = input.lastName.trim().toUpperCase();
        const firstName  = input.firstName.trim();
        const middleName = input.middleName?.trim() || undefined;

        // Find or create patient
        let patient = await prisma.patient.findFirst({
          where: {
            lastName:  { equals: lastName,  mode: 'insensitive' },
            firstName: { equals: firstName, mode: 'insensitive' },
          },
        });
        if (!patient) {
          patient = await prisma.patient.create({
            data: { lastName, firstName, middleName, categories: [kiosk.defaultCategory] },
          });
        }

        // UTC midnight today — no browser timezone shift
        const now = new Date();
        const scheduledAt = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayEnd      = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));

        const entry = await prisma.$transaction(async (tx) => {
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
              patientId:                   patient!.id,
              serviceId:                   kiosk.serviceId,
              priority:                    'WALK_IN',
              source:                      'KIOSK',
              category:                    kiosk.defaultCategory,
              status:                      'ARRIVED',
              arrivedAt:                   new Date(),
              requiresArrivalConfirmation: false,
              paymentConfirmed:            false,
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
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
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
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
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
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
        const { id, ...data } = input;
        return prisma.kiosk.update({ where: { id }, data });
      }),

    // ── Admin: delete kiosk point ─────────────────────────────────────────
    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN' });
        return prisma.kiosk.delete({ where: { id: input.id } });
      }),
  });
};
