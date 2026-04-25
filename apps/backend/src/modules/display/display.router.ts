import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createDisplayRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getBoard: trpc.procedure.query(async () => {
      const assignments = await prisma.doctorAssignment.findMany({
        where: { isActive: true },
        include: {
          doctor: {
            select: { id: true, firstName: true, lastName: true, specialty: true },
          },
          cabinet: { select: { id: true, number: true, name: true } },
        },
        orderBy: { startTime: 'desc' },
      });

      return Promise.all(
        assignments.map(async (a) => {
          const current = await prisma.queueEntry.findFirst({
            where: {
              doctorId: a.doctorId,
              status: { in: ['CALLED', 'IN_PROGRESS'] },
            },
            include: {
              patient: { select: { firstName: true, lastName: true } },
            },
            orderBy: { calledAt: 'desc' },
          });

          const waitingCount = await prisma.queueEntry.count({
            where: {
              doctorId: a.doctorId,
              status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] },
            },
          });

          return {
            assignmentId: a.id,
            doctor: a.doctor,
            cabinet: a.cabinet,
            current: current
              ? {
                  queueNumber: current.queueNumber,
                  status: current.status,
                  priority: current.priority,
                  patientLastName: current.patient.lastName,
                }
              : null,
            waitingCount,
          };
        }),
      );
    }),
  });
};
