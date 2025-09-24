import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { addDays, addMonths, startOfDay } from "date-fns";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin, requireOwnerByRecord } from "../middleware/acl";
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

// Helpers
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}
function toISODateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

/** Cria um usuário mínimo (tipo CLIENTE) a partir de um nome de convidado */
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

const schemaAgendamentoPermanenteChurrasqueira = z.object({
  diaSemana: z.nativeEnum(DiaSemana),
  turno: z.nativeEnum(Turno),
  churrasqueiraId: z.string().uuid(),
  // Admin pode escolher um usuário existente…
  usuarioId: z.string().uuid().optional(),
  // …ou informar um convidado (pega o primeiro nome e cria “usuário convidado”)
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
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
 * Criar agendamento permanente de churrasqueira (ADMIN)
 */
router.post("/", requireAdmin, async (req, res) => {
  const validacao = schemaAgendamentoPermanenteChurrasqueira.safeParse(req.body);
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  const {
    diaSemana,
    turno,
    churrasqueiraId,
    usuarioId: usuarioIdBody,
    convidadosNomes = [],
    dataInicio,
  } = validacao.data;

  try {
    // 0) churrasqueira existe?
    const exists = await prisma.churrasqueira.findUnique({
      where: { id: churrasqueiraId },
      select: { id: true, nome: true, numero: true },
    });
    if (!exists) {
      return res.status(404).json({ erro: "Churrasqueira não encontrada." });
    }

    // (1) Conflito: já existe PERMANENTE ativo para (churrasqueira, diaSemana, turno)
    const conflitoPermanente = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
      where: {
        diaSemana,
        turno,
        churrasqueiraId,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: { id: true },
    });
    if (conflitoPermanente) {
      return res
        .status(409)
        .json({ erro: "Já existe um agendamento permanente nesse dia e turno." });
    }

    // (2) Conflito com COMUM existente no mesmo dia-da-semana e turno
    // Regra igual à de quadras: se há comum, exigimos 'dataInicio' (para começar depois)
    const comuns = await prisma.agendamentoChurrasqueira.findMany({
      where: {
        churrasqueiraId,
        turno,
        status: "CONFIRMADO",
      },
      select: { data: true },
    });
    const targetIdx = DIA_IDX[diaSemana];
    const possuiConflitoComum = comuns.some((c) => new Date(c.data).getUTCDay() === targetIdx);
    if (possuiConflitoComum && !dataInicio) {
      return res.status(409).json({
        erro:
          "Conflito com agendamento comum existente nesse dia da semana e turno. Informe uma dataInicio.",
      });
    }

    // 🔑 Resolve DONO (admin obrigatório nesta rota):
    let donoId = usuarioIdBody || "";
    if (!donoId && convidadosNomes.length > 0) {
      const convidado = await criarConvidadoComoUsuario(convidadosNomes[0]);
      donoId = convidado.id;
    }
    if (!donoId) {
      return res.status(400).json({
        erro: "Informe um usuário dono (usuarioId) ou um convidado em convidadosNomes.",
      });
    }

    const novo = await prisma.agendamentoPermanenteChurrasqueira.create({
      data: {
        diaSemana,
        turno,
        churrasqueiraId,
        usuarioId: donoId,
        dataInicio: dataInicio ?? null,
      },
    });

    // 📜 AUDIT: criação
    await logAudit({
      event: "CHURRAS_PERM_CREATE",
      req,
      target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id: novo.id },
      metadata: {
        permanenteId: novo.id,
        churrasqueiraId,
        diaSemana,
        turno,
        donoId,
        dataInicio: novo.dataInicio ? toISODateUTC(new Date(novo.dataInicio)) : null,
      },
    });

    return res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao criar agendamento permanente" });
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

  const usuarioIdParam =
    typeof req.query.usuarioId === "string" ? req.query.usuarioId : undefined;
  const churrasqueiraId =
    typeof req.query.churrasqueiraId === "string"
      ? req.query.churrasqueiraId
      : undefined;

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
    return res.json(lista);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao listar" });
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
        return res
          .status(404)
          .json({ erro: "Agendamento permanente de churrasqueira não encontrado" });
      }

      return res.json({
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
      return res
        .status(500)
        .json({ erro: "Erro ao buscar agendamento permanente de churrasqueira" });
    }
  }
);

/**
 * ✅ NOVO — GET /churrasqueiras/permanentes/:id/datas-excecao
 * Lista datas elegíveis para registrar exceção (um dia cancelado).
 */
router.get(
  "/:id/datas-excecao",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;
    const meses = Number(req.query.meses ?? "1");
    const clampMeses = Number.isFinite(meses) && meses > 0 && meses <= 6 ? meses : 1;

    try {
      const perm = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: { id: true, diaSemana: true, dataInicio: true, status: true },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const hoje = startOfDay(new Date());
      const base = perm.dataInicio ? startOfDay(new Date(perm.dataInicio)) : hoje;
      const inicioJanela = base > hoje ? base : hoje;
      const fimJanela = startOfDay(addMonths(inicioJanela, clampMeses));

      const targetIdx = DIA_IDX[perm.diaSemana as DiaSemana];
      const curIdx = inicioJanela.getDay();
      const delta = (targetIdx - curIdx + 7) % 7;
      let d = addDays(inicioJanela, delta);

      const todas: string[] = [];
      while (d < fimJanela) {
        if (!perm.dataInicio || d >= startOfDay(new Date(perm.dataInicio))) {
          todas.push(toISODateUTC(d));
        }
        d = addDays(d, 7);
      }

      const jaCanceladas = await prisma.agendamentoPermanenteChurrasqueiraCancelamento.findMany({
        where: { agendamentoPermanenteChurrasqueiraId: id, data: { gte: inicioJanela, lt: fimJanela } },
        select: { data: true },
      });
      const jaCanceladasSet = new Set(jaCanceladas.map((c) => toISODateUTC(new Date(c.data))));
      const elegiveis = todas.filter((iso) => !jaCanceladasSet.has(iso));

      return res.json({
        permanenteId: perm.id,
        inicioJanela: toISODateUTC(inicioJanela),
        fimJanela: toISODateUTC(fimJanela),
        diaSemana: perm.diaSemana,
        turno: undefined,
        datas: elegiveis,
        jaCanceladas: Array.from(jaCanceladasSet),
      });
    } catch (e) {
      console.error("Erro em GET /:id/datas-excecao", e);
      return res.status(500).json({ erro: "Erro ao listar datas para exceção" });
    }
  }
);

/**
 * ✅ NOVO — POST /churrasqueiras/permanentes/:id/cancelar-dia
 * Registra uma exceção para UMA data específica da recorrência.
 */
router.post(
  "/:id/cancelar-dia",
  requireOwnerByRecord(async (req) => {
    const r = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id: req.params.id },
      select: { usuarioId: true },
    });
    return r?.usuarioId ?? null;
  }),
  async (req, res) => {
    const { id } = req.params;

    const schema = z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // "YYYY-MM-DD"
      motivo: z.string().trim().max(200).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });

    const { data: iso, motivo } = parsed.data;

    try {
      const perm = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: { id: true, usuarioId: true, diaSemana: true, dataInicio: true, status: true, churrasqueiraId: true, turno: true },
      });
      if (!perm) return res.status(404).json({ erro: "Agendamento permanente não encontrado" });
      if (["CANCELADO", "TRANSFERIDO"].includes(perm.status)) {
        return res.status(400).json({ erro: "Agendamento permanente não está ativo." });
      }

      const dataUTC = toUtc00(iso);

      // data >= dataInicio (se existir)
      if (perm.dataInicio && startOfDay(dataUTC) < startOfDay(new Date(perm.dataInicio))) {
        return res.status(400).json({ erro: "Data anterior ao início do agendamento permanente." });
      }

      // dia da semana confere
      const idx = dataUTC.getUTCDay();
      if (idx !== DIA_IDX[perm.diaSemana as DiaSemana]) {
        return res.status(400).json({ erro: "Data não corresponde ao dia da semana do permanente." });
      }

      // evitar duplicidade
      const jaExiste = await prisma.agendamentoPermanenteChurrasqueiraCancelamento.findFirst({
        where: { agendamentoPermanenteChurrasqueiraId: id, data: dataUTC },
        select: { id: true },
      });
      if (jaExiste) {
        return res.status(409).json({ erro: "Esta data já está marcada como exceção para este permanente." });
      }

      const novo = await prisma.agendamentoPermanenteChurrasqueiraCancelamento.create({
        data: {
          agendamentoPermanenteChurrasqueiraId: id,
          data: dataUTC,
          motivo: motivo ?? null,
          criadoPorId: req.usuario!.usuarioLogadoId, // ⚠️ do token
        },
      });

      // 📜 AUDIT: exceção (um dia)
      await logAudit({
        event: "CHURRAS_PERM_EXCECAO",
        req,
        target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id },
        metadata: {
          permanenteId: id,
          churrasqueiraId: perm.churrasqueiraId,
          diaSemana: perm.diaSemana,
          turno: perm.turno,
          dataExcecao: iso,
          motivo: motivo ?? null,
          criadoPorId: req.usuario!.usuarioLogadoId,
          cancelamentoId: novo.id,
        },
      });

      return res.status(201).json({
        id: novo.id,
        agendamentoPermanenteChurrasqueiraId: id,
        data: toISODateUTC(new Date(novo.data)),
        motivo: novo.motivo ?? null,
        criadoPorId: novo.criadoPorId,
      });
    } catch (e) {
      console.error("Erro em POST /:id/cancelar-dia", e);
      return res.status(500).json({ erro: "Erro ao registrar exceção do permanente" });
    }
  }
);

/**
 * POST /churrasqueiras/permanentes/cancelar/:id
 * Dono ou Admin — encerra a recorrência
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
      const antes = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
        where: { id },
        select: { status: true, churrasqueiraId: true, diaSemana: true, turno: true, usuarioId: true },
      });

      const agendamento = await prisma.agendamentoPermanenteChurrasqueira.update({
        where: { id },
        data: {
          status: "CANCELADO",
          canceladoPorId: req.usuario.usuarioLogadoId,
        },
      });

      // 📜 AUDIT: cancelar definitivo
      await logAudit({
        event: "CHURRAS_PERM_CANCEL",
        req,
        target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id },
        metadata: {
          permanenteId: id,
          churrasqueiraId: antes?.churrasqueiraId ?? null,
          diaSemana: antes?.diaSemana ?? null,
          turno: antes?.turno ?? null,
          statusAntes: antes?.status ?? null,
          statusDepois: "CANCELADO",
          canceladoPorId: req.usuario.usuarioLogadoId,
          donoId: antes?.usuarioId ?? null,
        },
      });

      return res.status(200).json({
        message: "Agendamento permanente de churrasqueira cancelado com sucesso.",
        agendamento,
      });
    } catch (error) {
      console.error("Erro ao cancelar agendamento permanente de churrasqueira:", error);
      return res
        .status(500)
        .json({ error: "Erro ao cancelar agendamento permanente de churrasqueira." });
    }
  }
);

/**
 * DELETE /churrasqueiras/permanentes/:id
 * Apenas Admin
 */
router.delete("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const antes = await prisma.agendamentoPermanenteChurrasqueira.findUnique({
      where: { id },
      select: { churrasqueiraId: true, diaSemana: true, turno: true, usuarioId: true, status: true },
    });

    await prisma.agendamentoPermanenteChurrasqueira.delete({
      where: { id },
    });

    // 📜 AUDIT: delete
    await logAudit({
      event: "CHURRAS_PERM_DELETE",
      req,
      target: { type: TargetType.AGENDAMENTO_PERMANENTE_CHURRASQUEIRA, id },
      metadata: {
        permanenteId: id,
        churrasqueiraId: antes?.churrasqueiraId ?? null,
        diaSemana: antes?.diaSemana ?? null,
        turno: antes?.turno ?? null,
        statusAntes: antes?.status ?? null,
        donoId: antes?.usuarioId ?? null,
      },
    });

    return res.json({ mensagem: "Agendamento permanente deletado com sucesso" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao deletar" });
  }
});

export default router;
