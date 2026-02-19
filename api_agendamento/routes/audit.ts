// routes/audit.ts
import { Router } from "express";
import { PrismaClient, AuditTargetType, Prisma } from "@prisma/client";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { denyAtendente } from "../middleware/atendenteFeatures"; // ✅ novo (MASTER only)

const prisma = new PrismaClient();
const router = Router();

/** ===== Enrichment (com fallback de quadra p/ agendamentos) ===== */
async function enrichNamesForLogs(items: any[]) {
  if (!items.length) return items;

  const userIds = new Set<string>();

  const agendamentoIds: string[] = [];
  const agPermIds: string[] = [];
  const agChurrasIds: string[] = [];
  const agPermChurrasIds: string[] = [];
  const bloqueioIds: string[] = [];

  const esporteIds = new Set<string>();
  const quadraIds = new Set<string>();

  for (const it of items) {
    if (it.actorId) userIds.add(String(it.actorId));
    if (it?.metadata?.donoId) userIds.add(String(it.metadata.donoId));

    const md = it?.metadata && typeof it.metadata === "object" ? it.metadata : {};
    const fromId = md.fromOwnerId ?? md.deDonoId ?? md.transferFromId ?? null;
    const toId = md.toOwnerId ?? md.paraDonoId ?? md.transferToId ?? md.novoUsuarioId ?? null;
    if (fromId) userIds.add(String(fromId));
    if (toId) userIds.add(String(toId));

    if (md.esporteId) esporteIds.add(String(md.esporteId));
    if (md.quadraId) quadraIds.add(String(md.quadraId));

    switch (it.targetType as AuditTargetType | null) {
      case "USUARIO":
        if (it.targetId) userIds.add(String(it.targetId));
        break;
      case "AGENDAMENTO":
        if (it.targetId) agendamentoIds.push(String(it.targetId));
        break;
      case "AGENDAMENTO_PERMANENTE":
        if (it.targetId) agPermIds.push(String(it.targetId));
        break;
      case "AGENDAMENTO_CHURRASQUEIRA":
        if (it.targetId) agChurrasIds.push(String(it.targetId));
        break;
      case "AGENDAMENTO_PERMANENTE_CHURRASQUEIRA":
        if (it.targetId) agPermChurrasIds.push(String(it.targetId));
        break;
      case "QUADRA":
        if (it.targetId) bloqueioIds.push(String(it.targetId));
        break;
      default:
        break;
    }
  }

  // 1) Usuários
  let usersMap = new Map<string, string>();
  if (userIds.size > 0) {
    const users = await prisma.usuario.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, nome: true },
    });
    usersMap = new Map(users.map((u) => [u.id, u.nome]));
  }

  // 2) Donos dos alvos + QUADRA dos agendamentos
  const agOwnerById = new Map<string, { id: string; nome: string | null }>();
  const agQuadraByAgId = new Map<string, { id: string; nome: string | null; numero: number | null }>();
  if (agendamentoIds.length) {
    const rows = await prisma.agendamento.findMany({
      where: { id: { in: agendamentoIds } },
      select: {
        id: true,
        usuario: { select: { id: true, nome: true } },
        usuarioId: true,
        quadra: { select: { id: true, nome: true, numero: true } },
        quadraId: true,
      },
    });
    for (const r of rows) {
      const ownerId = r.usuario?.id ?? r.usuarioId ?? null;
      const ownerName = r.usuario?.nome ?? (ownerId ? usersMap.get(ownerId) ?? null : null);
      if (ownerId) agOwnerById.set(r.id, { id: ownerId, nome: ownerName });

      if (r.quadra) {
        agQuadraByAgId.set(r.id, {
          id: r.quadra.id,
          nome: r.quadra.nome ?? null,
          numero: r.quadra.numero ?? null,
        });
        quadraIds.add(String(r.quadra.id));
      }
    }
  }

  const agPermOwnerById = new Map<string, { id: string; nome: string | null }>();
  const agPermQuadraByAgId = new Map<string, { id: string; nome: string | null; numero: number | null }>();
  if (agPermIds.length) {
    const rows = await prisma.agendamentoPermanente.findMany({
      where: { id: { in: agPermIds } },
      select: {
        id: true,
        usuario: { select: { id: true, nome: true } },
        usuarioId: true,
        quadra: { select: { id: true, nome: true, numero: true } },
        quadraId: true,
      },
    });
    for (const r of rows) {
      const ownerId = r.usuario?.id ?? r.usuarioId ?? null;
      const ownerName = r.usuario?.nome ?? (ownerId ? usersMap.get(ownerId) ?? null : null);
      if (ownerId) agPermOwnerById.set(r.id, { id: ownerId, nome: ownerName });

      if (r.quadra) {
        agPermQuadraByAgId.set(r.id, {
          id: r.quadra.id,
          nome: r.quadra.nome ?? null,
          numero: r.quadra.numero ?? null,
        });
        quadraIds.add(String(r.quadra.id));
      }
    }
  }

  const agChurrasOwnerById = new Map<string, { id: string; nome: string | null }>();
  if (agChurrasIds.length) {
    const rows = await prisma.agendamentoChurrasqueira.findMany({
      where: { id: { in: agChurrasIds } },
      select: { id: true, usuario: { select: { id: true, nome: true } }, usuarioId: true },
    });
    for (const r of rows) {
      const ownerId = r.usuario?.id ?? r.usuarioId ?? null;
      const ownerName = r.usuario?.nome ?? (ownerId ? usersMap.get(ownerId) ?? null : null);
      if (ownerId) agChurrasOwnerById.set(r.id, { id: ownerId, nome: ownerName });
    }
  }

  const agPermChurrasOwnerById = new Map<string, { id: string; nome: string | null }>();
  if (agPermChurrasIds.length) {
    const rows = await prisma.agendamentoPermanenteChurrasqueira.findMany({
      where: { id: { in: agPermChurrasIds } },
      select: { id: true, usuario: { select: { id: true, nome: true } }, usuarioId: true },
    });
    for (const r of rows) {
      const ownerId = r.usuario?.id ?? r.usuarioId ?? null;
      const ownerName = r.usuario?.nome ?? (ownerId ? usersMap.get(ownerId) ?? null : null);
      if (ownerId) agPermChurrasOwnerById.set(r.id, { id: ownerId, nome: ownerName });
    }
  }

  const bloqueioOwnerById = new Map<string, { id: string; nome: string | null }>();
  if (bloqueioIds.length) {
    const rows = await prisma.bloqueioQuadra.findMany({
      where: { id: { in: bloqueioIds } },
      select: { id: true, bloqueadoPor: { select: { id: true, nome: true } }, bloqueadoPorId: true },
    });
    for (const r of rows) {
      const ownerId = r.bloqueadoPor?.id ?? r.bloqueadoPorId ?? null;
      const ownerName = r.bloqueadoPor?.nome ?? (ownerId ? usersMap.get(ownerId) ?? null : null);
      if (ownerId) bloqueioOwnerById.set(r.id, { id: ownerId, nome: ownerName });
    }
  }

  // 3) Esportes e Quadras (IDs avulsos encontrados)
  let esportesMap = new Map<string, { nome: string }>();
  if (esporteIds.size > 0) {
    const esportes = await prisma.esporte.findMany({
      where: { id: { in: Array.from(esporteIds) } },
      select: { id: true, nome: true },
    });
    esportesMap = new Map(esportes.map((e) => [e.id, { nome: e.nome }]));
  }

  let quadrasMap = new Map<string, { nome: string; numero: number | null }>();
  if (quadraIds.size > 0) {
    const quadras = await prisma.quadra.findMany({
      where: { id: { in: Array.from(quadraIds) } },
      select: { id: true, nome: true, numero: true },
    });
    quadrasMap = new Map(quadras.map((q) => [q.id, { nome: q.nome, numero: q.numero ?? null }]));
  }

  // 4) Monta resposta enriquecida
  return items.map((it) => {
    const actorNameResolved =
      it.actorName || (it.actorId ? usersMap.get(String(it.actorId)) || null : null);

    const rawMd = it.metadata && typeof it.metadata === "object" ? it.metadata : {};

    const mdFromId = rawMd.fromOwnerId ?? rawMd.deDonoId ?? rawMd.transferFromId ?? null;
    const mdToId = rawMd.toOwnerId ?? rawMd.paraDonoId ?? rawMd.transferToId ?? rawMd.novoUsuarioId ?? null;

    const donoNome = rawMd.donoNome ?? (rawMd.donoId ? usersMap.get(String(rawMd.donoId)) || null : null);
    const transferFromNome = rawMd.transferFromNome ?? (mdFromId ? usersMap.get(String(mdFromId)) || null : null);
    const transferToNome = rawMd.transferToNome ?? (mdToId ? usersMap.get(String(mdToId)) || null : null);

    const esporteNome =
      rawMd.esporteNome ??
      (rawMd.esporteId ? esportesMap.get(String(rawMd.esporteId))?.nome ?? null : null);

    // 1º: tenta por metadata.quadraId
    const quadraInfo = rawMd.quadraId ? quadrasMap.get(String(rawMd.quadraId)) : null;
    let quadraNome = rawMd.quadraNome ?? (quadraInfo?.nome ?? null);
    let quadraNumero = rawMd.quadraNumero ?? (quadraInfo?.numero ?? null);

    // 2º: fallback pelo alvo do log (AGENDAMENTO / AGENDAMENTO_PERMANENTE)
    if ((!quadraNome || quadraNumero == null) && it.targetType === "AGENDAMENTO") {
      const q = it.targetId ? agQuadraByAgId.get(String(it.targetId)) : undefined;
      if (q) {
        if (!quadraNome) quadraNome = q.nome ?? quadraNome;
        if (quadraNumero == null) quadraNumero = q.numero ?? quadraNumero;
      }
    }
    if ((!quadraNome || quadraNumero == null) && it.targetType === "AGENDAMENTO_PERMANENTE") {
      const q = it.targetId ? agPermQuadraByAgId.get(String(it.targetId)) : undefined;
      if (q) {
        if (!quadraNome) quadraNome = q.nome ?? quadraNome;
        if (quadraNumero == null) quadraNumero = q.numero ?? quadraNumero;
      }
    }

    const metadata = {
      ...rawMd,
      donoNome,
      transferFromNome,
      transferToNome,
      esporteNome,
      quadraNome,
      quadraNumero,
    };

    let targetNameResolved: string | null = null;
    let targetOwnerId: string | null = null;
    let targetOwnerName: string | null = null;

    switch (it.targetType as AuditTargetType | null) {
      case "USUARIO":
        if (it.targetId) targetNameResolved = usersMap.get(String(it.targetId)) || null;
        break;
      case "AGENDAMENTO": {
        const info = it.targetId ? agOwnerById.get(String(it.targetId)) : undefined;
        targetOwnerId = info?.id ?? null;
        targetOwnerName = info?.nome ?? null;
        break;
      }
      case "AGENDAMENTO_PERMANENTE": {
        const info = it.targetId ? agPermOwnerById.get(String(it.targetId)) : undefined;
        targetOwnerId = info?.id ?? null;
        targetOwnerName = info?.nome ?? null;
        break;
      }
      case "AGENDAMENTO_CHURRASQUEIRA": {
        const info = it.targetId ? agChurrasOwnerById.get(String(it.targetId)) : undefined;
        targetOwnerId = info?.id ?? null;
        targetOwnerName = info?.nome ?? null;
        break;
      }
      case "AGENDAMENTO_PERMANENTE_CHURRASQUEIRA": {
        const info = it.targetId ? agPermChurrasOwnerById.get(String(it.targetId)) : undefined;
        targetOwnerId = info?.id ?? null;
        targetOwnerName = info?.nome ?? null;
        break;
      }
      case "QUADRA": {
        const info = it.targetId ? bloqueioOwnerById.get(String(it.targetId)) : undefined;
        targetOwnerId = info?.id ?? null;
        targetOwnerName = info?.nome ?? null;
        break;
      }
      default:
        break;
    }

    return {
      ...it,
      actorNameResolved,
      targetNameResolved,
      targetOwnerId,
      targetOwnerName,
      metadata,
    };
  });
}

/** util: detecta se string parece UUID */
function looksLikeUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

// ====== helpers de data (mesma ideia do seu login.ts) ======
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

// ✅ NOVO: converte "dia + hora local" para Date (UTC)
function localDayHourToUTCDate(day: string, hour: number) {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00-03:00`);
}

// ===================================================================================
// GET /audit/login-abuse
// MASTER ONLY (ADMIN_ATENDENTE bloqueado)
// ===================================================================================
router.get("/login-abuse", verificarToken, requireAdmin, denyAtendente(), async (req, res) => {
  try {
    const z = require("zod").z;

    const qSchema = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        days: z.coerce.number().int().min(1).max(3650).optional(),
        thresholdPerHour: z.coerce.number().int().min(1).max(120).optional(),
        take: z.coerce.number().int().min(1).max(300).optional(),
      })
      .refine(
        (v: any) => {
          const hasFromTo = !!v.from || !!v.to;
          if (hasFromTo) return !!v.from && !!v.to && !v.days; // from+to juntos e sem days
          return true;
        },
        "Use 'from' e 'to' juntos (sem 'days'), ou use apenas 'days', ou nenhum."
      );

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erro: "Parâmetros inválidos",
        detalhes: parsed.error.issues?.[0]?.message,
      });
    }

    const { from, to } = parsed.data as {
      from?: string;
      to?: string;
      days?: number;
      thresholdPerHour?: number;
      take?: number;
    };

    const days = parsed.data.days ?? 30;
    const thresholdPerHour = parsed.data.thresholdPerHour ?? 6;
    const take = parsed.data.take ?? 50;

    const hojeLocal = localYMD(new Date());
    const fromLocal = from ?? addDaysLocal(hojeLocal, -days + 1);
    const toLocal = to ?? hojeLocal;

    const inicioUTC = localMidnightToUTCDate(fromLocal);
    const fimUTCExcl = localMidnightToUTCDate(addDaysLocal(toLocal, 1)); // exclusivo

    const abuseRows = await prisma.$queryRaw<
      { actorId: string; maxPorHora: bigint; horasComExcesso: bigint; totalExcessLogins: bigint }[]
    >(Prisma.sql`
      WITH hourly AS (
        SELECT
          "actorId" AS "actorId",
          date_trunc('hour', ("createdAt" AT TIME ZONE ${SP_TZ})) AS "horaLocal",
          COUNT(*)::bigint AS "cnt"
        FROM "AuditLog"
        WHERE "event" = 'LOGIN'
          AND "actorId" IS NOT NULL
          AND "createdAt" >= ${inicioUTC}
          AND "createdAt" < ${fimUTCExcl}
        GROUP BY "actorId", "horaLocal"
      ),
      offenders AS (
        SELECT
          "actorId",
          "horaLocal",
          "cnt"
        FROM hourly
        WHERE "cnt" > ${thresholdPerHour}
      )
      SELECT
        "actorId",
        MAX("cnt")::bigint AS "maxPorHora",
        COUNT(*)::bigint AS "horasComExcesso",
        SUM("cnt")::bigint AS "totalExcessLogins"
      FROM offenders
      GROUP BY "actorId"
      ORDER BY "maxPorHora" DESC, "horasComExcesso" DESC
      LIMIT ${take}
    `);

    const actorIds = abuseRows.map((r) => r.actorId);

    if (actorIds.length === 0) {
      return res.json({
        periodo: { inicio: fromLocal, fim: toLocal, timezone: SP_TZ },
        regraDeteccao: {
          descricao:
            "Um usuário é considerado suspeito quando ultrapassa o limite de logins em pelo menos 1 hora dentro do período.",
          limiteDeLoginsPorHora: thresholdPerHour,
          observacao: "A contagem por hora considera a hora local.",
        },
        resumoGeral: { totalDeUsuariosSuspeitos: 0, limiteDeResultados: take },
        usuariosSuspeitos: [],
      });
    }

    const users = await prisma.usuario.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, nome: true, email: true, tipo: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const totals = await prisma.auditLog.groupBy({
      by: ["actorId"],
      where: { event: "LOGIN", actorId: { in: actorIds }, createdAt: { gte: inicioUTC, lt: fimUTCExcl } },
      _count: { _all: true },
    });
    const totalMap = new Map(totals.map((t) => [String(t.actorId), t._count._all]));

    const topIps = await prisma.$queryRaw<{ actorId: string; ip: string | null; total: bigint }[]>(
      Prisma.sql`
        SELECT
          "actorId" AS "actorId",
          "ip" AS "ip",
          COUNT(*)::bigint AS "total"
        FROM "AuditLog"
        WHERE "event" = 'LOGIN'
          AND "actorId" IN (${Prisma.join(actorIds)})
          AND "createdAt" >= ${inicioUTC}
          AND "createdAt" < ${fimUTCExcl}
        GROUP BY "actorId", "ip"
        ORDER BY "actorId" ASC, "total" DESC
      `
    );

    const topIpsByActor = new Map<string, { ip: string | null; total: number }[]>();
    for (const r of topIps) {
      const arr = topIpsByActor.get(r.actorId) ?? [];
      arr.push({ ip: r.ip, total: Number(r.total) });
      topIpsByActor.set(r.actorId, arr);
    }

    const topUAs = await prisma.$queryRaw<{ actorId: string; userAgent: string | null; total: bigint }[]>(
      Prisma.sql`
        SELECT
          "actorId" AS "actorId",
          "userAgent" AS "userAgent",
          COUNT(*)::bigint AS "total"
        FROM "AuditLog"
        WHERE "event" = 'LOGIN'
          AND "actorId" IN (${Prisma.join(actorIds)})
          AND "createdAt" >= ${inicioUTC}
          AND "createdAt" < ${fimUTCExcl}
        GROUP BY "actorId", "userAgent"
        ORDER BY "actorId" ASC, "total" DESC
      `
    );

    const topUAsByActor = new Map<string, { userAgent: string | null; total: number }[]>();
    for (const r of topUAs) {
      const arr = topUAsByActor.get(r.actorId) ?? [];
      arr.push({ userAgent: r.userAgent, total: Number(r.total) });
      topUAsByActor.set(r.actorId, arr);
    }

    const usuariosSuspeitos = abuseRows.map((r) => {
      const u = userMap.get(r.actorId);

      const ips = (topIpsByActor.get(r.actorId) ?? []).slice(0, 3);
      const uas = (topUAsByActor.get(r.actorId) ?? []).slice(0, 2);

      const totalLoginsPeriodo = totalMap.get(r.actorId) ?? 0;
      const picoPorHora = Number(r.maxPorHora);
      const horasAcimaDoLimite = Number(r.horasComExcesso);
      const loginsSomenteNasHorasAcimaDoLimite = Number(r.totalExcessLogins);

      const excessoEstimado = Math.max(
        0,
        loginsSomenteNasHorasAcimaDoLimite - horasAcimaDoLimite * thresholdPerHour
      );

      return {
        usuario: { id: r.actorId, nome: u?.nome ?? null, email: u?.email ?? null, tipo: u?.tipo ?? null },
        resumo: {
          totalLoginsNoPeriodo: totalLoginsPeriodo,
          maiorPicoDeLoginsEm1Hora: picoPorHora,
          quantidadeDeHorasAcimaDoLimite: horasAcimaDoLimite,
          totalDeLoginsNasHorasAcimaDoLimite: loginsSomenteNasHorasAcimaDoLimite,
          excessoEstimadoDeLogins: excessoEstimado,
        },
        sinais: {
          ipsMaisFrequentes: ips.map((x) => ({ ip: x.ip, totalLogins: x.total })),
          dispositivosMaisFrequentes: uas.map((x) => ({ userAgent: x.userAgent, totalLogins: x.total })),
        },
      };
    });

    return res.json({
      periodo: { inicio: fromLocal, fim: toLocal, timezone: SP_TZ },
      regraDeteccao: {
        descricao:
          "Um usuário é considerado suspeito quando ultrapassa o limite de logins em pelo menos 1 hora dentro do período.",
        limiteDeLoginsPorHora: thresholdPerHour,
        observacao: "A contagem por hora considera a hora local.",
      },
      resumoGeral: { totalDeUsuariosSuspeitos: usuariosSuspeitos.length, limiteDeResultados: take },
      usuariosSuspeitos,
    });
  } catch (e) {
    console.error("[audit] login-abuse error:", e);
    return res.status(500).json({ erro: "Falha ao gerar relatório de abuso de login." });
  }
});

/**
 * GET /audit/logs
 * MASTER ONLY (ADMIN_ATENDENTE bloqueado)
 *
 * Filtros:
 *  - event, targetType, targetId, actorId
 *  - day=YYYY-MM-DD (dia local SP)
 *  - hour=0..23 (janela de 1h, exige day)
 *  - from, to (alternativo — NÃO misturar com day/hour)
 *  - qUser  (nome/email/celular OU UUID)
 *  - page, size
 */
router.get("/logs", verificarToken, requireAdmin, denyAtendente(), async (req, res) => {
  try {
    const z = require("zod").z;

    const qSchema = z
      .object({
        event: z.string().optional(),
        targetType: z.string().optional(),
        targetId: z.string().optional(),
        actorId: z.string().optional(),
        qUser: z.string().optional(),

        // ✅ novos
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        hour: z.coerce.number().int().min(0).max(23).optional(),

        // antigos
        from: z.string().optional(),
        to: z.string().optional(),

        page: z.string().optional(),
        size: z.string().optional(),
      })
      .refine((v: any) => !(v.hour != null && !v.day), "Use 'hour' apenas junto com 'day'.")
      .refine((v: any) => !(v.day && (v.from || v.to)), "Use 'day' (e opcionalmente 'hour') OU 'from/to'. Não misture.");

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erro: "Parâmetros inválidos",
        detalhes: parsed.error.issues?.[0]?.message,
      });
    }

    const {
      event,
      targetType,
      targetId,
      actorId,
      from,
      to,
      day,
      hour,
      page = "1",
      size = "50",
      qUser,
    } = parsed.data as Record<string, any>;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const take = Math.min(300, Math.max(1, parseInt(String(size), 10) || 50));
    const skip = (pageNum - 1) * take;

    const where: any = {};

    if (event && String(event).trim()) {
      where.event = { contains: String(event).trim(), mode: "insensitive" };
    }
    if (actorId) where.actorId = String(actorId);
    if (targetId) where.targetId = String(targetId);

    if (targetType && Object.values(AuditTargetType).includes(targetType as AuditTargetType)) {
      where.targetType = targetType as AuditTargetType;
    }

    // ✅ NOVO: filtros por dia/hora (local SP) com range [gte, lt)
    if (day) {
      if (hour != null) {
        const inicioUTC = localDayHourToUTCDate(day, Number(hour));
        const fimUTCExcl = localDayHourToUTCDate(day, Number(hour) + 1);
        where.createdAt = { gte: inicioUTC, lt: fimUTCExcl };
      } else {
        const inicioUTC = localMidnightToUTCDate(day);
        const nextDay = addDaysLocal(day, 1);
        const fimUTCExcl = localMidnightToUTCDate(nextDay);
        where.createdAt = { gte: inicioUTC, lt: fimUTCExcl };
      }
    } else if (from || to) {
      // 🔁 mantém compatibilidade com from/to, mas agora com fim exclusivo quando for YYYY-MM-DD
      where.createdAt = {};
      if (from) {
        const d = String(from).length === 10 ? new Date(`${from}T00:00:00-03:00`) : new Date(from);
        where.createdAt.gte = d;
      }
      if (to) {
        if (String(to).length === 10) {
          const nextDay = addDaysLocal(String(to), 1);
          where.createdAt.lt = new Date(`${nextDay}T00:00:00-03:00`);
        } else {
          where.createdAt.lt = new Date(to);
        }
      }
    }

    // ====== qUser: busca total (ator, alvo e metadata por JSON path) ======
    if (qUser && String(qUser).trim().length > 0) {
      const q = String(qUser).trim();

      // Se o termo já for UUID, use direto; senão resolva por nome/email/celular
      let ids: string[] = [];
      if (looksLikeUUID(q)) {
        ids = [q];
      } else {
        const found = await prisma.usuario.findMany({
          where: {
            OR: [
              { nome: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { celular: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true },
          take: 2000,
        });
        ids = found.map((u) => u.id);
      }

      const orParts: any[] = [];

      // 1) Ator por id
      if (ids.length > 0) {
        orParts.push({ actorId: { in: ids } });

        // 2) Alvo do tipo USUARIO por id
        orParts.push({
          AND: [{ targetType: "USUARIO" as AuditTargetType }, { targetId: { in: ids } }],
        });

        // 3) Participações no METADATA (JSON path) — ids exatos
        const idJsonPaths = [
          ["donoId"],
          ["fromOwnerId"],
          ["deDonoId"],
          ["transferFromId"],
          ["toOwnerId"],
          ["paraDonoId"],
          ["transferToId"],
          ["novoUsuarioId"],
        ] as const;

        for (const uid of ids) {
          for (const p of idJsonPaths) {
            orParts.push({ metadata: { path: p as any, equals: uid } });
          }
          // Arrays usuais (se existirem na sua modelagem de metadata)
          orParts.push({ metadata: { path: ["jogadoresIds"], array_contains: uid } });
          orParts.push({ metadata: { path: ["usuariosIds"], array_contains: uid } });
        }
      }

      // 4) Fallback por nome salvo no log (compatibilidade)
      orParts.push({ actorName: { contains: q, mode: "insensitive" } });

      where.OR = orParts;
    }

    const [rawItems, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          event: true,
          actorId: true,
          actorName: true,
          actorTipo: true,
          targetType: true,
          targetId: true,
          ip: true,
          userAgent: true,
          metadata: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    const items = await enrichNamesForLogs(rawItems);

    return res.json({ page: pageNum, size: take, total, items });
  } catch (e) {
    console.error("[audit] list error:", e);
    return res.status(500).json({ erro: "Falha ao listar logs de auditoria." });
  }
});

export default router;
