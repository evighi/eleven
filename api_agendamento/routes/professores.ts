// routes/professores.ts
import { Router } from "express";
import { PrismaClient, StatusAgendamento, DiaSemana, TipoSessaoProfessor } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

// 🔒 exige login para tudo
router.use(verificarToken);

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
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
};

/* =========================
   Regra — excluir noite em dias úteis
========================= */
const EXCLUDE_EVENING = new Set(["18:00","19:00","20:00","21:00","22:00","23:00"]);
const isWeekdayIdx = (idx: number) => idx >= 1 && idx <= 5;

/* =========================
   Parse de intervalo
========================= */
function parseMesToLocalRange(mes: string) {
  // "YYYY-MM" em linha do tempo local
  const [yStr, mStr] = mes.split("-");
  const firstLocal = `${yStr}-${mStr}-01`;
  const nextMonthLocal = addDaysLocalYMD(addDaysLocalYMD(firstLocal, 27), 4).slice(0, 7) + "-01";
  const lastLocal = addDaysLocalYMD(nextMonthLocal, -1);
  return { fromYMD: firstLocal, toYMD: lastLocal };
}

/* =========================
   Cálculo core (p/ um professor) — usa datasets carregados
========================= */
type ComumRow = {
  data: Date;
  horario: string;
  quadraId: string;
  tipoSessao: TipoSessaoProfessor | null;
  professorId: string | null; // apenas informativo aqui (datasets já filtrados por professor)
};
type PermRow = {
  diaSemana: DiaSemana;
  horario: string;
  quadraId: string;
  dataInicio: Date | null;
  cancelamentos: { data: Date }[];
  tipoSessao: TipoSessaoProfessor | null;
  professorId: string | null; // idem acima
};
type BloqueiosMap = Map<string, Array<{ ini: number; fim: number }>>;

function computeResumoProfessorFromDatasets(
  professor: { id: string; nome: string; valorQuadra: any },
  { fromYMD, toYMD, duracaoMin }: { fromYMD: string; toYMD: string; duracaoMin: number },
  comuns: ComumRow[],
  permanentes: PermRow[],
  bloqueiosMap: BloqueiosMap
) {
  const vistos = new Set<string>();
  const porDia = new Map<string, number>();

  const pushAula = (ymd: string, quadraId: string, horario: string) => {
    const k = `${ymd}|${quadraId}|${horario}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    porDia.set(ymd, (porDia.get(ymd) || 0) + 1);
  };

  // 1) Comuns — somente AULA (ou legado null ⇒ conta)
  for (const ag of comuns) {
    if (ag.tipoSessao === "JOGO") continue;

    const ymd = toISODateUTC(ag.data); // storage é 00:00Z do dia local
    // regra: 18–23h seg–sex nunca conta como aula
    const wd = localWeekdayIndexOfYMD(ymd);
    if (isWeekdayIdx(wd) && EXCLUDE_EVENING.has(ag.horario)) continue;

    // bloqueio?
    const slots = bloqueiosMap.get(`${ag.quadraId}|${ymd}`) || [];
    const ini = hhmmToMinutes(ag.horario);
    const fim = ini + duracaoMin;
    if (slots.some(s => overlaps(ini, fim, s.ini, s.fim))) continue;

    pushAula(ymd, ag.quadraId, ag.horario);
  }

  // 2) Permanentes — somente AULA (ou legado null ⇒ conta)
  for (const p of permanentes) {
    if (p.tipoSessao === "JOGO") continue;

    const dayIdx = DIA_IDX[p.diaSemana];
    if (isWeekdayIdx(dayIdx) && EXCLUDE_EVENING.has(p.horario)) continue;

    const dataInicioLocalYMD = p.dataInicio ? toISODateUTC(new Date(p.dataInicio)) : null;
    const firstYMD =
      dataInicioLocalYMD && dataInicioLocalYMD > fromYMD ? dataInicioLocalYMD : fromYMD;

    const curIdx = localWeekdayIndexOfYMD(firstYMD);
    const delta = (dayIdx - curIdx + 7) % 7;
    let dYMD = addDaysLocalYMD(firstYMD, delta);

    const excSet = new Set<string>(p.cancelamentos.map(c => toISODateUTC(c.data)));

    while (dYMD <= toYMD) {
      if (!dataInicioLocalYMD || dYMD >= dataInicioLocalYMD) {
        if (!excSet.has(dYMD)) {
          const slots = bloqueiosMap.get(`${p.quadraId}|${dYMD}`) || [];
          const ini = hhmmToMinutes(p.horario);
          const fim = ini + duracaoMin;
          if (!slots.some(s => overlaps(ini, fim, s.ini, s.fim))) {
            pushAula(dYMD, p.quadraId, p.horario);
          }
        }
      }
      dYMD = addDaysLocalYMD(dYMD, 7);
    }
  }

  const valorAula = Number(professor.valorQuadra ?? 0) || 0;

  const porDiaArr = Array.from(porDia.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ymd, aulas]) => ({ data: ymd, aulas, valor: aulas * valorAula }));

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

  return {
    professor: { id: professor.id, nome: professor.nome, valorQuadra: valorAula },
    totais: { porDia: porDiaArr, porFaixa, mes: totalMes },
  };
}

/* =========================================================
   GET /professores/me/resumo?mes=YYYY-MM
   ou ?from=YYYY-MM-DD&to=YYYY-MM-DD
   &duracaoMin=60 (opcional)
========================================================= */
router.get("/me/resumo", async (req, res) => {
  try {
    const qSchema = z.object({
      mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d2-\d{2}$/).optional(),
      duracaoMin: z.coerce.number().int().positive().optional(),
    }).refine(v => !!v.mes || (!!v.from && !!v.to),
      "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'.");

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos" });
    }
    const { mes, from, to, duracaoMin = 60 } = parsed.data;

    const userId = req.usuario?.usuarioLogadoId;
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

    // SOMENTE AULAS, e atribuição por professorId (ou legado por usuarioId)
    const comuns = await prisma.agendamento.findMany({
      where: {
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
        data: { gte: inicioUTC, lt: fimUTCExcl },
        AND: [
          {
            OR: [
              { professorId: userId },
              { AND: [{ professorId: null }, { usuarioId: userId }] },
            ],
          },
          {
            OR: [
              { tipoSessao: "AULA" },
              { tipoSessao: null }, // legado: conta como aula
            ],
          },
        ],
      },
      select: { data: true, horario: true, quadraId: true, tipoSessao: true, professorId: true },
    });

    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
        AND: [
          {
            OR: [
              { professorId: userId },
              { AND: [{ professorId: null }, { usuarioId: userId }] },
            ],
          },
          {
            OR: [
              { tipoSessao: "AULA" },
              { tipoSessao: null }, // legado
            ],
          },
        ],
      },
      select: {
        diaSemana: true, horario: true, quadraId: true, dataInicio: true,
        cancelamentos: { select: { data: true } },
        tipoSessao: true, professorId: true,
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

    const resumo = computeResumoProfessorFromDatasets(
      professor,
      { fromYMD, toYMD, duracaoMin },
      comuns,
      permanentes,
      bloqueiosMap
    );

    return res.json({
      professor: resumo.professor,
      intervalo: { from: fromYMD, to: toYMD, duracaoMin },
      totais: resumo.totais,
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
    const qSchema = z.object({
      mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      duracaoMin: z.coerce.number().int().positive().optional(),
    }).refine(v => !!v.mes || (!!v.from && !!v.to),
      "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'.");

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos" });
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

    const comuns = await prisma.agendamento.findMany({
      where: {
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
        data: { gte: inicioUTC, lt: fimUTCExcl },
        AND: [
          {
            OR: [
              { professorId: profId },
              { AND: [{ professorId: null }, { usuarioId: profId }] },
            ],
          },
          {
            OR: [
              { tipoSessao: "AULA" },
              { tipoSessao: null },
            ],
          },
        ],
      },
      select: { data: true, horario: true, quadraId: true, tipoSessao: true, professorId: true },
    });

    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
        AND: [
          {
            OR: [
              { professorId: profId },
              { AND: [{ professorId: null }, { usuarioId: profId }] },
            ],
          },
          {
            OR: [
              { tipoSessao: "AULA" },
              { tipoSessao: null },
            ],
          },
        ],
      },
      select: {
        diaSemana: true, horario: true, quadraId: true, dataInicio: true,
        cancelamentos: { select: { data: true } },
        tipoSessao: true, professorId: true,
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

    const resumo = computeResumoProfessorFromDatasets(
      professor,
      { fromYMD, toYMD, duracaoMin },
      comuns,
      permanentes,
      bloqueiosMap
    );

    return res.json({
      professor: resumo.professor,
      intervalo: { from: fromYMD, to: toYMD, duracaoMin },
      totais: resumo.totais,
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
    const qSchema = z.object({
      mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      duracaoMin: z.coerce.number().int().positive().optional(),
    }).refine(v => !!v.mes || (!!v.from && !!v.to),
      "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'.");

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos" });
    }
    const { mes, from, to, duracaoMin = 60 } = parsed.data;

    const { fromYMD, toYMD } = mes
      ? parseMesToLocalRange(mes)
      : { fromYMD: String(from), toYMD: String(to) };

    const inicioUTC = toUtc00(fromYMD);
    const fimUTCExcl = toUtc00(addDaysLocalYMD(toYMD, 1));

    // 1) Todos os professores
    const professores = await prisma.usuario.findMany({
      where: { tipo: "ADMIN_PROFESSORES" },
      select: { id: true, nome: true, valorQuadra: true },
      orderBy: { nome: "asc" },
    });
    const profIds = professores.map(p => p.id);
    const profIdSet = new Set(profIds);

    if (profIds.length === 0) {
      return res.json({
        intervalo: { from: fromYMD, to: toYMD, duracaoMin },
        professores: [],
        totalGeral: { aulas: 0, valor: 0 },
      });
    }

    // 2) Carrega datasets em batch — SOMENTE AULAS e atribuição por professorId || usuarioId (legado)
    const [comunsAll, permanentesAll, bloqueios] = await Promise.all([
      prisma.agendamento.findMany({
        where: {
          status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
          data: { gte: inicioUTC, lt: fimUTCExcl },
          AND: [
            {
              OR: [
                { professorId: { in: profIds } },
                { AND: [{ professorId: null }, { usuarioId: { in: profIds } }] },
              ],
            },
            {
              OR: [
                { tipoSessao: "AULA" },
                { tipoSessao: null }, // legado
              ],
            },
          ],
        },
        select: { data: true, horario: true, quadraId: true, usuarioId: true, professorId: true, tipoSessao: true },
      }),
      prisma.agendamentoPermanente.findMany({
        where: {
          status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
          AND: [
            {
              OR: [
                { professorId: { in: profIds } },
                { AND: [{ professorId: null }, { usuarioId: { in: profIds } }] },
              ],
            },
            {
              OR: [
                { tipoSessao: "AULA" },
                { tipoSessao: null },
              ],
            },
          ],
        },
        select: {
          usuarioId: true,
          diaSemana: true, horario: true, quadraId: true, dataInicio: true,
          cancelamentos: { select: { data: true } },
          professorId: true, tipoSessao: true,
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
    ]);

    // 3) Index por professor (chave = professorId ?? usuarioId)
    const comunsByProf = new Map<string, ComumRow[]>();
    for (const ag of comunsAll) {
      const key = ag.professorId ?? ag.usuarioId;
      if (!profIdSet.has(key)) continue;
      const arr = comunsByProf.get(key) || [];
      arr.push({
        data: ag.data,
        horario: ag.horario,
        quadraId: ag.quadraId,
        tipoSessao: ag.tipoSessao,
        professorId: ag.professorId,
      });
      comunsByProf.set(key, arr);
    }

    const permsByProf = new Map<string, PermRow[]>();
    for (const p of permanentesAll) {
      const key = p.professorId ?? p.usuarioId;
      if (!profIdSet.has(key)) continue;
      const arr = permsByProf.get(key) || [];
      arr.push({
        diaSemana: p.diaSemana,
        horario: p.horario,
        quadraId: p.quadraId,
        dataInicio: p.dataInicio,
        cancelamentos: p.cancelamentos,
        tipoSessao: p.tipoSessao,
        professorId: p.professorId,
      });
      permsByProf.set(key, arr);
    }

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

    // 4) Agrega por professor
    const resposta: Array<{
      id: string;
      nome: string;
      valorQuadra: number;
      aulasMes: number;
      valorMes: number;
      porFaixa: Array<{ faixa: string; aulas: number; valor: number }>;
    }> = [];
    let totalAulasGeral = 0;
    let totalValorGeral = 0;

    for (const prof of professores) {
      const resumo = computeResumoProfessorFromDatasets(
        prof,
        { fromYMD, toYMD, duracaoMin },
        comunsByProf.get(prof.id) || [],
        permsByProf.get(prof.id) || [],
        bloqueiosMap
      );

      const aulasMes = resumo.totais.mes.aulas;
      const valorMes = resumo.totais.mes.valor;

      totalAulasGeral += aulasMes;
      totalValorGeral += valorMes;

      resposta.push({
        id: resumo.professor.id,
        nome: resumo.professor.nome,
        valorQuadra: resumo.professor.valorQuadra,
        aulasMes,
        valorMes,
        porFaixa: resumo.totais.porFaixa,
      });
    }

    return res.json({
      intervalo: { from: fromYMD, to: toYMD, duracaoMin },
      professores: resposta,
      totalGeral: { aulas: totalAulasGeral, valor: totalValorGeral },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao listar professores" });
  }
});

export default router;
