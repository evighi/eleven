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

/**
 * GET /disponibilidadeChurrasqueiras?data=YYYY-MM-DD&turno=DIA|NOITE[&churrasqueiraId=...]
 * Retorna lista de churrasqueiras e se o slot está disponível.
 * - Conflito COMUM: (data, turno, churrasqueiraId) ativo
 * - Conflito PERMANENTE: (diaSemana(data), turno, churrasqueiraId) ativo e dataInicio <= data (ou null)
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

  try {
    // Filtra 1 churrasqueira específica, se vier na query; senão busca todas
    const selectChurras = {
      id: true,
      nome: true,
      numero: true,
      imagem: true,
      imagemUrl: true,
      logoUrl: true,
    } as const;

    const churrasqueiras = churrasqueiraId
      ? await prisma.churrasqueira.findMany({ where: { id: churrasqueiraId }, select: selectChurras })
      : await prisma.churrasqueira.findMany({ select: selectChurras });

    const resultado = await Promise.all(
      churrasqueiras.map(async (ch) => {
        // Conflito PERMANENTE (ativo e respeitando dataInicio <= data)
        const conflitoPermanente = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
          where: {
            churrasqueiraId: ch.id,
            diaSemana,
            turno,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
            OR: [{ dataInicio: null }, { dataInicio: { lte: dataUTC } }],
          },
          select: { id: true },
        });

        // Conflito COMUM (data exata + turno)
        const conflitoComum = await prisma.agendamentoChurrasqueira.findFirst({
          where: {
            churrasqueiraId: ch.id,
            data: dataUTC,
            turno,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
          },
          select: { id: true },
        });

        return {
          churrasqueiraId: ch.id,
          nome: ch.nome,
          numero: ch.numero,
          // ⬇️ campos para o frontend montar a imagem (AppImage)
          imagem: ch.imagem,
          imagemUrl: ch.imagemUrl,
          logoUrl: ch.logoUrl,
          // disponibilidade
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
