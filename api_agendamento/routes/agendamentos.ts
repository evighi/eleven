import { Router, Request } from "express";
import { PrismaClient, DiaSemana } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { startOfDay, addDays, getDay } from "date-fns";
import cron from "node-cron";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin, requireOwnerByRecord, isAdmin as isAdminTipo } from "../middleware/acl";
import { r2PublicUrl } from "../src/lib/r2";

// Mapa DiaSemana -> número JS (0=Dom..6=Sáb)
const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
};

// Próxima data (YYYY-MM-DD, UTC) para um DiaSemana, respeitando dataInicio opcional
function nextDateISOForDiaSemana(dia: DiaSemana, minDate?: Date | null) {
  const hoje = new Date();
  const base = minDate && minDate > hoje ? minDate : hoje;
  const cur = base.getDay();
  const target = DIA_IDX[dia] ?? 0;
  const delta = (target - cur + 7) % 7;
  const d = startOfDay(addDays(base, delta));
  return d.toISOString().slice(0, 10);
}

function getUtcDayRange(dateStr?: string) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const base = dateStr.slice(0, 10);
    const inicio = new Date(`${base}T00:00:00Z`);
    const fim = new Date(`${base}T00:00:00Z`);
    fim.setUTCDate(fim.getUTCDate() + 1);
    return { inicio, fim };
  }
  const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(new Date());
  return { inicio: hojeUTC00, fim: amanhaUTC00 };
}

/** Boundaries em UTC para o "dia local" America/Sao_Paulo */
function getStoredUtcBoundaryForLocalDay(dLocal = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [y, m, d] = fmt.format(dLocal).split("-").map(Number);
  const hojeUTC00 = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const amanhaUTC00 = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return { hojeUTC00, amanhaUTC00 };
}

function resolveQuadraImg(imagem?: string | null) {
  if (!imagem) return null;
  const isHttp = /^https?:\/\//i.test(imagem);
  const looksLikeR2Key = !isHttp && (imagem.includes("/") || imagem.startsWith("quadras"));
  if (looksLikeR2Key) {
    const url = r2PublicUrl(imagem);
    if (url) return url;
  }
  if (isHttp) return imagem;
  const base = process.env.APP_URL ? `${process.env.APP_URL}/uploads/quadras/` : `/uploads/quadras/`;
  return `${base}${imagem}`;
}
function toISODateUTC(d: Date) { return d.toISOString().slice(0, 10); }
function toUtc00(isoYYYYMMDD: string) { return new Date(`${isoYYYYMMDD}T00:00:00Z`); }

const prisma = new PrismaClient();
const router = Router();

<<<<<<< Updated upstream
/** ===== Helpers de domínio ===== */
=======
const isAdminRole = (t?: string) =>
  ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"].includes(t || "");

/**
 * Calcula a PRÓXIMA data (YYYY-MM-DD) para um permanente,
 * PULANDO as datas já marcadas como exceção e CONSIDERANDO o horário.
 */
>>>>>>> Stashed changes
async function proximaDataPermanenteSemExcecao(p: {
  id: string; diaSemana: DiaSemana; dataInicio: Date | null;
}): Promise<string> {
  const hoje = new Date();
  const base = p.dataInicio && p.dataInicio > hoje ? p.dataInicio : hoje;
  const cur = base.getDay();
  const target = DIA_IDX[p.diaSemana] ?? 0;
  const delta = (target - cur + 7) % 7;
  let tentativa = startOfDay(addDays(base, delta));

<<<<<<< Updated upstream
=======
  // Se a tentativa é "hoje" no calendário local, respeitar o horário:
  const tentativaEhHojeLocal = localYMD(tentativa) === localYMD(agora); // ambos em SP
  const agoraHHMM = localHM(agora); // "HH:mm" em SP
  if (tentativaEhHojeLocal && agoraHHMM >= p.horario) {
    // já passou o horário de hoje -> pula uma semana
    tentativa = addDays(tentativa, 7);
  }

  // Limite de segurança de 120 iterações (~2 anos)
>>>>>>> Stashed changes
  for (let i = 0; i < 120; i++) {
    const iso = toISODateUTC(tentativa);
    const exc = await prisma.agendamentoPermanenteCancelamento.findFirst({
      where: { agendamentoPermanenteId: p.id, data: toUtc00(iso) }, select: { id: true },
    });
    if (!exc) return iso;
    tentativa = addDays(tentativa, 7);
  }
  return toISODateUTC(tentativa);
}

async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex");
  const emailSintetico = `${localPart}+guest.${suffix}@noemail.local`;
  const randomPass = crypto.randomUUID();
  const hashed = await bcrypt.hash(randomPass, 10);
  const convidado = await prisma.usuario.create({
    data: { nome: cleanName, email: emailSintetico, senha: hashed, tipo: "CLIENTE", celular: null, cpf: null, nascimento: null },
    select: { id: true, nome: true, email: true },
  });
  return convidado;
}

const diasEnum = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"];
const addJogadoresSchema = z.object({
  jogadoresIds: z.array(z.string().uuid()).optional().default([]),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});
const agendamentoSchema = z.object({
  data: z.coerce.date(),
  horario: z.string().min(1),
  quadraId: z.string().uuid(),
  esporteId: z.string().uuid(),
  usuarioId: z.string().uuid().optional(), // só admin pode usar
  jogadoresIds: z.array(z.string().uuid()).optional().default([]),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});

/** ===== Cron de finalização ===== */
async function finalizarAgendamentosVencidos() {
  const agora = new Date();
  const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(agora);
<<<<<<< Updated upstream
  const hh = String(agora.getHours()).padStart(2, "0");
  const mm = String(agora.getMinutes()).padStart(2, "0");
  const agoraHHMM = `${hh}:${mm}`;
  await prisma.agendamento.updateMany({ where: { status: "CONFIRMADO", data: { lt: hojeUTC00 } }, data: { status: "FINALIZADO" } });
  await prisma.agendamento.updateMany({
    where: { status: "CONFIRMADO", data: { gte: hojeUTC00, lt: amanhaUTC00 }, horario: { lt: agoraHHMM } },
    data: { status: "FINALIZADO" },
  });
=======

  // HORA ATUAL NO FUSO DE SP — NÃO usar getHours()/getMinutes()
  const agoraHHMM = localHM(agora, SP_TZ); // "HH:mm"

  // 1) Qualquer dia anterior a hoje
  await prisma.agendamento.updateMany({
    where: { status: "CONFIRMADO", data: { lt: hojeUTC00 } },
    data: { status: "FINALIZADO" },
  });

  // 2) Hoje, mas com horário já passado
  await prisma.agendamento.updateMany({
    where: {
      status: "CONFIRMADO",
      data: { gte: hojeUTC00, lt: amanhaUTC00 },
      horario: { lt: agoraHHMM },
    },
    data: { status: "FINALIZADO" },
  });
>>>>>>> Stashed changes
}
const globalAny = global as any;
if (!globalAny.__cronFinalizaVencidos__) {
  cron.schedule("1 * * * *", () => { finalizarAgendamentosVencidos().catch((e) => console.error("Cron erro:", e)); },
    { timezone: process.env.TZ || "America/Sao_Paulo" });
  globalAny.__cronFinalizaVencidos__ = true;
}

<<<<<<< Updated upstream
/** ======= 🔒 Todas as rotas exigem login ======= */
router.use(verificarToken);

/** CREATE — cliente cria p/ si; admin pode criar p/ outro usuarioId */
router.post("/", async (req, res) => {
=======
/** ================== ROTAS ================== */

// Criar agendamento (cliente + admin)
router.post("/", verificarToken, async (req, res) => {
>>>>>>> Stashed changes
  const parsed = agendamentoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

<<<<<<< Updated upstream
  const { data, horario, quadraId, esporteId, jogadoresIds = [], convidadosNomes = [] } = parsed.data;
  const admin = isAdminTipo(req.usuario.usuarioLogadoTipo);
  const usuarioIdBody = parsed.data.usuarioId;
  const usuarioIdDono = admin && usuarioIdBody ? usuarioIdBody : req.usuario.usuarioLogadoId;
=======
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

  // ✅ cliente não define usuarioId; admin pode
  const usuarioIdDono = isAdmin && usuarioIdBody
    ? usuarioIdBody
    : reqCustom.usuario.usuarioLogadoId;
>>>>>>> Stashed changes

  try {
    const diaSemanaEnum = diasEnum[getDay(data)] as DiaSemana;
    const dataInicio = startOfDay(data);
    const dataFim = addDays(dataInicio, 1);

    // conflito comum
    const agendamentoExistente = await prisma.agendamento.findFirst({
<<<<<<< Updated upstream
      where: { quadraId, horario, data: { gte: dataInicio, lt: dataFim }, status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
=======
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

    // (2) conflito com PERMANENTE ATIVO — mas RESPEITANDO exceções para a data
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
>>>>>>> Stashed changes
      select: { id: true },
    });
    if (agendamentoExistente) return res.status(409).json({ erro: "Já existe um agendamento para essa quadra, data e horário" });

    // conflito permanente (sem exceção)
    const dataISO = toISODateUTC(data);
    const dataUTC00 = toUtc00(dataISO);
    const permanentesAtivos = await prisma.agendamentoPermanente.findMany({
      where: { diaSemana: diaSemanaEnum, horario, quadraId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC00 } }] },
      select: { id: true },
    });
    if (permanentesAtivos.length > 0) {
      const excecao = await prisma.agendamentoPermanenteCancelamento.findFirst({
        where: { agendamentoPermanenteId: { in: permanentesAtivos.map(p => p.id) }, data: dataUTC00 }, select: { id: true },
      });
<<<<<<< Updated upstream
      if (!excecao) return res.status(409).json({ erro: "Horário ocupado por um agendamento permanente" });
=======

      if (!excecao) {
        return res.status(409).json({ erro: "Horário ocupado por um agendamento permanente" });
      }
>>>>>>> Stashed changes
    }

    // convidados
    const convidadosCriadosIds: string[] = [];
    for (const nome of convidadosNomes) {
      const convidado = await criarConvidadoComoUsuario(nome);
      convidadosCriadosIds.push(convidado.id);
    }
    const connectIds = Array.from(new Set<string>([usuarioIdDono, ...jogadoresIds, ...convidadosCriadosIds])).map((id) => ({ id }));

<<<<<<< Updated upstream
=======
    // ── monta todos os jogadores: dono + cadastrados + convidados (sem duplicar) ─
    const connectIds = Array.from(
      new Set<string>([usuarioIdDono, ...jogadoresIds, ...convidadosCriadosIds])
    ).map((id) => ({ id }));

    // ── cria agendamento ────────────────────────────────────────────────────────
>>>>>>> Stashed changes
    const novoAgendamento = await prisma.agendamento.create({
      data: { data, horario, quadraId, esporteId, usuarioId: usuarioIdDono, status: "CONFIRMADO", jogadores: { connect: connectIds } },
      include: {
        jogadores: { select: { id: true, nome: true, email: true } },
        usuario: { select: { id: true, nome: true, email: true } },
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
      },
    });

    return res.status(201).json(novoAgendamento);
<<<<<<< Updated upstream
  } catch (err) {
=======
  } catch (err: any) {
    // Concorrência (slot acabou de ser pego)
    if (
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") ||
      err?.code === "23505"
    ) {
      return res
        .status(409)
        .json({ erro: "Este horário acabou de ser reservado por outra pessoa. Escolha outra quadra." });
    }

>>>>>>> Stashed changes
    console.error("Erro ao criar agendamento", err);
    return res.status(500).json({ erro: "Erro ao criar agendamento" });
  }
});

<<<<<<< Updated upstream
/** LIST — admin vê todos; cliente vê só os dele */
router.get("/", async (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const { data, quadraId, usuarioId } = req.query;
  try {
    const admin = isAdminTipo(req.usuario.usuarioLogadoTipo);
    const where: any = { ...(quadraId ? { quadraId: String(quadraId) } : {}) };

    if (admin) {
      if (usuarioId) where.usuarioId = String(usuarioId);
    } else {
      // força filtro próprio e ignora query de usuarioId
      where.usuarioId = req.usuario.usuarioLogadoId;
    }

    if (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const { inicio, fim } = getUtcDayRange(data);
      where.data = { gte: inicio, lt: fim };
    } else if (data) {
      where.data = new Date(String(data));
    }

=======
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
>>>>>>> Stashed changes
    const agendamentos = await prisma.agendamento.findMany({
      where,
      include: {
        quadra: { select: { id: true, nome: true, numero: true, tipoCamera: true, imagem: true } },
        usuario: { select: { id: true, nome: true, email: true } },
        jogadores: { select: { id: true, nome: true, email: true } },
        esporte: { select: { id: true, nome: true } },
      },
      orderBy: [{ data: "asc" }, { horario: "asc" }],
    });

<<<<<<< Updated upstream
    const resposta = agendamentos.map(a => ({
=======
    const sanitizeEmail = (email?: string | null) => (isAdmin ? email : undefined);

    const resposta = agendamentos.map((a) => ({
>>>>>>> Stashed changes
      ...a,
      usuario: a.usuario
        ? { ...a.usuario, email: sanitizeEmail(a.usuario.email) }
        : a.usuario,
      jogadores: a.jogadores.map((j) => ({ ...j, email: sanitizeEmail(j.email) })),
      quadraLogoUrl: resolveQuadraImg(a.quadra?.imagem) || "/quadra.png",
    }));

    return res.json(resposta);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});

<<<<<<< Updated upstream
/** GET /agendamentos/me — mantém (já exige login pelo use) */
router.get("/me", async (req, res) => {
=======
// GET /agendamentos/me  -> comuns CONFIRMADOS + permanentes ATIVOS
router.get("/me", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoNome?: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

>>>>>>> Stashed changes
  try {
    const usuarioId = req.usuario!.usuarioLogadoId;

    const comunsConfirmados = await prisma.agendamento.findMany({
      where: { status: "CONFIRMADO", OR: [{ usuarioId }, { jogadores: { some: { id: usuarioId } } }] },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
      },
      orderBy: [{ data: "asc" }, { horario: "asc" }],
    });

    const respComuns = comunsConfirmados.map((a) => {
      const quadraLogoUrl = resolveQuadraImg(a.quadra?.imagem) || "/quadra.png";
      return {
        id: a.id, nome: a.esporte?.nome ?? "Quadra",
        local: a.quadra ? `${a.quadra.nome} - Nº ${a.quadra.numero}` : "",
<<<<<<< Updated upstream
        horario: a.horario, tipoReserva: "COMUM" as const, status: a.status,
        logoUrl: quadraLogoUrl, data: a.data.toISOString().slice(0, 10),
        quadraNome: a.quadra?.nome ?? "", quadraNumero: a.quadra?.numero ?? null, quadraLogoUrl, esporteNome: a.esporte?.nome ?? "",
=======
        horario: a.horario,
        tipoReserva: "COMUM" as const,
        status: a.status,
        logoUrl: quadraLogoUrl,
        data: a.data.toISOString().slice(0, 10),
        quadraNome: a.quadra?.nome ?? "",
        quadraNumero: a.quadra?.numero ?? null,
        quadraLogoUrl,
        esporteNome: a.esporte?.nome ?? "",
>>>>>>> Stashed changes
      };
    });

    const permanentes = await prisma.agendamentoPermanente.findMany({
      where: { usuarioId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
      include: { quadra: { select: { id: true, nome: true, numero: true, imagem: true } }, esporte: { select: { id: true, nome: true } } },
      orderBy: [{ diaSemana: "asc" }, { horario: "asc" }],
    });

    const respPermanentes = await Promise.all(
      permanentes.map(async (p) => {
        const quadraLogoUrl = resolveQuadraImg(p.quadra?.imagem) || "/quadra.png";
<<<<<<< Updated upstream
        const proximaData = await proximaDataPermanenteSemExcecao({ id: p.id, diaSemana: p.diaSemana as DiaSemana, dataInicio: p.dataInicio ?? null });
=======
        const proximaData = await proximaDataPermanenteSemExcecao({
          id: p.id,
          diaSemana: p.diaSemana as DiaSemana,
          dataInicio: p.dataInicio ?? null,
          horario: p.horario,
        });

>>>>>>> Stashed changes
        return {
          id: p.id, nome: p.esporte?.nome ?? "Quadra",
          local: p.quadra ? `${p.quadra.nome} - Nº ${p.quadra.numero}` : "",
<<<<<<< Updated upstream
          horario: p.horario, tipoReserva: "PERMANENTE" as const, status: p.status,
          logoUrl: quadraLogoUrl, data: null, diaSemana: p.diaSemana, proximaData,
          quadraNome: p.quadra?.nome ?? "", quadraNumero: p.quadra?.numero ?? null, quadraLogoUrl, esporteNome: p.esporte?.nome ?? "",
=======
          horario: p.horario,
          tipoReserva: "PERMANENTE" as const,
          status: p.status,
          logoUrl: quadraLogoUrl,
          data: null,
          diaSemana: p.diaSemana,
          proximaData,
          quadraNome: p.quadra?.nome ?? "",
          quadraNumero: p.quadra?.numero ?? null,
          quadraLogoUrl,
          esporteNome: p.esporte?.nome ?? "",
>>>>>>> Stashed changes
        };
      })
    );

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

/** Transferidos do usuário logado (já autenticado pelo use) */
router.get("/transferidos/me", async (req, res) => {
  try {
    const usuarioId = req.usuario!.usuarioLogadoId;

    const transferidos = await prisma.agendamento.findMany({
      where: { usuarioId, status: "TRANSFERIDO" },
      include: { quadra: { select: { id: true, nome: true, numero: true, imagem: true } }, esporte: { select: { id: true, nome: true } } },
      orderBy: [{ data: "desc" }, { horario: "desc" }],
    });

    const resposta = await Promise.all(
      transferidos.map(async (t) => {
        const novo = await prisma.agendamento.findFirst({
          where: {
            id: { not: t.id }, data: t.data, horario: t.horario,
            quadraId: t.quadraId, esporteId: t.esporteId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
          include: { usuario: { select: { id: true, nome: true, email: true } } },
        });

        const quadraLogoUrl = resolveQuadraImg(t.quadra?.imagem);
<<<<<<< Updated upstream
        return {
          id: t.id, data: t.data.toISOString().slice(0, 10), horario: t.horario, status: t.status,
          quadraNome: t.quadra?.nome ?? "", quadraNumero: t.quadra?.numero ?? null, quadraImagem: t.quadra?.imagem ?? null, quadraLogoUrl,
          esporteNome: t.esporte?.nome ?? "", transferidoPara: novo?.usuario ? { id: novo.usuario.id, nome: novo.usuario.nome, email: novo.usuario.email } : null,
=======

        // mascarar email do "novo dono" (não-admin)
        const novoUsuario = novo?.usuario
          ? { id: novo.usuario.id, nome: novo.usuario.nome, email: undefined as string | undefined }
          : null;

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
          transferidoPara: novoUsuario,
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
/** Finaliza vencidos — somente ADMIN (manual) */
router.post("/_finaliza-vencidos", requireAdmin, async (_req, res) => {
=======
// 🚀 Rota manual para finalizar vencidos (restringida)
router.post("/_finaliza-vencidos", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });
  if (!isAdminRole(reqCustom.usuario.usuarioLogadoTipo)) {
    return res.status(403).json({ erro: "Acesso negado" });
  }

>>>>>>> Stashed changes
  try {
    await finalizarAgendamentosVencidos();
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Falha ao finalizar vencidos" });
  }
});

<<<<<<< Updated upstream
/** Detalhes de um agendamento — dono ou admin */
router.get(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamento.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const agendamento = await prisma.agendamento.findUnique({
        where: { id },
        include: {
          usuario: { select: { id: true, nome: true, email: true } },
          jogadores: { select: { id: true, nome: true, email: true } },
          quadra: { select: { nome: true, numero: true } },
          esporte: { select: { nome: true } },
        },
=======
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
        usuario: { select: { id: true, nome: true, email: true } },
        jogadores: { select: { id: true, nome: true, email: true } },
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

    return res.json({
      id: agendamento.id,
      tipoReserva: "COMUM",
      dia: agendamento.data.toISOString().split("T")[0],
      horario: agendamento.horario,
      usuario: agendamento.usuario?.nome,
      usuarioId: agendamento.usuario?.id,
      esporte: agendamento.esporte?.nome,
      quadra: `${agendamento.quadra?.nome} (Nº ${agendamento.quadra?.numero})`,
      jogadores: agendamento.jogadores.map((j) => ({
        nome: j.nome,
        email: sanitizeEmail(j.email),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar agendamento" });
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

    const isAdmin = isAdminRole(reqCustom.usuario.usuarioLogadoTipo);
    const isOwner = String(ag.usuarioId) === String(reqCustom.usuario.usuarioLogadoId);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ erro: "Você não pode cancelar este agendamento." });
    }

    // ===== Regra de tempo (para CLIENTE/dono) =====
    if (!isAdmin) {
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
      const canBy12h = minutesToStart >= 12 * 60;

      if (!canBy12h) {
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

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoPorId: reqCustom.usuario.usuarioLogadoId,
      },
    });

    return res.status(200).json({
      message: "Agendamento cancelado com sucesso.",
      agendamento: atualizado,
    });
  } catch (error) {
    console.error("Erro ao cancelar agendamento:", error);
    return res.status(500).json({ erro: "Erro ao cancelar agendamento." });
  }
});

// Delete (admin-only)
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
    res.json({ message: "Agendamento deletado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao deletar agendamento" });
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

    const novoUsuario = await prisma.usuario.findUnique({ where: { id: novoUsuarioId } });
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
        },
        include: { usuario: true, jogadores: true, quadra: true },
      }),
    ]);

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
          senha: hashDefault, // campo senha é obrigatório no seu schema
          tipo: "CLIENTE",
        },
        select: { id: true },
>>>>>>> Stashed changes
      });
      if (!agendamento) return res.status(404).json({ erro: "Agendamento não encontrado" });
      return res.json({
        id: agendamento.id,
        tipoReserva: "COMUM",
        dia: agendamento.data.toISOString().split("T")[0],
        horario: agendamento.horario,
        usuario: agendamento.usuario.nome,
        usuarioId: agendamento.usuario.id,
        esporte: agendamento.esporte.nome,
        quadra: `${agendamento.quadra.nome} (Nº ${agendamento.quadra.numero})`,
        jogadores: agendamento.jogadores.map(j => ({ nome: j.nome, email: j.email })),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao buscar agendamento" });
    }
  }
);

<<<<<<< Updated upstream
/** Cancelar — dono ou admin; usa id do token como canceladoPorId; bloqueia status inválidos/passado */
router.post(
  "/cancelar/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamento.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const ag = await prisma.agendamento.findUnique({ where: { id } });
      if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado" });
=======
    const jaConectados = new Set(agendamento.jogadores.map((j) => j.id));
>>>>>>> Stashed changes

      if (["CANCELADO", "TRANSFERIDO", "FINALIZADO"].includes(ag.status)) {
        return res.status(400).json({ erro: "Agendamento não pode ser cancelado nesse status" });
      }

      // (opcional) bloquear cancelamento no passado
      const agora = new Date();
      const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(agora);
      const hh = String(agora.getHours()).padStart(2, "0"), mm = String(agora.getMinutes()).padStart(2, "0");
      const agoraHHMM = `${hh}:${mm}`;
      const isPast = ag.data < hojeUTC00 || (ag.data >= hojeUTC00 && ag.data < amanhaUTC00 && ag.horario < agoraHHMM);
      if (isPast) return res.status(400).json({ erro: "Não é possível cancelar um agendamento passado" });

<<<<<<< Updated upstream
      const atualizado = await prisma.agendamento.update({
=======
    if (idsNovosExistentes.length === 0 && idsConvidados.length === 0) {
      const atual = await prisma.agendamento.findUnique({
>>>>>>> Stashed changes
        where: { id },
        data: { status: "CANCELADO", canceladoPorId: req.usuario!.usuarioLogadoId },
      });
      return res.json({ mensagem: "Agendamento cancelado com sucesso.", agendamento: atualizado });
    } catch (error) {
      console.error("Erro ao cancelar agendamento:", error);
      return res.status(500).json({ erro: "Erro ao cancelar agendamento." });
    }
  }
);

/** Delete — dono ou admin */
router.delete(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamento.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    try {
      const agendamento = await prisma.agendamento.findUnique({ where: { id } });
      if (!agendamento) return res.status(404).json({ erro: "Agendamento não encontrado" });
      await prisma.agendamento.delete({ where: { id } });
      return res.json({ mensagem: "Agendamento deletado com sucesso" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao deletar agendamento" });
    }
  }
);

/** Transferir — dono ou admin; define transferidoPorId pelo token */
router.patch(
  "/:id/transferir",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamento.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    const bodySchema = z.object({ novoUsuarioId: z.string().uuid() });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.errors });

    const { novoUsuarioId } = parsed.data;

    try {
      const agendamento = await prisma.agendamento.findUnique({ where: { id }, include: { jogadores: true } });
      if (!agendamento) return res.status(404).json({ erro: "Agendamento não encontrado" });
      if (["CANCELADO", "TRANSFERIDO", "FINALIZADO"].includes(agendamento.status)) {
        return res.status(400).json({ erro: "Este agendamento não pode ser transferido" });
      }
      if (novoUsuarioId === agendamento.usuarioId) {
        return res.status(400).json({ erro: "Novo usuário é o mesmo dono atual" });
      }

      const novoUsuario = await prisma.usuario.findUnique({ where: { id: novoUsuarioId }, select: { id: true } });
      if (!novoUsuario) return res.status(404).json({ erro: "Novo usuário não encontrado" });

      const [agendamentoOriginalAtualizado, novoAgendamento] = await prisma.$transaction([
        prisma.agendamento.update({
          where: { id },
          data: { status: "TRANSFERIDO", transferidoPorId: req.usuario!.usuarioLogadoId, jogadores: { set: [] } },
          include: { jogadores: true },
        }),
        prisma.agendamento.create({
          data: {
            data: agendamento.data, horario: agendamento.horario,
            usuarioId: novoUsuarioId, quadraId: agendamento.quadraId, esporteId: agendamento.esporteId,
            jogadores: { connect: [{ id: novoUsuarioId }] },
          },
          include: { usuario: true, jogadores: true, quadra: true },
        }),
      ]);

      return res.status(200).json({
        mensagem: "Agendamento transferido com sucesso",
        agendamentoOriginalId: id,
        novoAgendamento: {
          id: novoAgendamento.id,
          data: novoAgendamento.data,
          horario: novoAgendamento.horario,
          usuario: novoAgendamento.usuario ? { id: novoAgendamento.usuario.id, nome: novoAgendamento.usuario.nome, email: novoAgendamento.usuario.email } : null,
          jogadores: novoAgendamento.jogadores.map((j) => ({ id: j.id, nome: j.nome, email: j.email })),
          quadra: novoAgendamento.quadra ? { id: novoAgendamento.quadra.id, nome: novoAgendamento.quadra.nome, numero: novoAgendamento.quadra.numero } : null,
        },
      });
    } catch (error) {
      console.error("Erro ao transferir agendamento:", error);
      return res.status(500).json({ erro: "Erro ao transferir agendamento" });
    }
  }
);

/** Jogadores — dono ou admin; usa helper de convidado seguro */
router.patch(
  "/:id/jogadores",
  requireOwnerByRecord(async (req) => {
    const reg = await prisma.agendamento.findUnique({ where: { id: req.params.id }, select: { usuarioId: true } });
    return reg?.usuarioId ?? null;
  }),
  async (req, res) => {
    const parsed = addJogadoresSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });
    const { jogadoresIds, convidadosNomes } = parsed.data;
    const { id } = req.params;

    try {
      const agendamento = await prisma.agendamento.findUnique({
        where: { id }, include: { jogadores: { select: { id: true } } },
      });
      if (!agendamento) return res.status(404).json({ erro: "Agendamento não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(agendamento.status)) {
        return res.status(400).json({ erro: "Não é possível alterar jogadores deste agendamento" });
      }

      const usuariosValidos = jogadoresIds.length
        ? await prisma.usuario.findMany({ where: { id: { in: jogadoresIds } }, select: { id: true } })
        : [];

      if (usuariosValidos.length !== jogadoresIds.length) {
        return res.status(400).json({ erro: "Um ou mais jogadores não existem" });
      }

      const convidadosCriados: Array<{ id: string }> = [];
      for (const nome of convidadosNomes) {
        const convidado = await criarConvidadoComoUsuario(nome);
        convidadosCriados.push({ id: convidado.id });
      }

      const jaConectados = new Set(agendamento.jogadores.map((j) => j.id));
      const idsNovosExistentes = usuariosValidos.map((u) => u.id).filter((uid) => !jaConectados.has(uid));
      const idsConvidados = convidadosCriados.map((c) => c.id);

      if (idsNovosExistentes.length === 0 && idsConvidados.length === 0) {
        const atual = await prisma.agendamento.findUnique({
          where: { id }, include: { usuario: true, jogadores: true, quadra: true, esporte: true },
        });
        return res.json(atual);
      }

      const atualizado = await prisma.agendamento.update({
        where: { id },
        data: { jogadores: { connect: [...idsNovosExistentes.map((jid) => ({ id: jid })), ...idsConvidados.map((jid) => ({ id: jid }))] } },
        include: { usuario: true, jogadores: true, quadra: true, esporte: true },
      });

      return res.json({
        id: atualizado.id,
        data: atualizado.data,
        horario: atualizado.horario,
        status: atualizado.status,
        usuario: atualizado.usuario ? { id: atualizado.usuario.id, nome: atualizado.usuario.nome, email: atualizado.usuario.email } : null,
        jogadores: atualizado.jogadores.map((j) => ({ id: j.id, nome: j.nome, email: j.email })),
        quadra: atualizado.quadra ? { id: atualizado.quadra.id, nome: atualizado.quadra.nome, numero: atualizado.quadra.numero } : null,
        esporte: atualizado.esporte ? { id: atualizado.esporte.id, nome: atualizado.esporte.nome } : null,
      });
    } catch (err) {
      console.error("Erro ao adicionar jogadores:", err);
      return res.status(500).json({ erro: "Erro ao adicionar jogadores ao agendamento" });
    }
<<<<<<< Updated upstream
=======

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
>>>>>>> Stashed changes
  }
);

export default router;
