// routes/motivosBloqueio.ts
import { Router } from "express";
import { PrismaClient, AtendenteFeature } from "@prisma/client";
import { z } from "zod";

import verificarToken from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import {
  requireAtendenteFeature,
  denyAtendente,
} from "../middleware/atendenteFeatures";
import { logAudit, TargetType } from "../utils/audit";

const router = Router();
const prisma = new PrismaClient();

// 🔒 tudo aqui exige login + ser ADMIN
router.use(verificarToken);
router.use(requireAdmin);

/**
 * ✅ Regra que tu pediu:
 * - ATENDENTE pode APENAS LISTAR (GET), porque ele precisa enxergar os motivos pra usar no bloqueio.
 * - ATENDENTE NUNCA pode CRIAR/EDITAR/EXCLUIR, mesmo que o master habilite a feature.
 */

// Feature necessária para o ATENDENTE pelo menos conseguir listar (e usar nos bloqueios)
const FEATURE_BLOQUEIOS: AtendenteFeature = "ATD_BLOQUEIOS";

// ===== Schemas =====
const motivoBaseSchema = z.object({
  nome: z.string().min(2, "Nome muito curto").max(80, "Nome muito longo"),
  descricao: z.string().max(255).optional().nullable(),
  ativo: z.boolean().optional(),
});

const motivoCreateSchema = motivoBaseSchema;
const motivoUpdateSchema = motivoBaseSchema.partial();

const uuidSchema = z.string().uuid();

// ===== Rotas =====

// ✅ GET /motivos-bloquequeio?ativos=true|false
// ATENDENTE: permitido SOMENTE se tiver ATD_BLOQUEIOS
router.get("/", requireAtendenteFeature(FEATURE_BLOQUEIOS), async (req, res) => {
  try {
    const { ativos } = req.query;

    const where: any = {};
    if (ativos === "true") where.ativo = true;
    if (ativos === "false") where.ativo = false;

    const motivos = await prisma.motivoBloqueio.findMany({
      where,
      orderBy: { nome: "asc" },
    });

    return res.json(motivos);
  } catch (error) {
    console.error("Erro ao listar motivos de bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao listar motivos de bloqueio" });
  }
});

// ⛔ POST /motivos-bloqueio
// ATENDENTE: NUNCA pode (denyAtendente)
router.post("/", denyAtendente(), async (req, res) => {
  const parsed = motivoCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const { nome, descricao, ativo } = parsed.data;

  try {
    const criado = await prisma.motivoBloqueio.create({
      data: {
        nome: nome.trim(),
        descricao: descricao?.trim() || null,
        ativo: ativo ?? true,
      },
    });

    await logAudit({
      event: "MOTIVO_BLOQUEIO_CREATE",
      req,
      target: { type: TargetType.SISTEMA, id: criado.id },
      metadata: {
        motivoId: criado.id,
        nome: criado.nome,
        ativo: criado.ativo,
      },
    });

    return res
      .status(201)
      .json({ mensagem: "Motivo criado com sucesso", motivo: criado });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({ erro: "Já existe um motivo com este nome" });
    }

    console.error("Erro ao criar motivo de bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao criar motivo de bloqueio" });
  }
});

// ⛔ PUT /motivos-bloqueio/:id
// ATENDENTE: NUNCA pode (denyAtendente)
router.put("/:id", denyAtendente(), async (req, res) => {
  const { id } = req.params;

  if (!uuidSchema.safeParse(id).success) {
    return res.status(400).json({ erro: "ID inválido" });
  }

  const parsed = motivoUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ erro: "Dados inválidos", detalhes: parsed.error.errors });
  }

  const dataAtualizacao: any = {};
  if (parsed.data.nome !== undefined) dataAtualizacao.nome = parsed.data.nome.trim();
  if (parsed.data.descricao !== undefined)
    dataAtualizacao.descricao = parsed.data.descricao?.trim() || null;
  if (parsed.data.ativo !== undefined) dataAtualizacao.ativo = parsed.data.ativo;

  if (Object.keys(dataAtualizacao).length === 0) {
    return res.status(400).json({ erro: "Nenhum campo para atualizar" });
  }

  try {
    const atualizado = await prisma.motivoBloqueio.update({
      where: { id },
      data: dataAtualizacao,
    });

    await logAudit({
      event: "MOTIVO_BLOQUEIO_UPDATE",
      req,
      target: { type: TargetType.SISTEMA, id },
      metadata: {
        motivoId: id,
        ...dataAtualizacao,
      },
    });

    return res.json({
      mensagem: "Motivo atualizado com sucesso",
      motivo: atualizado,
    });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return res.status(404).json({ erro: "Motivo não encontrado" });
    }
    if (error?.code === "P2002") {
      return res.status(409).json({ erro: "Já existe um motivo com este nome" });
    }

    console.error("Erro ao atualizar motivo de bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao atualizar motivo de bloqueio" });
  }
});

// ⛔ DELETE /motivos-bloqueio/:id
// ATENDENTE: NUNCA pode (denyAtendente)
router.delete("/:id", denyAtendente(), async (req, res) => {
  const { id } = req.params;

  if (!uuidSchema.safeParse(id).success) {
    return res.status(400).json({ erro: "ID inválido" });
  }

  try {
    const emUso = await prisma.bloqueioQuadra.count({
      where: { motivoId: id },
    });

    if (emUso > 0) {
      return res.status(409).json({
        erro:
          "Este motivo já foi usado em bloqueios. Em vez de excluir, desative-o (ativo = false).",
      });
    }

    await prisma.motivoBloqueio.delete({ where: { id } });

    await logAudit({
      event: "MOTIVO_BLOQUEIO_DELETE",
      req,
      target: { type: TargetType.SISTEMA, id },
      metadata: { motivoId: id },
    });

    return res.json({ mensagem: "Motivo removido com sucesso" });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return res.status(404).json({ erro: "Motivo não encontrado" });
    }

    console.error("Erro ao remover motivo de bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao remover motivo de bloqueio" });
  }
});

export default router;
