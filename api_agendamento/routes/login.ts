import jwt from "jsonwebtoken";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router } from "express";
import bcrypt from "bcrypt";

// ➕ utilitários já existentes no projeto
import { enviarCodigoEmail } from "../utils/enviarEmail";
import { gerarCodigoVerificacao } from "../utils/gerarCodigo";

// 🆕 audit
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

const JWT_KEY = process.env.JWT_KEY as string;
const isProd = process.env.NODE_ENV === "production";

/**
 * ✅ Sessão de 60 dias
 * Se quiser usar outro prazo, mude SESSION_DAYS.
 * Opcional: defina COOKIE_DOMAIN=.seu-dominio.com.br para compartilhar entre subdomínios.
 */
const SESSION_DAYS = 60;
const JWT_EXPIRES_IN = `${SESSION_DAYS}d`;
const COOKIE_MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN; // ex.: ".elevensportsoficial.com.br" (opcional)

router.post("/", async (req, res) => {
  try {
    let { email, senha } = req.body as { email?: string; senha?: string };

    if (!email || !senha) {
      // Falha por body inválido
      await logAudit({
        event: "LOGIN_FAIL",
        req,
        target: { type: TargetType.USUARIO },
        metadata: { reason: "missing_email_or_password", email: String(email || "") },
      });
      return res.status(400).json({ erro: "Informe e-mail e senha." });
    }

    email = email.trim().toLowerCase();

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: {
        id: true,
        nome: true,
        email: true,
        senha: true,
        tipo: true,
        verificado: true,
      },
    });

    if (!usuario) {
      // Falha: usuário não encontrado
      await logAudit({
        event: "LOGIN_FAIL",
        req,
        target: { type: TargetType.USUARIO },
        metadata: { reason: "user_not_found", email },
      });
      return res.status(404).json({ erro: "E-mail não cadastrado." });
    }

    // 🔒 Auto-REENVIO se for CLIENTE e não verificado
    if (usuario.tipo === TipoUsuario.CLIENTE && !usuario.verificado) {
      try {
        const codigo = gerarCodigoVerificacao();
        const expira = new Date(Date.now() + 30 * 60 * 1000); // 30min

        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { codigoEmail: codigo, expiraEm: expira },
        });

        await enviarCodigoEmail(usuario.email, codigo);

        // Loga como falha de login por e-mail não verificado (com actor conhecido)
        await logAudit({
          event: "LOGIN_FAIL",
          req,
          actor: { id: usuario.id, name: usuario.nome, type: usuario.tipo },
          target: { type: TargetType.USUARIO, id: usuario.id },
          metadata: { reason: "email_not_verified", email: usuario.email, resent: true },
        });

        return res.status(403).json({
          erro: "E-mail não confirmado. Enviamos um novo código para o seu e-mail.",
          code: "EMAIL_NAO_CONFIRMADO",
          resent: true,
        });
      } catch (e) {
        console.error("Falha no auto-reenvio:", e);

        await logAudit({
          event: "LOGIN_FAIL",
          req,
          actor: { id: usuario.id, name: usuario.nome, type: usuario.tipo },
          target: { type: TargetType.USUARIO, id: usuario.id },
          metadata: { reason: "email_not_verified_resend_failed", email: usuario.email, resent: false },
        });

        return res.status(403).json({
          erro:
            "E-mail não confirmado. Não foi possível reenviar o código agora, tente novamente.",
          code: "EMAIL_NAO_CONFIRMADO",
          resent: false,
        });
      }
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) {
      // Falha: senha incorreta
      await logAudit({
        event: "LOGIN_FAIL",
        req,
        actor: { id: usuario.id, name: usuario.nome, type: usuario.tipo },
        target: { type: TargetType.USUARIO, id: usuario.id },
        metadata: { reason: "invalid_password", email: usuario.email },
      });
      return res.status(401).json({ erro: "Senha incorreta." });
    }

    // 🔑 JWT válido por 60 dias
    const token = jwt.sign(
      {
        usuarioLogadoId: usuario.id,
        usuarioLogadoNome: usuario.nome,
        usuarioLogadoTipo: usuario.tipo,
      },
      JWT_KEY,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // 🍪 Cookie httpOnly persistido por 60 dias no dispositivo
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProd,           // true em produção (HTTPS)
      sameSite: "strict",       // se front e API estiverem em domínios diferentes, use "none"
      // sameSite: "none",
      maxAge: COOKIE_MAX_AGE_MS,
      path: "/",
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    });

    // Loga sucesso
    await logAudit({
      event: "LOGIN",
      req,
      actor: { id: usuario.id, name: usuario.nome, type: usuario.tipo },
      target: { type: TargetType.USUARIO, id: usuario.id },
      metadata: { email: usuario.email, method: "password" },
    });

    return res.status(200).json({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tipo: usuario.tipo,
    });
  } catch (error) {
    console.error("Erro no login:", error);

    // (Opcional) Logar erro interno de login — categorizando como falha
    await logAudit({
      event: "LOGIN_FAIL",
      req,
      target: { type: TargetType.USUARIO },
      metadata: { reason: "internal_error" },
    });

    return res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

router.post("/logout", async (req, res) => {
  // tenta identificar o actor a partir do cookie/header (essa rota não usa auth middleware)
  let actorId: string | undefined;
  let actorName: string | undefined;
  let actorTipo: string | undefined;

  try {
    const bearer = req.headers["authorization"]?.split(" ")[1];
    const cookieTok = (req as any)?.cookies?.auth_token as string | undefined;
    const tok = bearer || cookieTok;
    if (tok) {
      const decoded: any = jwt.verify(tok, JWT_KEY);
      actorId = decoded?.usuarioLogadoId;
      actorName = decoded?.usuarioLogadoNome;
      actorTipo = decoded?.usuarioLogadoTipo;
    }
  } catch {
    // token inválido/ausente — segue o fluxo mesmo assim
  }

  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    // sameSite: "none",
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  });

  // Loga logout (com ou sem actor identificado)
  await logAudit({
    event: "LOGOUT",
    req,
    actor: actorId ? { id: actorId, name: actorName, type: actorTipo } : undefined,
    target: { type: TargetType.USUARIO, id: actorId },
  });

  return res.json({ mensagem: "Logout realizado com sucesso" });
});

export default router;
