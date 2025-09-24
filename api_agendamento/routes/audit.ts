// routes/audit.ts
import { Router } from "express";
import { PrismaClient, AuditTargetType } from "@prisma/client";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

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

      if (targetType && Object.values(AuditTargetType).includes(targetType as AuditTargetType)) {
        where.targetType = targetType as AuditTargetType;
      }

      if (from || to) {
        where.createdAt = {};
        if (from) {
          // aceita "YYYY-MM-DD" ou ISO completo
          const d = from.length === 10 ? new Date(`${from}T00:00:00Z`) : new Date(from);
          where.createdAt.gte = d;
        }
        if (to) {
          const d = to.length === 10 ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
          where.createdAt.lte = d;
        }
      }

      const [items, total] = await Promise.all([
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
