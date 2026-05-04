-- DropForeignKey
ALTER TABLE "display_board_cabinets" DROP CONSTRAINT "display_board_cabinets_cabinetId_fkey";

-- CreateIndex
CREATE INDEX "display_board_cabinets_cabinetId_idx" ON "display_board_cabinets"("cabinetId");

-- AddForeignKey
ALTER TABLE "display_board_cabinets" ADD CONSTRAINT "display_board_cabinets_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
