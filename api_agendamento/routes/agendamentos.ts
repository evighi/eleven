import { Router } from "express";
import { PrismaClient, DiaSemana, Prisma, TipoSessaoProfessor } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import cron from "node-cron"; // ⏰ cron para finalizar vencidos
import verificarToken from "../middleware/authMiddleware";
import { r2PublicUrl } from "../src/lib/r2";
import { logAudit, TargetType } from "../utils/audit"; // 👈 AUDITORIA
import { valorMultaPadrao } from "../utils/multa";     // 👈 multa fixa

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

/**
 * ⚠️ IMPORTANTE SOBRE O CAMPO `data`:
 * No POST você manda "YYYY-MM-DD", que o Node interpreta como MEIA-NOITE EM UTC daquele dia.
 * Portanto, no banco o campo `data` representa "00:00 UTC do dia pretendido".
 * Para comparar com "hoje" local, converta o dia local para esse MESMO formato.
 */
function getStoredUtcBoundaryForLocalDay(dLocal = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(dLocal).split("-").map(Number);

  const hojeUTC00 = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const amanhaUTC00 = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));

  return { hojeUTC00, amanhaUTC00 };
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

// ===== novos helpers para trabalhar sempre no "dia local" =====
function localWeekdayIndexOfYMD(ymd: string): number {
  // meio-dia -03:00 evita rollover
  return new Date(`${ymd}T12:00:00-03:00`).getUTCDay(); // 0..6
}
function addDaysLocalYMD(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return localYMD(d);
}

const prisma = new PrismaClient();
const router = Router();

/** ===== Helpers de domínio/RBAC ===== */
const isAdminRole = (t?: string) =>
  ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"].includes(t || "");

// super-admin segue sem limite de cancelamento
const isSuperAdminRole = (t?: string) =>
  ["ADMIN_MASTER", "ADMIN_ATENDENTE"].includes(t || "");

// janela por perfil (em horas)
function cancellationWindowHours(tipo?: string): number {
  if (isSuperAdminRole(tipo)) return Infinity; // sem limite
  if (tipo === "ADMIN_PROFESSORES") return 2;  // professor
  return 12;                                   // cliente
}

/**
 * Calcula a PRÓXIMA data (YYYY-MM-DD) para um permanente,
 * PULANDO exceções e CONSIDERANDO o horário.
 */
async function proximaDataPermanenteSemExcecao(p: {
  id: string;
  diaSemana: DiaSemana;
  dataInicio: Date | null;
  horario: string; // "HH:mm"
}): Promise<string> {
  const agora = new Date();

  const hojeSP_YMD = localYMD(agora);
  const baseLocalYMD =
    p.dataInicio && p.dataInicio > agora ? p.dataInicio.toISOString().slice(0, 10) : hojeSP_YMD;

  const DIA_IDX_LOCAL: Record<DiaSemana, number> = {
    DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
  };
  const baseLocalNoon = new Date(`${baseLocalYMD}T12:00:00-03:00`);
  const cur = baseLocalNoon.getUTCDay();
  const target = DIA_IDX_LOCAL[p.diaSemana] ?? 0;
  let delta = (target - cur + 7) % 7;

  if (delta === 0) {
    const agoraHM = localHM(agora);
    if (agoraHM >= p.horario) delta = 7;
  }

  let tentativaYMD = addDaysLocalYMD(baseLocalYMD, delta);

  for (let i = 0; i < 120; i++) {
    const tentativaUTC00 = toUtc00(tentativaYMD);
    const exc = await prisma.agendamentoPermanenteCancelamento.findFirst({
      where: { agendamentoPermanenteId: p.id, data: tentativaUTC00 },
      select: { id: true },
    });
    if (!exc) return tentativaYMD;
    tentativaYMD = addDaysLocalYMD(tentativaYMD, 7);
  }

  return tentativaYMD;
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
  usuarioId: z.string().uuid().optional(), // apenas admin pode setar dono
  jogadoresIds: z.array(z.string().uuid()).optional().default([]),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),

  // 🆕 novos
  professorId: z.string().uuid().optional(),
  tipoSessao: z.enum(["AULA", "JOGO"]).optional(),
  multa: z.coerce.number().min(0).optional(),

  // 🆕 APOIADO (compatível, não quebra nada)
  isApoiado: z.coerce.boolean().optional().default(false),
  apoiadoUsuarioId: z.string().uuid().optional(),
  obs: z.string().max(1000).optional(),
});

async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex");
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
 */
async function finalizarAgendamentosVencidos() {
  const agora = new Date();

  const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(agora);
  const agoraHHMM = localHM(agora, SP_TZ); // "HH:mm"

  const r1 = await prisma.agendamento.updateMany({
    where: {
      status: "CONFIRMADO",
      data: { lt: hojeUTC00 },
    },
    data: { status: "FINALIZADO" },
  });

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
    professorId: professorIdBody,
    tipoSessao: tipoSessaoBody,
    multa: multaBody,

    // 🆕 APOIADO
    isApoiado: isApoiadoBody = false,
    apoiadoUsuarioId,
    obs: obsBody,
  } = parsed.data;

  const usuarioIdDono =
    isAdmin && usuarioIdBody ? usuarioIdBody : reqCustom.usuario.usuarioLogadoId;

  try {
    // === TZ-safe: derive do YMD local salvo (00:00Z)
    const dataYMD = toISODateUTC(data); // "YYYY-MM-DD"
    const diaSemanaEnum = diasEnum[localWeekdayIndexOfYMD(dataYMD)] as DiaSemana;

    // 💸 Multa automática por “marcar horário que já passou” (base SP)
    const hojeLocalYMD = localYMD(new Date(), SP_TZ);
    const agoraLocalHM = localHM(new Date(), SP_TZ);
    let multaPorHorarioPassado: number | null = null;
    if (dataYMD === hojeLocalYMD && horario < agoraLocalHM) {
      multaPorHorarioPassado = Number(valorMultaPadrao().toFixed(2)); // 50.00
    }

    // Janela [00:00Z do dia local, 00:00Z do próximo dia local]
    const dataInicio = toUtc00(dataYMD);
    const dataFim = toUtc00(addDaysLocalYMD(dataYMD, 1));

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

    const dataUTC00 = toUtc00(dataYMD);

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

    // ======================== NOVO: Professor + TipoSessao + Multa ========================
    // 1) Checamos professorId explicitamente ou inferimos pelo dono (se o dono for professor)
    let professorIdFinal: string | null = professorIdBody ?? null;

    if (!professorIdFinal) {
      // Se o dono for professor, inferimos professorId = dono
      const dono = await prisma.usuario.findUnique({
        where: { id: usuarioIdDono },
        select: { id: true, tipo: true },
      });
      if (dono?.tipo === "ADMIN_PROFESSORES") {
        professorIdFinal = dono.id;
      }
    }

    if (professorIdFinal) {
      const prof = await prisma.usuario.findUnique({
        where: { id: professorIdFinal },
        select: { id: true, tipo: true },
      });
      if (!prof || prof.tipo !== "ADMIN_PROFESSORES") {
        return res.status(400).json({ erro: "professorId inválido (usuário não é professor)" });
      }
    }

    // 2) Definir tipoSessao (regras 18:00+ = JOGO; antes = AULA se não vier do front)
    const isNight = horario >= "18:00";
    let tipoSessaoFinal: TipoSessaoProfessor | null = null;

    if (professorIdFinal) {
      if (isNight) {
        tipoSessaoFinal = "JOGO";
      } else {
        // antes de 18h: se não vier nada, default AULA (compat compat com legado)
        const t = (tipoSessaoBody as TipoSessaoProfessor | undefined) ?? "AULA";
        tipoSessaoFinal = t;
      }
    }

    // 3) Multa: aceita número >=0 do body, mas prioriza a automática (horário passado hoje)
    const multaBodySan =
      typeof multaBody === "number" && Number.isFinite(multaBody) && multaBody >= 0
        ? Number(multaBody.toFixed(2))
        : null;
    const multaPersistir = multaPorHorarioPassado ?? multaBodySan;

    // ======================== NOVO: APOIADO (persistência) ========================
    let isApoiadoFinal = false;
    let apoiadoUsuarioIdFinal: string | null = null;

    if (professorIdFinal && tipoSessaoFinal === "AULA") {
      if (isApoiadoBody === true) {
        if (!apoiadoUsuarioId) {
          return res.status(400).json({
            erro: "apoiadoUsuarioId é obrigatório quando 'isApoiado' for true em AULA com professor",
          });
        }
        const apoiadoUser = await prisma.usuario.findUnique({
          where: { id: apoiadoUsuarioId },
          select: { id: true, tipo: true },
        });
        if (!apoiadoUser) {
          return res.status(404).json({ erro: "Usuário apoiado não encontrado" });
        }
        // 🔧 compatível com teu schema atual
        const tipoOk = ["CLIENTE", "CLIENTE_APOIADO"].includes(String(apoiadoUser.tipo));
        if (!tipoOk) {
          return res.status(422).json({ erro: "Usuário selecionado como apoiado não é cliente" });
        }
        isApoiadoFinal = true;
        apoiadoUsuarioIdFinal = apoiadoUser.id;
      }
    }

    const convidadosCriadosIds: string[] = [];
    for (const nome of convidadosNomes) {
      const convidado = await criarConvidadoComoUsuario(nome);
      convidadosCriadosIds.push(convidado.id);
    }

    // garante connect do apoiado como jogador quando aplicável
    const baseIds = [usuarioIdDono, ...jogadoresIds, ...convidadosCriadosIds];
    if (isApoiadoFinal && apoiadoUsuarioIdFinal) baseIds.push(apoiadoUsuarioIdFinal);

    const connectIds = Array.from(new Set<string>(baseIds)).map((id) => ({ id }));

    // monta obs final com a tag de apoiado, preservando obs existente
    let obsFinal: string | undefined = obsBody;
    if (isApoiadoFinal && apoiadoUsuarioIdFinal) {
      const tag = `[APOIADO:${apoiadoUsuarioIdFinal}]`;
      obsFinal = obsBody ? `${obsBody}\n${tag}` : tag;
    }

    const novoAgendamento = await prisma.agendamento.create({
      data: {
        data,
        horario,
        quadraId,
        esporteId,
        usuarioId: usuarioIdDono,
        status: "CONFIRMADO",
        jogadores: { connect: connectIds },

        // 🆕 persistência dos campos
        professorId: professorIdFinal,
        tipoSessao: tipoSessaoFinal,
        multa: multaPersistir ?? null,

        // 🆕 APOIO (agora persistido)
        isencaoApoiado: isApoiadoFinal,
        apoiadoUsuarioId: apoiadoUsuarioIdFinal,

        // compat existente:
        obs: obsFinal,
      },
      include: {
        jogadores: { select: { id: true, nome: true, email: true } },
        usuario: { select: { id: true, nome: true, email: true, tipo: true } },
        professor: { select: { id: true, nome: true, email: true } }, // nova relação
        quadra: { select: { id: true, nome: true, numero: true } },
        esporte: { select: { id: true, nome: true } },
      },
    });

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
          professorId: professorIdFinal,
          tipoSessao: tipoSessaoFinal,
          multa: multaPersistir ?? null,
          // 🆕 trilha do apoiado
          isApoiado: isApoiadoFinal,
          apoiadoUsuarioId: apoiadoUsuarioIdFinal,
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar criação:", e);
    }

    return res.status(201).json(novoAgendamento);
  } catch (err: any) {
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

  const { data, quadraId, usuarioId } = req.query as {
    data?: string;
    quadraId?: string;
    usuarioId?: string;
  };

  const where: any = {};
  if (quadraId) where.quadraId = String(quadraId);

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
          select: { id: true, nome: true, email: true, tipo: true },
        },
        professor: {
          select: { id: true, nome: true, email: true },
        },
        jogadores: {
          select: { id: true, nome: true, email: true },
        },
        esporte: {
          select: { id: true, nome: true },
        },
        // 🆕 apoio
        apoiadoUsuario: { select: { id: true, nome: true, email: true } },
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
        professor: a.professor
          ? { ...a.professor, email: sanitizeEmail(a.professor.email) }
          : null,
        jogadores: a.jogadores.map((j) => ({ ...j, email: sanitizeEmail(j.email) })),
        quadraLogoUrl: resolveQuadraImg(a.quadra?.imagem) || "/quadra.png",
        donoId: a.usuario?.id ?? a.usuarioId,
        donoNome: a.usuario?.nome ?? "",
        euSouDono,
        // 🆕 APOIO no payload (sanitizado)
        isencaoApoiado: a.isencaoApoiado ?? false,
        apoiadoUsuario: a.apoiadoUsuario
          ? { ...a.apoiadoUsuario, email: sanitizeEmail(a.apoiadoUsuario.email) }
          : null,
      };
    });

    return res.json(resposta);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});

// GET /agendamentos/me
router.get("/me", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoNome?: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  try {
    const usuarioId = reqCustom.usuario.usuarioLogadoId;

    const comunsConfirmados = await prisma.agendamento.findMany({
      where: {
        status: "CONFIRMADO",
        OR: [{ usuarioId }, { jogadores: { some: { id: usuarioId } } }],
      },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } },
        professor: { select: { id: true, nome: true } },
        // 🆕 ver apoio também
        apoiadoUsuario: { select: { id: true, nome: true } },
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
        data: a.data.toISOString().slice(0, 10),
        quadraNome: a.quadra?.nome ?? "",
        quadraNumero: a.quadra?.numero ?? null,
        quadraLogoUrl,
        esporteNome: a.esporte?.nome ?? "",
        donoId: a.usuario?.id ?? a.usuarioId,
        donoNome: a.usuario?.nome ?? "",
        euSouDono,
        // 🆕 extras
        professorId: a.professor ? a.professor.id : null,
        professorNome: a.professor ? a.professor.nome : null,
        tipoSessao: a.tipoSessao ?? null,
        multa: a.multa ?? null,
        multaAnulada: a.multaAnulada ?? false, // 👈 AQUI
        // 🆕 APOIO
        isencaoApoiado: a.isencaoApoiado ?? false,
        apoiadoUsuario: a.apoiadoUsuario ? { id: a.apoiadoUsuario.id, nome: a.apoiadoUsuario.nome } : null,
      };
    });


    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        usuarioId,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } },
      },
      orderBy: [{ diaSemana: "asc" }, { horario: "asc" }],
    });

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
        data: null,
        diaSemana: p.diaSemana,
        proximaData,
        proximaDataBloqueada,
        ...(bloqueioInfo ? { bloqueioInfo } : {}),
        quadraNome: p.quadra?.nome ?? "",
        quadraNumero: p.quadra?.numero ?? null,
        quadraLogoUrl,
        esporteNome: p.esporte?.nome ?? "",
        donoId: p.usuario?.id ?? p.usuarioId,
        donoNome: p.usuario?.nome ?? "",
        euSouDono: true,
      };
    });

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

// 🔎 Lista transferências feitas pelo usuário logado
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
        professor: { select: { id: true, nome: true, email: true } },
        quadra: { select: { nome: true, numero: true } },
        esporte: { select: { nome: true } },
        // 🆕 apoio
        apoiadoUsuario: { select: { id: true, nome: true, email: true, celular: true } },
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
      usuarioId: agendamento.usuario?.id,
      esporte: agendamento.esporte?.nome,
      quadra: `${agendamento.quadra?.nome} (Nº ${agendamento.quadra?.numero})`,
      jogadores: agendamento.jogadores.map((j) => ({
        id: j.id,
        nome: j.nome,
        email: sanitizeEmail(j.email),
        celular: sanitizePhone(j.celular),
      })),
      // 🆕 extras
      professor: agendamento.professor
        ? {
          id: agendamento.professor.id,
          nome: agendamento.professor.nome,
          email: sanitizeEmail(agendamento.professor.email),
        }
        : null,
      professorId: agendamento.professorId ?? null,
      tipoSessao: agendamento.tipoSessao ?? null,
      multa: agendamento.multa ?? null,
      multaAnulada: agendamento.multaAnulada ?? false, // 👈 AQUI
      // 🆕 APOIO
      isencaoApoiado: agendamento.isencaoApoiado ?? false,
      apoiadoUsuario: agendamento.apoiadoUsuario
        ? {
          id: agendamento.apoiadoUsuario.id,
          nome: agendamento.apoiadoUsuario.nome,
          email: sanitizeEmail(agendamento.apoiadoUsuario.email),
          celular: sanitizePhone(agendamento.apoiadoUsuario.celular),
        }
        : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao buscar agendamento" });
  }
});

// 💸 Aplicar multa manual em um agendamento (apenas admin)
router.post("/:id/aplicar-multa", verificarToken, async (req, res) => {
  const { id } = req.params;

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };

  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  // Apenas admin pode aplicar multa
  if (!isAdminRole(reqCustom.usuario.usuarioLogadoTipo)) {
    return res.status(403).json({ erro: "Apenas administradores podem aplicar multa" });
  }

  try {
    const ag = await prisma.agendamento.findUnique({
      where: { id },
      select: {
        id: true,
        data: true,
        horario: true,
        usuarioId: true,
        professorId: true,
        status: true,
        multa: true,
        multaAnulada: true,
      },
    });

    if (!ag) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    // Só faz sentido multar agendamento que "existiu" de fato
    if (!["CONFIRMADO", "FINALIZADO"].includes(ag.status)) {
      return res.status(409).json({
        erro: "Só é possível aplicar multa em agendamentos confirmados ou finalizados.",
      });
    }

    // Se já tiver uma multa ativa, não deixa aplicar outra
    if (ag.multa != null && !ag.multaAnulada) {
      return res.status(409).json({
        erro: "Este agendamento já possui uma multa ativa.",
      });
    }

    // Valor fixo da multa (hoje R$ 50,00)
    const valorMulta = Number(valorMultaPadrao().toFixed(2)); // ex: 50.00

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        multa: valorMulta,
        multaAnulada: false,
        multaAnuladaEm: null,
        multaAnuladaPorId: null,
      },
    });

    // AUDITORIA
    try {
      await logAudit({
        event: "AGENDAMENTO_MULTA_APLICAR",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          agendamentoId: id,
          multaAntes: ag.multa,
          multaDepois: valorMulta,
          multaAnuladaAntes: ag.multaAnulada ?? false,
          multaAnuladaDepois: false,
          status: ag.status,
          data: ag.data.toISOString().slice(0, 10),
          horario: ag.horario,
          professorId: ag.professorId ?? null,
          donoId: ag.usuarioId,
          aplicadoPorId: reqCustom.usuario.usuarioLogadoId,
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar aplicação de multa:", e);
    }

    return res.status(200).json({
      message: "Multa aplicada com sucesso.",
      agendamento: atualizado,
    });
  } catch (error) {
    console.error("Erro ao aplicar multa no agendamento:", error);

    try {
      await logAudit({
        event: "OTHER",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          action: "APLICAR_MULTA_FAIL",
          error: (error as any)?.message ?? String(error),
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar erro de aplicar multa:", e);
    }

    return res.status(500).json({ erro: "Erro ao aplicar multa no agendamento." });
  }
});


// 💸 Remover/anular multa de um agendamento (apenas admin)
router.post("/:id/remover-multa", verificarToken, async (req, res) => {
  const { id } = req.params;

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  // Apenas admin pode anular multa
  if (!isAdminRole(reqCustom.usuario.usuarioLogadoTipo)) {
    return res.status(403).json({ erro: "Apenas administradores podem remover multa" });
  }

  try {
    const ag = await prisma.agendamento.findUnique({
      where: { id },
      select: {
        id: true,
        data: true,
        horario: true,
        usuarioId: true,
        professorId: true,
        status: true,
        multa: true,
        multaAnulada: true,
      },
    });

    if (!ag) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    // se nunca teve multa
    if (ag.multa == null) {
      return res.status(409).json({ erro: "Este agendamento não possui multa para ser removida." });
    }

    // se já foi anulada antes
    if (ag.multaAnulada) {
      return res.status(409).json({ erro: "A multa deste agendamento já foi anulada." });
    }

    const agora = new Date();

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        multa: null, // 👈 some das contas
        multaAnulada: true,
        multaAnuladaEm: agora,
        multaAnuladaPorId: reqCustom.usuario.usuarioLogadoId,
      },
    });

    // AUDITORIA
    try {
      await logAudit({
        event: "AGENDAMENTO_MULTA_ANULAR",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          agendamentoId: id,
          multaAntes: ag.multa,
          multaDepois: null,
          multaAnulada: true,
          multaAnuladaEm: agora.toISOString(),
          multaAnuladaPorId: reqCustom.usuario.usuarioLogadoId,
          status: ag.status,
          data: ag.data.toISOString().slice(0, 10),
          horario: ag.horario,
          professorId: ag.professorId ?? null,
          donoId: ag.usuarioId,
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar anulação de multa:", e);
    }

    return res.status(200).json({
      message: "Multa removida com sucesso.",
      agendamento: atualizado,
    });
  } catch (error) {
    console.error("Erro ao remover multa do agendamento:", error);

    try {
      await logAudit({
        event: "OTHER",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          action: "REMOVER_MULTA_FAIL",
          error: (error as any)?.message ?? String(error),
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar erro de remover multa:", e);
    }

    return res.status(500).json({ erro: "Erro ao remover multa do agendamento." });
  }
});


// ✅ Cancelar agendamento comum (cliente 12h / professor 2h / super-admin sem limite)
// Mantém a sua janela de 15min pós-criação quando faltar menos que o limite.
router.post("/cancelar/:id", verificarToken, async (req, res) => {
  const { id } = req.params;

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  try {
    const ag = await prisma.agendamento.findUnique({
      where: { id },
      select: {
        id: true,
        data: true,
        horario: true,
        usuarioId: true,
        status: true,
        createdAt: true,
      },
    });

    if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado" });

    if (["CANCELADO", "TRANSFERIDO", "FINALIZADO"].includes(ag.status)) {
      return res.status(409).json({ erro: "Este agendamento não pode ser cancelado." });
    }

    const tipo = reqCustom.usuario.usuarioLogadoTipo;
    const isAdmin = isAdminRole(tipo);
    const isSuperAdmin = isSuperAdminRole(tipo);
    const isOwner = String(ag.usuarioId) === String(reqCustom.usuario.usuarioLogadoId);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ erro: "Você não pode cancelar este agendamento." });
    }

    if (!isSuperAdmin) {
      const limitHours = cancellationWindowHours(tipo); // 12, 2 ou Infinity

      const now = new Date();
      const nowYMD = localYMD(now);
      const nowHM = localHM(now);
      const nowMs = msFromLocalYMDHM(nowYMD, nowHM);

      const schedYMD = ag.data.toISOString().slice(0, 10);
      const schedHM = ag.horario;
      const schedMs = msFromLocalYMDHM(schedYMD, schedHM);

      if (schedMs <= nowMs) {
        return res
          .status(422)
          .json({ erro: "Não é possível cancelar um agendamento já iniciado ou finalizado." });
      }

      const minutesToStart = Math.floor((schedMs - nowMs) / 60000);
      const requiredMinutes = limitHours === Infinity ? 0 : limitHours * 60;

      if (limitHours !== Infinity && minutesToStart < requiredMinutes) {
        const createdYMD = localYMD(ag.createdAt);
        const createdHM = localHM(ag.createdAt);
        const createdMs = msFromLocalYMDHM(createdYMD, createdHM);
        const minutesSinceCreation = Math.floor((nowMs - createdMs) / 60000);

        if (minutesSinceCreation > 15) {
          return res.status(422).json({
            erro:
              `Cancelamento permitido até ${limitHours} horas antes do horário do agendamento ` +
              "ou, se faltar menos que isso, em até 15 minutos após a criação.",
          });
        }
      }
    }

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoPorId: reqCustom.usuario.usuarioLogadoId,
      },
    });

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

    const novoUsuario = await prisma.usuario.findUnique({
      where: { id: novoUsuarioId },
    });
    if (!novoUsuario) {
      return res.status(404).json({ erro: "Novo usuário não encontrado" });
    }

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
          usuarioId: novoUsuarioId,
          quadraId: agendamento.quadraId,
          esporteId: agendamento.esporteId,
          jogadores: { connect: [{ id: novoUsuarioId }] },

          // mantém professor/tipoSessao/multa do original
          professorId: agendamento.professorId ?? null,
          tipoSessao: agendamento.tipoSessao ?? null,
          multa: agendamento.multa ?? null,

          // 🆕 PROPAGAR APOIO
          isencaoApoiado: agendamento.isencaoApoiado ?? false,
          apoiadoUsuarioId: agendamento.apoiadoUsuarioId ?? null,
        },
        include: {
          usuario: true,
          jogadores: true,
          quadra: true,
        },
      }),
    ]);

    try {
      await logAudit({
        event: "AGENDAMENTO_TRANSFER",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
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

    const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);
    const isOwner = agendamento.usuarioId === reqCustom.usuario.usuarioLogadoId;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ erro: "Sem permissão para alterar este agendamento" });
    }

    const usuariosValidos = jogadoresIds.length
      ? await prisma.usuario.findMany({
        where: { id: { in: jogadoresIds } },
        select: { id: true },
      })
      : [];

    if (usuariosValidos.length !== jogadoresIds.length) {
      return res.status(400).json({ erro: "Um ou mais jogadores não existem" });
    }

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
          senha: hashDefault,
          tipo: "CLIENTE",
        },
        select: { id: true },
      });

      convidadosCriados.push({ id: novo.id });
    }

    const jaConectados = new Set(agendamento.jogadores.map((j) => j.id));

    const idsNovosExistentes = usuariosValidos
      .map((u) => u.id)
      .filter((uid) => !jaConectados.has(uid));

    const idsConvidados = convidadosCriados.map((c) => c.id);

    if (idsNovosExistentes.length === 0 && idsConvidados.length === 0) {
      const atual = await prisma.agendamento.findUnique({
        where: { id },
        include: { usuario: true, jogadores: true, quadra: true, esporte: true },
      });
      return res.json(atual);
    }

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
