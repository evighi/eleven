// src/routes/usuarios.ts
import { Request, Response, Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

/**
 * Mantido como estava: retorna dados básicos do usuário logado.
 * (NÃO alterado)
 */
router.get("/me", (req: Request, res: Response) => {
  // Forçar o tipo extendido com type assertion:
  const reqCustom = req as Request & {
    usuario?: {
      usuarioLogadoId: string;
      usuarioLogadoNome: string;
      usuarioLogadoTipo: string;
    };
  };

  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  const { usuarioLogadoId, usuarioLogadoNome, usuarioLogadoTipo } = reqCustom.usuario;

  return res.json({
    id: usuarioLogadoId,
    nome: usuarioLogadoNome,
    tipo: usuarioLogadoTipo,
  });
});

/**
 * NOVO: Atualiza SOMENTE o celular do usuário logado.
 * PATCH /usuarios/me/celular
 */
router.patch("/me/celular", async (req: Request, res: Response) => {
  // Pega o id do usuário autenticado (via middleware que popula req.usuario)
  const reqCustom = req as Request & {
    usuario?: { usuarioLogadoId: string };
  };

  if (!reqCustom.usuario) {
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
      where: { id: reqCustom.usuario.usuarioLogadoId },
      data: { celular: valid.data.celular },
      // já devolve tudo que você quer exibir no front (não editável)
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

export default router;
