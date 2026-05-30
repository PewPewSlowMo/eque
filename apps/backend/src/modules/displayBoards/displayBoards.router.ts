import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

const BoardInput = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Только строчные латинские буквы, цифры и дефис'),
  columns: z.number().int().min(2).max(4).default(3),
  audioMode: z.enum(['SOUND', 'SOUND_TTS']).default('SOUND'),
  ttsTemplate: z.string().default('{lastName} пройдите в кабинет {cabinet}'),
  soundUrl: z.string().optional(),
  cabinetIds: z.array(z.string()),
});

export const createDisplayBoardsRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async ({ ctx }) => {
      if (!['ADMIN', 'DIRECTOR'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
      }
      return prisma.displayBoard.findMany({
        include: {
          cabinets: {
            include: { cabinet: { select: { id: true, number: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

    create: trpc.protectedProcedure
      .input(BoardInput)
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { cabinetIds, ...data } = input;
        try {
          const created = await prisma.displayBoard.create({
            data: {
              ...data,
              cabinets: {
                create: cabinetIds.map((cabinetId) => ({ cabinetId })),
              },
            } as any,
            include: {
              cabinets: {
                include: { cabinet: { select: { id: true, number: true, name: true } } },
              },
            },
          });
          await events.refreshBoardCache();
          return created;
        } catch (e: any) {
          if (e?.code === 'P2002') {
            throw new TRPCError({ code: 'CONFLICT', message: 'Табло с таким slug уже существует' });
          }
          throw e;
        }
      }),

    update: trpc.protectedProcedure
      .input(z.object({ id: z.string() }).merge(BoardInput.partial()))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const { id, cabinetIds, ...data } = input;
        const updated = await prisma.$transaction(async (tx) => {
          if (cabinetIds !== undefined) {
            await tx.displayBoardCabinet.deleteMany({ where: { boardId: id } });
            await tx.displayBoardCabinet.createMany({
              data: cabinetIds.map((cabinetId) => ({ boardId: id, cabinetId })),
            });
          }
          try {
            return await tx.displayBoard.update({
              where: { id },
              data: data as any,
              include: {
                cabinets: {
                  include: { cabinet: { select: { id: true, number: true, name: true } } },
                },
              },
            });
          } catch (e: any) {
            if (e?.code === 'P2002') {
              throw new TRPCError({ code: 'CONFLICT', message: 'Табло с таким slug уже существует' });
            }
            throw e;
          }
        });
        await events.refreshBoardCache();
        return updated;
      }),

    delete: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        }
        const board = await prisma.displayBoard.findUnique({
          where: { id: input.id },
          select: { slug: true },
        });
        const result = await prisma.displayBoard.delete({ where: { id: input.id } });
        if (board) {
          events.disconnectBoard(board.slug);
        }
        await events.refreshBoardCache();
        return result;
      }),
  });
};
