/*
  Warnings:

  - You are about to drop the column `iin` on the `patients` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QueueSource" ADD VALUE 'KIOSK';
ALTER TYPE "QueueSource" ADD VALUE 'DOCTOR_SELF';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'DEPT_REGISTRAR';

-- DropForeignKey
ALTER TABLE "queue_entries" DROP CONSTRAINT "queue_entries_createdById_fkey";

-- DropIndex
DROP INDEX "patients_iin_key";

-- AlterTable
ALTER TABLE "doctor_day_schedules" ADD COLUMN     "slotMinutes" INTEGER NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "patients" DROP COLUMN "iin",
ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "kioskId" TEXT,
ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "selfRegister" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "kiosks" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "defaultCategory" "PatientCategory" NOT NULL DEFAULT 'OSMS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiosks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kiosks_slug_key" ON "kiosks"("slug");

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "kiosks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosks" ADD CONSTRAINT "kiosks_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
