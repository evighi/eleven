-- CreateTable
CREATE TABLE "public"."AgendamentoPermanenteChurrasqueiraCancelamento" (
    "id" TEXT NOT NULL,
    "agendamentoPermanenteChurrasqueiraId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendamentoPermanenteChurrasqueiraCancelamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgendamentoPermanenteChurrasqueiraCancelamento_agendamentoP_idx" ON "public"."AgendamentoPermanenteChurrasqueiraCancelamento"("agendamentoPermanenteChurrasqueiraId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "AgendamentoPermanenteChurrasqueiraCancelamento_agendamentoP_key" ON "public"."AgendamentoPermanenteChurrasqueiraCancelamento"("agendamentoPermanenteChurrasqueiraId", "data");

-- AddForeignKey
ALTER TABLE "public"."AgendamentoPermanenteChurrasqueiraCancelamento" ADD CONSTRAINT "AgendamentoPermanenteChurrasqueiraCancelamento_agendamento_fkey" FOREIGN KEY ("agendamentoPermanenteChurrasqueiraId") REFERENCES "public"."AgendamentoPermanenteChurrasqueira"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgendamentoPermanenteChurrasqueiraCancelamento" ADD CONSTRAINT "AgendamentoPermanenteChurrasqueiraCancelamento_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
