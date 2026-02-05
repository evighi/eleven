import { Router } from "express";
import {
  PrismaClient,
  StatusAgendamento,
  DiaSemana,
  TipoSessaoProfessor,
  AtendenteFeature,
} from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { requireAtendenteFeature } from "../middleware/atendenteFeatures"; // 👈 ADD

const prisma = new PrismaClient();
const router = Router();

// 🔒 exige login para tudo
router.use(verificarToken);

// 🔐 trava o módulo inteiro para ADMIN_ATENDENTE via feature flag
router.use(requireAtendenteFeature(AtendenteFeature.ATD_RELATORIOS));

/* =========================
   Helpers — CONSISTENTES com agendamentos*.ts
========================= */
const SP_TZ = process.env.TZ || "America/Sao_Paulo";

function localYMD(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // "YYYY-MM-DD"
}

function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}

function localWeekdayIndexOfYMD(ymd: string): number {
  // meio-dia -03:00 evita rollover
  return new Date(`${ymd}T12:00:00-03:00`).getUTCDay(); // 0..6
}

function addDaysLocalYMD(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return localYMD(d);
}

function hhmmToMinutes(hhmm: string): number {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function faixaDoMes(day: number, lastDay: number) {
  if (day >= 1 && day <= 7) return "1-7";
  if (day >= 8 && day <= 14) return "8-14";
  if (day >= 15 && day <= 21) return "15-21";
  return `22-${lastDay}`;
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

/* =========================
   Parse de intervalo
========================= */
function parseMesToLocalRange(mes: string) {
  // "YYYY-MM" em linha do tempo local
  const [yStr, mStr] = mes.split("-");
  const firstLocal = `${yStr}-${mStr}-01`;
  const nextMonthLocal =
    addDaysLocalYMD(addDaysLocalYMD(firstLocal, 27), 4).slice(0, 7) + "-01";
  const lastLocal = addDaysLocalYMD(nextMonthLocal, -1);
  return { fromYMD: firstLocal, toYMD: lastLocal };
}

/* =========================
   NOVO: janelas de AULA por esporte/dia (intervalos em minutos)
========================= */
type JanelaMap = Map<string, Array<{ ini: number; fim: number }>>;
// chave: `${esporteId}|${dayIdx}`

async function carregarJanelasAula(esporteIds: string[]): Promise<JanelaMap> {
  if (!esporteIds || esporteIds.length === 0) return new Map();
  const uniq = Array.from(new Set(esporteIds.filter(Boolean)));
  if (uniq.length === 0) return new Map();

  // ⚠️ Nome do model: EsporteJanelaAula (criado na sua migration)
  const rows = await prisma.esporteJanelaAula.findMany({
    where: { esporteId: { in: uniq }, ativo: true, tipoSessao: "AULA" },
    select: { esporteId: true, diaSemana: true, inicioHHMM: true, fimHHMM: true },
  });

  const map: JanelaMap = new Map();
  for (const r of rows) {
    const key = `${r.esporteId}|${DIA_IDX[r.diaSemana]}`;
    const arr = map.get(key) || [];
    arr.push({ ini: hhmmToMinutes(r.inicioHHMM), fim: hhmmToMinutes(r.fimHHMM) });
    map.set(key, arr);
  }
  return map;
}

/**
 * ✅ Fallback permissivo para evitar total zerado:
 * - Se esporteId for vazio/legado: PERMITE (true)
 * - Se houver janelas cadastradas para esporte/dia: exige estar DENTRO
 * - Se NÃO houver janelas cadastradas para esporte/dia: PERMITE (true)
 */
function isDentroDeJanelaAula(
  janelas: JanelaMap,
  esporteId: string,
  dayIdx: number,
  horarioHHMM: string,
  duracaoMin: number
): boolean {
  if (!esporteId) return true; // legado sem esporte → não restringe
  const key = `${esporteId}|${dayIdx}`;
  const slots = janelas.get(key) || [];
  if (slots.length === 0) return true; // ⚠️ sem janela → não restringe
  const ini = hhmmToMinutes(horarioHHMM);
  const fim = ini + duracaoMin;
  return slots.some((s) => overlaps(ini, fim, s.ini, s.fim));
}

/* =========================
   AULA EXTRA (config global)
========================= */
type AulaExtraCfg = {
  ativa: boolean;
  inicioHHMM: string;
  fimHHMM: string;
  valor: number;
};

async function carregarConfigAulaExtra(): Promise<AulaExtraCfg> {
  const cfg = await prisma.configuracaoSistema.findUnique({ where: { id: 1 } });

  const ativa = cfg?.aulaExtraAtiva ?? true;
  const inicioHHMM = cfg?.aulaExtraInicioHHMM ?? "18:00";
  const fimHHMM = cfg?.aulaExtraFimHHMM ?? "23:00";
  const valor = Number(cfg?.valorAulaExtra ?? 50);

  return {
    ativa: Boolean(ativa),
    inicioHHMM: String(inicioHHMM),
    fimHHMM: String(fimHHMM),
    valor: Number.isFinite(valor) ? valor : 50,
  };
}

function isDentroIntervaloHHMM(hhmm: string, iniHHMM: string, fimHHMM: string) {
  const t = hhmmToMinutes(hhmm);
  const ini = hhmmToMinutes(iniHHMM);
  const fim = hhmmToMinutes(fimHHMM);

  // intervalo normal [ini, fim)
  if (ini < fim) return t >= ini && t < fim;

  // intervalo atravessando meia-noite
  if (ini > fim) return t >= ini || t < fim;

  // ini == fim → vazio
  return false;
}

function valorUnitarioAula(params: {
  professorValorQuadra: number;
  horario: string;
  aulaExtra: AulaExtraCfg;
  valorQuadraCobrado?: any | null; // Prisma Decimal | number | null
}) {
  const { professorValorQuadra, horario, aulaExtra, valorQuadraCobrado } = params;

  // ✅ 1) prioridade absoluta: valor final salvo no agendamento
  if (valorQuadraCobrado !== null && valorQuadraCobrado !== undefined) {
    const n = Number(valorQuadraCobrado);
    return Number.isFinite(n) ? n : professorValorQuadra;
  }

  // ✅ 2) legado: calcula pela configuração global
  if (
    aulaExtra.ativa &&
    isDentroIntervaloHHMM(horario, aulaExtra.inicioHHMM, aulaExtra.fimHHMM)
  ) {
    return aulaExtra.valor;
  }

  return professorValorQuadra;
}

/* =========================
   Cálculo core (p/ um professor) — usa datasets carregados
========================= */
type ComumRow = {
  id?: string; // opcional, ajuda debug
  data: Date;
  horario: string;
  quadraId: string;
  esporteId: string; // 👈 NOVO
  tipoSessao: TipoSessaoProfessor | null;
  professorId: string | null; // informativo
  usuarioId: string; // 👈 ADD (legado)
  isencaoApoiado?: boolean | null; // 👈 não entra no VALOR
  valorQuadraCobrado?: any | null; // 👈 NOVO (Prisma Decimal)
};

type PermRow = {
  id?: string; // opcional, ajuda debug
  diaSemana: DiaSemana;
  horario: string;
  quadraId: string;
  esporteId: string; // 👈 NOVO
  dataInicio: Date | null;
  cancelamentos: { data: Date }[];
  tipoSessao: TipoSessaoProfessor | null;
  professorId: string | null; // informativo
  usuarioId: string; // 👈 ADD (legado)
  // (sem isenção aqui no schema)
};

type BloqueiosMap = Map<string, Array<{ ini: number; fim: number }>>;

/**
 * ✅ Helper robusto: garante que o row pertence ao professor (novo padrão + legado)
 * Isso impede dataset "global" de contaminar outros professores mesmo se o chamador errar.
 */
function pertenceAoProfessor(
  profId: string,
  row: { professorId: string | null; usuarioId: string }
) {
  // novo padrão
  if (row.professorId) return row.professorId === profId;

  // legado: quando professorId não existia e o professor era o dono
  return row.usuarioId === profId;
}

function computeResumoProfessorFromDatasets(
  professor: { id: string; nome: string; valorQuadra: any },
  {
    fromYMD,
    toYMD,
    duracaoMin,
    janelasAula,
    aulaExtraCfg,
  }: {
    fromYMD: string;
    toYMD: string;
    duracaoMin: number;
    janelasAula: JanelaMap;
    aulaExtraCfg: AulaExtraCfg;
  },
  comuns: ComumRow[],
  permanentes: PermRow[],
  bloqueiosMap: BloqueiosMap
) {
  const professorValorQuadra = Number(professor.valorQuadra ?? 0) || 0;

  const vistos = new Set<string>();
  const porDia = new Map<
    string,
    { aulas: number; apoiadas: number; valor: number; valorIsentado: number }
  >();

  const pushAula = (
    ymd: string,
    quadraId: string,
    horario: string,
    valorUnitario: number,
    apoiada: boolean
  ) => {
    const k = `${ymd}|${quadraId}|${horario}`;
    if (vistos.has(k)) return;
    vistos.add(k);

    const cur =
      porDia.get(ymd) || ({ aulas: 0, apoiadas: 0, valor: 0, valorIsentado: 0 } as const);

    const next = {
      aulas: cur.aulas + 1,
      apoiadas: cur.apoiadas + (apoiada ? 1 : 0),
      valor: cur.valor + (apoiada ? 0 : Math.max(0, valorUnitario)),
      valorIsentado:
        cur.valorIsentado + (apoiada ? Math.max(0, valorUnitario) : 0),
    };

    porDia.set(ymd, next);
  };

  // 1) Comuns — somente AULA (ou legado null ⇒ conta), dentro da janela AULA
  for (const ag of comuns) {
    if (!pertenceAoProfessor(professor.id, ag)) continue;
    if (ag.tipoSessao === "JOGO") continue;

    const ymd = toISODateUTC(ag.data);
    const wd = localWeekdayIndexOfYMD(ymd);

    if (
      !isDentroDeJanelaAula(
        janelasAula,
        ag.esporteId,
        wd,
        ag.horario,
        duracaoMin
      )
    )
      continue;

    // bloqueio?
    const slots = bloqueiosMap.get(`${ag.quadraId}|${ymd}`) || [];
    const ini = hhmmToMinutes(ag.horario);
    const fim = ini + duracaoMin;
    if (slots.some((s) => overlaps(ini, fim, s.ini, s.fim))) continue;

    const valorUnit = valorUnitarioAula({
      professorValorQuadra,
      horario: ag.horario,
      aulaExtra: aulaExtraCfg,
      valorQuadraCobrado: ag.valorQuadraCobrado ?? null,
    });

    pushAula(ymd, ag.quadraId, ag.horario, valorUnit, !!ag.isencaoApoiado);
  }

  // 2) Permanentes — somente AULA (ou legado null ⇒ conta), dentro da janela AULA
  for (const p of permanentes) {
    if (!pertenceAoProfessor(professor.id, p)) continue;
    if (p.tipoSessao === "JOGO") continue;

    const dayIdx = DIA_IDX[p.diaSemana];
    if (
      !isDentroDeJanelaAula(
        janelasAula,
        p.esporteId,
        dayIdx,
        p.horario,
        duracaoMin
      )
    )
      continue;

    const dataInicioLocalYMD = p.dataInicio
      ? toISODateUTC(new Date(p.dataInicio))
      : null;
    const firstYMD =
      dataInicioLocalYMD && dataInicioLocalYMD > fromYMD
        ? dataInicioLocalYMD
        : fromYMD;

    const curIdx = localWeekdayIndexOfYMD(firstYMD);
    const delta = (dayIdx - curIdx + 7) % 7;
    let dYMD = addDaysLocalYMD(firstYMD, delta);

    const excSet = new Set<string>(p.cancelamentos.map((c) => toISODateUTC(c.data)));

    while (dYMD <= toYMD) {
      if (!dataInicioLocalYMD || dYMD >= dataInicioLocalYMD) {
        if (!excSet.has(dYMD)) {
          const slots = bloqueiosMap.get(`${p.quadraId}|${dYMD}`) || [];
          const ini = hhmmToMinutes(p.horario);
          const fim = ini + duracaoMin;
          if (!slots.some((s) => overlaps(ini, fim, s.ini, s.fim))) {
            const valorUnit = valorUnitarioAula({
              professorValorQuadra,
              horario: p.horario,
              aulaExtra: aulaExtraCfg,
              valorQuadraCobrado: null, // permanentes não têm o campo
            });

            // ⚠️ Sem isenção no schema de permanentes — conta como paga
            pushAula(dYMD, p.quadraId, p.horario, valorUnit, false);
          }
        }
      }
      dYMD = addDaysLocalYMD(dYMD, 7);
    }
  }

  const porDiaArr = Array.from(porDia.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ymd, v]) => ({ data: ymd, aulas: v.aulas, valor: v.valor }));

  const lastDayNum = Number(toYMD.split("-")[2]);
  const porFaixaMap = new Map<string, { aulas: number; valor: number }>();
  for (const it of porDiaArr) {
    const dia = Number(it.data.split("-")[2]);
    const f = faixaDoMes(dia, lastDayNum);
    const cur = porFaixaMap.get(f) || { aulas: 0, valor: 0 };
    cur.aulas += it.aulas;
    cur.valor += it.valor;
    porFaixaMap.set(f, cur);
  }
  const porFaixa = Array.from(porFaixaMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([faixa, v]) => ({ faixa, aulas: v.aulas, valor: v.valor }));

  const totalMes = porFaixa.reduce(
    (acc, f) => ({ aulas: acc.aulas + f.aulas, valor: acc.valor + f.valor }),
    { aulas: 0, valor: 0 }
  );

  const valorIsentadoMes = Array.from(porDia.values()).reduce(
    (acc, v) => acc + (v.valorIsentado || 0),
    0
  );

  return {
    professor: {
      id: professor.id,
      nome: professor.nome,
      valorQuadra: professorValorQuadra,
    },
    totais: { porDia: porDiaArr, porFaixa, mes: totalMes, valorIsentadoMes },
  };
}

/* =========================
   Multas detalhadas por período e professor
   (status CONFIRMADO/FINALIZADO; professorId || legado usuarioId)
========================= */
async function multasDetalhadasPeriodoProfessor(
  profId: string,
  inicioUTC: Date,
  fimUTCExcl: Date
) {
  return prisma.agendamento.findMany({
    where: {
      status: {
        in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
      },
      data: { gte: inicioUTC, lt: fimUTCExcl },
      OR: [
        { professorId: profId },
        { AND: [{ professorId: null }, { usuarioId: profId }] },
      ],
      multa: { not: null },
      // 👇 IGNORA multas anuladas
      multaAnulada: { not: true },
    },
    select: {
      id: true,
      data: true,
      horario: true,
      multa: true,
      quadra: { select: { id: true, numero: true, nome: true } },
      esporte: { select: { id: true, nome: true } },
    },
    orderBy: [{ data: "asc" }, { horario: "asc" }],
  });
}

/* =========================
   Aulas com isenção (apoio) detalhadas no período
   (status CONFIRMADO/FINALIZADO; professorId || legado usuarioId)
========================= */
async function aulasApoiadasDetalhadasPeriodoProfessor(
  profId: string,
  inicioUTC: Date,
  fimUTCExcl: Date
) {
  return prisma.agendamento.findMany({
    where: {
      status: {
        in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
      },
      data: { gte: inicioUTC, lt: fimUTCExcl },
      OR: [
        { professorId: profId },
        { AND: [{ professorId: null }, { usuarioId: profId }] },
      ],
      isencaoApoiado: true,
    },
    select: {
      id: true,
      data: true,
      horario: true,
      quadra: { select: { id: true, numero: true, nome: true } },
      esporte: { select: { id: true, nome: true } },
      apoiadoUsuario: { select: { id: true, nome: true, email: true } },
      valorQuadraCobrado: true, // 👈 para exibir valor correto
    },
    orderBy: [{ data: "asc" }, { horario: "asc" }],
  });
}

/* =========================
   Aulas (agendamentos) detalhadas no período para o professor
   (status CONFIRMADO/FINALIZADO; professorId || legado usuarioId)
   Usado para listar todas as aulas do mês no quadro admin
========================= */
async function aulasDetalhadasPeriodoProfessor(
  profId: string,
  inicioUTC: Date,
  fimUTCExcl: Date,
  duracaoMin: number
) {
  // carrega professor (valor padrão)
  const professor = await prisma.usuario.findUnique({
    where: { id: profId },
    select: { id: true, valorQuadra: true },
  });
  const professorValorQuadra = Number(professor?.valorQuadra ?? 0) || 0;

  // config aula extra
  const aulaExtraCfg = await carregarConfigAulaExtra();

  const ags = await prisma.agendamento.findMany({
    where: {
      status: {
        in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
      },
      data: { gte: inicioUTC, lt: fimUTCExcl },
      AND: [
        {
          OR: [
            { professorId: profId },
            { AND: [{ professorId: null }, { usuarioId: profId }] }, // legado
          ],
        },
        { OR: [{ tipoSessao: "AULA" }, { tipoSessao: null }] }, // só AULA/legado
      ],
    },
    select: {
      id: true,
      data: true,
      horario: true,
      multa: true,
      multaAnulada: true,
      isencaoApoiado: true,
      valorQuadraCobrado: true, // 👈 NOVO
      quadra: { select: { id: true, numero: true, nome: true } },
      esporte: { select: { id: true, nome: true } },
      esporteId: true, // 👈 para checar janela
    },
    orderBy: [{ data: "asc" }, { horario: "asc" }],
  });

  // Carrega janelas AULA dos esportes presentes
  const esportesIn = Array.from(
    new Set(ags.map((a) => String(a.esporteId)).filter(Boolean))
  );
  const janelasAula = await carregarJanelasAula(esportesIn);

  // Filtra de acordo com janelas de AULA (com fallback permissivo)
  const filtradas = ags.filter((a) => {
    const ymd = toISODateUTC(a.data);
    const wd = localWeekdayIndexOfYMD(ymd);
    return isDentroDeJanelaAula(
      janelasAula,
      String(a.esporteId),
      wd,
      a.horario,
      duracaoMin
    );
  });

  // normaliza para já ignorar multas anuladas
  return filtradas.map((a) => {
    const valorAula = valorUnitarioAula({
      professorValorQuadra,
      horario: a.horario,
      aulaExtra: aulaExtraCfg,
      valorQuadraCobrado: a.valorQuadraCobrado ?? null,
    });

    const multaOk = a.multa != null && !a.multaAnulada ? Number(a.multa) : null;

    return {
      id: a.id,
      data: a.data,
      horario: a.horario,
      quadra: a.quadra,
      esporte: a.esporte,
      isencaoApoiado: !!a.isencaoApoiado,
      valorAula, // 👈 VALOR CORRETO (normal/extra ou salvo)
      multa: multaOk,
      valorTotal: Math.max(0, Number(valorAula || 0)) + Math.max(0, Number(multaOk || 0)),
    };
  });
}

// ✅ TOTAL de professores cadastrados (endpoint dedicado)
// GET /professores/total
router.get("/total", requireAdmin, async (_req, res) => {
  try {
    const total = await prisma.usuario.count({
      where: { tipo: "ADMIN_PROFESSORES" },
    });

    return res.json({ total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro ao buscar total de professores" });
  }
});

/* =========================================================
   GET /professores/me/resumo?mes=YYYY-MM
   ou ?from=YYYY-MM-DD&to=YYYY-MM-DD
   &duracaoMin=60 (opcional)
========================================================= */
router.get("/me/resumo", async (req, res) => {
  try {
    const qSchema = z
      .object({
        mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        duracaoMin: z.coerce.number().int().positive().optional(),
      })
      .refine(
        (v) => !!v.mes || (!!v.from && !!v.to),
        "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'."
      );

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos",
      });
    }
    const { mes, from, to, duracaoMin = 60 } = parsed.data;

    const userId = (req as any).usuario?.usuarioLogadoId;
    if (!userId) return res.status(401).json({ erro: "Não autenticado" });

    const professor = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { id: true, nome: true, valorQuadra: true },
    });
    if (!professor) return res.status(404).json({ erro: "Usuário não encontrado" });

    const { fromYMD, toYMD } = mes
      ? parseMesToLocalRange(mes)
      : { fromYMD: String(from), toYMD: String(to) };

    const inicioUTC = toUtc00(fromYMD);
    const fimUTCExcl = toUtc00(addDaysLocalYMD(toYMD, 1));

    const aulaExtraCfg = await carregarConfigAulaExtra();

    // SOMENTE AULAS (para contagem) + flag de isenção por agendamento comum
    const comuns = await prisma.agendamento.findMany({
      where: {
        status: {
          in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
        },
        data: { gte: inicioUTC, lt: fimUTCExcl },
        AND: [
          {
            OR: [
              { professorId: userId },
              { AND: [{ professorId: null }, { usuarioId: userId }] },
            ],
          },
          { OR: [{ tipoSessao: "AULA" }, { tipoSessao: null }] }, // legado
        ],
      },
      select: {
        id: true,
        data: true,
        horario: true,
        quadraId: true,
        usuarioId: true,
        tipoSessao: true,
        professorId: true,
        isencaoApoiado: true,
        esporteId: true,
        valorQuadraCobrado: true, // 👈 NOVO
      },
    });

    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        status: {
          in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
        },
        AND: [
          {
            OR: [
              { professorId: userId },
              { AND: [{ professorId: null }, { usuarioId: userId }] },
            ],
          },
          { OR: [{ tipoSessao: "AULA" }, { tipoSessao: null }] }, // legado
        ],
      },
      select: {
        id: true,
        usuarioId: true,
        diaSemana: true,
        horario: true,
        quadraId: true,
        dataInicio: true,
        cancelamentos: { select: { data: true } },
        tipoSessao: true,
        professorId: true,
        esporteId: true,
      },
    });

    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: { dataBloqueio: { gte: inicioUTC, lt: fimUTCExcl } },
      select: {
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        quadras: { select: { id: true } },
      },
    });

    const bloqueiosMap: BloqueiosMap = new Map();
    for (const b of bloqueios) {
      const ymd = toISODateUTC(b.dataBloqueio);
      const ini = hhmmToMinutes(b.inicioBloqueio);
      const fim = hhmmToMinutes(b.fimBloqueio);
      for (const q of b.quadras) {
        const k = `${q.id}|${ymd}`;
        const arr = bloqueiosMap.get(k) || [];
        arr.push({ ini, fim });
        bloqueiosMap.set(k, arr);
      }
    }

    // ====== CARREGAR JANELAS AULA DOS ESPORTES ENVOLVIDOS ======
    const esportesIn = Array.from(
      new Set(
        [
          ...comuns.map((c) => String(c.esporteId)),
          ...permanentes.map((p) => String(p.esporteId)),
        ].filter(Boolean)
      )
    );
    const janelasAula = await carregarJanelasAula(esportesIn);

    // datasets no formato do cálculo
    const comunsDs: ComumRow[] = comuns.map((ag) => ({
      id: ag.id,
      data: ag.data,
      horario: ag.horario,
      quadraId: ag.quadraId,
      esporteId: String(ag.esporteId),
      tipoSessao: ag.tipoSessao,
      professorId: ag.professorId,
      usuarioId: ag.usuarioId,
      isencaoApoiado: ag.isencaoApoiado ?? false,
      valorQuadraCobrado: (ag as any).valorQuadraCobrado ?? null,
    }));

    const permanentesDs: PermRow[] = permanentes.map((p) => ({
      id: p.id,
      usuarioId: p.usuarioId,
      diaSemana: p.diaSemana,
      horario: p.horario,
      quadraId: p.quadraId,
      esporteId: String(p.esporteId),
      dataInicio: p.dataInicio,
      cancelamentos: p.cancelamentos,
      tipoSessao: p.tipoSessao,
      professorId: p.professorId,
    }));

    const resumo = computeResumoProfessorFromDatasets(
      professor,
      { fromYMD, toYMD, duracaoMin, janelasAula, aulaExtraCfg },
      comunsDs,
      permanentesDs,
      bloqueiosMap
    );

    // subtotal das aulas do mês (SEM multa, já excluindo apoiadas)
    const subtotalAulasMes = resumo.totais.mes.valor;

    // multas detalhadas do período (indep. do tipoSessao) — já ignora anuladas
    const multasDetalhes = await multasDetalhadasPeriodoProfessor(userId, inicioUTC, fimUTCExcl);
    const multaMes = multasDetalhes.reduce((acc, m) => acc + Number(m.multa ?? 0), 0);

    // valor cheio: aulas + multas
    const valorMesComMulta = subtotalAulasMes + multaMes;

    // 💰 DESCONTO 50% APENAS NAS AULAS
    const subtotalAulasComDesconto = subtotalAulasMes * 0.5;
    const valorMesComDesconto = subtotalAulasComDesconto + multaMes;

    // apoios detalhados do período
    const apoiosDetalhes = await aulasApoiadasDetalhadasPeriodoProfessor(userId, inicioUTC, fimUTCExcl);
    const apoiadasMes = apoiosDetalhes.length;

    // ✅ valor correto isentado (considera aula normal/extra)
    const valorApoioDescontadoMes = Number((resumo as any).totais?.valorIsentadoMes ?? 0);

    // 🆕 todas as aulas do período (para aplicar multa manual no front)
    const aulasDetalhes = await aulasDetalhadasPeriodoProfessor(userId, inicioUTC, fimUTCExcl, duracaoMin);

    return res.json({
      professor: resumo.professor,
      intervalo: { from: fromYMD, to: toYMD, duracaoMin },
      totais: {
        ...resumo.totais,
        multaMes,
        valorMesComMulta,
        subtotalAulasComDesconto,
        valorMesComDesconto,
        apoiadasMes,
        valorApoioDescontadoMes,
      },
      multasDetalhes,
      apoiosDetalhes: apoiosDetalhes.map((a) => ({
        id: a.id,
        data: a.data,
        horario: a.horario,
        quadra: a.quadra,
        esporte: a.esporte,
        apoiadoUsuario: a.apoiadoUsuario,
        valorAula: Number(a.valorQuadraCobrado ?? 0) || null, // 👈 ajuda no front
      })),
      aulasDetalhes,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao calcular resumo do professor" });
  }
});

/* =========================================================
   GET /professores/:id/resumo  (ADMIN)
   Parâmetros iguais ao /me/resumo
========================================================= */
router.get("/:id/resumo", requireAdmin, async (req, res) => {
  try {
    const qSchema = z
      .object({
        mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        duracaoMin: z.coerce.number().int().positive().optional(),
      })
      .refine(
        (v) => !!v.mes || (!!v.from && !!v.to),
        "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'."
      );

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos",
      });
    }
    const { mes, from, to, duracaoMin = 60 } = parsed.data;

    const profId = req.params.id;

    const professor = await prisma.usuario.findUnique({
      where: { id: profId },
      select: { id: true, nome: true, valorQuadra: true },
    });
    if (!professor) return res.status(404).json({ erro: "Professor não encontrado" });

    const { fromYMD, toYMD } = mes
      ? parseMesToLocalRange(mes)
      : { fromYMD: String(from), toYMD: String(to) };

    const inicioUTC = toUtc00(fromYMD);
    const fimUTCExcl = toUtc00(addDaysLocalYMD(toYMD, 1));

    const aulaExtraCfg = await carregarConfigAulaExtra();

    const comuns = await prisma.agendamento.findMany({
      where: {
        status: {
          in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
        },
        data: { gte: inicioUTC, lt: fimUTCExcl },
        AND: [
          {
            OR: [
              { professorId: profId },
              { AND: [{ professorId: null }, { usuarioId: profId }] },
            ],
          },
          { OR: [{ tipoSessao: "AULA" }, { tipoSessao: null }] },
        ],
      },
      select: {
        id: true,
        data: true,
        horario: true,
        quadraId: true,
        usuarioId: true,
        tipoSessao: true,
        professorId: true,
        isencaoApoiado: true,
        esporteId: true,
        valorQuadraCobrado: true, // 👈 NOVO
      },
    });

    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        status: {
          in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
        },
        AND: [
          {
            OR: [
              { professorId: profId },
              { AND: [{ professorId: null }, { usuarioId: profId }] },
            ],
          },
          { OR: [{ tipoSessao: "AULA" }, { tipoSessao: null }] },
        ],
      },
      select: {
        id: true,
        usuarioId: true,
        diaSemana: true,
        horario: true,
        quadraId: true,
        dataInicio: true,
        cancelamentos: { select: { data: true } },
        tipoSessao: true,
        professorId: true,
        esporteId: true,
      },
    });

    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: { dataBloqueio: { gte: inicioUTC, lt: fimUTCExcl } },
      select: {
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        quadras: { select: { id: true } },
      },
    });

    const bloqueiosMap: BloqueiosMap = new Map();
    for (const b of bloqueios) {
      const ymd = toISODateUTC(b.dataBloqueio);
      const ini = hhmmToMinutes(b.inicioBloqueio);
      const fim = hhmmToMinutes(b.fimBloqueio);
      for (const q of b.quadras) {
        const k = `${q.id}|${ymd}`;
        const arr = bloqueiosMap.get(k) || [];
        arr.push({ ini, fim });
        bloqueiosMap.set(k, arr);
      }
    }

    // ====== CARREGAR JANELAS AULA DOS ESPORTES ENVOLVIDOS ======
    const esportesIn = Array.from(
      new Set(
        [
          ...comuns.map((c) => String(c.esporteId)),
          ...permanentes.map((p) => String(p.esporteId)),
        ].filter(Boolean)
      )
    );
    const janelasAula = await carregarJanelasAula(esportesIn);

    const comunsDs: ComumRow[] = comuns.map((ag) => ({
      id: ag.id,
      data: ag.data,
      horario: ag.horario,
      quadraId: ag.quadraId,
      esporteId: String(ag.esporteId),
      tipoSessao: ag.tipoSessao,
      professorId: ag.professorId,
      usuarioId: ag.usuarioId,
      isencaoApoiado: ag.isencaoApoiado ?? false,
      valorQuadraCobrado: (ag as any).valorQuadraCobrado ?? null,
    }));

    const permanentesDs: PermRow[] = permanentes.map((p) => ({
      id: p.id,
      usuarioId: p.usuarioId,
      diaSemana: p.diaSemana,
      horario: p.horario,
      quadraId: p.quadraId,
      esporteId: String(p.esporteId),
      dataInicio: p.dataInicio,
      cancelamentos: p.cancelamentos,
      tipoSessao: p.tipoSessao,
      professorId: p.professorId,
    }));

    const resumo = computeResumoProfessorFromDatasets(
      professor,
      { fromYMD, toYMD, duracaoMin, janelasAula, aulaExtraCfg },
      comunsDs,
      permanentesDs,
      bloqueiosMap
    );

    const subtotalAulasMes = resumo.totais.mes.valor;

    const multasDetalhes = await multasDetalhadasPeriodoProfessor(profId, inicioUTC, fimUTCExcl);
    const multaMes = multasDetalhes.reduce((acc, m) => acc + Number(m.multa ?? 0), 0);

    const valorMesComMulta = subtotalAulasMes + multaMes;

    const subtotalAulasComDesconto = subtotalAulasMes * 0.5;
    const valorMesComDesconto = subtotalAulasComDesconto + multaMes;

    const apoiosDetalhes = await aulasApoiadasDetalhadasPeriodoProfessor(profId, inicioUTC, fimUTCExcl);
    const apoiadasMes = apoiosDetalhes.length;

    const valorApoioDescontadoMes = Number((resumo as any).totais?.valorIsentadoMes ?? 0);

    const aulasDetalhes = await aulasDetalhadasPeriodoProfessor(profId, inicioUTC, fimUTCExcl, duracaoMin);

    return res.json({
      professor: resumo.professor,
      intervalo: { from: fromYMD, to: toYMD, duracaoMin },
      totais: {
        ...resumo.totais,
        multaMes,
        valorMesComMulta,
        subtotalAulasComDesconto,
        valorMesComDesconto,
        apoiadasMes,
        valorApoioDescontadoMes,
      },
      multasDetalhes,
      apoiosDetalhes: apoiosDetalhes.map((a) => ({
        id: a.id,
        data: a.data,
        horario: a.horario,
        quadra: a.quadra,
        esporte: a.esporte,
        apoiadoUsuario: a.apoiadoUsuario,
        valorAula: Number(a.valorQuadraCobrado ?? 0) || null,
      })),
      aulasDetalhes,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao calcular resumo do professor" });
  }
});

/* =========================================================
   GET /professores/admin  (ADMIN)
   Lista todos os professores com aulasMes e valorMes
   Params: ?mes=YYYY-MM OU from/to=YYYY-MM-DD, &duracaoMin
========================================================= */
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const qSchema = z
      .object({
        mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        duracaoMin: z.coerce.number().int().positive().optional(),
      })
      .refine(
        (v) => !!v.mes || (!!v.from && !!v.to),
        "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'."
      );

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos",
      });
    }
    const { mes, from, to, duracaoMin = 60 } = parsed.data;

    const { fromYMD, toYMD } = mes
      ? parseMesToLocalRange(mes)
      : { fromYMD: String(from), toYMD: String(to) };

    const inicioUTC = toUtc00(fromYMD);
    const fimUTCExcl = toUtc00(addDaysLocalYMD(toYMD, 1));

    const aulaExtraCfg = await carregarConfigAulaExtra();

    // 1) Todos os professores
    const professores = await prisma.usuario.findMany({
      where: { tipo: "ADMIN_PROFESSORES" },
      select: { id: true, nome: true, valorQuadra: true },
      orderBy: { nome: "asc" },
    });
    const profIds = professores.map((p) => p.id);
    const profIdSet = new Set(profIds);

    if (profIds.length === 0) {
      return res.json({
        intervalo: { from: fromYMD, to: toYMD, duracaoMin },
        professores: [],
        totalGeral: { aulas: 0, valor: 0 },
        totalGeralComDesconto: 0,
        totalApoiadasGeral: 0,
        totalApoioDescontadoGeral: 0,
      });
    }

    // 2) Carrega datasets em batch — SOMENTE AULAS
    const [comunsAll, permanentesAll, bloqueios, multasAll] = await Promise.all([
      prisma.agendamento.findMany({
        where: {
          status: {
            in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
          },
          data: { gte: inicioUTC, lt: fimUTCExcl },
          AND: [
            {
              OR: [
                { professorId: { in: profIds } },
                {
                  AND: [{ professorId: null }, { usuarioId: { in: profIds } }],
                },
              ],
            },
            { OR: [{ tipoSessao: "AULA" }, { tipoSessao: null }] }, // legado
          ],
        },
        select: {
          id: true,
          data: true,
          horario: true,
          quadraId: true,
          usuarioId: true,
          professorId: true,
          tipoSessao: true,
          isencaoApoiado: true,
          esporteId: true,
          valorQuadraCobrado: true, // 👈 NOVO
        },
      }),
      prisma.agendamentoPermanente.findMany({
        where: {
          status: {
            in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
          },
          AND: [
            {
              OR: [
                { professorId: { in: profIds } },
                {
                  AND: [{ professorId: null }, { usuarioId: { in: profIds } }],
                },
              ],
            },
            { OR: [{ tipoSessao: "AULA" }, { tipoSessao: null }] },
          ],
        },
        select: {
          id: true,
          usuarioId: true,
          diaSemana: true,
          horario: true,
          quadraId: true,
          dataInicio: true,
          cancelamentos: { select: { data: true } },
          professorId: true,
          tipoSessao: true,
          esporteId: true,
        },
      }),
      prisma.bloqueioQuadra.findMany({
        where: { dataBloqueio: { gte: inicioUTC, lt: fimUTCExcl } },
        select: {
          dataBloqueio: true,
          inicioBloqueio: true,
          fimBloqueio: true,
          quadras: { select: { id: true } },
        },
      }),
      // 🔢 multas do período (sem filtrar tipoSessao) — IGNORA anuladas
      prisma.agendamento.findMany({
        where: {
          status: {
            in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO],
          },
          data: { gte: inicioUTC, lt: fimUTCExcl },
          OR: [
            { professorId: { in: profIds } },
            {
              AND: [{ professorId: null }, { usuarioId: { in: profIds } }],
            },
          ],
          multa: { not: null },
          multaAnulada: { not: true },
        },
        select: { multa: true, professorId: true, usuarioId: true },
      }),
    ]);

    // 3) Index por professor (chave = professorId ?? usuarioId)
    const comunsByProf = new Map<string, ComumRow[]>();
    const apoiadasByProf = new Map<string, number>();
    for (const ag of comunsAll) {
      const key = ag.professorId ?? ag.usuarioId!;
      if (!profIdSet.has(key)) continue;

      const arr = comunsByProf.get(key) || [];
      arr.push({
        id: ag.id,
        data: ag.data,
        horario: ag.horario,
        quadraId: ag.quadraId,
        esporteId: String(ag.esporteId),
        tipoSessao: ag.tipoSessao,
        professorId: ag.professorId,
        usuarioId: ag.usuarioId,
        isencaoApoiado: ag.isencaoApoiado ?? false,
        valorQuadraCobrado: (ag as any).valorQuadraCobrado ?? null,
      });
      comunsByProf.set(key, arr);

      if (ag.isencaoApoiado) {
        apoiadasByProf.set(key, (apoiadasByProf.get(key) || 0) + 1);
      }
    }

    const permsByProf = new Map<string, PermRow[]>();
    for (const p of permanentesAll) {
      const key = p.professorId ?? p.usuarioId!;
      if (!profIdSet.has(key)) continue;

      const arr = permsByProf.get(key) || [];
      arr.push({
        id: p.id,
        diaSemana: p.diaSemana,
        horario: p.horario,
        quadraId: p.quadraId,
        esporteId: String(p.esporteId),
        dataInicio: p.dataInicio,
        cancelamentos: p.cancelamentos,
        tipoSessao: p.tipoSessao,
        professorId: p.professorId,
        usuarioId: p.usuarioId,
      });
      permsByProf.set(key, arr);
    }

    const bloqueiosMapAdmin: BloqueiosMap = new Map();
    for (const b of bloqueios) {
      const ymd = toISODateUTC(b.dataBloqueio);
      const ini = hhmmToMinutes(b.inicioBloqueio);
      const fim = hhmmToMinutes(b.fimBloqueio);
      for (const q of b.quadras) {
        const k = `${q.id}|${ymd}`;
        const arr = bloqueiosMapAdmin.get(k) || [];
        arr.push({ ini, fim });
        bloqueiosMapAdmin.set(k, arr);
      }
    }

    // 🔢 somatório de multa por professor (já sem anuladas)
    const multaByProf = new Map<string, number>();
    for (const m of multasAll) {
      const key = m.professorId ?? m.usuarioId!;
      if (!profIdSet.has(key)) continue;
      multaByProf.set(key, (multaByProf.get(key) || 0) + Number(m.multa ?? 0));
    }

    // ====== CARREGAR JANELAS AULA UMA ÚNICA VEZ PARA TODOS ======
    const esportesIn = Array.from(
      new Set(
        [
          ...comunsAll.map((c) => String(c.esporteId)),
          ...permanentesAll.map((p) => String(p.esporteId)),
        ].filter(Boolean)
      )
    );
    const janelasAula = await carregarJanelasAula(esportesIn);

    // 4) Agrega por professor
    const resposta: Array<{
      id: string;
      nome: string;
      valorQuadra: number;
      aulasMes: number;
      valorMes: number;
      multaMes: number;
      valorMesComMulta: number;
      valorMesComDesconto: number;
      apoiadasMes: number;
      valorApoioDescontadoMes: number;
      porFaixa: Array<{ faixa: string; aulas: number; valor: number }>;
    }> = [];

    let totalAulasGeral = 0;
    let totalValorGeral = 0; // inclui multa cheio
    let totalValorGeralComDesconto = 0; // inclui multa + 50% aulas
    let totalApoiadasGeral = 0;
    let totalApoioDescontadoGeral = 0;

    for (const prof of professores) {
      const resumo = computeResumoProfessorFromDatasets(
        prof,
        { fromYMD, toYMD, duracaoMin, janelasAula, aulaExtraCfg },
        comunsByProf.get(prof.id) || [],
        permsByProf.get(prof.id) || [],
        bloqueiosMapAdmin
      );

      const aulasMes = resumo.totais.mes.aulas;
      const valorMes = resumo.totais.mes.valor; // subtotal aulas (sem multa)
      const multaMes = Number(multaByProf.get(prof.id) ?? 0);
      const valorMesComMulta = valorMes + multaMes;

      // 💰 desconto 50% nas aulas, multa cheia
      const valorMesComDesconto = valorMes * 0.5 + multaMes;

      const apoiadasMes = Number(apoiadasByProf.get(prof.id) || 0);

      // ✅ valor correto isentado (considera aula normal/extra)
      const valorApoioDescontadoMes = Number((resumo as any).totais?.valorIsentadoMes ?? 0);

      totalAulasGeral += aulasMes;
      totalValorGeral += valorMesComMulta;
      totalValorGeralComDesconto += valorMesComDesconto;
      totalApoiadasGeral += apoiadasMes;
      totalApoioDescontadoGeral += valorApoioDescontadoMes;

      resposta.push({
        id: resumo.professor.id,
        nome: resumo.professor.nome,
        valorQuadra: resumo.professor.valorQuadra,
        aulasMes,
        valorMes,
        multaMes,
        valorMesComMulta,
        valorMesComDesconto,
        apoiadasMes,
        valorApoioDescontadoMes,
        porFaixa: resumo.totais.porFaixa,
      });
    }

    return res.json({
      intervalo: { from: fromYMD, to: toYMD, duracaoMin },
      professores: resposta,
      totalGeral: { aulas: totalAulasGeral, valor: totalValorGeral },
      totalValorGeralComDesconto,
      totalApoiadasGeral,
      totalApoioDescontadoGeral,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao listar professores" });
  }
});

export default router;
