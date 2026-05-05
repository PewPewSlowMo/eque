import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { PatientCategory, UserRole } from '@prisma/client';

const ALLOWED_ROLES: UserRole[] = ['ADMIN', 'DEPARTMENT_HEAD'];

const PatientCategoryEnum = z.nativeEnum(PatientCategory);

export const createServicesRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({

    getAll: trpc.protectedProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: input?.includeInactive ? {} : { isActive: true },
          orderBy: { name: 'asc' },
        });
      }),

    create: trpc.protectedProcedure
      .input(z.object({
        name:            z.string().min(1),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1),
        paymentCategory: PatientCategoryEnum,
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        return prisma.service.create({ data: input as any });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id:              z.string(),
        name:            z.string().min(1).optional(),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1).optional(),
        paymentCategory: PatientCategoryEnum.optional(),
        isActive:        z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { id, ...data } = input;
        return prisma.service.update({ where: { id }, data });
      }),

    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const linked = await prisma.queueEntry.count({ where: { serviceId: input.id } });
        if (linked > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Услуга используется в ${linked} записях очереди — сначала деактивируйте`,
          });
        }
        await prisma.service.delete({ where: { id: input.id } });
        return { ok: true };
      }),

    assignToDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string(), serviceId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        await prisma.doctorService.upsert({
          where: { doctorId_serviceId: { doctorId: input.doctorId, serviceId: input.serviceId } },
          create: { doctorId: input.doctorId, serviceId: input.serviceId },
          update: {},
        });
        return { ok: true };
      }),

    removeFromDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string(), serviceId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        await prisma.doctorService.deleteMany({
          where: { doctorId: input.doctorId, serviceId: input.serviceId },
        });
        return { ok: true };
      }),

    getForDoctor: trpc.protectedProcedure
      .input(z.object({
        doctorId:        z.string(),
        paymentCategory: PatientCategoryEnum.optional(),
      }))
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: {
            isActive: true,
            doctors: { some: { doctorId: input.doctorId } },
            ...(input.paymentCategory ? { paymentCategory: input.paymentCategory } : {}),
          },
          orderBy: { name: 'asc' },
        });
      }),

  });
};
