import jwt from "jsonwebtoken";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router } from "express";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const router = Router();

const JWT_KEY = process.env.JWT_KEY as string;
const isProd = process.env.NODE_ENV === "production";

// POST /login
router.post("/", async (req, res) => {
  try {
    let { email, senha } = req.body as { email?: string; senha?: string };

    if (!email || !senha) {
      return res.status(400).json({ erro: "Informe e-mail e senha." });
    }

    // normaliza e-mail para evitar confusão de caixa
    email = email.trim().toLowerCase();

    // busca apenas o necessário
    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: {
        id: true,
        nome: true,
        email: true,
        senha: true,
        tipo: true,
        verificado: true,
      },
    });

    if (!usuario) {
      // mensagem explícita
      return res.status(404).json({ erro: "E-mail não cadastrado." });
    }

    if (usuario.tipo === TipoUsuario.CLIENTE && !usuario.verificado) {
      return res.status(403).json({
        erro: "E-mail não confirmado. Verifique seu e-mail antes de entrar.",
      });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) {
      return res.status(401).json({ erro: "Senha incorreta." });
    }

    const token = jwt.sign(
      {
        usuarioLogadoId: usuario.id,
        usuarioLogadoNome: usuario.nome,
        usuarioLogadoTipo: usuario.tipo,
      },
      JWT_KEY,
      { expiresIn: "1h" }
    );

    // cookie httpOnly com o token
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict", // mude para "lax" se front e API estiverem em subdomínios diferentes
      maxAge: 60 * 60 * 1000, // 1h
      path: "/",
    });

    return res.status(200).json({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tipo: usuario.tipo,
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
  });
  return res.json({ mensagem: "Logout realizado com sucesso" });
});

export default router;
