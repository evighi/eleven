// routes/audit.ts
import { Router } from "express";
import { PrismaClient, AuditTargetType } from "@prisma/client";
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
