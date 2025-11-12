-- CreateTable
CREATE TABLE "public"."EsporteJanelaAula" (
    "id" TEXT NOT NULL,
    "esporteId" TEXT NOT NULL,
    "diaSemana" "public"."DiaSemana",
    "tipoSessao" "public"."TipoSessaoProfessor" NOT NULL DEFAULT 'AULA',
    "inicioHHMM" TEXT NOT NULL,
    "fimHHMM" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EsporteJanelaAula_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EsporteJanelaAula_esporteId_diaSemana_tipoSessao_idx" ON "public"."EsporteJanelaAula"("esporteId", "diaSemana", "tipoSessao");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_janela_esporte_dia_tipo" ON "public"."EsporteJanelaAula"("esporteId", "diaSemana", "tipoSessao");

-- AddForeignKey
ALTER TABLE "public"."EsporteJanelaAula" ADD CONSTRAINT "EsporteJanelaAula_esporteId_fkey" FOREIGN KEY ("esporteId") REFERENCES "public"."Esporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

