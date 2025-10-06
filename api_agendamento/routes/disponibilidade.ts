import { Router } from "express";
import { PrismaClient, DiaSemana, BloqueioQuadra, Agendamento } from "@prisma/client";
import { getDay } from "date-fns";

const prisma = new PrismaClient();
const router = Router();

const diasEnum: DiaSemana[] = [
  "DOMINGO",
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
];

// normaliza "YYYY-MM-DD" para Date em 00:00:00Z (mesmo formato salvo no banco)
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}

// Função para verificar se o horário está dentro do intervalo do bloqueio
function horarioDentroDoBloqueio(horario: string, inicioBloqueio: string, fimBloqueio: string): boolean {
  // Considera horário >= inicio e < fim para evitar sobreposição no limite final
  return horario >= inicioBloqueio && horario < fimBloqueio;
}

/* ===== Helpers de timezone (SP) ===== */

// “Agora” no fuso America/Sao_Paulo
function nowInTZ(tz = "America/Sao_Paulo") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",   // Sun..Sat
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hour = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(p => p.type === "minute")?.value ?? "0");
  const wd = (parts.find(p => p.type === "weekday")?.value ?? "Sun") as
    | "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

  const DOW: Record<typeof wd, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return { hour, minute, dowIndex: DOW[wd] };
}

// YYYY-MM-DD “de hoje” no calendário de SP
function todayISOByTZ(tz = "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
}

router.get("/", async (req, res) => {
  const { data, diaSemana, horario, esporteId } = req.query;

  if ((!data && !diaSemana) || !horario || !esporteId) {
    return res.status(400).json({
      erro: "Parâmetros obrigatórios: data (ou diaSemana), horario e esporteId",
    });
  }

  let diaSemanaFinal: DiaSemana;

  if (diaSemana) {
    if (!diasEnum.includes(diaSemana as DiaSemana)) {
      return res.status(400).json({ erro: "Dia da semana inválida" });
    }
    diaSemanaFinal = diaSemana as DiaSemana;
  } else if (data) {
    const [year, month, day] = (data as string).split("-").map(Number);
    const dataObj = new Date(year, month - 1, day); // local -> será usado apenas para getDay()
    if (isNaN(dataObj.getTime())) {
      return res.status(400).json({ erro: "Data inválida" });
    }
    const indexDia = getDay(dataObj); // 0..6
    diaSemanaFinal = diasEnum[indexDia];
  } else {
    return res.status(400).json({ erro: "Forneça data ou diaSemana" });
  }

  try {
    const quadras = await prisma.quadra.findMany({
      where: {
        quadraEsportes: { some: { esporteId: esporteId as string } },
      },
    });

    const quadrasComConflitos = await Promise.all(
      quadras.map(async (quadra) => {
        // ------------------------------
        // 1) Conflito com PERMANENTE (ignorando exceções quando 'data' for enviada)
        // ------------------------------
        let conflitoPermanente = false;

        if (data) {
          // Quando sabemos a data, só bloqueia se NÃO houver exceção para esse dia
          const dataUTC = toUtc00(data as string);

          // permanentes ativos e já iniciados (dataInicio <= data ou null)
          const permanentesAtivos = await prisma.agendamentoPermanente.findMany({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              diaSemana: diaSemanaFinal,
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC } }],
            },
            select: { id: true },
          });

          if (permanentesAtivos.length > 0) {
            const exc = await prisma.agendamentoPermanenteCancelamento.findFirst({
              where: {
                agendamentoPermanenteId: { in: permanentesAtivos.map((p) => p.id) },
                data: dataUTC,
              },
              select: { id: true },
            });
            conflitoPermanente = !exc; // só conflita se NÃO houver exceção para a data
          }
        } else {
          // Sem data específica: existe algum permanente ativo nesse dia/horário/quadra?
          const count = await prisma.agendamentoPermanente.count({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              diaSemana: diaSemanaFinal,
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            },
          });
          conflitoPermanente = count > 0;
        }

        // ------------------------------
        // 2) Conflito com AGENDAMENTO COMUM
        // ------------------------------
        let conflitoComum: Agendamento | null = null;

        if (data) {
          // data precisa estar exatamente em 00:00Z, que é como salvamos no banco
          const dataUTC = toUtc00(data as string);
          conflitoComum = await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              data: dataUTC,
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            },
          });
        } else {
          // Sem data: olhamos as próximas 8 ocorrências daquele dia da semana
          // *** AGORA usando calendário/hora de São Paulo ***
          const { hour: spHour, minute: spMinute, dowIndex: hojeDiaSP } = nowInTZ("America/Sao_Paulo");
          const indexSelecionado = diasEnum.indexOf(diaSemanaFinal);

          // inclui HOJE se ainda não passou o horário; senão, pula para a semana seguinte
          let diasAte = (indexSelecionado - hojeDiaSP + 7) % 7;

          if (diasAte === 0) {
            const [hh, mm] = String(horario).split(":").map((n: string) => parseInt(n, 10));
            const agoraMin = spHour * 60 + spMinute;
            const slotMin = (hh || 0) * 60 + (mm || 0);
            const passou = agoraMin >= slotMin;
            if (passou) diasAte = 7;
          }

          // Âncora “hoje” no calendário de SP (evita virar dia no UTC)
          const hojeISO_SP = todayISOByTZ("America/Sao_Paulo"); // "YYYY-MM-DD"
          const hojeSP = new Date(`${hojeISO_SP}T00:00:00-03:00`);

          const datasVerificar: Date[] = [];
          for (let i = 0; i < 8; i++) {
            const dataTemp = new Date(hojeSP);
            dataTemp.setDate(hojeSP.getDate() + diasAte + i * 7);
            dataTemp.setHours(0, 0, 0, 0);
            const iso = dataTemp.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
            datasVerificar.push(toUtc00(iso));               // normaliza p/ 00:00Z como no banco
          }

          conflitoComum = await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              data: { in: datasVerificar },
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            },
          });
        }

        // ------------------------------
        // 3) Conflito de BLOQUEIO (intervalo de horas)
        // ------------------------------
        let conflitoBloqueio: BloqueioQuadra | null = null;
        if (data) {
          const bloqueios = await prisma.bloqueioQuadra.findMany({
            where: {
              quadras: { some: { id: quadra.id } },
              dataBloqueio: toUtc00(data as string),
            },
          });

          conflitoBloqueio =
            bloqueios.find((b) =>
              horarioDentroDoBloqueio(horario as string, b.inicioBloqueio, b.fimBloqueio)
            ) ?? null;
        }

        const disponivel = !conflitoPermanente && !conflitoComum && !conflitoBloqueio;

        return {
          quadraId: quadra.id,
          nome: quadra.nome,
          numero: quadra.numero,
          diaSemana: diaSemanaFinal,
          disponivel,
          conflitoPermanente: !!conflitoPermanente,
          conflitoComum: !!conflitoComum,
          bloqueada: !!conflitoBloqueio,
        };
      })
    );

    return res.json(quadrasComConflitos);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao verificar disponibilidade" });
  }
});

export default router;
