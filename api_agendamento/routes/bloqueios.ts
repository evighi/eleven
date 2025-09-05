import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { startOfDay, endOfDay } from "date-fns";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";

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
});

router.post("/", async (req, res) => {
  const parsed = bloqueioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const { quadraIds, dataBloqueio, inicioBloqueio, fimBloqueio } = parsed.data;

  // valida janela de horário
  if (inicioBloqueio >= fimBloqueio) {
    return res.status(400).json({ erro: "Hora inicial deve ser menor que a final" });
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

      // TODO (se quiser): também considerar agendamentos permanentes que caiam nesse dia/horário
      // Ex.: checar regra que mapeia DiaSemana + horario -> dataBloqueio
    }

    const bloqueioCriado = await prisma.bloqueioQuadra.create({
      data: {
        dataBloqueio,
        inicioBloqueio,
        fimBloqueio,
        bloqueadoPorId,
        quadras: { connect: uniqueQuadraIds.map((id) => ({ id })) },
      },
      include: {
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
        quadras: { select: { id: true, nome: true, numero: true } },
      },
    });

    return res.status(201).json({
      mensagem: "Bloqueio criado com sucesso",
      bloqueio: bloqueioCriado,
    });
  } catch (error: any) {
    // Quadra inexistente -> P2025
    if (error?.code === "P2025") {
      return res.status(404).json({ erro: "Uma ou mais quadras não foram encontradas" });
    }
    console.error("Erro ao criar bloqueio:", error);
    return res.status(500).json({ erro: "Erro interno ao tentar bloquear as quadras" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      select: {
        id: true,
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
        quadras: { select: { id: true, nome: true, numero: true } },
      },
      orderBy: [{ dataBloqueio: "desc" }, { inicioBloqueio: "asc" }],
    });

    return res.json(bloqueios);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar bloqueios" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await prisma.bloqueioQuadra.delete({ where: { id: req.params.id } });
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
