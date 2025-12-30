import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import { z } from "zod";
import { uploadToR2, deleteFromR2, r2PublicUrl } from "../src/lib/r2";

const prisma = new PrismaClient();
const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

const churrasqueiraSchema = z.object({
  nome: z.string().min(3),
  numero: z.coerce.number().int().positive(),
});

// GET /
router.get("/", async (_req, res) => {
  try {
    const churrasqueiras = await prisma.churrasqueira.findMany();
    res.json(churrasqueiras.map((c) => ({ ...c, imagem: r2PublicUrl(c.imagem) })));
  } catch {
    res.status(500).json({ erro: "Erro ao buscar churrasqueiras" });
  }
});

// POST
router.post("/", upload.single("imagem"), async (req, res) => {
  const { nome, observacao } = req.body;
  const numero = parseInt(req.body.numero, 10);

  const validacao = churrasqueiraSchema.safeParse({ nome, numero });
  if (!validacao.success) return res.status(400).json({ erro: validacao.error.errors });

  try {
    let imagemKey: string | null = null;
    if (req.file) {
      const up = await uploadToR2({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "churrasqueiras",
      });
      imagemKey = up.key;
    }

    const churrasqueira = await prisma.churrasqueira.create({
      data: { nome, numero, imagem: imagemKey, observacao: observacao || null },
    });

    res.status(201).json({ ...churrasqueira, imagem: r2PublicUrl(churrasqueira.imagem) });
  } catch (err) {
    console.error("Erro ao criar churrasqueira:", err);
    res.status(500).json({ erro: "Erro ao criar churrasqueira" });
  }
});


// ✅ TOTAL de churrasqueiras cadastradas (endpoint dedicado)
// GET /churrasqueiras/total
router.get("/total", async (_req, res) => {
  try {
    const total = await prisma.churrasqueira.count();
    return res.json({ total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro ao buscar total de churrasqueiras" });
  }
});

// PUT
router.put("/:id", upload.single("imagem"), async (req, res) => {
  const { id } = req.params;
  const { nome } = req.body;
  const numero = parseInt(req.body.numero, 10);

  const validacao = churrasqueiraSchema.safeParse({ nome, numero });
  if (!validacao.success) return res.status(400).json({ erro: validacao.error.errors });

  try {
    const atual = await prisma.churrasqueira.findUnique({ where: { id } });
    if (!atual) return res.status(404).json({ erro: "Churrasqueira não encontrada" });

    let novaKey = atual.imagem;
    if (req.file) {
      const up = await uploadToR2({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "churrasqueiras",
      });
      novaKey = up.key;
      if (atual.imagem) await deleteFromR2(atual.imagem);
    }

    const atualizada = await prisma.churrasqueira.update({
      where: { id },
      data: { nome, numero, imagem: novaKey },
    });

    res.json({ ...atualizada, imagem: r2PublicUrl(atualizada.imagem) });
  } catch {
    res.status(500).json({ erro: "Erro ao atualizar churrasqueira" });
  }
});


// GET /:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const churrasqueira = await prisma.churrasqueira.findUnique({ where: { id } });
    if (!churrasqueira) return res.status(404).json({ erro: "Churrasqueira não encontrada" });
    res.json({ ...churrasqueira, imagem: r2PublicUrl(churrasqueira.imagem) });
  } catch {
    res.status(500).json({ erro: "Erro ao buscar churrasqueira" });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const churrasqueira = await prisma.churrasqueira.findUnique({ where: { id } });
    if (!churrasqueira) return res.status(404).json({ erro: "Churrasqueira não encontrada" });

    if (churrasqueira.imagem) await deleteFromR2(churrasqueira.imagem);

    await prisma.churrasqueira.delete({ where: { id } });
    res.json({ mensagem: "Churrasqueira excluída com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao excluir churrasqueira" });
  }
});

export default router;
