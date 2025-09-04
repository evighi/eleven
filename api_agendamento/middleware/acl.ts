import { Request, Response, NextFunction } from "express";

type Tipo = "CLIENTE" | "ADMIN_MASTER" | "ADMIN_ATENDENTE" | "ADMIN_PROFESSORES";

export function isAdmin(tipo?: Tipo) {
  return (
    tipo === "ADMIN_MASTER" ||
    tipo === "ADMIN_ATENDENTE" ||
    tipo === "ADMIN_PROFESSORES"
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });
  const tipo = req.usuario.usuarioLogadoTipo;
  if (!isAdmin(tipo)) return res.status(403).json({ erro: "Sem permissão (admin)" });
  return next();
}

export function requireSelfOrAdminParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

    const alvoId = req.params[paramName];
    if (!alvoId) return res.status(400).json({ erro: "Parâmetro ausente" });

    const { usuarioLogadoId, usuarioLogadoTipo } = req.usuario;

    if (isAdmin(usuarioLogadoTipo) || usuarioLogadoId === alvoId) {
      return next();
    }
    return res.status(403).json({ erro: "Sem permissão (somente dono ou admin)" });
  };
}
