import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import multer from "multer";
import { uploadToR2, deleteFromR2, r2PublicUrl } from "../src/lib/r2"; // <— novo

const prisma = new PrismaClient();
const router = Router();

// multer em memória
const upload = multer({ storage: multer.memoryStorage() });

const quadraSchema = z.object({
  nome: z.string().min(3),
  numero: z.number().int().min(1),
  tipoCamera: z.enum(["COM_CAMERA", "SEM_CAMERA"]),
  esporteIds: z.array(z.string().uuid()).nonempty("Pelo menos um esporte deve ser selecionado."),
});

// GET /
router.get("/", async (req, res) => {
  const { esporteId } = req.query;

  try {
    const quadras = await prisma.quadra.findMany({
      where: esporteId
        ? { quadraEsportes: { some: { esporteId: esporteId as string } } }
        : undefined,
      include: { quadraEsportes: { include: { esporte: true } } },
    });

    const quadrasComEsportes = quadras.map((q) => ({
      id: q.id,
      nome: q.nome,
      numero: q.numero,
      tipoCamera: q.tipoCamera,
      // devolve URL pública (no banco fica a key)
      imagem: r2PublicUrl(q.imagem),
      esportes: q.quadraEsportes.map((qe) => ({
        id: qe.esporte.id,
        nome: qe.esporte.nome,
      })),
    }));

    res.json(quadrasComEsportes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar quadras" });
  }
});

// POST
router.post("/", upload.single("imagem"), async (req, res) => {
  const { nome, numero, tipoCamera } = req.body;

  // esporteIds pode vir string ou JSON
  let esporteIds: string[] = [];
  try {
    const parsed = JSON.parse(req.body.esporteIds);
    if (Array.isArray(parsed)) esporteIds = parsed;
  } catch {
    esporteIds = [req.body.esporteIds];
  }

  const numeroConvertido = parseInt(numero);
  const validacao = quadraSchema.safeParse({
    nome,
    numero: numeroConvertido,
    tipoCamera,
    esporteIds,
  });
  if (!validacao.success) {
    return res.status(400).json({ erro: validacao.error.errors });
  }

  try {
    let imagemKey: string | null = null;

    if (req.file) {
      const up = await uploadToR2({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "quadras",
      });
      imagemKey = up.key; // salva a key no banco
    }

    const quadra = await prisma.quadra.create({
      data: { nome, numero: numeroConvertido, tipoCamera, imagem: imagemKey },
    });

    await prisma.quadraEsporte.createMany({
      data: esporteIds.map((esporteId) => ({ quadraId: quadra.id, esporteId })),
    });

    const quadraComEsportes = await prisma.quadra.findUnique({
      where: { id: quadra.id },
      include: { quadraEsportes: { include: { esporte: true } } },
    });

    res.status(201).json({
      mensagem: "Quadra cadastrada com sucesso!",
      quadra: {
        ...quadraComEsportes,
        imagem: r2PublicUrl(quadraComEsportes?.imagem),
        esportes: quadraComEsportes?.quadraEsportes.map((qe) => qe.esporte),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar quadra" });
  }
});

// ✅ TOTAL de quadras cadastradas (endpoint dedicado)
// GET /quadras/total
router.get("/total", async (_req, res) => {
  try {
    const total = await prisma.quadra.count();
    return res.json({ total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro ao buscar total de quadras" });
  }
});


// GET /:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const quadra = await prisma.quadra.findUnique({
      where: { id },
      include: { quadraEsportes: { include: { esporte: true } } },
    });

    if (!quadra) return res.status(404).json({ erro: "Quadra não encontrada" });

    const resposta = {
      id: quadra.id,
      nome: quadra.nome,
      numero: quadra.numero,
      tipoCamera: quadra.tipoCamera,
      imagem: r2PublicUrl(quadra.imagem),
      esportes: quadra.quadraEsportes.map((qe) => ({
        id: qe.esporte.id,
        nome: qe.esporte.nome,
      })),
    };

    res.json(resposta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar quadra" });
  }
});

// PUT /:id
router.put("/:id", upload.single("imagem"), async (req, res) => {
  const { nome, numero, tipoCamera } = req.body;
  const { id } = req.params;

  // esporteIds deve ser JSON
  let esporteIds: string[] = [];
  try {
    esporteIds = JSON.parse(req.body.esporteIds);
    if (!Array.isArray(esporteIds) || !esporteIds.every((i) => typeof i === "string")) {
      throw new Error();
    }
  } catch {
    return res.status(400).json({ erro: "Formato inválido para esporteIds" });
  }

  const numeroConvertido = parseInt(numero);
  const validacao = quadraSchema.safeParse({
    nome,
    numero: numeroConvertido,
    tipoCamera,
    esporteIds,
  });
  if (!validacao.success) {
    return res.status(400).json({ erro: "Dados inválidos", detalhes: validacao.error.format() });
  }

  try {
    const atual = await prisma.quadra.findUnique({ where: { id } });
    if (!atual) return res.status(404).json({ erro: "Quadra não encontrada" });

    let novaKey = atual.imagem;

    if (req.file) {
      // sobe a nova
      const up = await uploadToR2({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "quadras",
      });
      novaKey = up.key;

      // apaga a antiga
      if (atual.imagem) await deleteFromR2(atual.imagem);
    }

    const quadraAtualizada = await prisma.quadra.update({
      where: { id },
      data: { nome, numero: numeroConvertido, tipoCamera, imagem: novaKey },
    });

    await prisma.quadraEsporte.deleteMany({ where: { quadraId: id } });
    await prisma.quadraEsporte.createMany({
      data: esporteIds.map((esporteId) => ({ quadraId: id, esporteId })),
    });

    res.json({
      mensagem: "Quadra atualizada com sucesso",
      quadra: { ...quadraAtualizada, imagem: r2PublicUrl(quadraAtualizada.imagem) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar quadra" });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const quadra = await prisma.quadra.findUnique({ where: { id } });
    if (!quadra) return res.status(404).json({ erro: "Quadra não encontrada" });

    if (quadra.imagem) await deleteFromR2(quadra.imagem);

    await prisma.quadraEsporte.deleteMany({ where: { quadraId: id } });
    await prisma.quadra.delete({ where: { id } });

    res.json({ mensagem: "Quadra excluída com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao excluir quadra" });
  }
});

export default router;
