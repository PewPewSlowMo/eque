import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-32-chars-min';
const JWT_EXPIRES_IN = '7d';

export const createAuthRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    login: trpc.procedure
      .input(z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const user = await prisma.user.findUnique({
          where: { username: input.username },
          include: { department: { select: { id: true, name: true } } },
        });

        if (!user || !user.isActive) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Неверный логин или пароль' });
        }

        const valid = await bcrypt.compare(input.password, user.password);
        if (!valid) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Неверный логин или пароль' });

        const token = jwt.sign(
          { userId: user.id, username: user.username, role: user.role, departmentId: user.departmentId },
          JWT_SECRET,
          { expiresIn: JWT_EXPIRES_IN },
        );

        return {
          token,
          user: {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            middleName: user.middleName,
            role: user.role,
            departmentId: user.departmentId,
            department: user.department,
            allowedCategories: user.allowedCategories,
          },
        };
      }),

    me: trpc.protectedProcedure.query(async ({ ctx }) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        include: { department: { select: { id: true, name: true } } },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Пользователь не найден' });
      return {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        middleName: user.middleName,
        role: user.role,
        departmentId: user.departmentId,
        department: user.department,
        allowedCategories: user.allowedCategories,
      };
    }),
  });
};
