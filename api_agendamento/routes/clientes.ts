import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { isValid } from "date-fns";
import { enviarCodigoEmail } from "../utils/enviarEmail";
import { gerarCodigoVerificacao } from "../utils/gerarCodigo";

// 🔐 Middlewares
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin, requireSelfOrAdminParam, isAdmin } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

/** ---------------------------------------------------
 * Helpers: seleção segura (nunca retornar senha/codigo)
 * --------------------------------------------------- */
const baseUserSelect = {
  id: true,
  nome: true,
  email: true,
  celular: true,
  cpf: true,
  nascimento: true,
  verificado: true,
  tipo: true,
} as const;

/** -----------------------------
 * Schemas
 * ----------------------------- */
const clienteSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  celular: z.string().min(10),
  cpf: z.string().min(11),
  nascimento: z.string().refine((data) => isValid(new Date(data)), {
    message: "Data de nascimento inválida",
  }),
  senha: z.string(),
});

function validaSenha(senha: string) {
  const erros: string[] = [];
  if (senha.length < 6) erros.push("Mínimo 6 caracteres");
  if (!/[A-Z]/.test(senha)) erros.push("Pelo menos 1 letra maiúscula");
  return erros;
}

/** -----------------------------
 * Públicos
 * ----------------------------- */

// POST /clientes/registrar  (cria como CLIENTE)
router.post("/registrar", async (req, res) => {
  const validacao = clienteSchema.safeParse(req.body);
  if (!validacao.success) {
    return res
      .status(400)
      .json({ erro: validacao.error.errors.map((e) => e.message).join("; ") });
  }

  const errosSenha = validaSenha(validacao.data.senha);
  if (errosSenha.length > 0) {
    return res.status(400).json({ erro: errosSenha.join("; ") });
  }

  const { nome, email, celular, cpf, nascimento, senha } = validacao.data;
  const codigo = gerarCodigoVerificacao();
  const hash = bcrypt.hashSync(senha, 12);

  try {
    const novo = await prisma.usuario.create({
      data: {
        nome,
        email,
        celular,
        cpf,
        nascimento: new Date(nascimento),
        senha: hash,
        tipo: TipoUsuario.CLIENTE,
        verificado: false,
        codigoEmail: codigo,
      },
      select: { id: true, email: true }, // só o necessário
    });

    try {
      await enviarCodigoEmail(email, codigo);
    } catch (e) {
      await prisma.usuario.delete({ where: { id: novo.id } });
      return res.status(500).json({ erro: "Erro ao enviar email de verificação" });
    }

    return res
      .status(201)
      .json({ mensagem: "Código enviado. Verifique seu e-mail para validar." });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({ erro: "E-mail ou CPF já cadastrado" });
    }
    console.error(error);
    return res.status(500).json({ erro: "Erro ao registrar" });
  }
});

// POST /clientes/validar-email (checa só clientes)
router.post("/validar-email", async (req, res) => {
  const { email, codigo } = req.body;
  if (!email || !codigo) {
    return res.status(400).json({ erro: "E-mail e código são obrigatórios" });
  }

  try {
    const cliente = await prisma.usuario.findFirst({
      where: { email, tipo: TipoUsuario.CLIENTE },
    });

    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado" });
    if (cliente.verificado) return res.status(400).json({ erro: "E-mail já foi verificado" });
    if (cliente.codigoEmail !== codigo) return res.status(400).json({ erro: "Código inválido" });

    await prisma.usuario.update({
      where: { id: cliente.id },
      data: { verificado: true, codigoEmail: null },
    });

    return res.json({ mensagem: "E-mail verificado com sucesso!" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao verificar e-mail" });
  }
});

/** -----------------------------
 * Protegidos
 * ----------------------------- */

// GET /clientes -> SOMENTE ADMIN
router.get("/", verificarToken, requireAdmin, async (req, res) => {
  try {
    const { nome, tipos } = req.query as { nome?: string; tipos?: string };

    const whereNome = nome
      ? { nome: { contains: String(nome), mode: "insensitive" as const } }
      : {};

    let whereTipos = {};
    if (tipos) {
      const lista = tipos
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as (keyof typeof TipoUsuario)[];
      if (lista.length) whereTipos = { tipo: { in: lista as unknown as TipoUsuario[] } };
    }

    const usuarios = await prisma.usuario.findMany({
      where: { ...whereNome, ...whereTipos },
      orderBy: { nome: "asc" },
      ...(nome ? { take: 10 } : {}),
      select: baseUserSelect,
    });

    return res.json(usuarios);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

// GET /clientes/:id -> DONO OU ADMIN
router.get("/:id", verificarToken, requireSelfOrAdminParam("id"), async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.params.id },
      select: baseUserSelect,
    });

    if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado" });
    return res.json(usuario);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar usuário" });
  }
});

// PATCH /clientes/:id -> DONO OU ADMIN
const updateSelfSchema = z.object({
  nome: z.string().min(3).optional(),
  celular: z.string().min(10).optional(),
  nascimento: z.string().optional(), // será validada se vier
});
const updateAdminSchema = updateSelfSchema.extend({
  tipo: z.nativeEnum(TipoUsuario).optional(),
  verificado: z.boolean().optional(),
});

router.patch("/:id", verificarToken, requireSelfOrAdminParam("id"), async (req, res) => {
  try {
    const admin = isAdmin(req.usuario?.usuarioLogadoTipo);

    const parsed = (admin ? updateAdminSchema : updateSelfSchema).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.errors.map((e) => e.message).join("; ") });
    }

    const data: any = { ...parsed.data };
    if (data.nascimento) {
      const d = new Date(data.nascimento);
      if (!isValid(d)) return res.status(400).json({ erro: "Data de nascimento inválida" });
      data.nascimento = d;
    }

    // Obs: email/cpf/senha idealmente têm fluxos próprios.
    const atualizado = await prisma.usuario.update({
      where: { id: req.params.id },
      data,
      select: baseUserSelect,
    });

    return res.json(atualizado);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao atualizar usuário" });
  }
});

// DELETE /clientes/:id -> SOMENTE ADMIN (self-delete: se quiser, a gente habilita depois)
router.delete("/:id", verificarToken, requireAdmin, async (req, res) => {
  try {
    await prisma.usuario.delete({ where: { id: req.params.id } });
    return res.json({ mensagem: "Usuário excluído com sucesso" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao excluir usuário" });
  }
});

export default router;
