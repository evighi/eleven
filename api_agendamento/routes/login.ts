import jwt from "jsonwebtoken";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import verificarToken from "../middleware/authMiddleware";
import { z } from "zod";
import { requireAdmin } from "../middleware/acl";
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

const SP_TZ = process.env.TZ || "America/Sao_Paulo";

function localYMD(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // "YYYY-MM-DD"
}

// converte "dia local" (00:00 -03:00) para Date (UTC)
function localMidnightToUTCDate(ymd: string) {
  return new Date(`${ymd}T00:00:00-03:00`);
}

function addDaysLocal(ymd: string, days: number) {
  const d = new Date(`${ymd}T12:00:00-03:00`); // meio-dia local pra evitar rollover
  d.setUTCDate(d.getUTCDate() + days);
  return localYMD(d);
}


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
        // 👇 adicionados para bloqueio no login
        disabledAt: true,
        deletedAt: true,
      },
    });

    if (!usuario) {
      await logAudit({
        event: "LOGIN_FAIL",
        req,
        target: { type: TargetType.USUARIO },
        metadata: { reason: "user_not_found", email },
      });
      return res.status(404).json({ erro: "E-mail não cadastrado." });
    }

    // ❌ já excluído (soft delete)
    if (usuario.deletedAt) {
      await logAudit({
        event: "LOGIN_FAIL",
        req,
        actor: { id: usuario.id, name: usuario.nome, type: usuario.tipo },
        target: { type: TargetType.USUARIO, id: usuario.id },
        metadata: { reason: "account_deleted", email: usuario.email },
      });
      return res.status(403).json({
        erro: "Conta removida.",
        code: "ACCOUNT_DELETED",
      });
    }

    // 🔒 pendente de exclusão → bloqueia login e informa elegibilidade
    if (usuario.disabledAt) {
      const pendencia = await prisma.userDeletionQueue.findUnique({
        where: { usuarioId: usuario.id },
        select: { status: true, eligibleAt: true },
      });

      await logAudit({
        event: "LOGIN_FAIL",
        req,
        actor: { id: usuario.id, name: usuario.nome, type: usuario.tipo },
        target: { type: TargetType.USUARIO, id: usuario.id },
        metadata: { reason: "account_disabled", email: usuario.email },
      });

      return res.status(403).json({
        erro: "Conta pendente de exclusão.",
        code: "ACCOUNT_DISABLED",
        eligibleAt: pendencia?.eligibleAt ?? null,
        status: pendencia?.status ?? "PENDING",
      });
    }

    // 🔒 Auto-REENVIO se for CLIENTE **ou CLIENTE_APOIADO** e não verificado
    if (
      (usuario.tipo === TipoUsuario.CLIENTE ||
        usuario.tipo === TipoUsuario.CLIENTE_APOIADO) &&
      !usuario.verificado
    ) {
      try {
        const codigo = gerarCodigoVerificacao();
        const expira = new Date(Date.now() + 30 * 60 * 1000); // 30min

        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { codigoEmail: codigo, expiraEm: expira },
        });

        await enviarCodigoEmail(usuario.email, codigo);

        await logAudit({
          event: "LOGIN_FAIL",
          req,
          actor: { id: usuario.id, name: usuario.nome, type: usuario.tipo },
          target: { type: TargetType.USUARIO, id: usuario.id },
          metadata: {
            reason: "email_not_verified",
            email: usuario.email,
            resent: true,
          },
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
          metadata: {
            reason: "email_not_verified_resend_failed",
            email: usuario.email,
            resent: false,
          },
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
      secure: isProd,
      sameSite: "strict",
      // sameSite: "none",
      maxAge: COOKIE_MAX_AGE_MS,
      path: "/",
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    });

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

  await logAudit({
    event: "LOGOUT",
    req,
    actor: actorId ? { id: actorId, name: actorName, type: actorTipo } : undefined,
    target: { type: TargetType.USUARIO, id: actorId },
  });

  return res.json({ mensagem: "Logout realizado com sucesso" });
});

// 📊 Estatísticas de logins
// GET /login/estatisticas/logins/resumo?from=YYYY-MM-DD&to=YYYY-MM-DD (opcional)
// Requer ADMIN
router.get("/estatisticas/logins/resumo", verificarToken, requireAdmin, async (req, res) => {
  try {
    const qSchema = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).refine(
      (v) => (!v.from && !v.to) || (v.from && v.to),
      "Informe 'from' e 'to' juntos, ou não informe nenhum."
    );

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erro: "Parâmetros inválidos",
        detalhes: parsed.error.issues?.[0]?.message,
      });
    }

    const { from, to } = parsed.data;

    // intervalo padrão: "até hoje" (inclui hoje)
    const hojeLocal = localYMD(new Date());
    const amanhaLocal = addDaysLocal(hojeLocal, 1);
    const fimUTCExcl = localMidnightToUTCDate(amanhaLocal); // < amanhã 00:00 local

    const inicioUTC = from && to
      ? localMidnightToUTCDate(from) // >= from 00:00 local
      : undefined;

    const fimUTCExclCustom = from && to
      ? localMidnightToUTCDate(addDaysLocal(to, 1)) // < (to+1) 00:00 local
      : fimUTCExcl;

    // ⚠️ AJUSTE AQUI caso o model da auditoria tenha outro nome no seu Prisma:
    // exemplos comuns: prisma.auditLog, prisma.audit, prisma.auditoria, prisma.auditEvent...
    const logs = await prisma.auditLog.findMany({
      where: {
        event: "LOGIN",
        ...(inicioUTC ? { createdAt: { gte: inicioUTC, lt: fimUTCExclCustom } } : { createdAt: { lt: fimUTCExclCustom } }),
      },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // agrupa por dia local
    const map = new Map<string, number>();
    for (const l of logs) {
      const dia = localYMD(l.createdAt);
      map.set(dia, (map.get(dia) || 0) + 1);
    }

    const totalAteHoje = logs.length;
    const diasComLogin = map.size;
    const mediaPorDia = diasComLogin > 0 ? totalAteHoje / diasComLogin : 0;

    const detalhesPorDia = Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([data, total]) => ({ data, total }));

    return res.json({
      totalAteHoje,
      diasComLogin,
      mediaPorDia,
      detalhesPorDia,
      intervalo: from && to ? { from, to } : { ate: hojeLocal },
    });
  } catch (err) {
    console.error("Erro ao calcular estatísticas de logins:", err);
    return res.status(500).json({ erro: "Erro ao calcular estatísticas de logins" });
  }
});


export default router;
