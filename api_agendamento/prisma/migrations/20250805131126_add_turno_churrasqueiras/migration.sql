/*
  Warnings:

  - You are about to drop the column `horario` on the `AgendamentoChurrasqueira` table. All the data in the column will be lost.
  - You are about to drop the column `horario` on the `AgendamentoPermanenteChurrasqueira` table. All the data in the column will be lost.
  - Added the required column `turno` to the `AgendamentoChurrasqueira` table without a default value. This is not possible if the table is not empty.
  - Added the required column `turno` to the `AgendamentoPermanenteChurrasqueira` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Turno" AS ENUM ('DIA', 'NOITE');

-- AlterTable
ALTER TABLE "AgendamentoChurrasqueira" DROP COLUMN "horario",
ADD COLUMN     "turno" "Turno" NOT NULL;

-- AlterTable
ALTER TABLE "AgendamentoPermanenteChurrasqueira" DROP COLUMN "horario",
ADD COLUMN     "turno" "Turno" NOT NULL;
