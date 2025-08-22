/*
  Warnings:

  - You are about to drop the column `data` on the `AgendamentoChurrasqueira` table. All the data in the column will be lost.
  - Added the required column `diaSemana` to the `AgendamentoChurrasqueira` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AgendamentoChurrasqueira" DROP COLUMN "data",
ADD COLUMN     "diaSemana" "DiaSemana" NOT NULL;

-- AlterTable
ALTER TABLE "AgendamentoPermanenteChurrasqueira" ADD COLUMN     "dataInicio" TIMESTAMP(3);
