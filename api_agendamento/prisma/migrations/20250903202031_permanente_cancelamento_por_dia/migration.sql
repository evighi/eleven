-- CreateTable
CREATE TABLE "public"."AgendamentoPermanenteCancelamento" (
    "id" TEXT NOT NULL,
    "agendamentoPermanenteId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendamentoPermanenteCancelamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgendamentoPermanenteCancelamento_agendamentoPermanenteId_d_idx" ON "public"."AgendamentoPermanenteCancelamento"("agendamentoPermanenteId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "AgendamentoPermanenteCancelamento_agendamentoPermanenteId_d_key" ON "public"."AgendamentoPermanenteCancelamento"("agendamentoPermanenteId", "data");

-- AddForeignKey
ALTER TABLE "public"."AgendamentoPermanenteCancelamento" ADD CONSTRAINT "AgendamentoPermanenteCancelamento_agendamentoPermanenteId_fkey" FOREIGN KEY ("agendamentoPermanenteId") REFERENCES "public"."AgendamentoPermanente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AgendamentoPermanenteCancelamento" ADD CONSTRAINT "AgendamentoPermanenteCancelamento_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
