import jwt from "jsonwebtoken";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { Router } from "express";
import bcrypt from "bcrypt";

// ➕ utilitários já existentes no projeto
import { enviarCodigoEmail } from "../utils/enviarEmail";
import { gerarCodigoVerificacao } from "../utils/gerarCodigo";

const prisma = new PrismaClient();
const router = Router();

const JWT_KEY = process.env.JWT_KEY as string;
const isProd = process.env.NODE_ENV === "production";

router.post("/", async (req, res) => {
  try {
    let { email, senha } = req.body as { email?: string; senha?: string };

    if (!email || !senha) {
      return res.status(400).json({ erro: "Informe e-mail e senha." });
    }

    email = email.trim().toLowerCase();

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

    if (!usuario) return res.status(404).json({ erro: "E-mail não cadastrado." });

    // 🔒 Auto-REENVIO se for CLIENTE e não verificado
    if (usuario.tipo === TipoUsuario.CLIENTE && !usuario.verificado) {
      try {
        const codigo = gerarCodigoVerificacao();
        const expira = new Date(Date.now() + 30 * 60 * 1000); // 30min

        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { codigoEmail: codigo, expiraEm: expira },
        });

        await enviarCodigoEmail(usuario.email, codigo);

        return res.status(403).json({
          erro: "E-mail não confirmado. Enviamos um novo código para o seu e-mail.",
          code: "EMAIL_NAO_CONFIRMADO",
          resent: true,
        });
      } catch (e) {
        console.error("Falha no auto-reenvio:", e);
        return res.status(403).json({
          erro:
            "E-mail não confirmado. Não foi possível reenviar o código agora, tente novamente.",
          code: "EMAIL_NAO_CONFIRMADO",
          resent: false,
        });
      }
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) return res.status(401).json({ erro: "Senha incorreta." });

    const token = jwt.sign(
      {
        usuarioLogadoId: usuario.id,
        usuarioLogadoNome: usuario.nome,
        usuarioLogadoTipo: usuario.tipo,
      },
      JWT_KEY,
      { expiresIn: "1h" }
    );

    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      maxAge: 60 * 60 * 1000,
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
