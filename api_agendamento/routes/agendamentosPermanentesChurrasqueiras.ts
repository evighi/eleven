import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";
import { requireAdmin, requireOwnerByRecord } from "../middleware/acl";

const prisma = new PrismaClient();
const router = Router();

// Helpers
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}

const schemaAgendamentoPermanenteChurrasqueira = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  turno: z.nativeEnum(Turno),
  churrasqueiraId: z.string().uuid(),
  usuarioId: z.string().uuid(),
  // Aceita "YYYY-MM-DD" e converte para 00:00Z; opcional
  dataInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => toUtc00(s))
    .optional(),
});

// 🔒 todas as rotas exigem autenticação
router.use(verificarToken);

/**
 * POST /churrasqueiras/permanentes
 * Criar agendamento permanente de churrasqueira
 * (recomendado: apenas ADMIN)
 */
router.post("/", requireAdmin, async (req, res) => {
  const validacao = schemaAgendamentoPermanenteChurrasqueira.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  const { diaSemana, turno, churrasqueiraId, usuarioId, dataInicio } = validacao.data;

  try {
    // Conflito: já existe permanente ativo para esse (churrasqueira, diaSemana, turno)
    const conflito = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
      where: {
        diaSemana,
        turno,
        churrasqueiraId,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: { id: true },
    });

    if (conflito) {
      return res.status(409).json({ erro: "Já existe um agendamento permanente nesse dia e turno" });
    }

    const novo = await prisma.agendamentoPermanenteChurrasqueira.create({
      data: {
        diaSemana,
        turno,
        churrasqueiraId,
        usuarioId,
        dataInicio: dataInicio ?? null,
      },
    });

    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
  }
});

/**
 * GET /churrasqueiras/permanentes
 * Listar agendamentos permanentes
 * - Admin: vê todos (pode filtrar por usuarioId/churrasqueiraId)
 * - Cliente: vê apenas os seus (usuarioId = do token)
 */
router.get("/", async (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

  const isAdmin = ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"].includes(
    req.usuario.usuarioLogadoTipo
  );

  const usuarioIdParam = typeof req.query.usuarioId === "string" ? req.query.usuarioId : undefined;
  const churrasqueiraId = typeof req.query.churrasqueiraId === "string" ? req.query.churrasqueiraId : undefined;

  const where: any = {
    ...(churrasqueiraId ? { churrasqueiraId } : {}),
  };

  if (isAdmin) {
    if (usuarioIdParam) where.usuarioId = usuarioIdParam;
  } else {
    where.usuarioId = req.usuario.usuarioLogadoId;
  }

  try {
    const lista = await prisma.agendamentoPermanenteChurrasqueira.findMany({
      where,
      include: {
        churrasqueira: { select: { id: true, nome: true, numero: true } },
        usuario: { select: { id: true, nome: true } },
      },
      orderBy: [{ diaSemana: "asc" }, { turno: "asc" }],
    });
    res.json(lista);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao listar" });
  }
});

/**
 * GET /churrasqueiras/permanentes/:id
 * Dono ou Admin
 */
router.get(
  "/:id",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;

    try {
      const agendamento = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        include: {
          usuario: { select: { id: true, nome: true, email: true } },
          churrasqueira: { select: { nome: true, numero: true } },
        },
      });

      if (!agendamento) {
        return res.status(404).json({ erro: "Agendamento permanente de churrasqueira não encontrado" });
      }

      res.json({
        id: agendamento.id,
        tipoReserva: "PERMANENTE",
        diaSemana: agendamento.diaSemana,
        turno: agendamento.turno,
        usuario: agendamento.usuario.nome,
        usuarioId: agendamento.usuario.id,
        churrasqueira: `${agendamento.churrasqueira.nome} (Nº ${agendamento.churrasqueira.numero})`,
        dataInicio: agendamento.dataInicio ?? null,
        status: agendamento.status,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: "Erro ao buscar agendamento permanente de churrasqueira" });
    }
  }
);

/**
 * POST /churrasqueiras/permanentes/cancelar/:id
 * Dono ou Admin
 */
router.post(
  "/cancelar/:id",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

    const { id } = req.params;

    try {
      const agendamento = await prisma.agendamentoPermanenteChurrasqueira.update({
        where: { id },
        data: {
          status: "CANCELADO",
          canceladoPorId: req.usuario.usuarioLogadoId,
        },
      });

      res.status(200).json({
        message: "Agendamento permanente de churrasqueira cancelado com sucesso.",
        agendamento,
      });
    } catch (error) {
      console.error("Erro ao cancelar agendamento permanente de churrasqueira:", error);
      res.status(500).json({ error: "Erro ao cancelar agendamento permanente de churrasqueira." });
    }
  }
);

/**
 * DELETE /churrasqueiras/permanentes/:id
 * Apenas Admin
 */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await prisma.agendamentoPermanenteChurrasqueira.delete({ where: { id: req.params.id } });
    res.json({ mensagem: "Agendamento permanente deletado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao deletar" });
  }
});

export default router;
