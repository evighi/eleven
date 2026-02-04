-- AlterTable
ALTER TABLE "public"."ConfiguracaoSistema" 
ADD COLUMN     "aulaExtraAtiva" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "aulaExtraFimHHMM" TEXT NOT NULL DEFAULT '23:00',
ADD COLUMN     "aulaExtraInicioHHMM" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "valorAulaExtra" DECIMAL(10,2) NOT NULL DEFAULT 50.00;
