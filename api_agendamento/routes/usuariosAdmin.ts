import { Router, Request } from "express";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { z } from "zod";

import verificarToken from "../middleware/authMiddleware"; // ajuste se necessário
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
} as const;

const isMaster = (req: Request) => req.usuario?.usuarioLogadoTipo === "ADMIN_MASTER";

// 🔒 tudo aqui exige login + ser ADMIN
router.use(verificarToken);
router.use(requireAdmin);

// GET /usuariosAdmin  — listar usuários com busca por nome e filtro por tipo
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

// PUT /usuariosAdmin/:id/tipo  — alterar tipo (apenas ADMIN_MASTER)
router.put("/:id/tipo", async (req, res) => {
  if (!isMaster(req)) {
    return res.status(403).json({ erro: "Somente ADMIN_MASTER pode alterar o tipo de usuário" });
  }

  const bodySchema = z.object({
    tipo: z.nativeEnum(TipoUsuario),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const { id } = req.params;
  const novoTipo = parsed.data.tipo;

  try {
    const alvo = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, tipo: true },
    });
    if (!alvo) return res.status(404).json({ erro: "Usuário não encontrado" });

    // Proteções:
    // 1) Não permitir remover o ÚLTIMO ADMIN_MASTER
    if (alvo.tipo === "ADMIN_MASTER" && novoTipo !== "ADMIN_MASTER") {
      const masters = await prisma.usuario.count({ where: { tipo: "ADMIN_MASTER" } });
      if (masters <= 1) {
        return res.status(400).json({ erro: "Não é possível remover o último ADMIN_MASTER" });
      }
      // 2) Não permitir o master remover o próprio nível
      if (req.usuario?.usuarioLogadoId === id) {
        return res.status(400).json({ erro: "Você não pode remover seu próprio ADMIN_MASTER" });
      }
    }

    const atualizado = await prisma.usuario.update({
      where: { id },
      data: { tipo: novoTipo },
      select: baseUserSelect,
    });

    return res.json(atualizado);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao atualizar tipo" });
  }
});

export default router;
