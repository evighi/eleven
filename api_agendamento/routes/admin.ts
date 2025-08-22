import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router } from "express";
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();
const router = Router();

// Validação do corpo da requisição para criação de admin
const adminSchema = z.object({
  nome: z.string().min(5, { message: 'Nome deve possuir, no mínimo, 5 caracteres' }),
  email: z.string().email(),
  celular: z.string().min(10, { message: 'Celular deve ter DDD + número' }),
  senha: z.string(),
  tipo: z.nativeEnum(TipoUsuario).refine(t => t !== 'CLIENTE', {
    message: 'Tipo de usuário inválido para admin'
  })
});

// Função para validar força da senha (regra simples)
function validaSenha(senha: string) {
  const erros: string[] = [];
  if (senha.length < 6) erros.push("Senha deve possuir, no mínimo, 6 caracteres");
  if (!/[A-Z]/.test(senha)) erros.push("Senha deve possuir pelo menos 1 letra maiúscula");
  return erros;
}


// GET /admin - lista todos os administradores (todos os níveis)
router.get("/", async (req, res) => {
  try {
    const admins = await prisma.usuario.findMany({
      where: {
        tipo: {
          in: ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"]
        }
      }
    });
    res.status(200).json(admins);
  } catch (error) {
    res.status(400).json(error);
  }
});

// POST /admin - cria um administrador com nível específico
router.post("/", async (req, res) => {
  const validacao = adminSchema.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({
      erro: validacao.error.errors.map(e => e.message).join("; ")
    });
  }

  const errosSenha = validaSenha(validacao.data.senha);
  if (errosSenha.length > 0) {
    return res.status(400).json({ erro: errosSenha.join("; ") });
  }

  const salt = bcrypt.genSaltSync(12);
  const hash = bcrypt.hashSync(validacao.data.senha, salt);

  const { nome, email, celular, tipo } = validacao.data;

  try {
    const novoAdmin = await prisma.usuario.create({
      data: {
        nome,
        email,
        celular,
        senha: hash,
        tipo
      }
    });

    res.status(201).json({
      id: novoAdmin.id,
      nome: novoAdmin.nome,
      email: novoAdmin.email,
      celular: novoAdmin.celular,
      tipo: novoAdmin.tipo
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ erro: "Email já cadastrado" });
    }
    res.status(500).json({ erro: "Erro ao criar administrador" });
  }
});

// PATCH /admin/:id - editar dados do administrador
router.patch("/:id", async (req, res) => {
  const { id } = req.params;

  // Validar os campos que podem ser atualizados
  const updateSchema = z.object({
    nome: z.string().min(5).optional(),
    email: z.string().email().optional(),
    celular: z.string().min(10).optional(),
    senha: z.string().optional(),
    tipo: z.nativeEnum(TipoUsuario).refine(t => t !== 'CLIENTE', {
      message: 'Tipo de usuário inválido para admin'
    }).optional()
  });

  const validacao = updateSchema.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({
      erro: validacao.error.errors.map(e => e.message).join("; ")
    });
  }

  const dadosAtualizar = { ...validacao.data };

  // Se senha foi passada, validar e hashear
  if (dadosAtualizar.senha) {
    const errosSenha = validaSenha(dadosAtualizar.senha);
    if (errosSenha.length > 0) {
      return res.status(400).json({ erro: errosSenha.join("; ") });
    }
    const salt = bcrypt.genSaltSync(12);
    dadosAtualizar.senha = bcrypt.hashSync(dadosAtualizar.senha, salt);
  }

  try {
    const adminExistente = await prisma.usuario.findUnique({ where: { id } });
    if (!adminExistente) {
      return res.status(404).json({ erro: "Administrador não encontrado" });
    }

    // Atualiza admin no banco
    const adminAtualizado = await prisma.usuario.update({
      where: { id },
      data: dadosAtualizar
    });

    res.json({
      id: adminAtualizado.id,
      nome: adminAtualizado.nome,
      email: adminAtualizado.email,
      celular: adminAtualizado.celular,
      tipo: adminAtualizado.tipo
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ erro: "Email já cadastrado" });
    }
    res.status(500).json({ erro: "Erro ao atualizar administrador" });
  }
});


// DELETE /admin/:id - excluir administrador
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const adminExistente = await prisma.usuario.findUnique({ where: { id } });
    if (!adminExistente) {
      return res.status(404).json({ erro: "Administrador não encontrado" });
    }

    await prisma.usuario.delete({ where: { id } });
    res.json({ message: "Administrador excluído com sucesso" });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao excluir administrador" });
  }
});

export default router;
