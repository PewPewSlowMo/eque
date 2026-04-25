import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

const PatientCategoryEnum = z.enum([
  'PAID_ONCE',
  'PAID_CONTRACT',
  'OSMS',
  'CONTINGENT',
  'EMPLOYEE',
]);

export const createSettingsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getCategorySettings: trpc.protectedProcedure.query(async () => {
      return prisma.categorySettings.findMany({ orderBy: { category: 'asc' } });
    }),

    updateCategorySettings: trpc.protectedProcedure
      .input(
        z.object({
          category: PatientCategoryEnum,
          requiresArrivalConfirmation: z.boolean(),
          requiresPaymentConfirmation: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user!.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Только для администратора' });
        }
        return prisma.categorySettings.update({
          where: { category: input.category },
          data: {
            requiresArrivalConfirmation: input.requiresArrivalConfirmation,
            requiresPaymentConfirmation: input.requiresPaymentConfirmation,
          },
        });
      }),
  });
};
