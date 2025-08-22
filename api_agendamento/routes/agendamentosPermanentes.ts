import { Router } from "express";
import { PrismaClient, DiaSemana } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

const schemaAgendamentoPermanente = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  horario: z.string().min(1),
  quadraId: z.string().uuid(),
  esporteId: z.string().uuid(),
  usuarioId: z.string().uuid(),
  dataInicio: z.string().optional() // agora aceita opcionalmente
});

// 🔄 Criar agendamento permanente
router.post("/", async (req, res) => {
  const validacao = schemaAgendamentoPermanente.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  const { diaSemana, horario, quadraId, esporteId, usuarioId, dataInicio } = validacao.data;

  try {
    // Verifica se quadra existe e está associada ao esporte
    const quadra = await prisma.quadra.findUnique({
      where: { id: quadraId },
      include: { quadraEsportes: true }
    });

    if (!quadra) {
      return res.status(404).json({ erro: "Quadra não encontrada" });
    }

    const pertenceAoEsporte = quadra.quadraEsportes.some(qe => qe.esporteId === esporteId);
    if (!pertenceAoEsporte) {
      return res.status(400).json({ erro: "A quadra não está associada ao esporte informado" });
    }

    // Verifica se já existe agendamento permanente no mesmo dia, horário e quadra
    const permanenteExistente = await prisma.agendamentoPermanente.findFirst({
      where: {
        diaSemana,
        horario,
        quadraId,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      }
    });

    if (permanenteExistente) {
      return res.status(409).json({ erro: "Já existe um agendamento permanente nesse horário, quadra e dia" });
    }

    // ⚠️ Verifica conflitos com agendamentos comuns ATIVOS (ignora cancelados)
    const agendamentosComuns = await prisma.agendamento.findMany({
      where: {
        horario,
        quadraId,
        status: "CONFIRMADO"  // <-- só considera agendamentos ativos
      }
    });

    const possuiConflito = agendamentosComuns.some(ag => {
      const data = new Date(ag.data);
      const dia = data.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
      return dia === diaSemana;
    });

    if (possuiConflito && !dataInicio) {
      // Só bloqueia se não foi enviada dataInicio para iniciar depois do conflito
      return res.status(409).json({ erro: "Conflito com agendamento comum existente nesse dia, horário e quadra" });
    }

    // Cria o agendamento permanente
    const novo = await prisma.agendamentoPermanente.create({
      data: {
        diaSemana,
        horario,
        quadraId,
        esporteId,
        usuarioId,
        ...(dataInicio ? { dataInicio: new Date(dataInicio) } : {}) // salva se existir
      }
    });

    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
  }
});

// 📋 Listar todos
router.get("/", async (req, res) => {
  try {
    const agendamentos = await prisma.agendamentoPermanente.findMany({
      include: {
        usuario: { select: { nome: true } },
        quadra: { select: { nome: true, numero: true } },
        esporte: { select: { nome: true } }
      }
    });
    res.status(200).json(agendamentos);
  } catch (error) {
    console.error("Erro ao buscar agendamentos permanentes:", error);
    res.status(500).json({ erro: "Erro ao buscar agendamentos permanentes" });
  }
});

// 📄 Detalhes de um agendamento permanente
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const agendamento = await prisma.agendamentoPermanente.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        quadra: { select: { nome: true, numero: true } },
        esporte: { select: { nome: true } },
      },
    });

    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
    }

    res.json({
      id: agendamento.id,
      tipoReserva: "PERMANENTE",
      diaSemana: agendamento.diaSemana,
      horario: agendamento.horario,
      usuario: agendamento.usuario.nome,
      usuarioId: agendamento.usuario.id,
      esporte: agendamento.esporte.nome,
      quadra: `${agendamento.quadra.nome} (Nº ${agendamento.quadra.numero})`,
      dataInicio: agendamento.dataInicio,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar agendamento permanente" });
  }
});

// ✅ Cancelar agendamento permanente
router.post("/cancelar/:id", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const agendamento = await prisma.agendamentoPermanente.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoPorId: usuarioId,
      },
    });

    res.status(200).json({
      message: "Agendamento permanente cancelado com sucesso.",
      agendamento,
    });
  } catch (error) {
    console.error("Erro ao cancelar agendamento permanente:", error);
    res.status(500).json({ error: "Erro ao cancelar agendamento permanente." });
  }
});

// ❌ Deletar
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const agendamento = await prisma.agendamentoPermanente.findUnique({ where: { id } });
    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
    }
    await prisma.agendamentoPermanente.delete({ where: { id } });
    res.status(200).json({ mensagem: "Agendamento permanente deletado com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar agendamento permanente:", error);
    res.status(500).json({ erro: "Erro ao deletar agendamento permanente" });
  }
});

export default router;
