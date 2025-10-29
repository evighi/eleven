import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

const DIAS: readonly DiaSemana[] = [
  "DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO",
] as const;

// "YYYY-MM-DD" -> Date(00:00:00Z)
function toUtc00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}
function diaSemanaFromUTC00(d: Date): DiaSemana {
  return DIAS[d.getUTCDay()];
}
// Janela UTC [início, fim) para a data informada
function getUtcDayRange(isoYYYYMMDD: string) {
  const inicio = toUtc00(isoYYYYMMDD);
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

/**
 * GET /disponibilidadeChurrasqueiras?data=YYYY-MM-DD&turno=DIA|NOITE[&churrasqueiraId=...]
 * Retorna lista de churrasqueiras e se o slot está disponível.
 * - Conflito COMUM: (data, turno, churrasqueiraId) ativo
 * - Conflito PERMANENTE: (diaSemana(data), turno, churrasqueiraId) ativo e dataInicio <= data (ou null)
 *   **mas ignora se houver exceção registrada para essa data** (usa janela [início,fim))
 */
router.get("/", async (req, res) => {
  const dataStr = typeof req.query.data === "string" ? req.query.data : undefined;
  const turnoStr = typeof req.query.turno === "string" ? req.query.turno : undefined;
  const churrasqueiraId = typeof req.query.churrasqueiraId === "string" ? req.query.churrasqueiraId : undefined;

  // validação básica
  if (!dataStr || !/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
    return res.status(400).json({ erro: "Parâmetro obrigatório 'data' no formato YYYY-MM-DD" });
  }
  if (turnoStr !== "DIA" && turnoStr !== "NOITE") {
    return res.status(400).json({ erro: "Parâmetro obrigatório 'turno' deve ser DIA ou NOITE" });
  }

  const dataUTC = toUtc00(dataStr);
  const diaSemana = diaSemanaFromUTC00(dataUTC);
  const turno = turnoStr as Turno;
  const { inicio, fim } = getUtcDayRange(dataStr);

  try {
    // Filtra 1 churrasqueira específica, se vier na query; senão busca todas
    const churrasqueiras = churrasqueiraId
      ? await prisma.churrasqueira.findMany({ where: { id: churrasqueiraId } })
      : await prisma.churrasqueira.findMany();

    const resultado = await Promise.all(
      churrasqueiras.map(async (churrasqueira) => {
        // Conflito PERMANENTE (ativo e respeitando dataInicio <= data)
        // ✅ ignora se existir uma exceção (cancelamento) **nesta data** usando janela [início,fim)
        const conflitoPermanente = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
          where: {
            churrasqueiraId: churrasqueira.id,
            diaSemana,
            turno,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC } }],
            cancelamentos: { none: { data: { gte: inicio, lt: fim } } },
          },
          select: { id: true },
        });

        // Conflito COMUM (data exata + turno)
        const conflitoComum = await prisma.agendamentoChurrasqueira.findFirst({
          where: {
            churrasqueiraId: churrasqueira.id,
            data: dataUTC,
            turno,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
          select: { id: true },
        });

        return {
          churrasqueiraId: churrasqueira.id,
          nome: churrasqueira.nome,
          numero: churrasqueira.numero,
          // campos de imagem (dependem do seu schema)
          imagem: (churrasqueira as any).imagem ?? null,
          imagemUrl: (churrasqueira as any).imagemUrl ?? null,
          logoUrl: (churrasqueira as any).logoUrl ?? null,

          disponivel: !conflitoPermanente && !conflitoComum,
          conflitoPermanente: Boolean(conflitoPermanente),
          conflitoComum: Boolean(conflitoComum),
        };
      })
    );

    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao verificar disponibilidade" });
  }
});

export default router;
