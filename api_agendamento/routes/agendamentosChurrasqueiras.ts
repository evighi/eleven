import { Router } from "express";
import { PrismaClient, Turno, DiaSemana } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import cron from "node-cron"; // 👈 cron para finalizar vencidos

import verificarToken from "../middleware/authMiddleware";
import { requireOwnerByRecord, isAdmin as isAdminTipo } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

const DIAS: readonly DiaSemana[] = [
  "DOMINGO",
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
] as const;

// ================= Helpers de horário local (America/Sao_Paulo) =================
const SP_TZ = process.env.TZ || "America/Sao_Paulo";

/**
 * Converte um Date (agora) para os boundaries de DIA LOCAL em UTC:
 * - hojeUTC00  = 00:00Z do dia local de hoje
 * - amanhaUTC00 = 00:00Z do dia local de amanhã
 *
 * Isso bate com a forma como você salva `data` no banco ("YYYY-MM-DD" → 00:00Z).
 */
function getStoredUtcBoundaryForLocalDay(dLocal = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(dLocal).split("-").map(Number);

  const hojeUTC00 = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0));
  const amanhaUTC00 = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0));

  return { hojeUTC00, amanhaUTC00 };
}

// "YYYY-MM-DD" -> Date em 00:00:00Z
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}
function diaSemanaFromUTC00(d: Date): DiaSemana {
  return DIAS[d.getUTCDay()];
}
// Janela UTC [início, fim) para o dia (evita problemas de TZ/precision)
function getUtcDayRange(isoYYYYMMDD: string) {
  const inicio = toUtc00(isoYYYYMMDD);
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

/** Cria um usuário mínimo a partir do nome do convidado (mesma lógica das quadras) */
async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 chars
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

const schemaAgendamentoChurrasqueira = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turno: z.nativeEnum(Turno),
  churrasqueiraId: z.string().uuid(),
  // Admin pode escolher o dono via usuário existente…
  usuarioId: z.string().uuid().optional(),
  // …ou informar um convidado (pega o primeiro nome e cria “usuário convidado”)
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});

// 🔒 todas as rotas exigem estar logado
router.use(verificarToken);

/* =======================================================================
   ⛳ FINALIZAR AGENDAMENTOS DE CHURRASQUEIRA VENCIDOS (CRON hh:01)
   ======================================================================= */

/**
 * Finaliza agendamentos de churrasqueira CONFIRMADOS
 * cujo DIA local já passou.
 *
 * Regra:
 *   - status = "CONFIRMADO"
 *   - data < hojeUTC00  (considerando o dia local America/Sao_Paulo)
 */
async function finalizarAgendamentosChurrasqueiraVencidos() {
  const agora = new Date();
  const { hojeUTC00 } = getStoredUtcBoundaryForLocalDay(agora);

  const r = await prisma.agendamentoChurrasqueira.updateMany({
    where: {
      status: "CONFIRMADO",
      data: { lt: hojeUTC00 },
    },
    data: { status: "FINALIZADO" },
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[finalizarAgendamentosChurrasqueiraVencidos] finalizados=${r.count} (hojeUTC00=${hojeUTC00.toISOString()})`
    );
  }
}

// evita duplicar job em modo dev (hot reload)
const globalAny = global as any;
if (!globalAny.__cronFinalizaChurrasVencidos__) {
  cron.schedule(
    "1 * * * *", // todo hh:01
    () => {
      finalizarAgendamentosChurrasqueiraVencidos().catch((e) =>
        console.error("Cron finalizarAgendamentosChurrasqueiraVencidos erro:", e)
      );
    },
    { timezone: SP_TZ }
  );
  globalAny.__cronFinalizaChurrasVencidos__ = true;
}

/* =======================================================================
   ROTAS
   ======================================================================= */

// POST /agendamentosChurrasqueiras  (criar COMUM por data+turno)
router.post("/", async (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const parsed = schemaAgendamentoChurrasqueira.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.format() });
  }

  const { data, turno, churrasqueiraId, usuarioId, convidadosNomes = [] } = parsed.data;
  const ehAdmin = isAdminTipo(req.usuario.usuarioLogadoTipo);

  // 🔑 Resolve DONO:
  // - Cliente: sempre para si (ignora usuarioId/convidadosNomes)
  // - Admin: usa usuarioId; se não vier, cria convidado a partir de convidadosNomes[0]
  let donoId = req.usuario.usuarioLogadoId;
  if (ehAdmin) {
    if (usuarioId) {
      donoId = usuarioId;
    } else if (convidadosNomes.length > 0) {
      const convidado = await criarConvidadoComoUsuario(convidadosNomes[0]);
      donoId = convidado.id;
    }
  }

  try {
    // 0) churrasqueira existe?
    const exists = await prisma.churrasqueira.findUnique({
      where: { id: churrasqueiraId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ erro: "Churrasqueira não encontrada." });
    }

    const dataUTC = toUtc00(data);
    const { inicio, fim } = getUtcDayRange(data);
    const diaSemana = diaSemanaFromUTC00(dataUTC);

    // (1) conflito com COMUM (mesmo dia+turno+churrasqueira)
    const conflitoComum = await prisma.agendamentoChurrasqueira.findFirst({
      where: {
        churrasqueiraId,
        data: dataUTC,
        turno,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: { id: true },
    });
    if (conflitoComum) {
      return res.status(409).json({ erro: "Já existe um agendamento para esta data e turno." });
    }

    // (2) conflito com PERMANENTE (mesmo diaSemana+turno+churrasqueira e dataInicio <= data)
    //    ⚠️ Só bloqueia se NÃO houver exceção (cancelamento) exatamente nessa data
    const conflitoPerm = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
      where: {
        churrasqueiraId,
        diaSemana,
        turno,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC } }],
        // usar janela [início, fim) evita problemas de TZ/precision
        cancelamentos: { none: { data: { gte: inicio, lt: fim } } },
      },
      select: { id: true },
    });

    if (conflitoPerm) {
      return res.status(409).json({ erro: "Turno ocupado por agendamento permanente." });
    }

    const novo = await prisma.agendamentoChurrasqueira.create({
      data: {
        data: dataUTC,
        turno,
        churrasqueiraId,
        usuarioId: donoId,
        status: "CONFIRMADO",
      },
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        churrasqueira: { select: { id: true, nome: true, numero: true, imagem: true } },
      },
    });

    // 📋 AUDIT: criação
    await logAudit({
      event: "CHURRAS_CREATE",
      req,
      target: { type: TargetType.AGENDAMENTO_CHURRASQUEIRA, id: novo.id },
      metadata: {
        data,
        turno,
        churrasqueiraId,
        donoId,
        status: "CONFIRMADO",
      },
    });

    return res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao criar agendamento" });
  }
});

// GET /agendamentosChurrasqueiras?data=YYYY-MM-DD&churrasqueiraId=...
router.get("/", async (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const qData = typeof req.query.data === "string" ? req.query.data : undefined;
  const churrasqueiraId =
    typeof req.query.churrasqueiraId === "string" ? req.query.churrasqueiraId : undefined;

  const where: any = { ...(churrasqueiraId ? { churrasqueiraId } : {}) };

  if (qData && /^\d{4}-\d{2}-\d{2}$/.test(qData)) {
    where.data = toUtc00(qData);
  }

  const ehAdmin = isAdminTipo(req.usuario.usuarioLogadoTipo);
  if (!ehAdmin) {
    where.usuarioId = req.usuario.usuarioLogadoId;
  } else if (typeof req.query.usuarioId === "string") {
    where.usuarioId = req.query.usuarioId;
  }

  try {
    const lista = await prisma.agendamentoChurrasqueira.findMany({
      where,
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        churrasqueira: { select: { id: true, nome: true, numero: true, imagem: true } },
      },
      orderBy: [{ data: "asc" }, { turno: "asc" }],
    });
    return res.json(lista);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao listar agendamentos" });
  }
});

// GET /agendamentosChurrasqueiras/:id  (dono ou admin)
router.get(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });

    // se não encontrar, bloqueia acesso
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    try {
      const agendamento = await prisma.agendamentoChurrasqueira.findUnique({
        where: { id: req.params.id },
        include: {
          usuario: {
            select: { id: true, nome: true, email: true },
          },
          churrasqueira: {
            select: { id: true, nome: true, numero: true },
          },
        },
      });

      if (!agendamento) {
        return res
          .status(404)
          .json({ erro: "Agendamento de churrasqueira não encontrado" });
      }

      // se quiser manter no padrão das outras rotas:
      const dataISO = agendamento.data.toISOString().slice(0, 10); // yyyy-mm-dd

      return res.json({
        id: agendamento.id,
        tipoReserva: "COMUM", // aqui você pode trocar se tiver enum/tipo no banco
        data: dataISO,
        turno: agendamento.turno, // ex: "MANHA" | "TARDE" | "NOITE"
        usuarioId: agendamento.usuario?.id ?? agendamento.usuarioId,
        usuarioNome: agendamento.usuario?.nome ?? null,
        usuarioEmail: agendamento.usuario?.email ?? null,
        churrasqueiraId: agendamento.churrasqueira?.id ?? null,
        churrasqueiraNome: agendamento.churrasqueira?.nome ?? null,
        churrasqueiraNumero: agendamento.churrasqueira?.numero ?? null,
        // se tiver mais campos no modelo (observacao, status, etc), pode adicionar aqui
      });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ erro: "Erro ao buscar agendamento de churrasqueira" });
    }
  }
);


// POST /agendamentosChurrasqueiras/cancelar/:id  (dono ou admin)
router.post(
  "/cancelar/:id",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });
    try {
      // carrega antes para log
      const before = await prisma.agendamentoChurrasqueira.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          data: true,
          turno: true,
          usuarioId: true,
          status: true,
          churrasqueiraId: true,
        },
      });
      if (!before) return res.status(404).json({ erro: "Agendamento não encontrado" });

      const up = await prisma.agendamentoChurrasqueira.update({
        where: { id: req.params.id },
        data: { status: "CANCELADO", canceladoPorId: req.usuario.usuarioLogadoId },
      });

      // 📋 AUDIT: cancelamento
      await logAudit({
        event: "CHURRAS_CANCEL",
        req,
        target: { type: TargetType.AGENDAMENTO_CHURRASQUEIRA, id: before.id },
        metadata: {
          statusAntes: before.status,
          statusDepois: "CANCELADO",
          data: before.data.toISOString().slice(0, 10),
          turno: before.turno,
          churrasqueiraId: before.churrasqueiraId,
          donoId: before.usuarioId,
          canceladoPorId: req.usuario.usuarioLogadoId,
        },
      });

      return res.json({ message: "Agendamento cancelado com sucesso.", agendamento: up });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao cancelar agendamento de churrasqueira" });
    }
  }
);

// DELETE /agendamentosChurrasqueiras/:id  (dono ou admin)
router.delete(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    try {
      // carrega antes para log
      const before = await prisma.agendamentoChurrasqueira.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          data: true,
          turno: true,
          usuarioId: true,
          status: true,
          churrasqueiraId: true,
        },
      });
      if (!before) return res.status(404).json({ erro: "Agendamento não encontrado" });

      await prisma.agendamentoChurrasqueira.delete({ where: { id: req.params.id } });

      // 📋 AUDIT: deleção
      await logAudit({
        event: "CHURRAS_DELETE",
        req,
        target: { type: TargetType.AGENDAMENTO_CHURRASQUEIRA, id: before.id },
        metadata: {
          data: before.data.toISOString().slice(0, 10),
          turno: before.turno,
          churrasqueiraId: before.churrasqueiraId,
          donoId: before.usuarioId,
          statusAntes: before.status,
          deletadoPorId: req.usuario?.usuarioLogadoId ?? null,
        },
      });

      return res.json({ mensagem: "Agendamento deletado com sucesso" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao deletar" });
    }
  }
);

export default router;
