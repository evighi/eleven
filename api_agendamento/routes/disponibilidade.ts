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
      return res.status(400).json({ erro: "Dia da semana inválido" });
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
          // Sem data específica, mantemos o comportamento padrão:
          // existe algum permanente ativo nesse dia/horário/quadra? então conflita.
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
          const hoje = new Date();
          const hojeDia = hoje.getDay();
          const indexSelecionado = diasEnum.indexOf(diaSemanaFinal);

          // 🟠 ALTERAÇÃO: incluir HOJE quando o dia selecionado é hoje
          // e o horário ainda NÃO passou; se já passou, pula para a semana seguinte.
          let diasAte = (indexSelecionado - hojeDia + 7) % 7; // 0..6
          if (diasAte === 0) {
            // comparar HH:mm atuais com o horário do slot
            const [hh, mm] = String(horario).split(":").map((n: string) => parseInt(n, 10));
            const agoraMin = hoje.getHours() * 60 + hoje.getMinutes();
            const slotMin = (hh || 0) * 60 + (mm || 0);
            const passou = agoraMin >= slotMin;

            if (passou) {
              diasAte = 7; // já passou o horário de hoje => próxima semana
            }
            // se NÃO passou, mantém 0 para usar a data de HOJE
          }

          const datasVerificar: Date[] = [];
          for (let i = 0; i < 8; i++) {
            const dataTemp = new Date();
            dataTemp.setDate(hoje.getDate() + diasAte + i * 7);
            // normaliza para 00:00Z
            const iso = dataTemp.toISOString().split("T")[0]; // YYYY-MM-DD (UTC)
            datasVerificar.push(toUtc00(iso));
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
