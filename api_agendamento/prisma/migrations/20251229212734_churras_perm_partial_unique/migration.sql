-- Remove o UNIQUE antigo baseado no @@unique([churrasqueiraId, diaSemana, turno])
DROP INDEX IF EXISTS "uniq_perm_churra_slot";

-- Cria o índice "normal" que o schema Prisma descreve (@@index com map: "idx_perm_churra_slot")
CREATE INDEX IF NOT EXISTS "idx_perm_churra_slot"
ON "public"."AgendamentoPermanenteChurrasqueira" ("churrasqueiraId", "diaSemana", "turno");

-- Cria um UNIQUE PARCIAL: garante no máximo 1 PERMANENTE ATIVO por slot
-- Permite reutilizar o mesmo slot se todos os registros antigos estiverem CANCELADOS ou TRANSFERIDOS
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_perm_churra_slot_active"
ON "public"."AgendamentoPermanenteChurrasqueira" ("churrasqueiraId", "diaSemana", "turno")
WHERE "status" NOT IN ('CANCELADO', 'TRANSFERIDO');
