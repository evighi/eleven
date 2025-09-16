/*
  Warnings:

  - You are about to drop the column `diaSemana` on the `AgendamentoChurrasqueira` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[churrasqueiraId,data,turno]` on the table `AgendamentoChurrasqueira` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[churrasqueiraId,diaSemana,turno]` on the table `AgendamentoPermanenteChurrasqueira` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `data` to the `AgendamentoChurrasqueira` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."AgendamentoChurrasqueira" DROP COLUMN "diaSemana",
ADD COLUMN     "data" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "AgendamentoChurrasqueira_usuarioId_idx" ON "public"."AgendamentoChurrasqueira"("usuarioId");

-- CreateIndex
CREATE INDEX "AgendamentoChurrasqueira_churrasqueiraId_data_idx" ON "public"."AgendamentoChurrasqueira"("churrasqueiraId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "AgendamentoChurrasqueira_churrasqueiraId_data_turno_key" ON "public"."AgendamentoChurrasqueira"("churrasqueiraId", "data", "turno");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_perm_churra_slot" ON "public"."AgendamentoPermanenteChurrasqueira"("churrasqueiraId", "diaSemana", "turno");
