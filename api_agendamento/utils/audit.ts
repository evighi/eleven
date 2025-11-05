// utils/audit.ts
import type { Request } from "express";
import { PrismaClient, AuditTargetType, TipoUsuario } from "@prisma/client";
import cron from "node-cron";

const prisma = new PrismaClient();

/** === Config fixas (sem .env) === */
const RETENTION_DAYS = 90;          // manter logs por 90 dias
const CRON_EXPR = "10 3 * * *";     // todo dia às 03:10
const CRON_TZ = "America/Sao_Paulo";

/** Eventos suportados */
export type AuditEvent =
  // Autenticação
  | "LOGIN"
  | "LOGIN_FAIL"
  | "LOGOUT"
  // Recuperação de senha
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET"
  // Usuário
  | "USUARIO_CREATE"
  | "USUARIO_UPDATE"
  // Agendamento comum (quadra)
  | "AGENDAMENTO_CREATE"
  | "AGENDAMENTO_CANCEL"
  | "AGENDAMENTO_TRANSFER"
  | "AGENDAMENTO_DELETE"
  | "AGENDAMENTO_MULTA_ANULAR"  
  | "AGENDAMENTO_MULTA_APLICAR"
  // Agendamento permanente (quadra)
  | "AGENDAMENTO_PERM_CREATE"
  | "AGENDAMENTO_PERM_CANCEL"
  | "AGENDAMENTO_PERM_TRANSFER"
  | "AGENDAMENTO_PERM_EXCECAO"
  | "AGENDAMENTO_PERM_DELETE"
  // Churrasqueira comum
  | "CHURRAS_CREATE"
  | "CHURRAS_CANCEL"
  | "CHURRAS_TRANSFER"
  | "CHURRAS_DELETE"
  // Churrasqueira permanente
  | "CHURRAS_PERM_CREATE"
  | "CHURRAS_PERM_CANCEL"
  | "CHURRAS_PERM_EXCECAO"
  | "CHURRAS_PERM_DELETE"
  // Bloqueios de quadra
  | "BLOQUEIO_CREATE"
  | "BLOQUEIO_DELETE"
  // fallback
  | "OTHER";

/** Alvo impactado */
export type AuditTarget = {
  type: AuditTargetType;
  id?: string | number | null;
};
export const TargetType = AuditTargetType;

/** Entrada do logger */
export type LogAuditInput = {
  event: AuditEvent;
  req?: Request;
  actor?: {
    id?: string | null;
    name?: string | null;
    /** CLIENTE | ADMIN_MASTER | ADMIN_ATENDENTE | ADMIN_PROFESSORES */
    type?: string | null; // string vinda do JWT; convertemos para enum
  };
  target?: AuditTarget;
  // message?: string | null; // seu schema não tem essa coluna; deixo comentado
  metadata?: Record<string, any> | null;
};

/** Converte string -> enum TipoUsuario se válido */
function toTipoUsuarioEnum(value?: string | null): TipoUsuario | null {
  if (!value) return null;
  const key = value.toUpperCase();
  return (TipoUsuario as any)[key] ?? null;
}

/** Extrai ator (JWT) ou override */
function resolveActor(input: LogAuditInput) {
  const override = input.actor ?? {};
  const jwt = (input.req as any)?.usuario as
    | {
        usuarioLogadoId?: string;
        usuarioLogadoNome?: string;
        usuarioLogadoTipo?: string;
      }
    | undefined;

  const actorId =
    override.id ?? (jwt?.usuarioLogadoId ? String(jwt.usuarioLogadoId) : null);

  const actorName =
    override.name ?? (jwt?.usuarioLogadoNome ? String(jwt.usuarioLogadoNome) : null);

  const actorTipo: TipoUsuario | null =
    toTipoUsuarioEnum(override.type) ?? toTipoUsuarioEnum(jwt?.usuarioLogadoTipo) ?? null;

  return { actorId, actorName, actorTipo };
}

/** Logger principal */
export async function logAudit(input: LogAuditInput) {
  try {
    const { actorId, actorName, actorTipo } = resolveActor(input);

    const ip =
      (input.req?.headers["x-forwarded-for"] as string) ||
      (input.req?.socket?.remoteAddress as string) ||
      null;

    const userAgent = (input.req?.headers["user-agent"] as string) || null;

    await prisma.auditLog.create({
      data: {
        event: input.event,
        actorId,
        actorName,
        actorTipo,                              // enum TipoUsuario | null
        targetType: input.target?.type ?? null, // enum AuditTargetType | null
        targetId: input.target?.id != null ? String(input.target.id) : null,
        ip,
        userAgent,
        metadata: (input.metadata ?? null) as any, // JSONB
      },
    });
  } catch (err) {
    // não quebrar fluxo da API por falha de log
    console.error("[audit] erro ao registrar auditoria:", err);
  }
}

/** Purga logs mais antigos que RETENTION_DAYS */
export async function purgeOldAuditLogs() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  try {
    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[audit] purge > days=${RETENTION_DAYS} removed=${result.count} cutoff=${cutoff.toISOString()}`
      );
    }
  } catch (e) {
    console.error("[audit] purge error:", e);
  }
}

/** Agenda a purga diária (protege contra hot-reload duplicado) */
export function initAuditRetentionScheduler() {
  const g = (globalThis as any);
  if (g.__auditRetentionStarted__) return;

  cron.schedule(
    CRON_EXPR,
    () => {
      purgeOldAuditLogs().catch((e) =>
        console.error("[audit] scheduled purge error:", e)
      );
    },
    { timezone: CRON_TZ }
  );

  g.__auditRetentionStarted__ = true;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[audit] retention scheduler ON (every "${CRON_EXPR}" ${CRON_TZ})`);
  }
}
