/*
  Warnings:

  - You are about to drop the column `diaSemana` on the `BloqueioQuadra` table. All the data in the column will be lost.
  - Added the required column `dataBloqueio` to the `BloqueioQuadra` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BloqueioQuadra" DROP COLUMN "diaSemana",
ADD COLUMN     "dataBloqueio" TIMESTAMP(3) NOT NULL;
