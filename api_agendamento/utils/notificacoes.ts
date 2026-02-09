// utils/notificacoes.ts
import {
  PrismaClient,
  NotificationType,
  TipoUsuario,
  Prisma,
} from "@prisma/client";

const prisma = new PrismaClient();

type AgendamentoForNotify = {
  id: string;
  data: Date;
  horario: string;
  usuario?: { id: string; nome: string } | null;
  quadra?: { id: string; nome: string; numero: number } | null;
  esporte?: { id: string; nome: string } | null;
  professor?: { id: string; nome: string } | null;
  tipoSessao?: any;
};

function ymdUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function getAdminRecipientsIds() {
  const admins = await prisma.usuario.findMany({
    where: {
      tipo: { in: [TipoUsuario.ADMIN_MASTER] },
      disabledAt: null,
      deletedAt: null,
    },
    select: { id: true },
  });

  return admins.map((a) => a.id);
}

/**
 * Cria 1 Notification + N NotificationRecipient (um por admin)
 */
export async function notifyAdmins(params: {
  type: NotificationType;
  title: string;
  message: string;
  data?: Prisma.JsonValue;
  actorId?: string | null;
  recipientIds?: string[]; // se não passar, resolve admins automaticamente
  excludeActor?: boolean; // default true
}) {
  const {
    type,
    title,
    message,
    data,
    actorId = null,
    recipientIds,
    excludeActor = true,
  } = params;

  const baseRecipients = recipientIds ?? (await getAdminRecipientsIds());

  const finalRecipients = excludeActor && actorId
    ? baseRecipients.filter((id) => id !== actorId)
    : baseRecipients;

  if (finalRecipients.length === 0) return null;

  return prisma.$transaction(async (tx) => {
    const notification = await tx.notification.create({
      data: {
        type,
        title,
        message,
        data: data ?? undefined,
        actorId: actorId ?? undefined,
      },
      select: { id: true, createdAt: true },
    });

    await tx.notificationRecipient.createMany({
      data: finalRecipients.map((userId) => ({
        notificationId: notification.id,
        userId,
      })),
      skipDuplicates: true,
    });

    return notification;
  });
}

/**
 * 🔔 Notifica admins quando um AGENDAMENTO COMUM é criado
 * (quadra / data / horario / esporte / dono)
 */
export async function notifyAdminsAgendamentoCriado(params: {
  agendamento: AgendamentoForNotify;
  actorId?: string | null;
}) {
  const { agendamento, actorId = null } = params;

  const data = ymdUTC(agendamento.data);
  const horario = agendamento.horario;

  const quadraLabel =
    agendamento.quadra?.numero != null
      ? `Quadra ${agendamento.quadra.numero}`
      : (agendamento.quadra?.nome ?? "Quadra");

  const esporteNome = agendamento.esporte?.nome ?? "Esporte";
  const donoNome = agendamento.usuario?.nome ?? "Usuário";

  const title = "Novo agendamento criado";
  const message = `${donoNome} criou um agendamento: ${esporteNome} • ${quadraLabel} • ${data} ${horario}`;

  return notifyAdmins({
    type: NotificationType.AGENDAMENTO_COMUM_CRIADO,
    title,
    message,
    actorId,
    data: {
      agendamentoId: agendamento.id,
      data,
      horario,
      esporteId: agendamento.esporte?.id ?? null,
      esporteNome,
      quadraId: agendamento.quadra?.id ?? null,
      quadraNumero: agendamento.quadra?.numero ?? null,
      quadraNome: agendamento.quadra?.nome ?? null,
      usuarioId: agendamento.usuario?.id ?? null,
      usuarioNome: donoNome,
      professorId: agendamento.professor?.id ?? null,
      professorNome: agendamento.professor?.nome ?? null,
      tipoSessao: agendamento.tipoSessao ?? null,
    },
  });
}
