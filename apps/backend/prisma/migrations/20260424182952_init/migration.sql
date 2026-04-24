-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REGISTRAR', 'CALL_CENTER', 'DOCTOR', 'DEPARTMENT_HEAD', 'DIRECTOR');

-- CreateEnum
CREATE TYPE "PatientCategory" AS ENUM ('PAID_ONCE', 'PAID_CONTRACT', 'OSMS', 'CONTINGENT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "QueuePriority" AS ENUM ('EMERGENCY', 'INPATIENT', 'SCHEDULED', 'WALK_IN');

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('WAITING_ARRIVAL', 'ARRIVED', 'CALLED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueSource" AS ENUM ('REGISTRAR', 'CALL_CENTER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'REGISTRAR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "specialty" TEXT,
    "departmentId" TEXT,
    "allowedCategories" "PatientCategory"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabinets" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT,
    "departmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cabinets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_assignments" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shiftTemplateId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT,
    "iin" TEXT,
    "categories" "PatientCategory"[],
    "contractNumber" TEXT,
    "employeeDepartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" TEXT NOT NULL,
    "queueNumber" INTEGER NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "priority" "QueuePriority" NOT NULL,
    "category" "PatientCategory" NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "requiresArrivalConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'WAITING_ARRIVAL',
    "source" "QueueSource" NOT NULL,
    "createdById" TEXT NOT NULL,
    "paymentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "cancelReason" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_history" (
    "id" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldStatus" "QueueEntryStatus",
    "newStatus" "QueueEntryStatus",
    "userId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_settings" (
    "id" TEXT NOT NULL,
    "category" "PatientCategory" NOT NULL,
    "requiresArrivalConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "requiresPaymentConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "cabinets_number_key" ON "cabinets"("number");

-- CreateIndex
CREATE INDEX "doctor_assignments_doctorId_isActive_idx" ON "doctor_assignments"("doctorId", "isActive");

-- CreateIndex
CREATE INDEX "doctor_assignments_cabinetId_isActive_idx" ON "doctor_assignments"("cabinetId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "patients_iin_key" ON "patients"("iin");

-- CreateIndex
CREATE INDEX "patients_lastName_firstName_idx" ON "patients"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "queue_entries_doctorId_status_idx" ON "queue_entries"("doctorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_doctorId_createdAt_queueNumber_key" ON "queue_entries"("doctorId", "createdAt", "queueNumber");

-- CreateIndex
CREATE INDEX "queue_history_queueEntryId_idx" ON "queue_history"("queueEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "category_settings_category_key" ON "category_settings"("category");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabinets" ADD CONSTRAINT "cabinets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_assignments" ADD CONSTRAINT "doctor_assignments_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_assignments" ADD CONSTRAINT "doctor_assignments_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_assignments" ADD CONSTRAINT "doctor_assignments_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_employeeDepartmentId_fkey" FOREIGN KEY ("employeeDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_history" ADD CONSTRAINT "queue_history_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "queue_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
