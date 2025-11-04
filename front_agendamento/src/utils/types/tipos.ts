// utils/types/tipos.ts
// utils/types/tipos.ts

export type TipoUsuario =
  | "CLIENTE"
  | "CLIENTE_APOIADO"
  | "ADMIN_MASTER"
  | "ADMIN_ATENDENTE"
  | "ADMIN_PROFESSORES";


// src/types.ts
export type UUID = string;

export type StatusAgendamento =
  | "CONFIRMADO"
  | "FINALIZADO"
  | "CANCELADO"
  | "TRANSFERIDO";

export interface Usuario {
  id: UUID;
  nome: string;
  email: string;
  avatarUrl?: string | null;
}

export interface Esporte {
  id: UUID;
  nome: string;
  imagem?: string | null;
}

export interface Quadra {
  id: UUID;
  nome: string;
  numero: number;
  imagem?: string | null;
  esporteIds?: UUID[];
}

export interface Churrasqueira {
  id: UUID;
  nome: string;
  numero: number;
  imagem?: string | null;
}

export interface Agendamento {
  id: UUID;
  data?: string;                 // ISO (yyyy-mm-dd) quando existir
  horario: string;               // "18:00" etc.
  usuario?: Pick<Usuario, "id" | "nome" | "email">;
  jogadores?: Pick<Usuario, "id" | "nome" | "email">[];
  quadra?: Pick<Quadra, "id" | "nome" | "numero">;
  esporte?: Pick<Esporte, "id" | "nome">;
  status?: StatusAgendamento;
  tipoReserva?: "COMUM" | "PERMANENTE";
}

export interface BloqueioQuadra {
  id: UUID;
  quadraId: UUID;
  inicio: string;  // ISO datetime
  fim: string;     // ISO datetime
  motivo?: string | null;
}
