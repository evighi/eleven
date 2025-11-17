-- CreateIndex
CREATE INDEX "Agendamento_quadraId_data_horario_idx" ON "public"."Agendamento"("quadraId", "data", "horario");

-- CreateIndex
CREATE INDEX "Agendamento_data_status_idx" ON "public"."Agendamento"("data", "status");

-- CreateIndex
CREATE INDEX "AgendamentoChurrasqueira_churrasqueiraId_data_turno_idx" ON "public"."AgendamentoChurrasqueira"("churrasqueiraId", "data", "turno");

-- CreateIndex
CREATE INDEX "AgendamentoPermanente_diaSemana_status_idx" ON "public"."AgendamentoPermanente"("diaSemana", "status");

-- CreateIndex
CREATE INDEX "BloqueioQuadra_dataBloqueio_idx" ON "public"."BloqueioQuadra"("dataBloqueio");

-- CreateIndex
CREATE INDEX "QuadraEsporte_esporteId_idx" ON "public"."QuadraEsporte"("esporteId");

