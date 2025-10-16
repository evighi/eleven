// src/lib/userDeletion.ts
import { PrismaClient, StatusAgendamento, DeletionStatus, InteractionType } from "@prisma/client";
import cron from "node-cron";

const prisma = new PrismaClient();

// regra: 90 dias
const WINDOW_DAYS = 90;
const TZ = "America/Sao_Paulo";
// roda todo dia 03:20
const CRON_EXPR = "20 3 * * *";

/** Soma 90 dias sem depender de libs externas */
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** Verifica se existe QUALQUER agendamento CONFIRMADO para o usuário */
async function hasAnyConfirmed(userId: string) {
  const [a, p, c, pc] = await Promise.all([
    prisma.agendamento.findFirst({
      where: { usuarioId: userId, status: StatusAgendamento.CONFIRMADO },
      select: { id: true },
    }),
    prisma.agendamentoPermanente.findFirst({
      where: { usuarioId: userId, status: StatusAgendamento.CONFIRMADO },
      select: { id: true },
    }),
    prisma.agendamentoChurrasqueira.findFirst({
      where: { usuarioId: userId, status: StatusAgendamento.CONFIRMADO },
      select: { id: true },
    }),
    prisma.agendamentoPermanenteChurrasqueira.findFirst({
      where: { usuarioId: userId, status: StatusAgendamento.CONFIRMADO },
      select: { id: true },
    }),
  ]);
  return Boolean(a || p || c || pc);
}

/**
 * Calcula a última interação do usuário:
 * - Agendamento comum/churrasqueira: considerar registros com status {CANCELADO, FINALIZADO, TRANSFERIDO}
 *   e usar a DATA DO EVENTO (Agendamento.data / AgendamentoChurrasqueira.data)
 * - Permanente (quadra/churrasqueira): considerar {CANCELADO, TRANSFERIDO} e usar updatedAt
 */
export async function computeLastInteraction(userId: string) {
  // comum (quadra) — usa "data"
  const lastAgendamento = await prisma.agendamento.findFirst({
    where: {
      usuarioId: userId,
      status: { in: [StatusAgendamento.CANCELADO, StatusAgendamento.FINALIZADO, StatusAgendamento.TRANSFERIDO] },
    },
    orderBy: { data: "desc" },
    select: { id: true, data: true },
  });

  // comum (churrasqueira) — usa "data"
  const lastChurras = await prisma.agendamentoChurrasqueira.findFirst({
    where: {
      usuarioId: userId,
      status: { in: [StatusAgendamento.CANCELADO, StatusAgendamento.FINALIZADO, StatusAgendamento.TRANSFERIDO] },
    },
    orderBy: { data: "desc" },
    select: { id: true, data: true },
  });

  // permanente (quadra) — usa updatedAt
  const lastPerm = await prisma.agendamentoPermanente.findFirst({
    where: {
      usuarioId: userId,
      status: { in: [StatusAgendamento.CANCELADO, StatusAgendamento.TRANSFERIDO] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, updatedAt: true },
  });

  // permanente (churrasqueira) — usa updatedAt
  const lastPermChurras = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
    where: {
      usuarioId: userId,
      status: { in: [StatusAgendamento.CANCELADO, StatusAgendamento.TRANSFERIDO] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, updatedAt: true },
  });

  // compara as datas
  type Cand = { type: InteractionType; id: string; date: Date };
  const cands: Cand[] = [];
  if (lastAgendamento) cands.push({ type: InteractionType.AG_COMUM, id: lastAgendamento.id, date: lastAgendamento.data });
  if (lastChurras)    cands.push({ type: InteractionType.CHURRAS, id: lastChurras.id, date: lastChurras.data });
  if (lastPerm)       cands.push({ type: InteractionType.AG_PERM, id: lastPerm.id, date: lastPerm.updatedAt });
  if (lastPermChurras)cands.push({ type: InteractionType.CHURRAS, id: lastPermChurras.id, date: lastPermChurras.updatedAt });

  if (!cands.length) return { type: InteractionType.NONE, id: null as string | null, date: null as Date | null };

  cands.sort((a, b) => b.date.getTime() - a.date.getTime());
  const top = cands[0];
  return { type: top.type, id: top.id, date: top.date };
}

/**
 * Tenta excluir “agora”. Se não puder, enfileira.
 * - Se tiver CONFIRMADO => erro (não pode excluir)
 * - Se não tiver confirmado e a última interação for < 90d => cria/atualiza pendência e DISABLE o usuário
 * - Se >= 90d (ou sem interação) => soft delete imediato
 */
export async function requestUserDeletion(userId: string, requestedById?: string | null) {
  // 1) existe?
  const user = await prisma.usuario.findUnique({ where: { id: userId }, select: { id: true, disabledAt: true, deletedAt: true } });
  if (!user) return { ok: false, code: 404, message: "Usuário não encontrado" };
  if (user.deletedAt) return { ok: false, code: 400, message: "Usuário já excluído" };

  // 2) confirmado?
  if (await hasAnyConfirmed(userId)) {
    return { ok: false, code: 409, message: "Usuário possui agendamentos CONFIRMADOS e não pode ser excluído." };
  }

  // 3) última interação
  const last = await computeLastInteraction(userId);

  // Se não tem interação OU passou de 90 dias -> soft delete imediato
  if (!last.date || addDays(last.date, WINDOW_DAYS) <= new Date()) {
    await prisma.$transaction(async (tx) => {
      // marca soft delete
      await tx.usuario.update({
        where: { id: userId },
        data: { disabledAt: new Date(), deletedAt: new Date(), deletedById: requestedById ?? null },
      });

      // encerra pendência se existir
      await tx.userDeletionQueue.updateMany({
        where: { usuarioId: userId, status: DeletionStatus.PENDING },
        data: { status: DeletionStatus.DONE, processedAt: new Date() },
      });
    });

    return { ok: true, code: 204, deletedNow: true };
  }

  // 4) ainda dentro dos 90 dias -> cria/atualiza fila + desabilita acesso
  const eligibleAt = addDays(last.date, WINDOW_DAYS);

  const row = await prisma.userDeletionQueue.upsert({
    where: { usuarioId: userId },
    create: {
      usuarioId: userId,
      requestedById: requestedById ?? null,
      status: DeletionStatus.PENDING,
      lastInteractionType: last.type,
      lastInteractionId: last.id!,
      lastInteractionDate: last.date,
      eligibleAt,
      requestedAt: new Date(),
    },
    update: {
      status: DeletionStatus.PENDING,
      requestedById: requestedById ?? null,
      lastInteractionType: last.type,
      lastInteractionId: last.id!,
      lastInteractionDate: last.date,
      eligibleAt,
      attempts: 0,
      cancelledAt: null,
    },
  });

  // desabilita login imediatamente
  await prisma.usuario.update({
    where: { id: userId },
    data: { disabledAt: user.disabledAt ?? new Date() },
  });

  return {
    ok: true,
    code: 202,
    queued: true,
    eligibleAt,
    lastInteraction: { type: last.type, id: last.id, date: last.date },
    queueId: row.id,
  };
}

/** Cancela a pendência e reabilita o acesso */
export async function cancelUserDeletion(userId: string) {
  const row = await prisma.userDeletionQueue.findUnique({ where: { usuarioId: userId } });
  if (!row || row.status !== DeletionStatus.PENDING) return { ok: false, code: 404, message: "Pendência não encontrada" };

  await prisma.$transaction(async (tx) => {
    await tx.userDeletionQueue.update({
      where: { id: row.id },
      data: { status: DeletionStatus.CANCELLED, cancelledAt: new Date() },
    });
    await tx.usuario.update({
      where: { id: userId },
      data: { disabledAt: null },
    });
  });

  return { ok: true };
}

/** Lista pendências para o front */
export async function listPendingDeletions() {
  return prisma.userDeletionQueue.findMany({
    where: { status: DeletionStatus.PENDING },
    orderBy: [{ eligibleAt: "asc" }],
    include: {
      usuario: { select: { id: true, nome: true, email: true, disabledAt: true } },
      requestedBy: { select: { id: true, nome: true, email: true } },
    },
  });
}

/** Processador do CRON: apaga quem ficou elegível */
export async function processEligibleDeletions() {
  const now = new Date();

  const pendentes = await prisma.userDeletionQueue.findMany({
    where: { status: DeletionStatus.PENDING, eligibleAt: { lte: now } },
    orderBy: { eligibleAt: "asc" },
  });

  for (const row of pendentes) {
    try {
      // revalida confirmado e última interação
      if (await hasAnyConfirmed(row.usuarioId)) {
        // ainda tem confirmado -> só adia
        await prisma.userDeletionQueue.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 } },
        });
        continue;
      }

      const last = await computeLastInteraction(row.usuarioId);
      if (last.date && addDays(last.date, WINDOW_DAYS) > now) {
        // ficou “mais recente” — reprograme
        await prisma.userDeletionQueue.update({
          where: { id: row.id },
          data: {
            lastInteractionType: last.type,
            lastInteractionId: last.id!,
            lastInteractionDate: last.date,
            eligibleAt: addDays(last.date, WINDOW_DAYS),
            attempts: { increment: 1 },
          },
        });
        continue;
      }

      // elegível: soft delete
      await prisma.$transaction(async (tx) => {
        await tx.usuario.update({
          where: { id: row.usuarioId },
          data: { disabledAt: new Date(), deletedAt: new Date(), deletedById: row.requestedById ?? null },
        });
        await tx.userDeletionQueue.update({
          where: { id: row.id },
          data: { status: DeletionStatus.DONE, processedAt: new Date() },
        });
      });
    } catch (e) {
      await prisma.userDeletionQueue.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      // logue o erro no seu logger padrão
      console.error("[userDeletion] erro ao processar", row.usuarioId, e);
    }
  }
}

/** Agenda o cron diário */
export function scheduleUserDeletionCron() {
  const g = globalThis as any;
  if (g.__userDeletionCronStarted__) return;

  cron.schedule(
    CRON_EXPR,
    () => {
      processEligibleDeletions().catch((e) => console.error("[userDeletion] cron error:", e));
    },
    { timezone: TZ }
  );

  g.__userDeletionCronStarted__ = true;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[userDeletion] cron ON (every "${CRON_EXPR}" ${TZ})`);
  }
}
