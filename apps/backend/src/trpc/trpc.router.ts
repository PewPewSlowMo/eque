import { INestApplication, Injectable } from '@nestjs/common';
import * as trpcExpress from '@trpc/server/adapters/express';
import { TrpcService } from './trpc.service';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { createAuthRouter } from '../modules/auth/auth.router';
import { createUsersRouter } from '../modules/users/users.router';
import { createDepartmentsRouter } from '../modules/departments/departments.router';
import { createCabinetsRouter } from '../modules/cabinets/cabinets.router';
import { createPatientsRouter } from '../modules/patients/patients.router';
import { createShiftsRouter } from '../modules/shifts/shifts.router';
import { createSettingsRouter } from '../modules/settings/settings.router';
import { createAssignmentsRouter } from '../modules/assignments/assignments.router';
import { createQueueRouter } from '../modules/queue/queue.router';
import { createDisplayRouter } from '../modules/display/display.router';
import { createDisplayBoardsRouter } from '../modules/displayBoards/displayBoards.router';
import { createSchedulesRouter } from '../modules/schedules/schedules.router';

@Injectable()
export class TrpcRouter {
  constructor(
    private readonly trpc: TrpcService,
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  appRouter = this.trpc.router({
    health: this.trpc.procedure.query(() => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })),
    auth: createAuthRouter(this.trpc, this.prisma),
    users: createUsersRouter(this.trpc, this.prisma),
    departments: createDepartmentsRouter(this.trpc, this.prisma),
    cabinets: createCabinetsRouter(this.trpc, this.prisma),
    patients: createPatientsRouter(this.trpc, this.prisma),
    shifts: createShiftsRouter(this.trpc, this.prisma),
    settings: createSettingsRouter(this.trpc, this.prisma),
    assignments: createAssignmentsRouter(this.trpc, this.prisma, this.eventsGateway),
    queue: createQueueRouter(this.trpc, this.prisma, this.eventsGateway),
    display: createDisplayRouter(this.trpc, this.prisma),
    displayBoards: createDisplayBoardsRouter(this.trpc, this.prisma),
    schedules: createSchedulesRouter(this.trpc, this.prisma),
  });

  async applyMiddleware(app: INestApplication) {
    app.use(
      '/trpc',
      trpcExpress.createExpressMiddleware({
        router: this.appRouter,
        createContext: ({ req }: { req: any }) => {
          let user = undefined;
          const authHeader = req.headers.authorization;
          if (authHeader?.startsWith('Bearer ')) {
            user = TrpcService.verifyToken(authHeader.substring(7)) ?? undefined;
          }
          return { prisma: this.prisma, user };
        },
      }),
    );
  }
}

export type AppRouter = TrpcRouter['appRouter'];
