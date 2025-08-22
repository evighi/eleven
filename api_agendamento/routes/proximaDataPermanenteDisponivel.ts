import { Router } from "express";
import { PrismaClient, DiaSemana } from "@prisma/client";
import { getDay, addDays, startOfDay, format } from "date-fns";
import { parseISO } from "date-fns";


const router = Router();
const prisma = new PrismaClient();

const diasEnum: DiaSemana[] = [
  "DOMINGO",
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
];

router.get("/", async (req, res) => {
  const { diaSemana, horario, quadraId } = req.query;

  if (!diaSemana || !horario || !quadraId) {
    return res
      .status(400)
      .json({ erro: "diaSemana, horario e quadraId são obrigatórios" });
  }

  if (!diasEnum.includes(diaSemana as DiaSemana)) {
    return res.status(400).json({ erro: "diaSemana inválido" });
  }

  try {
    const diaSemanaEnum = diaSemana as DiaSemana;
    const diaSemanaIndex = diasEnum.indexOf(diaSemanaEnum);

    const hoje = new Date();
    const datasFuturas: string[] = [];
    let data = new Date(hoje);
    let contador = 0;

    // Gerar próximas 10 datas do mesmo dia da semana
    while (datasFuturas.length < 10 && contador < 30) {
      if (data.getDay() === diaSemanaIndex) {
        datasFuturas.push(format(startOfDay(data), "yyyy-MM-dd"));
        data = addDays(data, 7);
      } else {
        data = addDays(data, 1);
      }
      contador++;
    }

    // Buscar agendamentos comuns nessas datas
    const agendamentosConflitantes = await prisma.agendamento.findMany({
      where: {
        quadraId: quadraId as string,
        horario: horario as string,
        data: {
          in: datasFuturas.map((d) => new Date(d)),
        },
      },
    });

    let dataConflitoMaisRecente: string | null = null;

    for (const agendamento of agendamentosConflitantes) {
      const dataAgendamento = agendamento.data.toISOString().substring(0, 10);

      if (
        !dataConflitoMaisRecente ||
        parseISO(dataAgendamento) > parseISO(dataConflitoMaisRecente)
      ) {
        dataConflitoMaisRecente = dataAgendamento;
      }
    }

    const datasDisponiveis: string[] = [];

    for (const dataStr of datasFuturas) {
      const dataAtual = parseISO(dataStr);

      if (
        !dataConflitoMaisRecente ||
        dataAtual > parseISO(dataConflitoMaisRecente)
      ) {
        const temConflito = agendamentosConflitantes.some(
          (a) => format(startOfDay(a.data), "yyyy-MM-dd") === dataStr
        );
        if (!temConflito) {
          datasDisponiveis.push(dataStr);
        }
      }
    }


    return res.status(200).json({
      dataUltimoConflito: dataConflitoMaisRecente,
      proximasDatasDisponiveis: datasDisponiveis,
    });


  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar próximas datas disponíveis" });
  }
});

export default router;
