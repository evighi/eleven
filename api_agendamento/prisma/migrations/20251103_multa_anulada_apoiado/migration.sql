-- AlterTable
ALTER TABLE "public"."Agendamento" ADD COLUMN     "multaAnulada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "multaAnuladaEm" TIMESTAMP(3),
ADD COLUMN     "multaAnuladaPorId" TEXT;

-- AddForeignKey
ALTER TABLE "public"."Agendamento" ADD CONSTRAINT "Agendamento_multaAnuladaPorId_fkey" FOREIGN KEY ("multaAnuladaPorId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

