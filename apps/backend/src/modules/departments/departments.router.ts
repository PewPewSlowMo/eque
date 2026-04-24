import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createDepartmentsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async () => {
      return prisma.department.findMany({
        where: { isActive: true },
        include: { _count: { select: { users: true, cabinets: true } } },
        orderBy: { name: 'asc' },
      });
    }),

    create: trpc.protectedProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.department.create({ data: { name: input.name } });
      }),

    update: trpc.protectedProcedure
      .input(z.object({ id: z.string(), name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.department.update({ where: { id: input.id }, data: { name: input.name } });
      }),

    deactivate: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        return prisma.department.update({ where: { id: input.id }, data: { isActive: false } });
      }),
  });
};
