// utils/types/UsuarioLogadoItf.ts

import { TipoUsuario } from "./tipos";

export interface UsuarioLogadoItf {
  id: string;
  nome: string;
  email: string;
  tipo: TipoUsuario;
  token: string;
}
