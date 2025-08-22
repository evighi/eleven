/*
  Warnings:

  - You are about to drop the column `horario` on the `BloqueioQuadra` table. All the data in the column will be lost.
  - Added the required column `fimBloqueio` to the `BloqueioQuadra` table without a default value. This is not possible if the table is not empty.
  - Added the required column `inicioBloqueio` to the `BloqueioQuadra` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BloqueioQuadra" DROP COLUMN "horario",
ADD COLUMN     "fimBloqueio" TEXT NOT NULL,
ADD COLUMN     "inicioBloqueio" TEXT NOT NULL;
