import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createShiftsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    list: trpc.protectedProcedure.query(async () => {
      return prisma.shiftTemplate.findMany({ orderBy: { startTime: 'asc' } });
    }),

    create: trpc.protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат: HH:MM'),
          endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат: HH:MM'),
        }),
      )
      .mutation(async ({ input }) => {
        return prisma.shiftTemplate.create({ data: input as any });
      }),

    update: trpc.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).optional(),
          startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        }).refine(
          ({ id: _id, ...rest }) => Object.values(rest).some((v) => v !== undefined),
          { message: 'Необходимо передать хотя бы одно поле для обновления' },
        ),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        try {
          return await prisma.shiftTemplate.update({ where: { id }, data });
        } catch (e: any) {
          if (e?.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Шаблон смены не найден' });
          }
          throw e;
        }
      }),

    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        try {
          return await prisma.shiftTemplate.delete({ where: { id: input.id } });
        } catch (e: any) {
          if (e?.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Шаблон смены не найден' });
          }
          throw e;
        }
      }),
  });
};
