-- CreateEnum
CREATE TYPE "public"."DeletionStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InteractionType" AS ENUM ('AG_COMUM', 'AG_PERM', 'CHURRAS', 'NONE');

-- AlterTable
ALTER TABLE "public"."Usuario" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."UserDeletionQueue" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "public"."DeletionStatus" NOT NULL DEFAULT 'PENDING',
    "lastInteractionType" "public"."InteractionType" NOT NULL DEFAULT 'NONE',
    "lastInteractionId" TEXT,
    "lastInteractionDate" TIMESTAMP(3),
    "eligibleAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDeletionQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserDeletionQueue_usuarioId_key" ON "public"."UserDeletionQueue"("usuarioId");

-- CreateIndex
CREATE INDEX "UserDeletionQueue_status_eligibleAt_idx" ON "public"."UserDeletionQueue"("status", "eligibleAt");

-- CreateIndex
CREATE INDEX "UserDeletionQueue_requestedAt_idx" ON "public"."UserDeletionQueue"("requestedAt");

-- CreateIndex
CREATE INDEX "Usuario_disabledAt_idx" ON "public"."Usuario"("disabledAt");

-- CreateIndex
CREATE INDEX "Usuario_deletedAt_idx" ON "public"."Usuario"("deletedAt");

-- AddForeignKey
ALTER TABLE "public"."UserDeletionQueue" ADD CONSTRAINT "UserDeletionQueue_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserDeletionQueue" ADD CONSTRAINT "UserDeletionQueue_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

