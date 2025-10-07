import { Router } from "express";
import { PrismaClient, DiaSemana, Turno, BloqueioQuadra } from "@prisma/client";
import { addDays, getDay, startOfDay } from "date-fns"; // ⬅️ addDays/startOfDay adicionados

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

// Tipos que o front realmente usa
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

/** Helpers extras para o endpoint de permanentes */
const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00.000Z`);
}
function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}
/** Próxima data do permanente PULANDO exceções (usa hoje como base ou dataInicio se no futuro) */
async function proximaDataPermanenteSemExcecao(p: {
  id: string;
  diaSemana: DiaSemana;
  dataInicio: Date | null;
}): Promise<string | null> {
  const hoje = startOfDay(new Date());
  const base =
    p.dataInicio && startOfDay(new Date(p.dataInicio)) > hoje
      ? startOfDay(new Date(p.dataInicio))
      : hoje;

  const cur = base.getDay(); // 0..6 local
  const target = DIA_IDX[p.diaSemana] ?? 0; // 0..6
  const delta = (target - cur + 7) % 7;

  let tentativa = addDays(base, delta);
  // Limite defensivo ~2 anos
  for (let i = 0; i < 120; i++) {
    const iso = toISODateUTC(tentativa); // "YYYY-MM-DD"
    const exc = await prisma.agendamentoPermanenteCancelamento.findFirst({
      where: { agendamentoPermanenteId: p.id, data: toUtc00(iso) },
      select: { id: true },
    });
    if (!exc) return iso;
    tentativa = addDays(tentativa, 7);
  }
  return null;
}

/**
 * /disponibilidadeGeral/geral
 * Parâmetros: data (ou diaSemana) + horario  [opcional: esporteId]
 * Regra: se vier "data", desconsidera permanente se houver exceção para aquele dia.
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

  const range = typeof data === "string" ? getUtcDayRange(String(data)) : null;

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
        // 1) Permanente (se tiver "data", checa exceção para esse dia)
        let conflitoPermanente: AgendamentoComUsuario = null;

        const per = await prisma.agendamentoPermanente.findFirst({
          where: {
            quadraId: quadra.id,
            horario: horario as string,
            diaSemana: diaSemanaFinal,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            // ✔ só considera o permanente se o contrato já começou
            ...(range
              ? { OR: [{ dataInicio: null }, { dataInicio: { lte: range.inicio } }] }
              : {}),
          },
          select: {
            id: true,
            usuario: { select: { nome: true, email: true, celular: true } },
          },
        });

        if (per) {
          if (range) {
            const temExcecao = await prisma.agendamentoPermanenteCancelamento.findFirst({
              where: {
                agendamentoPermanenteId: per.id,
                data: { gte: range.inicio, lt: range.fim },
              },
              select: { id: true },
            });
            if (!temExcecao) {
              conflitoPermanente = {
                id: per.id,
                usuario: per.usuario as UsuarioSelecionado,
              };
            }
          } else {
            conflitoPermanente = {
              id: per.id,
              usuario: per.usuario as UsuarioSelecionado,
            };
          }
        }

        // 2) Comum (só dá pra checar se "data" foi informada)
        let conflitoComum: AgendamentoComUsuario = null;
        if (range) {
          const com = await prisma.agendamento.findFirst({
            where: {
              quadraId: quadra.id,
              horario: horario as string,
              data: { gte: range.inicio, lt: range.fim },
              status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            },
            select: {
              id: true,
              usuario: { select: { nome: true, email: true, celular: true } },
            },
          });
          if (com) {
            conflitoComum = {
              id: com.id,
              usuario: com.usuario as UsuarioSelecionado,
            };
          }
        }

        // 3) Bloqueio (se "data" foi informada)
        let conflitoBloqueio: BloqueioQuadra | null = null;
        if (range) {
          const bloqueios = await prisma.bloqueioQuadra.findMany({
            where: {
              quadras: { some: { id: quadra.id } },
              dataBloqueio: { gte: range.inicio, lt: range.fim },
            },
          });
          conflitoBloqueio =
            bloqueios.find((b) =>
              horarioDentroDoBloqueio(horario as string, b.inicioBloqueio, b.fimBloqueio)
            ) ?? null;
        }

        // quem está ocupando?
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
      {} as Record<string, (typeof quadrasDisponibilidade)[number][]>
    );

    // -------------------- CHURRASQUEIRAS (AGORA COM EXCEÇÕES) --------------------
    const churrasqueiras = await prisma.churrasqueira.findMany();
    const turnos: Turno[] = ["DIA", "NOITE"];

    const churrasqueirasDisponibilidade = await Promise.all(
      churrasqueiras.map(async (churrasqueira) => {
        const disponibilidadesPorTurno = await Promise.all(
          turnos.map(async (turno) => {
            // Permanente
            const per = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
              where: {
                diaSemana: diaSemanaFinal,
                turno,
                churrasqueiraId: churrasqueira.id,
                status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
                // ...(range ? { OR: [{ dataInicio: null }, { dataInicio: { lte: range.inicio } }] } : {}),
              },
              select: {
                id: true,
                usuario: { select: { nome: true, email: true, celular: true } },
              },
            });

            // Se houver data específica, checar exceção do PERMANENTE para o dia
            let perEfetivo: { id: string; usuario: UsuarioSelecionado } | null = null;
            if (per) {
              if (range) {
                const exc =
                  await prisma.agendamentoPermanenteChurrasqueiraCancelamento.findFirst({
                    where: {
                      agendamentoPermanenteChurrasqueiraId: per.id,
                      data: { gte: range.inicio, lt: range.fim },
                    },
                    select: { id: true },
                  });
                if (!exc) {
                  perEfetivo = { id: per.id, usuario: per.usuario as UsuarioSelecionado };
                }
              } else {
                perEfetivo = { id: per.id, usuario: per.usuario as UsuarioSelecionado };
              }
            }

            // Comum (só checa com "data")
            let com: { id: string; usuario: UsuarioSelecionado } | null = null;
            if (range) {
              const c = await prisma.agendamentoChurrasqueira.findFirst({
                where: {
                  data: { gte: range.inicio, lt: range.fim },
                  turno,
                  churrasqueiraId: churrasqueira.id,
                  status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
                },
                select: {
                  id: true,
                  usuario: { select: { nome: true, email: true, celular: true } },
                },
              });
              if (c) com = { id: c.id, usuario: c.usuario as UsuarioSelecionado };
            }

            let tipoReserva: "permanente" | "comum" | null = null;
            let usuario: UsuarioSelecionado | null = null;
            let agendamentoId: string | null = null;

            if (perEfetivo) {
              tipoReserva = "permanente";
              usuario = perEfetivo.usuario;
              agendamentoId = perEfetivo.id;
            } else if (com) {
              tipoReserva = "comum";
              usuario = com.usuario;
              agendamentoId = com.id;
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
    console.error("Erro /disponibilidadeGeral/geral:", err);
    return res.status(500).json({ erro: "Erro ao verificar disponibilidade" });
  }
});

/**
 * /disponibilidadeGeral/dia
 * Parâmetros: ?data=YYYY-MM-DD  (obrigatório)
 * Retorna horas (07..23) por esporte, com slots por quadra.
 * Regra: desconsidera permanentes que tenham exceção para o dia.
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

    // Permanentes do dia-da-semana, removendo os que têm exceção no dia
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        diaSemana: diaSemanaFinal,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lte: inicio } }],
        cancelamentos: { none: { data: { gte: inicio, lt: fim } } },
      },
      select: {
        id: true,
        quadraId: true,
        horario: true,
        usuario: { select: { nome: true, email: true, celular: true } },
      },
    });

    // Comuns do dia
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
      where: { dataBloqueio: { gte: inicio, lt: fim } },
      include: { quadras: { select: { id: true } } },
    });

    // indexadores
    const permByKey = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    permanentes.forEach((p) => {
      permByKey.set(`${p.quadraId}|${p.horario}`, {
        id: p.id,
        usuario: p.usuario as UsuarioSelecionado,
      });
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
    console.error("Erro /disponibilidadeGeral/dia:", err);
    return res.status(500).json({ erro: "Erro ao montar disponibilidade do dia" });
  }
});

/**
 * ✅ /disponibilidadeGeral/permanentes
 * Parâmetros:
 *   - diaSemana (obrigatório) — enum DiaSemana
 *   - esporteId (opcional) — filtra quadras por esporte
 * Retorna um grid por esporte contendo APENAS os permanentes do dia/horário.
 * Cada slot com permanente inclui {proximaData, dataInicio, excecoes}.
 */
router.get("/permanentes", async (req, res) => {
  const { diaSemana, esporteId } = req.query;

  // validação do dia da semana
  if (!diaSemana || !diasEnum.includes(diaSemana as DiaSemana)) {
    return res.status(400).json({ erro: "Parâmetro obrigatório e válido: diaSemana" });
  }
  const diaSemanaFinal = diaSemana as DiaSemana;

  try {
    const horas = horasDoDia();

    // QUADRAS + esportes (opcional filtro por esporte)
    const quadras = await prisma.quadra.findMany({
      where: esporteId
        ? { quadraEsportes: { some: { esporteId: esporteId as string } } }
        : {},
      include: { quadraEsportes: { include: { esporte: true } } },
      orderBy: { numero: "asc" },
    });

    // Busca todos os permanentes ativos para o dia da semana
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        diaSemana: diaSemanaFinal,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: {
        id: true,
        quadraId: true,
        horario: true,
        dataInicio: true,
        usuario: { select: { nome: true, email: true, celular: true } },
        cancelamentos: { select: { id: true, data: true, motivo: true }, orderBy: { data: "asc" } },
      },
    });

    // Calcula proximaData por permanente (pula exceções)
    const metaByPermId = new Map<
      string,
      { proximaData: string | null; dataInicio: string | null; excecoes: { id: string; data: string; motivo: string | null }[] }
    >();

    await Promise.all(
      permanentes.map(async (p) => {
        const proximaData = await proximaDataPermanenteSemExcecao({
          id: p.id,
          diaSemana: diaSemanaFinal,
          dataInicio: p.dataInicio ? new Date(p.dataInicio) : null,
        });

        metaByPermId.set(p.id, {
          proximaData,
          dataInicio: p.dataInicio ? String(p.dataInicio).slice(0, 10) : null,
          excecoes: p.cancelamentos.map((c) => ({
            id: c.id,
            data: toISODateUTC(new Date(c.data)),
            motivo: c.motivo ?? null,
          })),
        });
      })
    );

    // Indexa por (quadra|horario)
    const permByKey = new Map<
      string,
      {
        id: string;
        usuario: UsuarioSelecionado;
        meta: { proximaData: string | null; dataInicio: string | null; excecoes: { id: string; data: string; motivo: string | null }[] };
      }
    >();
    permanentes.forEach((p) => {
      const key = `${p.quadraId}|${p.horario}`;
      permByKey.set(key, {
        id: p.id,
        usuario: p.usuario as UsuarioSelecionado,
        meta: metaByPermId.get(p.id)!,
      });
    });

    // estrutura final (só permanentes)
    type SlotInfoPerm = {
      disponivel: boolean;
      tipoReserva?: "permanente";
      usuario?: UsuarioSelecionado;
      agendamentoId?: string;
      permanenteMeta?: {
        proximaData: string | null;
        dataInicio: string | null;
        excecoes: { id: string; data: string; motivo: string | null }[];
      };
    };

    type QuadraComSlots = {
      quadraId: string;
      nome: string;
      numero: number;
      slots: Record<string, SlotInfoPerm>;
    };

    const esportesMap: Record<
      string,
      { quadras: QuadraComSlots[]; grupos: QuadraComSlots[][] }
    > = {};

    for (const q of quadras) {
      const nomesEsportes = q.quadraEsportes.map((qe) => qe.esporte.nome);

      const slots: Record<string, SlotInfoPerm> = {};
      for (const hora of horas) {
        const perm = permByKey.get(`${q.id}|${hora}`) || null;

        if (perm) {
          slots[hora] = {
            disponivel: false,
            tipoReserva: "permanente",
            usuario: perm.usuario,
            agendamentoId: perm.id,
            permanenteMeta: perm.meta,
          };
        } else {
          // vazio = disponível para criar PERMANENTE
          slots[hora] = { disponivel: true };
        }
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

    return res.json({ diaSemana: diaSemanaFinal, horas, esportes: esportesMap });
  } catch (err) {
    console.error("Erro /disponibilidadeGeral/permanentes:", err);
    return res.status(500).json({ erro: "Erro ao montar grade de permanentes" });
  }
});

export default router;
