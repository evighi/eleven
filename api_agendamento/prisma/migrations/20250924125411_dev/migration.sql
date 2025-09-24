-- CreateEnum
CREATE TYPE "public"."AuditTargetType" AS ENUM ('USUARIO', 'AGENDAMENTO', 'AGENDAMENTO_PERMANENTE', 'AGENDAMENTO_CHURRASQUEIRA', 'AGENDAMENTO_PERMANENTE_CHURRASQUEIRA', 'QUADRA', 'CHURRASQUEIRA', 'SISTEMA');

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorTipo" "public"."TipoUsuario",
    "event" TEXT NOT NULL,
    "targetType" "public"."AuditTargetType" NOT NULL,
    "targetId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_event_idx" ON "public"."AuditLog"("event");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "public"."AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "public"."AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
