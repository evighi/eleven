// src/jobs/limpezaAgendamentos.ts
import { PrismaClient } from "@prisma/client";
import cron from "node-cron";

const prisma = new PrismaClient();
const SP_TZ = process.env.TZ || "America/Sao_Paulo";
const LIMITE_DIAS = 90;

/** helpers de dia local (SP) -> UTC 00:00 */
function localYMD(d: Date, tz = SP_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);                                             // "YYYY-MM-DD"
}
function addDaysLocalYMD(ymd: string, days: number) {
  const d = new Date(`${ymd}T12:00:00-03:00`);              // meio-dia local evita rollover
  d.setUTCDate(d.getUTCDate() + days);
  return localYMD(d);
}
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}

/** calcula o limite (dia local - 90d) em UTC00 para comparar com campos `data` */
function limiteDataUTC00(): Date {
  const hojeYMD = localYMD(new Date());
  const alvoYMD = addDaysLocalYMD(hojeYMD, -LIMITE_DIAS);
  return toUtc00(alvoYMD);
}

/** ================ DELEÇÕES ================ */
async function limparAgendamentosComunsAntigos() {
  const limite = limiteDataUTC00();
  const r = await prisma.agendamento.deleteMany({
    where: {
      status: { in: ["FINALIZADO", "CANCELADO", "TRANSFERIDO"] },
      data: { lt: limite },
    },
  });
  return r.count;
}

async function limparChurrasqueirasAntigos() {
  const limite = limiteDataUTC00();
  const r = await prisma.agendamentoChurrasqueira.deleteMany({
    where: {
      status: { in: ["FINALIZADO", "CANCELADO", "TRANSFERIDO"] },
      data: { lt: limite },
    },
  });
  return r.count;
}

async function limparPermanentesAntigos() {
  // para permanentes usamos `updatedAt` (não há campo `data`)
  const limite = new Date();
  limite.setUTCDate(limite.getUTCDate() - LIMITE_DIAS);

  const [quadras, churras] = await Promise.all([
    prisma.agendamentoPermanente.deleteMany({
      where: {
        status: { in: ["CANCELADO", "TRANSFERIDO"] },
        updatedAt: { lt: limite },
      },
    }),
    prisma.agendamentoPermanenteChurrasqueira.deleteMany({
      where: {
        status: { in: ["CANCELADO", "TRANSFERIDO"] },
        updatedAt: { lt: limite },
      },
    }),
  ]);

  return { permQuadra: quadras.count, permChurras: churras.count };
}

/** executa toda a limpeza e loga um resumo */
export async function runLimpeza90d() {
  const [c1, c2, p] = await Promise.all([
    limparAgendamentosComunsAntigos(),
    limparChurrasqueirasAntigos(),
    limparPermanentesAntigos(),
  ]);

  const resumo =
    `[cleanup-90d] comuns=${c1} | churras=${c2} | permQuadra=${p.permQuadra} | permChurras=${p.permChurras}`;

  if (process.env.NODE_ENV !== "production") console.log(resumo);
  return { comuns: c1, churras: c2, ...p };
}

/** agenda o cron diário às 03:00 (SP) com guard contra hot-reload */
export function scheduleLimpezaDiaria() {
  const g = global as any;
  if (g.__cronLimpeza90d__) return; // já registrado

  cron.schedule(
    "0 3 * * *",
    () => {
      runLimpeza90d().catch((e) => console.error("Erro no cleanup-90d:", e));
    },
    { timezone: SP_TZ }
  );
  g.__cronLimpeza90d__ = true;
}
