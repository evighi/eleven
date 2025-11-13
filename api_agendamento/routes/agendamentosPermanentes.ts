import { Router } from "express";
import { PrismaClient, DiaSemana, TipoSessaoProfessor } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import verificarToken from "../middleware/authMiddleware";
import { isAdmin as isAdminTipo, requireOwnerByRecord } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit"; // 👈 AUDIT

const prisma = new PrismaClient();
const router = Router();

/** ===================== FUSO/HORÁRIO – SEMPRE SP ====================== */
const SP_TZ = process.env.TZ || "America/Sao_Paulo";

// "YYYY-MM-DD" no fuso de SP
function localYMD(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// "HH:mm" no fuso de SP
function localHM(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
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
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
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

/* ============================================================================
   Janelas por Esporte (AULA/JOGO)
   - AULA: segue janelas configuradas (padrão e/ou por dia)
   - JOGO: permitido por padrão 07:00–23:59, independentemente de configuração
           (se houver janela de JOGO configurada, ela também é aceita)
   - O POST só valida janelas se houver professor.
   ==========================================================================*/

// Busca janelas do dia específico e as padrão (diaSemana = null). Dia específico sobrescreve padrão.
async function getJanelasForEsporte(
  esporteId: string,
  diaSemana: DiaSemana | null
) {
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
    // se o modelo ainda não existir, devolvemos arrays vazios
    doDia = [];
    padrao = [];
  }

  const byTipo = new Map<TipoSessaoProfessor, { inicioHHMM: string; fimHHMM: string }>();
  for (const r of padrao.filter(r => r.ativo)) {
    byTipo.set(r.tipoSessao as TipoSessaoProfessor, { inicioHHMM: r.inicioHHMM, fimHHMM: r.fimHHMM });
  }
  for (const r of doDia.filter(r => r.ativo)) {
    byTipo.set(r.tipoSessao as TipoSessaoProfessor, { inicioHHMM: r.inicioHHMM, fimHHMM: r.fimHHMM });
  }
  return byTipo;
}

// ===== Janela padrão de JOGO (sempre permitido) =====
const JOGO_DEFAULT_INICIO = "07:00";
const JOGO_DEFAULT_FIM_EXCLUSIVE = "23:59";
function jogoDefaultPermitido(hhmm: string) {
  return horarioDentroIntervalo(hhmm, JOGO_DEFAULT_INICIO, JOGO_DEFAULT_FIM_EXCLUSIVE);
}

// Retorna lista/set de tipos permitidos naquele hh:mm (para casos COM professor)
async function resolveSessoesPermitidas(
  esporteId: string,
  diaSemana: DiaSemana,
  horario: string
): Promise<Set<TipoSessaoProfessor>> {
  const j = await getJanelasForEsporte(esporteId, diaSemana);
  const allow = new Set<TipoSessaoProfessor>();

  // AULA conforme configuração
  const aulaJ = j.get("AULA" as TipoSessaoProfessor);
  if (aulaJ && horarioDentroIntervalo(horario, aulaJ.inicioHHMM, aulaJ.fimHHMM)) {
    allow.add("AULA");
  }

  // JOGO padrão 07:00–23:59 SEMPRE
  if (jogoDefaultPermitido(horario)) {
    allow.add("JOGO");
  } else {
    // (opcional) se houver configuração de JOGO fora do padrão, também aceitar
    const jogoJ = j.get("JOGO" as TipoSessaoProfessor);
    if (jogoJ && horarioDentroIntervalo(horario, jogoJ.inicioHHMM, jogoJ.fimHHMM)) {
      allow.add("JOGO");
    }
  }

  return allow;
}

/** ===================== Próxima data (local SP) ======================
 * Calcula a PRÓXIMA data "YYYY-MM-DD" do permanente em linha do tempo local,
 * pulando datas já cadastradas como exceção e respeitando dataInicio (se houver).
 */
async function proximaDataPermanenteSemExcecao(p: {
  id: string;
  diaSemana: DiaSemana;
  dataInicio: Date | null; // armazenada como 00:00Z do dia local
}): Promise<string | null> {
  const hojeLocalYMD = localYMD(new Date());
  const dataInicioLocalYMD = p.dataInicio ? toISODateUTC(p.dataInicio) : null;

  // Base local: dia local de hoje ou dataInicio local, o que for maior
  const baseLocalYMD =
    dataInicioLocalYMD && dataInicioLocalYMD > hojeLocalYMD
      ? dataInicioLocalYMD
      : hojeLocalYMD;

  const cur = localWeekdayIndexOfYMD(baseLocalYMD); // 0..6 local
  const target = DIA_IDX[p.diaSemana] ?? 0;
  let delta = (target - cur + 7) % 7;

  let tentativaYMD = addDaysLocalYMD(baseLocalYMD, delta);

  // Evita laços infinitos – ~2 anos de tentativas (semana a semana)
  for (let i = 0; i < 120; i++) {
    const tentativaUTC00 = toUtc00(tentativaYMD);
    const exc = await prisma.agendamentoPermanenteCancelamento.findFirst({
      where: { agendamentoPermanenteId: p.id, data: tentativaUTC00 },
      select: { id: true },
    });
    if (!exc) return tentativaYMD; // YMD local seguro
    tentativaYMD = addDaysLocalYMD(tentativaYMD, 7);
  }
  return null;
}

/** ===================== Middleware ====================== */
// 🔒 todas as rotas daqui exigem login
router.use(verificarToken);

/** ===================== Utilitário para o front (igual ao comum) ===================== 
 * GET /agendamentos-permanentes/_sessoes-permitidas?esporteId=...&diaSemana=SEGUNDA&horario=18:30
 */
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
    diaSemana, horario, quadraId, esporteId,
    usuarioId: usuarioIdBody, dataInicio, convidadosNomes = [],

    // recebidos (opcionais)
    professorId: professorIdBody,
    tipoSessao: tipoSessaoBody,
  } = validacao.data;

  try {
    // quadra existe + esporte associado
    const quadra = await prisma.quadra.findUnique({
      where: { id: quadraId }, include: { quadraEsportes: true },
    });
    if (!quadra) return res.status(404).json({ erro: "Quadra não encontrada" });

    const pertenceAoEsporte = quadra.quadraEsportes.some(qe => qe.esporteId === esporteId);
    if (!pertenceAoEsporte) return res.status(400).json({ erro: "A quadra não está associada ao esporte informado" });

    // 1 permanente ativo por (quadra, diaSemana, horario)
    const permanenteExistente = await prisma.agendamentoPermanente.findFirst({
      where: { diaSemana, horario, quadraId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
      select: { id: true },
    });
    if (permanenteExistente) {
      return res.status(409).json({ erro: "Já existe um agendamento permanente nesse horário, quadra e dia" });
    }

    // conflito com comuns confirmados — verificando por dia da semana (em UTC00 das datas salvas)
    const agendamentosComuns = await prisma.agendamento.findMany({
      where: { horario, quadraId, status: "CONFIRMADO" },
      select: { data: true },
    });
    const targetIdx = DIA_IDX[diaSemana];
    const possuiConflito = agendamentosComuns.some(ag => {
      const idx = new Date(ag.data).getUTCDay(); // 0..6 da data armazenada
      return idx === targetIdx;
    });
    if (possuiConflito && !dataInicio) {
      return res.status(409).json({ erro: "Conflito com agendamento comum existente nesse dia, horário e quadra" });
    }

    // 🔑 DONO
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

    // ================= professor/tipoSessao com regra de horário (igual ao comum) ================
    // (1) professorId: explícito ou inferido se o dono for ADMIN_PROFESSORES
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

    // (2) Se NÃO houver professor → não restringe por janelas (segue regra “jogo livre” sem precisar definir tipo)
    let tipoSessaoFinal: TipoSessaoProfessor | null = null;
    let sessoesPermitidasAudit: string[] = [];

    if (professorIdFinal) {
      const allow = await resolveSessoesPermitidas(esporteId, diaSemana, horario);
      if (allow.size === 0) {
        return res.status(422).json({ erro: "Horário indisponível para este esporte." });
      }
      sessoesPermitidasAudit = Array.from(allow);

      // (3) se enviou tipoSessao no body, ele precisa ser permitido
      if (tipoSessaoBody && !allow.has(tipoSessaoBody as TipoSessaoProfessor)) {
        return res.status(422).json({ erro: `Tipo de sessão '${tipoSessaoBody}' não permitido neste horário.` });
      }

      // (4) Derivação final quando HÁ professor
      if (allow.size === 1) {
        // só uma possível (ex.: apenas JOGO)
        tipoSessaoFinal = Array.from(allow)[0];
      } else {
        // duas opções: usa o que veio; se não veio, default AULA
        tipoSessaoFinal = (tipoSessaoBody as TipoSessaoProfessor | undefined) ?? "AULA";
      }
    }
    // =============================================================================================

    const novo = await prisma.agendamentoPermanente.create({
      data: {
        diaSemana,
        horario,
        quadraId,
        esporteId,
        usuarioId: usuarioIdDono,
        ...(dataInicio ? { dataInicio: toUtc00(dataInicio) } : {}),
        // persistir novos campos
        professorId: professorIdFinal,
        tipoSessao: tipoSessaoFinal,
      },
      select: {
        id: true, diaSemana: true, horario: true, quadraId: true, esporteId: true,
        usuarioId: true, dataInicio: true, status: true, createdAt: true,
      },
    });

    // 📝 AUDIT - CREATE
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

// 📋 Listar (admin: todos, cliente: só os dele)
router.get("/", async (req, res) => {
  try {
    const ehAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);
    const where = ehAdmin ? {} : { usuarioId: req.usuario!.usuarioLogadoId };

    const agendamentos = await prisma.agendamentoPermanente.findMany({
      where,
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        professor: { select: { id: true, nome: true, email: true } }, // 🆕
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

// 📄 Detalhes — dono ou admin
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
          professor: { select: { id: true, nome: true, email: true } }, // 🆕
          quadra: { select: { nome: true, numero: true } },
          esporte: { select: { nome: true } },
        },
      });
      if (!agendamento) {
        return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      }

      // próxima data (pula exceções; tudo em linha do tempo local)
      const proximaData = await proximaDataPermanenteSemExcecao({
        id: agendamento.id,
        diaSemana: agendamento.diaSemana as DiaSemana,
        dataInicio: agendamento.dataInicio ? new Date(agendamento.dataInicio) : null,
      });

      // exceções futuras a partir de HOJE LOCAL
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
        quadra: `${agendamento.quadra.nome} (Nº ${agendamento.quadra.numero})`,

        dataInicio: agendamento.dataInicio ? toISODateUTC(new Date(agendamento.dataInicio)) : null,

        // extras
        professor: agendamento.professor
          ? { id: agendamento.professor.id, nome: agendamento.professor.nome, email: agendamento.professor.email }
          : null,
        professorId: agendamento.professorId ?? null,
        tipoSessao: agendamento.tipoSessao ?? null,

        proximaData, // "YYYY-MM-DD" | null
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

// 📅 Datas elegíveis p/ exceção — dono ou admin
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
        const base = dataInicioLocalYMD && dataInicioLocalYMD > hojeLocalYMD
          ? dataInicioLocalYMD
          : hojeLocalYMD;
        return base;
      })();

      const fimJanelaYMD = addMonthsLocalYMD(inicioJanelaYMD, clampMeses);

      // Primeira ocorrência >= inícioJanela
      const curIdx = localWeekdayIndexOfYMD(inicioJanelaYMD);
      const targetIdx = DIA_IDX[perm.diaSemana as DiaSemana];
      const delta = (targetIdx - curIdx + 7) % 7;
      let dYMD = addDaysLocalYMD(inicioJanelaYMD, delta);

      const todas: string[] = [];
      while (toUtc00(dYMD) < toUtc00(fimJanelaYMD)) {
        // respeita dataInicio (se houver)
        if (!dataInicioLocalYMD || dYMD >= dataInicioLocalYMD) {
          todas.push(dYMD);
        }
        dYMD = addDaysLocalYMD(dYMD, 7);
      }

      const isAdmin = isAdminTipo(req.usuario!.usuarioLogadoTipo);

      // Já canceladas dentro da janela (consultando por UTC00 dos dias locais)
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

// 🚫 Registrar exceção (cancelar um dia da recorrência) — dono ou admin
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
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // "YYYY-MM-DD" (dia local)
      motivo: z.string().trim().max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });

    const { data: iso, motivo } = parsed.data;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: {
          id: true, usuarioId: true, diaSemana: true, horario: true,
          quadraId: true, esporteId: true, dataInicio: true, status: true, createdAt: true,
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const dataUTC = toUtc00(iso);

      // data >= dataInicio (se existir)
      if (perm.dataInicio && dataUTC < toUtc00(toISODateUTC(new Date(perm.dataInicio)))) {
        return res.status(400).json({ erro: "Data anterior ao início do agendamento permanente." });
      }

      // dia da semana confere (com base no dia local)
      const idxLocal = localWeekdayIndexOfYMD(iso);
      if (idxLocal !== DIA_IDX[perm.diaSemana as DiaSemana]) {
        return res.status(400).json({ erro: "Data não corresponde ao dia da semana do permanente." });
      }

      // evitar duplicidade
      const jaExiste = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: { agendamentoPermanenteId: id, data: dataUTC },
        select: { id: true },
      });
      if (jaExiste) {
        return res.status(409).json({ erro: "Esta data já está marcada como exceção para este permanente." });
      }

      const novo = await prisma.agendamentoPermanenteCancelamento.create({
        data: {
          agendamentoPermanenteId: id,
          data: dataUTC,
          motivo: motivo ?? null,
          criadoPorId: req.usuario!.usuarioLogadoId,
        },
        include: { criadoPor: { select: { id: true, nome: true, email: true } } },
      });

      // 📝 AUDIT - EXCEÇÃO (um dia)
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
        criadoPor: novo.criadoPor
          ? { id: novo.criadoPor.id, nome: novo.criadoPor.nome, email: novo.criadoPor.email }
          : null,
        createdAt: novo.createdAt,
      });
    } catch (e) {
      console.error("Erro em POST /:id/cancelar-dia", e);
      return res.status(500).json({ erro: "Erro ao registrar exceção do permanente" });
    }
  }
);

/**
 * ✅ Cancelar **a próxima ocorrência** de um permanente (cliente dono, admin_professores ou admin “full”)
 * - ADMIN_MASTER / ADMIN_ATENDENTE: sem restrição de horário.
 * - ADMIN_PROFESSORES: até 2h antes (com carência de 15min após a criação do permanente).
 * - CLIENTE dono: até 12h antes (com carência de 15min após a criação do permanente).
 * A carência só vale se o permanente foi criado há ≤ 15 minutos.
 */
router.post(
  "/:id/cancelar-proxima",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null; // permite admin ou dono
  }),
  async (req, res) => {
    const { id } = req.params;

    try {
      const perm = await prisma.agendamentoPermanente.findUnique({
        where: { id },
        select: {
          id: true, usuarioId: true, diaSemana: true, horario: true,
          quadraId: true, esporteId: true, dataInicio: true, status: true, createdAt: true,
        },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      // próxima data sem exceções (linha do tempo local)
      const proximaISO = await proximaDataPermanenteSemExcecao({
        id: perm.id,
        diaSemana: perm.diaSemana as DiaSemana,
        dataInicio: perm.dataInicio ? new Date(perm.dataInicio) : null,
      });
      if (!proximaISO) {
        return res.status(409).json({ erro: "Não há próxima ocorrência disponível para cancelamento." });
      }

      // Regra por papel
      const tipo = req.usuario!.usuarioLogadoTipo;
      const windowHours = cancellationWindowHours(tipo);

      if (windowHours !== null) {
        // alvo no fuso local SP (fixado -03:00)
        const alvo = new Date(`${proximaISO}T${perm.horario}:00-03:00`);
        const diffHoras = (alvo.getTime() - Date.now()) / (1000 * 60 * 60);

        if (diffHoras < windowHours) {
          // carência de 15 minutos a partir da CRIAÇÃO do permanente
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

      // Evitar duplicidade (concorrência)
      const jaExiste = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: { agendamentoPermanenteId: id, data: toUtc00(proximaISO) },
        select: { id: true },
      });
      if (jaExiste) {
        return res.status(409).json({ erro: "A próxima ocorrência já foi cancelada." });
      }

      const exc = await prisma.agendamentoPermanenteCancelamento.create({
        data: {
          agendamentoPermanenteId: id,
          data: toUtc00(proximaISO),
          motivo: "Cancelado (próxima ocorrência)",
          criadoPorId: req.usuario!.usuarioLogadoId,
        },
      });

      // 📝 AUDIT - EXCEÇÃO (próxima)
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

// ✅ Cancelar agendamento permanente (encerrar recorrência) — dono ou admin
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
          status: true, usuarioId: true, diaSemana: true, horario: true, quadraId: true, esporteId: true,
        },
      });

      const agendamento = await prisma.agendamentoPermanente.update({
        where: { id },
        data: { status: "CANCELADO", canceladoPorId: req.usuario!.usuarioLogadoId },
      });

      // 📝 AUDIT - CANCEL
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

// 🔁 Transferir agendamento permanente — admin ou dono
router.patch(
  "/:id/transferir",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamentoPermanente.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return reg?.usuarioId ?? null; // permite admin ou dono
  }),
  async (req, res) => {
    const { id } = req.params;

    const schema = z.object({
      novoUsuarioId: z.string().uuid(),
      transferidoPorId: z.string().uuid().optional(),
      /** true = copia exceções (datas já canceladas) para o novo permanente */
      copiarExcecoes: z.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.format() });
    }
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

      // Garante que não exista outro permanente ativo no mesmo slot
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
        return res
          .status(409)
          .json({ erro: "Já existe um agendamento permanente ativo nesse dia/horário/quadra" });
      }

      // Transação: marca original como TRANSFERIDO e cria o novo com o novo usuário
      const [, novoPerm] = await prisma.$transaction([
        prisma.agendamentoPermanente.update({
          where: { id },
          data: {
            status: "TRANSFERIDO",
            transferidoPorId: transferidoPorId ?? req.usuario!.usuarioLogadoId,
          },
        }),
        prisma.agendamentoPermanente.create({
          data: {
            diaSemana: perm.diaSemana,
            horario: perm.horario,
            quadraId: perm.quadraId,
            esporteId: perm.esporteId,
            usuarioId: novoUsuarioId,
            dataInicio: perm.dataInicio ?? null,

            // manter extras
            professorId: perm.professorId ?? null,
            tipoSessao: perm.tipoSessao ?? null,
          },
          include: {
            usuario: { select: { id: true, nome: true, email: true } },
            quadra: { select: { id: true, nome: true, numero: true } },
            esporte: { select: { id: true, nome: true } },
          },
        }),
      ]);

      // (Opcional) Copia as exceções do antigo para o novo
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

      // 📝 AUDIT - TRANSFER
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
            excecoesCopiadas: !!copiarExcecoes ? perm.cancelamentos.length : 0,
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
          quadra: novoPerm.quadra
            ? { id: novoPerm.quadra.id, nome: novoPerm.quadra.nome, numero: novoPerm.quadra.numero }
            : null,
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

// ❌ Deletar — dono ou admin
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

      // 📝 AUDIT - DELETE
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
