// utils/types/LoginResponseItf.ts

import { TipoUsuario } from "./tipos";

export interface LoginResponseItf {
  token: string;
  id: string;
  nome: string;
  email: string;
  tipo: TipoUsuario;
}
