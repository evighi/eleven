-- CreateEnum
CREATE TYPE "public"."AtendenteFeature" AS ENUM ('ATD_AGENDAMENTOS', 'ATD_PERMANENTES', 'ATD_CHURRAS', 'ATD_BLOQUEIOS', 'ATD_USUARIOS_LEITURA', 'ATD_USUARIOS_EDICAO', 'ATD_RELATORIOS');

-- CreateTable
CREATE TABLE "public"."PermissoesAtendente" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "features" "public"."AtendenteFeature"[] DEFAULT ARRAY[]::"public"."AtendenteFeature"[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissoesAtendente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissoesAtendente_updatedById_idx" ON "public"."PermissoesAtendente"("updatedById");

-- AddForeignKey
ALTER TABLE "public"."PermissoesAtendente" ADD CONSTRAINT "PermissoesAtendente_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Garante que exista 1 linha padrão de permissões do atendente (id = 1)
INSERT INTO "public"."PermissoesAtendente" ("id", "updatedAt")
VALUES (1, NOW());

