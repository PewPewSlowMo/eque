import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { PatientCategory } from '@prisma/client';

export const createPatientsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    search: trpc.protectedProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ input }) => {
        const q = input.query.trim();
        return prisma.patient.findMany({
          where: {
            OR: [
              { lastName: { contains: q, mode: 'insensitive' } },
              { firstName: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { address: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 20,
          orderBy: { lastName: 'asc' },
        });
      }),

    getById: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return prisma.patient.findUnique({ where: { id: input.id } });
      }),

    create: trpc.protectedProcedure
      .input(z.object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        middleName: z.string().trim().optional(),
        dateOfBirth: z.string().datetime().optional(),
        phone: z.string().regex(/^\+7\d{10}$/, 'Формат: +7XXXXXXXXXX').optional(),
        address: z.string().trim().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).default([]),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { dateOfBirth, ...rest } = input;
        return prisma.patient.create({
          data: {
            ...rest,
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          } as any,
        });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id: z.string(),
        firstName: z.string().trim().min(1).optional(),
        lastName: z.string().trim().min(1).optional(),
        middleName: z.string().trim().optional(),
        phone: z.string().regex(/^\+7\d{10}$/, 'Формат: +7XXXXXXXXXX').optional(),
        address: z.string().trim().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).optional(),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return prisma.patient.update({ where: { id }, data });
      }),
  });
};
