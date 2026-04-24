import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export function createDepartmentsRouter(trpc: TrpcService, prisma: PrismaService) {
  return trpc.router({});
}
