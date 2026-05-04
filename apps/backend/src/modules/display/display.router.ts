import { z } from 'zod';
import { TRPCError } from '@trpc/server';
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
    getBySlug: trpc.procedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const board = await prisma.displayBoard.findUnique({
          where: { slug: input.slug },
          include: {
            cabinets: {
              include: { cabinet: { select: { id: true, number: true, name: true } } },
            },
          },
        });

        if (!board) throw new TRPCError({ code: 'NOT_FOUND', message: 'Табло не найдено' });

        const cabinetIds = board.cabinets.map((c) => c.cabinetId);

        const assignments = await prisma.doctorAssignment.findMany({
          where: { cabinetId: { in: cabinetIds }, isActive: true },
          include: { cabinet: { select: { id: true, number: true, name: true } } },
        });

        const doctorIds = assignments.map((a) => a.doctorId);
        const cabinetByDoctorId = Object.fromEntries(
          assignments.map((a) => [a.doctorId, a.cabinet]),
        );

        const activeEntries = await prisma.queueEntry.findMany({
          where: { doctorId: { in: doctorIds }, status: { in: ['CALLED', 'IN_PROGRESS'] } },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: { calledAt: 'asc' },
        });

        const queueEntries = await prisma.queueEntry.findMany({
          where: { doctorId: { in: doctorIds }, status: { in: ['WAITING_ARRIVAL', 'ARRIVED'] } },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        });

        const activeCalls = activeEntries.map((e) => ({
          cabinetNumber: cabinetByDoctorId[e.doctorId]?.number ?? '?',
          cabinetName:   cabinetByDoctorId[e.doctorId]?.name ?? null,
          patientLastName:  e.patient.lastName,
          patientFirstName: e.patient.firstName,
          calledAt: e.calledAt,
        }));

        const queue = queueEntries.map((e) => ({
          queueNumber:      e.queueNumber,
          priority:         e.priority as string,
          patientLastName:  e.patient.lastName,
          patientFirstName: e.patient.firstName,
          cabinetNumber:    cabinetByDoctorId[e.doctorId]?.number ?? '?',
          scheduledAt:      e.scheduledAt ?? null,
        }));

        return {
          board: {
            id:          board.id,
            name:        board.name,
            slug:        board.slug,
            columns:     board.columns,
            audioMode:   board.audioMode,
            ttsTemplate: board.ttsTemplate,
            soundUrl:    board.soundUrl,
          },
          cabinetIds,
          activeCalls,
          queue,
        };
      }),
  });
};
