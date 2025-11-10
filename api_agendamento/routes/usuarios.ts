// src/routes/usuarios.ts
import { Request, Response, Router } from "express";
import { PrismaClient, Prisma, TipoUsuario as TipoUsuarioEnum } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import verificarToken from "../middleware/authMiddleware"; // ⬅️ exige login

const prisma = new PrismaClient();
const router = Router();

// 🔒 todas as rotas deste módulo exigem usuário autenticado
router.use(verificarToken);

/**
 * Utils
 */
function isAdminMaster(req: Request) {
  return req.usuario?.usuarioLogadoTipo === "ADMIN_MASTER";
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

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
 * PUT /usuarios/me
 * Usuário altera seus próprios dados (nome, celular, cpf, nascimento) e pode trocar a senha informando senhaAtual.
 */
router.put("/me", async (req: Request, res: Response) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const schema = z
    .object({
      nome: z.string().trim().min(2).max(100).optional(),
      celular: z.string().trim().min(10).max(20).nullable().optional(),
      cpf: z.string().trim().min(11).max(14).nullable().optional(),
      nascimento: z.coerce.date().nullable().optional(),
      senhaAtual: z.string().min(6).optional(),
      novaSenha: z.string().min(6).optional(),
    })
    .refine((d) => (d.novaSenha ? !!d.senhaAtual : true), {
      message: "Para definir nova senha, informe senhaAtual",
      path: ["senhaAtual"],
    });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const { nome, celular, cpf, nascimento, senhaAtual, novaSenha } = parsed.data;

  try {
    const user = await prisma.usuario.findUnique({
      where: { id: req.usuario.usuarioLogadoId },
      select: { id: true, senha: true },
    });
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado" });

    const dataToUpdate: Prisma.UsuarioUpdateInput = stripUndefined({
      nome,
      celular,
      cpf,
      nascimento: nascimento ?? undefined,
    });

    if (novaSenha) {
      const ok = await bcrypt.compare(senhaAtual!, user.senha);
      if (!ok) return res.status(400).json({ erro: "Senha atual inválida" });
      dataToUpdate.senha = await bcrypt.hash(novaSenha, 10);
    }

    const updated = await prisma.usuario.update({
      where: { id: user.id },
      data: dataToUpdate,
      select: {
        id: true,
        nome: true,
        email: true,
        celular: true,
        nascimento: true,
        cpf: true,
        tipo: true,
        verificado: true,
        valorQuadra: true,
        updatedAt: true,
      },
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        actorId: req.usuario.usuarioLogadoId,
        actorName: req.usuario.usuarioLogadoNome,
        actorTipo: req.usuario.usuarioLogadoTipo as any,
        event: "USUARIO_UPDATE_SELF",
        targetType: "USUARIO",
        targetId: updated.id,
        metadata: {
          camposAlterados: Object.keys(
            stripUndefined({
              nome,
              celular,
              cpf,
              nascimento,
              senhaAlterada: !!novaSenha,
            })
          ),
        },
      },
    });

    return res.json(updated);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro ao atualizar seus dados" });
  }
});

/**
 * PUT /usuarios/:id
 * ADMIN_MASTER pode alterar todos os campos relevantes de um usuário, inclusive redefinir senha, email, tipo, verificado e valorQuadra.
 */
router.put("/:id", async (req: Request, res: Response) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });
  if (!isAdminMaster(req)) return res.status(403).json({ erro: "Apenas ADMIN_MASTER pode alterar outros usuários" });

  const schemaAdmin = z.object({
    nome: z.string().trim().min(2).max(100).optional(),
    email: z.string().email().optional(),
    celular: z.string().trim().min(10).max(20).nullable().optional(),
    cpf: z.string().trim().min(11).max(14).nullable().optional(),
    nascimento: z.coerce.date().nullable().optional(),
    tipo: z.nativeEnum(TipoUsuarioEnum).optional(),
    verificado: z.boolean().optional(),
    valorQuadra: z
      .union([z.coerce.number().nonnegative(), z.string().regex(/^\d+([.,]\d{1,2})?$/)])
      .nullable()
      .optional(),
    novaSenha: z.string().min(6).optional(),
    limparCodigos: z.boolean().optional(), // zera codigoEmail/codigoRecuperacao/expiraEm
  });

  const parsed = schemaAdmin.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const {
    nome,
    email,
    celular,
    cpf,
    nascimento,
    tipo,
    verificado,
    valorQuadra,
    novaSenha,
    limparCodigos,
  } = parsed.data;

  try {
    const existe = await prisma.usuario.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true },
    });
    if (!existe) return res.status(404).json({ erro: "Usuário não encontrado" });

    const data: Prisma.UsuarioUpdateInput = stripUndefined({
      nome,
      email,
      celular,
      cpf,
      nascimento: nascimento ?? undefined,
      tipo,
      verificado,
      valorQuadra:
        valorQuadra === undefined
          ? undefined
          : valorQuadra === null
            ? null
            : typeof valorQuadra === "number"
              ? valorQuadra.toFixed(2) // prisma aceita string para Decimal
              : valorQuadra.replace(",", "."),
      codigoEmail: limparCodigos ? null : undefined,
      codigoRecuperacao: limparCodigos ? null : undefined,
      expiraEm: limparCodigos ? null : undefined,
    });

    if (novaSenha) {
      data.senha = await bcrypt.hash(novaSenha, 10);
    }

    const updated = await prisma.usuario.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true,
        nome: true,
        email: true,
        celular: true,
        nascimento: true,
        cpf: true,
        tipo: true,
        verificado: true,
        valorQuadra: true,
        updatedAt: true,
      },
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        actorId: req.usuario.usuarioLogadoId,
        actorName: req.usuario.usuarioLogadoNome,
        actorTipo: req.usuario.usuarioLogadoTipo as any,
        event: "USUARIO_UPDATE_ADMIN",
        targetType: "USUARIO",
        targetId: updated.id,
        metadata: {
          camposAlterados: Object.keys(
            stripUndefined({
              nome,
              email,
              celular,
              cpf,
              nascimento,
              tipo,
              verificado,
              valorQuadra,
              senhaRedefinida: !!novaSenha,
              limparCodigos: !!limparCodigos,
            })
          ),
        },
      },
    });

    return res.json(updated);
  } catch (e: any) {
    console.error(e);
    if (e?.code === "P2002" && e?.meta?.target?.includes("email")) {
      return res.status(409).json({ erro: "E-mail já está em uso" });
    }
    return res.status(500).json({ erro: "Erro ao atualizar usuário" });
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
    .map((s) => s.trim())
    .filter(Boolean) as (keyof typeof TipoUsuarioEnum)[];

  const tiposValidos = tiposParam.filter((t) => t in TipoUsuarioEnum) as unknown as TipoUsuarioEnum[];

  if (q.length < 2) {
    // evita varredura/enumeração com consulta muito curta
    return res.json([]);
  }

  try {
    const usuarios = await prisma.usuario.findMany({
      where: {
        // não trazer usuários excluídos nem pendentes de exclusão
        deletedAt: null,
        disabledAt: null,
        nome: { contains: q, mode: "insensitive" },
        ...(tiposValidos.length ? { tipo: { in: tiposValidos } } : {}),
      },
      select: { id: true, nome: true }, // apenas id e nome
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
    const u = await prisma.usuario.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        disabledAt: null,
      },
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
