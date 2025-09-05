import { Router } from "express";
import { PrismaClient, DiaSemana } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { addDays, addMonths, startOfDay } from "date-fns";

import verificarToken from "../middleware/authMiddleware";
import { isAdmin as isAdminTipo, requireOwnerByRecord } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

/** Aceita OU usuarioId (admin) OU convidadosNomes[0] (admin).
 *  Clientes sempre criam para si — ignoramos usuarioId/convidado como dono. */
const schemaAgendamentoPermanente = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  horario: z.string().min(1),
  quadraId: z.string().uuid(),
  esporteId: z.string().uuid(),
  usuarioId: z.string().uuid().optional(),
  dataInicio: z.string().optional(),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});

async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex");
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

const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
};

function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00.000Z`);
}
function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

// 🔒 todas as rotas daqui exigem login
router.use(verificarToken);

// 🔄 Criar agendamento permanente
router.post("/", async (req, res) => {
  const validacao = schemaAgendamentoPermanente.safeParse(req.body);
  if (!validacao.success) return res.status(400).json({ erro: validacao.error.errors });

  const { diaSemana, horario, quadraId, esporteId, usuarioId: usuarioIdBody, dataInicio, convidadosNomes = [] } = validacao.data;

  try {
    // quadra existe + esporte associado
    const quadra = await prisma.quadra.findUnique({ where: { id: quadraId }, include: { quadraEsportes: true } });
    if (!quadra) return res.status(404).json({ erro: "Quadra não encontrada" });
    const pertenceAoEsporte = quadra.quadraEsportes.some(qe => qe.esporteId === esporteId);
    if (!pertenceAoEsporte) return res.status(400).json({ erro: "A quadra não está associada ao esporte informado" });

    // 1 permanente ativo por (quadra, diaSemana, horario)
    const permanenteExistente = await prisma.agendamentoPermanente.findFirst({
      where: { diaSemana, horario, quadraId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
      select: { id: true },
    });
    if (permanenteExistente) {
      return res.status(409).json({ erro: "Já existe um agendamento permanente nesse horário, quadra e dia" });
    }

    // conflito com comuns confirmados (mantido)
    const agendamentosComuns = await prisma.agendamento.findMany({
      where: { horario, quadraId, status: "CONFIRMADO" },
      select: { data: true },
    });
    const possuiConflito = agendamentosComuns.some(ag => {
      const data = new Date(ag.data);
      const dia = data.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
      return dia === diaSemana;
    });
    if (possuiConflito && !dataInicio) {
      return res.status(409).json({ erro: "Conflito com agendamento comum existente nesse dia, horário e quadra" });
    }

    // 🔑 resolve DONO
    const ehAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
    let usuarioIdDono = req.usuario!.usuarioLogadoId; // default: cliente cria pra si
    if (ehAdmin) {
      if (usuarioIdBody) {
        usuarioIdDono = usuarioIdBody;
      } else if (convidadosNomes.length > 0) {
        const convidado = await criarConvidadoComoUsuario(convidadosNomes[0]);
        usuarioIdDono = convidado.id;
      }
    }

    const novo = await prisma.agendamentoPermanente.create({
      data: {
        diaSemana,
        horario,
        quadraId,
        esporteId,
        usuarioId: usuarioIdDono,
        ...(dataInicio ? { dataInicio: new Date(dataInicio) } : {}),
      },
      select: { id: true, diaSemana: true, horario: true, quadraId: true, esporteId: true, usuarioId: true, dataInicio: true, status: true },
    });

    return res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
  }
});

// 📋 Listar
//  - admin vê todos
//  - cliente vê só os dele
router.get("/", async (req, res) => {
  try {
    const ehAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);

    const where = ehAdmin ? {} : { usuarioId: req.usuario!.usuarioLogadoId };

    const agendamentos = await prisma.agendamentoPermanente.findMany({
      where,
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        quadra: { select: { id: true, nome: true, numero: true } },
        esporte: { select: { id: true, nome: true } },
      },
      orderBy: [{ diaSemana: "asc" }, { horario: "asc" }],
    });
    return res.status(200).json(agendamentos);
  } catch (error) {
    console.error("Erro ao buscar agendamentos permanentes:", error);
    return res.status(500).json({ erro: "Erro ao buscar agendamentos permanentes" });
  }
});

// 📄 Detalhes — dono ou admin
router.get(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
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
      if (!agendamento) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });

      return res.json({
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
      return res.status(500).json({ erro: "Erro ao buscar agendamento permanente" });
    }
  }
);

// 📅 Datas elegíveis p/ exceção — dono ou admin
router.get(
  "/:id/datas-excecao",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    const meses = Number(req.query.meses ?? "1");
    const clampMeses = Number.isFinite(meses) && meses > 0 && meses <= 6 ? meses : 1;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: { id: true, diaSemana: true, horario: true, dataInicio: true, status: true },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const hoje = startOfDay(new Date());
      const base = perm.dataInicio ? startOfDay(new Date(perm.dataInicio)) : hoje;
      const inicioJanela = base > hoje ? base : hoje;
      const fimJanela = startOfDay(addMonths(inicioJanela, clampMeses));

      const targetIdx = DIA_IDX[perm.diaSemana as DiaSemana];
      const curIdx = inicioJanela.getDay();
      const delta = (targetIdx - curIdx + 7) % 7;
      let d = addDays(inicioJanela, delta);

      const todas: string[] = [];
      while (d < fimJanela) {
        if (!perm.dataInicio || d >= startOfDay(new Date(perm.dataInicio))) {
          todas.push(toISODateUTC(d));
        }
        d = addDays(d, 7);
      }

      const jaCanceladas = await prisma.agendamentoPermanenteCancelamento.findMany({
        where: { agendamentoPermanenteId: id, data: { gte: inicioJanela, lt: fimJanela } },
        select: { data: true },
      });
      const jaCanceladasSet = new Set(jaCanceladas.map((c) => toISODateUTC(new Date(c.data))));
      const elegiveis = todas.filter((iso) => !jaCanceladasSet.has(iso));

      return res.json({
        permanenteId: perm.id,
        inicioJanela: toISODateUTC(inicioJanela),
        fimJanela: toISODateUTC(fimJanela),
        diaSemana: perm.diaSemana,
        horario: perm.horario,
        datas: elegiveis,
        jaCanceladas: Array.from(jaCanceladasSet),
      });
    } catch (e) {
      console.error("Erro em GET /:id/datas-excecao", e);
      return res.status(500).json({ erro: "Erro ao listar datas para exceção" });
    }
  }
);

// 🚫 Registrar exceção (cancelar um dia da recorrência) — dono ou admin
router.post(
  "/:id/cancelar-dia",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;

    const schema = z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // "YYYY-MM-DD"
      motivo: z.string().trim().max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });

    const { data: iso, motivo } = parsed.data;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: { id: true, usuarioId: true, diaSemana: true, dataInicio: true, status: true },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const dataUTC = toUtc00(iso);

      // data >= dataInicio (se existir)
      if (perm.dataInicio && dataUTC < startOfDay(new Date(perm.dataInicio))) {
        return res.status(400).json({ erro: "Data anterior ao início do agendamento permanente." });
      }

      // dia da semana confere
      const idx = dataUTC.getUTCDay();
      if (idx !== DIA_IDX[perm.diaSemana as DiaSemana]) {
        return res.status(400).json({ erro: "Data não corresponde ao dia da semana do permanente." });
      }

      // evitar duplicidade
      const jaExiste = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: { agendamentoPermanenteId: id, data: dataUTC },
        select: { id: true },
      });
      if (jaExiste) {
        return res.status(409).json({ erro: "Esta data já está marcada como exceção para este permanente." });
      }

      const novo = await prisma.agendamentoPermanenteCancelamento.create({
        data: {
          agendamentoPermanenteId: id,
          data: dataUTC,
          motivo: motivo ?? null,
          criadoPorId: req.usuario!.usuarioLogadoId, // ⚠️ do token
        },
      });

      return res.status(201).json({
        id: novo.id,
        agendamentoPermanenteId: id,
        data: toISODateUTC(new Date(novo.data)),
        motivo: novo.motivo ?? null,
        criadoPorId: novo.criadoPorId,
      });
    } catch (e) {
      console.error("Erro em POST /:id/cancelar-dia", e);
      return res.status(500).json({ erro: "Erro ao registrar exceção do permanente" });
    }
  }
);

// ✅ Cancelar agendamento permanente — dono ou admin
router.post(
  "/cancelar/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const agendamento = await prisma.agendamentoPermanente.update({
        where: { id },
        data: { status: "CANCELADO", canceladoPorId: req.usuario!.usuarioLogadoId }, // ⚠️ do token
      });
      return res.status(200).json({ message: "Agendamento permanente cancelado com sucesso.", agendamento });
    } catch (error) {
      console.error("Erro ao cancelar agendamento permanente:", error);
      return res.status(500).json({ error: "Erro ao cancelar agendamento permanente." });
    }
  }
);

// ❌ Deletar — dono ou admin
router.delete(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const agendamento = await prisma.agendamentoPermanente.findUnique({ where: { id }, select: { id: true } });
      if (!agendamento) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });

      await prisma.agendamentoPermanente.delete({ where: { id } });
      return res.status(200).json({ mensagem: "Agendamento permanente deletado com sucesso" });
    } catch (error) {
      console.error("Erro ao deletar agendamento permanente:", error);
      return res.status(500).json({ erro: "Erro ao deletar agendamento permanente" });
    }
  }
);

export default router;
