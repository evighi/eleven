// routes/bloqueios.ts
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { startOfDay, endOfDay } from "date-fns";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit";

const router = Router();
const prisma = new PrismaClient();

// 🔒 tudo aqui exige login + ser ADMIN
router.use(verificarToken);
router.use(requireAdmin);

// helpers
const horaRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const bloqueioSchema = z.object({
  quadraIds: z.array(z.string().uuid()).nonempty("Selecione ao menos 1 quadra"),
  dataBloqueio: z.coerce.date(),
  inicioBloqueio: z.string().regex(horaRegex, "Hora inicial inválida (HH:MM)"),
  fimBloqueio: z.string().regex(horaRegex, "Hora final inválida (HH:MM)"),
  // 👇 motivoId opcional (palavra-chave cadastrada)
  motivoId: z.string().uuid().optional().nullable(),
});

// 👇 Helper igual ao que você usa em disponibilidadeGeral:
//    recebe "YYYY-MM-DD" e monta o range [início,fim) em UTC
function getUtcDayRange(dateStr: string) {
  const base = dateStr.slice(0, 10);
  const inicio = new Date(`${base}T00:00:00.000Z`);
  const fim = new Date(`${base}T00:00:00.000Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

router.post("/", async (req, res) => {
  const parsed = bloqueioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const {
    quadraIds,
    dataBloqueio,
    inicioBloqueio,
    fimBloqueio,
    motivoId,
  } = parsed.data;

  // valida janela de horário
  if (inicioBloqueio >= fimBloqueio) {
    return res
      .status(400)
      .json({ erro: "Hora inicial deve ser menor que a final" });
  }

  // id do usuário logado (não confiar no body)
  const bloqueadoPorId = req.usuario!.usuarioLogadoId;

  try {
    const dataInicio = startOfDay(dataBloqueio);
    const dataFim = endOfDay(dataBloqueio);

    // (opcional) garantir IDs únicos
    const uniqueQuadraIds = Array.from(new Set(quadraIds));

    // Verifica conflitos com agendamentos COMUNS confirmados
    for (const quadraId of uniqueQuadraIds) {
      const conflitoComum = await prisma.agendamento.findFirst({
        where: {
          quadraId,
          status: "CONFIRMADO",
          data: { gte: dataInicio, lte: dataFim },
          horario: { gte: inicioBloqueio, lt: fimBloqueio },
        },
        select: { id: true },
      });

      if (conflitoComum) {
        return res.status(409).json({
          erro: `Não é possível bloquear a quadra ${quadraId}: conflito com agendamento comum confirmado.`,
        });
      }

      // (Opcional) também considerar permanentes, caso queira
    }

    const bloqueioCriado = await prisma.bloqueioQuadra.create({
      data: {
        dataBloqueio,
        inicioBloqueio,
        fimBloqueio,
        bloqueadoPorId,
        motivoId: motivoId ?? null,
        quadras: { connect: uniqueQuadraIds.map((id) => ({ id })) },
      },
      include: {
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true, descricao: true } },
      },
    });

    // 📝 AUDIT: BLOQUEIO_CREATE
    await logAudit({
      event: "BLOQUEIO_CREATE",
      req,
      target: { type: TargetType.QUADRA, id: bloqueioCriado.id },
      metadata: {
        bloqueioId: bloqueioCriado.id,
        dataBloqueio: bloqueioCriado.dataBloqueio.toISOString().slice(0, 10),
        inicioBloqueio: bloqueioCriado.inicioBloqueio,
        fimBloqueio: bloqueioCriado.fimBloqueio,
        bloqueadoPorId,
        motivoId: bloqueioCriado.motivoId ?? null,
        motivoNome: bloqueioCriado.motivo?.nome ?? null,
        quadras: bloqueioCriado.quadras.map((q) => ({
          id: q.id,
          nome: q.nome,
          numero: q.numero,
        })),
      },
    });

    return res.status(201).json({
      mensagem: "Bloqueio criado com sucesso",
      bloqueio: bloqueioCriado,
    });
  } catch (error: any) {
    // Quadra inexistente -> P2025
    if (error?.code === "P2025") {
      return res
        .status(404)
        .json({ erro: "Uma ou mais quadras não foram encontradas" });
    }

    // FK de motivo inválido
    if (error?.code === "P2003" && String(error?.meta?.field_name || "").includes("motivoId")) {
      return res
        .status(400)
        .json({ erro: "Motivo de bloqueio inválido ou inexistente" });
    }

    console.error("Erro ao criar bloqueio:", error);
    return res
      .status(500)
      .json({ erro: "Erro interno ao tentar bloquear as quadras" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { motivoId, data } = req.query;

    const where: any = {};

    // 👇 filtro por motivo
    if (motivoId === "SEM_MOTIVO") {
      where.motivoId = null;
    } else if (typeof motivoId === "string" && motivoId.trim() !== "") {
      where.motivoId = motivoId;
    }

    // 👇 filtro por data (YYYY-MM-DD) usando range UTC [início, fim)
    if (typeof data === "string" && data.trim() !== "") {
      const dataStr = data.trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
        return res
          .status(400)
          .json({ erro: "Parâmetro 'data' inválido. Use o formato YYYY-MM-DD." });
      }

      const { inicio, fim } = getUtcDayRange(dataStr);
      where.dataBloqueio = {
        gte: inicio,
        lt: fim,
      };
    }

    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true, descricao: true } },
        motivoId: true,
      },
      orderBy: [
        { dataBloqueio: "desc" },
        { inicioBloqueio: "asc" },
        { createdAt: "desc" },
      ],
    });

    return res.json(bloqueios);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar bloqueios" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    // carrega antes para logar metadados
    const atual = await prisma.bloqueioQuadra.findUnique({
      where: { id: req.params.id },
      include: {
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true } },
      },
    });

    if (!atual) {
      return res.status(404).json({ erro: "Bloqueio não encontrado" });
    }

    await prisma.bloqueioQuadra.delete({ where: { id: req.params.id } });

    // 📝 AUDIT: BLOQUEIO_DELETE
    await logAudit({
      event: "BLOQUEIO_DELETE",
      req,
      target: { type: TargetType.QUADRA, id: req.params.id },
      metadata: {
        bloqueioId: req.params.id,
        dataBloqueio: atual.dataBloqueio.toISOString().slice(0, 10),
        inicioBloqueio: atual.inicioBloqueio,
        fimBloqueio: atual.fimBloqueio,
        motivoId: atual.motivoId ?? null,
        motivoNome: atual.motivo?.nome ?? null,
        quadras: atual.quadras.map((q) => ({
          id: q.id,
          nome: q.nome,
          numero: q.numero,
        })),
      },
    });

    return res.json({ mensagem: "Bloqueio removido com sucesso" });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return res.status(404).json({ erro: "Bloqueio não encontrado" });
    }
    console.error("Erro ao remover bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao remover bloqueio" });
  }
});

export default router;
