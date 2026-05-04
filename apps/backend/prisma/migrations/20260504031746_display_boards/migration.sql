-- CreateTable
CREATE TABLE "display_boards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "columns" INTEGER NOT NULL DEFAULT 3,
    "audioMode" TEXT NOT NULL DEFAULT 'SOUND',
    "ttsTemplate" TEXT NOT NULL DEFAULT '{lastName} пройдите в кабинет {cabinet}',
    "soundUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "display_boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "display_board_cabinets" (
    "boardId" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,

    CONSTRAINT "display_board_cabinets_pkey" PRIMARY KEY ("boardId","cabinetId")
);

-- CreateIndex
CREATE UNIQUE INDEX "display_boards_slug_key" ON "display_boards"("slug");

-- AddForeignKey
ALTER TABLE "display_board_cabinets" ADD CONSTRAINT "display_board_cabinets_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "display_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "display_board_cabinets" ADD CONSTRAINT "display_board_cabinets_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "cabinets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
