// routes/professores.ts
import { Router } from "express";
import { PrismaClient, StatusAgendamento, DiaSemana } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";

const prisma = new PrismaClient();
const router = Router();

// Todas as rotas daqui exigem login
router.use(verificarToken);

/* =========================
   Helpers de data/fuso (SP)
========================= */
const SP_TZ = "America/Sao_Paulo";

function startOfDaySP(d: Date) {
  // zera horas *no fuso de SP* (forma prática: cria ISO YYYY-MM-DD do dia em SP e volta para Date -03:00)
  const ymd = toYMD_SP(d);
  return new Date(`${ymd}T00:00:00-03:00`);
}
function endOfDaySP(d: Date) {
  const ymd = toYMD_SP(d);
  return new Date(`${ymd}T23:59:59.999-03:00`);
}

function toYMD_SP(d: Date): string {
  // formata para YYYY-MM-DD no fuso SP
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // YYYY-MM-DD
}

function parseMesToRange(mes: string): { from: Date; to: Date } {
  // mes = "YYYY-MM"
  const [yStr, mStr] = mes.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) throw new Error("Parâmetro 'mes' inválido");
  const first = new Date(`${yStr}-${mStr}-01T00:00:00-03:00`);
  const lastDay = new Date(first);
  lastDay.setMonth(lastDay.getMonth() + 1);
  lastDay.setDate(0); // último dia do mês
  return {
    from: startOfDaySP(first),
    to: endOfDaySP(lastDay),
  };
}

function addDays(d: Date, days: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function weekdaySP(d: Date): number {
  // 0..6, DOM..SAB, no fuso de SP
  const ymd = toYMD_SP(d);
  const d2 = new Date(`${ymd}T00:00:00-03:00`);
  return d2.getDay();
}

function diaSemanaToIdx(ds: DiaSemana): number {
  // Prisma DiaSemana: DOMINGO(0) .. SABADO(6)
  const map: Record<DiaSemana, number> = {
    DOMINGO: 0,
    SEGUNDA: 1,
    TERCA: 2,
    QUARTA: 3,
    QUINTA: 4,
    SEXTA: 5,
    SABADO: 6,
  };
  return map[ds];
}

function hhmmToMinutes(hhmm: string): number {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function overlaps(
  slotStart: number,
  slotEnd: number,
  blockStart: number,
  blockEnd: number
): boolean {
  return Math.max(slotStart, blockStart) < Math.min(slotEnd, blockEnd);
}

/* =========================
   Regra NOVA (excluir noite em dias úteis)
========================= */
const EXCLUDE_EVENING = new Set([
  "18:00",
  "19:00",
  "20:00",
  "21:00",
  "22:00",
  "23:00",
]);
const WEEKDAY_DS = new Set<DiaSemana>([
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
] as DiaSemana[]);

const isWeekdayIndex = (wd: number) => wd >= 1 && wd <= 5; // 1..5 = seg..sex
const isWeekdayDiaSemana = (ds: DiaSemana) => WEEKDAY_DS.has(ds);

/* =========================================================
   GET /professores/me/resumo?mes=YYYY-MM
   (alternativa opcional: from=YYYY-MM-DD&to=YYYY-MM-DD)
========================================================= */
router.get("/me/resumo", async (req, res) => {
  try {
    const qSchema = z
      .object({
        mes: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        // duração padrão de aula em minutos (opcional, default 60)
        duracaoMin: z.coerce.number().int().positive().optional(),
      })
      .refine(
        (v) => !!v.mes || (!!v.from && !!v.to),
        "Informe 'mes=YYYY-MM' OU 'from/to=YYYY-MM-DD'."
      );

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ erro: parsed.error.issues?.[0]?.message || "Parâmetros inválidos" });
    }

    const { mes, from, to, duracaoMin = 60 } = parsed.data;

    // Identifica o usuário logado
    const userId = req.usuario?.usuarioLogadoId;
    if (!userId) return res.status(401).json({ erro: "Não autenticado" });

    // Carrega o professor (valorQuadra)
    const professor = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { id: true, tipo: true, valorQuadra: true, nome: true },
    });
    if (!professor) return res.status(404).json({ erro: "Usuário não encontrado" });

    // Determina intervalo
    let range: { from: Date; to: Date };
    if (mes) {
      range = parseMesToRange(mes);
    } else {
      const fromD = new Date(`${from}T00:00:00-03:00`);
      const toD = new Date(`${to}T00:00:00-03:00`);
      range = { from: startOfDaySP(fromD), to: endOfDaySP(toD) };
    }

    // Busca agendamentos COMUNS do professor no intervalo
    const comuns = await prisma.agendamento.findMany({
      where: {
        usuarioId: userId,
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
        data: { gte: range.from, lte: range.to },
      },
      select: { id: true, data: true, horario: true, quadraId: true },
    });

    // Busca agendamentos PERMANENTES do professor
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        usuarioId: userId,
        status: { in: [StatusAgendamento.CONFIRMADO, StatusAgendamento.FINALIZADO] },
      },
      select: {
        id: true,
        diaSemana: true,
        horario: true,
        quadraId: true,
        dataInicio: true,
        cancelamentos: {
          select: { data: true },
        },
      },
    });

    // Busca BLOQUEIOS por dia no intervalo (só os que têm a quadra do professor)
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: {
        dataBloqueio: { gte: range.from, lte: range.to },
      },
      select: {
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        quadras: { select: { id: true } },
      },
    });

    // Index de bloqueios por (YYYY-MM-DD + quadraId)
    const bloqueiosMap = new Map<string, { inicio: number; fim: number }[]>();
    for (const b of bloqueios) {
      const ymd = toYMD_SP(b.dataBloqueio);
      const slot = {
        inicio: hhmmToMinutes(b.inicioBloqueio),
        fim: hhmmToMinutes(b.fimBloqueio),
      };
      for (const q of b.quadras) {
        const key = `${ymd}|${q.id}`;
        const arr = bloqueiosMap.get(key) || [];
        arr.push(slot);
        bloqueiosMap.set(key, arr);
      }
    }

    // Deduplicador: chave = date|quadra|hora
    const chave = (ymd: string, quadraId: string, horario: string) =>
      `${ymd}|${quadraId}|${horario}`;
    const vistos = new Set<string>();

    // Coletores por-dia
    const porDia = new Map<string, number>(); // ymd -> aulas

    // 1) Joga COMUNS primeiro
    for (const ag of comuns) {
      const ymd = toYMD_SP(ag.data);

      // ⛔ regra: ignorar 18:00..23:00 em dias úteis (seg..sex)
      const wd = weekdaySP(ag.data); // 0..6 no fuso SP
      if (isWeekdayIndex(wd) && EXCLUDE_EVENING.has(ag.horario)) {
        continue;
      }

      const k = chave(ymd, ag.quadraId, ag.horario);
      if (vistos.has(k)) continue;

      // Checa bloqueio
      const slots = bloqueiosMap.get(`${ymd}|${ag.quadraId}`) || [];
      const aulaIni = hhmmToMinutes(ag.horario);
      const aulaFim = aulaIni + duracaoMin;
      const bloqueado = slots.some((s) => overlaps(aulaIni, aulaFim, s.inicio, s.fim));
      if (bloqueado) continue;

      vistos.add(k);
      porDia.set(ymd, (porDia.get(ymd) || 0) + 1);
    }

    // 2) Expande PERMANENTES dentro do intervalo e aplica exceções/bloqueios
    for (const p of permanentes) {
      // ⛔ regra: se o permanente é em dia útil e no horário 18:00..23:00, ignora TODAS as ocorrências
      if (isWeekdayDiaSemana(p.diaSemana) && EXCLUDE_EVENING.has(p.horario)) {
        continue;
      }

      const targetWD = diaSemanaToIdx(p.diaSemana);

      // ponto de partida = max(range.from, dataInicio?) no mesmo fuso
      const start = p.dataInicio ? startOfDaySP(p.dataInicio) : startOfDaySP(range.from);
      let cursor = start;

      // avança cursor até o primeiro dia com weekday = targetWD dentro do range
      while (cursor < range.from) cursor = addDays(cursor, 1);
      while (weekdaySP(cursor) !== targetWD) cursor = addDays(cursor, 1);

      const cancelYMD = new Set<string>((p.cancelamentos || []).map((c) => toYMD_SP(c.data)));

      for (let d = cursor; d <= range.to; d = addDays(d, 7)) {
        // não considerar antes do dataInicio
        if (p.dataInicio) {
          const ymdStart = toYMD_SP(p.dataInicio);
          const ymdCur = toYMD_SP(d);
          if (ymdCur < ymdStart) continue;
        }

        const ymd = toYMD_SP(d);

        // exceção?
        if (cancelYMD.has(ymd)) continue;

        // bloqueio?
        const slots = bloqueiosMap.get(`${ymd}|${p.quadraId}`) || [];
        const aulaIni = hhmmToMinutes(p.horario);
        const aulaFim = aulaIni + duracaoMin;
        const bloqueado = slots.some((s) => overlaps(aulaIni, aulaFim, s.inicio, s.fim));
        if (bloqueado) continue;

        // dedupe contra comuns gerados
        const k = chave(ymd, p.quadraId, p.horario);
        if (vistos.has(k)) continue;

        vistos.add(k);
        porDia.set(ymd, (porDia.get(ymd) || 0) + 1);
      }
    }

    // Constrói resposta agregada
    // Valor por aula (pode ser null) -> 0 por padrão
    const valorAula = Number(professor.valorQuadra ?? 0) || 0;

    // Totais por dia com valor
    const porDiaArr = Array.from(porDia.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ymd, aulas]) => ({
        data: ymd,
        aulas,
        valor: aulas * valorAula,
      }));

    // Faixas do mês: 1-7, 8-14, 15-21, 22-fim
    const rangeForMonth = (() => {
      // tenta derivar do 'mes', senão do 'to'
      if (mes) return parseMesToRange(mes);
      const firstYMD = toYMD_SP(range.from).slice(0, 7) + "-01";
      const first = new Date(`${firstYMD}T00:00:00-03:00`);
      const lastDay = new Date(first);
      lastDay.setMonth(lastDay.getMonth() + 1);
      lastDay.setDate(0);
      return { from: startOfDaySP(first), to: endOfDaySP(lastDay) };
    })();

    const lastDayNum = Number(toYMD_SP(rangeForMonth.to).split("-")[2]);
    const faixaIdx = (day: number) => {
      if (day >= 1 && day <= 7) return "1-7";
      if (day >= 8 && day <= 14) return "8-14";
      if (day >= 15 && day <= 21) return "15-21";
      return `22-${lastDayNum}`;
    };

    const porFaixaMap = new Map<string, { aulas: number; valor: number }>();
    for (const it of porDiaArr) {
      const [, , dStr] = it.data.split("-");
      const day = Number(dStr);
      const f = faixaIdx(day);
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
      intervalo: {
        from: toYMD_SP(range.from),
        to: toYMD_SP(range.to),
        duracaoMin,
      },
      totais: {
        porDia: porDiaArr, // [{ data: 'YYYY-MM-DD', aulas, valor }]
        porFaixa, // [{ faixa: '1-7'|'8-14'|'15-21'|'22-31', aulas, valor }]
        mes: totalMes, // { aulas, valor }
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao calcular resumo do professor" });
  }
});

export default router;
