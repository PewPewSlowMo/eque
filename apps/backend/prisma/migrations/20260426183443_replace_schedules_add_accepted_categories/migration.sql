/*
  Warnings:

  - You are about to drop the `doctor_schedules` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `schedule_breaks` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "doctor_schedules" DROP CONSTRAINT "doctor_schedules_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "schedule_breaks" DROP CONSTRAINT "schedule_breaks_scheduleId_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "acceptedCategories" "PatientCategory"[];

-- DropTable
DROP TABLE "doctor_schedules";

-- DropTable
DROP TABLE "schedule_breaks";

-- CreateTable
CREATE TABLE "doctor_day_schedules" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_day_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_schedule_breaks" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "day_schedule_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_day_schedules_date_idx" ON "doctor_day_schedules"("date");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_day_schedules_doctorId_date_key" ON "doctor_day_schedules"("doctorId", "date");

-- AddForeignKey
ALTER TABLE "doctor_day_schedules" ADD CONSTRAINT "doctor_day_schedules_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_schedule_breaks" ADD CONSTRAINT "day_schedule_breaks_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "doctor_day_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
