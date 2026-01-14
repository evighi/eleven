// routes/configEsportesHorarios.ts
import { Router } from "express";
import { PrismaClient, DiaSemana, TipoSessaoProfessor } from "@prisma/client";

import authMiddleware from "../middleware/authMiddleware";
import { requireAdmin } from "../middleware/acl";
import { denyAtendente } from "../middleware/atendenteFeatures";
import { logAudit, TargetType } from "../utils/audit";

const prisma = new PrismaClient();
const router = Router();

// 🔒 tudo aqui exige login + ser ADMIN
router.use(authMiddleware);
router.use(requireAdmin);

// ⛔ atendente NUNCA pode acessar configurações do sistema
router.use(denyAtendente());

/* ------------------------- Helpers ------------------------- */
function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
}
function compareHHMM(a: string, b: string) {
  return a.localeCompare(b);
}
function normalizeHHMM(v: string) {
  const [hh, mm] = v.split(":").map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function parseDiaSemana(v: any): DiaSemana | null {
  if (v === null || v === undefined || v === "") return null;
  const up = String(v).toUpperCase();
  return Object.values(DiaSemana).includes(up as DiaSemana) ? (up as DiaSemana) : null;
}
function parseTipoSessao(v: any): TipoSessaoProfessor {
  const up = String(v ?? "AULA").toUpperCase();
  return Object.values(TipoSessaoProfessor).includes(up as TipoSessaoProfessor)
    ? (up as TipoSessaoProfessor)
    : TipoSessaoProfessor.AULA;
}

/* ------------------------- Rotas --------------------------- */

// GET /config/esporte-horarios
router.get("/config/esporte-horarios", async (_req, res) => {
  try {
    const items = await prisma.esporteJanelaAula.findMany({
      include: { esporte: { select: { id: true, nome: true } } },
      orderBy: [{ createdAt: "asc" }],
    });

    res.json(
      items.map((i) => ({
        id: i.id,
        esporteId: i.esporteId,
        esporteNome: i.esporte?.nome ?? null,
        diaSemana: i.diaSemana,
        tipoSessao: i.tipoSessao,
        inicioHHMM: i.inicioHHMM,
        fimHHMM: i.fimHHMM,
        ativo: i.ativo,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Falha ao listar configurações." });
  }
});

// GET /config/esporte-horarios/:esporteId
router.get("/config/esporte-horarios/:esporteId", async (req, res) => {
  const { esporteId } = req.params as any;
  if (!esporteId) return res.status(400).json({ erro: "esporteId obrigatório." });

  try {
    const rows = await prisma.esporteJanelaAula.findMany({
      where: { esporteId },
      include: { esporte: { select: { id: true, nome: true } } },
      orderBy: [{ diaSemana: "asc" }, { tipoSessao: "asc" }, { inicioHHMM: "asc" }],
    });

    res.json(
      rows.map((r) => ({
        id: r.id,
        esporteId: r.esporteId,
        esporteNome: r.esporte?.nome ?? null,
        diaSemana: r.diaSemana,
        tipoSessao: r.tipoSessao,
        inicioHHMM: r.inicioHHMM,
        fimHHMM: r.fimHHMM,
        ativo: r.ativo,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Falha ao obter configurações do esporte." });
  }
});

// POST /config/esporte-horarios
router.post("/config/esporte-horarios", async (req, res) => {
  const { esporteId, inicioHHMM, fimHHMM } = req.body ?? {};
  let { diaSemana, tipoSessao, ativo } = req.body ?? {};

  if (!esporteId) return res.status(400).json({ erro: "esporteId obrigatório." });
  if (!isHHMM(inicioHHMM) || !isHHMM(fimHHMM)) {
    return res.status(400).json({ erro: "Horários devem estar no formato HH:MM." });
  }

  const ini = normalizeHHMM(inicioHHMM)!;
  const fim = normalizeHHMM(fimHHMM)!;
  if (compareHHMM(ini, fim) >= 0) {
    return res.status(400).json({ erro: "inicioHHMM deve ser menor que fimHHMM." });
  }

  const dia = parseDiaSemana(diaSemana);
  const tipo = parseTipoSessao(tipoSessao);
  const isPadrao = dia === null;
  ativo = Boolean(ativo ?? true);

  try {
    if (isPadrao) {
      const jaTemPadrao = await prisma.esporteJanelaAula.findFirst({
        where: { esporteId, tipoSessao: tipo, diaSemana: null },
        select: { id: true },
      });
      if (jaTemPadrao) {
        return res.status(409).json({
          erro: "Já existe uma regra padrão (diaSemana = null) para esse esporte e tipo de sessão.",
        });
      }
    }

    const created = await prisma.esporteJanelaAula.create({
      data: {
        esporteId,
        diaSemana: dia,
        tipoSessao: tipo,
        inicioHHMM: ini,
        fimHHMM: fim,
        ativo,
      },
    });

    try {
      await logAudit({
        req,
        event: "CONFIG_ESPORTE_HORARIOS_CREATE",
        target: { type: TargetType.SISTEMA, id: created.id },
        metadata: created,
      });
    } catch {}

    res.status(201).json(created);
  } catch (err: any) {
    console.error(err);
    if (String(err?.code) === "P2002") {
      return res.status(409).json({
        erro: "Config já existe para esse esporte/dia/tipo. Edite a existente ou remova antes.",
      });
    }
    res.status(500).json({ erro: "Falha ao criar configuração." });
  }
});

// PUT /config/esporte-horarios/:id
router.put("/config/esporte-horarios/:id", async (req, res) => {
  const { id } = req.params as any;
  if (!id) return res.status(400).json({ erro: "id obrigatório." });

  const { esporteId, diaSemana, tipoSessao, inicioHHMM, fimHHMM, ativo } = req.body ?? {};

  if (inicioHHMM && !isHHMM(inicioHHMM)) {
    return res.status(400).json({ erro: "inicioHHMM inválido." });
  }
  if (fimHHMM && !isHHMM(fimHHMM)) {
    return res.status(400).json({ erro: "fimHHMM inválido." });
  }

  const data: any = {};
  if (typeof esporteId === "string") data.esporteId = esporteId;

  if (diaSemana !== undefined) data.diaSemana = parseDiaSemana(diaSemana);
  if (tipoSessao !== undefined) data.tipoSessao = parseTipoSessao(tipoSessao);

  if (inicioHHMM) data.inicioHHMM = normalizeHHMM(inicioHHMM);
  if (fimHHMM) data.fimHHMM = normalizeHHMM(fimHHMM);

  if (data.inicioHHMM && data.fimHHMM) {
    if (compareHHMM(data.inicioHHMM, data.fimHHMM) >= 0) {
      return res.status(400).json({ erro: "inicioHHMM deve ser menor que fimHHMM." });
    }
  }

  if (ativo !== undefined) data.ativo = Boolean(ativo);

  try {
    const willBePadrao =
      (diaSemana !== undefined && parseDiaSemana(diaSemana) === null) ||
      (diaSemana === undefined &&
        (await prisma.esporteJanelaAula.findUnique({ where: { id } }))?.diaSemana === null);

    if (willBePadrao) {
      const current = await prisma.esporteJanelaAula.findUnique({ where: { id } });
      const esportId = data.esporteId ?? current?.esporteId;
      const tipo = data.tipoSessao ?? current?.tipoSessao ?? TipoSessaoProfessor.AULA;

      const existsAnother = await prisma.esporteJanelaAula.findFirst({
        where: {
          id: { not: id },
          esporteId: esportId!,
          tipoSessao: tipo,
          diaSemana: null,
        },
        select: { id: true },
      });

      if (existsAnother) {
        return res.status(409).json({
          erro: "Já existe uma regra padrão (diaSemana = null) para esse esporte e tipo de sessão.",
        });
      }
    }

    const upd = await prisma.esporteJanelaAula.update({
      where: { id },
      data,
    });

    try {
      await logAudit({
        req,
        event: "CONFIG_ESPORTE_HORARIOS_UPDATE",
        target: { type: TargetType.SISTEMA, id },
        metadata: data,
      });
    } catch {}

    res.json(upd);
  } catch (err: any) {
    console.error(err);
    if (String(err?.code) === "P2002") {
      return res.status(409).json({
        erro: "Conflito de unicidade: esporte/dia/tipo já existe. Ajuste a combinação.",
      });
    }
    if (String(err?.code) === "P2025") {
      return res.status(404).json({ erro: "Configuração não encontrada." });
    }
    res.status(500).json({ erro: "Falha ao atualizar configuração." });
  }
});

// DELETE /config/esporte-horarios/:id
router.delete("/config/esporte-horarios/:id", async (req, res) => {
  const { id } = req.params as any;
  if (!id) return res.status(400).json({ erro: "id obrigatório." });

  try {
    const del = await prisma.esporteJanelaAula.delete({ where: { id } });

    try {
      await logAudit({
        req,
        event: "CONFIG_ESPORTE_HORARIOS_DELETE",
        target: { type: TargetType.SISTEMA, id },
        metadata: del,
      });
    } catch {}

    res.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    if (String(err?.code) === "P2025") {
      return res.status(404).json({ erro: "Configuração não encontrada." });
    }
    res.status(500).json({ erro: "Falha ao remover configuração." });
  }
});

export default router;
