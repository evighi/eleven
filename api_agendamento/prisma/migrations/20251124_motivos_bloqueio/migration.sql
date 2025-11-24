-- AlterTable
ALTER TABLE "public"."BloqueioQuadra" ADD COLUMN     "motivoId" TEXT;

-- CreateTable
CREATE TABLE "public"."MotivoBloqueio" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivoBloqueio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotivoBloqueio_nome_key" ON "public"."MotivoBloqueio"("nome");

-- CreateIndex
CREATE INDEX "BloqueioQuadra_motivoId_idx" ON "public"."BloqueioQuadra"("motivoId");

-- AddForeignKey
ALTER TABLE "public"."BloqueioQuadra" ADD CONSTRAINT "BloqueioQuadra_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "public"."MotivoBloqueio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

