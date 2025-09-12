-- Drop o índice/constraint antigo (ok manter)
DROP INDEX IF EXISTS "AgendamentoChurrasqueira_churrasqueiraId_data_turno_key";

-- Cria índice único PARCIAL: só vale para status ativo
CREATE UNIQUE INDEX "uniq_churras_slot_ativo"
ON "AgendamentoChurrasqueira" ("churrasqueiraId", "data", "turno")
WHERE "status" <> 'CANCELADO'::"StatusAgendamento"
  AND "status" <> 'TRANSFERIDO'::"StatusAgendamento";
