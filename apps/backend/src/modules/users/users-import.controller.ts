import {
  Controller, Get, Post,
  Res, Req,
  UploadedFile, UseInterceptors,
  UnauthorizedException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as ExcelJS from 'exceljs';
import { UserRole, PatientCategory } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TrpcService } from '../../trpc/trpc.service';

const ROLES = Object.values(UserRole);
const CATEGORIES = Object.values(PatientCategory);

function extractUser(req: any) {
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
  const user = TrpcService.verifyToken(auth.substring(7));
  if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Только ADMIN');
  return user;
}

export interface PreviewRow {
  _rowNum: number;
  _errors: string[];
  lastName: string;
  firstName: string;
  middleName: string;
  username: string;
  password: string;
  role: string;
  specialty: string;
  departmentName: string;
  allowedCategories: string[];
  acceptedCategories: string[];
}

function parseCategories(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(s => CATEGORIES.includes(s as PatientCategory));
}

async function parseWorkbook(buffer: Buffer, departments: { id: string; name: string }[]): Promise<PreviewRow[]> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.getWorksheet('Пользователи');
  if (!sheet) throw new BadRequestException('Лист "Пользователи" не найден в файле');

  const rows: PreviewRow[] = [];
  const usernamesInFile = new Set<string>();

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    const cell = (col: number) => String(row.getCell(col).value ?? '').trim();

    const lastName    = cell(1);
    const firstName   = cell(2);
    const middleName  = cell(3);
    const username    = cell(4);
    const password    = cell(5);
    const role        = cell(6);
    const specialty   = cell(7);
    const deptName    = cell(8);
    const allowedRaw  = cell(9);
    const acceptedRaw = cell(10);

    // Skip completely empty rows
    if (!lastName && !firstName && !username && !password && !role) return;

    const errors: string[] = [];

    if (!lastName)  errors.push('Фамилия обязательна');
    if (!firstName) errors.push('Имя обязательно');
    if (!username)  errors.push('Логин обязателен');
    if (!password)  errors.push('Пароль обязателен');
    else if (password.length < 6) errors.push('Пароль: минимум 6 символов');
    if (!role)      errors.push('Роль обязательна');
    if (role && !ROLES.includes(role as UserRole)) errors.push(`Неверная роль: ${role}`);

    if (username) {
      if (usernamesInFile.has(username)) {
        errors.push(`Дублирующийся логин в файле: ${username}`);
      } else {
        usernamesInFile.add(username);
      }
    }

    const dept = departments.find(d => d.name === deptName);
    if (deptName && !dept) errors.push(`Отделение не найдено: ${deptName}`);

    rows.push({
      _rowNum: rowNum,
      _errors: errors,
      lastName,
      firstName,
      middleName,
      username,
      password,
      role,
      specialty,
      departmentName: deptName,
      allowedCategories: parseCategories(allowedRaw),
      acceptedCategories: parseCategories(acceptedRaw),
    });
  });

  return rows;
}

@Controller('api/users')
export class UsersImportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('template')
  async downloadTemplate(@Req() req: any, @Res() res: any) {
    extractUser(req);

    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'eque';

    const sheet = workbook.addWorksheet('Пользователи');
    sheet.columns = [
      { header: 'Фамилия*',             key: 'lastName',           width: 22 },
      { header: 'Имя*',                 key: 'firstName',          width: 18 },
      { header: 'Отчество',             key: 'middleName',         width: 22 },
      { header: 'Логин*',               key: 'username',           width: 18 },
      { header: 'Пароль*',              key: 'password',           width: 18 },
      { header: 'Роль*',                key: 'role',               width: 18 },
      { header: 'Специальность',        key: 'specialty',          width: 22 },
      { header: 'Отделение',            key: 'department',         width: 28 },
      { header: 'Разреш. категории',    key: 'allowedCategories',  width: 35 },
      { header: 'Принимаем. категории', key: 'acceptedCategories', width: 35 },
    ];

    // Bold header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' },
    };

    // Role dropdown (column F = 6)
    // Cast to any: ExcelJS typings omit dataValidations on Worksheet but it exists at runtime
    (sheet as any).dataValidations.add('F2:F10000', {
      type: 'list',
      allowBlank: true,
      showErrorMessage: true,
      error: `Выберите одно из: ${ROLES.join(', ')}`,
      formulae: [`"${ROLES.join(',')}"`],
    });

    // Department dropdown via hidden sheet
    if (departments.length > 0) {
      const deptSheet = workbook.addWorksheet('_Departments');
      deptSheet.state = 'hidden';
      departments.forEach((d, i) => {
        deptSheet.getCell(i + 1, 1).value = d.name;
      });
      (sheet as any).dataValidations.add('H2:H10000', {
        type: 'list',
        allowBlank: true,
        showErrorMessage: true,
        error: 'Выберите отделение из списка',
        formulae: [`_Departments!$A$1:$A$${departments.length}`],
      });
    }

    // Sample row
    sheet.addRow({
      lastName:          'Иванов',
      firstName:         'Иван',
      middleName:        'Иванович',
      username:          'ivanov',
      password:          'password123',
      role:              'DOCTOR',
      specialty:         'Терапевт',
      department:        departments[0]?.name ?? '',
      allowedCategories: '',
      acceptedCategories:'OSMS,PAID_ONCE',
    });

    // Categories hint row (row 3)
    const hintRow = sheet.addRow([
      '-- Доступные категории: PAID_ONCE, PAID_CONTRACT, OSMS, CONTINGENT, EMPLOYEE (через запятую) --',
    ]);
    hintRow.font = { italic: true, color: { argb: 'FF808080' } };
    sheet.mergeCells(`A${hintRow.number}:J${hintRow.number}`);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="users-template.xlsx"',
    );
    await workbook.xlsx.write(res as any);
    res.end();
  }

  @Post('import/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        const validMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        if (/\.xlsx$/i.test(file.originalname) && file.mimetype === validMime) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Только .xlsx файлы'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async previewImport(@Req() req: any, @UploadedFile() file: any) {
    extractUser(req);
    if (!file) throw new BadRequestException('Файл не загружен');

    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true },
    });

    const rows = await parseWorkbook(file.buffer, departments);
    const usernames = rows.map(r => r.username).filter(Boolean);
    const existing = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { username: true },
    });
    const existingSet = new Set(existing.map(u => u.username));

    for (const row of rows) {
      if (row.username && existingSet.has(row.username)) {
        row._errors.push(`Логин уже существует в системе: ${row.username}`);
      }
    }

    const validCount = rows.filter(r => r._errors.length === 0).length;
    const errorCount = rows.filter(r => r._errors.length > 0).length;

    return { rows, validCount, errorCount };
  }
}
