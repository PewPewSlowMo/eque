import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

export const createAssignmentsRouter = (
  trpc: TrpcService,
  prisma: PrismaService,
  events: EventsGateway,
) => {
  return trpc.router({
    // All active assignments (for display board / registrar / department head)
    getActive: trpc.protectedProcedure.query(async () => {
      return prisma.doctorAssignment.findMany({
        where: { isActive: true },
        include: {
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              middleName: true,
              specialty: true,
              departmentId: true,
            },
          },
          cabinet: { select: { id: true, number: true, name: true } },
          shiftTemplate: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
        orderBy: { startTime: 'desc' },
      });
    }),

    // Active assignment for a specific doctor
    getForDoctor: trpc.protectedProcedure
      .input(z.object({ doctorId: z.string() }))
      .query(async ({ input }) => {
        return prisma.doctorAssignment.findFirst({
          where: { doctorId: input.doctorId, isActive: true },
          include: {
            cabinet: { select: { id: true, number: true, name: true } },
            shiftTemplate: { select: { id: true, name: true, startTime: true, endTime: true } },
          },
        });
      }),

    // Assign doctor to cabinet (ADMIN or DEPARTMENT_HEAD only)
    // Automatically closes any previous active assignment for this doctor.
    assign: trpc.protectedProcedure
      .input(
        z.object({
          doctorId: z.string(),
          cabinetId: z.string(),
          shiftTemplateId: z.string().optional(),
          startTime: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const allowedRoles = ['ADMIN', 'DEPARTMENT_HEAD'];
        if (!allowedRoles.includes(ctx.user!.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет прав на назначение врача' });
        }

        // Close previous active assignment if any
        await prisma.doctorAssignment.updateMany({
          where: { doctorId: input.doctorId, isActive: true },
          data: { isActive: false, endTime: new Date() },
        });

        const assignment = await prisma.doctorAssignment.create({
          data: {
            doctorId: input.doctorId,
            cabinetId: input.cabinetId,
            shiftTemplateId: input.shiftTemplateId ?? null,
            startTime: input.startTime ? new Date(input.startTime) : new Date(),
            isActive: true,
            createdById: ctx.user!.id,
          } as any,
          include: {
            doctor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                specialty: true,
              },
            },
            cabinet: { select: { id: true, number: true, name: true } },
          },
        });

        events.emit('assignment:created', assignment);
        return assignment;
      }),

    // End assignment (ADMIN, DEPARTMENT_HEAD, or the DOCTOR themselves)
    unassign: trpc.protectedProcedure
      .input(z.object({ assignmentId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const allowedRoles = ['ADMIN', 'DEPARTMENT_HEAD', 'DOCTOR'];
        if (!allowedRoles.includes(ctx.user!.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет прав на снятие назначения' });
        }

        const existing = await prisma.doctorAssignment.findUnique({
          where: { id: input.assignmentId },
        });
        if (!existing || !existing.isActive) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Активное назначение не найдено' });
        }

        const assignment = await prisma.doctorAssignment.update({
          where: { id: input.assignmentId },
          data: { isActive: false, endTime: new Date() },
          include: {
            doctor: { select: { id: true, firstName: true, lastName: true } },
            cabinet: { select: { id: true, number: true, name: true } },
          },
        });

        events.emit('assignment:ended', assignment);
        return assignment;
      }),
  });
};
