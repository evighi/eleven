import { Request, Response, NextFunction } from "express";
import jwt, { VerifyErrors } from "jsonwebtoken";

interface JwtPayload {
  usuarioLogadoId: string;
  usuarioLogadoNome: string;
  usuarioLogadoTipo: "CLIENTE" | "ADMIN_MASTER" | "ADMIN_ATENDENTE" | "ADMIN_PROFESSORES";
}

interface CustomRequest extends Request {
  usuario?: JwtPayload;
}

const verificarToken = (req: CustomRequest, res: Response, next: NextFunction) => {
  const token = req.headers["authorization"]?.split(" ")[1] || req.cookies?.auth_token;

  if (!token) {
    return res.status(401).json({ erro: "Token não fornecido." });
  }

  jwt.verify(token, process.env.JWT_KEY as string, (err: VerifyErrors | null, decoded: any) => {
    if (err) {
      return res.status(401).json({ erro: "Token inválido ou expirado." });
    }

    req.usuario = decoded as JwtPayload;
    next();
  });
};

export default verificarToken;
