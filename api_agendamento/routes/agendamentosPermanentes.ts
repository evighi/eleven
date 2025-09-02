import { Router } from "express";
import { PrismaClient, DiaSemana } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";           // ← novo
import crypto from "crypto";             // ← novo

const prisma = new PrismaClient();
const router = Router();

/** Aceita OU usuarioId OU convidadosNomes[0] */
const schemaAgendamentoPermanente = z
  .object({
    diaSemana: z.nativeEnum(DiaSemana),
    horario: z.string().min(1),
    quadraId: z.string().uuid(),
    esporteId: z.string().uuid(),
    usuarioId: z.string().uuid().optional(), // ← agora opcional
    dataInicio: z.string().optional(),       // segue opcional
    convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]), // ← novo
  })
  .refine(
    (v) => !!v.usuarioId || (v.convidadosNomes?.length ?? 0) > 0,
    { path: ["usuarioId"], message: "Informe um usuário dono ou um convidado dono." }
  );

/** Cria um usuário mínimo a partir do nome do convidado (igual ao fluxo de comuns) */
async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 chars p/ unicidade
  const emailSintetico = `${localPart}+guest.${suffix}@noemail.local`;

  const randomPass = crypto.randomUUID();
  const hashed = await bcrypt.hash(randomPass, 10);

  const convidado = await prisma.usuario.create({
    data: {
      nome: cleanName,
      email: emailSintetico,
      senha: hashed,
      tipo: "CLIENTE",
      celular: null,
      cpf: null,
      nascimento: null,
    },
    select: { id: true, nome: true, email: true },
  });

  return convidado;
}

// 🔄 Criar agendamento permanente
router.post("/", async (req, res) => {
  const validacao = schemaAgendamentoPermanente.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  const {
    diaSemana, horario, quadraId, esporteId,
    usuarioId: usuarioIdBody,
    dataInicio,
    convidadosNomes = [],
  } = validacao.data;

  try {
    // Verifica se quadra existe e está associada ao esporte (igual estava)
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

    // Verifica se já existe agendamento permanente no mesmo dia, horário e quadra (igual estava)
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

    // ⚠️ Conflitos com comuns (mantido)
    const agendamentosComuns = await prisma.agendamento.findMany({
      where: {
        horario,
        quadraId,
        status: "CONFIRMADO"
      }
    });

    const possuiConflito = agendamentosComuns.some(ag => {
      const data = new Date(ag.data);
      const dia = data
        .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
        .toUpperCase();
      return dia === diaSemana;
    });

    if (possuiConflito && !dataInicio) {
      return res.status(409).json({ erro: "Conflito com agendamento comum existente nesse dia, horário e quadra" });
    }

    // 🔑 Resolve DONO: prioriza usuarioId; se não veio, cria convidado dono
    let usuarioIdDono = usuarioIdBody || "";
    if (!usuarioIdDono && convidadosNomes.length > 0) {
      const convidado = await criarConvidadoComoUsuario(convidadosNomes[0]);
      usuarioIdDono = convidado.id;
    }
    if (!usuarioIdDono) {
      return res.status(400).json({ erro: "Informe um usuário dono ou um convidado dono." });
    }

    // Cria o permanente (resto intacto)
    const novo = await prisma.agendamentoPermanente.create({
      data: {
        diaSemana,
        horario,
        quadraId,
        esporteId,
        usuarioId: usuarioIdDono,
        ...(dataInicio ? { dataInicio: new Date(dataInicio) } : {})
      }
    });

    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
  }
});

// 📋 Listar todos
router.get("/", async (_req, res) => {
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
