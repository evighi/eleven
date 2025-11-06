// utils/multa.ts
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_VALOR_MULTA = 50;

export async function valorMultaPadrao(): Promise<number> {
  const config = await prisma.configuracaoSistema.findUnique({
    where: { id: 1 },
  });

  if (!config) {
    return DEFAULT_VALOR_MULTA;
  }

  return Number(config.valorMultaPadrao.toString());
}

export async function valorMultaPadraoDecimal(): Promise<Prisma.Decimal> {
  const config = await prisma.configuracaoSistema.findUnique({
    where: { id: 1 },
  });

  if (!config) {
    return new Prisma.Decimal(DEFAULT_VALOR_MULTA);
  }

  return config.valorMultaPadrao;
}
