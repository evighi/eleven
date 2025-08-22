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
    const dataObj = new Date(year, month - 1, day);

    if (isNaN(dataObj.getTime())) {
      return res.status(400).json({ erro: "Data inválida" });
    }

    const indexDia = getDay(dataObj);
    diaSemanaFinal = diasEnum[indexDia];
  } else {
    return res.status(400).json({ erro: "Forneça data ou diaSemana" });
  }

  try {
    const quadras = await prisma.quadra.findMany({
      where: {
        quadraEsportes: {
          some: {
            esporteId: esporteId as string,
          },
        },
      },
    });

    const quadrasComConflitos = await Promise.all(
      quadras.map(async (quadra) => {
        // Verifica conflito com agendamento permanente
        const conflitoPermanente = await prisma.agendamentoPermanente.findFirst({
          where: {
            quadraId: quadra.id,
            horario: horario as string,
            diaSemana: diaSemanaFinal,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
        });

        // Verifica conflito com agendamento comum
        let conflitoComum: Agendamento | null = null;

        if (data) {
          const dataVerificar = new Date(data as string);
          conflitoComum = await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              data: dataVerificar,
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            },
          });
        } else {
          const hoje = new Date();
          const hojeDia = hoje.getDay();
          const indexSelecionado = diasEnum.indexOf(diaSemanaFinal);
          let diasAte = (indexSelecionado - hojeDia + 7) % 7;
          if (diasAte === 0) diasAte = 7;

          const datasVerificar: Date[] = [];
          for (let i = 0; i < 8; i++) {
            const dataTemp = new Date();
            dataTemp.setDate(hoje.getDate() + diasAte + i * 7);
            datasVerificar.push(new Date(dataTemp.toISOString().split("T")[0]));
          }

          conflitoComum = await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              data: {
                in: datasVerificar,
              },
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            },
          });
        }

        // Verifica conflito de bloqueio considerando intervalo de bloqueio
        let conflitoBloqueio: BloqueioQuadra | null = null;
        if (data) {
          const bloqueios = await prisma.bloqueioQuadra.findMany({
            where: {
              quadras: {
                some: {
                  id: quadra.id,
                },
              },
              dataBloqueio: new Date(data as string),
            },
          });

          conflitoBloqueio = bloqueios.find(b =>
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
