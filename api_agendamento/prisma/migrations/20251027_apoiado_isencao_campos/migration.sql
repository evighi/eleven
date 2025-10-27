-- AlterEnum
ALTER TYPE "public"."TipoUsuario" ADD VALUE 'CLIENTE_APOIADO';

-- AlterTable
ALTER TABLE "public"."Agendamento" ADD COLUMN     "apoiadoUsuarioId" TEXT,
ADD COLUMN     "isencaoApoiado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "valorQuadraCobrado" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."Usuario" ADD COLUMN     "apoioAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "apoioMensalMaxAulas" INTEGER,
ADD COLUMN     "apoioObs" TEXT;

-- CreateIndex
CREATE INDEX "Agendamento_apoiadoUsuarioId_data_idx" ON "public"."Agendamento"("apoiadoUsuarioId", "data");

-- AddForeignKey
ALTER TABLE "public"."Agendamento" ADD CONSTRAINT "Agendamento_apoiadoUsuarioId_fkey" FOREIGN KEY ("apoiadoUsuarioId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

