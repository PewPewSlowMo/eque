import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createCabinetsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async () => {
      return prisma.cabinet.findMany({
        where: { isActive: true },
        include: { department: { select: { id: true, name: true } } },
        orderBy: { number: 'asc' },
      });
    }),

    create: trpc.protectedProcedure
      .input(z.object({
        number: z.string().min(1),
        name: z.string().optional(),
        departmentId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.cabinet.create({ data: input as any });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id: z.string(),
        number: z.string().min(1).optional(),
        name: z.string().optional(),
        departmentId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        const { id, ...data } = input;
        return prisma.cabinet.update({ where: { id }, data });
      }),

    deactivate: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.cabinet.update({ where: { id: input.id }, data: { isActive: false } });
      }),
  });
};
