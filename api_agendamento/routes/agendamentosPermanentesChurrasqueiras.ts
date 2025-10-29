import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { addDays, addMonths, startOfDay } from "date-fns";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin, requireOwnerByRecord } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

// Helpers
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}
function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

/** Cria um usuário mínimo (tipo CLIENTE) a partir de um nome de convidado */
async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 chars
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

const schemaAgendamentoPermanenteChurrasqueira = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  turno: z.nativeEnum(Turno),
  churrasqueiraId: z.string().uuid(),
  // Admin pode escolher um usuário existente…
  usuarioId: z.string().uuid().optional(),
  // …ou informar um convidado (pega o primeiro nome e cria “usuário convidado”)
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
  // Aceita "YYYY-MM-DD" e converte para 00:00Z; opcional
  dataInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => toUtc00(s))
    .optional(),
});

// 🔒 todas as rotas exigem autenticação
router.use(verificarToken);

/* =========================================================
   📌 NOVOS HELPERS PARA SUGESTÕES DE DATAINICIO
   ========================================================= */
// Retorna a próxima data (>= base) que cai no dia-da-semana desejado (UTC)
function nextOnWeekdayUtc(base: Date, targetIdx: number) {
  const curIdx = base.getUTCDay();
  const delta = (targetIdx - curIdx + 7) % 7;
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

// Próximas datas elegíveis (sem conflito COMUM) para usar como dataInicio
async function nextStartDateCandidatesChurras(params: {
  churrasqueiraId: string;
  diaSemana: DiaSemana;
  turno: Turno;
  fromISO?: string;      // YYYY-MM-DD; default = hoje UTC
  maxSemanas?: number;   // horizonte; default=26
  maxSugestoes?: number; // qtde; default=6
}) {
  const { churrasqueiraId, diaSemana, turno, fromISO, maxSemanas = 26, maxSugestoes = 6 } = params;

  const hojeISO = new Date().toISOString().slice(0, 10);
  const base = fromISO ? toUtc00(fromISO) : toUtc00(hojeISO);

  const targetIdx = DIA_IDX[diaSemana];
  let d = nextOnWeekdayUtc(base, targetIdx);

  const sugestoes: string[] = [];
  let semanas = 0;

  while (semanas <= maxSemanas && sugestoes.length < maxSugestoes) {
    // conflito COMUM no mesmo dia+turno+churrasqueira?
    const conflitoComum = await prisma.agendamentoChurrasqueira.findFirst({
      where: {
        churrasqueiraId,
        data: d,
        turno,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: { id: true },
    });

    if (!conflitoComum) {
      sugestoes.push(toISODateUTC(d));
    }

    // avança 7 dias
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7));
    semanas++;
  }

  return {
    proximaDataDisponivel: sugestoes[0] ?? null,
    alternativas: sugestoes,
  };
}

/**
 * POST /churrasqueiras/permanentes
 * Criar agendamento permanente de churrasqueira (ADMIN)
 */
router.post("/", requireAdmin, async (req, res) => {
  const validacao = schemaAgendamentoPermanenteChurrasqueira.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  const {
    diaSemana,
    turno,
    churrasqueiraId,
    usuarioId: usuarioIdBody,
    convidadosNomes = [],
    dataInicio,
  } = validacao.data;

  try {
    // 0) churrasqueira existe?
    const exists = await prisma.churrasqueira.findUnique({
      where: { id: churrasqueiraId },
      select: { id: true, nome: true, numero: true },
    });
    if (!exists) {
      return res.status(404).json({ erro: "Churrasqueira não encontrada." });
    }

    // (1) Conflito: já existe PERMANENTE ativo para (churrasqueira, diaSemana, turno)
    const conflitoPermanente = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
      where: {
        diaSemana,
        turno,
        churrasqueiraId,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: { id: true },
    });
    if (conflitoPermanente) {
      return res
        .status(409)
        .json({ erro: "Já existe um agendamento permanente nesse dia e turno." });
    }

    // (2) Conflito com COMUM existente no mesmo dia-da-semana e turno
    // Regra igual à de quadras: se há comum, exigimos 'dataInicio' (para começar depois)
    const comuns = await prisma.agendamentoChurrasqueira.findMany({
      where: {
        churrasqueiraId,
        turno,
        status: "CONFIRMADO",
      },
      select: { data: true },
    });
    const targetIdx = DIA_IDX[diaSemana];
    const possuiConflitoComum = comuns.some((c) => new Date(c.data).getUTCDay() === targetIdx);

    if (possuiConflitoComum && !dataInicio) {
      const sugestoes = await nextStartDateCandidatesChurras({
        churrasqueiraId,
        diaSemana,
        turno,
      });

      return res.status(409).json({
        erro:
          "Conflito com agendamento comum existente nesse dia da semana e turno. Informe uma dataInicio.",
        sugestoes,
      });
    }

    // 🔑 Resolve DONO (admin obrigatório nesta rota):
    let donoId = usuarioIdBody || "";
    if (!donoId && convidadosNomes.length > 0) {
      const convidado = await criarConvidadoComoUsuario(convidadosNomes[0]);
      donoId = convidado.id;
    }
    if (!donoId) {
      return res.status(400).json({
        erro: "Informe um usuário dono (usuarioId) ou um convidado em convidadosNomes.",
      });
    }

    const novo = await prisma.agendamentoPermanenteChurrasqueira.create({
      data: {
        diaSemana,
        turno,
        churrasqueiraId,
        usuarioId: donoId,
        dataInicio: dataInicio ?? null,
      },
    });

    // 📜 AUDIT: criação
    await logAudit({
      event: "CHURRAS_PERM_CREATE",
      req,
      target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id: novo.id },
      metadata: {
        permanenteId: novo.id,
        churrasqueiraId,
        diaSemana,
        turno,
        donoId,
        dataInicio: novo.dataInicio ? toISODateUTC(new Date(novo.dataInicio)) : null,
      },
    });

    return res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
  }
});

/* =========================================================
   📌 NOVO ENDPOINT — Próxima(s) data(s) disponível(is)
   (posicionado ANTES do GET /:id para não conflitar)
   ========================================================= */
/**
 * GET /churrasqueiras/permanentes/proxima-data-disponivel
 * Params (query):
 *   - churrasqueiraId (uuid) [obrigatório]
 *   - diaSemana (enum DiaSemana) [obrigatório]
 *   - turno (DIA|NOITE) [obrigatório]
 *   - from (YYYY-MM-DD) [opcional]
 *   - maxSemanas (1..52) [opcional]
 *   - maxSugestoes (1..20) [opcional]
 */
router.get("/proxima-data-disponivel", async (req, res) => {
  const churrasqueiraId = String(req.query.churrasqueiraId || "");
  const diaSemana = req.query.diaSemana as DiaSemana | undefined;
  const turno = req.query.turno as Turno | undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;

  const maxSemanas = Math.max(1, Math.min(52, Number(req.query.maxSemanas ?? 26)));
  const maxSugestoes = Math.max(1, Math.min(20, Number(req.query.maxSugestoes ?? 6)));

  if (!isUUID(churrasqueiraId) || !diaSemana || !turno) {
    return res.status(400).json({ erro: "Parâmetros obrigatórios: churrasqueiraId, diaSemana, turno." });
  }
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return res.status(400).json({ erro: "Parâmetro 'from' deve ser YYYY-MM-DD." });
  }

  try {
    // valida existência da churrasqueira
    const exists = await prisma.churrasqueira.findUnique({
      where: { id: churrasqueiraId },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ erro: "Churrasqueira não encontrada." });

    const out = await nextStartDateCandidatesChurras({
      churrasqueiraId,
      diaSemana,
      turno,
      fromISO: from,
      maxSemanas,
      maxSugestoes,
    });

    return res.json(out);
  } catch (e) {
    console.error("Erro em GET /churrasqueiras/permanentes/proxima-data-disponivel", e);
    return res.status(500).json({ erro: "Erro ao calcular próxima data disponível." });
  }

  function isUUID(id: string) {
    return /^[0-9a-fA-F-]{36}$/.test(id);
  }
});

/**
 * GET /churrasqueiras/permanentes/:id
 * Dono ou Admin
 */
router.get(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
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
        return res
          .status(404)
          .json({ erro: "Agendamento permanente de churrasqueira não encontrado" });
      }

      return res.json({
        id: agendamento.id,
        tipoReserva: "PERMANENTE",
        diaSemana: agendamento.diaSemana,
        turno: agendamento.turno,
        usuario: agendamento.usuario.nome,
        usuarioId: agendamento.usuario.id,
        churrasqueira: `${agendamento.churrasqueira.nome} (Nº ${agendamento.churrasqueira.numero})`,
        dataInicio: agendamento.dataInicio ?? null,
        status: agendamento.status,
      });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ erro: "Erro ao buscar agendamento permanente de churrasqueira" });
    }
  }
);

/**
 * ✅ NOVO — GET /churrasqueiras/permanentes/:id/datas-excecao
 * Lista datas elegíveis para registrar exceção (um dia cancelado).
 */
router.get(
  "/:id/datas-excecao",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    const meses = Number(req.query.meses ?? "1");
    const clampMeses = Number.isFinite(meses) && meses > 0 && meses <= 6 ? meses : 1;

    try {
      const perm = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: { id: true, diaSemana: true, dataInicio: true, status: true },
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

      const jaCanceladas = await prisma.agendamentoPermanenteChurrasqueiraCancelamento.findMany({
        where: { agendamentoPermanenteChurrasqueiraId: id, data: { gte: inicioJanela, lt: fimJanela } },
        select: { data: true },
      });
      const jaCanceladasSet = new Set(jaCanceladas.map((c) => toISODateUTC(new Date(c.data))));
      const elegiveis = todas.filter((iso) => !jaCanceladasSet.has(iso));

      return res.json({
        permanenteId: perm.id,
        inicioJanela: toISODateUTC(inicioJanela),
        fimJanela: toISODateUTC(fimJanela),
        diaSemana: perm.diaSemana,
        turno: undefined,
        datas: elegiveis,
        jaCanceladas: Array.from(jaCanceladasSet),
      });
    } catch (e) {
      console.error("Erro em GET /:id/datas-excecao", e);
      return res.status(500).json({ erro: "Erro ao listar datas para exceção" });
    }
  }
);

/**
 * ✅ NOVO — POST /churrasqueiras/permanentes/:id/cancelar-dia
 * Registra uma exceção para UMA data específica da recorrência.
 */
router.post(
  "/:id/cancelar-dia",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
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
      const perm = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: { id: true, usuarioId: true, diaSemana: true, dataInicio: true, status: true, churrasqueiraId: true, turno: true },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const dataUTC = toUtc00(iso);

      // data >= dataInicio (se existir)
      if (perm.dataInicio && startOfDay(dataUTC) < startOfDay(new Date(perm.dataInicio))) {
        return res.status(400).json({ erro: "Data anterior ao início do agendamento permanente." });
      }

      // dia da semana confere
      const idx = dataUTC.getUTCDay();
      if (idx !== DIA_IDX[perm.diaSemana as DiaSemana]) {
        return res.status(400).json({ erro: "Data não corresponde ao dia da semana do permanente." });
      }

      // evitar duplicidade
      const jaExiste = await prisma.agendamentoPermanenteChurrasqueiraCancelamento.findFirst({
        where: { agendamentoPermanenteChurrasqueiraId: id, data: dataUTC },
        select: { id: true },
      });
      if (jaExiste) {
        return res.status(409).json({ erro: "Esta data já está marcada como exceção para este permanente." });
      }

      const novo = await prisma.agendamentoPermanenteChurrasqueiraCancelamento.create({
        data: {
          agendamentoPermanenteChurrasqueiraId: id,
          data: dataUTC,
          motivo: motivo ?? null,
          criadoPorId: req.usuario!.usuarioLogadoId, // ⚠️ do token
        },
      });

      // 📜 AUDIT: exceção (um dia)
      await logAudit({
        event: "CHURRAS_PERM_EXCECAO",
        req,
        target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id },
        metadata: {
          permanenteId: id,
          churrasqueiraId: perm.churrasqueiraId,
          diaSemana: perm.diaSemana,
          turno: perm.turno,
          dataExcecao: iso,
          motivo: motivo ?? null,
          criadoPorId: req.usuario!.usuarioLogadoId,
          cancelamentoId: novo.id,
        },
      });

      return res.status(201).json({
        id: novo.id,
        agendamentoPermanenteChurrasqueiraId: id,
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

/**
 * POST /churrasqueiras/permanentes/cancelar/:id
 * Dono ou Admin — encerra a recorrência
 */
router.post(
  "/cancelar/:id",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

    const { id } = req.params;

    try {
      const antes = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: { status: true, churrasqueiraId: true, diaSemana: true, turno: true, usuarioId: true },
      });

      const agendamento = await prisma.agendamentoPermanenteChurrasqueira.update({
        where: { id },
        data: {
          status: "CANCELADO",
          canceladoPorId: req.usuario.usuarioLogadoId,
        },
      });

      // 📜 AUDIT: cancelar definitivo
      await logAudit({
        event: "CHURRAS_PERM_CANCEL",
        req,
        target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id },
        metadata: {
          permanenteId: id,
          churrasqueiraId: antes?.churrasqueiraId ?? null,
          diaSemana: antes?.diaSemana ?? null,
          turno: antes?.turno ?? null,
          statusAntes: antes?.status ?? null,
          statusDepois: "CANCELADO",
          canceladoPorId: req.usuario.usuarioLogadoId,
          donoId: antes?.usuarioId ?? null,
        },
      });

      return res.status(200).json({
        message: "Agendamento permanente de churrasqueira cancelado com sucesso.",
        agendamento,
      });
    } catch (error) {
      console.error("Erro ao cancelar agendamento permanente de churrasqueira:", error);
      return res
        .status(500)
        .json({ error: "Erro ao cancelar agendamento permanente de churrasqueira." });
    }
  }
);

/**
 * DELETE /churrasqueiras/permanentes/:id
 * Apenas Admin
 */
router.delete("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const antes = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id },
      select: { churrasqueiraId: true, diaSemana: true, turno: true, usuarioId: true, status: true },
    });

    await prisma.agendamentoPermanenteChurrasqueira.delete({
      where: { id },
    });

    // 📜 AUDIT: delete
    await logAudit({
      event: "CHURRAS_PERM_DELETE",
      req,
      target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id },
      metadata: {
        permanenteId: id,
        churrasqueiraId: antes?.churrasqueiraId ?? null,
        diaSemana: antes?.diaSemana ?? null,
        turno: antes?.turno ?? null,
        statusAntes: antes?.status ?? null,
        donoId: antes?.usuarioId ?? null,
      },
    });

    return res.json({ mensagem: "Agendamento permanente deletado com sucesso" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao deletar" });
  }
});

export default router;
