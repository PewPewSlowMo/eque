import { Injectable } from '@nestjs/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { PrismaService } from '../database/prisma.service';
import { UserRole } from '@prisma/client';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-32-chars-min';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  departmentId?: string | null;
}

export interface Context {
  prisma: PrismaService;
  user?: AuthUser;
}

@Injectable()
export class TrpcService {
  trpc = initTRPC.context<Context>().create();

  procedure = this.trpc.procedure;

  protectedProcedure = this.trpc.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Требуется авторизация' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  router = this.trpc.router;

  static verifyToken(token: string): AuthUser | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return {
        id: decoded.userId,
        username: decoded.username,
        role: decoded.role,
        departmentId: decoded.departmentId,
      };
    } catch {
      return null;
    }
  }
}
