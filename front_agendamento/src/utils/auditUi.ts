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

// Para manter compat com o que a página importa:
export type AuditItem = AuditLogItem;

// ===== Labels amigáveis para EVENTOS =====
const EVENT_LABEL: Record<string, string> = {
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
const TARGET_LABEL: Record<AuditTargetTypeUI, string> = {
  USUARIO: "Usuário",
  AGENDAMENTO: "Agendamento",
  AGENDAMENTO_PERMANENTE: "Agendamento permanente",
  AGENDAMENTO_CHURRASQUEIRA: "Churrasqueira (agendamento)",
  AGENDAMENTO_PERMANENTE_CHURRASQUEIRA: "Churrasqueira permanente",
  QUADRA: "Quadra/Bloqueio",
  OUTRO: "Outro",
};

// ===== Helpers de label =====
export function eventLabel(event: string): string {
  return EVENT_LABEL[event] ?? event.replaceAll("_", " ").toLowerCase();
}
export function targetTypeLabel(tt?: string | null): string {
  if (!tt) return "—";
  const key = tt as AuditTargetTypeUI;
  return TARGET_LABEL[key] ?? tt;
}

// ===== Helpers de exibição =====
export function actorDisplay(it: AuditItem): string {
  return (
    it.actorNameResolved ||
    it.actorName ||
    (it.actorId ? `Usuário ${it.actorId.slice(0, 6)}…` : "—")
  );
}

export function targetDisplay(it: AuditItem): string {
  if (it.targetType === "USUARIO") {
    return it.targetNameResolved ?? (it.targetId ? `Usuário ${it.targetId.slice(0, 6)}…` : "Usuário");
  }
  if (it.targetOwnerName) {
    return `${targetTypeLabel(it.targetType)} de ${it.targetOwnerName}`;
  }
  return it.targetId
    ? `${targetTypeLabel(it.targetType)} (${it.targetId.slice(0, 6)}…)`
    : targetTypeLabel(it.targetType);
}

export function ownerDisplay(it: AuditItem): string {
  return (
    it.targetOwnerName ||
    (it.metadata?.donoNome as string | undefined) ||
    (it.metadata?.donoId ? `Usuário ${String(it.metadata.donoId).slice(0, 6)}…` : "—")
  );
}

export function resumoHumano(it: AuditItem): string {
  const m = it.metadata || {};
  const partes: string[] = [];

  // campos comuns
  if (m.data && m.horario) partes.push(`${m.data} às ${m.horario}`);
  else if (m.data) partes.push(String(m.data));
  if (m.quadraNome || m.quadraNumero) {
    partes.push(`Quadra ${m.quadraNome ?? ""}${m.quadraNumero ? ` Nº ${m.quadraNumero}` : ""}`.trim());
  }
  if (m.esporteNome) partes.push(`${m.esporteNome}`);

  // transferências
  if (it.event.includes("TRANSFER") && m.novoUsuarioNome) {
    partes.push(`→ novo dono: ${m.novoUsuarioNome}`);
  }

  // exceção permanente
  if (it.event.includes("EXCECAO") && m.motivo) {
    partes.push(`Motivo: ${m.motivo}`);
  }

  // cancel/delete
  if (it.event.includes("CANCEL") || it.event.includes("DELETE")) {
    if (m.statusAntes && m.statusDepois) {
      partes.push(`(${m.statusAntes} → ${m.statusDepois})`);
    }
  }

  return partes.join(" · ") || "—";
}
