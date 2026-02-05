// routes/configuracoes.ts
import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { denyAtendente } from "../middleware/atendenteFeatures";
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

// 🔒 tudo aqui exige login + ser ADMIN
router.use(verificarToken);
router.use(requireAdmin);

// ⛔ atendente NUNCA pode mexer em configurações do sistema
router.use(denyAtendente());

// Se você já tiver um middleware de auth que coloca o usuário em req.user,
// pode tipar assim:
interface AuthRequest extends Request {
  user?: {
    id: string;
    nome: string;
    email: string;
  };
}

/* ------------------------- Helpers ------------------------- */
function parseMoneyToNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function isHHMM(v: any): v is string {
  return typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
}

function normalizeHHMM(v: string): string | null {
  if (!isHHMM(v)) return null;
  const [hh, mm] = v.split(":").map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function compareHHMM(a: string, b: string) {
  return a.localeCompare(b);
}

async function getOrCreateSingletonConfig() {
  // garante que sempre exista id=1
  const existing = await prisma.configuracaoSistema.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  return prisma.configuracaoSistema.create({
    data: {
      id: 1,
      valorMultaPadrao: new Prisma.Decimal("50.00"),
      aulaExtraAtiva: true,
      aulaExtraInicioHHMM: "18:00",
      aulaExtraFimHHMM: "23:00",
      valorAulaExtra: new Prisma.Decimal("50.00"),
    },
  });
}

/* ------------------------- MULTA ------------------------- */
/**
 * GET /config/multa
 * Retorna o valor padrão atual da multa (string) para o front.
 */
router.get("/config/multa", async (_req: AuthRequest, res: Response) => {
  try {
    const config = await getOrCreateSingletonConfig();
    return res.json({
      valorMultaPadrao: config.valorMultaPadrao.toString(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar configuração de multa" });
  }
});

/**
 * PUT /config/multa
 * Atualiza o valor padrão da multa.
 * Body: { valorMultaPadrao: number | string }
 */
router.put("/config/multa", async (req: AuthRequest, res: Response) => {
  const { valorMultaPadrao } = req.body as { valorMultaPadrao?: number | string };

  const valorNumber = parseMoneyToNumber(valorMultaPadrao);
  if (valorNumber == null) {
    return res.status(400).json({ erro: "valorMultaPadrao é obrigatório" });
  }
  if (valorNumber < 0) {
    return res.status(400).json({ erro: "valorMultaPadrao deve ser um número >= 0" });
  }

  try {
    const config = await prisma.configuracaoSistema.upsert({
      where: { id: 1 },
      update: { valorMultaPadrao: new Prisma.Decimal(round2(valorNumber).toFixed(2)) },
      create: {
        id: 1,
        valorMultaPadrao: new Prisma.Decimal(round2(valorNumber).toFixed(2)),
        // defaults aula extra (pra não depender do prisma default caso seu schema mude)
        aulaExtraAtiva: true,
        aulaExtraInicioHHMM: "18:00",
        aulaExtraFimHHMM: "23:00",
        valorAulaExtra: new Prisma.Decimal("50.00"),
      },
    });

    try {
      await logAudit({
        req,
        event: "CONFIG_MULTA_UPDATE",
        target: { type: TargetType.SISTEMA, id: "configuracaoSistema:1" },
        metadata: {
          valorMultaPadrao: config.valorMultaPadrao.toString(),
          updatedById: req.user?.id ?? null,
        },
      });
    } catch { }

    return res.json({
      mensagem: "Configuração de multa atualizada com sucesso",
      valorMultaPadrao: config.valorMultaPadrao.toString(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao atualizar configuração de multa" });
  }
});

/* ------------------------- AULA EXTRA ------------------------- */
/**
 * GET /config/aula-extra
 * Retorna a configuração global da aula extra.
 *
 * Response:
 * {
 *   aulaExtraAtiva: boolean,
 *   aulaExtraInicioHHMM: "18:00",
 *   aulaExtraFimHHMM: "23:00",
 *   valorAulaExtra: "50.00"
 * }
 */
router.get("/config/aula-extra", async (_req: AuthRequest, res: Response) => {
  try {
    const config = await getOrCreateSingletonConfig();

    return res.json({
      aulaExtraAtiva: !!config.aulaExtraAtiva,
      aulaExtraInicioHHMM: config.aulaExtraInicioHHMM,
      aulaExtraFimHHMM: config.aulaExtraFimHHMM,
      valorAulaExtra: config.valorAulaExtra.toString(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar configuração de aula extra" });
  }
});

/**
 * PUT /config/aula-extra
 * Atualiza a configuração global da aula extra.
 *
 * Body (parcial permitido, mas recomendo mandar tudo do front):
 * {
 *   aulaExtraAtiva?: boolean,
 *   aulaExtraInicioHHMM?: "HH:MM",
 *   aulaExtraFimHHMM?: "HH:MM",
 *   valorAulaExtra?: number | string
 * }
 */
router.put("/config/aula-extra", async (req: AuthRequest, res: Response) => {
  const {
    aulaExtraAtiva,
    aulaExtraInicioHHMM,
    aulaExtraFimHHMM,
    valorAulaExtra,
  } = (req.body ?? {}) as {
    aulaExtraAtiva?: boolean;
    aulaExtraInicioHHMM?: string;
    aulaExtraFimHHMM?: string;
    valorAulaExtra?: number | string;
  };

  try {
    const current = await getOrCreateSingletonConfig();

    const nextInicio =
      aulaExtraInicioHHMM !== undefined ? normalizeHHMM(String(aulaExtraInicioHHMM)) : current.aulaExtraInicioHHMM;
    const nextFim =
      aulaExtraFimHHMM !== undefined ? normalizeHHMM(String(aulaExtraFimHHMM)) : current.aulaExtraFimHHMM;

    if (!nextInicio) {
      return res.status(400).json({ erro: "aulaExtraInicioHHMM inválido. Use HH:MM (00-23):(00-59)." });
    }
    if (!nextFim) {
      return res.status(400).json({ erro: "aulaExtraFimHHMM inválido. Use HH:MM (00-23):(00-59)." });
    }

    // regra: [inicio, fim) -> fim deve ser maior que início
    if (compareHHMM(nextInicio, nextFim) >= 0) {
      return res.status(400).json({ erro: "aulaExtraInicioHHMM deve ser menor que aulaExtraFimHHMM." });
    }

    let nextValor: Prisma.Decimal = current.valorAulaExtra;
    if (valorAulaExtra !== undefined) {
      const n = parseMoneyToNumber(valorAulaExtra);
      if (n == null) {
        return res.status(400).json({ erro: "valorAulaExtra inválido. Envie number ou string numérica." });
      }
      if (n < 0) {
        return res.status(400).json({ erro: "valorAulaExtra deve ser um número >= 0" });
      }
      nextValor = new Prisma.Decimal(round2(n).toFixed(2));
    }

    const updated = await prisma.configuracaoSistema.update({
      where: { id: 1 },
      data: {
        aulaExtraAtiva: aulaExtraAtiva !== undefined ? Boolean(aulaExtraAtiva) : current.aulaExtraAtiva,
        aulaExtraInicioHHMM: nextInicio,
        aulaExtraFimHHMM: nextFim,
        valorAulaExtra: nextValor,
      },
    });

    try {
      await logAudit({
        req,
        event: "CONFIG_AULA_EXTRA_UPDATE",
        target: { type: TargetType.SISTEMA, id: "configuracaoSistema:1" },
        metadata: {
          aulaExtraAtivaAntes: !!current.aulaExtraAtiva,
          aulaExtraAtivaDepois: !!updated.aulaExtraAtiva,
          aulaExtraInicioAntes: current.aulaExtraInicioHHMM,
          aulaExtraInicioDepois: updated.aulaExtraInicioHHMM,
          aulaExtraFimAntes: current.aulaExtraFimHHMM,
          aulaExtraFimDepois: updated.aulaExtraFimHHMM,
          valorAulaExtraAntes: current.valorAulaExtra.toString(),
          valorAulaExtraDepois: updated.valorAulaExtra.toString(),
          updatedById: req.user?.id ?? null,
        },
      });
    } catch { }

    return res.json({
      mensagem: "Configuração de aula extra atualizada com sucesso",
      aulaExtraAtiva: !!updated.aulaExtraAtiva,
      aulaExtraInicioHHMM: updated.aulaExtraInicioHHMM,
      aulaExtraFimHHMM: updated.aulaExtraFimHHMM,
      valorAulaExtra: updated.valorAulaExtra.toString(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao atualizar configuração de aula extra" });
  }
});

export default router;
