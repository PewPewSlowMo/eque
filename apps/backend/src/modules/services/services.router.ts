import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { PatientCategory, UserRole } from '@prisma/client';

const ALLOWED_ROLES: UserRole[] = ['ADMIN', 'DEPARTMENT_HEAD'];

const PatientCategoryEnum = z.nativeEnum(PatientCategory);

const CATEGORIES_INCLUDE = {
  categories: { select: { category: true } },
} as const;

export const createServicesRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({

    getAll: trpc.protectedProcedure
      .input(z.object({ includeInactive: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: input?.includeInactive ? {} : { isActive: true },
          include: CATEGORIES_INCLUDE,
          orderBy: { name: 'asc' },
        });
      }),

    create: trpc.protectedProcedure
      .input(z.object({
        name:            z.string().min(1),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1),
        categories:      z.array(PatientCategoryEnum).min(1),
        doctorIds:       z.array(z.string()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { categories, doctorIds, name, description, durationMinutes } = input;
        return prisma.$transaction(async (tx) => {
          const service = await tx.service.create({
            data: {
              name,
              description,
              durationMinutes,
              categories: {
                create: categories.map((category) => ({ category })),
              },
            },
            include: CATEGORIES_INCLUDE,
          });
          if (doctorIds && doctorIds.length > 0) {
            await tx.doctorService.createMany({
              data: doctorIds.map((doctorId) => ({ doctorId, serviceId: service.id })),
              skipDuplicates: true,
            });
          }
          return service;
        });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id:              z.string(),
        name:            z.string().min(1).optional(),
        description:     z.string().optional(),
        durationMinutes: z.number().int().min(1).optional(),
        categories:      z.array(PatientCategoryEnum).min(1).optional(),
        isActive:        z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { id, categories, ...serviceData } = input;
        return prisma.$transaction(async (tx) => {
          if (categories) {
            await tx.serviceCategory.deleteMany({ where: { serviceId: id } });
            await tx.serviceCategory.createMany({
              data: categories.map((category) => ({ serviceId: id, category })),
            });
          }
          return tx.service.update({
            where: { id },
            data: serviceData,
            include: CATEGORIES_INCLUDE,
          });
        });
      }),

    setDoctors: trpc.protectedProcedure
      .input(z.object({
        serviceId: z.string(),
        doctorIds: z.array(z.string()),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ALLOWED_ROLES.includes(ctx.user.role as UserRole)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        return prisma.$transaction(async (tx) => {
          await tx.doctorService.deleteMany({ where: { serviceId: input.serviceId } });
          if (input.doctorIds.length > 0) {
            await tx.doctorService.createMany({
              data: input.doctorIds.map((doctorId) => ({ doctorId, serviceId: input.serviceId })),
              skipDuplicates: true,
            });
          }
          return { ok: true };
        });
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
        doctorId: z.string(),
        category: PatientCategoryEnum.optional(),
      }))
      .query(async ({ input }) => {
        return prisma.service.findMany({
          where: {
            isActive: true,
            doctors: { some: { doctorId: input.doctorId } },
            ...(input.category
              ? { categories: { some: { category: input.category } } }
              : {}),
          },
          include: CATEGORIES_INCLUDE,
          orderBy: { name: 'asc' },
        });
      }),

    getDoctorIds: trpc.protectedProcedure
      .input(z.object({ serviceId: z.string() }))
      .query(async ({ input }) => {
        const rows = await prisma.doctorService.findMany({
          where: { serviceId: input.serviceId },
          select: { doctorId: true },
        });
        return rows.map((r) => r.doctorId);
      }),

  });
};
