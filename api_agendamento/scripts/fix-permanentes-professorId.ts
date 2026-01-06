import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Rode assim:
// DRY_RUN=1  npx tsx scripts/fix-permanentes-professorId.ts
// DRY_RUN=0  npx tsx scripts/fix-permanentes-professorId.ts
const DRY_RUN = process.env.DRY_RUN === "1";

function pick<T>(arr: T[], n: number) {
  return arr.slice(0, n);
}

async function main() {
  console.log("== Fix professorId em agendamentos permanentes (AULA) ==");
  console.log("DRY_RUN:", DRY_RUN);

  // 1) Pega permanentes AULA cujo DONO é professor (ADMIN_PROFESSORES)
  // (mesma relação "usuario" que você usa no include)
  const candidatos = await prisma.agendamentoPermanente.findMany({
    where: {
      tipoSessao: "AULA",
      usuario: { tipo: "ADMIN_PROFESSORES" },
      // não dá pra comparar campos (professorId != usuarioId) direto no Prisma,
      // então filtramos no JS depois.
    },
    select: {
      id: true,
      usuarioId: true,
      professorId: true,
      status: true,
      diaSemana: true,
      horario: true,
      createdAt: true,
      updatedAt: true,
      usuario: { select: { nome: true, email: true, tipo: true } },
      professor: { select: { nome: true, email: true, tipo: true } },
    },
  });

  const paraCorrigir = candidatos.filter((p) => p.professorId !== p.usuarioId);

  console.log("Total AULA com dono professor:", candidatos.length);
  console.log("Precisam correção (professorId != usuarioId ou null):", paraCorrigir.length);

  console.log("\nAmostra (até 10) do que vai mudar:");
  for (const p of pick(paraCorrigir, 10)) {
    console.log({
      id: p.id,
      status: p.status,
      slot: `${p.diaSemana} ${p.horario}`,
      dono: { id: p.usuarioId, nome: p.usuario?.nome, email: p.usuario?.email },
      professorAtual: p.professorId
        ? { id: p.professorId, nome: p.professor?.nome, email: p.professor?.email }
        : null,
      professorNovo: { id: p.usuarioId, nome: p.usuario?.nome, email: p.usuario?.email },
    });
  }

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1: não alterei nada. Rode com DRY_RUN=0 para aplicar.");
    return;
  }

  // 2) Aplica updates (em transação por segurança)
  const updates = paraCorrigir.map((p) =>
    prisma.agendamentoPermanente.update({
      where: { id: p.id },
      data: { professorId: p.usuarioId },
    })
  );

  // Se tiver muitos, pode estourar memória. Em geral não vai.
  // Se preferir, dá pra fazer em lotes; mas vamos simples primeiro.
  const result = await prisma.$transaction(updates);

  console.log("\n✅ Atualizados:", result.length);

  // 3) Checagem rápida: deve virar zero
  const recheck = await prisma.agendamentoPermanente.count({
    where: {
      tipoSessao: "AULA",
      usuario: { tipo: "ADMIN_PROFESSORES" },
      OR: [
        { professorId: null },
        // ainda não dá pra comparar com usuarioId, então vamos buscar “qualquer um”
        // e você confere no relatório depois; na prática deve ter zerado.
      ],
    },
  });

  console.log("Recheck (AULA dono professor com professorId null):", recheck);
  console.log("Finalizado.");
}

main()
  .catch((e) => {
    console.error("Erro no script:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
