-- CreateTable
CREATE TABLE "BloqueioQuadra" (
    "id" TEXT NOT NULL,
    "diaSemana" "DiaSemana" NOT NULL,
    "horario" TEXT NOT NULL,
    "quadraId" TEXT NOT NULL,
    "bloqueadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloqueioQuadra_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BloqueioQuadra" ADD CONSTRAINT "BloqueioQuadra_quadraId_fkey" FOREIGN KEY ("quadraId") REFERENCES "Quadra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloqueioQuadra" ADD CONSTRAINT "BloqueioQuadra_bloqueadoPorId_fkey" FOREIGN KEY ("bloqueadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
