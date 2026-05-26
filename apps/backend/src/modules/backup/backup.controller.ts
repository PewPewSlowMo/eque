import {
  Controller, Get, Post, Body, Req, Res,
  UnauthorizedException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { TrpcService } from '../../trpc/trpc.service';

@Controller('api/backup')
export class BackupController {
  constructor(private prisma: PrismaService) {}

  private checkAdmin(req: Request) {
    const auth = req.headers.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    const user = TrpcService.verifyToken(auth.slice(7));
    if (!user) throw new UnauthorizedException();
    if (user.role !== 'ADMIN') throw new ForbiddenException();
  }

  @Get('export')
  async exportBackup(@Req() req: Request, @Res() res: Response) {
    this.checkAdmin(req);

    try {
      const [
        departments, cabinets, users, shiftTemplates, categorySettings,
        patients, services, serviceCategories, doctorServices,
        displayBoards, displayBoardCabinets, kiosks,
        doctorDaySchedules, dayScheduleBreaks, doctorAssignments,
        queueEntries, queueHistory,
      ] = await Promise.all([
        this.prisma.department.findMany(),
        this.prisma.cabinet.findMany(),
        this.prisma.user.findMany(),
        this.prisma.shiftTemplate.findMany(),
        this.prisma.categorySettings.findMany(),
        this.prisma.patient.findMany(),
        this.prisma.service.findMany(),
        this.prisma.serviceCategory.findMany(),
        this.prisma.doctorService.findMany(),
        this.prisma.displayBoard.findMany(),
        this.prisma.displayBoardCabinet.findMany(),
        this.prisma.kiosk.findMany(),
        this.prisma.doctorDaySchedule.findMany(),
        this.prisma.dayScheduleBreak.findMany(),
        this.prisma.doctorAssignment.findMany(),
        this.prisma.queueEntry.findMany(),
        this.prisma.queueHistory.findMany(),
      ]);

      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          departments, cabinets, users, shiftTemplates, categorySettings,
          patients, services, serviceCategories, doctorServices,
          displayBoards, displayBoardCabinets, kiosks,
          doctorDaySchedules, dayScheduleBreaks, doctorAssignments,
          queueEntries, queueHistory,
        },
      };

      const json = JSON.stringify(backup);
      const filename = `eque-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', Buffer.byteLength(json, 'utf8'));
      res.send(json);
    } catch (err) {
      console.error('[backup] export error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Ошибка экспорта', detail: String(err) });
      }
    }
  }

  @Post('import')
  async importBackup(@Req() req: Request, @Body() body: any, @Res() res: Response) {
    this.checkAdmin(req);

    if (!body?.version || !body?.data) {
      throw new BadRequestException('Неверный формат файла бэкапа');
    }

    const d = body.data;

    await this.prisma.$transaction(async (tx) => {
      // Delete all in reverse FK order
      await tx.queueHistory.deleteMany();
      await tx.queueEntry.deleteMany();
      await tx.doctorAssignment.deleteMany();
      await tx.dayScheduleBreak.deleteMany();
      await tx.doctorDaySchedule.deleteMany();
      await tx.kiosk.deleteMany();
      await tx.displayBoardCabinet.deleteMany();
      await tx.displayBoard.deleteMany();
      await tx.doctorService.deleteMany();
      await tx.serviceCategory.deleteMany();
      await tx.patient.deleteMany();
      await tx.categorySettings.deleteMany();
      await tx.shiftTemplate.deleteMany();
      await tx.user.deleteMany();
      await tx.service.deleteMany();
      await tx.cabinet.deleteMany();
      await tx.department.deleteMany();

      // Insert in FK order
      if (d.departments?.length)          await tx.department.createMany({ data: d.departments, skipDuplicates: true });
      if (d.cabinets?.length)             await tx.cabinet.createMany({ data: d.cabinets, skipDuplicates: true });
      if (d.users?.length)                await tx.user.createMany({ data: d.users, skipDuplicates: true });
      if (d.shiftTemplates?.length)       await tx.shiftTemplate.createMany({ data: d.shiftTemplates, skipDuplicates: true });
      if (d.categorySettings?.length)     await tx.categorySettings.createMany({ data: d.categorySettings, skipDuplicates: true });
      if (d.patients?.length)             await tx.patient.createMany({ data: d.patients, skipDuplicates: true });
      if (d.services?.length)             await tx.service.createMany({ data: d.services, skipDuplicates: true });
      if (d.serviceCategories?.length)    await tx.serviceCategory.createMany({ data: d.serviceCategories, skipDuplicates: true });
      if (d.doctorServices?.length)       await tx.doctorService.createMany({ data: d.doctorServices, skipDuplicates: true });
      if (d.displayBoards?.length)        await tx.displayBoard.createMany({ data: d.displayBoards, skipDuplicates: true });
      if (d.displayBoardCabinets?.length) await tx.displayBoardCabinet.createMany({ data: d.displayBoardCabinets, skipDuplicates: true });
      if (d.kiosks?.length)               await tx.kiosk.createMany({ data: d.kiosks, skipDuplicates: true });
      if (d.doctorDaySchedules?.length)   await tx.doctorDaySchedule.createMany({ data: d.doctorDaySchedules, skipDuplicates: true });
      if (d.dayScheduleBreaks?.length)    await tx.dayScheduleBreak.createMany({ data: d.dayScheduleBreaks, skipDuplicates: true });
      if (d.doctorAssignments?.length)    await tx.doctorAssignment.createMany({ data: d.doctorAssignments, skipDuplicates: true });
      if (d.queueEntries?.length)         await tx.queueEntry.createMany({ data: d.queueEntries, skipDuplicates: true });
      if (d.queueHistory?.length)         await tx.queueHistory.createMany({ data: d.queueHistory, skipDuplicates: true });
    }, { timeout: 120_000 });

    res.json({ success: true });
  }
}
