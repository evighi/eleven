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

// Tipos para resposta
type UsuarioSelecionado = {
  nome: string;
  email: string;
  celular: string | null; // <- opcional no schema
};
type AgendamentoComUsuario =
  | { id: string; usuario: UsuarioSelecionado }
  | null;

// ---------- helpers ----------
function horarioDentroDoBloqueio(horario: string, inicioBloqueio: string, fimBloqueio: string) {
  // >= início e < fim
  return horario >= inicioBloqueio && horario < fimBloqueio;
}
function horasDoDia(): string[] {
  // 07:00..23:00 inteiras
  return Array.from({ length: 17 }, (_, i) => `${String(7 + i).padStart(2, "0")}:00`);
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
// boundary UTC [início, fim) p/ "YYYY-MM-DD"
function getUtcDayRange(dateStr: string) {
  const base = dateStr.slice(0, 10);
  const inicio = new Date(`${base}T00:00:00Z`);
  const fim = new Date(`${base}T00:00:00Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

/**
 * Verifica se existe cancelamento (exceção) de um permanente **naquele dia**.
 * Altere `dataCancelada` para o nome real do campo caso tenha usado outro.
 */
async function houveExcecaoNoDia(
  agendamentoPermanenteId: string,
  inicio: Date,
  fim: Date
): Promise<boolean> {
  const count = await prisma.agendamentoPermanenteCancelamento.count({
    where: {
      agendamentoPermanenteId,
      // se no seu schema o campo chama "data", troque por data: { gte: inicio, lt: fim }
      data: { gte: inicio, lt: fim },
    },
  });
  return count > 0;
}

/**
 * /disponibilidadeGeral/geral
 * Parâmetros: data (ou diaSemana) + horario [opcional: esporteId]
 * Respeita `dataInicio` e ignora o permanente se houver exceção no dia (quando `data` é informada).
 */
router.get("/geral", async (req, res) => {
  const { data, diaSemana, horario, esporteId } = req.query;

  if ((!data && !diaSemana) || !horario) {
    return res.status(400).json({ erro: "Parâmetros obrigatórios: data (ou diaSemana) e horario" });
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
    if (isNaN(dataObj.getTime())) return res.status(400).json({ erro: "Data inválida" });
    diaSemanaFinal = diasEnum[getDay(dataObj)];
  } else {
    return res.status(400).json({ erro: "Forneça data ou diaSemana" });
  }

  const range = typeof data === "string" ? getUtcDayRange(data) : null;

  try {
    const quadras = await prisma.quadra.findMany({
      where: esporteId ? { quadraEsportes: { some: { esporteId: String(esporteId) } } } : {},
      include: { quadraEsportes: { include: { esporte: true } } },
    });

    const quadrasDisponibilidade = await Promise.all(
      quadras.map(async (quadra) => {
        // ----- PERMANENTE -----
        let conflitoPermanente: AgendamentoComUsuario = null;
        const permRaw = await prisma.agendamentoPermanente.findFirst({
          where: {
            quadraId: quadra.id,
            horario: String(horario),
            diaSemana: diaSemanaFinal,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            OR: [{ dataInicio: null }, { dataInicio: { lte: range ? range.inicio : new Date() } }],
          },
          include: { usuario: { select: { nome: true, email: true, celular: true } } },
        });

        if (permRaw) {
          if (range) {
            const houve = await houveExcecaoNoDia(permRaw.id, range.inicio, range.fim);
            if (!houve) {
              conflitoPermanente = { id: permRaw.id, usuario: permRaw.usuario as UsuarioSelecionado };
            }
          } else {
            // sem data → não dá para avaliar exceção; considerar ocupado
            conflitoPermanente = { id: permRaw.id, usuario: permRaw.usuario as UsuarioSelecionado };
          }
        }

        // ----- COMUM (só quando há data) -----
        let conflitoComum: AgendamentoComUsuario = null;
        if (range) {
          const comumRaw = await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: String(horario),
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              data: { gte: range.inicio, lt: range.fim },
            },
            include: { usuario: { select: { nome: true, email: true, celular: true } } },
          });
          if (comumRaw) {
            conflitoComum = { id: comumRaw.id, usuario: comumRaw.usuario as UsuarioSelecionado };
          }
        }

        // ----- BLOQUEIO (só quando há data) -----
        let conflitoBloqueio: BloqueioQuadra | null = null;
        if (range) {
          const bloqueios = await prisma.bloqueioQuadra.findMany({
            where: {
              quadras: { some: { id: quadra.id } },
              dataBloqueio: { gte: range.inicio, lt: range.fim },
            },
          });
          conflitoBloqueio =
            bloqueios.find((b) => horarioDentroDoBloqueio(String(horario), b.inicioBloqueio, b.fimBloqueio)) ?? null;
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

    // Agrupar por esporte
    const quadrasAgrupadasPorEsporte = quadrasDisponibilidade.reduce((acc, q) => {
      const esportes = q.esporte.split(",").map((e) => e.trim());
      esportes.forEach((nome) => {
        if (!acc[nome]) acc[nome] = [];
        acc[nome].push(q);
      });
      return acc;
    }, {} as Record<string, typeof quadrasDisponibilidade[number][]>);

    // ----- CHURRASQUEIRAS (mantido) -----
    const churrasqueiras = await prisma.churrasqueira.findMany();
    const turnos: Turno[] = ["DIA", "NOITE"];

    const churrasqueirasDisponibilidade = await Promise.all(
      churrasqueiras.map(async (churrasqueira) => {
        const disponibilidade = await Promise.all(
          turnos.map(async (turno) => {
            const perm = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
              where: {
                diaSemana: diaSemanaFinal,
                turno,
                churrasqueiraId: churrasqueira.id,
                status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              },
              include: { usuario: { select: { nome: true, email: true, celular: true } } },
            });
            const comun = await prisma.agendamentoChurrasqueira.findFirst({
              where: {
                diaSemana: diaSemanaFinal,
                turno,
                churrasqueiraId: churrasqueira.id,
                status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
              },
              include: { usuario: { select: { nome: true, email: true, celular: true } } },
            });

            let tipoReserva: "permanente" | "comum" | null = null;
            let usuario: UsuarioSelecionado | null = null;
            let agendamentoId: string | null = null;

            if (perm) {
              tipoReserva = "permanente";
              usuario = perm.usuario as UsuarioSelecionado;
              agendamentoId = perm.id;
            } else if (comun) {
              tipoReserva = "comum";
              usuario = comun.usuario as UsuarioSelecionado;
              agendamentoId = comun.id;
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
          disponibilidade,
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
 * /disponibilidadeGeral/dia
 * Parâmetros: ?data=YYYY-MM-DD
 * Monta matriz de horas (07..23) por esporte, com slots por quadra.
 * Respeita `dataInicio` e ignora permanentes com exceção no dia.
 */
router.get("/dia", async (req, res) => {
  const { data } = req.query;
  if (!data) return res.status(400).json({ erro: "Parâmetro obrigatório: data (YYYY-MM-DD)" });

  const [y, m, d] = (data as string).split("-").map(Number);
  const dataObj = new Date(y, m - 1, d);
  if (isNaN(dataObj.getTime())) return res.status(400).json({ erro: "Data inválida" });

  const diaSemanaFinal: DiaSemana = diasEnum[getDay(dataObj)];
  const { inicio, fim } = getUtcDayRange(String(data));

  try {
    const horas = horasDoDia();

    // 1) Quadras + esportes
    const quadras = await prisma.quadra.findMany({
      include: { quadraEsportes: { include: { esporte: true } } },
      orderBy: { numero: "asc" },
    });

    // 2) Permanentes ativos na data (sem exceção ainda)
    const permanentesRaw = await prisma.agendamentoPermanente.findMany({
      where: {
        diaSemana: diaSemanaFinal,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lte: inicio } }],
      },
      select: {
        id: true,
        quadraId: true,
        horario: true,
        usuario: { select: { nome: true, email: true, celular: true } },
      },
    });

    // 2b) Remover os que possuem exceção nesta data
    const permanentes: { id: string; quadraId: string; horario: string; usuario: UsuarioSelecionado }[] = [];
    for (const p of permanentesRaw) {
      const exc = await houveExcecaoNoDia(p.id, inicio, fim);
      if (!exc) {
        permanentes.push({
          id: p.id,
          quadraId: p.quadraId,
          horario: p.horario,
          usuario: p.usuario as UsuarioSelecionado,
        });
      }
    }

    // 3) Comuns do dia
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

    // 4) Bloqueios do dia
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: { dataBloqueio: { gte: inicio, lt: fim } },
      include: { quadras: { select: { id: true } } },
    });

    // 5) Indexações
    const permByKey = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    permanentes.forEach((p) => {
      permByKey.set(`${p.quadraId}|${p.horario}`, { id: p.id, usuario: p.usuario });
    });

    const comumByKey = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    comuns.forEach((c) => {
      comumByKey.set(`${c.quadraId}|${c.horario}`, {
        id: c.id,
        usuario: c.usuario as UsuarioSelecionado,
      });
    });

    const bloqueiosPorQuadra = new Map<string, { inicio: string; fim: string }[]>();
    bloqueios.forEach((b) => {
      b.quadras.forEach((q) => {
        const list = bloqueiosPorQuadra.get(q.id) || [];
        list.push({ inicio: b.inicioBloqueio, fim: b.fimBloqueio });
        bloqueiosPorQuadra.set(q.id, list);
      });
    });

    // 6) Montagem por esporte
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

    const esportesMap: Record<string, { quadras: QuadraComSlots[]; grupos: QuadraComSlots[][] }> = {};

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
          slot = { disponivel: false, tipoReserva: "permanente", usuario: perm.usuario, agendamentoId: perm.id };
        } else if (com) {
          slot = { disponivel: false, tipoReserva: "comum", usuario: com.usuario, agendamentoId: com.id };
        }
        slots[hora] = slot;
      }

      const quadraComSlots: QuadraComSlots = { quadraId: q.id, nome: q.nome, numero: q.numero, slots };

      for (const nomeEsporte of nomesEsportes) {
        if (!esportesMap[nomeEsporte]) esportesMap[nomeEsporte] = { quadras: [], grupos: [] };
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
