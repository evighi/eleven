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

// Tipos explícitos (somente o que o front precisa)
type UsuarioSelecionado = {
  nome: string;
  email: string;
  celular: string | null;
};

type AgendamentoComUsuario =
  | {
      id: string;
      usuario: UsuarioSelecionado;
    }
  | null;

// horário dentro do intervalo de bloqueio [início, fim)
function horarioDentroDoBloqueio(
  horario: string,
  inicioBloqueio: string,
  fimBloqueio: string
): boolean {
  return horario >= inicioBloqueio && horario < fimBloqueio;
}

// 07:00..23:00 (inteiras)
function horasDoDia(): string[] {
  return Array.from({ length: 17 }, (_, i) => `${String(7 + i).padStart(2, "0")}:00`);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// boundary UTC [início, fim) para "YYYY-MM-DD"
function getUtcDayRange(dateStr: string) {
  const base = dateStr.slice(0, 10);
  const inicio = new Date(`${base}T00:00:00Z`);
  const fim = new Date(`${base}T00:00:00Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

/**
 * ROTA ANTIGA (mantida): /disponibilidadeGeral/geral
 * Parâmetros: data (ou diaSemana) + horario  [opcional: esporteId]
 * Regra nova: se vier "data", desconsidera permanente se houver exceção para aquele dia.
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
    const [y, m, d] = (data as string).split("-").map(Number);
    const dataObj = new Date(y, m - 1, d);
    if (isNaN(dataObj.getTime())) {
      return res.status(400).json({ erro: "Data inválida" });
    }
    diaSemanaFinal = diasEnum[getDay(dataObj)];
  } else {
    return res.status(400).json({ erro: "Forneça data ou diaSemana" });
  }

  // Se "data" veio, já calcule o range para filtros gte/lt
  const hasData = Boolean(data);
  const inicioFim = hasData ? getUtcDayRange(String(data)) : null;

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
        // Permanente (com exceção se "data" veio)
        const wherePermBase: any = {
          quadraId: quadra.id,
          horario: horario as string,
          diaSemana: diaSemanaFinal,
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        };
        if (inicioFim) {
          wherePermBase.cancelamentos = {
            none: { dataCancelada: { gte: inicioFim.inicio, lt: inicioFim.fim } },
          };
        }

        const conflitoPermanente = (await prisma.agendamentoPermanente.findFirst({
          where: wherePermBase,
          select: {
            id: true,
            usuario: { select: { nome: true, email: true, celular: true } },
          },
        })) as AgendamentoComUsuario;

        // Comum (se tiver "data", usa igualdade por dia via range)
        let conflitoComum: AgendamentoComUsuario = null;
        if (inicioFim) {
          conflitoComum = (await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              data: { gte: inicioFim.inicio, lt: inicioFim.fim },
            },
            select: {
              id: true,
              usuario: { select: { nome: true, email: true, celular: true } },
            },
          })) as AgendamentoComUsuario;
        }

        // Bloqueio (só faz sentido se "data" veio)
        let conflitoBloqueio: BloqueioQuadra | null = null;
        if (inicioFim) {
          const bloqueios = await prisma.bloqueioQuadra.findMany({
            where: {
              quadras: { some: { id: quadra.id } },
              dataBloqueio: inicioFim.inicio, // você salva como dia, então equality ok
            },
          });
          conflitoBloqueio =
            bloqueios.find((b) =>
              horarioDentroDoBloqueio(horario as string, b.inicioBloqueio, b.fimBloqueio)
            ) ?? null;
        }

        let tipoReserva: "permanente" | "comum" | null = null;
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

    // Agrupa por esporte
    const quadrasAgrupadasPorEsporte = quadrasDisponibilidade.reduce(
      (acc, quadra) => {
        const esportes = quadra.esporte.split(",").map((e) => e.trim());
        esportes.forEach((esporteNome) => {
          if (!acc[esporteNome]) acc[esporteNome] = [];
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
            const conflitoPermanente = (await prisma.agendamentoPermanenteChurrasqueira.findFirst({
              where: {
                diaSemana: diaSemanaFinal,
                turno,
                churrasqueiraId: churrasqueira.id,
                status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              },
              select: {
                id: true,
                usuario: { select: { nome: true, email: true, celular: true } },
              },
            })) as AgendamentoComUsuario;

            const conflitoComum = (await prisma.agendamentoChurrasqueira.findFirst({
              where: {
                diaSemana: diaSemanaFinal,
                turno,
                churrasqueiraId: churrasqueira.id,
                status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              },
              select: {
                id: true,
                usuario: { select: { nome: true, email: true, celular: true } },
              },
            })) as AgendamentoComUsuario;

            let tipoReserva: "permanente" | "comum" | null = null;
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
 * Retorna horas (07..23) por esporte, com slots por quadra.
 * Regra nova: desconsidera permanentes que tenham exceção para o dia.
 */
router.get("/dia", async (req, res) => {
  const { data } = req.query;
  if (!data) {
    return res.status(400).json({ erro: "Parâmetro obrigatório: data (YYYY-MM-DD)" });
  }

  const [y, m, d] = (data as string).split("-").map(Number);
  const dataLocal = new Date(y, m - 1, d);
  if (isNaN(dataLocal.getTime())) {
    return res.status(400).json({ erro: "Data inválida" });
  }
  const diaSemanaFinal: DiaSemana = diasEnum[getDay(dataLocal)];
  const { inicio, fim } = getUtcDayRange(String(data));

  try {
    const horas = horasDoDia();

    // QUADRAS + esportes
    const quadras = await prisma.quadra.findMany({
      include: { quadraEsportes: { include: { esporte: true } } },
      orderBy: { numero: "asc" },
    });

    // Permanentes do dia-da-semana, retirando as com exceção no dia
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        diaSemana: diaSemanaFinal,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        cancelamentos: { none: { data: { gte: inicio, lt: fim } } },
      },
      select: {
        id: true,
        quadraId: true,
        horario: true,
        usuario: { select: { nome: true, email: true, celular: true } },
      },
    });

    // Comuns do dia (por range)
    const comuns = await prisma.agendamento.findMany({
      where: {
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        data: { gte: inicio, lt: fim },
      },
      select: {
        id: true,
        quadraId: true,
        horario: true,
        usuario: { select: { nome: true, email: true, celular: true } },
      },
    });

    // Bloqueios do dia
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: { dataBloqueio: inicio },
      include: { quadras: { select: { id: true } } },
    });

    // indexadores
    const permByKey = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    permanentes.forEach((p) => {
      permByKey.set(`${p.quadraId}|${p.horario}`, { id: p.id, usuario: p.usuario });
    });

    const comumByKey = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    comuns.forEach((c) => {
      comumByKey.set(`${c.quadraId}|${c.horario}`, { id: c.id, usuario: c.usuario });
    });

    const bloqueiosPorQuadra = new Map<string, { inicio: string; fim: string }[]>();
    bloqueios.forEach((b) => {
      b.quadras.forEach((q) => {
        const list = bloqueiosPorQuadra.get(q.id) || [];
        list.push({ inicio: b.inicioBloqueio, fim: b.fimBloqueio });
        bloqueiosPorQuadra.set(q.id, list);
      });
    });

    // estrutura final
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
      slots: Record<string, SlotInfo>;
    };

    const esportesMap: Record<
      string,
      { quadras: QuadraComSlots[]; grupos: QuadraComSlots[][] }
    > = {};

    for (const q of quadras) {
      const nomesEsportes = q.quadraEsportes.map((qe) => qe.esporte.nome);

      const slots: Record<string, SlotInfo> = {};
      for (const hora of horas) {
        const intervals = bloqueiosPorQuadra.get(q.id) || [];
        const bloqueada = intervals.some((iv) => horarioDentroDoBloqueio(hora, iv.inicio, iv.fim));

        const perm = permByKey.get(`${q.id}|${hora}`) || null;
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

      for (const nomeEsporte of nomesEsportes) {
        if (!esportesMap[nomeEsporte]) {
          esportesMap[nomeEsporte] = { quadras: [], grupos: [] };
        }
        esportesMap[nomeEsporte].quadras.push(quadraComSlots);
      }
    }

    Object.values(esportesMap).forEach((blk) => {
      blk.quadras.sort((a, b) => a.numero - b.numero);
      blk.grupos = chunk(blk.quadras, 6);
    });

    return res.json({ data, horas, esportes: esportesMap });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao montar disponibilidade do dia" });
  }
});

export default router;
