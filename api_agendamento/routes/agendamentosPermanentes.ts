import { Router } from "express";
import { PrismaClient, DiaSemana } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { addDays, addMonths, startOfDay } from "date-fns";

import verificarToken from "../middleware/authMiddleware";
import { isAdmin as isAdminTipo, requireOwnerByRecord } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit"; // 👈 AUDIT

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

/** Próxima data (YYYY-MM-DD) da recorrência, PULANDO exceções já cadastradas. */
async function proximaDataPermanenteSemExcecao(p: {
  id: string;
  diaSemana: DiaSemana;
  dataInicio: Date | null;
}): Promise<string | null> {
  const hoje = startOfDay(new Date());
  const base = p.dataInicio && startOfDay(new Date(p.dataInicio)) > hoje
    ? startOfDay(new Date(p.dataInicio))
    : hoje;

  const cur = base.getDay();                 // 0..6 local
  const target = DIA_IDX[p.diaSemana] ?? 0;  // 0..6
  const delta = (target - cur + 7) % 7;

  let tentativa = addDays(base, delta);
  // Limite defensivo ~2 anos
  for (let i = 0; i < 120; i++) {
    const iso = toISODateUTC(tentativa); // "YYYY-MM-DD"
    const exc = await prisma.agendamentoPermanenteCancelamento.findFirst({
      where: { agendamentoPermanenteId: p.id, data: toUtc00(iso) },
      select: { id: true },
    });
    if (!exc) return iso;
    tentativa = addDays(tentativa, 7);
  }
  return null;
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

    // conflito com comuns confirmados (mantido) — usando índice UTC (reconhece "hoje")
    const agendamentosComuns = await prisma.agendamento.findMany({
      where: { horario, quadraId, status: "CONFIRMADO" },
      select: { data: true },
    });
    const targetIdx = DIA_IDX[diaSemana];
    const possuiConflito = agendamentosComuns.some(ag => {
      const idx = new Date(ag.data).getUTCDay(); // 0..6 UTC
      return idx === targetIdx;
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

    // 📝 AUDIT - CREATE
    try {
      await logAudit({
        event: "AGENDAMENTO_PERM_CREATE",
        req,
        target: { type: TargetType.AGENDAMENTO_PERMANENTE, id: novo.id },
        metadata: {
          permanenteId: novo.id,
          donoId: novo.usuarioId,
          diaSemana: novo.diaSemana,
          horario: novo.horario,
          quadraId,
          esporteId,
          dataInicio: novo.dataInicio ?? null,
        },
      });
    } catch (e) {
      console.error("[audit] perm create error:", e);
    }

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
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const agendamento = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        include: {
          usuario: { select: { id: true, nome: true, email: true, celular: true } },
          quadra: { select: { nome: true, numero: true } },
          esporte: { select: { nome: true } },
        },
      });
      if (!agendamento) {
        return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      }

      return res.json({
        id: agendamento.id,
        tipoReserva: "PERMANENTE",
        diaSemana: agendamento.diaSemana,
        horario: agendamento.horario,
        usuario: agendamento.usuario
          ? {
              id: agendamento.usuario.id,
              nome: agendamento.usuario.nome,
              email: agendamento.usuario.email,
              celular: agendamento.usuario.celular,
            }
          : null,
        usuarioId: agendamento.usuario?.id,
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
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
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

      const isAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);

      const jaCanceladas = await prisma.agendamentoPermanenteCancelamento.findMany({
        where: { agendamentoPermanenteId: id, data: { gte: inicioJanela, lt: fimJanela } },
        include: { criadoPor: { select: { id: true, nome: true, email: true } } },
        orderBy: { data: "asc" },
      });

      const jaCanceladasSet = new Set(
        jaCanceladas.map((c) => toISODateUTC(new Date(c.data)))
      );

      const elegiveis = todas.filter((iso) => !jaCanceladasSet.has(iso));

      return res.json({
        permanenteId: perm.id,
        inicioJanela: toISODateUTC(inicioJanela),
        fimJanela: toISODateUTC(fimJanela),
        diaSemana: perm.diaSemana,
        horario: perm.horario,
        datas: elegiveis,
        jaCanceladas: Array.from(jaCanceladasSet),
        jaCanceladasDetalhes: jaCanceladas.map((c) => ({
          id: c.id,
          data: toISODateUTC(new Date(c.data)),
          motivo: c.motivo ?? null,
          criadoPor: c.criadoPor
            ? {
              id: c.criadoPor.id,
              nome: c.criadoPor.nome,
              email: isAdmin ? c.criadoPor.email : undefined,
            }
            : null,
          createdAt: c.createdAt,
        })),
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
        select: {
          id: true,
          usuarioId: true,
          diaSemana: true,
          horario: true,
          quadraId: true,
          esporteId: true,
          dataInicio: true,
          status: true,
        },
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
          criadoPorId: req.usuario!.usuarioLogadoId,
        },
        include: {
          criadoPor: { select: { id: true, nome: true, email: true } },
        },
      });

      // 📝 AUDIT - EXCEÇÃO (um dia)
      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_EXCECAO",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            data: iso,
            motivo: motivo ?? null,
            criadoPorId: req.usuario!.usuarioLogadoId,

            // enriquecimento:
            donoId: perm.usuarioId,
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
          },
        });
      } catch (e) {
        console.error("[audit] perm excecao error:", e);
      }

      return res.status(201).json({
        id: novo.id,
        agendamentoPermanenteId: id,
        data: toISODateUTC(new Date(novo.data)),
        motivo: novo.motivo ?? null,
        criadoPor: novo.criadoPor ? {
          id: novo.criadoPor.id,
          nome: novo.criadoPor.nome,
          email: novo.criadoPor.email,
        } : null,
        createdAt: novo.createdAt,
      });
    } catch (e) {
      console.error("Erro em POST /:id/cancelar-dia", e);
      return res.status(500).json({ erro: "Erro ao registrar exceção do permanente" });
    }
  }
);

/**
 * ✅ Cancelar **a próxima ocorrência** de um permanente (cliente dono ou admin)
 * - Admin: SEM restrição de 12h.
 * - Cliente dono: permitido apenas até 12h antes da próxima ocorrência.
 * - Implementado criando uma exceção na data correspondente.
 */
router.post(
  "/:id/cancelar-proxima",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null; // permite admin ou dono
  }),
  async (req, res) => {
    const { id } = req.params;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: {
          id: true,
          usuarioId: true,
          diaSemana: true,
          horario: true,
          quadraId: true,
          esporteId: true,
          dataInicio: true,
          status: true,
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      // próxima data sem exceções já registradas
      const proximaISO = await proximaDataPermanenteSemExcecao({
        id: perm.id,
        diaSemana: perm.diaSemana as DiaSemana,
        dataInicio: perm.dataInicio ? new Date(perm.dataInicio) : null,
      });
      if (!proximaISO) {
        return res.status(409).json({ erro: "Não há próxima ocorrência disponível para cancelamento." });
      }

      const ehAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
      if (!ehAdmin) {
        // Regra de 12 horas para o CLIENTE dono (offset fixo -03:00)
        const alvo = new Date(`${proximaISO}T${perm.horario}:00-03:00`);
        const diffHoras = (alvo.getTime() - Date.now()) / (1000 * 60 * 60);
        if (diffHoras < 12) {
          return res.status(403).json({
            erro: "Cancelamento permitido apenas até 12 horas antes da próxima ocorrência.",
          });
        }
      }

      // Evitar duplicidade (concorrência)
      const jaExiste = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: { agendamentoPermanenteId: id, data: toUtc00(proximaISO) },
        select: { id: true },
      });
      if (jaExiste) {
        return res.status(409).json({ erro: "A próxima ocorrência já foi cancelada." });
      }

      const exc = await prisma.agendamentoPermanenteCancelamento.create({
        data: {
          agendamentoPermanenteId: id,
          data: toUtc00(proximaISO),
          motivo: "Cancelado pelo cliente (próxima ocorrência)",
          criadoPorId: req.usuario!.usuarioLogadoId,
        },
      });

      // 📝 AUDIT - EXCEÇÃO (próxima)
      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_EXCECAO",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            data: proximaISO,
            motivo: "Cancelado pelo cliente (próxima ocorrência)",
            criadoPorId: req.usuario!.usuarioLogadoId,

            // enriquecimento:
            donoId: perm.usuarioId,
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
          },
        });
      } catch (e) {
        console.error("[audit] perm excecao(proxima) error:", e);
      }

      return res.status(201).json({
        ok: true,
        mensagem: "Próxima ocorrência cancelada com sucesso.",
        agendamentoPermanenteId: id,
        dataCancelada: toISODateUTC(new Date(exc.data)),
      });
    } catch (e) {
      console.error("Erro em POST /:id/cancelar-proxima", e);
      return res.status(500).json({ erro: "Erro ao cancelar a próxima ocorrência do permanente" });
    }
  }
);

// ✅ Cancelar agendamento permanente (encerrar recorrência) — dono ou admin
router.post(
  "/cancelar/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const before = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: { status: true, usuarioId: true, diaSemana: true, horario: true, quadraId: true, esporteId: true },
      });

      const agendamento = await prisma.agendamentoPermanente.update({
        where: { id },
        data: { status: "CANCELADO", canceladoPorId: req.usuario!.usuarioLogadoId }, // ⚠️ do token
      });

      // 📝 AUDIT - CANCEL
      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_CANCEL",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            statusAntes: before?.status ?? null,
            statusDepois: agendamento.status,
            donoId: before?.usuarioId ?? null,
            diaSemana: before?.diaSemana ?? null,
            horario: before?.horario ?? null,
            quadraId: before?.quadraId ?? null,
            esporteId: before?.esporteId ?? null,
          },
        });
      } catch (e) {
        console.error("[audit] perm cancel error:", e);
      }

      return res.status(200).json({ message: "Agendamento permanente cancelado com sucesso.", agendamento });
    } catch (error) {
      console.error("Erro ao cancelar agendamento permanente:", error);
      return res.status(500).json({ error: "Erro ao cancelar agendamento permanente." });
    }
  }
);

// 🔁 Transferir agendamento permanente — admin ou dono
router.patch(
  "/:id/transferir",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null; // permite admin ou dono
  }),
  async (req, res) => {
    const { id } = req.params;

    const schema = z.object({
      novoUsuarioId: z.string().uuid(),
      transferidoPorId: z.string().uuid().optional(),
      /** true = copia exceções (datas já canceladas) para o novo permanente */
      copiarExcecoes: z.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.format() });
    }
    const { novoUsuarioId, transferidoPorId, copiarExcecoes } = parsed.data;

    try {
      // Registro atual
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        include: {
          cancelamentos: true,
          quadra: { select: { id: true, nome: true, numero: true } },
          esporte: { select: { id: true, nome: true } },
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }
      if (novoUsuarioId === perm.usuarioId) {
        return res.status(400).json({ erro: "Novo usuário é o mesmo do agendamento atual" });
      }

      // Valida novo usuário
      const novoUsuario = await prisma.usuario.findUnique({
        where: { id: novoUsuarioId },
        select: { id: true, nome: true, email: true },
      });
      if (!novoUsuario) {
        return res.status(404).json({ erro: "Novo usuário não encontrado" });
      }

      // Garante que não exista outro permanente ativo no mesmo slot
      const jaExisteAtivo = await prisma.agendamentoPermanente.findFirst({
        where: {
          id: { not: id },
          quadraId: perm.quadraId,
          diaSemana: perm.diaSemana,
          horario: perm.horario,
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        },
        select: { id: true },
      });
      if (jaExisteAtivo) {
        return res
          .status(409)
          .json({ erro: "Já existe um agendamento permanente ativo nesse dia/horário/quadra" });
      }

      // Transação: marca original como TRANSFERIDO e cria o novo com o novo usuário
      const [, novoPerm] = await prisma.$transaction([
        prisma.agendamentoPermanente.update({
          where: { id },
          data: {
            status: "TRANSFERIDO",
            transferidoPorId: transferidoPorId ?? req.usuario!.usuarioLogadoId,
          },
        }),
        prisma.agendamentoPermanente.create({
          data: {
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
            usuarioId: novoUsuarioId,
            dataInicio: perm.dataInicio ?? null,
          },
          include: {
            usuario: { select: { id: true, nome: true, email: true } },
            quadra: { select: { id: true, nome: true, numero: true } },
            esporte: { select: { id: true, nome: true } },
          },
        }),
      ]);

      // (Opcional) Copia as exceções do antigo para o novo
      if (copiarExcecoes && perm.cancelamentos.length) {
        await prisma.agendamentoPermanenteCancelamento.createMany({
          data: perm.cancelamentos.map((c) => ({
            agendamentoPermanenteId: novoPerm.id,
            data: c.data,
            motivo: c.motivo ?? null,
            criadoPorId: c.criadoPorId ?? null,
          })),
        });
      }

      // 📝 AUDIT - TRANSFER
      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_TRANSFER",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteIdOriginal: id,
            permanenteIdNovo: novoPerm.id,

            // ✅ chaves reconhecidas pelo enrich
            fromOwnerId: perm.usuarioId,
            toOwnerId: novoUsuarioId,
            // aliases extras (compat)
            deDonoId: perm.usuarioId,
            paraDonoId: novoUsuarioId,
            deUsuarioId: perm.usuarioId,
            paraUsuarioId: novoUsuarioId,

            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
            excecoesCopiadas: !!copiarExcecoes ? perm.cancelamentos.length : 0,
          },
        });
      } catch (e) {
        console.error("[audit] perm transfer error:", e);
      }

      const isAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
      return res.status(200).json({
        message: "Agendamento permanente transferido com sucesso",
        agendamentoOriginalId: id,
        novoAgendamento: {
          id: novoPerm.id,
          diaSemana: novoPerm.diaSemana,
          horario: novoPerm.horario,
          dataInicio: novoPerm.dataInicio,
          usuario: {
            id: novoPerm.usuario?.id,
            nome: novoPerm.usuario?.nome,
            email: isAdmin ? novoPerm.usuario?.email : undefined,
          },
          quadra: novoPerm.quadra
            ? { id: novoPerm.quadra.id, nome: novoPerm.quadra.nome, numero: novoPerm.quadra.numero }
            : null,
          esporte: novoPerm.esporte ? { id: novoPerm.esporte.id, nome: novoPerm.esporte.nome } : null,
          excecoesCopiadas: copiarExcecoes ? perm.cancelamentos.length : 0,
        },
      });
    } catch (e) {
      console.error("Erro ao transferir agendamento permanente:", e);
      return res.status(500).json({ erro: "Erro ao transferir agendamento permanente" });
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
      const agendamento = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: { id: true, usuarioId: true, diaSemana: true, horario: true, quadraId: true, esporteId: true },
      });
      if (!agendamento) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });

      await prisma.agendamentoPermanente.delete({ where: { id } });

      // 📝 AUDIT - DELETE
      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_DELETE",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            donoId: agendamento?.usuarioId ?? null,
            diaSemana: agendamento?.diaSemana ?? null,
            horario: agendamento?.horario ?? null,
            quadraId: agendamento?.quadraId ?? null,
            esporteId: agendamento?.esporteId ?? null,
          },
        });
      } catch (e) {
        console.error("[audit] perm delete error:", e);
      }

      return res.status(200).json({ mensagem: "Agendamento permanente deletado com sucesso" });
    } catch (error) {
      console.error("Erro ao deletar agendamento permanente:", error);
      return res.status(500).json({ erro: "Erro ao deletar agendamento permanente" });
    }
  }
);

export default router;
