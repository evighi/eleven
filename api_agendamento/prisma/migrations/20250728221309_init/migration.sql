-- CreateEnum
CREATE TYPE "TipoUsuario" AS ENUM ('CLIENTE', 'ADMIN_MASTER', 'ADMIN_ATENDENTE', 'ADMIN_PROFESSORES');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('CONFIRMADO', 'CANCELADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "TipoCamera" AS ENUM ('COM_CAMERA', 'SEM_CAMERA');

-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "celular" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "cpf" TEXT,
    "nascimento" TIMESTAMP(3),
    "tipo" "TipoUsuario" NOT NULL,
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "codigoEmail" TEXT,
    "codigoRecuperacao" TEXT,
    "expiraEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Esporte" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "imagem" TEXT,

    CONSTRAINT "Esporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quadra" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipoCamera" "TipoCamera" NOT NULL,
    "imagem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quadra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuadraEsporte" (
    "quadraId" TEXT NOT NULL,
    "esporteId" TEXT NOT NULL,

    CONSTRAINT "QuadraEsporte_pkey" PRIMARY KEY ("quadraId","esporteId")
);

-- CreateTable
CREATE TABLE "Churrasqueira" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "imagem" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Churrasqueira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agendamento" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "horario" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "quadraId" TEXT NOT NULL,
    "esporteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendamentoPermanente" (
    "id" TEXT NOT NULL,
    "diaSemana" "DiaSemana" NOT NULL,
    "horario" TEXT NOT NULL,
    "quadraId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "esporteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendamentoPermanente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendamentoChurrasqueira" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "horario" TEXT NOT NULL,
    "churrasqueiraId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendamentoChurrasqueira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendamentoPermanenteChurrasqueira" (
    "id" TEXT NOT NULL,
    "diaSemana" "DiaSemana" NOT NULL,
    "horario" TEXT NOT NULL,
    "churrasqueiraId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendamentoPermanenteChurrasqueira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_JogadoresNoAgendamento" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_JogadoresNoAgendamento_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Esporte_nome_key" ON "Esporte"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Quadra_numero_key" ON "Quadra"("numero");

-- CreateIndex
CREATE INDEX "_JogadoresNoAgendamento_B_index" ON "_JogadoresNoAgendamento"("B");

-- AddForeignKey
ALTER TABLE "QuadraEsporte" ADD CONSTRAINT "QuadraEsporte_quadraId_fkey" FOREIGN KEY ("quadraId") REFERENCES "Quadra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuadraEsporte" ADD CONSTRAINT "QuadraEsporte_esporteId_fkey" FOREIGN KEY ("esporteId") REFERENCES "Esporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_quadraId_fkey" FOREIGN KEY ("quadraId") REFERENCES "Quadra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_esporteId_fkey" FOREIGN KEY ("esporteId") REFERENCES "Esporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanente" ADD CONSTRAINT "AgendamentoPermanente_quadraId_fkey" FOREIGN KEY ("quadraId") REFERENCES "Quadra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanente" ADD CONSTRAINT "AgendamentoPermanente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanente" ADD CONSTRAINT "AgendamentoPermanente_esporteId_fkey" FOREIGN KEY ("esporteId") REFERENCES "Esporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoChurrasqueira" ADD CONSTRAINT "AgendamentoChurrasqueira_churrasqueiraId_fkey" FOREIGN KEY ("churrasqueiraId") REFERENCES "Churrasqueira"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoChurrasqueira" ADD CONSTRAINT "AgendamentoChurrasqueira_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanenteChurrasqueira" ADD CONSTRAINT "AgendamentoPermanenteChurrasqueira_churrasqueiraId_fkey" FOREIGN KEY ("churrasqueiraId") REFERENCES "Churrasqueira"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanenteChurrasqueira" ADD CONSTRAINT "AgendamentoPermanenteChurrasqueira_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_JogadoresNoAgendamento" ADD CONSTRAINT "_JogadoresNoAgendamento_A_fkey" FOREIGN KEY ("A") REFERENCES "Agendamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_JogadoresNoAgendamento" ADD CONSTRAINT "_JogadoresNoAgendamento_B_fkey" FOREIGN KEY ("B") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
