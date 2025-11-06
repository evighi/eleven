import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { isValid } from "date-fns";
import { enviarCodigoEmail } from "../utils/enviarEmail";
import { gerarCodigoVerificacao } from "../utils/gerarCodigo";
import { requestUserDeletion } from "../src/lib/userDeletion"; // topo do arquivo clientes.ts

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin, requireSelfOrAdminParam, isAdmin } from "../middleware/acl";

// 👇 Audit
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

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

// 👇 util: gera senha temporária forte quando admin não informar
function gerarSenhaTemporaria() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const all = upper + lower + nums;
  const pick = (src: string) => src[Math.floor(Math.random() * src.length)];
  // garante pelo menos 1 de cada
  const seed = [pick(upper), pick(lower), pick(nums)];
  while (seed.length < 10) seed.push(pick(all));
  // embaralha
  for (let i = seed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seed[i], seed[j]] = [seed[j], seed[i]];
  }
  return seed.join("");
}

/** =============== Públicos =============== */

// POST /clientes/registrar
router.post("/registrar", async (req, res) => {
  const validacao = clienteSchema.safeParse(req.body);
  if (!validacao.success) {
    return res
      .status(400)
      .json({ erro: validacao.error.errors.map((e) => e.message).join("; ") });
  }

  const errosSenha = validaSenha(validacao.data.senha);
  if (errosSenha.length > 0) return res.status(400).json({ erro: errosSenha.join("; ") });

  // normaliza e prepara dados
  const nome = validacao.data.nome.trim();
  const email = validacao.data.email.trim().toLowerCase();
  const celular = validacao.data.celular.trim();
  const cpf = validacao.data.cpf.trim();
  const nascimento = new Date(validacao.data.nascimento);
  const hash = bcrypt.hashSync(validacao.data.senha, 12);

  try {
    // 1) Checa e-mail previamente
    const existenteEmail = await prisma.usuario.findUnique({
      where: { email },
      select: { id: true, verificado: true, tipo: true, email: true },
    });

    if (existenteEmail) {
      // E-mail já usado
      if (existenteEmail.tipo === TipoUsuario.CLIENTE && !existenteEmail.verificado) {
        // Reenvia um novo código e retorna 202 (Accepted)
        const novoCodigo = gerarCodigoVerificacao();
        const expira = new Date(Date.now() + 30 * 60 * 1000); // 30min

        await prisma.usuario.update({
          where: { id: existenteEmail.id },
          data: { codigoEmail: novoCodigo, expiraEm: expira },
        });

        try {
          await enviarCodigoEmail(existenteEmail.email, novoCodigo);
        } catch (e) {
          return res.status(500).json({ erro: "Erro ao reenviar e-mail de verificação" });
        }

        return res.status(202).json({
          reenviado: true,
          mensagem:
            "Este e-mail já possui cadastro, mas ainda não foi verificado. Enviamos um novo código.",
        });
      }

      // Já verificado (ou não-cliente): conflito direto
      return res.status(409).json({ erro: "E-mail já cadastrado" });
    }

    // 2) Checa CPF previamente (evita depender só do P2002)
    const existenteCpf = await prisma.usuario.findFirst({
      where: { cpf },
      select: { id: true },
    });
    if (existenteCpf) {
      return res.status(409).json({ erro: "CPF já cadastrado" });
    }

    // 3) Cria usuário + envia código
    const codigo = gerarCodigoVerificacao();
    const expira = new Date(Date.now() + 30 * 60 * 1000); // 30min

    const novo = await prisma.usuario.create({
      data: {
        nome,
        email,
        celular,
        cpf,
        nascimento,
        senha: hash,
        tipo: TipoUsuario.CLIENTE,
        verificado: false,
        codigoEmail: codigo,
        expiraEm: expira,
      },
      select: { id: true, email: true, nome: true },
    });

    try {
      await enviarCodigoEmail(novo.email, codigo);
    } catch (e) {
      // rollback se falhar envio
      await prisma.usuario.delete({ where: { id: novo.id } });
      return res.status(500).json({ erro: "Erro ao enviar email de verificação" });
    }

    // 📝 AUDIT: cadastro de usuário (ator = próprio usuário recém-criado)
    await logAudit({
      event: "USUARIO_CREATE",
      req,
      actor: { id: novo.id, name: nome, type: "CLIENTE" },
      target: { type: TargetType.USUARIO, id: novo.id },
      metadata: {
        email,
        celular,
        cpf,
        verificado: false,
      },
    });

    return res
      .status(201)
      .json({ mensagem: "Código enviado. Verifique seu e-mail para validar." });
  } catch (error: any) {
    // fallback (ex.: corrida até o unique do banco)
    if (error?.code === "P2002") {
      const target: string[] | undefined = (error as any)?.meta?.target;
      if (target?.some((t) => t.toLowerCase().includes("email"))) {
        return res.status(409).json({ erro: "E-mail já cadastrado" });
      }
      if (target?.some((t) => t.toLowerCase().includes("cpf"))) {
        return res.status(409).json({ erro: "CPF já cadastrado" });
      }
      return res.status(409).json({ erro: "E-mail ou CPF já cadastrado" });
    }
    console.error(error);
    return res.status(500).json({ erro: "Erro ao registrar" });
  }
});

// ================== ADMIN: criar usuário manual (pulando verificação) ==================
const adminCreateSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  senha: z.string().optional(), // se não vier, gera temporária
  tipo: z.nativeEnum(TipoUsuario).default(TipoUsuario.CLIENTE),
  celular: z.string().optional(),
  cpf: z.string().optional(),
  nascimento: z.string().optional(), // ISO date
  verificado: z.boolean().optional(), // default true
});

router.post("/admin/criar", verificarToken, requireAdmin, async (req, res) => {
  try {
    const data = adminCreateSchema.parse(req.body);

    const nome = data.nome.trim();
    const email = data.email.trim().toLowerCase();
    const celular = data.celular?.trim() || null;
    const cpf = data.cpf?.trim() || null;

    let nascimento: Date | null = null;
    if (data.nascimento) {
      const n = new Date(data.nascimento);
      if (!isValid(n)) return res.status(400).json({ erro: "Data de nascimento inválida" });
      nascimento = n;
    }

    // conflitos
    const emailExist = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (emailExist) return res.status(409).json({ erro: "E-mail já cadastrado" });

    if (cpf) {
      const cpfExist = await prisma.usuario.findFirst({ where: { cpf }, select: { id: true } });
      if (cpfExist) return res.status(409).json({ erro: "CPF já cadastrado" });
    }

    // senha: usa a informada ou gera
    const senhaFinal = data.senha?.trim() || gerarSenhaTemporaria();
    const errosSenha = validaSenha(senhaFinal);
    if (errosSenha.length > 0) {
      return res.status(400).json({ erro: `Senha inválida: ${errosSenha.join("; ")}` });
    }
    const hash = bcrypt.hashSync(senhaFinal, 12);

    const novo = await prisma.usuario.create({
      data: {
        nome,
        email,
        celular: celular || undefined,
        cpf: cpf || undefined,
        nascimento: nascimento || undefined,
        senha: hash,
        tipo: data.tipo,
        verificado: data.verificado ?? true, // 👈 já vem verificado
        // 👇 não cria código de verificação
        codigoEmail: null,
        expiraEm: null,
      },
      select: baseUserSelect,
    });

    // 📝 AUDIT: criação manual por admin
    await logAudit({
      event: "USUARIO_CREATE_ADMIN",
      req,
      actor: {
        id: req.usuario?.usuarioLogadoId,
        name: req.usuario?.usuarioLogadoNome,
        type: req.usuario?.usuarioLogadoTipo,
      },
      target: { type: TargetType.USUARIO, id: novo.id },
      metadata: {
        tipo: novo.tipo,
        verificado: novo.verificado,
        via: "ADMIN_MANUAL",
      },
    });

    return res.status(201).json({
      mensagem: "Usuário criado com sucesso",
      usuario: novo,
      // retorna senha temporária apenas na resposta de criação
      senhaTemporaria: data.senha ? undefined : senhaFinal,
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const target: string[] | undefined = (error as any)?.meta?.target;
      if (target?.some((t) => t.toLowerCase().includes("email"))) {
        return res.status(409).json({ erro: "E-mail já cadastrado" });
      }
      if (target?.some((t) => t.toLowerCase().includes("cpf"))) {
        return res.status(409).json({ erro: "CPF já cadastrado" });
      }
      return res.status(409).json({ erro: "E-mail ou CPF já cadastrado" });
    }
    if (error?.issues) {
      return res.status(400).json({ erro: error.issues.map((i: any) => i.message).join("; ") });
    }
    console.error(error);
    return res.status(500).json({ erro: "Erro ao criar usuário" });
  }
});

// POST /clientes/validar-email
router.post("/validar-email", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const codigo = String(req.body?.codigo || "").trim();

  if (!email || !codigo) return res.status(400).json({ erro: "E-mail e código são obrigatórios" });

  try {
    const cliente = await prisma.usuario.findFirst({
      where: { email, tipo: TipoUsuario.CLIENTE },
      select: { id: true, verificado: true, codigoEmail: true, expiraEm: true },
    });

    if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado" });
    if (cliente.verificado) return res.status(400).json({ erro: "E-mail já foi verificado" });

    if (!cliente.codigoEmail || cliente.codigoEmail !== codigo) {
      return res.status(400).json({ erro: "Código inválido" });
    }

    if (!cliente.expiraEm || new Date() > cliente.expiraEm) {
      return res.status(400).json({ erro: "Código expirado. Solicite reenvio." });
    }

    await prisma.usuario.update({
      where: { id: cliente.id },
      data: { verificado: true, codigoEmail: null, expiraEm: null },
    });

    return res.json({ mensagem: "E-mail verificado com sucesso!" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao verificar e-mail" });
  }
});

// (Opcional) POST /clientes/reenviar-codigo
router.post("/reenviar-codigo", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ erro: "E-mail inválido" });

  try {
    const user = await prisma.usuario.findUnique({
      where: { email },
      select: { id: true, verificado: true, tipo: true, email: true },
    });

    // responde sempre OK para não vazar existência
    if (!user || user.verificado || user.tipo !== "CLIENTE") {
      return res.json({ ok: true, mensagem: "Se existir conta, reenvio efetuado." });
    }

    const codigo = gerarCodigoVerificacao();
    const expira = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.usuario.update({
      where: { id: user.id },
      data: { codigoEmail: codigo, expiraEm: expira },
    });

    await enviarCodigoEmail(user.email, codigo);
    return res.json({ ok: true, mensagem: "Código reenviado." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Falha ao reenviar código" });
  }
});

/** =============== Protegidos =============== */

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

const updateSelfSchema = z.object({
  nome: z.string().min(3).optional(),
  celular: z.string().min(10).optional(),
  nascimento: z.string().optional(),
});
const updateAdminSchema = updateSelfSchema.extend({
  tipo: z.nativeEnum(TipoUsuario).optional(),
  verificado: z.boolean().optional(),
});

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

// ================== ADMIN: alterar e-mail (sem nova verificação) ==================
const updateEmailSchema = z.object({
  email: z.string().email(),
});

router.patch("/:id/email", verificarToken, requireAdmin, async (req, res) => {
  try {
    const { email } = updateEmailSchema.parse(req.body);
    const newEmail = email.trim().toLowerCase();

    // 1) Usuário alvo existe?
    const alvo = await prisma.usuario.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, nome: true, tipo: true, verificado: true },
    });
    if (!alvo) return res.status(404).json({ erro: "Usuário não encontrado" });

    // 2) Se é o mesmo e-mail, apenas retorna
    if (alvo.email.toLowerCase() === newEmail) {
      return res.json({
        mensagem: "E-mail já está definido com esse valor",
        usuario: { ...alvo, email: newEmail },
      });
    }

    // 3) Verifica conflito
    const conflito = await prisma.usuario.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (conflito && conflito.id !== alvo.id) {
      return res.status(409).json({ erro: "E-mail já cadastrado por outro usuário" });
    }

    // 4) Atualiza apenas o e-mail (sem mexer em 'verificado', sem códigos)
    const atualizado = await prisma.usuario.update({
      where: { id: alvo.id },
      data: { email: newEmail },
      select: baseUserSelect,
    });

    // 📝 AUDIT: alteração de e-mail por admin
    await logAudit({
      event: "USUARIO_UPDATE",
      req,
      actor: {
        id: req.usuario?.usuarioLogadoId,
        name: req.usuario?.usuarioLogadoNome,
        type: req.usuario?.usuarioLogadoTipo,
      },
      target: { type: TargetType.USUARIO, id: alvo.id },
      metadata: {
        email_antigo: alvo.email,
        email_novo: newEmail,
        tipo: alvo.tipo,
        verificado_antes: alvo.verificado,
        verificado_depois: atualizado.verificado,
      },
    });

    return res.json({ mensagem: "E-mail atualizado com sucesso", usuario: atualizado });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({ erro: "E-mail já cadastrado" });
    }
    if (error?.issues) {
      return res.status(400).json({ erro: error.issues.map((i: any) => i.message).join("; ") });
    }
    console.error(error);
    return res.status(500).json({ erro: "Erro ao atualizar e-mail" });
  }
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

router.delete("/:id", verificarToken, requireAdmin, async (req, res) => {
  try {
    const usuarioId = req.params.id;
    const requestedById = req.usuario?.usuarioLogadoId ?? null;

    const result = await requestUserDeletion(usuarioId, requestedById);

    if (!result.ok) {
      return res.status(result.code || 400).json({ erro: result.message || "Não foi possível excluir" });
    }

    // deletou agora (e estava elegível)
    if ((result as any).deletedNow) {
      return res.status(204).send();
    }

    // enfileirou (pendente)
    if ((result as any).queued) {
      const { eligibleAt, lastInteraction } = result as any;
      return res.status(202).json({
        mensagem:
          "Usuário possui interação recente. Exclusão ficará pendente até completar 90 dias da última interação.",
        eligibleAt,
        lastInteraction,
      });
    }

    // fallback
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao excluir usuário" });
  }
});

export default router;
