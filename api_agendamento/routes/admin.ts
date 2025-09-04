import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router, Request } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";

// 🔐 middlewares
import verificarToken from "../middleware/authMiddleware"; // ou "../middleware/authMiddlewares"
import { requireAdmin } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

const baseSelect = {
  id: true,
  nome: true,
  email: true,
  celular: true,
  tipo: true,
} as const;

const isMaster = (req: Request) => req.usuario?.usuarioLogadoTipo === "ADMIN_MASTER";

// ⚙️ validação
const adminSchema = z.object({
  nome: z.string().min(5, { message: "Nome deve possuir, no mínimo, 5 caracteres" }),
  email: z.string().email(),
  celular: z.string().min(10, { message: "Celular deve ter DDD + número" }),
  senha: z.string(),
  tipo: z.nativeEnum(TipoUsuario).refine((t) => t !== "CLIENTE", {
    message: "Tipo de usuário inválido para admin",
  }),
});

function validaSenha(s: string) {
  const erros: string[] = [];
  if (s.length < 6) erros.push("Senha deve possuir, no mínimo, 6 caracteres");
  if (!/[A-Z]/.test(s)) erros.push("Senha deve possuir pelo menos 1 letra maiúscula");
  return erros;
}

// 🔒 tudo aqui dentro exige login + ser ADMIN
router.use(verificarToken);
router.use(requireAdmin);

// GET /admin — listar admins (qualquer admin pode ver)
router.get("/", async (_req, res) => {
  try {
    const admins = await prisma.usuario.findMany({
      where: { tipo: { in: ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"] } },
      select: baseSelect,
      orderBy: { nome: "asc" },
    });
    return res.status(200).json(admins);
  } catch (error) {
    return res.status(500).json({ erro: "Erro ao listar administradores" });
  }
});

// POST /admin — criar admin (apenas ADMIN_MASTER)
router.post("/", async (req, res) => {
  if (!isMaster(req)) return res.status(403).json({ erro: "Somente ADMIN_MASTER pode criar administradores" });

  const valid = adminSchema.safeParse(req.body);
  if (!valid.success) {
    return res.status(400).json({ erro: valid.error.errors.map((e) => e.message).join("; ") });
  }

  const errosSenha = validaSenha(valid.data.senha);
  if (errosSenha.length) return res.status(400).json({ erro: errosSenha.join("; ") });

  const hash = bcrypt.hashSync(valid.data.senha, 12);
  const { nome, email, celular, tipo } = valid.data;

  try {
    const novoAdmin = await prisma.usuario.create({
      data: { nome, email, celular, senha: hash, tipo },
      select: baseSelect,
    });
    return res.status(201).json(novoAdmin);
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({ erro: "E-mail já cadastrado" });
    }
    return res.status(500).json({ erro: "Erro ao criar administrador" });
  }
});

// PATCH /admin/:id — editar admin
// - ADMIN_MASTER pode editar qualquer admin e alterar `tipo`.
// - Admin não-master só pode editar **a si mesmo** e **não** pode alterar `tipo`.
router.patch("/:id", async (req, res) => {
  const { id } = req.params;

  const ehMaster = isMaster(req);
  const ehSelf = req.usuario?.usuarioLogadoId === id;

  if (!ehMaster && !ehSelf) {
    return res.status(403).json({ erro: "Sem permissão para editar outro administrador" });
  }

  const updateSelfSchema = z.object({
    nome: z.string().min(5).optional(),
    email: z.string().email().optional(),
    celular: z.string().min(10).optional(),
    senha: z.string().optional(),
  });

  const updateMasterSchema = updateSelfSchema.extend({
    tipo: z
      .nativeEnum(TipoUsuario)
      .refine((t) => t !== "CLIENTE", { message: "Tipo de usuário inválido para admin" })
      .optional(),
  });

  const schema = ehMaster ? updateMasterSchema : updateSelfSchema;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.errors.map((e) => e.message).join("; ") });
  }

  const data: any = { ...parsed.data };

  // senha -> valida e hash
  if (data.senha) {
    const erros = validaSenha(data.senha);
    if (erros.length) return res.status(400).json({ erro: erros.join("; ") });
    data.senha = bcrypt.hashSync(data.senha, 12);
  }

  try {
    const existe = await prisma.usuario.findUnique({ where: { id } });
    if (!existe || !["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"].includes(existe.tipo)) {
      return res.status(404).json({ erro: "Administrador não encontrado" });
    }

    // se não-master, garantir que não vai alterar `tipo`
    if (!ehMaster) delete data.tipo;

    const adminAtualizado = await prisma.usuario.update({
      where: { id },
      data,
      select: baseSelect,
    });

    return res.json(adminAtualizado);
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({ erro: "E-mail já cadastrado" });
    }
    return res.status(500).json({ erro: "Erro ao atualizar administrador" });
  }
});

// DELETE /admin/:id — excluir admin (apenas ADMIN_MASTER; evita apagar a si mesmo)
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  if (!isMaster(req)) {
    return res.status(403).json({ erro: "Somente ADMIN_MASTER pode excluir administradores" });
  }
  if (req.usuario?.usuarioLogadoId === id) {
    return res.status(400).json({ erro: "Você não pode excluir a si mesmo" });
  }

  try {
    const adminExistente = await prisma.usuario.findUnique({ where: { id } });
    if (!adminExistente || !["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"].includes(adminExistente.tipo)) {
      return res.status(404).json({ erro: "Administrador não encontrado" });
    }

    await prisma.usuario.delete({ where: { id } });
    return res.json({ mensagem: "Administrador excluído com sucesso" });
  } catch {
    return res.status(500).json({ erro: "Erro ao excluir administrador" });
  }
});

export default router;
