import { PrismaClient, UserRole, PatientCategory } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Сброс и наполнение базы данных...');

  await prisma.queueHistory.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.doctorAssignment.deleteMany();
  await prisma.shiftTemplate.deleteMany();
  await prisma.categorySettings.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.cabinet.deleteMany();
  await prisma.department.deleteMany();

  // Departments
  const [therapy, surgery, cardiology] = await Promise.all([
    prisma.department.create({ data: { id: 'dep-1', name: 'Терапевтическое отделение' } }),
    prisma.department.create({ data: { id: 'dep-2', name: 'Хирургическое отделение' } }),
    prisma.department.create({ data: { id: 'dep-3', name: 'Кардиологическое отделение' } }),
  ]);
  console.log('✅ Отделения созданы');

  // Cabinets
  await prisma.cabinet.createMany({
    data: [
      { number: '101', name: 'Кабинет терапевта 1', departmentId: therapy.id },
      { number: '102', name: 'Кабинет терапевта 2', departmentId: therapy.id },
      { number: '201', name: 'Кабинет хирурга', departmentId: surgery.id },
      { number: '301', name: 'Кабинет кардиолога', departmentId: cardiology.id },
    ],
  });
  console.log('✅ Кабинеты созданы');

  const hash = async (p: string) => bcrypt.hash(p, 10);

  // Users
  await prisma.user.createMany({
    data: [
      {
        username: 'admin',
        password: await hash('admin123'),
        firstName: 'Администратор',
        lastName: 'Системы',
        role: UserRole.ADMIN,
        allowedCategories: [],
      },
      {
        username: 'registrar1',
        password: await hash('reg123'),
        firstName: 'Анна',
        lastName: 'Регистратова',
        role: UserRole.REGISTRAR,
        allowedCategories: [PatientCategory.OSMS, PatientCategory.CONTINGENT, PatientCategory.PAID_ONCE],
      },
      {
        username: 'head1',
        password: await hash('head123'),
        firstName: 'Иван',
        lastName: 'Заведующий',
        role: UserRole.DEPARTMENT_HEAD,
        departmentId: therapy.id,
        allowedCategories: [],
      },
      {
        username: 'doctor1',
        password: await hash('doc123'),
        firstName: 'Мария',
        lastName: 'Терапевтова',
        role: UserRole.DOCTOR,
        specialty: 'Терапевт',
        departmentId: therapy.id,
        allowedCategories: [],
      },
      {
        username: 'doctor2',
        password: await hash('doc123'),
        firstName: 'Сергей',
        lastName: 'Хирургов',
        role: UserRole.DOCTOR,
        specialty: 'Хирург',
        departmentId: surgery.id,
        allowedCategories: [],
      },
    ],
  });
  console.log('✅ Пользователи созданы');

  // CategorySettings (defaults)
  await prisma.categorySettings.createMany({
    data: [
      { category: PatientCategory.PAID_ONCE, requiresArrivalConfirmation: true, requiresPaymentConfirmation: true },
      { category: PatientCategory.PAID_CONTRACT, requiresArrivalConfirmation: true, requiresPaymentConfirmation: false },
      { category: PatientCategory.OSMS, requiresArrivalConfirmation: true, requiresPaymentConfirmation: false },
      { category: PatientCategory.CONTINGENT, requiresArrivalConfirmation: true, requiresPaymentConfirmation: false },
      { category: PatientCategory.EMPLOYEE, requiresArrivalConfirmation: false, requiresPaymentConfirmation: false },
    ],
  });
  console.log('✅ Настройки категорий созданы');

  // Shift templates
  await prisma.shiftTemplate.createMany({
    data: [
      { name: 'Утренняя смена', startTime: '08:00', endTime: '14:00' },
      { name: 'Дневная смена', startTime: '14:00', endTime: '20:00' },
      { name: 'Полный день', startTime: '08:00', endTime: '17:00' },
    ],
  });
  console.log('✅ Шаблоны смен созданы');

  // Test patients
  await prisma.patient.createMany({
    data: [
      { firstName: 'Иван', lastName: 'Иванов', middleName: 'Иванович', phone: '+7-701-111-1111', categories: [PatientCategory.OSMS] },
      { firstName: 'Мария', lastName: 'Петрова', middleName: 'Сергеевна', phone: '+7-701-222-2222', categories: [PatientCategory.PAID_CONTRACT], contractNumber: 'ДГ-2024-001' },
      { firstName: 'Алексей', lastName: 'Сидоров', phone: '+7-701-333-3333', categories: [PatientCategory.CONTINGENT] },
    ],
  });
  console.log('✅ Тестовые пациенты созданы');

  console.log('\n🎉 Seed завершён!');
  console.log('Логины: admin/admin123 | registrar1/reg123 | head1/head123 | doctor1/doc123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
