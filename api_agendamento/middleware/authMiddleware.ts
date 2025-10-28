import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// (Opcional) use localmente se quiser reusar o tipo do token em validações
type TipoJWT =
  | "CLIENTE"
  | "CLIENTE_APOIADO"
  | "ADMIN_MASTER"
  | "ADMIN_ATENDENTE"
  | "ADMIN_PROFESSORES";

const verificarToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token =
      req.headers["authorization"]?.split(" ")[1] ||
      (req as any)?.cookies?.auth_token;

    if (!token) {
      return res.status(401).json({ erro: "Token não fornecido." });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_KEY as string);
    } catch {
      return res.status(401).json({ erro: "Token inválido ou expirado." });
    }

    // Anexa payload ao request (compatível com a tipagem global de Request)
    (req as any).usuario = decoded;

    // 🔎 Checa status atual do usuário no banco (bloqueio dinâmico)
    const user = await prisma.usuario.findUnique({
      where: { id: decoded.usuarioLogadoId },
      select: { id: true, disabledAt: true, deletedAt: true },
    });

    if (!user) {
      return res.status(401).json({ erro: "Usuário não encontrado." });
    }

    // ❌ Conta removida (soft delete efetivado)
    if (user.deletedAt) {
      return res.status(403).json({
        erro: "Conta removida.",
        code: "ACCOUNT_DELETED",
      });
    }

    // 🔒 Conta pendente de exclusão (sem acesso)
    if (user.disabledAt) {
      const pendencia = await prisma.userDeletionQueue.findUnique({
        where: { usuarioId: user.id },
        select: { status: true, eligibleAt: true },
      });

      return res.status(403).json({
        erro: "Conta pendente de exclusão.",
        code: "ACCOUNT_DISABLED",
        eligibleAt: pendencia?.eligibleAt ?? null,
        status: pendencia?.status ?? "PENDING",
      });
    }

    return next();
  } catch (e) {
    console.error("[auth] erro no middleware:", e);
    return res.status(500).json({ erro: "Erro de autenticação" });
  }
};

export default verificarToken;
