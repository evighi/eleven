import { Router } from "express";
import { PrismaClient, DiaSemana, Turno, BloqueioQuadra } from "@prisma/client";
import { addDays, getDay, startOfDay } from "date-fns";

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

  // base = hoje, a não ser que dataInicio exista e seja no futuro
  let base = hoje;
  if (p.dataInicio) {
    const inicio = startOfDay(new Date(p.dataInicio));
    if (inicio > hoje) {
      base = inicio;
    }
  }

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
 *        E NÃO deixa permanente sobrepor comum quando o permanente só começa depois.
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

    const quadraIds = quadras.map((q) => q.id);
    const horarioStr = horario as string;

    // ===== Permanentes (batch) =====
    let permanentes:
      | {
          id: string;
          quadraId: string;
          usuario: UsuarioSelecionado;
        }[] = [];

    if (quadraIds.length > 0) {
      if (range) {
        // Com data: só permanentes que já começaram E não têm exceção pra esse dia
        permanentes = await prisma.agendamentoPermanente.findMany({
          where: {
            quadraId: { in: quadraIds },
            horario: horarioStr,
            diaSemana: diaSemanaFinal,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            OR: [{ dataInicio: null }, { dataInicio: { lte: range.inicio } }],
            cancelamentos: { none: { data: { gte: range.inicio, lt: range.fim } } },
          },
          select: {
            id: true,
            quadraId: true,
            usuario: { select: { nome: true, email: true, celular: true } },
          },
        });
      } else {
        // Sem data: qualquer permanente ativo nesse dia/horário/quadra
        permanentes = await prisma.agendamentoPermanente.findMany({
          where: {
            quadraId: { in: quadraIds },
            horario: horarioStr,
            diaSemana: diaSemanaFinal,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
          select: {
            id: true,
            quadraId: true,
            usuario: { select: { nome: true, email: true, celular: true } },
          },
        });
      }
    }

    const permByQuadra = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    permanentes.forEach((p) => {
      if (!permByQuadra.has(p.quadraId)) {
        permByQuadra.set(p.quadraId, {
          id: p.id,
          usuario: p.usuario as UsuarioSelecionado,
        });
      }
    });

    // ===== Comuns (batch, só com data) =====
    let comuns:
      | {
          id: string;
          quadraId: string;
          usuario: UsuarioSelecionado;
        }[] = [];
    if (range && quadraIds.length > 0) {
      comuns = await prisma.agendamento.findMany({
        where: {
          quadraId: { in: quadraIds },
          horario: horarioStr,
          data: { gte: range.inicio, lt: range.fim },
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        },
        select: {
          id: true,
          quadraId: true,
          usuario: { select: { nome: true, email: true, celular: true } },
        },
      });
    }

    const comumByQuadra = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    comuns.forEach((c) => {
      if (!comumByQuadra.has(c.quadraId)) {
        comumByQuadra.set(c.quadraId, {
          id: c.id,
          usuario: c.usuario as UsuarioSelecionado,
        });
      }
    });

    // ===== Bloqueios (batch, só com data) =====
    let bloqueiosPorQuadra = new Map<string, BloqueioQuadra[]>();
    if (range && quadraIds.length > 0) {
      const bloqueios = await prisma.bloqueioQuadra.findMany({
        where: {
          dataBloqueio: { gte: range.inicio, lt: range.fim },
          quadras: { some: { id: { in: quadraIds } } },
        },
        include: { quadras: { select: { id: true } } },
      });

      bloqueiosPorQuadra = new Map<string, BloqueioQuadra[]>();
      bloqueios.forEach((b) => {
        b.quadras.forEach((q) => {
          const list = bloqueiosPorQuadra.get(q.id) || [];
          list.push(b);
          bloqueiosPorQuadra.set(q.id, list);
        });
      });
    }

    // ===== Monta resposta das QUADRAS =====
    const quadrasDisponibilidade = quadras.map((quadra) => {
      let conflitoPermanente: AgendamentoComUsuario = null;
      let conflitoComum: AgendamentoComUsuario = null;
      let conflitoBloqueio: BloqueioQuadra | null = null;

      const per = permByQuadra.get(quadra.id);
      if (per) {
        conflitoPermanente = {
          id: per.id,
          usuario: per.usuario,
        };
      }

      if (range) {
        const com = comumByQuadra.get(quadra.id);
        if (com) {
          conflitoComum = {
            id: com.id,
            usuario: com.usuario,
          };
        }

        const bloqueiosQuadra = bloqueiosPorQuadra.get(quadra.id) || [];
        conflitoBloqueio =
          bloqueiosQuadra.find((b) =>
            horarioDentroDoBloqueio(horarioStr, b.inicioBloqueio, b.fimBloqueio)
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
    });

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

    // -------------------- CHURRASQUEIRAS (COM INÍCIO & EXCEÇÕES) --------------------
    const churrasqueiras = await prisma.churrasqueira.findMany();
    const turnos: Turno[] = ["DIA", "NOITE"];
    const churrasIds = churrasqueiras.map((c) => c.id);

    // permanentes de churrasqueiras (batch)
    let perChurras:
      | {
          id: string;
          churrasqueiraId: string;
          turno: Turno;
          usuario: UsuarioSelecionado;
        }[] = [];

    if (churrasIds.length > 0) {
      if (range) {
        perChurras = await prisma.agendamentoPermanenteChurrasqueira.findMany({
          where: {
            diaSemana: diaSemanaFinal,
            churrasqueiraId: { in: churrasIds },
            turno: { in: turnos },
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            OR: [{ dataInicio: null }, { dataInicio: { lte: range.inicio } }],
            cancelamentos: { none: { data: { gte: range.inicio, lt: range.fim } } },
          },
          select: {
            id: true,
            churrasqueiraId: true,
            turno: true,
            usuario: { select: { nome: true, email: true, celular: true } },
          },
        });
      } else {
        perChurras = await prisma.agendamentoPermanenteChurrasqueira.findMany({
          where: {
            diaSemana: diaSemanaFinal,
            churrasqueiraId: { in: churrasIds },
            turno: { in: turnos },
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
          select: {
            id: true,
            churrasqueiraId: true,
            turno: true,
            usuario: { select: { nome: true, email: true, celular: true } },
          },
        });
      }
    }

    const perChByKey = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    perChurras.forEach((p) => {
      const key = `${p.churrasqueiraId}|${p.turno}`;
      if (!perChByKey.has(key)) {
        perChByKey.set(key, {
          id: p.id,
          usuario: p.usuario as UsuarioSelecionado,
        });
      }
    });

    // comuns de churrasqueiras (batch, só com data)
    let comChurras:
      | {
          id: string;
          churrasqueiraId: string;
          turno: Turno;
          usuario: UsuarioSelecionado;
        }[] = [];

    if (range && churrasIds.length > 0) {
      comChurras = await prisma.agendamentoChurrasqueira.findMany({
        where: {
          churrasqueiraId: { in: churrasIds },
          turno: { in: turnos },
          data: { gte: range.inicio, lt: range.fim },
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        },
        select: {
          id: true,
          churrasqueiraId: true,
          turno: true,
          usuario: { select: { nome: true, email: true, celular: true } },
        },
      });
    }

    const comChByKey = new Map<string, { id: string; usuario: UsuarioSelecionado }>();
    comChurras.forEach((c) => {
      const key = `${c.churrasqueiraId}|${c.turno}`;
      if (!comChByKey.has(key)) {
        comChByKey.set(key, {
          id: c.id,
          usuario: c.usuario as UsuarioSelecionado,
        });
      }
    });

    const churrasqueirasDisponibilidade = await Promise.all(
      churrasqueiras.map(async (churrasqueira) => {
        const disponibilidadesPorTurno = await Promise.all(
          turnos.map(async (turno) => {
            const key = `${churrasqueira.id}|${turno}`;
            const per = perChByKey.get(key) || null;
            const com = range ? comChByKey.get(key) || null : null;

            let tipoReserva: "permanente" | "comum" | null = null;
            let usuario: UsuarioSelecionado | null = null;
            let agendamentoId: string | null = null;

            if (per) {
              tipoReserva = "permanente";
              usuario = per.usuario;
              agendamentoId = per.id;
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
 *        (Agora inclui CHURRASQUEIRAS por turno para o mesmo dia)
 */
router.get("/dia", async (req, res) => {
  const { data, esporteId } = req.query; // 👈 NOVO: aceita esporteId também
  if (!data) {
    return res
      .status(400)
      .json({ erro: "Parâmetro obrigatório: data (YYYY-MM-DD)" });
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

    // ========== QUADRAS + esportes ==========
    // 👇 AQUI: se vier esporteId, já filtra as quadras por esporte
    const quadras = await prisma.quadra.findMany({
      where: esporteId
        ? { quadraEsportes: { some: { esporteId: esporteId as string } } }
        : {},
      include: { quadraEsportes: { include: { esporte: true } } },
      orderBy: { numero: "asc" },
    });

    const quadraIds = quadras.map((q) => q.id);

    // Permanentes do dia-da-semana, só das quadras relevantes
    const permanentes =
      quadraIds.length === 0
        ? []
        : await prisma.agendamentoPermanente.findMany({
            where: {
              quadraId: { in: quadraIds }, // 👈 filtro por quadra
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

    // Comuns do dia, só das quadras relevantes
    const comuns =
      quadraIds.length === 0
        ? []
        : await prisma.agendamento.findMany({
            where: {
              quadraId: { in: quadraIds }, // 👈 filtro por quadra
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

    // Bloqueios do dia, só nas quadras relevantes
    const bloqueios =
      quadraIds.length === 0
        ? []
        : await prisma.bloqueioQuadra.findMany({
            where: {
              dataBloqueio: { gte: inicio, lt: fim },
              quadras: { some: { id: { in: quadraIds } } }, // 👈 filtro por quadra
            },
            include: { quadras: { select: { id: true } } },
          });

    // indexadores
    const permByKey = new Map<
      string,
      { id: string; usuario: UsuarioSelecionado }
    >();
    permanentes.forEach((p) => {
      permByKey.set(`${p.quadraId}|${p.horario}`, {
        id: p.id,
        usuario: p.usuario as UsuarioSelecionado,
      });
    });

    const comumByKey = new Map<
      string,
      { id: string; usuario: UsuarioSelecionado }
    >();
    comuns.forEach((c) => {
      comumByKey.set(`${c.quadraId}|${c.horario}`, {
        id: c.id,
        usuario: c.usuario as UsuarioSelecionado,
      });
    });

    const bloqueiosPorQuadra = new Map<
      string,
      { inicio: string; fim: string }[]
    >();
    bloqueios.forEach((b) => {
      b.quadras.forEach((q) => {
        const list = bloqueiosPorQuadra.get(q.id) || [];
        list.push({ inicio: b.inicioBloqueio, fim: b.fimBloqueio });
        bloqueiosPorQuadra.set(q.id, list);
      });
    });

    // ===== estrutura final, IGUAL à que você já tinha =====
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
        const bloqueada = intervals.some((iv) =>
          horarioDentroDoBloqueio(hora, iv.inicio, iv.fim)
        );

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

    // ========== CHURRASQUEIRAS (mantém sua lógica atual) ==========
    const churrasqueiras = await prisma.churrasqueira.findMany({
      orderBy: { numero: "asc" },
    });
    const turnos: Turno[] = ["DIA", "NOITE"];
    const churrasIds = churrasqueiras.map((ch) => ch.id);

    let perChurras:
      | {
          id: string;
          churrasqueiraId: string;
          turno: Turno;
          usuario: UsuarioSelecionado;
        }[] = [];

    if (churrasIds.length > 0) {
      perChurras = await prisma.agendamentoPermanenteChurrasqueira.findMany({
        where: {
          diaSemana: diaSemanaFinal,
          churrasqueiraId: { in: churrasIds },
          turno: { in: turnos },
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          OR: [{ dataInicio: null }, { dataInicio: { lte: inicio } }],
          cancelamentos: { none: { data: { gte: inicio, lt: fim } } },
        },
        select: {
          id: true,
          churrasqueiraId: true,
          turno: true,
          usuario: { select: { nome: true, email: true, celular: true } },
        },
      });
    }

    const perChByKey = new Map<
      string,
      { id: string; usuario: UsuarioSelecionado }
    >();
    perChurras.forEach((p) => {
      const key = `${p.churrasqueiraId}|${p.turno}`;
      if (!perChByKey.has(key)) {
        perChByKey.set(key, {
          id: p.id,
          usuario: p.usuario as UsuarioSelecionado,
        });
      }
    });

    let comChurras:
      | {
          id: string;
          churrasqueiraId: string;
          turno: Turno;
          usuario: UsuarioSelecionado;
        }[] = [];

    if (churrasIds.length > 0) {
      comChurras = await prisma.agendamentoChurrasqueira.findMany({
        where: {
          churrasqueiraId: { in: churrasIds },
          turno: { in: turnos },
          data: { gte: inicio, lt: fim },
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        },
        select: {
          id: true,
          churrasqueiraId: true,
          turno: true,
          usuario: { select: { nome: true, email: true, celular: true } },
        },
      });
    }

    const comChByKey = new Map<
      string,
      { id: string; usuario: UsuarioSelecionado }
    >();
    comChurras.forEach((c) => {
      const key = `${c.churrasqueiraId}|${c.turno}`;
      if (!comChByKey.has(key)) {
        comChByKey.set(key, {
          id: c.id,
          usuario: c.usuario as UsuarioSelecionado,
        });
      }
    });

    const churrasqueirasDisponibilidade = churrasqueiras.map((ch) => {
      const disponibilidade = turnos.map((turno) => {
        const key = `${ch.id}|${turno}`;
        const per = perChByKey.get(key) || null;
        const com = comChByKey.get(key) || null;

        let tipoReserva: "permanente" | "comum" | null = null;
        let usuario: UsuarioSelecionado | null = null;
        let agendamentoId: string | null = null;

        if (per) {
          tipoReserva = "permanente";
          usuario = per.usuario;
          agendamentoId = per.id;
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
      });

      return {
        churrasqueiraId: ch.id,
        nome: ch.nome,
        numero: ch.numero,
        disponibilidade,
      };
    });

    return res.json({
      data,
      horas,
      esportes: esportesMap,
      churrasqueiras: churrasqueirasDisponibilidade,
    });
  } catch (err) {
    console.error("Erro /disponibilidadeGeral/dia:", err);
    return res
      .status(500)
      .json({ erro: "Erro ao montar disponibilidade do dia" });
  }
});

router.get("/slots-dia", async (req, res) => {
  const { data, esporteId } = req.query;

  if (!data || !esporteId) {
    return res.status(400).json({
      erro: "Parâmetros obrigatórios: data (YYYY-MM-DD) e esporteId",
    });
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

    // Quadras do esporte informado
    const quadras = await prisma.quadra.findMany({
      where: { quadraEsportes: { some: { esporteId: esporteId as string } } },
      select: { id: true },
    });

    const quadraIds = quadras.map((q) => q.id);

    // Se não houver quadras para esse esporte, tudo indisponível
    if (quadraIds.length === 0) {
      const disponiveis: Record<string, boolean> = {};
      horas.forEach((h) => {
        disponiveis[h] = false;
      });
      return res.json({
        data,
        diaSemana: diaSemanaFinal,
        horas,
        disponiveis,
      });
    }

    // Permanentes do dia-da-semana, com dataInicio + exceções (mesma regra do /dia)
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        quadraId: { in: quadraIds },
        diaSemana: diaSemanaFinal,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lte: inicio } }],
        cancelamentos: { none: { data: { gte: inicio, lt: fim } } },
      },
      select: {
        quadraId: true,
        horario: true,
      },
    });

    // Comuns do dia
    const comuns = await prisma.agendamento.findMany({
      where: {
        quadraId: { in: quadraIds },
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        data: { gte: inicio, lt: fim },
      },
      select: {
        quadraId: true,
        horario: true,
      },
    });

    // Bloqueios do dia
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: {
        dataBloqueio: { gte: inicio, lt: fim },
        quadras: { some: { id: { in: quadraIds } } },
      },
      include: { quadras: { select: { id: true } } },
    });

    // indexadores leves
    const permSet = new Set<string>(); // `${quadraId}|${hora}`
    permanentes.forEach((p) => {
      permSet.add(`${p.quadraId}|${p.horario}`);
    });

    const comumSet = new Set<string>();
    comuns.forEach((c) => {
      comumSet.add(`${c.quadraId}|${c.horario}`);
    });

    const bloqueiosPorQuadra = new Map<
      string,
      { inicio: string; fim: string }[]
    >();
    bloqueios.forEach((b) => {
      b.quadras.forEach((q) => {
        const list = bloqueiosPorQuadra.get(q.id) || [];
        list.push({ inicio: b.inicioBloqueio, fim: b.fimBloqueio });
        bloqueiosPorQuadra.set(q.id, list);
      });
    });

    // Mapa final: se existe AO MENOS 1 quadra livre naquele horário
    const disponiveis: Record<string, boolean> = {};

    for (const hora of horas) {
      let anyDisponivel = false;

      for (const quadraId of quadraIds) {
        // 1) Se estiver bloqueada nesse horário, ignora essa quadra
        const intervals = bloqueiosPorQuadra.get(quadraId) || [];
        const bloqueada = intervals.some((iv) =>
          horarioDentroDoBloqueio(hora, iv.inicio, iv.fim)
        );
        if (bloqueada) {
          continue;
        }

        // 2) Se tiver permanente ou comum, quadra está ocupada nesse horário
        const key = `${quadraId}|${hora}`;
        const ocupado = permSet.has(key) || comumSet.has(key);

        // 3) Se não tiver nada, essa quadra está livre
        if (!ocupado) {
          anyDisponivel = true;
          break; // já basta uma quadra livre
        }
      }

      disponiveis[hora] = anyDisponivel;
    }

    return res.json({
      data,
      diaSemana: diaSemanaFinal,
      horas,
      disponiveis,
    });
  } catch (err) {
    console.error("Erro /disponibilidadeGeral/slots-dia:", err);
    return res
      .status(500)
      .json({ erro: "Erro ao montar disponibilidade simplificada por hora" });
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

    /* ===================== QUADRAS ===================== */
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
        cancelamentos: {
          select: { id: true, data: true, motivo: true },
          orderBy: { data: "asc" },
        },
      },
    });

    // Calcula proximaData por permanente (pula exceções)
    const metaByPermId = new Map<
      string,
      {
        proximaData: string | null;
        dataInicio: string | null;
        excecoes: { id: string; data: string; motivo: string | null }[];
      }
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
        meta: {
          proximaData: string | null;
          dataInicio: string | null;
          excecoes: { id: string; data: string; motivo: string | null }[];
        };
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

    // estrutura final (só permanentes) — QUADRAS
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

    /* ===================== CHURRASQUEIRAS (NOVO) ===================== */
    // carrega churrasqueiras e permanentes por turno do dia
    const churrasqueiras = await prisma.churrasqueira.findMany({
      orderBy: { numero: "asc" },
    });

    // permanentes de churrasqueiras ativos no dia
    const perChurras = await prisma.agendamentoPermanenteChurrasqueira.findMany({
      where: {
        diaSemana: diaSemanaFinal,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: {
        id: true,
        churrasqueiraId: true,
        turno: true,
        dataInicio: true,
        usuario: { select: { nome: true, email: true, celular: true } },
        cancelamentos: {
          select: { id: true, data: true, motivo: true },
          orderBy: { data: "asc" },
        },
      },
    });

    // calcula próxima data (pulando exceções) para cada permanente de churrasqueira
    const metaChByPermId = new Map<
      string,
      {
        proximaData: string | null;
        dataInicio: string | null;
        excecoes: { id: string; data: string; motivo: string | null }[];
      }
    >();

    await Promise.all(
      perChurras.map(async (p) => {
        const proximaData = await proximaDataPermanenteSemExcecao({
          id: p.id,
          diaSemana: diaSemanaFinal,
          dataInicio: p.dataInicio ? new Date(p.dataInicio) : null,
        });

        metaChByPermId.set(p.id, {
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

    // index por (churrasqueira|turno)
    const perChByKey = new Map<
      string,
      {
        id: string;
        usuario: UsuarioSelecionado;
        meta: {
          proximaData: string | null;
          dataInicio: string | null;
          excecoes: { id: string; data: string; motivo: string | null }[];
        };
      }
    >();
    perChurras.forEach((p) => {
      const key = `${p.churrasqueiraId}|${p.turno}`;
      perChByKey.set(key, {
        id: p.id,
        usuario: p.usuario as UsuarioSelecionado,
        meta: metaChByPermId.get(p.id)!,
      });
    });

    const turnos: Turno[] = ["DIA", "NOITE"];
    const churrasqueirasDisponibilidade = await Promise.all(
      churrasqueiras.map(async (ch) => {
        const disponibilidade = await Promise.all(
          turnos.map(async (turno) => {
            const perm = perChByKey.get(`${ch.id}|${turno}`) || null;

            if (perm) {
              return {
                turno,
                disponivel: false,
                tipoReserva: "permanente" as const,
                usuario: perm.usuario,
                agendamentoId: perm.id,
                permanenteMeta: perm.meta,
              };
            }

            // Se não tem permanente, o slot fica livre para criar permanente (no painel você só abre/cancela)
            return {
              turno,
              disponivel: true,
            };
          })
        );

        return {
          churrasqueiraId: ch.id,
          nome: ch.nome,
          numero: ch.numero,
          disponibilidade,
        };
      })
    );

    /* ===================== RESPOSTA ===================== */
    return res.json({
      diaSemana: diaSemanaFinal,
      horas,
      esportes: esportesMap,
      churrasqueiras: churrasqueirasDisponibilidade,
    });
  } catch (err) {
    console.error("Erro /disponibilidadeGeral/permanentes:", err);
    return res.status(500).json({ erro: "Erro ao montar grade de permanentes" });
  }
});

export default router;
