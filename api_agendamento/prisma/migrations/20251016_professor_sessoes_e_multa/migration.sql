-- CreateEnum
CREATE TYPE "public"."TipoSessaoProfessor" AS ENUM ('AULA', 'JOGO');

-- AlterTable
ALTER TABLE "public"."Agendamento" ADD COLUMN     "multa" DECIMAL(10,2),
ADD COLUMN     "professorId" TEXT,
ADD COLUMN     "tipoSessao" "public"."TipoSessaoProfessor" DEFAULT 'AULA';

-- AlterTable
ALTER TABLE "public"."AgendamentoPermanente" ADD COLUMN     "professorId" TEXT,
ADD COLUMN     "tipoSessao" "public"."TipoSessaoProfessor" DEFAULT 'AULA';

-- CreateIndex
CREATE INDEX "Agendamento_usuarioId_idx" ON "public"."Agendamento"("usuarioId");

-- CreateIndex
CREATE INDEX "Agendamento_quadraId_data_idx" ON "public"."Agendamento"("quadraId", "data");

-- CreateIndex
CREATE INDEX "Agendamento_professorId_tipoSessao_data_idx" ON "public"."Agendamento"("professorId", "tipoSessao", "data");

-- CreateIndex
CREATE INDEX "AgendamentoPermanente_usuarioId_idx" ON "public"."AgendamentoPermanente"("usuarioId");

-- CreateIndex
CREATE INDEX "AgendamentoPermanente_quadraId_diaSemana_horario_idx" ON "public"."AgendamentoPermanente"("quadraId", "diaSemana", "horario");

-- CreateIndex
CREATE INDEX "AgendamentoPermanente_professorId_tipoSessao_diaSemana_idx" ON "public"."AgendamentoPermanente"("professorId", "tipoSessao", "diaSemana");

-- AddForeignKey
ALTER TABLE "public"."Agendamento" ADD CONSTRAINT "Agendamento_professorId_fkey" FOREIGN KEY ("professorId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgendamentoPermanente" ADD CONSTRAINT "AgendamentoPermanente_professorId_fkey" FOREIGN KEY ("professorId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

