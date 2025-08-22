// utils/types/AdminItf.ts

import { ClienteItf } from "./ClienteItf";
import { TipoUsuario } from "./tipos";

export interface AdminItf extends ClienteItf {
  tipo: Exclude<TipoUsuario, "CLIENTE">;
}
