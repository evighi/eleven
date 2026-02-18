// routes/bloqueios.ts
import { Router } from "express";
import { PrismaClient, AtendenteFeature } from "@prisma/client";
import { z } from "zod";
import { startOfDay, endOfDay } from "date-fns";
import { notifyBloqueioCriado } from "../utils/notificacoes";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { requireAtendenteFeature } from "../middleware/atendenteFeatures";
import { logAudit, TargetType } from "../utils/audit";

const router = Router();
const prisma = new PrismaClient();

// 🔒 tudo aqui exige login + ser ADMIN
router.use(verificarToken);
router.use(requireAdmin);

// ✅ Feature que controla se ATENDENTE pode acessar bloqueios (GET/POST/PATCH/DELETE)
const FEATURE_BLOQUEIOS: AtendenteFeature = "ATD_BLOQUEIOS";
router.use(requireAtendenteFeature(FEATURE_BLOQUEIOS));

// helpers
const horaRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const bloqueioSchema = z.object({
  quadraIds: z.array(z.string().uuid()).nonempty("Selecione ao menos 1 quadra"),
  dataBloqueio: z.coerce.date(),
  inicioBloqueio: z.string().regex(horaRegex, "Hora inicial inválida (HH:MM)"),
  fimBloqueio: z.string().regex(horaRegex, "Hora final inválida (HH:MM)"),
  // 👇 motivoId opcional (palavra-chave cadastrada)
  motivoId: z.string().uuid().optional().nullable(),
});

// ✅ Schema de edição: tudo opcional
// - quadraIds pode vir [] (e aí bloqueamos com mensagem clara)
const editarBloqueioSchema = z.object({
  quadraIds: z.array(z.string().uuid()).optional(),
  dataBloqueio: z.coerce.date().optional(),
  inicioBloqueio: z.string().regex(horaRegex, "Hora inicial inválida (HH:MM)").optional(),
  fimBloqueio: z.string().regex(horaRegex, "Hora final inválida (HH:MM)").optional(),
  // 👇 pode mandar null para remover motivo
  motivoId: z.string().uuid().nullable().optional(),
});

// 👇 Helper igual ao que você usa em disponibilidadeGeral:
//    recebe "YYYY-MM-DD" e monta o range [início,fim) em UTC
function getUtcDayRange(dateStr: string) {
  const base = dateStr.slice(0, 10);
  const inicio = new Date(`${base}T00:00:00.000Z`);
  const fim = new Date(`${base}T00:00:00.000Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

function hhmmToMinutes(hhmm: string) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
}

// ✅ range UTC para um período (dias) inclusivo: [inicioDia, (fimDia+1) )
function getUtcDateRangeInclusive(dataInicioStr: string, dataFimStr: string) {
  const baseIni = dataInicioStr.slice(0, 10);
  const baseFim = dataFimStr.slice(0, 10);

  const inicio = new Date(`${baseIni}T00:00:00.000Z`);
  const fimExclusive = new Date(`${baseFim}T00:00:00.000Z`);
  fimExclusive.setUTCDate(fimExclusive.getUTCDate() + 1);

  return { inicio, fimExclusive };
}

router.post("/", async (req, res) => {
  const parsed = bloqueioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const {
    quadraIds,
    dataBloqueio,
    inicioBloqueio,
    fimBloqueio,
    motivoId,
  } = parsed.data;

  // valida janela de horário
  if (inicioBloqueio >= fimBloqueio) {
    return res
      .status(400)
      .json({ erro: "Hora inicial deve ser menor que a final" });
  }

  // id do usuário logado (não confiar no body)
  const bloqueadoPorId = req.usuario!.usuarioLogadoId;

  try {
    const dataInicio = startOfDay(dataBloqueio);
    const dataFim = endOfDay(dataBloqueio);

    // (opcional) garantir IDs únicos
    const uniqueQuadraIds = Array.from(new Set(quadraIds));

    // Verifica conflitos com agendamentos COMUNS confirmados
    for (const quadraId of uniqueQuadraIds) {
      const conflitoComum = await prisma.agendamento.findFirst({
        where: {
          quadraId,
          status: "CONFIRMADO",
          data: { gte: dataInicio, lte: dataFim },
          horario: { gte: inicioBloqueio, lt: fimBloqueio },
        },
        select: { id: true },
      });

      if (conflitoComum) {
        return res.status(409).json({
          erro: `Não é possível bloquear a quadra ${quadraId}: conflito com agendamento comum confirmado.`,
        });
      }

      // (Opcional) também considerar permanentes, caso queira
    }

    const bloqueioCriado = await prisma.bloqueioQuadra.create({
      data: {
        dataBloqueio,
        inicioBloqueio,
        fimBloqueio,
        bloqueadoPorId,
        motivoId: motivoId ?? null,
        quadras: { connect: uniqueQuadraIds.map((id) => ({ id })) },
      },
      include: {
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true, descricao: true } },
      },
    });

    // 📝 AUDIT: BLOQUEIO_CREATE
    await logAudit({
      event: "BLOQUEIO_CREATE",
      req,
      target: { type: TargetType.QUADRA, id: bloqueioCriado.id },
      metadata: {
        bloqueioId: bloqueioCriado.id,
        dataBloqueio: bloqueioCriado.dataBloqueio.toISOString().slice(0, 10),
        inicioBloqueio: bloqueioCriado.inicioBloqueio,
        fimBloqueio: bloqueioCriado.fimBloqueio,
        bloqueadoPorId,
        motivoId: bloqueioCriado.motivoId ?? null,
        motivoNome: bloqueioCriado.motivo?.nome ?? null,
        quadras: bloqueioCriado.quadras.map((q) => ({
          id: q.id,
          nome: q.nome,
          numero: q.numero,
        })),
      },
    });

    await notifyBloqueioCriado({
      actorId: bloqueadoPorId,
      bloqueio: {
        id: bloqueioCriado.id,
        dataBloqueio: bloqueioCriado.dataBloqueio,
        inicioBloqueio: bloqueioCriado.inicioBloqueio,
        fimBloqueio: bloqueioCriado.fimBloqueio,
        quadras: bloqueioCriado.quadras.map((q) => ({
          id: q.id,
          nome: q.nome,
          numero: q.numero,
        })),
        motivo: bloqueioCriado.motivo
          ? { id: bloqueioCriado.motivo.id, nome: bloqueioCriado.motivo.nome }
          : null,
      },
    });

    return res.status(201).json({
      mensagem: "Bloqueio criado com sucesso",
      bloqueio: bloqueioCriado,
    });
  } catch (error: any) {
    // Quadra inexistente -> P2025
    if (error?.code === "P2025") {
      return res
        .status(404)
        .json({ erro: "Uma ou mais quadras não foram encontradas" });
    }

    // FK de motivo inválido
    if (
      error?.code === "P2003" &&
      String(error?.meta?.field_name || "").includes("motivoId")
    ) {
      return res
        .status(400)
        .json({ erro: "Motivo de bloqueio inválido ou inexistente" });
    }

    console.error("Erro ao criar bloqueio:", error);
    return res
      .status(500)
      .json({ erro: "Erro interno ao tentar bloquear as quadras" });
  }
});

/**
 * ✅ PATCH /bloqueios/:id
 * Edita qualquer detalhe do bloqueio:
 * - quadras (set)
 * - data
 * - inicio/fim
 * - motivo (inclui remover -> null)
 *
 * Regras:
 * - não permite remover todas as quadras
 * - valida horário (inicio < fim)
 * - valida conflito com agendamentos comuns confirmados
 */
router.patch("/:id", async (req, res) => {
  const parsed = editarBloqueioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  // se body vazio, evita PATCH "sem nada"
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({
      erro: "Nenhum campo enviado para atualização. Envie ao menos um campo.",
    });
  }

  try {
    const atual = await prisma.bloqueioQuadra.findUnique({
      where: { id: req.params.id },
      include: {
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true } },
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
      },
    });

    if (!atual) {
      return res.status(404).json({ erro: "Bloqueio não encontrado" });
    }

    // -------------------------
    // 1) Monta estado FINAL (merge atual + body)
    // -------------------------
    const dataFinal = parsed.data.dataBloqueio ?? atual.dataBloqueio;
    const inicioFinal = parsed.data.inicioBloqueio ?? atual.inicioBloqueio;
    const fimFinal = parsed.data.fimBloqueio ?? atual.fimBloqueio;

    // motivoId: precisa respeitar null (remover motivo)
    const bodyTemMotivoId = Object.prototype.hasOwnProperty.call(parsed.data, "motivoId");
    const motivoFinal = bodyTemMotivoId ? parsed.data.motivoId : atual.motivoId;

    // quadras: se veio no body, substitui; senão mantém as atuais
    let quadraIdsFinal: string[] = atual.quadras.map((q) => q.id);

    if (Object.prototype.hasOwnProperty.call(parsed.data, "quadraIds")) {
      const recebido = parsed.data.quadraIds ?? [];
      const uniqueRecebido = Array.from(new Set(recebido));

      // ✅ regra que você pediu: não pode ficar sem quadras
      if (uniqueRecebido.length === 0) {
        return res.status(400).json({
          erro: "Não é possível atualizar o bloqueio: todas as quadras foram removidas. Selecione ao menos 1 quadra.",
        });
      }

      quadraIdsFinal = uniqueRecebido;
    }

    // -------------------------
    // 2) Valida janela de horário final
    // -------------------------
    if (inicioFinal >= fimFinal) {
      return res
        .status(400)
        .json({ erro: "Hora inicial deve ser menor que a final" });
    }

    // -------------------------
    // 3) Conflitos (agendamentos comuns CONFIRMADOS)
    // -------------------------
    const dataFinalYMD = dataFinal.toISOString().slice(0, 10);
    const { inicio: dataInicio, fim: dataFim } = getUtcDayRange(dataFinalYMD);

    for (const quadraId of quadraIdsFinal) {
      const conflitoComum = await prisma.agendamento.findFirst({
        where: {
          quadraId,
          status: "CONFIRMADO",
          data: { gte: dataInicio, lt: dataFim }, // ✅ [início, fim)
          horario: { gte: inicioFinal, lt: fimFinal },
        },
        select: { id: true },
      });

      if (conflitoComum) {
        return res.status(409).json({
          erro: `Não é possível atualizar o bloqueio: conflito com agendamento comum confirmado na quadra ${quadraId}.`,
        });
      }
    }

    // -------------------------
    // 4) Diferenças de quadras (pra audit)
    // -------------------------
    const quadrasAntesIds = new Set(atual.quadras.map((q) => q.id));
    const quadrasDepoisIds = new Set(quadraIdsFinal);

    const quadrasAdicionadas = quadraIdsFinal.filter((id) => !quadrasAntesIds.has(id));
    const quadrasRemovidas = atual.quadras.map((q) => q.id).filter((id) => !quadrasDepoisIds.has(id));

    // -------------------------
    // 5) Atualiza no banco (set nas quadras)
    // -------------------------
    const atualizado = await prisma.bloqueioQuadra.update({
      where: { id: req.params.id },
      data: {
        dataBloqueio: dataFinal,
        inicioBloqueio: inicioFinal,
        fimBloqueio: fimFinal,
        motivoId: motivoFinal ?? null,
        quadras: { set: quadraIdsFinal.map((id) => ({ id })) },
      },
      include: {
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true, descricao: true } },
      },
    });

    // 📝 AUDIT: BLOQUEIO_UPDATE (antes/depois + diffs)
    await logAudit({
      event: "BLOQUEIO_UPDATE",
      req,
      target: { type: TargetType.QUADRA, id: req.params.id },
      metadata: {
        bloqueioId: req.params.id,
        antes: {
          dataBloqueio: atual.dataBloqueio.toISOString().slice(0, 10),
          inicioBloqueio: atual.inicioBloqueio,
          fimBloqueio: atual.fimBloqueio,
          motivoId: atual.motivoId ?? null,
          motivoNome: atual.motivo?.nome ?? null,
          quadras: atual.quadras.map((q) => ({
            id: q.id,
            nome: q.nome,
            numero: q.numero,
          })),
        },
        depois: {
          dataBloqueio: atualizado.dataBloqueio.toISOString().slice(0, 10),
          inicioBloqueio: atualizado.inicioBloqueio,
          fimBloqueio: atualizado.fimBloqueio,
          motivoId: atualizado.motivoId ?? null,
          motivoNome: atualizado.motivo?.nome ?? null,
          quadras: atualizado.quadras.map((q) => ({
            id: q.id,
            nome: q.nome,
            numero: q.numero,
          })),
        },
        quadrasAdicionadas,
        quadrasRemovidas,
      },
    });

    return res.json({
      mensagem: "Bloqueio atualizado com sucesso",
      bloqueio: atualizado,
    });
  } catch (error: any) {
    // Bloqueio inexistente / IDs inválidos
    if (error?.code === "P2025") {
      return res.status(404).json({ erro: "Bloqueio não encontrado" });
    }

    // FK de motivo inválido
    if (
      error?.code === "P2003" &&
      String(error?.meta?.field_name || "").includes("motivoId")
    ) {
      return res
        .status(400)
        .json({ erro: "Motivo de bloqueio inválido ou inexistente" });
    }

    console.error("Erro ao atualizar bloqueio:", error);
    return res.status(500).json({ erro: "Erro interno ao atualizar bloqueio" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { motivoId, data } = req.query;

    const where: any = {};

    // 👇 filtro por motivo
    if (motivoId === "SEM_MOTIVO") {
      where.motivoId = null;
    } else if (typeof motivoId === "string" && motivoId.trim() !== "") {
      where.motivoId = motivoId;
    }

    // 👇 filtro por data (YYYY-MM-DD) usando range UTC [início, fim)
    if (typeof data === "string" && data.trim() !== "") {
      const dataStr = data.trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
        return res
          .status(400)
          .json({ erro: "Parâmetro 'data' inválido. Use o formato YYYY-MM-DD." });
      }

      const { inicio, fim } = getUtcDayRange(dataStr);
      where.dataBloqueio = {
        gte: inicio,
        lt: fim,
      };
    }

    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        bloqueadoPor: { select: { id: true, nome: true, email: true } },
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true, descricao: true } },
        motivoId: true,
      },
      orderBy: [
        { dataBloqueio: "desc" },
        { inicioBloqueio: "asc" },
        { createdAt: "desc" },
      ],
    });

    return res.json(bloqueios);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar bloqueios" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    // carrega antes para logar metadados
    const atual = await prisma.bloqueioQuadra.findUnique({
      where: { id: req.params.id },
      include: {
        quadras: { select: { id: true, nome: true, numero: true } },
        motivo: { select: { id: true, nome: true } },
      },
    });

    if (!atual) {
      return res.status(404).json({ erro: "Bloqueio não encontrado" });
    }

    await prisma.bloqueioQuadra.delete({ where: { id: req.params.id } });

    // 📝 AUDIT: BLOQUEIO_DELETE
    await logAudit({
      event: "BLOQUEIO_DELETE",
      req,
      target: { type: TargetType.QUADRA, id: req.params.id },
      metadata: {
        bloqueioId: req.params.id,
        dataBloqueio: atual.dataBloqueio.toISOString().slice(0, 10),
        inicioBloqueio: atual.inicioBloqueio,
        fimBloqueio: atual.fimBloqueio,
        motivoId: atual.motivoId ?? null,
        motivoNome: atual.motivo?.nome ?? null,
        quadras: atual.quadras.map((q) => ({
          id: q.id,
          nome: q.nome,
          numero: q.numero,
        })),
      },
    });

    return res.json({ mensagem: "Bloqueio removido com sucesso" });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return res.status(404).json({ erro: "Bloqueio não encontrado" });
    }
    console.error("Erro ao remover bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao remover bloqueio" });
  }
});

router.get("/relatorio-horas", async (req, res) => {
  try {
    const { dataInicio, dataFim, motivoId } = req.query;

    // validações básicas
    if (typeof dataInicio !== "string" || dataInicio.trim() === "") {
      return res.status(400).json({ erro: "Parâmetro 'dataInicio' é obrigatório (YYYY-MM-DD)." });
    }
    if (typeof dataFim !== "string" || dataFim.trim() === "") {
      return res.status(400).json({ erro: "Parâmetro 'dataFim' é obrigatório (YYYY-MM-DD)." });
    }
    if (typeof motivoId !== "string" || motivoId.trim() === "") {
      return res.status(400).json({ erro: "Parâmetro 'motivoId' é obrigatório (uuid)." });
    }

    const iniStr = dataInicio.trim();
    const fimStr = dataFim.trim();
    const motivoStr = motivoId.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(iniStr)) {
      return res.status(400).json({ erro: "Parâmetro 'dataInicio' inválido. Use YYYY-MM-DD." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fimStr)) {
      return res.status(400).json({ erro: "Parâmetro 'dataFim' inválido. Use YYYY-MM-DD." });
    }
    // valida uuid simples (como tu já usa zod em outros pontos)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(motivoStr)) {
      return res.status(400).json({ erro: "Parâmetro 'motivoId' inválido. Envie um uuid válido." });
    }

    // valida ordem do período
    if (iniStr > fimStr) {
      return res.status(400).json({ erro: "'dataInicio' não pode ser maior que 'dataFim'." });
    }

    const { inicio, fimExclusive } = getUtcDateRangeInclusive(iniStr, fimStr);

    // (opcional) garantir que motivo existe (pra não retornar tudo zerado por typo)
    const motivo = await prisma.motivoBloqueio.findUnique({
      where: { id: motivoStr },
      select: { id: true, nome: true, descricao: true, ativo: true },
    });

    if (!motivo) {
      return res.status(404).json({ erro: "Motivo de bloqueio não encontrado." });
    }

    // busca bloqueios do período + motivo
    const bloqueios = await prisma.bloqueioQuadra.findMany({
      where: {
        motivoId: motivoStr,
        dataBloqueio: { gte: inicio, lt: fimExclusive },
      },
      select: {
        id: true,
        dataBloqueio: true,
        inicioBloqueio: true,
        fimBloqueio: true,
        quadras: { select: { id: true, nome: true, numero: true } },
      },
      orderBy: [{ dataBloqueio: "asc" }, { inicioBloqueio: "asc" }],
    });

    // agrega por quadra
    const porQuadraMap = new Map<
      string,
      { quadraId: string; nome: string; numero: number; horas: number }
    >();

    let totalHoras = 0;

    for (const b of bloqueios) {
      const iniMin = hhmmToMinutes(b.inicioBloqueio);
      const fimMin = hhmmToMinutes(b.fimBloqueio);

      // por segurança (mesmo já validando no POST/PATCH)
      if (iniMin >= fimMin) continue;

      const duracaoHoras = (fimMin - iniMin) / 60;

      // soma pra cada quadra conectada
      for (const q of b.quadras) {
        totalHoras += duracaoHoras;

        const atual = porQuadraMap.get(q.id);
        if (atual) {
          atual.horas += duracaoHoras;
        } else {
          porQuadraMap.set(q.id, {
            quadraId: q.id,
            nome: q.nome,
            numero: q.numero,
            horas: duracaoHoras,
          });
        }
      }
    }

    const porQuadra = Array.from(porQuadraMap.values()).sort((a, b) => b.horas - a.horas);

    // arredondamento opcional (2 casas) pra ficar bonito no front
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return res.json({
      periodo: { dataInicio: iniStr, dataFim: fimStr },
      motivo: { id: motivo.id, nome: motivo.nome, descricao: motivo.descricao, ativo: motivo.ativo },
      totalHoras: round2(totalHoras),
      porQuadra: porQuadra.map((i) => ({ ...i, horas: round2(i.horas) })),
    });
  } catch (error) {
    console.error("Erro no relatório de bloqueios:", error);
    return res.status(500).json({ erro: "Erro interno ao gerar relatório de bloqueios" });
  }
});

export default router;
