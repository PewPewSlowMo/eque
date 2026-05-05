import {
  Controller, Get, Post,
  Req, Res, Query,
  UploadedFile, UseInterceptors,
  UnauthorizedException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../database/prisma.service';
import { TrpcService } from '../../trpc/trpc.service';

const VALID_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function extractUser(req: any) {
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
  const user = TrpcService.verifyToken(auth.substring(7));
  if (!user || !['ADMIN', 'DEPARTMENT_HEAD'].includes(user.role)) {
    throw new ForbiddenException('Только ADMIN или DEPARTMENT_HEAD');
  }
  return user;
}

// "08:00-14:30" or "08:00-14:30/11:00-12:00/13:00-13:15"
// First range = work hours. Each subsequent range = a break.
function parseCell(raw: string): {
  startTime: string;
  endTime: string;
  breaks: { startTime: string; endTime: string }[];
} | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const rangeRe = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
  const parts = trimmed.split('/');
  if (!rangeRe.test(parts[0])) return null;
  const [startTime, endTime] = parts[0].split('-');
  const breaks: { startTime: string; endTime: string }[] = [];
  for (let i = 1; i < parts.length; i++) {
    if (!rangeRe.test(parts[i])) return null;
    const [bs, be] = parts[i].split('-');
    breaks.push({ startTime: bs, endTime: be });
  }
  return { startTime, endTime, breaks };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface ParsedRow {
  doctorId: string;
  doctorName: string;
  date: string;       // YYYY-MM-DD
  startTime: string;
  endTime: string;
  breaks: { startTime: string; endTime: string }[];
  hasConflict: boolean;
  errors: string[];
}

@Controller('api/schedules')
export class SchedulesImportController {
  constructor(private readonly prisma: PrismaService) {}

  private assertDeptAccess(user: any, departmentId: string) {
    if (user.role === 'ADMIN') return;
    if (user.role === 'DEPARTMENT_HEAD' && user.departmentId === departmentId) return;
    throw new ForbiddenException('Нет доступа к этому отделению');
  }

  // ── Export ───────────────────────────────────────────────────────────────
  @Get('export')
  async exportSchedule(
    @Req() req: any,
    @Res() res: any,
    @Query('departmentId') departmentId: string,
    @Query('year') yearStr: string,
    @Query('month') monthStr: string,
  ) {
    const user = extractUser(req);
    if (!departmentId || !yearStr || !monthStr) {
      throw new BadRequestException('departmentId, year, month обязательны');
    }
    this.assertDeptAccess(user, departmentId);

    const year  = parseInt(yearStr,  10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Неверный год или месяц');
    }

    const days      = daysInMonth(year, month);
    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month - 1, days);

    const doctors = await this.prisma.user.findMany({
      where: { departmentId, role: 'DOCTOR', isActive: true },
      select: { id: true, firstName: true, lastName: true, middleName: true },
      orderBy: { lastName: 'asc' },
    });

    const schedules = await (this.prisma as any).doctorDaySchedule.findMany({
      where: {
        doctorId: { in: doctors.map((d: any) => d.id) },
        date: { gte: startDate, lte: endDate },
      },
      include: { breaks: { orderBy: { startTime: 'asc' } } },
    });

    // doctorId → date-string → schedule
    const schedMap = new Map<string, Map<string, any>>();
    for (const s of schedules) {
      const d = new Date(s.date);
      const key = isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (!schedMap.has(s.doctorId)) schedMap.set(s.doctorId, new Map());
      schedMap.get(s.doctorId)!.set(key, s);
    }

    const workbook = new ExcelJS.Workbook();

    // Hidden metadata sheet: row 1 = year, row 2 = month
    const meta = workbook.addWorksheet('_Meta');
    meta.state = 'hidden';
    meta.getCell('A1').value = year;
    meta.getCell('A2').value = month;

    const sheet = workbook.addWorksheet('График');

    // Column widths + hide doctorId column
    sheet.getColumn(1).width  = 0.1;
    sheet.getColumn(1).hidden = true;
    sheet.getColumn(2).width  = 30;
    for (let d = 1; d <= days; d++) sheet.getColumn(d + 2).width = 15;

    // Header row
    const headerRow = sheet.addRow([
      '',
      'Врач',
      ...Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0')),
    ]);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };

    // Hint row
    const hintRow = sheet.addRow(['', 'Формат: 08:00-14:30 или 08:00-14:30/11:00-12:00 (перерыв)']);
    hintRow.font = { italic: true, color: { argb: 'FF808080' } };
    sheet.mergeCells(`B${hintRow.number}:${String.fromCharCode(66 + days)}${hintRow.number}`);

    // Doctor rows
    for (const doc of doctors) {
      const fullName = [doc.lastName, doc.firstName, doc.middleName].filter(Boolean).join(' ');
      const rowData: any[] = [doc.id, fullName];

      for (let d = 1; d <= days; d++) {
        const dateStr = isoDate(year, month, d);
        const sched   = schedMap.get(doc.id)?.get(dateStr);
        if (sched) {
          let cell = `${sched.startTime}-${sched.endTime}`;
          for (const b of sched.breaks) cell += `/${b.startTime}-${b.endTime}`;
          rowData.push(cell);
        } else {
          rowData.push('');
        }
      }
      const r = sheet.addRow(rowData);
      r.eachCell((cell, colNum) => {
        if (colNum > 2 && cell.value) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
        }
      });
    }

    const monthPad = String(month).padStart(2, '0');
    res.setHeader('Content-Type', VALID_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="schedule-${year}-${monthPad}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  // ── Shared parser ─────────────────────────────────────────────────────────
  private async parseWorkbook(buffer: Buffer): Promise<{ year: number; month: number; rows: ParsedRow[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const meta = workbook.getWorksheet('_Meta');
    if (!meta) throw new BadRequestException('Лист "_Meta" не найден — скачайте шаблон заново');
    const year  = meta.getCell('A1').value as number;
    const month = meta.getCell('A2').value as number;
    if (!year || !month) throw new BadRequestException('Неверные метаданные в файле');

    const sheet = workbook.getWorksheet('График');
    if (!sheet) throw new BadRequestException('Лист "График" не найден');

    const days = daysInMonth(year, month);
    const rows: ParsedRow[] = [];

    sheet.eachRow((row, rowNum) => {
      if (rowNum <= 2) return; // skip header + hint
      const doctorId   = String(row.getCell(1).value ?? '').trim();
      const doctorName = String(row.getCell(2).value ?? '').trim();
      if (!doctorId) return;

      for (let d = 1; d <= days; d++) {
        const cellVal = String(row.getCell(d + 2).value ?? '').trim();
        if (!cellVal) continue;

        const dateStr = isoDate(year, month, d);
        const parsed  = parseCell(cellVal);
        if (!parsed) {
          rows.push({
            doctorId, doctorName, date: dateStr,
            startTime: '', endTime: '', breaks: [],
            hasConflict: false,
            errors: [`День ${String(d).padStart(2,'0')}: неверный формат "${cellVal}"`],
          });
          continue;
        }
        rows.push({
          doctorId, doctorName, date: dateStr,
          startTime: parsed.startTime, endTime: parsed.endTime, breaks: parsed.breaks,
          hasConflict: false, errors: [],
        });
      }
    });

    return { year, month, rows };
  }

  private async enrichRows(rows: ParsedRow[], userRole: string, userDeptId: string | null | undefined) {
    const doctorIds = [...new Set(rows.map(r => r.doctorId))];
    const doctors   = await this.prisma.user.findMany({
      where: { id: { in: doctorIds } },
      select: { id: true, departmentId: true },
    });
    const docMap = new Map(doctors.map(d => [d.id, d]));

    for (const row of rows) {
      if (row.errors.length > 0) continue;
      const doc = docMap.get(row.doctorId);
      if (!doc) { row.errors = [...row.errors, 'Врач не найден в системе']; continue; }
      if (userRole === 'DEPARTMENT_HEAD' && doc.departmentId !== userDeptId) {
        row.errors = [...row.errors, 'Врач не из вашего отделения'];
      }
    }

    // Conflict detection
    const validRows = rows.filter(r => r.errors.length === 0);
    if (validRows.length > 0) {
      const existing = await (this.prisma as any).doctorDaySchedule.findMany({
        where: { OR: validRows.map(r => ({ doctorId: r.doctorId, date: new Date(r.date) })) },
        select: { doctorId: true, date: true },
      });
      const conflictSet = new Set(
        existing.map((s: any) => {
          const d = new Date(s.date);
          return `${s.doctorId}|${isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())}`;
        }),
      );
      for (const row of validRows) {
        row.hasConflict = conflictSet.has(`${row.doctorId}|${row.date}`);
      }
    }
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      /\.xlsx$/i.test(file.originalname) && file.mimetype === VALID_MIME
        ? cb(null, true)
        : cb(new BadRequestException('Только .xlsx файлы'), false);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  async previewImport(@Req() req: any, @UploadedFile() file: any) {
    const user = extractUser(req);
    if (!file) throw new BadRequestException('Файл не загружен');

    const { rows } = await this.parseWorkbook(file.buffer);
    await this.enrichRows(rows, user.role, user.departmentId);

    return {
      rows,
      validCount:    rows.filter(r => r.errors.length === 0).length,
      conflictCount: rows.filter(r => r.errors.length === 0 && r.hasConflict).length,
      errorCount:    rows.filter(r => r.errors.length > 0).length,
    };
  }

  // ── Commit ────────────────────────────────────────────────────────────────
  @Post('import/commit')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      /\.xlsx$/i.test(file.originalname) && file.mimetype === VALID_MIME
        ? cb(null, true)
        : cb(new BadRequestException('Только .xlsx файлы'), false);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  async commitImport(@Req() req: any, @UploadedFile() file: any) {
    const user = extractUser(req);
    if (!file) throw new BadRequestException('Файл не загружен');

    const { rows } = await this.parseWorkbook(file.buffer);
    await this.enrichRows(rows, user.role, user.departmentId);

    const validRows = rows.filter(r => r.errors.length === 0);
    let upserted = 0;
    const errors: string[] = [];

    for (const row of validRows) {
      try {
        const date = new Date(row.date);
        await this.prisma.$transaction(async (tx: any) => {
          const existing = await tx.doctorDaySchedule.findFirst({
            where: { doctorId: row.doctorId, date },
            select: { id: true },
          });
          let scheduleId: string;
          if (existing) {
            await tx.dayScheduleBreak.deleteMany({ where: { scheduleId: existing.id } });
            await tx.doctorDaySchedule.update({
              where: { id: existing.id },
              data: { startTime: row.startTime, endTime: row.endTime },
            });
            scheduleId = existing.id;
          } else {
            const created = await tx.doctorDaySchedule.create({
              data: { doctorId: row.doctorId, date, startTime: row.startTime, endTime: row.endTime },
            });
            scheduleId = created.id;
          }
          if (row.breaks.length > 0) {
            await tx.dayScheduleBreak.createMany({
              data: row.breaks.map((b: any) => ({
                scheduleId, startTime: b.startTime, endTime: b.endTime, label: null,
              })),
            });
          }
        });
        upserted++;
      } catch (e: any) {
        errors.push(`${row.doctorName} ${row.date}: ${e.message}`);
      }
    }

    return { upserted, errors };
  }
}
