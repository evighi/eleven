-- 1) cancelar duplicatas em Agendamento
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "quadraId","data","horario"
           ORDER BY "createdAt" ASC, id ASC
         ) rn
  FROM "Agendamento"
  WHERE status='CONFIRMADO'
)
UPDATE "Agendamento" a
SET status='CANCELADO'
FROM ranked r
WHERE a.id=r.id AND r.rn>1;

-- 2) cancelar duplicatas em AgendamentoChurrasqueira
WITH ranked_c AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "churrasqueiraId","data","turno"
           ORDER BY "createdAt" ASC, id ASC
         ) rn
  FROM "AgendamentoChurrasqueira"
  WHERE status='CONFIRMADO'
)
UPDATE "AgendamentoChurrasqueira" a
SET status='CANCELADO'
FROM ranked_c r
WHERE a.id=r.id AND r.rn>1;

-- 3) criar índices parciais únicos (apenas uma vez cada)
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_agendamento_slot_confirmado"
ON "Agendamento" ("quadraId","data","horario")
WHERE status='CONFIRMADO';

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_agendamento_churras_slot_confirmado"
ON "AgendamentoChurrasqueira" ("churrasqueiraId","data","turno")
WHERE status='CONFIRMADO';