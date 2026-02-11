import { Router } from "express";
import {
  PrismaClient,
  DiaSemana,
  TipoSessaoProfessor,
  AtendenteFeature,
  TipoUsuario,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import verificarToken from "../middleware/authMiddleware";
import { isAdmin as isAdminTipo, requireOwnerByRecord } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit"; // 👈 AUDIT
import { requireAtendenteFeature } from "../middleware/atendenteFeatures";
import { notifyAdmins } from "../utils/notificacoes"; // ✅ usa teu hub/SSE + grava no DB

const prisma = new PrismaClient();
const router = Router();

/** ===================== FUSO/HORÁRIO – SEMPRE SP ====================== */
const SP_TZ = process.env.TZ || "America/Sao_Paulo";

// "YYYY-MM-DD" no fuso de SP
function localYMD(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// "HH:mm" no fuso de SP
function localHM(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// Converte "YYYY-MM-DD" (dia local) para Date em 00:00Z (padrão de persistência)
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}

// Data → "YYYY-MM-DD" (apenas parte de data)
function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Retorna índice da semana (0..6) do DIA LOCAL informado (YMD) — estável
function localWeekdayIndexOfYMD(ymd: string): number {
  // Meio-dia em SP (-03:00) evita bordas/rollover
  return new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
}

// Soma dias em "linha do tempo local" (retorna YMD local)
function addDaysLocalYMD(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return localYMD(d);
}

// Soma meses em "linha do tempo local" (retorna YMD local)
function addMonthsLocalYMD(ymd: string, months: number): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return localYMD(d);
}

// Limites (início/fim) de um DIA LOCAL codificados em UTC
function storedUtcBoundaryForLocalYMD(ymd: string) {
  const inicio = toUtc00(ymd);
  const fim = toUtc00(addDaysLocalYMD(ymd, 1)); // próximo dia local em UTC00
  return { inicio, fim };
}

// 👉 helper p/ checar se um horário "HH:MM" está em [inicio, fim)
function horarioDentroIntervalo(h: string, ini: string, fim: string) {
  return h >= ini && h < fim;
}

/** ===================== RBAC/REGRAS ====================== */
const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

function cancellationWindowHours(tipo?: string): number | null {
  if (tipo === "ADMIN_MASTER" || tipo === "ADMIN_ATENDENTE") return null; // sem limite
  if (tipo === "ADMIN_PROFESSORES") return 2; // 2h antes
  return 12; // cliente
}

function within15MinFrom(date: Date): boolean {
  const diffMin = (Date.now() - new Date(date).getTime()) / 60000;
  return diffMin <= 15;
}

/** ===================== NOTIF: cancelamento em cima da hora (PERMANENTE) ======================
 * Regra pedida:
 * - notificar cancelamentos feitos por admin (MASTER/ATENDENTE)
 * - quando a ocorrência cancelada tem chance de ser dentro de 12h (faltam >0 e < 12h)
 *
 * Observação:
 * - usamos NotificationType.AGENDAMENTO_PERMANENTE_EXCECAO (já existe no schema)
 */
function msFromLocalYMDHM(ymd: string, hm: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

function minutesUntilStartLocal(isoYMDLocal: string, agHM: string) {
  const now = new Date();
  const nowYMD = localYMD(now);
  const nowHM = localHM(now);
  const nowMs = msFromLocalYMDHM(nowYMD, nowHM);

  const schedMs = msFromLocalYMDHM(isoYMDLocal, agHM);
  return Math.floor((schedMs - nowMs) / 60000);
}

function formatFaltam(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.abs(mins % 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}

async function maybeNotifyCancelamentoPermDentro12h(params: {
  actorId: string | null;
  actorTipo?: string | null;
  permanente: {
    id: string;
    diaSemana: DiaSemana;
    horario: string;
    quadraId: string;
    esporteId: string;
    usuarioId: string;
  };
  dataOcorrenciaISO: string; // "YYYY-MM-DD" (dia local)
  motivo?: string | null;
}) {
  const { actorId, actorTipo, permanente, dataOcorrenciaISO, motivo } = params;

  // ✅ só admin (master/atendente)
  if (!(actorTipo === "ADMIN_MASTER" || actorTipo === "ADMIN_ATENDENTE")) return;

  const mins = minutesUntilStartLocal(dataOcorrenciaISO, permanente.horario);

  // ✅ faltam > 0 e < 12h
  if (!(mins > 0 && mins < 12 * 60)) return;

  // nome do admin que cancelou
  let actorNome = "Admin";
  if (actorId) {
    const a = await prisma.usuario.findUnique({
      where: { id: actorId },
      select: { nome: true },
    });
    if (a?.nome) actorNome = a.nome;
  }

  // pega detalhes do slot (quadra/esporte/dono)
  const [quadra, esporte, dono] = await Promise.all([
    prisma.quadra.findUnique({
      where: { id: permanente.quadraId },
      select: { id: true, nome: true, numero: true },
    }),
    prisma.esporte.findUnique({
      where: { id: permanente.esporteId },
      select: { id: true, nome: true },
    }),
    prisma.usuario.findUnique({
      where: { id: permanente.usuarioId },
      select: { id: true, nome: true },
    }),
  ]);

  const quadraLabel =
    quadra?.numero != null ? `Quadra ${quadra.numero}` : quadra?.nome ?? "Quadra";
  const esporteNome = esporte?.nome ?? "Esporte";
  const donoNome = dono?.nome ?? "Usuário";
  const faltam = formatFaltam(mins);

  const title = "Cancelamento em cima da hora (permanente)";
  const message =
    `${actorNome} cancelou uma ocorrência de permanente com menos de 12h: ` +
    `${esporteNome} • ${quadraLabel} • ${dataOcorrenciaISO} ${permanente.horario} ` +
    `(faltavam ${faltam}) • Dono: ${donoNome}` +
    (motivo ? ` • Motivo: ${motivo}` : "");

  // grava + manda SSE
  await notifyAdmins({
    type: NotificationType.AGENDAMENTO_PERMANENTE_EXCECAO,
    title,
    message,
    actorId,
    data: {
      permanenteId: permanente.id,
      data: dataOcorrenciaISO,
      horario: permanente.horario,
      minsAteInicio: mins,
      quadraId: quadra?.id ?? permanente.quadraId,
      quadraNumero: quadra?.numero ?? null,
      quadraNome: quadra?.nome ?? null,
      esporteId: esporte?.id ?? permanente.esporteId,
      esporteNome,
      usuarioId: dono?.id ?? permanente.usuarioId,
      usuarioNome: donoNome,
      canceladoPorId: actorId,
      canceladoPorNome: actorNome,
      canceladoPorTipo: actorTipo ?? null,
      motivo: motivo ?? null,
    } satisfies Prisma.JsonObject,
  });
}

/** ===================== VALIDACÕES ====================== */
const schemaAgendamentoPermanente = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  horario: z.string().min(1), // "HH:mm"
  quadraId: z.string().uuid(),
  esporteId: z.string().uuid(),
  usuarioId: z.string().uuid().optional(),
  dataInicio: z.string().optional(), // "YYYY-MM-DD" (dia local) — opcional
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),

  // novos (opcionais)
  professorId: z.string().uuid().optional(),
  tipoSessao: z.enum(["AULA", "JOGO"]).optional(),
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

/* ============================================================================ */

async function getJanelasForEsporte(esporteId: string, diaSemana: DiaSemana | null) {
  let doDia: Array<{ tipoSessao: TipoSessaoProfessor; inicioHHMM: string; fimHHMM: string; ativo: boolean }> = [];
  let padrao: Array<{ tipoSessao: TipoSessaoProfessor; inicioHHMM: string; fimHHMM: string; ativo: boolean }> = [];

  try {
    [doDia, padrao] = await Promise.all([
      prisma.esporteJanelaAula.findMany({
        where: { esporteId, diaSemana },
        select: { tipoSessao: true, inicioHHMM: true, fimHHMM: true, ativo: true },
      }),
      prisma.esporteJanelaAula.findMany({
        where: { esporteId, diaSemana: null },
        select: { tipoSessao: true, inicioHHMM: true, fimHHMM: true, ativo: true },
      }),
    ]);
  } catch {
    doDia = [];
    padrao = [];
  }

  const byTipo = new Map<TipoSessaoProfessor, { inicioHHMM: string; fimHHMM: string }>();
  for (const r of padrao.filter((r) => r.ativo)) {
    byTipo.set(r.tipoSessao as TipoSessaoProfessor, { inicioHHMM: r.inicioHHMM, fimHHMM: r.fimHHMM });
  }
  for (const r of doDia.filter((r) => r.ativo)) {
    byTipo.set(r.tipoSessao as TipoSessaoProfessor, { inicioHHMM: r.inicioHHMM, fimHHMM: r.fimHHMM });
  }
  return byTipo;
}

const JOGO_DEFAULT_INICIO = "07:00";
const JOGO_DEFAULT_FIM_EXCLUSIVE = "23:59";
function jogoDefaultPermitido(hhmm: string) {
  return horarioDentroIntervalo(hhmm, JOGO_DEFAULT_INICIO, JOGO_DEFAULT_FIM_EXCLUSIVE);
}

async function resolveSessoesPermitidas(esporteId: string, diaSemana: DiaSemana, horario: string): Promise<Set<TipoSessaoProfessor>> {
  const j = await getJanelasForEsporte(esporteId, diaSemana);
  const allow = new Set<TipoSessaoProfessor>();

  const aulaJ = j.get("AULA" as TipoSessaoProfessor);
  if (aulaJ && horarioDentroIntervalo(horario, aulaJ.inicioHHMM, aulaJ.fimHHMM)) {
    allow.add("AULA");
  }

  if (jogoDefaultPermitido(horario)) {
    allow.add("JOGO");
  } else {
    const jogoJ = j.get("JOGO" as TipoSessaoProfessor);
    if (jogoJ && horarioDentroIntervalo(horario, jogoJ.inicioHHMM, jogoJ.fimHHMM)) {
      allow.add("JOGO");
    }
  }

  return allow;
}

/** ===================== Próxima data (local SP) ====================== */
async function proximaDataPermanenteSemExcecao(p: {
  id: string;
  diaSemana: DiaSemana;
  dataInicio: Date | null;
}): Promise<string | null> {
  const hojeLocalYMD = localYMD(new Date());
  const dataInicioLocalYMD = p.dataInicio ? toISODateUTC(p.dataInicio) : null;

  const baseLocalYMD =
    dataInicioLocalYMD && dataInicioLocalYMD > hojeLocalYMD ? dataInicioLocalYMD : hojeLocalYMD;

  const cur = localWeekdayIndexOfYMD(baseLocalYMD);
  const target = DIA_IDX[p.diaSemana] ?? 0;
  let delta = (target - cur + 7) % 7;

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
  return null;
}

/** ===================== Middleware ====================== */
router.use(verificarToken);

router.use((req, res, next) => {
  const tipo = (req as any).usuario?.usuarioLogadoTipo;

  if (tipo !== "ADMIN_ATENDENTE") return next();

  const allowAtdAgendamentos =
    (req.method === "GET" && /^\/[^/]+$/.test(req.path)) ||
    (req.method === "GET" && /^\/[^/]+\/datas-excecao$/.test(req.path)) ||
    (req.method === "POST" && /^\/[^/]+\/cancelar-dia$/.test(req.path)) ||
    (req.method === "POST" && /^\/[^/]+\/cancelar-proxima$/.test(req.path));

  if (allowAtdAgendamentos) {
    return requireAtendenteFeature(AtendenteFeature.ATD_AGENDAMENTOS)(req, res, next);
  }

  return requireAtendenteFeature(AtendenteFeature.ATD_PERMANENTES)(req, res, next);
});

/** ===================== Utilitário para o front ===================== */
router.get("/_sessoes-permitidas", async (req, res) => {
  const esporteId = String(req.query.esporteId || "");
  const diaSemanaStr = String(req.query.diaSemana || "");
  const horario = String(req.query.horario || "");

  if (!esporteId || !horario || !diaSemanaStr) {
    return res.status(400).json({ erro: "Informe esporteId, diaSemana e horario (HH:mm)." });
  }
  if (!(diaSemanaStr in DiaSemana)) {
    return res.status(400).json({ erro: "diaSemana inválido." });
  }
  const diaSemana = diaSemanaStr as keyof typeof DiaSemana as DiaSemana;

  try {
    const allow = await resolveSessoesPermitidas(esporteId, diaSemana, horario);
    return res.json({ allow: Array.from(allow) });
  } catch (e) {
    console.error("erro _sessoes-permitidas:", e);
    return res.status(500).json({ erro: "Falha ao verificar sessões permitidas." });
  }
});

/** ===================== Rotas ====================== */
// 🔄 Criar agendamento permanente
router.post("/", async (req, res) => {
  const validacao = schemaAgendamentoPermanente.safeParse(req.body);
  if (!validacao.success) return res.status(400).json({ erro: validacao.error.errors });

  const {
    diaSemana,
    horario,
    quadraId,
    esporteId,
    usuarioId: usuarioIdBody,
    dataInicio,
    convidadosNomes = [],
    professorId: professorIdBody,
    tipoSessao: tipoSessaoBody,
  } = validacao.data;

  try {
    const quadra = await prisma.quadra.findUnique({
      where: { id: quadraId },
      include: { quadraEsportes: true },
    });
    if (!quadra) return res.status(404).json({ erro: "Quadra não encontrada" });

    const pertenceAoEsporte = quadra.quadraEsportes.some((qe) => qe.esporteId === esporteId);
    if (!pertenceAoEsporte) return res.status(400).json({ erro: "A quadra não está associada ao esporte informado" });

    const permanenteExistente = await prisma.agendamentoPermanente.findFirst({
      where: { diaSemana, horario, quadraId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
      select: { id: true },
    });
    if (permanenteExistente) {
      return res.status(409).json({ erro: "Já existe um agendamento permanente nesse horário, quadra e dia" });
    }

    const agendamentosComuns = await prisma.agendamento.findMany({
      where: { horario, quadraId, status: "CONFIRMADO" },
      select: { data: true },
    });
    const targetIdx = DIA_IDX[diaSemana];
    const possuiConflito = agendamentosComuns.some((ag) => new Date(ag.data).getUTCDay() === targetIdx);
    if (possuiConflito && !dataInicio) {
      return res.status(409).json({ erro: "Conflito com agendamento comum existente nesse dia, horário e quadra" });
    }

    const ehAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
    let usuarioIdDono = req.usuario!.usuarioLogadoId;
    if (ehAdmin) {
      if (usuarioIdBody) {
        usuarioIdDono = usuarioIdBody;
      } else if (convidadosNomes.length > 0) {
        const convidado = await criarConvidadoComoUsuario(convidadosNomes[0]);
        usuarioIdDono = convidado.id;
      }
    }

    let professorIdFinal: string | null = professorIdBody ?? null;
    if (!professorIdFinal) {
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

    let tipoSessaoFinal: TipoSessaoProfessor | null = null;
    let sessoesPermitidasAudit: string[] = [];

    if (professorIdFinal) {
      const allow = await resolveSessoesPermitidas(esporteId, diaSemana, horario);
      if (allow.size === 0) return res.status(422).json({ erro: "Horário indisponível para este esporte." });
      sessoesPermitidasAudit = Array.from(allow);

      if (tipoSessaoBody && !allow.has(tipoSessaoBody as TipoSessaoProfessor)) {
        return res.status(422).json({ erro: `Tipo de sessão '${tipoSessaoBody}' não permitido neste horário.` });
      }

      if (allow.size === 1) {
        tipoSessaoFinal = Array.from(allow)[0];
      } else {
        tipoSessaoFinal = (tipoSessaoBody as TipoSessaoProfessor | undefined) ?? "AULA";
      }
    }

    const novo = await prisma.agendamentoPermanente.create({
      data: {
        diaSemana,
        horario,
        quadraId,
        esporteId,
        usuarioId: usuarioIdDono,
        ...(dataInicio ? { dataInicio: toUtc00(dataInicio) } : {}),
        professorId: professorIdFinal,
        tipoSessao: tipoSessaoFinal,
      },
      select: {
        id: true,
        diaSemana: true,
        horario: true,
        quadraId: true,
        esporteId: true,
        usuarioId: true,
        dataInicio: true,
        status: true,
        createdAt: true,
      },
    });

    try {
      await logAudit({
        event: "AGENDAMENTO_PERM_CREATE",
        req,
        target: { type: TargetType.AGENDAMENTO_PERMANENTE, id: novo.id },
        metadata: {
          permanenteId: novo.id,
          donoId: novo.usuarioId,
          diaSemana: novo.diaSemana,
          horario: novo.horario,
          quadraId,
          esporteId,
          dataInicio: novo.dataInicio ?? null,
          professorId: professorIdFinal,
          tipoSessao: tipoSessaoFinal,
          sessoesPermitidas: sessoesPermitidasAudit,
        },
      });
    } catch (e) {
      console.error("[audit] perm create error:", e);
    }

    return res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
  }
});

// 📋 Listar
router.get("/", async (req, res) => {
  try {
    const ehAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
    const where = ehAdmin ? {} : { usuarioId: req.usuario!.usuarioLogadoId };

    const agendamentos = await prisma.agendamentoPermanente.findMany({
      where,
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        professor: { select: { id: true, nome: true, email: true } },
        quadra: { select: { id: true, nome: true, numero: true } },
        esporte: { select: { id: true, nome: true } },
      },
      orderBy: [{ diaSemana: "asc" }, { horario: "asc" }],
    });
    return res.status(200).json(agendamentos);
  } catch (error) {
    console.error("Erro ao buscar agendamentos permanentes:", error);
    return res.status(500).json({ erro: "Erro ao buscar agendamentos permanentes" });
  }
});

// 📊 Estatísticas (mantido)
router.get("/estatisticas/resumo", async (req, res) => {
  const ehAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
  if (!ehAdmin) return res.status(403).json({ erro: "Apenas administradores podem ver as estatísticas" });

  const diasQ = Number(req.query.dias ?? "90");
  const diasJanela = Number.isFinite(diasQ) ? Math.max(7, Math.min(365, Math.trunc(diasQ))) : 90;

  try {
    const hojeYMD = localYMD(new Date());
    const inicioYMD = addDaysLocalYMD(hojeYMD, -(diasJanela - 1));
    const inicioUTC = toUtc00(inicioYMD);
    const fimExclusiveUTC = toUtc00(addDaysLocalYMD(hojeYMD, 1));

    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: {
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lt: fimExclusiveUTC } }],
      },
      select: { id: true, diaSemana: true, dataInicio: true },
    });

    if (permanentes.length === 0) {
      return res.json({
        diasJanela,
        inicioJanela: inicioYMD,
        fimJanelaInclusive: hojeYMD,
        totalPermanentesAtivos: 0,
        totalOcorrencias: 0,
        diasComOcorrencia: 0,
        mediaPorDia: 0,
        detalhesPorDia: [],
      });
    }

    const ids = permanentes.map((p) => p.id);

    const cancelamentos = await prisma.agendamentoPermanenteCancelamento.findMany({
      where: { agendamentoPermanenteId: { in: ids }, data: { gte: inicioUTC, lt: fimExclusiveUTC } },
      select: { agendamentoPermanenteId: true, data: true },
    });

    const cancelSet = new Set<string>();
    for (const c of cancelamentos) {
      const ymd = toISODateUTC(new Date(c.data));
      cancelSet.add(`${c.agendamentoPermanenteId}|${ymd}`);
    }

    const datasPorWeekIdx = new Map<number, string[]>();
    for (let i = 0; i < diasJanela; i++) {
      const ymd = addDaysLocalYMD(inicioYMD, i);
      const idx = localWeekdayIndexOfYMD(ymd);
      const arr = datasPorWeekIdx.get(idx) ?? [];
      arr.push(ymd);
      datasPorWeekIdx.set(idx, arr);
    }

    const porDia = new Map<string, number>();
    let totalOcorrencias = 0;

    for (const p of permanentes) {
      const targetIdx = DIA_IDX[p.diaSemana as DiaSemana] ?? 0;
      const datas = datasPorWeekIdx.get(targetIdx) ?? [];
      const dataInicioLocalYMD = p.dataInicio ? toISODateUTC(new Date(p.dataInicio)) : null;

      for (const ymd of datas) {
        if (dataInicioLocalYMD && ymd < dataInicioLocalYMD) continue;
        if (cancelSet.has(`${p.id}|${ymd}`)) continue;

        totalOcorrencias++;
        porDia.set(ymd, (porDia.get(ymd) ?? 0) + 1);
      }
    }

    const diasComOcorrencia = porDia.size;
    const mediaPorDia = diasComOcorrencia > 0 ? totalOcorrencias / diasComOcorrencia : 0;

    const detalhesPorDia = Array.from(porDia.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([data, total]) => ({ data, total }));

    return res.json({
      diasJanela,
      inicioJanela: inicioYMD,
      fimJanelaInclusive: hojeYMD,
      totalPermanentesAtivos: permanentes.length,
      totalExcecoesNaJanela: cancelamentos.length,
      totalOcorrencias,
      diasComOcorrencia,
      mediaPorDia,
      detalhesPorDia,
    });
  } catch (err) {
    console.error("Erro ao calcular estatísticas de permanentes:", err);
    return res.status(500).json({ erro: "Erro ao calcular estatísticas de permanentes" });
  }
});

// 📄 Detalhes
router.get(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const agendamento = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        include: {
          usuario: { select: { id: true, nome: true, email: true, celular: true } },
          professor: { select: { id: true, nome: true, email: true } },
          quadra: { select: { id: true, nome: true, numero: true } },
          esporte: { select: { nome: true } },
        },
      });

      if (!agendamento) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });

      const proximaData = await proximaDataPermanenteSemExcecao({
        id: agendamento.id,
        diaSemana: agendamento.diaSemana as DiaSemana,
        dataInicio: agendamento.dataInicio ? new Date(agendamento.dataInicio) : null,
      });

      const hojeLocalYMD = localYMD(new Date());
      const { inicio } = storedUtcBoundaryForLocalYMD(hojeLocalYMD);
      const excecoes = await prisma.agendamentoPermanenteCancelamento.findMany({
        where: { agendamentoPermanenteId: agendamento.id, data: { gte: inicio } },
        orderBy: { data: "asc" },
        select: { id: true, data: true, motivo: true },
      });

      return res.json({
        id: agendamento.id,
        tipoReserva: "PERMANENTE",
        diaSemana: agendamento.diaSemana,
        horario: agendamento.horario,
        usuario: agendamento.usuario
          ? {
            id: agendamento.usuario.id,
            nome: agendamento.usuario.nome,
            email: agendamento.usuario.email,
            celular: agendamento.usuario.celular,
          }
          : null,
        usuarioId: agendamento.usuario?.id,
        esporte: agendamento.esporte.nome,
        quadraId: agendamento.quadra?.id ?? null,
        quadraNome: agendamento.quadra?.nome ?? null,
        quadraNumero: agendamento.quadra?.numero ?? null,
        quadra: agendamento.quadra ? `${agendamento.quadra.nome} (Nº ${agendamento.quadra.numero})` : null,
        dataInicio: agendamento.dataInicio ? toISODateUTC(new Date(agendamento.dataInicio)) : null,
        professor: agendamento.professor
          ? { id: agendamento.professor.id, nome: agendamento.professor.nome, email: agendamento.professor.email }
          : null,
        professorId: agendamento.professorId ?? null,
        tipoSessao: agendamento.tipoSessao ?? null,
        proximaData,
        excecoes: excecoes.map((e) => ({
          id: e.id,
          data: toISODateUTC(new Date(e.data)),
          motivo: e.motivo ?? null,
        })),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao buscar agendamento permanente" });
    }
  }
);

// 📅 Datas elegíveis p/ exceção
router.get(
  "/:id/datas-excecao",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    const meses = Number(req.query.meses ?? "1");
    const clampMeses = Number.isFinite(meses) && meses > 0 && meses <= 6 ? meses : 1;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: { id: true, diaSemana: true, horario: true, dataInicio: true, status: true },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const hojeLocalYMD = localYMD(new Date());
      const dataInicioLocalYMD = perm.dataInicio ? toISODateUTC(new Date(perm.dataInicio)) : null;

      const inicioJanelaYMD = (() => {
        const base = dataInicioLocalYMD && dataInicioLocalYMD > hojeLocalYMD ? dataInicioLocalYMD : hojeLocalYMD;
        return base;
      })();

      const fimJanelaYMD = addMonthsLocalYMD(inicioJanelaYMD, clampMeses);

      const curIdx = localWeekdayIndexOfYMD(inicioJanelaYMD);
      const targetIdx = DIA_IDX[perm.diaSemana as DiaSemana];
      const delta = (targetIdx - curIdx + 7) % 7;
      let dYMD = addDaysLocalYMD(inicioJanelaYMD, delta);

      const todas: string[] = [];
      while (toUtc00(dYMD) < toUtc00(fimJanelaYMD)) {
        if (!dataInicioLocalYMD || dYMD >= dataInicioLocalYMD) todas.push(dYMD);
        dYMD = addDaysLocalYMD(dYMD, 7);
      }

      const isAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);

      const { inicio: inicioUTC } = storedUtcBoundaryForLocalYMD(inicioJanelaYMD);
      const { fim: fimUTC } = storedUtcBoundaryForLocalYMD(fimJanelaYMD);
      const jaCanceladas = await prisma.agendamentoPermanenteCancelamento.findMany({
        where: { agendamentoPermanenteId: id, data: { gte: inicioUTC, lt: fimUTC } },
        include: { criadoPor: { select: { id: true, nome: true, email: true } } },
        orderBy: { data: "asc" },
      });

      const jaCanceladasSet = new Set(jaCanceladas.map((c) => toISODateUTC(new Date(c.data))));
      const elegiveis = todas.filter((iso) => !jaCanceladasSet.has(iso));

      return res.json({
        permanenteId: perm.id,
        inicioJanela: inicioJanelaYMD,
        fimJanela: fimJanelaYMD,
        diaSemana: perm.diaSemana,
        horario: perm.horario,
        datas: elegiveis,
        jaCanceladas: Array.from(jaCanceladasSet),
        jaCanceladasDetalhes: jaCanceladas.map((c) => ({
          id: c.id,
          data: toISODateUTC(new Date(c.data)),
          motivo: c.motivo ?? null,
          criadoPor: c.criadoPor
            ? { id: c.criadoPor.id, nome: c.criadoPor.nome, email: isAdmin ? c.criadoPor.email : undefined }
            : null,
          createdAt: c.createdAt,
        })),
      });
    } catch (e) {
      console.error("Erro em GET /:id/datas-excecao", e);
      return res.status(500).json({ erro: "Erro ao listar datas para exceção" });
    }
  }
);

// 🚫 Registrar exceção (cancelar um dia)
router.post(
  "/:id/cancelar-dia",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;

    const schema = z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      motivo: z.string().trim().max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });

    const { data: iso, motivo } = parsed.data;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: {
          id: true,
          usuarioId: true,
          diaSemana: true,
          horario: true,
          quadraId: true,
          esporteId: true,
          dataInicio: true,
          status: true,
          createdAt: true,
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const dataUTC = toUtc00(iso);

      if (perm.dataInicio && dataUTC < toUtc00(toISODateUTC(new Date(perm.dataInicio)))) {
        return res.status(400).json({ erro: "Data anterior ao início do agendamento permanente." });
      }

      const idxLocal = localWeekdayIndexOfYMD(iso);
      if (idxLocal !== DIA_IDX[perm.diaSemana as DiaSemana]) {
        return res.status(400).json({ erro: "Data não corresponde ao dia da semana do permanente." });
      }

      const jaExiste = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: { agendamentoPermanenteId: id, data: dataUTC },
        select: { id: true },
      });
      if (jaExiste) return res.status(409).json({ erro: "Esta data já está marcada como exceção para este permanente." });

      const novo = await prisma.agendamentoPermanenteCancelamento.create({
        data: {
          agendamentoPermanenteId: id,
          data: dataUTC,
          motivo: motivo ?? null,
          criadoPorId: req.usuario!.usuarioLogadoId,
        },
        include: { criadoPor: { select: { id: true, nome: true, email: true } } },
      });

      // ✅ NOTIF (se admin e <12h)
      try {
        await maybeNotifyCancelamentoPermDentro12h({
          actorId: req.usuario!.usuarioLogadoId,
          actorTipo: req.usuario!.usuarioLogadoTipo,
          permanente: {
            id: perm.id,
            diaSemana: perm.diaSemana as DiaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
            usuarioId: perm.usuarioId,
          },
          dataOcorrenciaISO: iso,
          motivo: motivo ?? null,
        });
      } catch (e) {
        console.error("[notify] perm cancelar-dia error:", e);
      }

      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_EXCECAO",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            data: iso,
            motivo: motivo ?? null,
            criadoPorId: req.usuario!.usuarioLogadoId,
            donoId: perm.usuarioId,
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
          },
        });
      } catch (e) {
        console.error("[audit] perm excecao error:", e);
      }

      return res.status(201).json({
        id: novo.id,
        agendamentoPermanenteId: id,
        data: toISODateUTC(new Date(novo.data)),
        motivo: novo.motivo ?? null,
        criadoPor: novo.criadoPor ? { id: novo.criadoPor.id, nome: novo.criadoPor.nome, email: novo.criadoPor.email } : null,
        createdAt: novo.createdAt,
      });
    } catch (e) {
      console.error("Erro em POST /:id/cancelar-dia", e);
      return res.status(500).json({ erro: "Erro ao registrar exceção do permanente" });
    }
  }
);

// ✅ Cancelar a próxima ocorrência
router.post(
  "/:id/cancelar-proxima",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: {
          id: true,
          usuarioId: true,
          diaSemana: true,
          horario: true,
          quadraId: true,
          esporteId: true,
          dataInicio: true,
          status: true,
          createdAt: true,
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const proximaISO = await proximaDataPermanenteSemExcecao({
        id: perm.id,
        diaSemana: perm.diaSemana as DiaSemana,
        dataInicio: perm.dataInicio ? new Date(perm.dataInicio) : null,
      });
      if (!proximaISO) return res.status(409).json({ erro: "Não há próxima ocorrência disponível para cancelamento." });

      const tipo = req.usuario!.usuarioLogadoTipo;
      const windowHours = cancellationWindowHours(tipo);

      if (windowHours !== null) {
        const alvo = new Date(`${proximaISO}T${perm.horario}:00-03:00`);
        const diffHoras = (alvo.getTime() - Date.now()) / (1000 * 60 * 60);

        if (diffHoras < windowHours) {
          if (!within15MinFrom(perm.createdAt)) {
            const msgBase =
              tipo === "ADMIN_PROFESSORES"
                ? "Cancelamento permitido até 2 horas antes da próxima ocorrência"
                : "Cancelamento permitido até 12 horas antes da próxima ocorrência";
            return res.status(403).json({
              erro: `${msgBase} (com carência de 15 minutos após a criação do permanente).`,
            });
          }
        }
      }

      const jaExiste = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: { agendamentoPermanenteId: id, data: toUtc00(proximaISO) },
        select: { id: true },
      });
      if (jaExiste) return res.status(409).json({ erro: "A próxima ocorrência já foi cancelada." });

      const exc = await prisma.agendamentoPermanenteCancelamento.create({
        data: {
          agendamentoPermanenteId: id,
          data: toUtc00(proximaISO),
          motivo: "Cancelado (próxima ocorrência)",
          criadoPorId: req.usuario!.usuarioLogadoId,
        },
      });

      // ✅ NOTIF (se admin e <12h)
      try {
        await maybeNotifyCancelamentoPermDentro12h({
          actorId: req.usuario!.usuarioLogadoId,
          actorTipo: req.usuario!.usuarioLogadoTipo,
          permanente: {
            id: perm.id,
            diaSemana: perm.diaSemana as DiaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
            usuarioId: perm.usuarioId,
          },
          dataOcorrenciaISO: proximaISO,
          motivo: "Cancelado (próxima ocorrência)",
        });
      } catch (e) {
        console.error("[notify] perm cancelar-proxima error:", e);
      }

      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_EXCECAO",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            data: proximaISO,
            motivo: "Cancelado (próxima ocorrência)",
            criadoPorId: req.usuario!.usuarioLogadoId,
            donoId: perm.usuarioId,
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
          },
        });
      } catch (e) {
        console.error("[audit] perm excecao(proxima) error:", e);
      }

      return res.status(201).json({
        ok: true,
        mensagem: "Próxima ocorrência cancelada com sucesso.",
        agendamentoPermanenteId: id,
        dataCancelada: toISODateUTC(new Date(exc.data)),
      });
    } catch (e) {
      console.error("Erro em POST /:id/cancelar-proxima", e);
      return res.status(500).json({ erro: "Erro ao cancelar a próxima ocorrência do permanente" });
    }
  }
);

// ✅ Cancelar agendamento permanente (encerrar recorrência)
router.post(
  "/cancelar/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const before = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          usuarioId: true,
          diaSemana: true,
          horario: true,
          quadraId: true,
          esporteId: true,
          dataInicio: true,
        },
      });

      // ✅ NOTIF (antes de encerrar): olha a próxima ocorrência e notifica se <12h e actor for admin
      if (before && !["CANCELADO", "TRANSFERIDO"].includes(before.status)) {
        try {
          const prox = await proximaDataPermanenteSemExcecao({
            id: before.id,
            diaSemana: before.diaSemana as DiaSemana,
            dataInicio: before.dataInicio ? new Date(before.dataInicio) : null,
          });

          if (prox) {
            await maybeNotifyCancelamentoPermDentro12h({
              actorId: req.usuario!.usuarioLogadoId,
              actorTipo: req.usuario!.usuarioLogadoTipo,
              permanente: {
                id: before.id,
                diaSemana: before.diaSemana as DiaSemana,
                horario: before.horario,
                quadraId: before.quadraId,
                esporteId: before.esporteId,
                usuarioId: before.usuarioId,
              },
              dataOcorrenciaISO: prox,
              motivo: "Recorrência cancelada",
            });
          }
        } catch (e) {
          console.error("[notify] perm cancelar (encerrar) error:", e);
        }
      }

      const agendamento = await prisma.agendamentoPermanente.update({
        where: { id },
        data: { status: "CANCELADO", canceladoPorId: req.usuario!.usuarioLogadoId },
      });

      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_CANCEL",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            statusAntes: before?.status ?? null,
            statusDepois: agendamento.status,
            donoId: before?.usuarioId ?? null,
            diaSemana: before?.diaSemana ?? null,
            horario: before?.horario ?? null,
            quadraId: before?.quadraId ?? null,
            esporteId: before?.esporteId ?? null,
          },
        });
      } catch (e) {
        console.error("[audit] perm cancel error:", e);
      }

      return res.status(200).json({ message: "Agendamento permanente cancelado com sucesso.", agendamento });
    } catch (error) {
      console.error("Erro ao cancelar agendamento permanente:", error);
      return res.status(500).json({ error: "Erro ao cancelar agendamento permanente." });
    }
  }
);

// 🔁 Transferir (mantido)
router.patch(
  "/:id/transferir",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;

    const schema = z.object({
      novoUsuarioId: z.string().uuid(),
      transferidoPorId: z.string().uuid().optional(),
      copiarExcecoes: z.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });

    const { novoUsuarioId, transferidoPorId, copiarExcecoes } = parsed.data;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        include: {
          cancelamentos: true,
          quadra: { select: { id: true, nome: true, numero: true } },
          esporte: { select: { id: true, nome: true } },
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }
      if (novoUsuarioId === perm.usuarioId) {
        return res.status(400).json({ erro: "Novo usuário é o mesmo do agendamento atual" });
      }

      const jaExisteAtivo = await prisma.agendamentoPermanente.findFirst({
        where: {
          id: { not: id },
          quadraId: perm.quadraId,
          diaSemana: perm.diaSemana,
          horario: perm.horario,
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        },
        select: { id: true },
      });
      if (jaExisteAtivo) {
        return res.status(409).json({ erro: "Já existe um agendamento permanente ativo nesse dia/horário/quadra" });
      }

      const novoUsuario = await prisma.usuario.findUnique({
        where: { id: novoUsuarioId },
        select: { id: true, tipo: true },
      });

      let professorIdNovo: string | null = perm.professorId ?? null;
      if ((perm.tipoSessao ?? null) === "AULA" && novoUsuario?.tipo === "ADMIN_PROFESSORES") {
        professorIdNovo = novoUsuarioId;
      }

      const [, novoPerm] = await prisma.$transaction([
        prisma.agendamentoPermanente.update({
          where: { id },
          data: { status: "TRANSFERIDO", transferidoPorId: transferidoPorId ?? req.usuario!.usuarioLogadoId },
        }),
        prisma.agendamentoPermanente.create({
          data: {
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
            usuarioId: novoUsuarioId,
            dataInicio: perm.dataInicio ?? null,
            professorId: professorIdNovo,
            tipoSessao: perm.tipoSessao ?? null,
          },
          include: {
            usuario: { select: { id: true, nome: true, email: true } },
            quadra: { select: { id: true, nome: true, numero: true } },
            esporte: { select: { id: true, nome: true } },
          },
        }),
      ]);

      if (copiarExcecoes && perm.cancelamentos.length) {
        await prisma.agendamentoPermanenteCancelamento.createMany({
          data: perm.cancelamentos.map((c) => ({
            agendamentoPermanenteId: novoPerm.id,
            data: c.data,
            motivo: c.motivo ?? null,
            criadoPorId: c.criadoPorId ?? null,
          })),
        });
      }

      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_TRANSFER",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteIdOriginal: id,
            permanenteIdNovo: novoPerm.id,
            fromOwnerId: perm.usuarioId,
            toOwnerId: novoUsuarioId,
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
            excecoesCopiadas: copiarExcecoes ? perm.cancelamentos.length : 0,
          },
        });
      } catch (e) {
        console.error("[audit] perm transfer error:", e);
      }

      const isAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
      return res.status(200).json({
        message: "Agendamento permanente transferido com sucesso",
        agendamentoOriginalId: id,
        novoAgendamento: {
          id: novoPerm.id,
          diaSemana: novoPerm.diaSemana,
          horario: novoPerm.horario,
          dataInicio: novoPerm.dataInicio,
          usuario: {
            id: novoPerm.usuario?.id,
            nome: novoPerm.usuario?.nome,
            email: isAdmin ? novoPerm.usuario?.email : undefined,
          },
          quadra: novoPerm.quadra ? { id: novoPerm.quadra.id, nome: novoPerm.quadra.nome, numero: novoPerm.quadra.numero } : null,
          esporte: novoPerm.esporte ? { id: novoPerm.esporte.id, nome: novoPerm.esporte.nome } : null,
          excecoesCopiadas: copiarExcecoes ? perm.cancelamentos.length : 0,
        },
      });
    } catch (e) {
      console.error("Erro ao transferir agendamento permanente:", e);
      return res.status(500).json({ erro: "Erro ao transferir agendamento permanente" });
    }
  }
);

// ❌ Deletar
router.delete(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const agendamento = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: { id: true, usuarioId: true, diaSemana: true, horario: true, quadraId: true, esporteId: true },
      });
      if (!agendamento) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });

      await prisma.agendamentoPermanente.delete({ where: { id } });

      try {
        await logAudit({
          event: "AGENDAMENTO_PERM_DELETE",
          req,
          target: { type: TargetType.AGENDAMENTO_PERMANENTE, id },
          metadata: {
            permanenteId: id,
            donoId: agendamento?.usuarioId ?? null,
            diaSemana: agendamento?.diaSemana ?? null,
            horario: agendamento?.horario ?? null,
            quadraId: agendamento?.quadraId ?? null,
            esporteId: agendamento?.esporteId ?? null,
          },
        });
      } catch (e) {
        console.error("[audit] perm delete error:", e);
      }

      return res.status(200).json({ mensagem: "Agendamento permanente deletado com sucesso" });
    } catch (error) {
      console.error("Erro ao deletar agendamento permanente:", error);
      return res.status(500).json({ erro: "Erro ao deletar agendamento permanente" });
    }
  }
);

export default router;
