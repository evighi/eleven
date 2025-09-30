import { Router } from "express";
import { PrismaClient, DiaSemana, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { startOfDay, addDays, getDay } from "date-fns";
import cron from "node-cron"; // ⏰ cron para finalizar vencidos
import verificarToken from "../middleware/authMiddleware";
import { r2PublicUrl } from "../src/lib/r2";
import { logAudit, TargetType } from "../utils/audit"; // 👈 AUDITORIA

// Mapa DiaSemana -> número JS (0=Dom..6=Sáb)
const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

// ================= Helpers de horário local (America/Sao_Paulo) =================
const SP_TZ = process.env.TZ || "America/Sao_Paulo";

function localYMD(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // "YYYY-MM-DD"
}

function localHM(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d); // "HH:mm"
}

// Constrói um "timestamp" em milissegundos em uma linha do tempo local (codificada como UTC)
function msFromLocalYMDHM(ymd: string, hm: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

// Próxima data (YYYY-MM-DD, UTC) para um DiaSemana, respeitando dataInicio opcional
function nextDateISOForDiaSemana(dia: DiaSemana, minDate?: Date | null) {
  const hoje = new Date();
  const base = minDate && minDate > hoje ? minDate : hoje;
  const cur = base.getDay(); // 0..6
  const target = DIA_IDX[dia] ?? 0; // 0..6
  const delta = (target - cur + 7) % 7; // 0..6
  const d = startOfDay(addDays(base, delta));
  return d.toISOString().slice(0, 10);
}

function getUtcDayRange(dateStr?: string) {
  // Se o front informou "YYYY-MM-DD", respeitamos esse dia
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const base = dateStr.slice(0, 10);
    const inicio = new Date(`${base}T00:00:00Z`);
    const fim = new Date(`${base}T00:00:00Z`);
    fim.setUTCDate(fim.getUTCDate() + 1);
    return { inicio, fim };
  }

  // Caso contrário, usamos o DIA LOCAL (America/Sao_Paulo) para gerar os boundaries em UTC
  const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(new Date());
  return { inicio: hojeUTC00, fim: amanhaUTC00 };
}

/**
 * ⚠️ IMPORTANTE SOBRE O CAMPO `data`:
 * No POST você manda "YYYY-MM-DD", que o Node interpreta como MEIA-NOITE EM UTC daquele dia.
 * Portanto, no banco o campo `data` representa "00:00 UTC do dia pretendido".
 * Para comparar com "hoje" local, converta o dia local para esse MESMO formato:
 *   Date.UTC(anoLocal, mesLocal, diaLocal, 0, 0, 0) => boundary correto para consultas.
 */
// Força o dia local em America/Sao_Paulo e devolve os limites em UTC [início, fim)
function getStoredUtcBoundaryForLocalDay(dLocal = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(dLocal).split("-").map(Number);

  // 00:00:00 UTC do mesmo YYYY-MM-DD (é exatamente como você salva no banco)
  const hojeUTC00 = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const amanhaUTC00 = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));

  return { hojeUTC00, amanhaUTC00 };
}

// helpers de imagem (R2/legado/url absoluta)
function resolveQuadraImg(imagem?: string | null) {
  if (!imagem) return null;
  const isHttp = /^https?:\/\//i.test(imagem);
  const looksLikeR2Key = !isHttp && (imagem.includes("/") || imagem.startsWith("quadras"));
  if (looksLikeR2Key) {
    const url = r2PublicUrl(imagem);
    if (url) return url;
  }
  if (isHttp) return imagem;
  const base = process.env.APP_URL
    ? `${process.env.APP_URL}/uploads/quadras/`
    : `/uploads/quadras/`;
  return `${base}${imagem}`;
}

// 🔧 helpers extras p/ tratar datas em UTC 00
function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}

// 👉 helper p/ checar se um horário "HH:MM" está em [inicio, fim)
function horarioDentroIntervalo(h: string, ini: string, fim: string) {
  return h >= ini && h < fim;
}

const prisma = new PrismaClient();
const router = Router();

/** ===== Helpers de domínio/RBAC ===== */
const isAdminRole = (t?: string) =>
  ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"].includes(t || "");

/**
 * Calcula a PRÓXIMA data (YYYY-MM-DD) para um permanente,
 * PULANDO as datas já marcadas como exceção e CONSIDERANDO o horário.
 */
async function proximaDataPermanenteSemExcecao(p: {
  id: string;
  diaSemana: DiaSemana;
  dataInicio: Date | null;
  horario: string; // "HH:mm"
}): Promise<string> {
  const agora = new Date();

  // base: hoje ou dataInicio se estiver no futuro
  const base = p.dataInicio && p.dataInicio > agora ? p.dataInicio : agora;

  const cur = base.getDay(); // 0..6 (local)
  const target = DIA_IDX[p.diaSemana] ?? 0; // 0..6
  const delta = (target - cur + 7) % 7;

  let tentativa = startOfDay(addDays(base, delta));

  // Se a tentativa é "hoje" no calendário local, respeitar o horário:
  const tentativaEhHojeLocal = localYMD(tentativa) === localYMD(agora); // ambos em SP
  if (tentativaEhHojeLocal) {
    const agoraHHMM = localHM(agora); // "HH:mm" em SP
    if (agoraHHMM >= p.horario) {
      // já passou o horário de hoje -> pula uma semana
      tentativa = addDays(tentativa, 7);
    }
  }

  // Limite de segurança de 120 iterações (~2 anos)
  for (let i = 0; i < 120; i++) {
    const iso = toISODateUTC(tentativa); // "YYYY-MM-DD"
    const exc = await prisma.agendamentoPermanenteCancelamento.findFirst({
      where: {
        agendamentoPermanenteId: p.id,
        data: toUtc00(iso), // comparar sempre em 00:00Z
      },
      select: { id: true },
    });

    if (!exc) return iso; // achou uma ocorrência sem exceção

    // pula 1 semana
    tentativa = addDays(tentativa, 7);
  }

  // fallback defensivo
  return toISODateUTC(tentativa);
}

const addJogadoresSchema = z.object({
  jogadoresIds: z.array(z.string().uuid()).optional().default([]),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});

// Validação do corpo (flexível p/ admin ou cliente)
const agendamentoSchema = z.object({
  data: z.coerce.date(),
  horario: z.string().min(1),
  quadraId: z.string().uuid(),
  esporteId: z.string().uuid(),
  // admin pode mandar; cliente não precisa mandar (vem do token)
  usuarioId: z.string().uuid().optional(),
  jogadoresIds: z.array(z.string().uuid()).optional().default([]),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});

async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 chars para unicidade
  const emailSintetico = `${localPart}+guest.${suffix}@noemail.local`;

  const randomPass = crypto.randomUUID();
  const hashed = await bcrypt.hash(randomPass, 10);

  const convidado = await prisma.usuario.create({
    data: {
      nome: cleanName,
      email: emailSintetico,
      senha: hashed,
      tipo: "CLIENTE",
      celular: null,
      cpf: null,
      nascimento: null,
    },
    select: { id: true, nome: true, email: true },
  });

  return convidado;
}

const diasEnum = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"];

/**
 * ⛳ Finaliza agendamentos CONFIRMADOS cujo dia/horário já passaram.
 * Regras:
 *  1) data < HOJE(UTC00 do dia local)  -> FINALIZADO
 *  2) HOJE <= data < AMANHÃ (utc00) e horario < HH:mm ATUAL LOCAL(SP) -> FINALIZADO
 * Obs: 'horario' no formato 'HH:mm' permite comparação lexicográfica.
 */
async function finalizarAgendamentosVencidos() {
  const agora = new Date();

  // Limites do dia LOCAL (SP) codificados em UTC 00:00 — compatíveis com como "data" é salva
  const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(agora);

  // HORA ATUAL NO FUSO DE SP — NÃO usar getHours()/getMinutes()
  const agoraHHMM = localHM(agora, SP_TZ); // "HH:mm"

  // 1) Qualquer dia anterior a hoje
  const r1 = await prisma.agendamento.updateMany({
    where: {
      status: "CONFIRMADO",
      data: { lt: hojeUTC00 },
    },
    data: { status: "FINALIZADO" },
  });

  // 2) Hoje, mas com horário já passado
  const r2 = await prisma.agendamento.updateMany({
    where: {
      status: "CONFIRMADO",
      data: { gte: hojeUTC00, lt: amanhaUTC00 },
      horario: { lt: agoraHHMM },
    },
    data: { status: "FINALIZADO" },
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[finalizarAgendamentosVencidos] < hoje=${r1.count} | hoje<${agoraHHMM}=${r2.count} (boundaries: ${hojeUTC00.toISOString()} .. ${amanhaUTC00.toISOString()})`
    );
  }
}

// Agenda o job (evita duplicar no hot-reload em DEV)
const globalAny = global as any;
if (!globalAny.__cronFinalizaVencidos__) {
  cron.schedule(
    "1 * * * *",
    () => {
      finalizarAgendamentosVencidos().catch((e) =>
        console.error("Cron finalizarAgendamentosVencidos erro:", e)
      );
    },
    { timezone: SP_TZ }
  );
  globalAny.__cronFinalizaVencidos__ = true;
}

/** ================== ROTAS ================== */

// Criar agendamento (cliente + admin). Admin pode setar usuarioId.
router.post("/", verificarToken, async (req, res) => {
  const parsed = agendamentoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.format() });
  }

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);

  const {
    data,
    horario,
    quadraId,
    esporteId,
    usuarioId: usuarioIdBody,
    jogadoresIds = [],
    convidadosNomes = [],
  } = parsed.data;

  // cliente não define usuarioId; admin pode
  const usuarioIdDono = isAdmin && usuarioIdBody
    ? usuarioIdBody
    : reqCustom.usuario.usuarioLogadoId;

  try {
    // ── checagens de conflito ───────────────────────────────────────────────────
    const diaSemanaEnum = diasEnum[getDay(data)] as DiaSemana;
    const dataInicio = startOfDay(data);
    const dataFim = addDays(dataInicio, 1);

    // (1) conflito com comum existente no MESMO dia/horário/quadra (não cancelado/transferido)
    const agendamentoExistente = await prisma.agendamento.findFirst({
      where: {
        quadraId,
        horario,
        data: { gte: dataInicio, lt: dataFim },
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
    });
    if (agendamentoExistente) {
      return res
        .status(409)
        .json({ erro: "Já existe um agendamento para essa quadra, data e horário" });
    }

    // (2) conflito com PERMANENTE ATIVO — respeitando exceções
    const dataISO = toISODateUTC(data); // "YYYY-MM-DD"
    const dataUTC00 = toUtc00(dataISO); // Date em 00:00Z do mesmo dia

    const permanentesAtivos = await prisma.agendamentoPermanente.findMany({
      where: {
        diaSemana: diaSemanaEnum,
        horario,
        quadraId,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC00 } }],
      },
      select: { id: true },
    });

    if (permanentesAtivos.length > 0) {
      const excecao = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: {
          agendamentoPermanenteId: { in: permanentesAtivos.map((p) => p.id) },
          data: dataUTC00,
        },
        select: { id: true },
      });

      if (!excecao) {
        return res.status(409).json({ erro: "Horário ocupado por um agendamento permanente" });
      }
    }

    // ── cria usuários mínimos para cada convidado ───────────────────────────────
    const convidadosCriadosIds: string[] = [];
    for (const nome of convidadosNomes) {
      const convidado = await criarConvidadoComoUsuario(nome);
      convidadosCriadosIds.push(convidado.id);
    }

    // ── monta todos os jogadores: dono + cadastrados + convidados (sem duplicar) ─
    const connectIds = Array.from(
      new Set<string>([usuarioIdDono, ...jogadoresIds, ...convidadosCriadosIds])
    ).map((id) => ({ id }));

    // ── cria agendamento já conectando jogadores ───────────────────────────────
    const novoAgendamento = await prisma.agendamento.create({
      data: {
        data,
        horario,
        quadraId,
        esporteId,
        usuarioId: usuarioIdDono,
        status: "CONFIRMADO",
        jogadores: { connect: connectIds },
      },
      include: {
        jogadores: { select: { id: true, nome: true, email: true } },
        usuario: { select: { id: true, nome: true, email: true } },
        quadra: { select: { id: true, nome: true, numero: true } },
        esporte: { select: { id: true, nome: true } },
      },
    });

    // 📝 AUDIT: criação
    try {
      await logAudit({
        event: "AGENDAMENTO_CREATE",
        req,
        target: { type: TargetType.AGENDAMENTO, id: novoAgendamento.id },
        metadata: {
          agendamentoId: novoAgendamento.id,
          data: toISODateUTC(novoAgendamento.data),
          horario: novoAgendamento.horario,
          quadraId,
          esporteId,
          donoId: usuarioIdDono,
          jogadoresIds: connectIds.map((c) => c.id),
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar criação:", e);
    }

    return res.status(201).json(novoAgendamento);
  } catch (err: any) {
    // 🧱 Concorrência: outro usuário confirmou o mesmo slot entre sua checagem e o create()
    // Prisma lança P2002 (unique) e, em alguns casos de SQL bruto, pode vir 23505 (Postgres)
    if (
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") ||
      err?.code === "23505"
    ) {
      return res
        .status(409)
        .json({ erro: "Este horário acabou de ser reservado por outra pessoa. Escolha outra quadra." });
    }

    console.error("Erro ao criar agendamento", err);
    return res.status(500).json({ erro: "Erro ao criar agendamento" });
  }
});

// GET /agendamentos  (admin: todos; cliente: só os dele — dono ou jogador)
router.get("/", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);

  // filtros opcionais
  const { data, quadraId, usuarioId } = req.query as {
    data?: string;
    quadraId?: string;
    usuarioId?: string;
  };

  // monta where de forma flexível
  const where: any = {};
  if (quadraId) where.quadraId = String(quadraId);

  // filtro de data
  if (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    const { inicio, fim } = getUtcDayRange(data);
    where.data = { gte: inicio, lt: fim };
  } else if (data) {
    where.data = new Date(String(data));
  }

  if (isAdmin) {
    if (usuarioId) where.usuarioId = String(usuarioId);
  } else {
    const userId = reqCustom.usuario.usuarioLogadoId;
    where.OR = [{ usuarioId: userId }, { jogadores: { some: { id: userId } } }];
  }

  try {
    const agendamentos = await prisma.agendamento.findMany({
      where,
      include: {
        quadra: {
          select: { id: true, nome: true, numero: true, tipoCamera: true, imagem: true },
        },
        usuario: {
          select: { id: true, nome: true, email: true },
        },
        jogadores: {
          select: { id: true, nome: true, email: true },
        },
        esporte: {
          select: { id: true, nome: true },
        },
      },
      orderBy: [{ data: "asc" }, { horario: "asc" }],
    });

    const sanitizeEmail = (email?: string | null) => (isAdmin ? email : undefined);
    const loggedId = reqCustom.usuario.usuarioLogadoId;

    const resposta = agendamentos.map((a) => {
      const euSouDono = String(a.usuarioId) === String(loggedId);
      return {
        ...a,
        usuario: a.usuario
          ? { ...a.usuario, email: sanitizeEmail(a.usuario.email) }
          : a.usuario,
        jogadores: a.jogadores.map((j) => ({ ...j, email: sanitizeEmail(j.email) })),
        quadraLogoUrl: resolveQuadraImg(a.quadra?.imagem) || "/quadra.png",

        // 👇 adiciona também nesses resultados
        donoId: a.usuario?.id ?? a.usuarioId,
        donoNome: a.usuario?.nome ?? "",
        euSouDono,
      };
    });

    return res.json(resposta);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});

// GET /agendamentos/me  -> comuns CONFIRMADOS + permanentes ATIVOS (próxima data respeita horário/exceções)
// 🔴 Alteração: para PERMANENTES, marca se a próxima data está coberta por um BLOQUEIO (sem mudar a data).
router.get("/me", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoNome?: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  try {
    const usuarioId = reqCustom.usuario.usuarioLogadoId;

    // 1) Comuns CONFIRMADOS onde o usuário é dono ou jogador (inalterado)
    const comunsConfirmados = await prisma.agendamento.findMany({
      where: {
        status: "CONFIRMADO",
        OR: [{ usuarioId }, { jogadores: { some: { id: usuarioId } } }],
      },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } }, // 👈 DONO
      },
      orderBy: [{ data: "asc" }, { horario: "asc" }],
    });

    const respComuns = comunsConfirmados.map((a) => {
      const quadraLogoUrl = resolveQuadraImg(a.quadra?.imagem) || "/quadra.png";
      const euSouDono = String(a.usuarioId) === String(usuarioId);

      return {
        id: a.id,
        nome: a.esporte?.nome ?? "Quadra",
        local: a.quadra ? `${a.quadra.nome} - Nº ${a.quadra.numero}` : "",
        horario: a.horario,
        tipoReserva: "COMUM" as const,
        status: a.status,
        logoUrl: quadraLogoUrl,
        data: a.data.toISOString().slice(0, 10), // data efetiva do comum
        quadraNome: a.quadra?.nome ?? "",
        quadraNumero: a.quadra?.numero ?? null,
        quadraLogoUrl,
        esporteNome: a.esporte?.nome ?? "",

        donoId: a.usuario?.id ?? a.usuarioId,
        donoNome: a.usuario?.nome ?? "",
        euSouDono,
      };
    });

    // 2) Permanentes ATIVOS onde o usuário é dono
    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        usuarioId,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } }, // 👈 DONO
      },
      orderBy: [{ diaSemana: "asc" }, { horario: "asc" }],
    });

    // 2.1) Calcula proximaData de cada permanente
    const permsComProxima = await Promise.all(
      permanentes.map(async (p) => {
        const proximaData = await proximaDataPermanenteSemExcecao({
          id: p.id,
          diaSemana: p.diaSemana as DiaSemana,
          dataInicio: p.dataInicio ?? null,
          horario: p.horario,
        });
        return { p, proximaData };
      })
    );

    // 2.2) Carrega bloqueios relevantes em LOTE para (quadraId, proximaData)
    const datasSet = new Set<string>();
    const quadrasSet = new Set<string>();
    for (const { p, proximaData } of permsComProxima) {
      if (proximaData) {
        datasSet.add(proximaData);
        quadrasSet.add(p.quadra?.id ?? p.quadraId);
      }
    }

    let bloqueios: Array<{
      id: string;
      dataBloqueio: Date;
      inicioBloqueio: string;
      fimBloqueio: string;
      quadras: { id: string }[];
    }> = [];

    if (datasSet.size > 0 && quadrasSet.size > 0) {
      bloqueios = await prisma.bloqueioQuadra.findMany({
        where: {
          dataBloqueio: { in: Array.from(datasSet).map(toUtc00) },
          quadras: { some: { id: { in: Array.from(quadrasSet) } } },
        },
        select: {
          id: true,
          dataBloqueio: true,
          inicioBloqueio: true,
          fimBloqueio: true,
          quadras: { select: { id: true } },
        },
      });
    }

    // Index por (quadraId|YYYY-MM-DD)
    const bloqueiosIndex = new Map<string, Array<typeof bloqueios[number]>>();
    for (const b of bloqueios) {
      const ymd = b.dataBloqueio.toISOString().slice(0, 10);
      for (const q of b.quadras) {
        const k = `${q.id}|${ymd}`;
        const list = bloqueiosIndex.get(k) || [];
        list.push(b);
        bloqueiosIndex.set(k, list);
      }
    }

    // 2.3) Monta resposta dos permanentes com flag de bloqueio (sem alterar proximaData)
    const respPermanentes = permsComProxima.map(({ p, proximaData }) => {
      const quadraLogoUrl = resolveQuadraImg(p.quadra?.imagem) || "/quadra.png";

      let proximaDataBloqueada = false;
      let bloqueioInfo: { data: string; inicio: string; fim: string } | undefined;

      if (proximaData) {
        const k = `${p.quadra?.id ?? p.quadraId}|${proximaData}`;
        const candidatos = bloqueiosIndex.get(k) || [];
        const hit = candidatos.find((b) =>
          horarioDentroIntervalo(p.horario, b.inicioBloqueio, b.fimBloqueio)
        );
        if (hit) {
          proximaDataBloqueada = true;
          bloqueioInfo = {
            data: proximaData,
            inicio: hit.inicioBloqueio,
            fim: hit.fimBloqueio,
          };
        }
      }

      return {
        id: p.id,
        nome: p.esporte?.nome ?? "Quadra",
        local: p.quadra ? `${p.quadra.nome} - Nº ${p.quadra.numero}` : "",
        horario: p.horario,
        tipoReserva: "PERMANENTE" as const,
        status: p.status,
        logoUrl: quadraLogoUrl,

        data: null,                 // permanentes não têm data fixa
        diaSemana: p.diaSemana,     // exibir "toda SEGUNDA"
        proximaData,                // mantém a mesma data
        proximaDataBloqueada,       // 👈 NOVO FLAG
        ...(bloqueioInfo ? { bloqueioInfo } : {}), // 👈 opcional para UI

        quadraNome: p.quadra?.nome ?? "",
        quadraNumero: p.quadra?.numero ?? null,
        quadraLogoUrl,
        esporteNome: p.esporte?.nome ?? "",

        // sempre o próprio dono
        donoId: p.usuario?.id ?? p.usuarioId,
        donoNome: p.usuario?.nome ?? "",
        euSouDono: true,
      };
    });

    // 3) Junta e ordena por (data|proximaData) + horário
    const tudo = [...respComuns, ...respPermanentes].sort((a: any, b: any) => {
      const da = a.data || a.proximaData || "";
      const db = b.data || b.proximaData || "";
      if (da === db) return String(a.horario).localeCompare(String(b.horario));
      return String(da).localeCompare(String(db));
    });

    return res.json(tudo);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro ao listar agendamentos do usuário" });
  }
});

// 🔎 Lista transferências feitas pelo usuário logado + "para quem" foi transferido
router.get("/transferidos/me", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  try {
    const usuarioId = reqCustom.usuario.usuarioLogadoId;

    const transferidos = await prisma.agendamento.findMany({
      where: { usuarioId, status: "TRANSFERIDO" },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
      },
      orderBy: [{ data: "desc" }, { horario: "desc" }],
    });

    const resposta = await Promise.all(
      transferidos.map(async (t) => {
        const novo = await prisma.agendamento.findFirst({
          where: {
            id: { not: t.id },
            data: t.data,
            horario: t.horario,
            quadraId: t.quadraId,
            esporteId: t.esporteId,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
          include: { usuario: { select: { id: true, nome: true, email: true } } },
        });

        const quadraLogoUrl = resolveQuadraImg(t.quadra?.imagem);

        return {
          id: t.id,
          data: t.data.toISOString().slice(0, 10),
          horario: t.horario,
          status: t.status,
          quadraNome: t.quadra?.nome ?? "",
          quadraNumero: t.quadra?.numero ?? null,
          quadraImagem: t.quadra?.imagem ?? null,
          quadraLogoUrl,
          esporteNome: t.esporte?.nome ?? "",
          transferidoPara: novo?.usuario
            ? { id: novo.usuario.id, nome: novo.usuario.nome, email: undefined }
            : null,
          novoAgendamentoId: novo?.id ?? null,
        };
      })
    );

    return res.json(resposta);
  } catch (e) {
    console.error("Erro ao listar transferidos:", e);
    return res.status(500).json({ erro: "Erro ao listar agendamentos transferidos" });
  }
});

// 🚀 Rota manual para finalizar vencidos (restrita a admin)
router.post("/_finaliza-vencidos", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });
  if (!isAdminRole(reqCustom.usuario.usuarioLogadoTipo)) {
    return res.status(403).json({ erro: "Acesso negado" });
  }

  try {
    await finalizarAgendamentosVencidos();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Falha ao finalizar vencidos" });
  }
});

// 📄 Detalhes de um agendamento comum (admin, dono ou jogador)
router.get("/:id", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);
  const userId = reqCustom.usuario.usuarioLogadoId;
  const { id } = req.params;

  try {
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nome: true, email: true, celular: true } },
        jogadores: { select: { id: true, nome: true, email: true, celular: true } },
        quadra: { select: { nome: true, numero: true } },
        esporte: { select: { nome: true } },
      },
    });

    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    const isOwner = agendamento.usuario?.id === userId;
    const isPlayer = agendamento.jogadores.some((j) => j.id === userId);
    if (!isAdmin && !isOwner && !isPlayer) {
      return res.status(403).json({ erro: "Sem permissão para ver este agendamento" });
    }

    const sanitizeEmail = (email?: string | null) => (isAdmin ? email : undefined);
    const sanitizePhone = (celular?: string | null) => (isAdmin ? celular : undefined);

    return res.json({
      id: agendamento.id,
      tipoReserva: "COMUM",
      dia: agendamento.data.toISOString().split("T")[0],
      horario: agendamento.horario,
      usuario: agendamento.usuario
        ? {
            id: agendamento.usuario.id,
            nome: agendamento.usuario.nome,
            email: sanitizeEmail(agendamento.usuario.email),
            celular: sanitizePhone(agendamento.usuario.celular),
          }
        : null,
      usuarioId: agendamento.usuario?.id, // mantém compat
      esporte: agendamento.esporte?.nome,
      quadra: `${agendamento.quadra?.nome} (Nº ${agendamento.quadra?.numero})`,
      jogadores: agendamento.jogadores.map((j) => ({
        id: j.id,
        nome: j.nome,
        email: sanitizeEmail(j.email),
        celular: sanitizePhone(j.celular),
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao buscar agendamento" });
  }
});


// ✅ Cancelar agendamento comum (com regra de 12h/15min no BACK)
router.post("/cancelar/:id", verificarToken, async (req, res) => {
  const { id } = req.params;

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  try {
    // carrega campos necessários
    const ag = await prisma.agendamento.findUnique({
      where: { id },
      select: {
        id: true,
        data: true, // Date (00:00Z do dia local)
        horario: true, // "HH:mm"
        usuarioId: true,
        status: true,
        createdAt: true,
      },
    });

    if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado" });

    if (["CANCELADO", "TRANSFERIDO", "FINALIZADO"].includes(ag.status)) {
      return res.status(409).json({ erro: "Este agendamento não pode ser cancelado." });
    }

    const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);
    const isOwner = String(ag.usuarioId) === String(reqCustom.usuario.usuarioLogadoId);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ erro: "Você não pode cancelar este agendamento." });
    }

    // ===== Regra de tempo (para CLIENTE/dono) =====
    if (!isAdmin) {
      // Agora (local SP)
      const now = new Date();
      const nowYMD = localYMD(now);
      const nowHM = localHM(now);
      const nowMs = msFromLocalYMDHM(nowYMD, nowHM);

      // Início do agendamento (local SP)
      // Obs: ag.data está como "00:00Z" do mesmo YYYY-MM-DD que o DIA local pretendido.
      const schedYMD = ag.data.toISOString().slice(0, 10); // "YYYY-MM-DD" do dia local
      const schedHM = ag.horario; // "HH:mm"
      const schedMs = msFromLocalYMDHM(schedYMD, schedHM);

      // Se já passou, não cancela
      if (schedMs <= nowMs) {
        return res
          .status(422)
          .json({ erro: "Não é possível cancelar um agendamento já iniciado ou finalizado." });
      }

      const minutesToStart = Math.floor((schedMs - nowMs) / 60000); // quanto falta
      const canBy12h = minutesToStart >= 12 * 60;

      if (!canBy12h) {
        // Janela de graça de 15 minutos a partir da CRIAÇÃO, válida sempre que < 12h para o início
        const createdYMD = localYMD(ag.createdAt);
        const createdHM = localHM(ag.createdAt);
        const createdMs = msFromLocalYMDHM(createdYMD, createdHM);

        const minutesSinceCreation = Math.floor((nowMs - createdMs) / 60000);

        if (minutesSinceCreation > 15) {
          return res.status(422).json({
            erro:
              "Cancelamento permitido até 12 horas antes do horário do agendamento " +
              "ou, se faltar menos de 12 horas, em até 15 minutos após a criação.",
          });
        }
      }
    }

    // Efetiva o cancelamento (idempotência simples: só atualiza se ainda não cancelado)
    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoPorId: reqCustom.usuario.usuarioLogadoId,
      },
    });

    // 🔎 AUDITORIA — registra quem cancelou e qual agendamento
    try {
      await logAudit({
        event: "AGENDAMENTO_CANCEL",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          agendamentoId: id,
          statusAntes: ag.status,
          statusDepois: atualizado.status,
          data: ag.data.toISOString().slice(0, 10),
          horario: ag.horario,
          donoId: ag.usuarioId,
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar cancelamento:", e);
    }

    return res.status(200).json({
      message: "Agendamento cancelado com sucesso.",
      agendamento: atualizado,
    });
  } catch (error) {
    console.error("Erro ao cancelar agendamento:", error);

    // (opcional) auditar tentativa com erro
    try {
      await logAudit({
        event: "OTHER",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: { action: "CANCEL_FAIL", error: (error as any)?.message ?? String(error) },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar erro de cancelamento:", e);
    }

    return res.status(500).json({ erro: "Erro ao cancelar agendamento." });
  }
});

// Deletar (apenas admin)
router.delete("/:id", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });
  if (!isAdminRole(reqCustom.usuario.usuarioLogadoTipo)) {
    return res.status(403).json({ erro: "Apenas administradores podem deletar agendamentos" });
  }

  const { id } = req.params;

  try {
    const agendamento = await prisma.agendamento.findUnique({ where: { id } });
    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    await prisma.agendamento.delete({ where: { id } });

    // 📝 AUDIT: deletado
    try {
      await logAudit({
        event: "AGENDAMENTO_DELETE",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          agendamentoId: id,
          data: agendamento.data?.toISOString?.().slice(0, 10) ?? null,
          horario: agendamento.horario ?? null,
          quadraId: agendamento.quadraId ?? null,
          esporteId: agendamento.esporteId ?? null,
          donoId: agendamento.usuarioId ?? null,
          statusAntes: agendamento.status ?? null,
          statusDepois: "DELETADO",
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar deleção:", e);
    }

    return res.json({ message: "Agendamento deletado com sucesso" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao deletar agendamento" });
  }
});

// Transferir (admin ou dono)
router.patch("/:id/transferir", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);
  const userId = reqCustom.usuario.usuarioLogadoId;

  const { id } = req.params;
  const { novoUsuarioId, transferidoPorId } = req.body;

  if (!novoUsuarioId) {
    return res.status(400).json({ erro: "Novo usuário é obrigatório" });
  }

  try {
    // 1) busca agendamento original + info necessária
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
      include: { jogadores: true },
    });
    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    const isOwner = agendamento.usuarioId === userId;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ erro: "Sem permissão para transferir este agendamento" });
    }

    // 2) valida novo usuário
    const novoUsuario = await prisma.usuario.findUnique({
      where: { id: novoUsuarioId },
    });
    if (!novoUsuario) {
      return res.status(404).json({ erro: "Novo usuário não encontrado" });
    }

    // 3) transação: marca original como TRANSFERIDO + zera jogadores,
    //    e cria o novo com apenas o novo usuário na lista de jogadores
    const [_, novoAgendamento] = await prisma.$transaction([
      prisma.agendamento.update({
        where: { id },
        data: {
          status: "TRANSFERIDO",
          transferidoPorId: transferidoPorId ?? userId,
          jogadores: { set: [] },
        },
        include: { jogadores: true },
      }),

      prisma.agendamento.create({
        data: {
          data: agendamento.data,
          horario: agendamento.horario,
          usuarioId: novoUsuarioId, // dono do novo agendamento
          quadraId: agendamento.quadraId,
          esporteId: agendamento.esporteId,
          // Apenas o novo usuário como jogador
          jogadores: { connect: [{ id: novoUsuarioId }] },
        },
        include: {
          usuario: true,
          jogadores: true,
          quadra: true,
        },
      }),
    ]);

    // 📝 AUDIT: transferência
    try {
      await logAudit({
        event: "AGENDAMENTO_TRANSFER",
        req,
        target: { type: TargetType.AGENDAMENTO, id }, // alvo: o agendamento original
        metadata: {
          agendamentoOriginalId: id,
          novoAgendamentoId: novoAgendamento.id,
          data: toISODateUTC(novoAgendamento.data),
          horario: novoAgendamento.horario,
          quadraId: novoAgendamento.quadraId,
          esporteId: novoAgendamento.esporteId,
          fromOwnerId: agendamento.usuarioId,
          toOwnerId: novoUsuarioId,
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar transferência:", e);
    }

    return res.status(200).json({
      message: "Agendamento transferido com sucesso",
      agendamentoOriginalId: id,
      novoAgendamento: {
        id: novoAgendamento.id,
        data: novoAgendamento.data,
        horario: novoAgendamento.horario,
        usuario: novoAgendamento.usuario
          ? {
              id: novoAgendamento.usuario.id,
              nome: novoAgendamento.usuario.nome,
              email: isAdmin ? novoAgendamento.usuario.email : undefined,
            }
          : null,
        jogadores: novoAgendamento.jogadores.map((j) => ({
          id: j.id,
          nome: j.nome,
          email: isAdmin ? j.email : undefined,
        })),
        quadra: novoAgendamento.quadra
          ? {
              id: novoAgendamento.quadra.id,
              nome: novoAgendamento.quadra.nome,
              numero: novoAgendamento.quadra.numero,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Erro ao transferir agendamento:", error);
    return res.status(500).json({ erro: "Erro ao transferir agendamento" });
  }
});

// Adicionar jogadores (admin ou dono)
router.patch("/:id/jogadores", verificarToken, async (req, res) => {
  const parsed = addJogadoresSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.format() });
  }
  const { jogadoresIds, convidadosNomes } = parsed.data;
  const { id } = req.params;

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  try {
    // 2) Carrega agendamento
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
      include: { jogadores: { select: { id: true } } },
    });
    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    if (["CANCELADO", "TRANSFERIDO"].includes(agendamento.status)) {
      return res.status(400).json({ erro: "Não é possível alterar jogadores deste agendamento" });
    }

    // 3) Autorização
    const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);
    const isOwner = agendamento.usuarioId === reqCustom.usuario.usuarioLogadoId;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ erro: "Sem permissão para alterar este agendamento" });
    }

    // 4) Buscar usuários válidos por ID (se houver)
    const usuariosValidos = jogadoresIds.length
      ? await prisma.usuario.findMany({
          where: { id: { in: jogadoresIds } },
          select: { id: true },
        })
      : [];

    if (usuariosValidos.length !== jogadoresIds.length) {
      return res.status(400).json({ erro: "Um ou mais jogadores não existem" });
    }

    // 5) Criar “convidados” (usuarios mínimos) e coletar IDs
    const hashDefault = await bcrypt.hash("convidado123", 10);

    const convidadosCriados: Array<{ id: string }> = [];
    for (const nome of convidadosNomes) {
      const emailFake = `convidado+${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}@example.com`;

      const novo = await prisma.usuario.create({
        data: {
          nome,
          email: emailFake,
          senha: hashDefault, // campo senha é obrigatório no seu schema
          tipo: "CLIENTE",
        },
        select: { id: true },
      });

      convidadosCriados.push({ id: novo.id });
    }

    // 6) Evitar duplicatas (IDs já conectados no agendamento)
    const jaConectados = new Set(agendamento.jogadores.map((j) => j.id));

    const idsNovosExistentes = usuariosValidos
      .map((u) => u.id)
      .filter((uid) => !jaConectados.has(uid));

    const idsConvidados = convidadosCriados.map((c) => c.id);

    // Se não há nada novo, retorna o agendamento atual
    if (idsNovosExistentes.length === 0 && idsConvidados.length === 0) {
      const atual = await prisma.agendamento.findUnique({
        where: { id },
        include: { usuario: true, jogadores: true, quadra: true, esporte: true },
      });
      return res.json(atual);
    }

    // 7) Conecta tudo de uma vez
    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        jogadores: {
          connect: [
            ...idsNovosExistentes.map((jid) => ({ id: jid })),
            ...idsConvidados.map((jid) => ({ id: jid })),
          ],
        },
      },
      include: { usuario: true, jogadores: true, quadra: true, esporte: true },
    });

    return res.json({
      id: atualizado.id,
      data: atualizado.data,
      horario: atualizado.horario,
      status: atualizado.status,
      usuario: atualizado.usuario
        ? {
            id: atualizado.usuario.id,
            nome: atualizado.usuario.nome,
            email: isAdmin ? atualizado.usuario.email : undefined,
          }
        : null,
      jogadores: atualizado.jogadores.map((j) => ({
        id: j.id,
        nome: j.nome,
        email: isAdmin ? j.email : undefined,
      })),
      quadra: atualizado.quadra
        ? { id: atualizado.quadra.id, nome: atualizado.quadra.nome, numero: atualizado.quadra.numero }
        : null,
      esporte: atualizado.esporte ? { id: atualizado.esporte.id, nome: atualizado.esporte.nome } : null,
    });
  } catch (err) {
    console.error("Erro ao adicionar jogadores:", err);
    return res.status(500).json({ erro: "Erro ao adicionar jogadores ao agendamento" });
  }
});

export default router;
