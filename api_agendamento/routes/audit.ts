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
  const agQuadraByAgId = new Map<
    string,
    { id: string; nome: string | null; numero: number | null }
  >();
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
  const agPermQuadraByAgId = new Map<
    string,
    { id: string; nome: string | null; numero: number | null }
  >();
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
    const mdToId =
      rawMd.toOwnerId ?? rawMd.paraDonoId ?? rawMd.transferToId ?? rawMd.novoUsuarioId ?? null;

    const donoNome =
      rawMd.donoNome ?? (rawMd.donoId ? usersMap.get(String(rawMd.donoId)) || null : null);
    const transferFromNome =
      rawMd.transferFromNome ?? (mdFromId ? usersMap.get(String(mdFromId)) || null : null);
    const transferToNome =
      rawMd.transferToNome ?? (mdToId ? usersMap.get(String(mdToId)) || null : null);

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

// ✅ 2) COLE ESTE BLOCO dentro do routes/audit.ts
// 👉 Cole ANTES do router.get("/logs", ...)
// (pode colar logo acima do comentário do GET /audit/logs)

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

// ===================================================================================
// GET /audit/login-abuse
// MASTER ONLY (ADMIN_ATENDENTE bloqueado)
//
// Lista usuários que excederam X logins por hora (hora local SP) no período.
//
// Query:
//  - from=YYYY-MM-DD&to=YYYY-MM-DD  (opcional, use os dois juntos)
//  - days=1..3650                   (opcional, default 30) — não pode junto de from/to
//  - thresholdPerHour=number        (opcional, default 6)
//  - take=number                    (opcional, default 50; max 300)
//
// Exemplo:
//  /audit/login-abuse?days=30&thresholdPerHour=6
// ===================================================================================
router.get(
  "/login-abuse",
  verificarToken,
  requireAdmin,
  denyAtendente(),
  async (req, res) => {
    try {
      const qSchema = require("zod")
        .z
        .object({
          from: require("zod").z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: require("zod").z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          days: require("zod").z.coerce.number().int().min(1).max(3650).optional(),
          thresholdPerHour: require("zod").z.coerce.number().int().min(1).max(120).optional(),
          take: require("zod").z.coerce.number().int().min(1).max(300).optional(),
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

      /**
       * Estratégia:
       * 1) cria buckets por "hora local" (SP) via date_trunc('hour', createdAt AT TIME ZONE TZ)
       * 2) conta logins por (actorId, hora)
       * 3) filtra horas que excederam threshold (HAVING)
       * 4) agrega por usuário: maxPorHora, horasComExcesso, totalExcessLogins
       */
      const abuseRows = await prisma.$queryRaw<
        {
          actorId: string;
          maxPorHora: bigint;
          horasComExcesso: bigint;
          totalExcessLogins: bigint;
        }[]
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
          intervalo: { from: fromLocal, to: toLocal },
          tz: SP_TZ,
          thresholdPerHour,
          take,
          totalUsuariosSuspeitos: 0,
          items: [],
        });
      }

      // nomes dos usuários
      const users = await prisma.usuario.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, nome: true, email: true, tipo: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      // total de logins no período (por usuário) — ajuda a dar contexto
      const totals = await prisma.auditLog.groupBy({
        by: ["actorId"],
        where: {
          event: "LOGIN",
          actorId: { in: actorIds },
          createdAt: { gte: inicioUTC, lt: fimUTCExcl },
        },
        _count: { _all: true },
      });
      const totalMap = new Map(totals.map((t) => [String(t.actorId), t._count._all]));

      // top ips (opcional) - só para enriquecer a análise
      const topIps = await prisma.$queryRaw<
        { actorId: string; ip: string | null; total: bigint }[]
      >(Prisma.sql`
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
      `);

      const topIpsByActor = new Map<string, { ip: string | null; total: number }[]>();
      for (const r of topIps) {
        const arr = topIpsByActor.get(r.actorId) ?? [];
        arr.push({ ip: r.ip, total: Number(r.total) });
        topIpsByActor.set(r.actorId, arr);
      }

      // top userAgents (opcional)
      const topUAs = await prisma.$queryRaw<
        { actorId: string; userAgent: string | null; total: bigint }[]
      >(Prisma.sql`
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
      `);

      const topUAsByActor = new Map<string, { userAgent: string | null; total: number }[]>();
      for (const r of topUAs) {
        const arr = topUAsByActor.get(r.actorId) ?? [];
        arr.push({ userAgent: r.userAgent, total: Number(r.total) });
        topUAsByActor.set(r.actorId, arr);
      }

      const items = abuseRows.map((r) => {
        const u = userMap.get(r.actorId);
        const ips = (topIpsByActor.get(r.actorId) ?? []).slice(0, 3);
        const uas = (topUAsByActor.get(r.actorId) ?? []).slice(0, 2);

        return {
          userId: r.actorId,
          userName: u?.nome ?? null,
          userEmail: u?.email ?? null,
          userTipo: u?.tipo ?? null,

          totalLoginsPeriodo: totalMap.get(r.actorId) ?? 0,

          maxLoginsEmUmaHora: Number(r.maxPorHora),
          horasComExcesso: Number(r.horasComExcesso),
          totalLoginsNasHorasComExcesso: Number(r.totalExcessLogins),

          topIps: ips,
          topUserAgents: uas,
        };
      });

      return res.json({
        intervalo: { from: fromLocal, to: toLocal },
        tz: SP_TZ,
        thresholdPerHour,
        take,
        totalUsuariosSuspeitos: items.length,
        items,
      });
    } catch (e) {
      console.error("[audit] login-abuse error:", e);
      return res.status(500).json({ erro: "Falha ao gerar relatório de abuso de login." });
    }
  }
);


/**
 * GET /audit/logs
 * MASTER ONLY (ADMIN_ATENDENTE bloqueado)
 *
 * Filtros:
 *  - event, targetType, targetId, actorId
 *  - from, to
 *  - qUser  (nome/email/celular OU UUID)
 *  - page, size
 */
router.get("/logs", verificarToken, requireAdmin, denyAtendente(), async (req, res) => {
  try {
    const {
      event,
      targetType,
      targetId,
      actorId,
      from,
      to,
      page = "1",
      size = "50",
      qUser,
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const take = Math.min(300, Math.max(1, parseInt(String(size), 10) || 50));
    const skip = (pageNum - 1) * take;

    const where: any = {};

    if (event && event.trim()) {
      where.event = { contains: event.trim(), mode: "insensitive" };
    }
    if (actorId) where.actorId = String(actorId);
    if (targetId) where.targetId = String(targetId);

    if (targetType && Object.values(AuditTargetType).includes(targetType as AuditTargetType)) {
      where.targetType = targetType as AuditTargetType;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) {
        const d = from.length === 10 ? new Date(`${from}T00:00:00Z`) : new Date(from);
        where.createdAt.gte = d;
      }
      if (to) {
        const d = to.length === 10 ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
        where.createdAt.lte = d;
      }
    }

    // ====== qUser: busca total (ator, alvo e metadata por JSON path) ======
    if (qUser && qUser.trim().length > 0) {
      const q = qUser.trim();

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
