import { Router } from "express";
import { PrismaClient, DiaSemana, Turno, BloqueioQuadra } from "@prisma/client";
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
type AgendamentoComUsuario =
  | {
      id: string; // id do agendamento (comum/permanente)
      usuario: UsuarioSelecionado;
    }
  | null;

// Função para verificar se o horário está dentro do intervalo do bloqueio
function horarioDentroDoBloqueio(
  horario: string,
  inicioBloqueio: string,
  fimBloqueio: string
): boolean {
  return horario >= inicioBloqueio && horario < fimBloqueio;
}

function horasDoDia(): string[] {
  // 07:00 até 23:00 (inclusive), inteiras
  return Array.from({ length: 17 }, (_, i) =>
    `${String(7 + i).padStart(2, "0")}:00`
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * ROTA ANTIGA (mantida): /disponibilidadeGeral/geral
 * Parâmetros: data (ou diaSemana) + horario [opcional: esporteId]
 * (sem alterações)
 */
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

          conflitoBloqueio =
            bloqueios.find((b) =>
              horarioDentroDoBloqueio(
                horario as string,
                b.inicioBloqueio,
                b.fimBloqueio
              )
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
    const quadrasAgrupadasPorEsporte = quadrasDisponibilidade.reduce(
      (acc, quadra) => {
        const esportes = quadra.esporte.split(",").map((e) => e.trim());
        esportes.forEach((esporteNome) => {
          if (!acc[esporteNome]) {
            acc[esporteNome] = [];
          }
          acc[esporteNome].push(quadra);
        });
        return acc;
      },
      {} as Record<string, typeof quadrasDisponibilidade[number][]>
    );

    // -------------------- CHURRASQUEIRAS --------------------
    const churrasqueiras = await prisma.churrasqueira.findMany();

    const turnos: Turno[] = ["DIA", "NOITE"];

    const churrasqueirasDisponibilidade = await Promise.all(
      churrasqueiras.map(async (churrasqueira) => {
        const disponibilidadesPorTurno = await Promise.all(
          turnos.map(async (turno) => {
            const conflitoPermanente =
              (await prisma.agendamentoPermanenteChurrasqueira.findFirst({
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

            const conflitoComum =
              (await prisma.agendamentoChurrasqueira.findFirst({
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

/**
 * NOVA ROTA: /disponibilidadeGeral/dia
 * Parâmetros: ?data=YYYY-MM-DD  (obrigatório)
 * Retorna todas as horas (07:00..23:00) por esporte, com slots por quadra.
 */
router.get("/dia", async (req, res) => {
  const { data } = req.query;
  if (!data) {
    return res
      .status(400)
      .json({ erro: "Parâmetro obrigatório: data (YYYY-MM-DD)" });
  }

  // Validar e calcular dia da semana
  const [year, month, day] = (data as string).split("-").map(Number);
  const dataObj = new Date(year, month - 1, day);
  if (isNaN(dataObj.getTime())) {
    return res.status(400).json({ erro: "Data inválida" });
  }
  const diaSemanaFinal: DiaSemana = diasEnum[getDay(dataObj)];

  try {
    const horas = horasDoDia();

    // 1) Buscar QUADRAS + seus esportes
    const quadras = await prisma.quadra.findMany({
      include: { quadraEsportes: { include: { esporte: true } } },
      orderBy: { numero: "asc" },
    });

    // 2) Buscar todos os agendamentos permanentes do dia da semana
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        diaSemana: diaSemanaFinal,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: {
        id: true,
        quadraId: true,
        horario: true,
        usuario: { select: { nome: true, email: true, celular: true } },
      },
    });

    // 3) Buscar todos os agendamentos comuns para a DATA informada
    const comuns = await prisma.agendamento.findMany({
      where: {
        data: dataObj,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: {
        id: true,
        quadraId: true,
        horario: true,
        usuario: { select: { nome: true, email: true, celular: true } },
      },
    });

    // 4) Buscar todos os bloqueios na DATA, com as quadras associadas
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: { dataBloqueio: dataObj },
      include: { quadras: { select: { id: true } } },
    });

    // 5) Indexar (para consultas O(1))
    const permByKey = new Map<
      string,
      { id: string; usuario: UsuarioSelecionado }
    >(); // key = quadraId|hora
    permanentes.forEach((p) => {
      permByKey.set(`${p.quadraId}|${p.horario}`, {
        id: p.id,
        usuario: p.usuario,
      });
    });

    const comumByKey = new Map<
      string,
      { id: string; usuario: UsuarioSelecionado }
    >(); // key = quadraId|hora
    comuns.forEach((c) => {
      comumByKey.set(`${c.quadraId}|${c.horario}`, {
        id: c.id,
        usuario: c.usuario,
      });
    });

    const bloqueiosPorQuadra = new Map<
      string,
      { inicio: string; fim: string }[]
    >(); // quadraId -> intervalos no dia
    bloqueios.forEach((b) => {
      b.quadras.forEach((q) => {
        const list = bloqueiosPorQuadra.get(q.id) || [];
        list.push({ inicio: b.inicioBloqueio, fim: b.fimBloqueio });
        bloqueiosPorQuadra.set(q.id, list);
      });
    });

    // 6) Montar estrutura por ESPORTE -> QUADRAS -> SLOTS (07..23)
    type SlotInfo = {
      disponivel: boolean;
      bloqueada?: boolean;
      tipoReserva?: "comum" | "permanente";
      usuario?: UsuarioSelecionado;
      agendamentoId?: string;
    };

    type QuadraComSlots = {
      quadraId: string;
      nome: string;
      numero: number;
      slots: Record<string, SlotInfo>; // hora -> slot
    };

    const esportesMap: Record<
      string, // nome do esporte
      {
        quadras: QuadraComSlots[];
        grupos: QuadraComSlots[][]; // fatiado em colunas de até 6
      }
    > = {};

    for (const q of quadras) {
      const nomesEsportes = q.quadraEsportes.map((qe) => qe.esporte.nome);

      // slots da quadra por hora
      const slots: Record<string, SlotInfo> = {};
      for (const hora of horas) {
        // bloqueio?
        const intervals = bloqueiosPorQuadra.get(q.id) || [];
        const bloqueada = intervals.some((iv) =>
          horarioDentroDoBloqueio(hora, iv.inicio, iv.fim)
        );

        // permanente?
        const perm = permByKey.get(`${q.id}|${hora}`) || null;

        // comum?
        const com = comumByKey.get(`${q.id}|${hora}`) || null;

        let slot: SlotInfo = { disponivel: true };

        if (bloqueada) {
          slot = { disponivel: false, bloqueada: true };
        } else if (perm) {
          slot = {
            disponivel: false,
            tipoReserva: "permanente",
            usuario: perm.usuario,
            agendamentoId: perm.id,
          };
        } else if (com) {
          slot = {
            disponivel: false,
            tipoReserva: "comum",
            usuario: com.usuario,
            agendamentoId: com.id,
          };
        }

        slots[hora] = slot;
      }

      const quadraComSlots: QuadraComSlots = {
        quadraId: q.id,
        nome: q.nome,
        numero: q.numero,
        slots,
      };

      // a mesma quadra pode aparecer em mais de um esporte (se assim modelado)
      for (const nomeEsporte of nomesEsportes) {
        if (!esportesMap[nomeEsporte]) {
          esportesMap[nomeEsporte] = { quadras: [], grupos: [] };
        }
        esportesMap[nomeEsporte].quadras.push(quadraComSlots);
      }
    }

    // ordenar quadras por número dentro de cada esporte e fatiar em grupos de 6
    Object.values(esportesMap).forEach((blk) => {
      blk.quadras.sort((a, b) => a.numero - b.numero);
      blk.grupos = chunk(blk.quadras, 6);
    });

    // resposta
    return res.json({
      data,
      horas,
      esportes: esportesMap,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ erro: "Erro ao montar disponibilidade do dia" });
  }
});

export default router;
