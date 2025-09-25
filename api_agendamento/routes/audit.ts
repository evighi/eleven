// routes/audit.ts
import { Router } from "express";
import {
  PrismaClient,
  AuditTargetType,
} from "@prisma/client";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

/**
 * Faz o enrichment dos logs:
 * - Resolve actorName se não estiver salvo (via actorId -> Usuario.nome)
 * - Preenche metadata.donoNome quando houver metadata.donoId
 * - Para targetType:
 *    - USUARIO:   targetNameResolved (nome do próprio usuário)
 *    - AGENDAMENTO: targetOwnerId/targetOwnerName (dono do agendamento)
 *    - AGENDAMENTO_PERMANENTE: targetOwnerId/targetOwnerName
 *    - AGENDAMENTO_CHURRASQUEIRA: targetOwnerId/targetOwnerName
 *    - AGENDAMENTO_PERMANENTE_CHURRASQUEIRA: targetOwnerId/targetOwnerName
 *    - BLOQUEIO:  targetOwnerId/targetOwnerName (bloqueadoPor)
 */
async function enrichNamesForLogs(items: any[]) {
  if (!items.length) return items;

  // Coleta IDs relevantes
  const userIds = new Set<string>();
  const agendamentoIds: string[] = [];
  const agPermIds: string[] = [];
  const agChurrasIds: string[] = [];
  const agPermChurrasIds: string[] = [];
  const bloqueioIds: string[] = [];

  for (const it of items) {
    if (it.actorId) userIds.add(String(it.actorId));
    if (it?.metadata?.donoId) userIds.add(String(it.metadata.donoId));

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
        // outros tipos no futuro
        break;
    }
  }

  // 1) Busca usuários para mapear id->nome (ator, donoId, USUARIO target)
  let usersMap = new Map<string, string>();
  if (userIds.size > 0) {
    const users = await prisma.usuario.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, nome: true },
    });
    usersMap = new Map(users.map((u) => [u.id, u.nome]));
  }

  // 2) Busca donos por tipo de alvo e prepara mapas id->ownerId e id->ownerName
  const agOwnerById = new Map<string, { id: string; nome: string | null }>();
  if (agendamentoIds.length) {
    const rows = await prisma.agendamento.findMany({
      where: { id: { in: agendamentoIds } },
      select: { id: true, usuario: { select: { id: true, nome: true } }, usuarioId: true },
    });
    for (const r of rows) {
      const ownerId = r.usuario?.id ?? r.usuarioId ?? null;
      const ownerName = r.usuario?.nome ?? (ownerId ? usersMap.get(ownerId) ?? null : null);
      if (ownerId) agOwnerById.set(r.id, { id: ownerId, nome: ownerName });
    }
  }

  const agPermOwnerById = new Map<string, { id: string; nome: string | null }>();
  if (agPermIds.length) {
    const rows = await prisma.agendamentoPermanente.findMany({
      where: { id: { in: agPermIds } },
      select: { id: true, usuario: { select: { id: true, nome: true } }, usuarioId: true },
    });
    for (const r of rows) {
      const ownerId = r.usuario?.id ?? r.usuarioId ?? null;
      const ownerName = r.usuario?.nome ?? (ownerId ? usersMap.get(ownerId) ?? null : null);
      if (ownerId) agPermOwnerById.set(r.id, { id: ownerId, nome: ownerName });
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

  // 3) Monta resposta enriquecida
  return items.map((it) => {
    // actor
    const actorNameResolved =
      it.actorName || (it.actorId ? usersMap.get(String(it.actorId)) || null : null);

    // metadata.donoNome
    const metadata =
      it.metadata && typeof it.metadata === "object"
        ? {
            ...it.metadata,
            donoNome:
              it.metadata.donoNome ??
              (it.metadata.donoId ? usersMap.get(String(it.metadata.donoId)) || null : null),
          }
        : it.metadata;

    // target side
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
        // outros tipos: nada especial por enquanto
        break;
    }

    return {
      ...it,
      actorNameResolved,
      targetNameResolved,  // nome do próprio alvo quando USUARIO
      targetOwnerId,       // dono do alvo (quando aplicável)
      targetOwnerName,     // nome do dono (quando aplicável)
      metadata,
    };
  });
}

/**
 * GET /audit/logs
 * Admin-only. Filtros:
 *  - event: string (match parcial, case-insensitive)
 *  - targetType: AuditTargetType (USUARIO, AGENDAMENTO, ...)
 *  - targetId: string
 *  - actorId: string
 *  - from, to: ISO date (YYYY-MM-DD) ou ISO datetime
 *  - page: 1..N (default 1)
 *  - size: 1..200 (default 50)
 */
router.get(
  "/logs",
  verificarToken,
  requireAdmin, // só admin lista
  async (req, res) => {
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
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const take = Math.min(200, Math.max(1, parseInt(String(size), 10) || 50));
      const skip = (pageNum - 1) * take;

      const where: any = {};

      if (event && event.trim()) {
        where.event = { contains: event.trim(), mode: "insensitive" };
      }
      if (actorId) where.actorId = String(actorId);
      if (targetId) where.targetId = String(targetId);

      if (
        targetType &&
        Object.values(AuditTargetType).includes(targetType as AuditTargetType)
      ) {
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

      return res.json({
        page: pageNum,
        size: take,
        total,
        items,
      });
    } catch (e) {
      console.error("[audit] list error:", e);
      return res.status(500).json({ erro: "Falha ao listar logs de auditoria." });
    }
  }
);

export default router;
