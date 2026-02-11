// utils/notificacoes.ts
import {
    PrismaClient,
    NotificationType,
    TipoUsuario,
    Prisma,
    AtendenteFeature,
} from "@prisma/client";
import { notificationHub } from "./notificationHub"; // ajuste o path se necessário
import { differenceInMinutes } from "date-fns";

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

// =========================
// Helpers (SP timezone-safe)
// =========================

// Usa o MESMO padrão do routes/agendamentos.ts: "linha do tempo local" codificada em UTC.
// Isso evita bugs de timezone pois teu cancelamento compara local (SP).
const SP_TZ = process.env.TZ || "America/Sao_Paulo";

function localYMD(d: Date, tz = SP_TZ) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(d); // "YYYY-MM-DD"
}

function localHM(d: Date, tz = SP_TZ) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(d); // "HH:mm"
}

// Constrói um "timestamp" em ms em uma linha do tempo local (codificada como UTC)
function msFromLocalYMDHM(ymd: string, hm: string) {
    const [y, m, d] = ymd.split("-").map(Number);
    const [hh, mm] = hm.split(":").map(Number);
    return Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

function minutesUntilStartLocal(agDate: Date, agHM: string) {
    const now = new Date();
    const nowYMD = localYMD(now);
    const nowHM = localHM(now);
    const nowMs = msFromLocalYMDHM(nowYMD, nowHM);

    // IMPORTANTE: ag.data no banco é 00:00Z do dia pretendido.
    // O .toISOString().slice(0,10) preserva o "dia" que você quer.
    const schedYMD = agDate.toISOString().slice(0, 10);
    const schedMs = msFromLocalYMDHM(schedYMD, agHM);

    return Math.floor((schedMs - nowMs) / 60000);
}

function formatFaltam(mins: number) {
    const h = Math.floor(mins / 60);
    const m = Math.abs(mins % 60);
    return `${h}h${String(m).padStart(2, "0")}`;
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

async function getAtendenteBloqueiosRecipientsIds() {
    const atendentes = await prisma.usuario.findMany({
        where: {
            tipo: TipoUsuario.ADMIN_ATENDENTE,
            disabledAt: null,
            deletedAt: null,
        },
        select: { id: true },
    });

    return atendentes.map((a) => a.id);
}


async function getBloqueioRecipientsIds() {
    const [masters, atendentes] = await Promise.all([
        getAdminRecipientsIds(),
        getAtendenteBloqueiosRecipientsIds(),
    ]);

    // une e remove duplicados
    return Array.from(new Set([...masters, ...atendentes]));
}

function formatQuadrasLabel(quadras: { numero: number; nome?: string }[]) {
    const labels = quadras
        .slice()
        .sort((a, b) => a.numero - b.numero)
        .map((q) => `Quadra ${q.numero}`);

    if (labels.length <= 1) return labels[0] ?? "Quadra";
    if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
    return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
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
        // 🔔 envia evento em tempo real pros recipients conectados (sem query)
        notificationHub.emitToUsers(finalRecipients, {
            notificationId: notification.id,
            type,
            title,
            createdAt: notification.createdAt,
            // opcional: mandar message também (se quiser)
            // message,
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

type AgendamentoCanceladoForNotify = {
    id: string;
    data: Date;
    horario: string;
    usuario?: { id: string; nome: string } | null;
    quadra?: { id: string; nome: string; numero: number } | null;
    esporte?: { id: string; nome: string } | null;
};

export async function notifyAdminsAgendamentoCanceladoSeDentro12h(params: {
    agendamento: AgendamentoCanceladoForNotify;
    actorId?: string | null;
    actorTipo?: TipoUsuario | string;
}) {
    const { agendamento, actorId = null, actorTipo } = params;

    // ✅ Só notifica se foi ADMIN_MASTER (mantém tua regra)
    if (actorTipo !== "ADMIN_MASTER") return null;

    const minutesToStart = minutesUntilStartLocal(agendamento.data, agendamento.horario);

    // ✅ Só notifica se ainda vai acontecer e faltam < 12h
    if (!(minutesToStart > 0 && minutesToStart < 12 * 60)) return null;

    const dataYMD = agendamento.data.toISOString().slice(0, 10);
    const faltam = formatFaltam(minutesToStart);

    const quadraLabel =
        agendamento.quadra?.numero != null
            ? `Quadra ${agendamento.quadra.numero}`
            : (agendamento.quadra?.nome ?? "Quadra");

    const esporteNome = agendamento.esporte?.nome ?? "Esporte";
    const donoNome = agendamento.usuario?.nome ?? "Usuário";

    // ✅ pega nome do admin que cancelou
    let actorNome = "Admin";
    if (actorId) {
        const actor = await prisma.usuario.findUnique({
            where: { id: actorId },
            select: { nome: true },
        });
        if (actor?.nome) actorNome = actor.nome;
    }

    const title = "Cancelamento em cima da hora";
    const message =
        `${actorNome} cancelou um agendamento com menos de 12h: ` +
        `${esporteNome} • ${quadraLabel} • ${dataYMD} ${agendamento.horario} ` +
        `(faltavam ${faltam}) • Dono: ${donoNome}`;

    return notifyAdmins({
        type: NotificationType.AGENDAMENTO_COMUM_CANCELADO,
        title,
        message,
        actorId,
        data: {
            agendamentoId: agendamento.id,
            data: dataYMD,
            horario: agendamento.horario,
            minsAteInicio: minutesToStart,
            esporteId: agendamento.esporte?.id ?? null,
            esporteNome,
            quadraId: agendamento.quadra?.id ?? null,
            quadraNumero: agendamento.quadra?.numero ?? null,
            quadraNome: agendamento.quadra?.nome ?? null,
            usuarioId: agendamento.usuario?.id ?? null,
            usuarioNome: donoNome,
            canceladoPorId: actorId,
            canceladoPorNome: actorNome, // 👈 útil pro front também
            canceladoPorTipo: actorTipo ?? null,
        } satisfies Prisma.JsonObject,
    });
}


type BloqueioForNotify = {
    id: string;
    dataBloqueio: Date;
    inicioBloqueio: string;
    fimBloqueio: string;
    quadras: { id: string; nome: string; numero: number }[];
    motivo?: { id: string; nome: string } | null;
};

export async function notifyBloqueioCriado(params: {
    bloqueio: BloqueioForNotify;
    actorId?: string | null;
}) {
    const { bloqueio, actorId = null } = params;

    const data = ymdUTC(bloqueio.dataBloqueio);
    const janela = `${bloqueio.inicioBloqueio}–${bloqueio.fimBloqueio}`;
    const quadrasLabel = formatQuadrasLabel(bloqueio.quadras);
    const motivoNome = bloqueio.motivo?.nome ?? null;

    const title = "Bloqueio de quadra criado";
    const message = motivoNome
        ? `Bloqueio criado (${motivoNome}): ${quadrasLabel} • ${data} • ${janela}`
        : `Bloqueio criado: ${quadrasLabel} • ${data} • ${janela}`;

    const recipientIds = await getBloqueioRecipientsIds();

    return notifyAdmins({
        type: NotificationType.BLOQUEIO_QUADRA_CRIADO,
        title,
        message,
        actorId,
        recipientIds, // ✅ master + atendente (somente aqui)
        data: {
            bloqueioId: bloqueio.id,
            dataBloqueio: data,
            inicioBloqueio: bloqueio.inicioBloqueio,
            fimBloqueio: bloqueio.fimBloqueio,
            motivoId: bloqueio.motivo?.id ?? null,
            motivoNome,
            quadras: bloqueio.quadras.map((q) => ({
                id: q.id,
                nome: q.nome,
                numero: q.numero,
            })),
        },
    });
}

