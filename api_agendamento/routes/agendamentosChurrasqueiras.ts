import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

const schemaAgendamentoChurrasqueira = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  turno: z.nativeEnum(Turno),
  churrasqueiraId: z.string().uuid(),
  usuarioId: z.string().uuid()
});

// Criar agendamento de churrasqueira
router.post("/", async (req, res) => {
  const validacao = schemaAgendamentoChurrasqueira.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  const { diaSemana, turno, churrasqueiraId, usuarioId } = validacao.data;

  try {
    const conflito = await prisma.agendamentoChurrasqueira.findFirst({
      where: { diaSemana, turno, churrasqueiraId, status: { not: "CANCELADO" }, }
    });

    if (conflito) {
      return res.status(409).json({ erro: "Já existe um agendamento nesse dia e turno" });
    }

    const novo = await prisma.agendamentoChurrasqueira.create({
      data: { diaSemana, turno, churrasqueiraId, usuarioId }
    });

    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar agendamento" });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const agendamento = await prisma.agendamentoChurrasqueira.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        churrasqueira: { select: { nome: true, numero: true } },
      },
    });

    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento de churrasqueira não encontrado" });
    }

    res.json({
      id: agendamento.id,
      tipoReserva: "COMUM",
      dia: agendamento.diaSemana,
      turno: agendamento.turno, // como você usa turno para churrasqueiras
      usuario: agendamento.usuario.nome,
      usuarioId: agendamento.usuario.id,
      churrasqueira: `${agendamento.churrasqueira.nome} (Nº ${agendamento.churrasqueira.numero})`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar agendamento de churrasqueira" });
  }
});


// ✅ Cancelar agendamento de churrasqueira
router.post("/cancelar/:id", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const agendamento = await prisma.agendamentoChurrasqueira.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoPorId: usuarioId,
      },
    });

    res.status(200).json({
      message: "Agendamento de churrasqueira cancelado com sucesso.",
      agendamento,
    });
  } catch (error) {
    console.error("Erro ao cancelar agendamento de churrasqueira:", error);
    res.status(500).json({ error: "Erro ao cancelar agendamento de churrasqueira." });
  }
});

// Listar
router.get("/", async (req, res) => {
  try {
    const lista = await prisma.agendamentoChurrasqueira.findMany({
      include: { churrasqueira: true, usuario: { select: { nome: true } } }
    });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao listar agendamentos" });
  }
});

// Deletar
router.delete("/:id", async (req, res) => {
  try {
    await prisma.agendamentoChurrasqueira.delete({ where: { id: req.params.id } });
    res.json({ mensagem: "Agendamento deletado com sucesso" });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao deletar" });
  }
});

export default router;
