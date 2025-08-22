import "express";

declare global {
  namespace Express {
    interface Request {
      usuario?: {
        usuarioLogadoId: string;
        usuarioLogadoNome: string;
        usuarioLogadoTipo: "CLIENTE" | "ADMIN_MASTER" | "ADMIN_ATENDENTE" | "ADMIN_PROFESSORES";
      };
    }
  }
}
