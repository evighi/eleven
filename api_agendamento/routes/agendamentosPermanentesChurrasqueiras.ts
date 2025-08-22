import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

const schemaAgendamentoPermanenteChurrasqueira = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  turno: z.nativeEnum(Turno),
  churrasqueiraId: z.string().uuid(),
  usuarioId: z.string().uuid(),
  dataInicio: z.string().datetime().optional()
});

// Criar agendamento permanente
router.post("/", async (req, res) => {
  const validacao = schemaAgendamentoPermanenteChurrasqueira.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  const { diaSemana, turno, churrasqueiraId, usuarioId, dataInicio } = validacao.data;

  try {
    const conflito = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
      where: { diaSemana, turno, churrasqueiraId, status: { not: "CANCELADO" }, }
    });

    if (conflito) {
      return res.status(409).json({ erro: "Já existe um agendamento permanente nesse dia e turno" });
    }

    const novo = await prisma.agendamentoPermanenteChurrasqueira.create({
      data: {
        diaSemana,
        turno,
        churrasqueiraId,
        usuarioId,
        dataInicio: dataInicio ? new Date(dataInicio) : null
      }
    });

    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
  }
});

// Listar
router.get("/", async (req, res) => {
  try {
    const lista = await prisma.agendamentoPermanenteChurrasqueira.findMany({
      include: { churrasqueira: true, usuario: { select: { nome: true } } }
    });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao listar" });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const agendamento = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        churrasqueira: { select: { nome: true, numero: true } },
      },
    });

    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento permanente de churrasqueira não encontrado" });
    }

    res.json({
      id: agendamento.id,
      tipoReserva: "PERMANENTE",
      diaSemana: agendamento.diaSemana, // caso tenha
      turno: agendamento.turno,
      usuario: agendamento.usuario.nome,
      usuarioId: agendamento.usuario.id,
      churrasqueira: `${agendamento.churrasqueira.nome} (Nº ${agendamento.churrasqueira.numero})`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar agendamento permanente de churrasqueira" });
  }
});


// ✅ Cancelar agendamento permanente de churrasqueira
router.post("/cancelar/:id", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const agendamento = await prisma.agendamentoPermanenteChurrasqueira.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoPorId: usuarioId,
      },
    });

    res.status(200).json({
      message: "Agendamento permanente de churrasqueira cancelado com sucesso.",
      agendamento,
    });
  } catch (error) {
    console.error("Erro ao cancelar agendamento permanente de churrasqueira:", error);
    res.status(500).json({ error: "Erro ao cancelar agendamento permanente de churrasqueira." });
  }
});

// Deletar
router.delete("/:id", async (req, res) => {
  try {
    await prisma.agendamentoPermanenteChurrasqueira.delete({ where: { id: req.params.id } });
    res.json({ mensagem: "Agendamento permanente deletado com sucesso" });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao deletar" });
  }
});

export default router;
