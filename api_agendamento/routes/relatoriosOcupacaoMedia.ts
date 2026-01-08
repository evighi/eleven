// routes/relatoriosOcupacaoMedia.ts
import { Router } from "express";
import { PrismaClient, DiaSemana, StatusAgendamento } from "@prisma/client";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

// 🔒 Tudo exige autenticação; e relatórios -> admin
router.use(verificarToken);

// ================= Helpers de horário local (America/Sao_Paulo) =================
const SP_TZ = process.env.TZ || "America/Sao_Paulo";

function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Converte "agora" para boundaries de DIA LOCAL, mas retornando o UTC00
 * do dia local (igual ao teu padrão de salvar YYYY-MM-DD -> 00:00Z).
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

const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

type TotaisPorDia = Record<string, number>;

function buildJanelaDias(diasJanela: number) {
  const { hojeUTC00 } = getStoredUtcBoundaryForLocalDay(new Date());
  const fimJanelaInclusiveUTC = hojeUTC00;

  const inicioJanelaUTC = new Date(fimJanelaInclusiveUTC);
  inicioJanelaUTC.setUTCDate(inicioJanelaUTC.getUTCDate() - (diasJanela - 1));

  const fimExclusiveUTC = new Date(fimJanelaInclusiveUTC);
  fimExclusiveUTC.setUTCDate(fimExclusiveUTC.getUTCDate() + 1);

  const isoOrder: string[] = [];
  const totals: TotaisPorDia = {};

  for (let i = 0; i < diasJanela; i++) {
    const d = new Date(inicioJanelaUTC);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = toISODateUTC(d);
    isoOrder.push(iso);
    totals[iso] = 0;
  }

  return {
    diasJanela,
    inicioJanelaUTC,
    fimJanelaInclusiveUTC,
    fimExclusiveUTC,
    inicioJanela: toISODateUTC(inicioJanelaUTC),
    fimJanelaInclusive: toISODateUTC(fimJanelaInclusiveUTC),
    isoOrder,
    totalsBase: totals,
  };
}

function sumMap(A: TotaisPorDia, B: TotaisPorDia) {
  for (const [k, v] of Object.entries(B)) {
    A[k] = (A[k] ?? 0) + v;
  }
  return A;
}

function buildResumo(janela: ReturnType<typeof buildJanelaDias>, totalByIso: TotaisPorDia) {
  const detalhesPorDia = Object.entries(totalByIso)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, total]) => ({ data, total }))
    .filter((x) => x.total > 0);

  const totalOcorrencias = detalhesPorDia.reduce((acc, x) => acc + x.total, 0);
  const diasComOcorrencia = detalhesPorDia.length;

  // ✅ Igual ao padrão do teu JSON de permanentes (divide só pelos dias que tiveram ocorrência)
  const mediaPorDia = diasComOcorrencia > 0 ? totalOcorrencias / diasComOcorrencia : 0;

  // (Extra útil) média considerando TODOS os dias da janela (inclui dias 0)
  const mediaPorDiaNaJanela = janela.diasJanela > 0 ? totalOcorrencias / janela.diasJanela : 0;

  return {
    diasJanela: janela.diasJanela,
    inicioJanela: janela.inicioJanela,
    fimJanelaInclusive: janela.fimJanelaInclusive,
    totalOcorrencias,
    diasComOcorrencia,
    mediaPorDia,
    mediaPorDiaNaJanela,
    detalhesPorDia,
  };
}

const STATUS_IGNORADOS: StatusAgendamento[] = [StatusAgendamento.CANCELADO, StatusAgendamento.TRANSFERIDO];

/* =========================================================
   QUADRAS: comuns + permanentes - exceções
   ========================================================= */
async function calcOcupacaoTotalQuadras(diasJanela: number) {
  const janela = buildJanelaDias(diasJanela);

  // ---------- COMUNS (Agendamento) ----------
  const comunsGrouped = await prisma.agendamento.groupBy({
    by: ["data"],
    where: {
      data: { gte: janela.inicioJanelaUTC, lt: janela.fimExclusiveUTC },
      status: { notIn: STATUS_IGNORADOS },
    },
    _count: { _all: true },
  });

  const comunsByIso: TotaisPorDia = { ...janela.totalsBase };
  for (const row of comunsGrouped) {
    const iso = toISODateUTC(new Date(row.data));
    if (iso in comunsByIso) comunsByIso[iso] = row._count._all;
  }

  // ---------- PERMANENTES (AgendamentoPermanente) ----------
  const permanentesAtivos = await prisma.agendamentoPermanente.findMany({
    where: { status: { notIn: STATUS_IGNORADOS } },
    select: { id: true, diaSemana: true, dataInicio: true },
  });

  const permIds = permanentesAtivos.map((p) => p.id);

  const excecoes = permIds.length
    ? await prisma.agendamentoPermanenteCancelamento.findMany({
        where: {
          agendamentoPermanenteId: { in: permIds },
          data: { gte: janela.inicioJanelaUTC, lt: janela.fimExclusiveUTC },
        },
        select: { agendamentoPermanenteId: true, data: true },
      })
    : [];

  const cancelSet = new Set<string>();
  for (const c of excecoes) {
    const iso = toISODateUTC(new Date(c.data));
    cancelSet.add(`${c.agendamentoPermanenteId}|${iso}`);
  }

  // pré-separa os dias da janela por weekday (UTC)
  const byWeekday: Record<number, Array<{ iso: string; d: Date }>> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };

  for (const iso of janela.isoOrder) {
    const d = new Date(`${iso}T00:00:00Z`);
    byWeekday[d.getUTCDay()].push({ iso, d });
  }

  const permByIso: TotaisPorDia = { ...janela.totalsBase };

  for (const p of permanentesAtivos) {
    const idx = DIA_IDX[p.diaSemana];
    const dias = byWeekday[idx] ?? [];
    const dataInicio = p.dataInicio ? new Date(p.dataInicio) : null;

    for (const { iso, d } of dias) {
      if (dataInicio && dataInicio > d) continue;
      if (cancelSet.has(`${p.id}|${iso}`)) continue;
      permByIso[iso] += 1;
    }
  }

  // ---------- TOTAL ----------
  const totalByIso: TotaisPorDia = { ...janela.totalsBase };
  sumMap(totalByIso, comunsByIso);
  sumMap(totalByIso, permByIso);

  const totalComuns = Object.values(comunsByIso).reduce((a, b) => a + b, 0);
  const totalPermanentes = Object.values(permByIso).reduce((a, b) => a + b, 0);
  const totalExcecoesNaJanela = excecoes.length;
  const totalPermanentesAtivos = permanentesAtivos.length;

  const resumo = buildResumo(janela, totalByIso);

  return {
    ...resumo,
    totalComuns,
    totalPermanentes,
    totalPermanentesAtivos,
    totalExcecoesNaJanela,
  };
}

/* =========================================================
   CHURRASQUEIRAS: comuns + permanentes - exceções
   ========================================================= */
async function calcOcupacaoTotalChurrasqueiras(diasJanela: number) {
  const janela = buildJanelaDias(diasJanela);

  // ---------- COMUNS (AgendamentoChurrasqueira) ----------
  const comunsGrouped = await prisma.agendamentoChurrasqueira.groupBy({
    by: ["data"],
    where: {
      data: { gte: janela.inicioJanelaUTC, lt: janela.fimExclusiveUTC },
      status: { notIn: STATUS_IGNORADOS },
    },
    _count: { _all: true },
  });

  const comunsByIso: TotaisPorDia = { ...janela.totalsBase };
  for (const row of comunsGrouped) {
    const iso = toISODateUTC(new Date(row.data));
    if (iso in comunsByIso) comunsByIso[iso] = row._count._all;
  }

  // ---------- PERMANENTES (AgendamentoPermanenteChurrasqueira) ----------
  const permanentesAtivos = await prisma.agendamentoPermanenteChurrasqueira.findMany({
    where: { status: { notIn: STATUS_IGNORADOS } },
    select: { id: true, diaSemana: true, dataInicio: true },
  });

  const permIds = permanentesAtivos.map((p) => p.id);

  const excecoes = permIds.length
    ? await prisma.agendamentoPermanenteChurrasqueiraCancelamento.findMany({
        where: {
          agendamentoPermanenteChurrasqueiraId: { in: permIds },
          data: { gte: janela.inicioJanelaUTC, lt: janela.fimExclusiveUTC },
        },
        select: { agendamentoPermanenteChurrasqueiraId: true, data: true },
      })
    : [];

  const cancelSet = new Set<string>();
  for (const c of excecoes) {
    const iso = toISODateUTC(new Date(c.data));
    cancelSet.add(`${c.agendamentoPermanenteChurrasqueiraId}|${iso}`);
  }

  const byWeekday: Record<number, Array<{ iso: string; d: Date }>> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };

  for (const iso of janela.isoOrder) {
    const d = new Date(`${iso}T00:00:00Z`);
    byWeekday[d.getUTCDay()].push({ iso, d });
  }

  const permByIso: TotaisPorDia = { ...janela.totalsBase };

  for (const p of permanentesAtivos) {
    const idx = DIA_IDX[p.diaSemana];
    const dias = byWeekday[idx] ?? [];
    const dataInicio = p.dataInicio ? new Date(p.dataInicio) : null;

    for (const { iso, d } of dias) {
      if (dataInicio && dataInicio > d) continue;
      if (cancelSet.has(`${p.id}|${iso}`)) continue;
      permByIso[iso] += 1;
    }
  }

  // ---------- TOTAL ----------
  const totalByIso: TotaisPorDia = { ...janela.totalsBase };
  sumMap(totalByIso, comunsByIso);
  sumMap(totalByIso, permByIso);

  const totalComuns = Object.values(comunsByIso).reduce((a, b) => a + b, 0);
  const totalPermanentes = Object.values(permByIso).reduce((a, b) => a + b, 0);
  const totalExcecoesNaJanela = excecoes.length;
  const totalPermanentesAtivos = permanentesAtivos.length;

  const resumo = buildResumo(janela, totalByIso);

  return {
    ...resumo,
    totalComuns,
    totalPermanentes,
    totalPermanentesAtivos,
    totalExcecoesNaJanela,
  };
}

/* =========================================================
   ROTAS
   ========================================================= */

// GET /relatorios/quadras/ocupacao-media?diasJanela=90
router.get("/quadras/ocupacao-media", requireAdmin, async (req, res) => {
  try {
    const diasJanela = clampInt(req.query.diasJanela ?? 90, 1, 365, 90);
    const out = await calcOcupacaoTotalQuadras(diasJanela);
    return res.json(out);
  } catch (e) {
    console.error("Erro em GET /relatorios/quadras/ocupacao-media", e);
    return res.status(500).json({ erro: "Erro ao calcular ocupação média total das quadras." });
  }
});

// GET /relatorios/churrasqueiras/ocupacao-media?diasJanela=90
router.get("/churrasqueiras/ocupacao-media", requireAdmin, async (req, res) => {
  try {
    const diasJanela = clampInt(req.query.diasJanela ?? 90, 1, 365, 90);
    const out = await calcOcupacaoTotalChurrasqueiras(diasJanela);
    return res.json(out);
  } catch (e) {
    console.error("Erro em GET /relatorios/churrasqueiras/ocupacao-media", e);
    return res
      .status(500)
      .json({ erro: "Erro ao calcular ocupação média total das churrasqueiras." });
  }
});

export default router;
