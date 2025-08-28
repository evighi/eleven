// src/routes/recuperacao.ts
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { z } from "zod";
import { enviarCodigoRecuperacao } from "../utils/enviarEmail"; // ⬅️ usa o helper novo

const router = Router();
const prisma = new PrismaClient();

const TTL_MIN = Number(process.env.RECUP_SENHA_TTL_MIN || 15);

const emailSchema = z.string().email("E-mail inválido");
const novaSenhaSchema = z
  .string()
  .min(8, "A senha deve ter no mínimo 8 caracteres");

// Gera código de 6 dígitos
function gerarCodigo(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post("/esqueci-senha", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      return res.status(400).json({ message: "E-mail inválido" });
    }

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario) {
      // mantém comportamento atual (404) para seu front
      return res.status(404).json({ message: "Email não encontrado" });
    }

    const codigo = gerarCodigo();
    const expiraEm = new Date(Date.now() + TTL_MIN * 60 * 1000);

    await prisma.usuario.update({
      where: { email },
      data: {
        codigoRecuperacao: codigo,
        expiraEm,
      },
    });

    await enviarCodigoRecuperacao(email, codigo, TTL_MIN);

    return res.json({
      message: "Código de recuperação enviado para o e-mail",
      ttlMin: TTL_MIN,
    });
  } catch (err) {
    console.error("[recuperacao][esqueci-senha] erro:", err);
    return res.status(500).json({ message: "Erro ao enviar e-mail de recuperação" });
  }
});

router.post("/redefinir-senha-codigo", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const codigo = String(req.body?.codigo || "").trim();
    const novaSenha = String(req.body?.novaSenha || "");
    const confirmarSenha = String(req.body?.confirmarSenha || "");

    if (novaSenha !== confirmarSenha) {
      return res.status(400).json({ message: "As senhas não coincidem" });
    }

    const valida = novaSenhaSchema.safeParse(novaSenha);
    if (!valida.success) {
      return res
        .status(400)
        .json({ message: valida.error.errors.map((e) => e.message).join("; ") });
    }

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || usuario.codigoRecuperacao !== codigo) {
      return res.status(400).json({ message: "Código inválido ou e-mail incorreto" });
    }

    if (usuario.expiraEm && usuario.expiraEm < new Date()) {
      return res.status(400).json({ message: "Código expirado" });
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);

    await prisma.usuario.update({
      where: { email },
      data: {
        senha: senhaHash,
        codigoRecuperacao: null,
        expiraEm: null,
      },
    });

    return res.json({ message: "Senha redefinida com sucesso" });
  } catch (err) {
    console.error("[recuperacao][redefinir-senha-codigo] erro:", err);
    return res.status(500).json({ message: "Erro ao redefinir senha" });
  }
});

export default router;
