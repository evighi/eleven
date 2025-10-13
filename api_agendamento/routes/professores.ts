// routes/professores.ts
import { Router } from "express";
import { PrismaClient, StatusAgendamento, DiaSemana } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";

const prisma = new PrismaClient();
const router = Router();

// 🔒 exige login
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
  const nextMonthLocal = addDaysLocalYMD(addDaysLocalYMD(firstLocal, 27), 4) // garante rolar
    .slice(0, 7) + "-01";
  const lastLocal = addDaysLocalYMD(nextMonthLocal, -1);
  return { fromYMD: firstLocal, toYMD: lastLocal };
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
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      duracaoMin: z.coerce.number().int().positive().optional(),
    }).refine(v => !!v.mes || (!!v.from && !!v.to),
      "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'.");

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos" });
    }
    const { mes, from, to, duracaoMin = 60 } = parsed.data;

    // usuário logado
    const userId = req.usuario?.usuarioLogadoId;
    if (!userId) return res.status(401).json({ erro: "Não autenticado" });

    // professor (valorQuadra)
    const professor = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { id: true, nome: true, valorQuadra: true },
    });
    if (!professor) return res.status(404).json({ erro: "Usuário não encontrado" });

    // intervalo em YMD local
    const { fromYMD, toYMD } = mes
      ? parseMesToLocalRange(mes)
      : { fromYMD: String(from), toYMD: String(to) };

    // boundaries de consulta em UTC00 (meio-aberto)
    const inicioUTC = toUtc00(fromYMD);                  // >=
    const fimUTCExcl = toUtc00(addDaysLocalYMD(toYMD, 1)); // <

    // === COMUNS no intervalo (UTC boundaries corretos)
    const comuns = await prisma.agendamento.findMany({
      where: {
        usuarioId: userId,
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
        data: { gte: inicioUTC, lt: fimUTCExcl },
      },
      select: { id: true, data: true, horario: true, quadraId: true },
    });

    // === PERMANENTES ativos do professor
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        usuarioId: userId,
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
      },
      select: {
        id: true, diaSemana: true, horario: true, quadraId: true, dataInicio: true,
        cancelamentos: { select: { data: true } },
      },
    });

    // === BLOQUEIOS no intervalo (carrega tudo e indexa por (quadraId|YMD))
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: { dataBloqueio: { gte: inicioUTC, lt: fimUTCExcl } },
      select: {
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        quadras: { select: { id: true } },
      },
    });

    const bloqueiosMap = new Map<string, Array<{ ini: number; fim: number }>>();
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

    // === Coletores
    const vistos = new Set<string>(); // dedupe por (ymd|quadra|hora)
    const porDia = new Map<string, number>(); // ymd -> aulas

    const pushAula = (ymd: string, quadraId: string, horario: string) => {
      const k = `${ymd}|${quadraId}|${horario}`;
      if (vistos.has(k)) return;
      vistos.add(k);
      porDia.set(ymd, (porDia.get(ymd) || 0) + 1);
    };

    // === 1) COMUNS
    for (const ag of comuns) {
      // ymd local do comum (você salva 00:00Z do dia local -> pegar .toISOString().slice(0,10) é exato)
      const ymd = toISODateUTC(ag.data);

      // regra 18–23h apenas em dias úteis (SEG..SEX)
      const wd = localWeekdayIndexOfYMD(ymd);
      if (isWeekdayIdx(wd) && EXCLUDE_EVENING.has(ag.horario)) continue;

      // bloqueio?
      const slots = bloqueiosMap.get(`${ag.quadraId}|${ymd}`) || [];
      const ini = hhmmToMinutes(ag.horario);
      const fim = ini + duracaoMin;
      if (slots.some(s => overlaps(ini, fim, s.ini, s.fim))) continue;

      pushAula(ymd, ag.quadraId, ag.horario);
    }

    // === 2) PERMANENTES (expandindo em linha do tempo local)
    for (const p of permanentes) {
      // regra 18–23h para permanentes em dias úteis — ignora todo o slot
      const dayIdx = DIA_IDX[p.diaSemana];
      if (isWeekdayIdx(dayIdx) && EXCLUDE_EVENING.has(p.horario)) continue;

      // início efetivo em YMD local
      const dataInicioLocalYMD = p.dataInicio ? toISODateUTC(new Date(p.dataInicio)) : null;
      const firstYMD = dataInicioLocalYMD && dataInicioLocalYMD > fromYMD ? dataInicioLocalYMD : fromYMD;

      // encontra a primeira ocorrência do dia-da-semana >= firstYMD
      const curIdx = localWeekdayIndexOfYMD(firstYMD);
      const delta = (dayIdx - curIdx + 7) % 7;
      let dYMD = addDaysLocalYMD(firstYMD, delta);

      // exceções em Set<YMD>
      const excSet = new Set<string>(p.cancelamentos.map(c => toISODateUTC(c.data)));

      // percorre até toYMD, pulando exceções e bloqueios
      while (dYMD <= toYMD) {
        // respeita dataInicio
        if (!dataInicioLocalYMD || dYMD >= dataInicioLocalYMD) {
          if (!excSet.has(dYMD)) {
            // bloqueio?
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

    // === Totais / resposta
    const valorAula = Number(professor.valorQuadra ?? 0) || 0;

    const porDiaArr = Array.from(porDia.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ymd, aulas]) => ({ data: ymd, aulas, valor: aulas * valorAula }));

    // Faixas do mês baseadas no 'mes' (se houver) ou no 'toYMD'
    const lastDayNum = Number((mes ? parseMesToLocalRange(mes).toYMD : toYMD).split("-")[2]);
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

    return res.json({
      professor: { id: professor.id, nome: professor.nome, valorQuadra: valorAula },
      intervalo: { from: fromYMD, to: toYMD, duracaoMin },
      totais: {
        porDia: porDiaArr,
        porFaixa,
        mes: totalMes,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao calcular resumo do professor" });
  }
});

export default router;
