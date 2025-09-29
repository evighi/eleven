// src/utils/auditUi.ts
// ❌ NUNCA importe "@prisma/client" no front

// ===== Tipos/Enums "espelho" para uso no FRONT =====
export type AuditTargetTypeUI =
  | "USUARIO"
  | "AGENDAMENTO"
  | "AGENDAMENTO_PERMANENTE"
  | "AGENDAMENTO_CHURRASQUEIRA"
  | "AGENDAMENTO_PERMANENTE_CHURRASQUEIRA"
  | "QUADRA"
  | "OUTRO";

// payload que vem do /audit/logs (com enrich já feito no backend)
export type AuditLogItem = {
  id: string;
  event: string;

  actorId: string | null;
  actorName: string | null;
  actorTipo: string | null;

  targetType: AuditTargetTypeUI | null;
  targetId: string | null;

  ip: string | null;
  userAgent: string | null;
  metadata: any;
  createdAt: string; // ISO

  // campos de enriquecimento que nossa rota já envia
  actorNameResolved?: string | null;
  targetNameResolved?: string | null;   // nome do alvo quando targetType=USUARIO
  targetOwnerId?: string | null;        // dono do alvo (quando aplicável)
  targetOwnerName?: string | null;      // nome do dono (quando aplicável)
};

// Alias para o que a página espera
export type AuditItem = AuditLogItem;

// ===== Labels amigáveis para EVENTOS =====
export const EVENT_LABEL: Record<string, string> = {
  // Autenticação
  LOGIN: "Login realizado",
  LOGIN_FAIL: "Falha no login",
  LOGOUT: "Logout",

  // Recuperação de senha
  PASSWORD_RESET_REQUEST: "Solicitou recuperação de senha",
  PASSWORD_RESET: "Senha redefinida",

  // Usuário
  USUARIO_CREATE: "Cadastro de usuário",
  USUARIO_UPDATE: "Atualização de usuário",

  // Agendamentos comuns
  AGENDAMENTO_CREATE: "Agendamento criado",
  AGENDAMENTO_CANCEL: "Agendamento cancelado",
  AGENDAMENTO_TRANSFER: "Agendamento transferido",
  AGENDAMENTO_DELETE: "Agendamento excluído",

  // Agendamentos permanentes (quadra)
  AGENDAMENTO_PERM_CREATE: "Agendamento permanente criado",
  AGENDAMENTO_PERM_CANCEL: "Agendamento permanente cancelado",
  AGENDAMENTO_PERM_TRANSFER: "Agendamento permanente transferido",
  AGENDAMENTO_PERM_EXCECAO: "Ocorrência do permanente cancelada",
  AGENDAMENTO_PERM_DELETE: "Agendamento permanente excluído",

  // Churrasqueira comum
  CHURRAS_CREATE: "Churrasqueira agendada",
  CHURRAS_CANCEL: "Churrasqueira cancelada",
  CHURRAS_TRANSFER: "Churrasqueira transferida",
  CHURRAS_DELETE: "Churrasqueira (agendamento) excluída",

  // Churrasqueira permanente
  CHURRAS_PERM_CREATE: "Churrasqueira permanente criada",
  CHURRAS_PERM_CANCEL: "Churrasqueira permanente cancelada",
  CHURRAS_PERM_EXCECAO: "Ocorrência do permanente (churrasqueira) cancelada",
  CHURRAS_PERM_DELETE: "Churrasqueira permanente excluída",

  // Bloqueios
  BLOQUEIO_CREATE: "Bloqueio de quadra criado",
  BLOQUEIO_DELETE: "Bloqueio de quadra removido",

  OTHER: "Ação registrada",
};

// ===== Labels para TARGET TYPE =====
export const TARGET_LABEL: Record<AuditTargetTypeUI, string> = {
  USUARIO: "Usuário",
  AGENDAMENTO: "Agendamento",
  AGENDAMENTO_PERMANENTE: "Agendamento permanente",
  AGENDAMENTO_CHURRASQUEIRA: "Churrasqueira (agendamento)",
  AGENDAMENTO_PERMANENTE_CHURRASQUEIRA: "Churrasqueira permanente",
  QUADRA: "Quadra/Bloqueio",
  OUTRO: "Outro",
};

// ===== Helpers base =====
export function labelForEvent(event: string): string {
  return EVENT_LABEL[event] ?? event.replaceAll("_", " ").toLowerCase();
}

export function labelForTargetType(tt?: string | null): string {
  if (!tt) return "—";
  const key = tt as AuditTargetTypeUI;
  return TARGET_LABEL[key] ?? tt;
}

// Ex.: formata um “alvo” amigável usando os campos enriquecidos
export function prettyTarget(it: AuditLogItem): string {
  if (it.targetType === "USUARIO") {
    return it.targetNameResolved ?? it.targetId ?? "Usuário";
  }
  // quando houver dono do alvo, mostramos “<Tipo> de <Nome do dono>”
  if (it.targetOwnerName) {
    return `${labelForTargetType(it.targetType)} de ${it.targetOwnerName}`;
  }
  return labelForTargetType(it.targetType);
}

// ===== Helpers com nomes esperados na página =====
// Quem fez (ator)
export function actorDisplay(it: AuditItem): string {
  return it.actorNameResolved || it.actorName || it.actorId || "—";
}

// Tipo do alvo (nome amigável)
export function targetTypeLabel(tt?: string | null): string {
  return labelForTargetType(tt);
}

// Alvo (com nome quando for usuário, ou “tipo de <dono>”)
export function targetDisplay(it: AuditItem): string {
  if (it.targetType === "USUARIO") {
    if (it.targetNameResolved && it.targetId) {
      return `${it.targetNameResolved} (${it.targetId})`;
    }
    return it.targetNameResolved || it.targetId || "Usuário";
  }
  if (it.targetOwnerName) {
    return `${labelForTargetType(it.targetType)} de ${it.targetOwnerName}`;
  }
  return it.targetId || labelForTargetType(it.targetType);
}

// Dono do alvo (quando aplicável)
export function ownerDisplay(it: AuditItem): string {
  if (it.targetOwnerName && it.targetOwnerId) {
    return `${it.targetOwnerName} (${it.targetOwnerId})`;
  }
  return it.targetOwnerName || it.targetOwnerId || "—";
}

// Rótulo do evento
export function eventLabel(ev: string): string {
  return labelForEvent(ev);
}

// Resumo curto
export function resumoHumano(it: AuditItem): string {
  const ev = eventLabel(it.event);
  const tgt = prettyTarget(it);
  return `${ev} • ${tgt}`;
}
