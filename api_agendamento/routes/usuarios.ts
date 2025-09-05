// src/routes/usuarios.ts
import { Request, Response, Router } from "express";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware"; // ⬅️ exige login

const prisma = new PrismaClient();
const router = Router();

// 🔒 todas as rotas deste módulo exigem usuário autenticado
router.use(verificarToken);

/**
 * Retorna dados básicos do usuário logado.
 */
router.get("/me", (req: Request, res: Response) => {
  if (!req.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  const { usuarioLogadoId, usuarioLogadoNome, usuarioLogadoTipo } = req.usuario;

  return res.json({
    id: usuarioLogadoId,
    nome: usuarioLogadoNome,
    tipo: usuarioLogadoTipo,
  });
});

/**
 * Atualiza SOMENTE o celular do usuário logado.
 * PATCH /usuarios/me/celular
 */
router.patch("/me/celular", async (req: Request, res: Response) => {
  if (!req.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  // Validação do campo "celular"
  const schema = z.object({
    celular: z
      .string({ required_error: "Informe o celular" })
      .trim()
      .min(10, "Celular inválido")
      .max(20, "Celular muito longo"),
  });

  const valid = schema.safeParse(req.body);
  if (!valid.success) {
    return res.status(400).json({
      erro: "Dados inválidos",
      detalhes: valid.error.errors,
    });
  }

  try {
    const user = await prisma.usuario.update({
      where: { id: req.usuario.usuarioLogadoId },
      data: { celular: valid.data.celular },
      select: {
        id: true,
        nome: true,
        email: true,
        celular: true,
        nascimento: true,
        cpf: true,
        tipo: true,
      },
    });

    return res.json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao atualizar celular" });
  }
});

/**
 * 🔎 Autocomplete público (autenticado): retorna apenas { id, nome }.
 * GET /usuarios/buscar?q=jo&limit=10&tipos=CLIENTE
 *
 * - q: texto (mín. 2 caracteres)
 * - limit: 1..20 (padrão 10)
 * - tipos: por padrão só CLIENTE; pode informar algo como "CLIENTE,ADMIN_MASTER"
 */
router.get("/buscar", async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  const limitRaw = Number(req.query.limit ?? 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 20)) : 10;

  // por padrão, só CLIENTE
  const tiposParam = String(req.query.tipos ?? "CLIENTE")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean) as (keyof typeof TipoUsuario)[];

  const tiposValidos = tiposParam.filter((t) => t in TipoUsuario) as unknown as TipoUsuario[];

  if (q.length < 2) {
    // evita varredura/enumeração com consulta muito curta
    return res.json([]);
  }

  try {
    const usuarios = await prisma.usuario.findMany({
      where: {
        nome: { contains: q, mode: "insensitive" },
        ...(tiposValidos.length ? { tipo: { in: tiposValidos } } : {}),
      },
      select: { id: true, nome: true }, // ⬅️ apenas id e nome
      orderBy: { nome: "asc" },
      take: limit,
    });

    res.json(usuarios);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

/**
 * (Opcional) Público autenticado: obter só id+nome de 1 usuário
 * GET /usuarios/:id/public
 */
router.get("/:id/public", async (req: Request, res: Response) => {
  try {
    const u = await prisma.usuario.findUnique({
      where: { id: req.params.id },
      select: { id: true, nome: true },
    });
    if (!u) return res.status(404).json({ erro: "Usuário não encontrado" });
    res.json(u);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar usuário" });
  }
});

export default router;
