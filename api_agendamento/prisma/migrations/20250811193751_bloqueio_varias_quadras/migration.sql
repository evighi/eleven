/*
  Warnings:

  - You are about to drop the column `quadraId` on the `BloqueioQuadra` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "BloqueioQuadra" DROP CONSTRAINT "BloqueioQuadra_quadraId_fkey";

-- AlterTable
ALTER TABLE "BloqueioQuadra" DROP COLUMN "quadraId";

-- CreateTable
CREATE TABLE "_QuadrasNoBloqueio" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QuadrasNoBloqueio_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_QuadrasNoBloqueio_B_index" ON "_QuadrasNoBloqueio"("B");

-- AddForeignKey
ALTER TABLE "_QuadrasNoBloqueio" ADD CONSTRAINT "_QuadrasNoBloqueio_A_fkey" FOREIGN KEY ("A") REFERENCES "BloqueioQuadra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuadrasNoBloqueio" ADD CONSTRAINT "_QuadrasNoBloqueio_B_fkey" FOREIGN KEY ("B") REFERENCES "Quadra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
