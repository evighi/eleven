import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { z } from "zod";

const router = Router();
const prisma = new PrismaClient();

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const novaSenhaSchema = z.string().min(8, "A senha deve ter no mínimo 8 caracteres");

router.post("/esqueci-senha", async (req, res) => {
  const { email } = req.body;

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario) return res.status(404).json({ message: "Email não encontrado" });

  // Gera código de 6 dígitos
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();

  // Define expiração para 15 minutos
  const expiraEm = new Date(Date.now() + 15 * 60 * 1000);

  // Salva o código no banco
  await prisma.usuario.update({
    where: { email },
    data: {
      codigoRecuperacao: codigo,
      expiraEm,
    },
  });

  await transporter.sendMail({
    to: email,
    subject: "Código de recuperação de senha",
    html: `<p>Seu código de verificação é: <strong>${codigo}</strong></p><p>Ele é válido por 15 minutos.</p>`,
  });

  res.json({ message: "Código de recuperação enviado para o e-mail" });
});


router.post("/redefinir-senha-codigo", async (req, res) => {
  const { email, codigo, novaSenha, confirmarSenha } = req.body;

  if (novaSenha !== confirmarSenha) {
    return res.status(400).json({ message: "As senhas não coincidem" });
  }

  const valida = novaSenhaSchema.safeParse(novaSenha);
  if (!valida.success) {
    return res.status(400).json({ message: valida.error.errors.map(e => e.message).join("; ") });
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

  res.json({ message: "Senha redefinida com sucesso" });
});


export default router;
