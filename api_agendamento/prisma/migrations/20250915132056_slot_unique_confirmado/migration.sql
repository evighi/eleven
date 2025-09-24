-- Impede 2 reservas COMUNS na mesma quadra/data/horário se estiverem CONFIRMADAS
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_agendamento_slot_confirmado"
ON "Agendamento" ("quadraId", "data", "horario")
WHERE "status" = 'CONFIRMADO';

-- Impede 2 reservas COMUNS de churrasqueira no mesmo dia/turno se estiverem CONFIRMADAS
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_agendamento_churras_slot_confirmado"
ON "AgendamentoChurrasqueira" ("churrasqueiraId", "data", "turno")
WHERE "status" = 'CONFIRMADO';
