import { Router } from "express";
import { PrismaClient, DiaSemana, Turno, AtendenteFeature } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { addDays, addMonths, startOfDay } from "date-fns";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin, requireOwnerByRecord } from "../middleware/acl";
import { requireAtendenteFeature } from "../middleware/atendenteFeatures";
import { logAudit, TargetType } from "../utils/audit";

// ✅ 🔔 NOTIF (24h por turno)
import {
  notifyAdminsChurrasPermanenteExcecaoSeDentro24h,
} from "../utils/notificacoes";

const prisma = new PrismaClient();
const router = Router();

// ✅ Features
// - ATD_PERMANENTES: criar/cancelar/deletar permanentes
// - ATD_AGENDAMENTOS: ver detalhe e mexer em exceções (cancelar-dia, datas-excecao, etc.)
const FEATURE_PERMANENTES: AtendenteFeature = "ATD_PERMANENTES";
const FEATURE_AGENDAMENTOS: AtendenteFeature = "ATD_AGENDAMENTOS";

// Middleware: só aplica feature se for ADMIN_ATENDENTE
function requireFeatureIfAtendente(feature: AtendenteFeature) {
  const inner = requireAtendenteFeature(feature);
  return (req: any, res: any, next: any) => {
    if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

    const tipo = req.usuario.usuarioLogadoTipo;
    if (tipo === "ADMIN_ATENDENTE") {
      return inner(req, res, next);
    }
    return next();
  };
}

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

const SP_TZ = process.env.TZ || "America/Sao_Paulo";

/**
 * Converte "hoje" local para o boundary armazenado no banco (00:00Z do dia local).
 * Isso bate com sua regra de armazenar data como "YYYY-MM-DD" => 00:00:00Z.
 */
function getStoredUtcBoundaryForLocalDay(dLocal = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(dLocal).split("-").map(Number);

  const hojeUTC00 = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0));
  const amanhaUTC00 = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0));

  return { hojeUTC00, amanhaUTC00 };
}

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
  usuarioId: z.string().uuid().optional(),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
  dataInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => toUtc00(s))
    .optional(),
});

// 🔒 todas as rotas exigem autenticação
router.use(verificarToken);

/* =========================================================
   ✅ RESUMO DE OCORRÊNCIAS (IGUAL AO JSON DAS QUADRAS)
   - continua sendo “admin” + (atendente precisa ATD_PERMANENTES)
   ========================================================= */
router.get(
  "/resumo-ocorrencias",
  requireFeatureIfAtendente(FEATURE_PERMANENTES),
  requireAdmin,
  async (req, res) => {
    try {
      const diasJanelaRaw = Number(req.query.diasJanela ?? 90);
      const diasJanela = Math.max(
        1,
        Math.min(365, Number.isFinite(diasJanelaRaw) ? diasJanelaRaw : 90)
      );

      const { hojeUTC00 } = getStoredUtcBoundaryForLocalDay(new Date());
      const fimJanelaInclusiveUTC = hojeUTC00;

      const inicioJanelaUTC = new Date(fimJanelaInclusiveUTC);
      inicioJanelaUTC.setUTCDate(inicioJanelaUTC.getUTCDate() - (diasJanela - 1));

      const inicioJanela = toISODateUTC(inicioJanelaUTC);
      const fimJanelaInclusive = toISODateUTC(fimJanelaInclusiveUTC);

      const fimExclusiveUTC = new Date(fimJanelaInclusiveUTC);
      fimExclusiveUTC.setUTCDate(fimExclusiveUTC.getUTCDate() + 1);

      const permanentesAtivos = await prisma.agendamentoPermanenteChurrasqueira.findMany({
        where: { status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
        select: { id: true, diaSemana: true, dataInicio: true },
      });

      const totalPermanentesAtivos = permanentesAtivos.length;
      const permIds = permanentesAtivos.map((p) => p.id);

      const excecoesNaJanela = permIds.length
        ? await prisma.agendamentoPermanenteChurrasqueiraCancelamento.findMany({
          where: {
            agendamentoPermanenteChurrasqueiraId: { in: permIds },
            data: { gte: inicioJanelaUTC, lt: fimExclusiveUTC },
          },
          select: { id: true, agendamentoPermanenteChurrasqueiraId: true, data: true },
        })
        : [];

      const totalExcecoesNaJanela = excecoesNaJanela.length;

      const cancelSet = new Set<string>();
      for (const c of excecoesNaJanela) {
        const iso = toISODateUTC(new Date(c.data));
        cancelSet.add(`${c.agendamentoPermanenteChurrasqueiraId}|${iso}`);
      }

      const totalsByIso: Record<string, number> = {};
      const isoOrder: string[] = [];

      const byWeekday: Record<number, Array<{ d: Date; iso: string }>> = {
        0: [],
        1: [],
        2: [],
        3: [],
        4: [],
        5: [],
        6: [],
      };

      for (let i = 0; i < diasJanela; i++) {
        const d = new Date(inicioJanelaUTC);
        d.setUTCDate(d.getUTCDate() + i);

        const iso = toISODateUTC(d);
        totalsByIso[iso] = 0;
        isoOrder.push(iso);

        byWeekday[d.getUTCDay()].push({ d, iso });
      }

      for (const p of permanentesAtivos) {
        const idx = DIA_IDX[p.diaSemana];
        const dias = byWeekday[idx] ?? [];

        for (const { d, iso } of dias) {
          if (p.dataInicio && new Date(p.dataInicio) > d) continue;
          if (cancelSet.has(`${p.id}|${iso}`)) continue;
          totalsByIso[iso] += 1;
        }
      }

      const detalhesPorDia = isoOrder
        .map((iso) => ({ data: iso, total: totalsByIso[iso] ?? 0 }))
        .filter((x) => x.total > 0);

      const totalOcorrencias = detalhesPorDia.reduce((acc, x) => acc + x.total, 0);
      const diasComOcorrencia = detalhesPorDia.length;
      const mediaPorDia = diasComOcorrencia > 0 ? totalOcorrencias / diasComOcorrencia : 0;

      return res.json({
        diasJanela,
        inicioJanela,
        fimJanelaInclusive,
        totalPermanentesAtivos,
        totalExcecoesNaJanela,
        totalOcorrencias,
        diasComOcorrencia,
        mediaPorDia,
        detalhesPorDia,
      });
    } catch (e) {
      console.error("Erro em GET /churrasqueiras/permanentes/resumo-ocorrencias", e);
      return res.status(500).json({ erro: "Erro ao calcular resumo de ocorrências (permanentes)." });
    }
  }
);

/* =========================================================
   📌 HELPERS PARA SUGESTÕES DE DATAINICIO
   ========================================================= */
function nextOnWeekdayUtc(base: Date, targetIdx: number) {
  const curIdx = base.getUTCDay();
  const delta = (targetIdx - curIdx + 7) % 7;
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

async function nextStartDateCandidatesChurras(params: {
  churrasqueiraId: string;
  diaSemana: DiaSemana;
  turno: Turno;
  fromISO?: string;
  maxSemanas?: number;
  maxSugestoes?: number;
}) {
  const { churrasqueiraId, diaSemana, turno, fromISO, maxSemanas = 26, maxSugestoes = 6 } = params;

  const hojeISO = new Date().toISOString().slice(0, 10);
  const base = fromISO ? toUtc00(fromISO) : toUtc00(hojeISO);

  const targetIdx = DIA_IDX[diaSemana];
  let d = nextOnWeekdayUtc(base, targetIdx);

  const sugestoes: string[] = [];
  let semanas = 0;

  while (semanas <= maxSemanas && sugestoes.length < maxSugestoes) {
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
 * ✅ atendente: só com ATD_PERMANENTES
 */
router.post(
  "/",
  requireFeatureIfAtendente(FEATURE_PERMANENTES),
  requireAdmin,
  async (req, res) => {
    const validacao = schemaAgendamentoPermanenteChurrasqueira.safeParse(req.body);
    if (!validacao.success) {
      const erros = validacao.error.errors.map((e) => {
        const path = e.path.join(".");
        return path ? `${path}: ${e.message}` : e.message;
      });
      return res.status(400).json({
        erro: erros.join("; ") || "Dados inválidos para agendamento permanente.",
      });
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
      const exists = await prisma.churrasqueira.findUnique({
        where: { id: churrasqueiraId },
        select: { id: true, nome: true, numero: true },
      });
      if (!exists) return res.status(404).json({ erro: "Churrasqueira não encontrada." });

      const conflitoPermanente = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
        where: { diaSemana, turno, churrasqueiraId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
        select: { id: true },
      });
      if (conflitoPermanente) {
        return res.status(409).json({ erro: "Já existe um agendamento permanente nesse dia e turno." });
      }

      const comuns = await prisma.agendamentoChurrasqueira.findMany({
        where: { churrasqueiraId, turno, status: "CONFIRMADO" },
        select: { data: true },
      });
      const targetIdx = DIA_IDX[diaSemana];
      const possuiConflitoComum = comuns.some((c) => new Date(c.data).getUTCDay() === targetIdx);

      if (possuiConflitoComum && !dataInicio) {
        const sugestoes = await nextStartDateCandidatesChurras({ churrasqueiraId, diaSemana, turno });
        return res.status(409).json({
          erro: "Conflito com agendamento comum existente nesse dia da semana e turno. Informe uma dataInicio.",
          sugestoes,
        });
      }

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
        data: { diaSemana, turno, churrasqueiraId, usuarioId: donoId, dataInicio: dataInicio ?? null },
      });

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
  }
);

/**
 * GET /churrasqueiras/permanentes/proxima-data-disponivel
 * ✅ atendente: só com ATD_PERMANENTES
 */
router.get(
  "/proxima-data-disponivel",
  requireFeatureIfAtendente(FEATURE_PERMANENTES),
  requireAdmin,
  async (req, res) => {
    const churrasqueiraId = String(req.query.churrasqueiraId || "");
    const diaSemana = req.query.diaSemana as DiaSemana | undefined;
    const turno = req.query.turno as Turno | undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;

    const maxSemanas = Math.max(1, Math.min(52, Number(req.query.maxSemanas ?? 26)));
    const maxSugestoes = Math.max(1, Math.min(20, Number(req.query.maxSugestoes ?? 6)));

    if (!/^[0-9a-fA-F-]{36}$/.test(churrasqueiraId) || !diaSemana || !turno) {
      return res.status(400).json({ erro: "Parâmetros obrigatórios: churrasqueiraId, diaSemana, turno." });
    }
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return res.status(400).json({ erro: "Parâmetro 'from' deve ser YYYY-MM-DD." });
    }

    try {
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
  }
);

/**
 * GET /churrasqueiras/permanentes/:id
 * Dono ou Admin
 * ✅ atendente: ATD_AGENDAMENTOS (não precisa ATD_PERMANENTES)
 */
router.get(
  "/:id",
  requireFeatureIfAtendente(FEATURE_AGENDAMENTOS),
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
          churrasqueira: { select: { id: true, nome: true, numero: true } },
        },
      });

      if (!agendamento) {
        return res.status(404).json({ erro: "Agendamento permanente de churrasqueira não encontrado" });
      }

      return res.json({
        id: agendamento.id,
        tipoReserva: "PERMANENTE",
        diaSemana: agendamento.diaSemana,
        turno: agendamento.turno,

        usuario: agendamento.usuario.nome,
        usuarioId: agendamento.usuario.id,

        churrasqueiraId: agendamento.churrasqueira?.id ?? null,
        churrasqueiraNome: agendamento.churrasqueira?.nome ?? null,
        churrasqueiraNumero: agendamento.churrasqueira?.numero ?? null,

        churrasqueira: agendamento.churrasqueira
          ? `${agendamento.churrasqueira.nome} (Nº ${agendamento.churrasqueira.numero})`
          : null,

        dataInicio: agendamento.dataInicio ?? null,
        status: agendamento.status,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao buscar agendamento permanente de churrasqueira" });
    }
  }
);

/**
 * GET /churrasqueiras/permanentes/:id/datas-excecao
 * ✅ atendente: ATD_AGENDAMENTOS
 */
router.get(
  "/:id/datas-excecao",
  requireFeatureIfAtendente(FEATURE_AGENDAMENTOS),
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
        where: {
          agendamentoPermanenteChurrasqueiraId: id,
          data: { gte: inicioJanela, lt: fimJanela },
        },
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
 * POST /churrasqueiras/permanentes/:id/cancelar-dia
 * ✅ atendente: ATD_AGENDAMENTOS
 */
router.post(
  "/:id/cancelar-dia",
  requireFeatureIfAtendente(FEATURE_AGENDAMENTOS),
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
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      motivo: z.string().trim().max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const erros = parsed.error.errors.map((e) => {
        const path = e.path.join(".");
        return path ? `${path}: ${e.message}` : e.message;
      });
      return res.status(400).json({ erro: erros.join("; ") || "Dados inválidos para cancelar dia." });
    }

    const { data: iso, motivo } = parsed.data;

    try {
      const perm = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: {
          id: true,
          usuarioId: true,
          diaSemana: true,
          dataInicio: true,
          status: true,
          churrasqueiraId: true,
          turno: true,
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const dataUTC = toUtc00(iso);

      if (perm.dataInicio && startOfDay(dataUTC) < startOfDay(new Date(perm.dataInicio))) {
        return res.status(400).json({ erro: "Data anterior ao início do agendamento permanente." });
      }

      const idx = dataUTC.getUTCDay();
      if (idx !== DIA_IDX[perm.diaSemana as DiaSemana]) {
        return res.status(400).json({ erro: "Data não corresponde ao dia da semana do permanente." });
      }

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
          criadoPorId: req.usuario!.usuarioLogadoId,
        },
      });

      // ✅ 🔔 NOTIF (se dentro de 24h do turno)
      try {
        const actorId = req.usuario!.usuarioLogadoId;
        const actorTipo = req.usuario!.usuarioLogadoTipo;

        const permForNotify = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
          where: { id },
          select: {
            id: true,
            diaSemana: true,
            turno: true,
            usuario: { select: { id: true, nome: true } },
            churrasqueira: { select: { id: true, nome: true, numero: true } },
          },
        });

        if (permForNotify) {
          await notifyAdminsChurrasPermanenteExcecaoSeDentro24h({
            permanente: permForNotify,
            ocorrenciaYMD: iso, // o dia cancelado
            actorId,
            actorTipo,
            motivo: motivo ?? null,
          });
        }
      } catch (e) {
        console.error("[notify] churras permanente excecao (24h) erro:", e);
      }

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

/* =========================================================
   ✅ Helper: próxima ocorrência (YYYY-MM-DD) de um diaSemana
   - base = hojeUTC00 (do dia local) para ficar alinhado com teu storage
   ========================================================= */
function nextOccurrenceISOFromTodayLocal(diaSemana: DiaSemana) {
  const { hojeUTC00 } = getStoredUtcBoundaryForLocalDay(new Date());
  const base = hojeUTC00; // 00:00Z do "hoje local"
  const targetIdx = DIA_IDX[diaSemana];

  let d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  while (d.getUTCDay() !== targetIdx) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return toISODateUTC(d); // "YYYY-MM-DD"
}

/**
 * POST /churrasqueiras/permanentes/cancelar/:id
 * (encerrar recorrência)
 * ✅ atendente: continua sendo ATD_PERMANENTES (não é exceção)
 */
router.post(
  "/cancelar/:id",
  requireFeatureIfAtendente(FEATURE_PERMANENTES),
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
        select: {
          id: true,
          status: true,
          churrasqueiraId: true,
          diaSemana: true,
          turno: true,
          usuarioId: true,
        },
      });

      if (!antes) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });

      const agendamento = await prisma.agendamentoPermanenteChurrasqueira.update({
        where: { id },
        data: {
          status: "CANCELADO",
          canceladoPorId: req.usuario.usuarioLogadoId,
        },
      });

      // ✅ 🔔 NOTIF (se a PRÓXIMA ocorrência do permanente está dentro de 24h)
      // Como o cancelamento é “da recorrência inteira”, usamos a próxima ocorrência (a mais próxima no calendário)
      try {
        const actorId = req.usuario.usuarioLogadoId;
        const actorTipo = req.usuario.usuarioLogadoTipo;

        const permForNotify = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
          where: { id },
          select: {
            id: true,
            diaSemana: true,
            turno: true,
            usuario: { select: { id: true, nome: true } },
            churrasqueira: { select: { id: true, nome: true, numero: true } },
          },
        });

        if (permForNotify) {
          const ocorrenciaYMD = nextOccurrenceISOFromTodayLocal(permForNotify.diaSemana as DiaSemana);

          // se tiver dataInicio e a próxima ocorrência calculada cair antes dela, pula pra próxima semana até bater
          // (evita notificação “antes de começar”)
          const dataInicio = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
            where: { id },
            select: { dataInicio: true },
          });

          let ocorr = ocorrenciaYMD;
          if (dataInicio?.dataInicio) {
            const startISO = toISODateUTC(new Date(dataInicio.dataInicio));
            // se ocorr < startISO => empurra de 7 em 7 até >= startISO
            let occDate = toUtc00(ocorr);
            while (toISODateUTC(occDate) < startISO) {
              occDate = new Date(Date.UTC(occDate.getUTCFullYear(), occDate.getUTCMonth(), occDate.getUTCDate() + 7));
            }
            ocorr = toISODateUTC(occDate);
          }

          await notifyAdminsChurrasPermanenteExcecaoSeDentro24h({
            permanente: permForNotify,
            ocorrenciaYMD: ocorr,
            actorId,
            actorTipo,
            motivo: "Cancelamento da recorrência",
          });
        }
      } catch (e) {
        console.error("[notify] churras permanente cancel (24h) erro:", e);
      }

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
      return res.status(500).json({ error: "Erro ao cancelar agendamento permanente de churrasqueira." });
    }
  }
);

/**
 * DELETE /churrasqueiras/permanentes/:id
 * ✅ atendente: ATD_PERMANENTES
 */
router.delete(
  "/:id",
  requireFeatureIfAtendente(FEATURE_PERMANENTES),
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      const antes = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: {
          churrasqueiraId: true,
          diaSemana: true,
          turno: true,
          usuarioId: true,
          status: true,
        },
      });

      await prisma.agendamentoPermanenteChurrasqueira.delete({
        where: { id },
      });

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
  }
);

export default router;
