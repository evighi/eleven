// routes/configuracoes.ts
import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { denyAtendente } from "../middleware/atendenteFeatures";

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

/**
 * GET /config/multa
 * Retorna o valor padrão atual da multa (string) para o front.
 */
router.get("/config/multa", async (_req: AuthRequest, res: Response) => {
  try {
    const config = await prisma.configuracaoSistema.findUnique({
      where: { id: 1 },
    });

    const valor = config ? config.valorMultaPadrao : new Prisma.Decimal(50);

    return res.json({
      valorMultaPadrao: valor.toString(), // front recebe string
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
  const { valorMultaPadrao } = req.body as {
    valorMultaPadrao?: number | string;
  };

  if (
    valorMultaPadrao === undefined ||
    valorMultaPadrao === null ||
    valorMultaPadrao === ""
  ) {
    return res.status(400).json({ erro: "valorMultaPadrao é obrigatório" });
  }

  const valorNumber = Number(
    typeof valorMultaPadrao === "string"
      ? valorMultaPadrao.replace(",", ".")
      : valorMultaPadrao
  );

  if (Number.isNaN(valorNumber) || valorNumber < 0) {
    return res
      .status(400)
      .json({ erro: "valorMultaPadrao deve ser um número >= 0" });
  }

  try {
    const config = await prisma.configuracaoSistema.upsert({
      where: { id: 1 },
      update: {
        valorMultaPadrao: new Prisma.Decimal(valorNumber),
      },
      create: {
        id: 1,
        valorMultaPadrao: new Prisma.Decimal(valorNumber),
      },
    });

    return res.json({
      mensagem: "Configuração de multa atualizada com sucesso",
      valorMultaPadrao: config.valorMultaPadrao.toString(),
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ erro: "Erro ao atualizar configuração de multa" });
  }
});

export default router;
