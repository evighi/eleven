import jwt from "jsonwebtoken";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router } from "express";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const router = Router();

router.post("/", async (req, res) => {
  const { email, senha } = req.body;

  const mensaPadrao = "Login ou senha incorretos";

  if (!email || !senha) {
    return res.status(400).json({ erro: mensaPadrao });
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { email },
    });

    if (!usuario) {
      return res.status(400).json({ erro: mensaPadrao });
    }

    if (usuario.tipo === TipoUsuario.CLIENTE && !usuario.verificado) {
      return res.status(403).json({
        erro: "E-mail não confirmado. Por favor, confirme seu e-mail antes de fazer login.",
      });
    }

    const senhaValida = bcrypt.compareSync(senha, usuario.senha);
    if (!senhaValida) {
      return res.status(400).json({ erro: mensaPadrao });
    }

    const token = jwt.sign(
      {
        usuarioLogadoId: usuario.id,
        usuarioLogadoNome: usuario.nome,
        usuarioLogadoTipo: usuario.tipo,
      },
      process.env.JWT_KEY as string,
      { expiresIn: "1h" }
    );

    // SETAR COOKIE HTTP ONLY COM O TOKEN
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600000, // 1 hora em ms
      sameSite: "strict",
    });

    // Envia dados do usuário sem o token no corpo da resposta
    return res.status(200).json({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tipo: usuario.tipo,
    });
  } catch (error) {
    return res.status(400).json({ erro: "Erro interno no servidor" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  res.json({ mensagem: "Logout realizado com sucesso" });
});


export default router;
