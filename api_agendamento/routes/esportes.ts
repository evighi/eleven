import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import { z } from "zod";
import { uploadToR2, deleteFromR2, r2PublicUrl } from "../src/lib/r2";

const prisma = new PrismaClient();
const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

const esporteSchema = z.object({ nome: z.string().min(3) });

// GET todos
router.get("/", async (_req, res) => {
  try {
    const esportes = await prisma.esporte.findMany();
    // devolve URL pública
    res.json(esportes.map((e) => ({ ...e, imagem: r2PublicUrl(e.imagem) })));
  } catch {
    res.status(500).json({ erro: "Erro ao buscar esportes" });
  }
});

// POST
router.post("/", upload.single("imagem"), async (req, res) => {
  const { nome } = req.body;
  const validacao = esporteSchema.safeParse({ nome });
  if (!validacao.success) return res.status(400).json({ erro: validacao.error.errors });

  try {
    let imagemKey: string | null = null;
    if (req.file) {
      const up = await uploadToR2({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "esportes",
      });
      imagemKey = up.key;
    }

    const esporte = await prisma.esporte.create({ data: { nome, imagem: imagemKey } });
    res.status(201).json({ ...esporte, imagem: r2PublicUrl(esporte.imagem) });
  } catch {
    res.status(500).json({ erro: "Erro ao criar esporte" });
  }
});

// PUT
router.put("/:id", upload.single("imagem"), async (req, res) => {
  const { id } = req.params;
  const { nome } = req.body;
  const validacao = esporteSchema.safeParse({ nome });
  if (!validacao.success) return res.status(400).json({ erro: validacao.error.errors });

  try {
    const atual = await prisma.esporte.findUnique({ where: { id } });
    if (!atual) return res.status(404).json({ erro: "Esporte não encontrado" });

    let novaKey = atual.imagem;
    if (req.file) {
      const up = await uploadToR2({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "esportes",
      });
      novaKey = up.key;
      if (atual.imagem) await deleteFromR2(atual.imagem);
    }

    const esporteAtualizado = await prisma.esporte.update({
      where: { id },
      data: { nome, imagem: novaKey },
    });

    res.json({ ...esporteAtualizado, imagem: r2PublicUrl(esporteAtualizado.imagem) });
  } catch {
    res.status(500).json({ erro: "Erro ao atualizar esporte" });
  }
});

// GET por ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const esporte = await prisma.esporte.findUnique({ where: { id } });
    if (!esporte) return res.status(404).json({ erro: "Esporte não encontrado" });
    res.json({ ...esporte, imagem: r2PublicUrl(esporte.imagem) });
  } catch {
    res.status(500).json({ erro: "Erro ao buscar esporte" });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    // não exclui se houver quadras relacionadas (sua regra já faz isso, se quiser manter)
    const relacionamentos = await prisma.quadraEsporte.findMany({ where: { esporteId: id } });
    if (relacionamentos.length > 0) {
      return res.status(400).json({ erro: "Não é possível excluir este esporte. Há quadras associadas a ele." });
    }

    const esporte = await prisma.esporte.findUnique({ where: { id } });
    if (!esporte) return res.status(404).json({ erro: "Esporte não encontrado" });

    if (esporte.imagem) await deleteFromR2(esporte.imagem);

    await prisma.esporte.delete({ where: { id } });
    res.json({ mensagem: "Esporte excluído com sucesso" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao excluir esporte" });
  }
});

export default router;
