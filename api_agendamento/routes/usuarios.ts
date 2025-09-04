// src/routes/usuarios.ts
import { Request, Response, Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";

const prisma = new PrismaClient();
const router = Router();

// seleção segura (nunca retornar senha/codigo)
const baseUserSelect = {
  id: true,
  nome: true,
  email: true,
  celular: true,
  nascimento: true,
  cpf: true,
  tipo: true,
} as const;

// 🔒 todas as rotas daqui exigem login
router.use(verificarToken);

/**
 * GET /usuarios/me
 * Retorna dados do usuário logado (consultando o BD, não o token)
 */
router.get("/me", async (req: Request, res: Response) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  try {
    const user = await prisma.usuario.findUnique({
      where: { id: req.usuario.usuarioLogadoId },
      select: baseUserSelect,
    });
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado" });
    return res.json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao carregar perfil" });
  }
});

/**
 * PATCH /usuarios/me/celular
 * Atualiza SOMENTE o celular do usuário logado
 */
router.patch("/me/celular", async (req: Request, res: Response) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

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
      select: baseUserSelect,
    });
    return res.json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao atualizar celular" });
  }
});

export default router;
