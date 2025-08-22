import { Router } from "express";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

// Listar usuários com busca opcional
// Listar usuários com busca opcional e filtro por tipo
router.get("/", async (req, res) => {
  const { nome, tipo } = req.query;

  try {
    const usuarios = await prisma.usuario.findMany({
      where: {
        AND: [
          nome
            ? { nome: { contains: String(nome), mode: "insensitive" } }
            : {},
          tipo ? { tipo: String(tipo) as TipoUsuario } : {}
        ]
      },
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        email: true,
        celular: true,
        nascimento: true,
        cpf: true,
        tipo: true
      }
    });

    res.json(usuarios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});



// Atualizar tipo de usuário
router.put("/:id/tipo", async (req, res) => {
  const schema = z.object({
    tipo: z.nativeEnum(TipoUsuario),
  });

  const validacao = schema.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  try {
    const usuario = await prisma.usuario.update({
      where: { id: req.params.id },
      data: { tipo: validacao.data.tipo },
    });

    res.json(usuario);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar tipo" });
  }
});

export default router;
