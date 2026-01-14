// routes/delecoes.ts
import { Router } from "express";
import { PrismaClient, DeletionStatus, InteractionType } from "@prisma/client";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { denyAtendente } from "../middleware/atendenteFeatures";
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

// 🔒 tudo aqui exige login + ser ADMIN
router.use(verificarToken);
router.use(requireAdmin);

// ⛔ atendente NUNCA pode mexer com deleções (fila de exclusão / reabilitar usuário)
router.use(denyAtendente());

/**
 * Enriquecimento em lote das "últimas interações" para evitar N+1
 */
async function enrichLastInteractions(
  rows: Array<{
    lastInteractionType: InteractionType | null;
    lastInteractionId: string | null;
  }>
) {
  const comumIds: string[] = [];
  const permIds: string[] = [];
  const churrasIds: string[] = [];

  for (const r of rows) {
    if (!r.lastInteractionId || !r.lastInteractionType) continue;
    switch (r.lastInteractionType) {
      case "AG_COMUM":
        comumIds.push(r.lastInteractionId);
        break;
      case "AG_PERM":
        permIds.push(r.lastInteractionId);
        break;
      case "CHURRAS":
        churrasIds.push(r.lastInteractionId);
        break;
      default:
        break;
    }
  }

  const [comuns, perms, churras] = await Promise.all([
    comumIds.length
      ? prisma.agendamento.findMany({
          where: { id: { in: comumIds } },
          select: {
            id: true,
            data: true,
            horario: true,
            status: true,
            quadra: { select: { id: true, nome: true, numero: true } },
            esporte: { select: { id: true, nome: true } },
          },
        })
      : Promise.resolve([]),
    permIds.length
      ? prisma.agendamentoPermanente.findMany({
          where: { id: { in: permIds } },
          select: {
            id: true,
            diaSemana: true,
            horario: true,
            status: true,
            updatedAt: true,
            quadra: { select: { id: true, nome: true, numero: true } },
            esporte: { select: { id: true, nome: true } },
          },
        })
      : Promise.resolve([]),
    churrasIds.length
      ? prisma.agendamentoChurrasqueira.findMany({
          where: { id: { in: churrasIds } },
          select: {
            id: true,
            data: true,
            turno: true,
            status: true,
            churrasqueira: { select: { id: true, nome: true, numero: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const mapComum = new Map(comuns.map((a) => [a.id, a]));
  const mapPerm = new Map(perms.map((a) => [a.id, a]));
  const mapChurras = new Map(churras.map((a) => [a.id, a]));

  return (type: InteractionType | null, id: string | null) => {
    if (!type || !id) return null;
    if (type === "AG_COMUM") {
      const a = mapComum.get(id);
      if (!a) return null;
      return {
        type,
        id: a.id,
        resumo: {
          data: a.data,
          horario: a.horario,
          status: a.status,
          quadra: a.quadra
            ? { id: a.quadra.id, nome: a.quadra.nome, numero: a.quadra.numero }
            : null,
          esporte: a.esporte ? { id: a.esporte.id, nome: a.esporte.nome } : null,
        },
      };
    }
    if (type === "AG_PERM") {
      const a = mapPerm.get(id);
      if (!a) return null;
      return {
        type,
        id: a.id,
        resumo: {
          diaSemana: a.diaSemana,
          horario: a.horario,
          status: a.status,
          updatedAt: a.updatedAt,
          quadra: a.quadra
            ? { id: a.quadra.id, nome: a.quadra.nome, numero: a.quadra.numero }
            : null,
          esporte: a.esporte ? { id: a.esporte.id, nome: a.esporte.nome } : null,
        },
      };
    }
    if (type === "CHURRAS") {
      const a = mapChurras.get(id);
      if (!a) return null;
      return {
        type,
        id: a.id,
        resumo: {
          data: a.data,
          turno: a.turno,
          status: a.status,
          churrasqueira: a.churrasqueira
            ? {
                id: a.churrasqueira.id,
                nome: a.churrasqueira.nome,
                numero: a.churrasqueira.numero,
              }
            : null,
        },
      };
    }
    return null;
  };
}

/**
 * GET /delecoes/pendentes
 * Lista pendências de exclusão com a última interação enriquecida
 */
router.get("/pendentes", async (_req, res) => {
  try {
    const rows = await prisma.userDeletionQueue.findMany({
      where: { status: DeletionStatus.PENDING },
      orderBy: { eligibleAt: "asc" },
      include: {
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true,
            tipo: true,
            disabledAt: true,
            deletedAt: true,
          },
        },
        requestedBy: { select: { id: true, nome: true, email: true } },
      },
    });

    const build = await enrichLastInteractions(rows);

    const items = rows.map((r) => ({
      id: r.id,
      usuario: r.usuario,
      requestedBy: r.requestedBy ?? null,
      requestedAt: r.requestedAt,
      eligibleAt: r.eligibleAt,
      status: r.status,
      attempts: r.attempts,
      reason: r.reason,
      lastInteractionDate: r.lastInteractionDate,
      lastInteraction:
        r.lastInteractionType && r.lastInteractionId
          ? build(r.lastInteractionType, r.lastInteractionId)
          : null,
    }));

    return res.json(items);
  } catch (e) {
    console.error("[delecoes] pendentes error:", e);
    return res.status(500).json({ erro: "Falha ao listar exclusões pendentes." });
  }
});

/**
 * POST /delecoes/:usuarioId/desfazer
 * Cancela a exclusão pendente e reabilita o acesso do usuário (disabledAt = null)
 */
router.post("/:usuarioId/desfazer", async (req, res) => {
  const usuarioId = req.params.usuarioId;

  try {
    const pendencia = await prisma.userDeletionQueue.findUnique({
      where: { usuarioId },
      include: {
        usuario: { select: { id: true, nome: true, email: true, disabledAt: true } },
      },
    });

    if (!pendencia) {
      return res
        .status(404)
        .json({ erro: "Nenhuma pendência de exclusão encontrada para este usuário." });
    }
    if (pendencia.status !== DeletionStatus.PENDING) {
      return res
        .status(409)
        .json({ erro: `Não é possível desfazer: status atual = ${pendencia.status}` });
    }

    const agora = new Date();

    const [updQueue, updUser] = await prisma.$transaction([
      prisma.userDeletionQueue.update({
        where: { usuarioId },
        data: { status: DeletionStatus.CANCELLED, cancelledAt: agora },
        include: { requestedBy: { select: { id: true, nome: true, email: true } } },
      }),
      prisma.usuario.update({
        where: { id: usuarioId },
        data: { disabledAt: null }, // reabilita login
        select: { id: true, nome: true, email: true, disabledAt: true },
      }),
    ]);

    await logAudit({
      event: "USUARIO_UPDATE",
      req,
      target: { type: TargetType.USUARIO, id: usuarioId },
      metadata: {
        deletion_cancelled: true,
        queue_id: updQueue.id,
        cancelledAt: updQueue.cancelledAt,
      },
    });

    return res.json({
      mensagem: "Exclusão pendente cancelada e acesso reabilitado.",
      usuario: updUser,
      pendencia: {
        id: updQueue.id,
        status: updQueue.status,
        cancelledAt: updQueue.cancelledAt,
      },
    });
  } catch (e) {
    console.error("[delecoes] desfazer error:", e);
    return res.status(500).json({ erro: "Falha ao desfazer exclusão pendente." });
  }
});

export default router;
