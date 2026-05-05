import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { UserRole, PatientCategory } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const createUsersRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
      return prisma.user.findMany({
        omit: { password: true },
        include: { department: { select: { id: true, name: true } } },
        orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      });
    }),

    create: trpc.protectedProcedure
      .input(z.object({
        username: z.string().min(3),
        password: z.string().min(6),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        middleName: z.string().optional(),
        role: z.nativeEnum(UserRole),
        specialty: z.string().optional(),
        departmentId: z.string().optional(),
        allowedCategories:  z.array(z.nativeEnum(PatientCategory)).optional(),
        acceptedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        const hashed = await bcrypt.hash(input.password, 10);
        return prisma.user.create({
          data: { ...input, password: hashed, allowedCategories: input.allowedCategories ?? [], acceptedCategories: input.acceptedCategories ?? [] } as any,
          omit: { password: true },
          include: { department: { select: { id: true, name: true } } },
        });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id: z.string(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        middleName: z.string().optional(),
        specialty: z.string().optional(),
        departmentId: z.string().optional(),
        allowedCategories:  z.array(z.nativeEnum(PatientCategory)).optional(),
        acceptedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(6).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });
        const { id, password, ...rest } = input;
        const data: any = { ...rest };
        if (password) data.password = await bcrypt.hash(password, 10);
        return prisma.user.update({
          where: { id },
          data,
          omit: { password: true },
          include: { department: { select: { id: true, name: true } } },
        });
      }),

    getDoctors: trpc.protectedProcedure
      .input(z.object({ departmentId: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return prisma.user.findMany({
          where: {
            role: { in: ['DOCTOR', 'DEPARTMENT_HEAD'] },
            isActive: true,
            ...(input?.departmentId ? { departmentId: input.departmentId } : {}),
          },
          omit: { password: true },
          include: { department: { select: { id: true, name: true } } },
          orderBy: { lastName: 'asc' },
        });
      }),

    importBatch: trpc.protectedProcedure
      .input(z.object({
        users: z.array(z.object({
          username:           z.string().min(1),
          password:           z.string().min(6),
          firstName:          z.string().min(1),
          lastName:           z.string().min(1),
          middleName:         z.string().optional(),
          role:               z.nativeEnum(UserRole),
          specialty:          z.string().optional(),
          departmentName:     z.string().optional(),
          allowedCategories:  z.array(z.nativeEnum(PatientCategory)).optional(),
          acceptedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' });

        // Resolve department names → IDs once
        const deptNames = [...new Set(
          input.users.map(u => u.departmentName).filter(Boolean) as string[]
        )];
        const departments = deptNames.length > 0
          ? await prisma.department.findMany({
              where: { name: { in: deptNames } },
              select: { id: true, name: true },
            })
          : [];
        const deptMap = new Map(departments.map(d => [d.name, d.id]));

        // Detect duplicate usernames within the submitted batch
        const seenUsernames = new Set<string>();
        const batchErrors: string[] = [];
        const uniqueUsers = input.users.filter(u => {
          if (seenUsernames.has(u.username)) {
            batchErrors.push(`${u.username}: дублирующийся логин в запросе`);
            return false;
          }
          seenUsernames.add(u.username);
          return true;
        });

        let created = 0;
        const errors: string[] = [...batchErrors];

        for (const u of uniqueUsers) {
          try {
            const hashed = await bcrypt.hash(u.password, 10);
            await prisma.user.create({
              data: {
                username:          u.username,
                password:          hashed,
                firstName:         u.firstName,
                lastName:          u.lastName,
                middleName:        u.middleName || undefined,
                role:              u.role,
                specialty:         u.specialty || undefined,
                departmentId:      u.departmentName ? deptMap.get(u.departmentName) ?? undefined : undefined,
                allowedCategories:  u.allowedCategories  ?? [],
                acceptedCategories: u.acceptedCategories ?? [],
              } as any,
            });
            created++;
          } catch (e: any) {
            errors.push(`${u.username}: ${e.message}`);
          }
        }

        return { created, errors };
      }),
  });
};
