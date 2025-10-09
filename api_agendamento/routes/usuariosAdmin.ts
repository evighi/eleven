import { Router, Request } from "express";
import { PrismaClient, TipoUsuario, Prisma } from "@prisma/client"; // ⬅️ adicione Prisma
import { z } from "zod";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

const baseUserSelect = {
  id: true,
  nome: true,
  email: true,
  celular: true,
  nascimento: true,
  cpf: true,
  tipo: true,
  valorQuadra: true, // ⬅️ agora retornamos também
} as const;

const isMaster = (req: Request) => req.usuario?.usuarioLogadoTipo === "ADMIN_MASTER";

router.use(verificarToken);
router.use(requireAdmin);

// GET /usuariosAdmin
router.get("/", async (req, res) => {
  try {
    const querySchema = z.object({
      nome: z.string().trim().optional(),
      tipo: z.nativeEnum(TipoUsuario).optional(),
    });

    const parsed = querySchema.safeParse({
      nome: req.query.nome,
      tipo: req.query.tipo,
    });
    if (!parsed.success) {
      return res.status(400).json({ erro: "Parâmetros inválidos", detalhes: parsed.error.errors });
    }

    const { nome, tipo } = parsed.data;

    const usuarios = await prisma.usuario.findMany({
      where: {
        ...(nome ? { nome: { contains: nome, mode: "insensitive" } } : {}),
        ...(tipo ? { tipo } : {}),
      },
      orderBy: { nome: "asc" },
      select: baseUserSelect,
    });

    return res.json(usuarios);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

// PUT /usuariosAdmin/:id/tipo — alterar tipo (apenas ADMIN_MASTER)
router.put("/:id/tipo", async (req, res) => {
  if (!isMaster(req)) {
    return res.status(403).json({ erro: "Somente ADMIN_MASTER pode alterar o tipo de usuário" });
  }

  // ⬇️ Schema: aceita valorQuadra e OBRIGA quando tipo=ADMIN_PROFESSORES
  const bodySchema = z.object({
    tipo: z.nativeEnum(TipoUsuario),
    valorQuadra: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === null || v === "") return null;
        const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
        return Number.isFinite(n) ? n : NaN;
      }),
  }).superRefine((data, ctx) => {
    if (data.tipo === "ADMIN_PROFESSORES") {
      if (data.valorQuadra === null || Number.isNaN(data.valorQuadra)) {
        ctx.addIssue({
          code: "custom",
          path: ["valorQuadra"],
          message: "valorQuadra é obrigatório e deve ser numérico ao promover para ADMIN_PROFESSORES.",
        });
      } else if (data.valorQuadra! < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["valorQuadra"],
          message: "valorQuadra não pode ser negativo.",
        });
      }
    }
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const { id } = req.params;
  const novoTipo = parsed.data.tipo;
  const valorQuadraNum = parsed.data.valorQuadra; // já veio number | null | NaN (validado acima)

  try {
    const alvo = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, tipo: true },
    });
    if (!alvo) return res.status(404).json({ erro: "Usuário não encontrado" });

    // Proteções de master
    if (alvo.tipo === "ADMIN_MASTER" && novoTipo !== "ADMIN_MASTER") {
      const masters = await prisma.usuario.count({ where: { tipo: "ADMIN_MASTER" } });
      if (masters <= 1) {
        return res.status(400).json({ erro: "Não é possível remover o último ADMIN_MASTER" });
      }
      if (req.usuario?.usuarioLogadoId === id) {
        return res.status(400).json({ erro: "Você não pode remover seu próprio ADMIN_MASTER" });
      }
    }

    // Monta o update:
    // - Se promover para professor, seta valorQuadra (Decimal)
    // - Se for qualquer outro tipo, limpa valorQuadra (evita lixo antigo)
    const dataUpdate: any = { tipo: novoTipo };
    if (novoTipo === "ADMIN_PROFESSORES") {
      // parsed já garantiu que é número válido >= 0
      dataUpdate.valorQuadra = new Prisma.Decimal(String(valorQuadraNum!.toFixed(2)));
    } else {
      dataUpdate.valorQuadra = null;
    }

    const atualizado = await prisma.usuario.update({
      where: { id },
      data: dataUpdate,
      select: baseUserSelect,
    });

    return res.json(atualizado);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao atualizar tipo" });
  }
});

export default router;
