import { Router } from "express";
import { PrismaClient, DiaSemana, Turno, BloqueioQuadra, Agendamento } from "@prisma/client";
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

// Tipos explícitos para usuário selecionado
type UsuarioSelecionado = {
  nome: string;
  email: string;
  celular: string;
};

// Tipo para agendamento que inclui o usuário (ou null)
type AgendamentoComUsuario = {
  usuario: UsuarioSelecionado;
  id: string; // para pegarmos o ID do agendamento
} | null;

// Função para verificar se o horário está dentro do intervalo do bloqueio
function horarioDentroDoBloqueio(horario: string, inicioBloqueio: string, fimBloqueio: string): boolean {
  return horario >= inicioBloqueio && horario < fimBloqueio;
}

router.get("/geral", async (req, res) => {
  const { data, diaSemana, horario, esporteId } = req.query;

  if ((!data && !diaSemana) || !horario) {
    return res.status(400).json({
      erro: "Parâmetros obrigatórios: data (ou diaSemana) e horario",
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
    diaSemanaFinal = diasEnum[getDay(dataObj)];
  } else {
    return res.status(400).json({ erro: "Forneça data ou diaSemana" });
  }

  try {
    // -------------------- QUADRAS --------------------
    const quadras = await prisma.quadra.findMany({
      where: esporteId
        ? { quadraEsportes: { some: { esporteId: esporteId as string } } }
        : {},
      include: { quadraEsportes: { include: { esporte: true } } },
    });

    const quadrasDisponibilidade = await Promise.all(
      quadras.map(async (quadra) => {
        // Checar conflito permanente
        const conflitoPermanente = (await prisma.agendamentoPermanente.findFirst({
          where: {
            quadraId: quadra.id,
            horario: horario as string,
            diaSemana: diaSemanaFinal,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
          include: {
            usuario: {
              select: {
                nome: true,
                email: true,
                celular: true,
              },
            },
          },
        })) as AgendamentoComUsuario;

        // Checar conflito comum
        let conflitoComum: AgendamentoComUsuario = null;
        if (data) {
          conflitoComum = (await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              data: new Date(data as string),
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            },
            include: {
              usuario: {
                select: {
                  nome: true,
                  email: true,
                  celular: true,
                },
              },
            },
          })) as AgendamentoComUsuario;
        }

        // Checar bloqueio de quadra para a data exata e horário dentro do intervalo
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

        let tipoReserva: string | null = null;
        let usuario: UsuarioSelecionado | null = null;
        let agendamentoId: string | null = null;

        if (conflitoPermanente) {
          tipoReserva = "permanente";
          usuario = conflitoPermanente.usuario;
          agendamentoId = conflitoPermanente.id;
        } else if (conflitoComum) {
          tipoReserva = "comum";
          usuario = conflitoComum.usuario;
          agendamentoId = conflitoComum.id;
        }

        // Se bloqueada, força indisponível
        const disponivel = !tipoReserva && !conflitoBloqueio;

        return {
          quadraId: quadra.id,
          nome: quadra.nome,
          numero: quadra.numero,
          esporte: quadra.quadraEsportes.map((qe) => qe.esporte.nome).join(", "),
          disponivel,
          tipoReserva,
          usuario,
          agendamentoId,
          bloqueada: !!conflitoBloqueio,
        };
      })
    );

    // Agrupa quadras pelo nome do esporte
    const quadrasAgrupadasPorEsporte = quadrasDisponibilidade.reduce((acc, quadra) => {
      const esportes = quadra.esporte.split(",").map((e) => e.trim());
      esportes.forEach((esporteNome) => {
        if (!acc[esporteNome]) {
          acc[esporteNome] = [];
        }
        acc[esporteNome].push(quadra);
      });
      return acc;
    }, {} as Record<string, typeof quadrasDisponibilidade[number][]>);

    // -------------------- CHURRASQUEIRAS --------------------
    const churrasqueiras = await prisma.churrasqueira.findMany();

    const turnos: Turno[] = ["DIA", "NOITE"];

    const churrasqueirasDisponibilidade = await Promise.all(
      churrasqueiras.map(async (churrasqueira) => {
        const disponibilidadesPorTurno = await Promise.all(
          turnos.map(async (turno) => {
            const conflitoPermanente = (await prisma.agendamentoPermanenteChurrasqueira.findFirst({
              where: {
                diaSemana: diaSemanaFinal,
                turno,
                churrasqueiraId: churrasqueira.id,
                status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              },
              include: {
                usuario: {
                  select: {
                    nome: true,
                    email: true,
                    celular: true,
                  },
                },
              },
            })) as AgendamentoComUsuario;

            const conflitoComum = (await prisma.agendamentoChurrasqueira.findFirst({
              where: {
                diaSemana: diaSemanaFinal,
                turno,
                churrasqueiraId: churrasqueira.id,
                status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              },
              include: {
                usuario: {
                  select: {
                    nome: true,
                    email: true,
                    celular: true,
                  },
                },
              },
            })) as AgendamentoComUsuario;

            let tipoReserva: string | null = null;
            let usuario: UsuarioSelecionado | null = null;
            let agendamentoId: string | null = null;

            if (conflitoPermanente) {
              tipoReserva = "permanente";
              usuario = conflitoPermanente.usuario;
              agendamentoId = conflitoPermanente.id;
            } else if (conflitoComum) {
              tipoReserva = "comum";
              usuario = conflitoComum.usuario;
              agendamentoId = conflitoComum.id;
            }

            return {
              turno,
              disponivel: !tipoReserva,
              tipoReserva,
              usuario,
              agendamentoId,
            };
          })
        );

        return {
          churrasqueiraId: churrasqueira.id,
          nome: churrasqueira.nome,
          numero: churrasqueira.numero,
          disponibilidade: disponibilidadesPorTurno,
        };
      })
    );

    return res.json({
      quadras: quadrasAgrupadasPorEsporte,
      churrasqueiras: churrasqueirasDisponibilidade,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao verificar disponibilidade" });
  }
});

export default router;
