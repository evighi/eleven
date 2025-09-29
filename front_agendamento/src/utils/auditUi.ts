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

// ===== Helpers gerais =====
export function eventLabel(event: string): string {
  return EVENT_LABEL[event] ?? event.replaceAll("_", " ").toLowerCase();
}
export function targetTypeLabel(tt?: string | null): string {
  if (!tt) return "—";
  const key = tt as AuditTargetTypeUI;
  return TARGET_LABEL[key] ?? tt;
}

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
  const [titulo] = fullSentence(it);
  return titulo;
}

// ===== Formatação rica para “leigos”: título + bullets =====

function fmtDataHoraSP(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return new Date(iso).toLocaleString("pt-BR");
  }
}
function strQuadra(m: any) {
  if (!m) return undefined;
  if (m.quadraNome && m.quadraNumero) return `${m.quadraNome} (Nº ${m.quadraNumero})`;
  if (m.quadraNome) return m.quadraNome;
  if (m.quadraNumero) return `Quadra Nº ${m.quadraNumero}`;
  return undefined;
}
function strUsuarioNomeOuId(nome?: string | null, id?: string | null) {
  return nome || (id ? `Usuário ${String(id).slice(0, 6)}…` : undefined);
}

/** Retorna: [título em PT-BR simples, bullets[]] */
export function fullSentence(it: AuditItem): [string, string[]] {
  const m = it.metadata || {};
  const actor = actorDisplay(it);
  const quando = fmtDataHoraSP(it.createdAt);
  const quadra = strQuadra(m);
  const esporte = m.esporteNome ? String(m.esporteNome) : undefined;
  const dataHorario =
    m.data && m.horario ? `${m.data} às ${m.horario}` : m.data ? String(m.data) : undefined;

  const bullets: string[] = [];
  if (dataHorario) bullets.push(`Dia e hora do jogo: ${dataHorario}`);
  if (quadra) bullets.push(`Quadra: ${quadra}`);
  if (esporte) bullets.push(`Esporte: ${esporte}`);
  if (m.motivo) bullets.push(`Motivo: ${m.motivo}`);
  if (m.statusAntes && m.statusDepois) bullets.push(`Status: ${m.statusAntes} → ${m.statusDepois}`);
  if (it.ip) bullets.push(`IP: ${it.ip}`);
  if (it.userAgent) bullets.push(`Navegador: ${it.userAgent}`);

  const donoAnterior = strUsuarioNomeOuId(
    m.fromOwnerNome || it.targetOwnerName || m.donoNome,
    m.fromOwnerId || it.targetOwnerId || m.donoId
  );
  const donoNovo = strUsuarioNomeOuId(m.novoUsuarioNome || m.toOwnerNome, m.novoUsuarioId || m.toOwnerId);

  // Construção por tipo de evento
  switch (it.event) {
    case "AGENDAMENTO_CREATE":
    case "CHURRAS_CREATE":
      return [
        `${actor} fez um novo agendamento${esporte ? ` de ${esporte}` : ""}${quadra ? ` na ${quadra}` : ""}${dataHorario ? ` para ${dataHorario}` : ""}.`,
        [`Quem fez: ${actor}`, ...bullets],
      ];

    case "AGENDAMENTO_CANCEL":
    case "CHURRAS_CANCEL":
      return [
        `${actor} cancelou um agendamento${quadra ? ` na ${quadra}` : ""}${dataHorario ? ` de ${dataHorario}` : ""}.`,
        [`Quem cancelou: ${actor}`, ...bullets],
      ];

    case "AGENDAMENTO_TRANSFER":
    case "CHURRAS_TRANSFER": {
      const toQuem = donoNovo ? ` para ${donoNovo}` : "";
      const deQuem = donoAnterior ? ` que era de ${donoAnterior}` : "";
      return [
        `${actor} transferiu um agendamento${deQuem}${toQuem}${quadra ? ` na ${quadra}` : ""}${dataHorario ? ` em ${dataHorario}` : ""}.`,
        [`Quem transferiu: ${actor}`, ...(donoNovo ? [`Novo dono: ${donoNovo}`] : []), ...(donoAnterior ? [`Dono anterior: ${donoAnterior}`] : []), ...bullets],
      ];
    }

    case "AGENDAMENTO_DELETE":
    case "CHURRAS_DELETE":
      return [
        `${actor} excluiu um agendamento${quadra ? ` na ${quadra}` : ""}${dataHorario ? ` de ${dataHorario}` : ""}.`,
        [`Quem excluiu: ${actor}`, ...bullets],
      ];

    case "AGENDAMENTO_PERM_CREATE":
      return [
        `${actor} criou um agendamento permanente${esporte ? ` de ${esporte}` : ""}${quadra ? ` na ${quadra}` : ""}${dataHorario ? ` (mesmo dia/horário: ${dataHorario})` : ""}.`,
        [`Quem criou: ${actor}`, ...bullets],
      ];

    case "AGENDAMENTO_PERM_CANCEL":
      return [
        `${actor} cancelou um agendamento permanente${quadra ? ` na ${quadra}` : ""}.`,
        [`Quem cancelou: ${actor}`, ...bullets],
      ];

    case "AGENDAMENTO_PERM_TRANSFER": {
      const toQuem = donoNovo ? ` para ${donoNovo}` : "";
      const deQuem = donoAnterior ? ` que era de ${donoAnterior}` : "";
      return [
        `${actor} transferiu um agendamento permanente${deQuem}${toQuem}${quadra ? ` na ${quadra}` : ""}.`,
        [`Quem transferiu: ${actor}`, ...(donoNovo ? [`Novo dono: ${donoNovo}`] : []), ...(donoAnterior ? [`Dono anterior: ${donoAnterior}`] : []), ...bullets],
      ];
    }

    case "AGENDAMENTO_PERM_EXCECAO":
      return [
        `${actor} cancelou **apenas uma data** de um agendamento permanente${quadra ? ` na ${quadra}` : ""}${dataHorario ? ` (${dataHorario})` : ""}.`,
        [`Quem fez: ${actor}`, ...bullets],
      ];

    case "AGENDAMENTO_PERM_DELETE":
      return [
        `${actor} excluiu um agendamento permanente${quadra ? ` na ${quadra}` : ""}.`,
        [`Quem excluiu: ${actor}`, ...bullets],
      ];

    case "LOGIN":
      return [`${actor} entrou no sistema.`, [`Quando: ${quando}`, ...(it.ip ? [`IP: ${it.ip}`] : [])]];
    case "LOGIN_FAIL":
      return [`Tentativa de login falhou.`, [`Quando: ${quando}`, ...(it.ip ? [`IP: ${it.ip}`] : []), ...(it.userAgent ? [`Navegador: ${it.userAgent}`] : [])]];
    case "LOGOUT":
      return [`${actor} saiu do sistema.`, [`Quando: ${quando}`]];

    case "PASSWORD_RESET_REQUEST":
      return [`${actor || "Usuário"} pediu código para redefinir a senha.`, [`Quando: ${quando}`]];
    case "PASSWORD_RESET":
      return [`${actor || "Usuário"} redefiniu a senha.`, [`Quando: ${quando}`]];

    case "BLOQUEIO_CREATE":
      return [`${actor} bloqueou uma quadra${quadra ? ` (${quadra})` : ""}.`, [`Quem bloqueou: ${actor}`, ...bullets]];
    case "BLOQUEIO_DELETE":
      return [`${actor} removeu um bloqueio de quadra${quadra ? ` (${quadra})` : ""}.`, [`Quem removeu: ${actor}`, ...bullets]];

    default:
      return [`${actor} realizou uma ação.`, [`Evento: ${eventLabel(it.event)}`, `Quando: ${quando}`, ...bullets]];
  }
}

/** Retorna bullets “curtos” para listagem, se quiser usar separado */
export function detailLines(it: AuditItem): string[] {
  const [, bullets] = fullSentence(it);
  return bullets;
}
