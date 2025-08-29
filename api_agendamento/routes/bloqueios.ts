import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { startOfDay, endOfDay } from "date-fns";

const router = Router();
const prisma = new PrismaClient();

const bloqueioSchema = z.object({
  quadraIds: z.array(z.string().uuid()),
  dataBloqueio: z.coerce.date(),
  inicioBloqueio: z.string().min(1),
  fimBloqueio: z.string().min(1),
  bloqueadoPorId: z.string().uuid(),
});

router.post("/", async (req, res) => {
  const parseResult = bloqueioSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ erro: parseResult.error.errors });
  }

  const { quadraIds, dataBloqueio, inicioBloqueio, fimBloqueio, bloqueadoPorId } = parseResult.data;

  try {
    const dataInicio = startOfDay(dataBloqueio);
    const dataFim = endOfDay(dataBloqueio);

    // Verifica conflitos para todas as quadras antes de criar
    for (const quadraId of quadraIds) {
      const conflitoComum = await prisma.agendamento.findFirst({
        where: {
          quadraId,
          horario: {
            gte: inicioBloqueio,
            lt: fimBloqueio,
          },
          data: {
            gte: dataInicio,
            lte: dataFim,
          },
          status: "CONFIRMADO",
        },
      });

      if (conflitoComum) {
        return res.status(409).json({
          erro: `Não é possível bloquear a quadra ${quadraId}: conflito com agendamento comum confirmado.`,
        });
      }
    }

    // Cria o bloqueio com várias quadras (associação)
    const bloqueioCriado = await prisma.bloqueioQuadra.create({
      data: {
        dataBloqueio,
        inicioBloqueio,
        fimBloqueio,
        bloqueadoPorId,
        quadras: {
          connect: quadraIds.map(id => ({ id })),
        },
      },
      include: {
        bloqueadoPor: {
          select: {
            nome: true,
            email: true,
          },
        },
        quadras: {
          select: {
            nome: true,
            numero: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: "Bloqueio criado com sucesso",
      bloqueio: bloqueioCriado,
    });
  } catch (error) {
    console.error("Erro ao criar bloqueio:", error);
    return res.status(500).json({ erro: "Erro interno ao tentar bloquear as quadras" });
  }
});

router.get("/", async (req, res) => {
  try {
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      select: {
        id: true,
        dataBloqueio: true,      // data alvo do bloqueio
        inicioBloqueio: true,    // hora inicial bloqueada (string, ex: "14:00")
        fimBloqueio: true,       // hora final bloqueada 
        bloqueadoPor: {
          select: { id: true, nome: true, email: true },
        },
        quadras: {
          select: { id: true, nome: true, numero: true },
        },
      },
      orderBy: [
        { dataBloqueio: "desc" },
        { inicioBloqueio: "asc" },
      ],
    });

    res.json(bloqueios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar bloqueios" });
  }
});


router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.bloqueioQuadra.delete({
      where: { id },
    });

    return res.status(200).json({ message: "Bloqueio removido com sucesso!" });
  } catch (error) {
    console.error("Erro ao remover bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao remover bloqueio" });
  }
});

export default router;
