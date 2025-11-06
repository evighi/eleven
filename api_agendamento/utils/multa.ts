// utils/multa.ts
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// valor padrão caso não exista registro na ConfiguracaoSistema
const DEFAULT_VALOR_MULTA = 50;

/**
 * Retorna o valor padrão da multa como number.
 * - Se existir registro ConfiguracaoSistema(id: 1) → usa ele
 * - Senão → usa 50
 */
export async function valorMultaPadrao(): Promise<number> {
  const config = await prisma.configuracaoSistema.findUnique({
    where: { id: 1 },
  });

  if (!config) {
    return DEFAULT_VALOR_MULTA;
  }

  // config.valorMultaPadrao é Decimal → convertemos pra number
  return Number(config.valorMultaPadrao.toString());
}

/**
 * Versão já em Decimal, caso você queira gravar direto no campo multa (Decimal)
 */
export async function valorMultaPadraoDecimal(): Promise<Prisma.Decimal> {
  const config = await prisma.configuracaoSistema.findUnique({
    where: { id: 1 },
  });

  if (!config) {
    return new Prisma.Decimal(DEFAULT_VALOR_MULTA);
  }

  return config.valorMultaPadrao;
}
