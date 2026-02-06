import { Router } from "express";
import { PrismaClient, DiaSemana, Prisma, TipoSessaoProfessor, AtendenteFeature } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import cron from "node-cron"; // ⏰ cron para finalizar vencidos
import verificarToken from "../middleware/authMiddleware";
import { r2PublicUrl } from "../src/lib/r2";
import { logAudit, TargetType } from "../utils/audit"; // 👈 AUDITORIA
import { valorMultaPadrao } from "../utils/multa";     // 👈 multa fixa
import { requireAtendenteFeature } from "../middleware/atendenteFeatures";

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

// ===== Janela padrão de JOGO (sempre permitido) =====
const JOGO_DEFAULT_INICIO = "07:00";
const JOGO_DEFAULT_FIM_EXCLUSIVE = "23:59"; // [ini, fim)
function jogoDefaultPermitido(hhmm: string) {
  return horarioDentroIntervalo(hhmm, JOGO_DEFAULT_INICIO, JOGO_DEFAULT_FIM_EXCLUSIVE);
}

// ===================== COBRANÇA AULA EXTRA (ConfiguraçãoSistema) =====================
function decimalToNumber(v: any): number | null {
  if (v == null) return null;
  // Prisma Decimal costuma ter toNumber()
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// horário dentro do intervalo [ini, fim) (fim exclusivo)
function dentroFaixa(hhmm: string, ini: string, fim: string) {
  return hhmm >= ini && hhmm < fim;
}

async function getConfigAulaExtra() {
  // singleton id=1
  const cfg = await prisma.configuracaoSistema.findUnique({
    where: { id: 1 },
    select: {
      aulaExtraAtiva: true,
      aulaExtraInicioHHMM: true,
      aulaExtraFimHHMM: true,
      valorAulaExtra: true,
    },
  });

  // se por algum motivo não existir, cai num default seguro
  return (
    cfg ?? {
      aulaExtraAtiva: true,
      aulaExtraInicioHHMM: "18:00",
      aulaExtraFimHHMM: "23:00",
      valorAulaExtra: new Prisma.Decimal("50.00"),
    }
  );
}


const prisma = new PrismaClient();
const router = Router();

/** ✅ BLOQUEIO GLOBAL DO MÓDULO (liga/desliga do atendente)
 * Se o usuário for ADMIN_ATENDENTE, ele só acessa este arquivo se tiver ATD_AGENDAMENTOS.
 * ADMIN_MASTER passa sempre. Outros tipos não são afetados.
 */
router.use(requireAtendenteFeature(AtendenteFeature.ATD_AGENDAMENTOS));


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

/* ============================================================================
   NOVO: Janelas por Esporte (AULA/JOGO) + Endpoint para o front
   ==========================================================================*/

// Busca janelas do dia específico e as padrão (diaSemana = null). Dia específico sobrescreve padrão.
async function getJanelasForEsporte(
  esporteId: string,
  diaSemana: DiaSemana | null
) {
  const [doDia, padrao] = await Promise.all([
    prisma.esporteJanelaAula.findMany({
      where: { esporteId, diaSemana },
      select: { tipoSessao: true, inicioHHMM: true, fimHHMM: true, ativo: true },
    }),
    prisma.esporteJanelaAula.findMany({
      where: { esporteId, diaSemana: null },
      select: { tipoSessao: true, inicioHHMM: true, fimHHMM: true, ativo: true },
    }),
  ]);

  // regra: registros do dia específico sobrescrevem os padrão por tipo
  const byTipo = new Map<TipoSessaoProfessor, { inicioHHMM: string; fimHHMM: string }>();
  for (const r of padrao.filter(r => r.ativo)) {
    byTipo.set(r.tipoSessao as TipoSessaoProfessor, { inicioHHMM: r.inicioHHMM, fimHHMM: r.fimHHMM });
  }
  for (const r of doDia.filter(r => r.ativo)) {
    byTipo.set(r.tipoSessao as TipoSessaoProfessor, { inicioHHMM: r.inicioHHMM, fimHHMM: r.fimHHMM });
  }
  return byTipo;
}

/**
 * Retorna a lista de tipos permitidos naquele HH:mm.
 * Nova regra:
 *  - JOGO é SEMPRE permitido entre 07:00–23:59 (padrão), independentemente de configuração.
 *  - AULA só é permitido se o horário cair na janela configurada (dia-específico ou padrão).
 */
async function resolveSessoesPermitidas(
  esporteId: string,
  diaSemana: DiaSemana,
  horario: string
): Promise<TipoSessaoProfessor[]> {
  const j = await getJanelasForEsporte(esporteId, diaSemana);
  const out: TipoSessaoProfessor[] = [];

  // AULA conforme configuração
  const aulaJ = j.get("AULA" as TipoSessaoProfessor);
  if (aulaJ && horarioDentroIntervalo(horario, aulaJ.inicioHHMM, aulaJ.fimHHMM)) {
    out.push("AULA");
  }

  // JOGO padrão 07:00–23:59 SEMPRE
  if (jogoDefaultPermitido(horario)) {
    out.push("JOGO");
  } else {
    // (opcional) se houver configuração de JOGO fora do padrão, também aceitar
    const jogoJ = j.get("JOGO" as TipoSessaoProfessor);
    if (jogoJ && horarioDentroIntervalo(horario, jogoJ.inicioHHMM, jogoJ.fimHHMM)) {
      out.push("JOGO");
    }
  }

  return out;
}

/**
 * Flags separadas para lógica de auto-definição.
 * - aula: true se cair em janela de AULA.
 * - jogo: true se for 07–23:59 (ou, opcionalmente, se houver janela específica).
 */
async function resolveSessoesFlags(
  esporteId: string,
  diaSemana: DiaSemana,
  horario: string
): Promise<{ aula: boolean; jogo: boolean }> {
  const j = await getJanelasForEsporte(esporteId, diaSemana);

  const aulaJ = j.get("AULA" as TipoSessaoProfessor);
  const aula = aulaJ ? horarioDentroIntervalo(horario, aulaJ.inicioHHMM, aulaJ.fimHHMM) : false;

  let jogo = jogoDefaultPermitido(horario);
  if (!jogo) {
    const jogoJ = j.get("JOGO" as TipoSessaoProfessor);
    jogo = jogoJ ? horarioDentroIntervalo(horario, jogoJ.inicioHHMM, jogoJ.fimHHMM) : false;
  }

  return { aula, jogo };
}

/**
 * GET /agendamentos/_sessoes-permitidas?esporteId=...&data=YYYY-MM-DD&horario=HH:MM
 * -> { allow: ["AULA","JOGO"] | ["AULA"] | ["JOGO"] | [] }
 */
router.get("/_sessoes-permitidas", verificarToken, async (req, res) => {
  const { esporteId, data, horario } = req.query as { esporteId?: string; data?: string; horario?: string };
  if (!esporteId || !data || !horario) {
    return res.status(400).json({ erro: "Parâmetros obrigatórios: esporteId, data (YYYY-MM-DD), horario (HH:MM)" });
  }
  try {
    const diaIdx = localWeekdayIndexOfYMD(data);
    const diaSemana = diasEnum[diaIdx] as DiaSemana;
    const allow = await resolveSessoesPermitidas(esporteId, diaSemana, horario);
    return res.json({ allow });
  } catch (e) {
    console.error("resolve sessões:", e);
    return res.status(500).json({ erro: "Falha ao resolver sessões permitidas" });
  }
});

/* ======================================================================== */

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

// ✅ Aceita PrismaClient ou o TransactionClient do prisma.$transaction
type DbClient = Prisma.TransactionClient | PrismaClient;

// ===== LIMITADOR: max AULAS por (data, horario, esporte) contando comum + permanente =====
const LIMITE_AULAS_POR_SLOT = 2;

async function countAulasNoSlot(db: DbClient, p: {
  dataYMD: string;   // "YYYY-MM-DD" (dia local)
  horario: string;   // "HH:mm"
  esporteId: string;
}) {
  const { dataYMD, horario, esporteId } = p;

  // comuns AULA no dia
  const dataUTC00 = toUtc00(dataYMD);

  const comunsCount = await db.agendamento.count({
    where: {
      data: dataUTC00,
      horario,
      esporteId,
      status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      tipoSessao: "AULA",
      // se quiser considerar apenas aula com professor:
      // professorId: { not: null },
    },
  });

  // diaSemana do dia local
  const idx = localWeekdayIndexOfYMD(dataYMD); // 0..6
  const diaSemana = (Object.keys(DIA_IDX).find(k => DIA_IDX[k as DiaSemana] === idx) as DiaSemana) ?? null;
  if (!diaSemana) return comunsCount;

  // permanentes AULA ativos que batem diaSemana+horario+esporte
  const permanentes = await db.agendamentoPermanente.findMany({
    where: {
      diaSemana,
      horario,
      esporteId,
      status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      tipoSessao: "AULA",
    },
    select: { id: true, dataInicio: true },
  });

  if (permanentes.length === 0) return comunsCount;

  // filtra por dataInicio (se tiver)
  const permanentesElegiveis = permanentes.filter((perm) => {
    if (!perm.dataInicio) return true;
    const inicioYMD = toISODateUTC(perm.dataInicio); // "YYYY-MM-DD"
    return inicioYMD <= dataYMD;
  });

  if (permanentesElegiveis.length === 0) return comunsCount;

  // remove os que têm exceção/cancelamento nesse dia
  const ids = permanentesElegiveis.map(p => p.id);

  const cancelados = await db.agendamentoPermanenteCancelamento.findMany({
    where: {
      agendamentoPermanenteId: { in: ids },
      data: dataUTC00,
    },
    select: { agendamentoPermanenteId: true },
  });

  const cancelSet = new Set(cancelados.map(c => c.agendamentoPermanenteId));
  const permanentesCount = permanentesElegiveis.filter(p => !cancelSet.has(p.id)).length;

  return comunsCount + permanentesCount;
}

async function assertLimiteAulas(db: DbClient, p: {
  dataYMD: string;
  horario: string;
  esporteId: string;
}) {
  const total = await countAulasNoSlot(db, p);

  if (total >= LIMITE_AULAS_POR_SLOT) {
    return {
      ok: false as const,
      total,
      limite: LIMITE_AULAS_POR_SLOT,
      erro: `Limite de ${LIMITE_AULAS_POR_SLOT} aulas atingido para este esporte nesse horário.`,
    };
  }

  return { ok: true as const, total, limite: LIMITE_AULAS_POR_SLOT };
}



// ===================== LIMITE AULAS (Beach Tennis pós 18h) =====================
const LIMITE_AULAS_BEACH_POS18 = 2;
const LIMITE_AULAS_BEACH_POS18_INICIO = "18:00";

function normalizeKey(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function isBeachTennisByEsporteId(tx: PrismaClient, esporteId: string) {
  const e = await tx.esporte.findUnique({
    where: { id: esporteId },
    select: { nome: true },
  });
  if (!e?.nome) return false;

  // Aceita variações comuns
  const key = normalizeKey(e.nome);
  return key === "beach tennis" || key === "beachtennis" || key === "beach-tennis";
}

async function validarLimiteAulasBeachPos18(tx: PrismaClient, p: {
  dataUTC00: Date;
  horario: string;
  esporteId: string;
  quadraId: string;
  professorIdFinal: string | null;
  tipoSessaoFinal: TipoSessaoProfessor | null;
}) {
  const { dataUTC00, horario, esporteId, quadraId, professorIdFinal, tipoSessaoFinal } = p;

  // Só aplica se for AULA com professor
  if (!professorIdFinal) return;
  if (tipoSessaoFinal !== "AULA") return;

  // Só aplica pós 18:00
  if (horario < LIMITE_AULAS_BEACH_POS18_INICIO) return;

  // Só aplica Beach Tennis
  const isBeach = await isBeachTennisByEsporteId(tx, esporteId);
  if (!isBeach) return;

  // Conta quantas quadras já estão com AULA (professor) nesse mesmo dia/horário/esporte
  const rows = await tx.agendamento.findMany({
    where: {
      data: dataUTC00,
      horario,
      esporteId,
      status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      professorId: { not: null },
      tipoSessao: "AULA",
    },
    select: { quadraId: true },
  });

  const quadrasComAula = new Set(rows.map(r => r.quadraId));

  // Se já tiver 2 quadras com aula e a quadra atual ainda não está nesse conjunto => bloqueia
  if (!quadrasComAula.has(quadraId) && quadrasComAula.size >= LIMITE_AULAS_BEACH_POS18) {
    const err: any = new Error("LIMITE_AULAS_BEACH_POS18");
    err.httpStatus = 409;
    err.payload = {
      erro: "Limite de aulas atingido para Beach Tennis após 18h",
      limite: LIMITE_AULAS_BEACH_POS18,
      encontradas: quadrasComAula.size,
      data: dataUTC00.toISOString().slice(0, 10),
      horario,
    };
    throw err;
  }
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

  // 🔧 LÓGICA NOVA DE DONO:
  // - base sempre é o usuário logado
  // - se admin e veio usuarioId => dono = usuarioIdBody
  // - se admin, sem usuarioIdBody, mas com jogadoresIds => dono = primeiro jogador
  // - se não for admin mas veio usuarioIdBody, aceita (pensando em uso futuro)
  let usuarioIdDono: string = reqCustom.usuario.usuarioLogadoId;


  if (isAdmin) {
    if (usuarioIdBody) {
      usuarioIdDono = usuarioIdBody;
    } else if (jogadoresIds.length > 0) {
      usuarioIdDono = jogadoresIds[0];
    }
  } else if (usuarioIdBody) {
    usuarioIdDono = usuarioIdBody;
  }

  try {
    // === TZ-safe: derive do YMD local salvo (00:00Z)
    const dataYMD = toISODateUTC(data); // "YYYY-MM-DD"
    const diaSemanaEnum = diasEnum[localWeekdayIndexOfYMD(dataYMD)] as DiaSemana;

    const hojeLocalYMD = localYMD(new Date(), SP_TZ);
    const agoraLocalHM = localHM(new Date(), SP_TZ);

    // 🔍 Já é um agendamento "no passado"?
    const isAgendamentoNoPassado =
      dataYMD < hojeLocalYMD ||
      (dataYMD === hojeLocalYMD && horario < agoraLocalHM);

    let multaPorHorarioPassado: number | null = null;
    // 👇 status inicial vai depender se já passou ou não
    let statusInicial: "CONFIRMADO" | "FINALIZADO" = "CONFIRMADO";

    // ✅ Regra de multa automática + status inicial:
    // - se o dia do agendamento JÁ PASSOU (dataYMD < hojeLocalYMD) => multa + FINALIZADO
    // - se é HOJE e o horário já passou (horario < agoraLocalHM) => multa + FINALIZADO
    if (isAgendamentoNoPassado) {
      const valorPadraoMulta = await valorMultaPadrao();
      multaPorHorarioPassado = valorPadraoMulta; // já vem como number
      statusInicial = "FINALIZADO";
    }

    // ✅ Regra de multa automática:
    if (
      dataYMD < hojeLocalYMD ||
      (dataYMD === hojeLocalYMD && horario < agoraLocalHM)
    ) {
      const valorPadraoMulta = await valorMultaPadrao();
      multaPorHorarioPassado = valorPadraoMulta; // já vem como number
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

    // 2) Definir/validar tipoSessao pelas janelas do esporte (nova regra)
    //    - Se não houver professor, não forçamos tipoSessao (segue como hoje).
    //    - Se houver professor: validar contra as janelas e
    //      * auto-definir JOGO apenas quando NÃO estiver em AULA mas estiver em JOGO
    //      * se ambos (AULA e JOGO) forem válidos, não auto-definir (deixa null se o front não mandar)
    let tipoSessaoFinal: TipoSessaoProfessor | null = null;

    if (professorIdFinal) {
      const permitidos = await resolveSessoesPermitidas(esporteId, diaSemanaEnum, horario);
      if (permitidos.length === 0) {
        return res.status(422).json({
          erro: "Horário não permitido: AULA apenas nas janelas configuradas; JOGO permitido entre 07:00 e 23:00.",
        });
      }

      const { aula, jogo } = await resolveSessoesFlags(esporteId, diaSemanaEnum, horario);


      if (tipoSessaoBody) {
        const t = tipoSessaoBody as TipoSessaoProfessor;
        if (!permitidos.includes(t)) {
          return res.status(422).json({
            erro: `Tipo de sessão inválido para o horário. Permitidos: ${permitidos.join(", ")}.`,
          });
        }
        tipoSessaoFinal = t;
      } else {
        if (!aula && jogo) {
          // pós-limite de AULA -> auto JOGO
          tipoSessaoFinal = "JOGO";
        } else if (aula && !jogo) {
          // só AULA válido -> pode auto-definir AULA
          tipoSessaoFinal = "AULA";
        } else if (aula && jogo) {
          // ambos válidos -> deixa o front decidir (não auto-define)
          tipoSessaoFinal = null;
        } else {
          // segurança: não deveria cair aqui (coberto por permitidos.length === 0)
          return res.status(422).json({ erro: "Horário indisponível para sessões." });
        }
      }
    }

    // ======================== NOVO: APOIADO (persistência) ========================
    let isApoiadoFinal = false;
    let apoiadoUsuarioIdFinal: string | null = null;

    // Só permite APOIADO quando for AULA com professor
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

        // ✅ Quem pode ser marcado como "apoiado"
        const tiposApoiadosPermitidos = [
          "CLIENTE_APOIADO",
          "ADMIN_MASTER",
          "ADMIN_ATENDENTE",
          "ADMIN_PROFESSORES",
        ];
        const tipoOk = tiposApoiadosPermitidos.includes(String(apoiadoUser.tipo));

        if (!tipoOk) {
          return res.status(422).json({
            erro:
              "Usuário selecionado como apoiado deve ser CLIENTE_APOIADO, ADMIN_MASTER, ADMIN_ATENDENTE ou ADMIN_PROFESSORES.",
          });
        }

        isApoiadoFinal = true;
        apoiadoUsuarioIdFinal = apoiadoUser.id;
      }
    }

    // ======================== NOVO: VALOR COBRADO + HISTÓRICO (valorQuadraCobrado) ========================
    // Regra:
    // - Só cobramos quando for AULA com professor.
    // - Se for apoiado (isencaoApoiado) => valor 0.00
    // - Se estiver na janela de AULA EXTRA (ConfiguraçãoSistema) e estiver ativa => valorAulaExtra
    // - Senão => usa Usuario.valorQuadra do professor
    let valorQuadraCobradoFinal: Prisma.Decimal | null = null;

    if (professorIdFinal && tipoSessaoFinal === "AULA") {
      if (isApoiadoFinal) {
        valorQuadraCobradoFinal = new Prisma.Decimal("0.00");
      } else {
        const [cfg, prof] = await Promise.all([
          getConfigAulaExtra(),
          prisma.usuario.findUnique({
            where: { id: professorIdFinal },
            select: { valorQuadra: true },
          }),
        ]);

        const isAulaExtra =
          !!cfg.aulaExtraAtiva &&
          dentroFaixa(horario, cfg.aulaExtraInicioHHMM, cfg.aulaExtraFimHHMM);

        if (isAulaExtra) {
          const v = decimalToNumber(cfg.valorAulaExtra);
          if (v == null) {
            return res.status(500).json({ erro: "Configuração inválida: valorAulaExtra" });
          }
          valorQuadraCobradoFinal = new Prisma.Decimal(round2(v).toFixed(2));
        } else {
          const v = decimalToNumber(prof?.valorQuadra);
          if (v == null) {
            return res.status(422).json({
              erro:
                "Professor sem valorQuadra definido. Defina o valor do professor ou use a janela de Aula Extra.",
            });
          }
          valorQuadraCobradoFinal = new Prisma.Decimal(round2(v).toFixed(2));
        }
      }
    }



    // 3) Multa: aceita número >=0 do body, mas prioriza a automática (horário passado hoje)
    const multaBodySan =
      typeof multaBody === "number" && Number.isFinite(multaBody) && multaBody >= 0
        ? Number(multaBody.toFixed(2))
        : null;
    const multaPersistir = multaPorHorarioPassado ?? multaBodySan;

    const convidadosCriadosIds: string[] = [];
    for (const nome of convidadosNomes) {
      const convidado = await criarConvidadoComoUsuario(nome);
      convidadosCriadosIds.push(convidado.id);
    }

    // 🔧 LÓGICA NOVA: permitir CONVIDADO como dono
    // Se for ADMIN, sem usuarioIdBody, sem jogadoresIds, mas com convidadosCriadosIds,
    // o dono passa a ser o primeiro convidado criado
    if (
      isAdmin &&
      !usuarioIdBody &&
      jogadoresIds.length === 0 &&
      convidadosCriadosIds.length > 0
    ) {
      usuarioIdDono = convidadosCriadosIds[0];
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

    const novoAgendamento = await prisma.$transaction(async (tx) => {
      // ✅ Re-check (anti corrida) do comum
      const agendamentoExistenteTx = await tx.agendamento.findFirst({
        where: {
          quadraId,
          horario,
          data: dataUTC00,
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        },
        select: { id: true },
      });
      if (agendamentoExistenteTx) {
        const err: any = new Error("CONFLITO_COMUM");
        err.httpStatus = 409;
        err.payload = { erro: "Já existe um agendamento para essa quadra, data e horário" };
        throw err;
      }

      // ✅ Re-check (anti corrida) do permanente
      const permanentesAtivosTx = await tx.agendamentoPermanente.findMany({
        where: {
          diaSemana: diaSemanaEnum,
          horario,
          quadraId,
          status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC00 } }],
        },
        select: { id: true },
      });

      if (permanentesAtivosTx.length > 0) {
        const excecaoTx = await tx.agendamentoPermanenteCancelamento.findFirst({
          where: {
            agendamentoPermanenteId: { in: permanentesAtivosTx.map(p => p.id) },
            data: dataUTC00,
          },
          select: { id: true },
        });

        if (!excecaoTx) {
          const err: any = new Error("CONFLITO_PERMANENTE");
          err.httpStatus = 409;
          err.payload = { erro: "Horário ocupado por um agendamento permanente" };
          throw err;
        }
      }

      // ✅ NOVO: Limite GLOBAL de AULAS (comum + permanente) por esporte/horário/dia
      if (professorIdFinal && tipoSessaoFinal === "AULA" && horario >= LIMITE_AULAS_BEACH_POS18_INICIO) {
        const isBeach = await isBeachTennisByEsporteId(tx as any, esporteId);
        if (isBeach) {
          const chk = await assertLimiteAulas(tx as any, { dataYMD, horario, esporteId });

          if (!chk.ok) {
            const err: any = new Error("LIMITE_AULAS_BEACH_POS18");
            err.httpStatus = 409;
            err.payload = {
              erro: "Limite de aulas atingido para Beach Tennis após 18h",
              limite: LIMITE_AULAS_BEACH_POS18,
              total: chk.total,
              data: dataYMD,
              horario,
            };
            throw err;
          }
        }
      }



      // ✅ Create final
      return tx.agendamento.create({
        data: {
          data,
          horario,
          quadraId,
          esporteId,
          usuarioId: usuarioIdDono,
          status: statusInicial,
          jogadores: { connect: connectIds },

          professorId: professorIdFinal,
          tipoSessao: tipoSessaoFinal,
          multa: multaPersistir ?? null,
          valorQuadraCobrado: valorQuadraCobradoFinal,

          isencaoApoiado: isApoiadoFinal,
          apoiadoUsuarioId: apoiadoUsuarioIdFinal,
          obs: obsFinal,
        },
        include: {
          jogadores: { select: { id: true, nome: true, email: true } },
          usuario: { select: { id: true, nome: true, email: true, tipo: true } },
          professor: { select: { id: true, nome: true, email: true } },
          quadra: { select: { id: true, nome: true, numero: true } },
          esporte: { select: { id: true, nome: true } },
        },
      });
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
          valorQuadraCobrado: valorQuadraCobradoFinal ? String(valorQuadraCobradoFinal) : null,
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
    if (err?.httpStatus && err?.payload) {
      return res.status(err.httpStatus).json(err.payload);
    }
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
        multaAnulada: a.multaAnulada ?? false,
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
      motivo?: { nome: string } | null;
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
          // 👇 relação correta, igual ao schema
          motivo: { select: { nome: true } },
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
      let bloqueioInfo:
        | { data: string; inicio: string; fim: string; motivoNome?: string | null }
        | undefined;

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
            motivoNome: hit.motivo?.nome ?? null,
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
        // 👇 campos “flat” que o front já usa
        proximaDataBloqueioInicio: bloqueioInfo?.inicio ?? null,
        proximaDataBloqueioFim: bloqueioInfo?.fim ?? null,
        proximaDataBloqueioMotivoNome: bloqueioInfo?.motivoNome ?? null,
        // (mantém bloqueioInfo se algo mais estiver usando)
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
      quadraNome: agendamento.quadra?.nome ?? null,
      quadraNumero: agendamento.quadra?.numero ?? null,
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
      multaAnulada: agendamento.multaAnulada ?? false,
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

// 💸 Remover isenção de apoiado em um agendamento (apenas admin)
router.post("/:id/remover-isencao", verificarToken, async (req, res) => {
  const { id } = req.params;

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  // ⛔ Apenas admin pode remover isenção (se quiser liberar para professor depois, ajustamos aqui)
  if (!isAdminRole(reqCustom.usuario.usuarioLogadoTipo)) {
    return res
      .status(403)
      .json({ erro: "Apenas administradores podem remover isenção de apoio" });
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
        isencaoApoiado: true,
        apoiadoUsuarioId: true,
        obs: true,
        valorQuadraCobrado: true, // ✅ necessário para não dar erro
        tipoSessao: true, // ✅ evita segunda query
      },
    });

    if (!ag) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    // Se não estiver marcado como apoiado, não faz sentido remover isenção
    if (!ag.isencaoApoiado || !ag.apoiadoUsuarioId) {
      return res.status(409).json({
        erro: "Este agendamento não está marcado como isento para apoiado.",
      });
    }

    // Opcional: remover a tag [APOIADO:...] da observação
    let novaObs: string | null = ag.obs ?? null;
    if (novaObs) {
      novaObs = novaObs.replace(/\[APOIADO:[^\]]+\]\s*/g, "").trim();
      if (!novaObs) novaObs = null;
    }

    // Recalcula valor cobrado ao remover isenção (se for AULA com professor)
    // default: mantém o valor atual
    let novoValorCobrado: Prisma.Decimal | null = ag.valorQuadraCobrado ?? null;

    if (ag.professorId && ag.tipoSessao === "AULA") {
      const [cfg, prof] = await Promise.all([
        getConfigAulaExtra(),
        prisma.usuario.findUnique({
          where: { id: ag.professorId },
          select: { valorQuadra: true },
        }),
      ]);

      const isExtra =
        !!cfg.aulaExtraAtiva &&
        dentroFaixa(ag.horario, cfg.aulaExtraInicioHHMM, cfg.aulaExtraFimHHMM);

      if (isExtra) {
        const v = decimalToNumber(cfg.valorAulaExtra);
        if (v == null) {
          return res.status(500).json({ erro: "Configuração inválida: valorAulaExtra" });
        }
        novoValorCobrado = new Prisma.Decimal(round2(v).toFixed(2));
      } else {
        const v = decimalToNumber(prof?.valorQuadra);
        if (v == null) {
          return res.status(422).json({
            erro:
              "Professor sem valorQuadra definido. Defina o valor do professor ou use a janela de Aula Extra.",
          });
        }
        novoValorCobrado = new Prisma.Decimal(round2(v).toFixed(2));
      }
    }

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        isencaoApoiado: false,
        apoiadoUsuarioId: null,
        obs: novaObs,
        valorQuadraCobrado: novoValorCobrado,
      },
    });

    // AUDITORIA
    try {
      await logAudit({
        event: "AGENDAMENTO_ISENCAO_REMOVER",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          agendamentoId: id,
          status: ag.status,
          data: ag.data.toISOString().slice(0, 10),
          horario: ag.horario,
          donoId: ag.usuarioId,
          professorId: ag.professorId ?? null,
          // antes/depois
          isencaoApoiadoAntes: ag.isencaoApoiado,
          apoiadoUsuarioIdAntes: ag.apoiadoUsuarioId,
          isencaoApoiadoDepois: false,
          apoiadoUsuarioIdDepois: null,
          removidoPorId: reqCustom.usuario.usuarioLogadoId,
          // opcional (ajuda no debug)
          valorQuadraCobradoAntes: ag.valorQuadraCobrado ? String(ag.valorQuadraCobrado) : null,
          valorQuadraCobradoDepois: novoValorCobrado ? String(novoValorCobrado) : null,
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar remoção de isenção:", e);
    }

    return res.status(200).json({
      message: "Isenção de apoio removida com sucesso.",
      agendamento: atualizado,
    });
  } catch (error) {
    console.error("Erro ao remover isenção de apoio:", error);

    try {
      await logAudit({
        event: "OTHER",
        req,
        target: { type: TargetType.AGENDAMENTO, id },
        metadata: {
          action: "REMOVER_ISENCAO_APOIO_FAIL",
          error: (error as any)?.message ?? String(error),
        },
      });
    } catch (e) {
      console.error("[audit] falha ao registrar erro de remover isenção:", e);
    }

    return res.status(500).json({ erro: "Erro ao remover isenção de apoio do agendamento." });
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

    // Valor padrão da multa (agora vindo da configuração)
    const valorPadraoMulta = await valorMultaPadrao();
    const valorMulta = valorPadraoMulta; // já é number

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
          valorQuadraCobrado: agendamento.valorQuadraCobrado ?? null,
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

// 📊 Estatísticas gerais de agendamentos
// GET /agendamentos/estatisticas/resumo
router.get("/estatisticas/resumo", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoTipo?: string };
  };

  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  // 👉 Somente admins podem ver o resumo geral
  if (!isAdminRole(reqCustom.usuario.usuarioLogadoTipo)) {
    return res.status(403).json({ erro: "Apenas administradores podem ver as estatísticas" });
  }

  try {
    // usamos o mesmo helper que você já tem para trabalhar com o "dia local"
    const { amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(new Date());

    // base: todos agendamentos até hoje (inclusive), ignorando cancelados/transferidos
    const whereBase = {
      data: { lt: amanhaUTC00 },
      status: { notIn: ["CANCELADO", "TRANSFERIDO"] as any },
    };

    // ✅ total de agendamentos até hoje
    const totalAteHoje = await prisma.agendamento.count({ where: whereBase });

    // ✅ contagem por dia
    const porDia = await prisma.agendamento.groupBy({
      by: ["data"],
      where: whereBase,
      _count: { _all: true },
    });

    const diasComAgendamento = porDia.length;
    const somaAgendamentos = porDia.reduce(
      (acc, d) => acc + d._count._all,
      0
    );

    const mediaPorDia =
      diasComAgendamento > 0 ? somaAgendamentos / diasComAgendamento : 0;

    // devolve também o detalhamento por dia, caso o agente queira usar
    const detalhesPorDia = porDia
      .sort((a, b) => a.data.getTime() - b.data.getTime())
      .map((d) => ({
        data: d.data.toISOString().slice(0, 10), // YYYY-MM-DD
        total: d._count._all,
      }));

    return res.json({
      totalAteHoje,
      diasComAgendamento,
      mediaPorDia,
      detalhesPorDia,
    });
  } catch (err) {
    console.error("Erro ao calcular estatísticas de agendamentos:", err);
    return res.status(500).json({ erro: "Erro ao calcular estatísticas de agendamentos" });
  }
});


export default router;
