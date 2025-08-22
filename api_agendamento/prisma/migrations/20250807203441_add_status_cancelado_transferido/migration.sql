-- AlterEnum
ALTER TYPE "StatusAgendamento" ADD VALUE 'TRANSFERIDO';

-- AlterTable
ALTER TABLE "Agendamento" ADD COLUMN     "canceladoPorId" TEXT,
ADD COLUMN     "status" "StatusAgendamento" NOT NULL DEFAULT 'CONFIRMADO',
ADD COLUMN     "transferidoPorId" TEXT;

-- AlterTable
ALTER TABLE "AgendamentoChurrasqueira" ADD COLUMN     "canceladoPorId" TEXT,
ADD COLUMN     "status" "StatusAgendamento" NOT NULL DEFAULT 'CONFIRMADO',
ADD COLUMN     "transferidoPorId" TEXT;

-- AlterTable
ALTER TABLE "AgendamentoPermanente" ADD COLUMN     "canceladoPorId" TEXT,
ADD COLUMN     "status" "StatusAgendamento" NOT NULL DEFAULT 'CONFIRMADO',
ADD COLUMN     "transferidoPorId" TEXT;

-- AlterTable
ALTER TABLE "AgendamentoPermanenteChurrasqueira" ADD COLUMN     "canceladoPorId" TEXT,
ADD COLUMN     "status" "StatusAgendamento" NOT NULL DEFAULT 'CONFIRMADO',
ADD COLUMN     "transferidoPorId" TEXT;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_transferidoPorId_fkey" FOREIGN KEY ("transferidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanente" ADD CONSTRAINT "AgendamentoPermanente_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanente" ADD CONSTRAINT "AgendamentoPermanente_transferidoPorId_fkey" FOREIGN KEY ("transferidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoChurrasqueira" ADD CONSTRAINT "AgendamentoChurrasqueira_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoChurrasqueira" ADD CONSTRAINT "AgendamentoChurrasqueira_transferidoPorId_fkey" FOREIGN KEY ("transferidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanenteChurrasqueira" ADD CONSTRAINT "AgendamentoPermanenteChurrasqueira_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendamentoPermanenteChurrasqueira" ADD CONSTRAINT "AgendamentoPermanenteChurrasqueira_transferidoPorId_fkey" FOREIGN KEY ("transferidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
