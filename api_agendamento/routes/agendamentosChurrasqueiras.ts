import { Router } from "express";
import { PrismaClient, Turno, DiaSemana } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";
import { requireOwnerByRecord } from "../middleware/acl";

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

const schemaAgendamentoChurrasqueira = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turno: z.nativeEnum(Turno),
  churrasqueiraId: z.string().uuid(),
  // admin pode passar; cliente usa o id do token
  usuarioId: z.string().uuid().optional(),
});

// 🔒 todas as rotas exigem estar logado
router.use(verificarToken);

// POST /churrasqueiras/agendamentos  (criar comum por data+turno)
router.post("/", async (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const parsed = schemaAgendamentoChurrasqueira.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.format() });
  }

  const { data, turno, churrasqueiraId, usuarioId } = parsed.data;
  const isAdmin = ["ADMIN_MASTER","ADMIN_ATENDENTE","ADMIN_PROFESSORES"].includes(req.usuario.usuarioLogadoTipo);
  const donoId = (isAdmin && usuarioId) ? usuarioId : req.usuario.usuarioLogadoId;

  try {
    const dataUTC = toUtc00(data);

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
    const diaSemana = diaSemanaFromUTC00(dataUTC);
    const conflitoPerm = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
      where: {
        churrasqueiraId,
        diaSemana,
        turno,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC } }],
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

    return res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao criar agendamento" });
  }
});

// GET /churrasqueiras/agendamentos?data=YYYY-MM-DD&churrasqueiraId=...
router.get("/", async (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const qData = typeof req.query.data === "string" ? req.query.data : undefined;
  const churrasqueiraId = typeof req.query.churrasqueiraId === "string" ? req.query.churrasqueiraId : undefined;

  const where: any = { ...(churrasqueiraId ? { churrasqueiraId } : {}) };

  if (qData && /^\d{4}-\d{2}-\d{2}$/.test(qData)) {
    where.data = toUtc00(qData);
  }

  const isAdmin = ["ADMIN_MASTER","ADMIN_ATENDENTE","ADMIN_PROFESSORES"].includes(req.usuario.usuarioLogadoTipo);
  if (!isAdmin) {
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

// GET /churrasqueiras/agendamentos/:id  (dono ou admin)
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

// POST /churrasqueiras/agendamentos/cancelar/:id  (dono ou admin)
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
      const up = await prisma.agendamentoChurrasqueira.update({
        where: { id: req.params.id },
        data: { status: "CANCELADO", canceladoPorId: req.usuario.usuarioLogadoId },
      });
      return res.json({ message: "Agendamento cancelado com sucesso.", agendamento: up });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao cancelar agendamento de churrasqueira" });
    }
  }
);

// DELETE /churrasqueiras/agendamentos/:id  (dono ou admin)
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
      await prisma.agendamentoChurrasqueira.delete({ where: { id: req.params.id } });
      return res.json({ mensagem: "Agendamento deletado com sucesso" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ erro: "Erro ao deletar" });
    }
  }
);

export default router;
