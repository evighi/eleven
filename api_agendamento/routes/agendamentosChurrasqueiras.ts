import { Router } from "express";
import { PrismaClient, Turno, DiaSemana } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import verificarToken from "../middleware/authMiddleware";
import { requireOwnerByRecord, isAdmin as isAdminTipo } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

const DIAS: readonly DiaSemana[] = [
  "DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO",
] as const;

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
  const churrasqueiraId = typeof req.query.churrasqueiraId === "string" ? req.query.churrasqueiraId : undefined;

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
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    try {
      const a = await prisma.agendamentoChurrasqueira.findUnique({
        where: { id: req.params.id },
        include: {
          usuario: { select: { id: true, nome: true, email: true } },
          churrasqueira: { select: { nome: true, numero: true } },
        },
      });
      if (!a) return res.status(404).json({ erro: "Agendamento de churrasqueira não encontrado" });

      return res.json({
        id: a.id,
        tipoReserva: "COMUM",
        data: a.data.toISOString().slice(0, 10),
        turno: a.turno,
        usuario: a.usuario?.nome,
        usuarioId: a.usuario?.id,
        churrasqueira: `${a.churrasqueira?.nome} (Nº ${a.churrasqueira?.numero})`,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao buscar agendamento de churrasqueira" });
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
