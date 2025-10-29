import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";
import { addDays, startOfDay, format, parseISO } from "date-fns";

const router = Router();
const prisma = new PrismaClient();

const diasEnum: DiaSemana[] = [
  "DOMINGO","SEGUNDA","TERCA","QUARTA","QUINTA","SEXTA","SABADO",
];

const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO:0, SEGUNDA:1, TERCA:2, QUARTA:3, QUINTA:4, SEXTA:5, SABADO:6,
};

function toISO(d: Date) {
  return format(startOfDay(d), "yyyy-MM-dd");
}
function toUTC00(isoYYYYMMDD: string) {
  return new Date(`${isoYYYYMMDD}T00:00:00Z`);
}

/**
 * GET /api/proximaDataPermanenteDisponivelChurrasqueira
 *   ?diaSemana=SEGUNDA|...&turno=DIA|NOITE&churrasqueiraId=UUID
 *
 * Resposta:
 *   { dataUltimoConflito: string|null, proximasDatasDisponiveis: string[] }
 *
 * Regra:
 *  - Baseia-se nas PRÓXIMAS ocorrências do dia-da-semana escolhido (12 semanas).
 *  - Remove datas com conflito COMUM (agendamentoChurrasqueira ativo no mesmo turno).
 *  - Remove datas bloqueadas por PERMANENTE (ativo, mesmo dia/turno/churrasqueira),
 *    EXCETO quando existir cancelamento (exceção) exatamente nessa data.
 *  - dataUltimoConflito considera apenas conflitos COMUNS (igual à rota de quadras).
 */
router.get("/", async (req, res) => {
  const diaSemana = req.query.diaSemana as DiaSemana | undefined;
  const turno = req.query.turno as Turno | undefined;
  const churrasqueiraId = req.query.churrasqueiraId as string | undefined;

  if (!diaSemana || !diasEnum.includes(diaSemana)) {
    return res.status(400).json({ erro: "diaSemana inválido" });
  }
  if (turno !== "DIA" && turno !== "NOITE") {
    return res.status(400).json({ erro: "turno deve ser DIA ou NOITE" });
  }
  if (!churrasqueiraId) {
    return res.status(400).json({ erro: "churrasqueiraId é obrigatório" });
  }

  try {
    // 1) Gera próximas 12 ocorrências do dia-da-semana a partir de hoje
    const hoje = startOfDay(new Date());
    const alvoIdx = DIA_IDX[diaSemana];
    const candidatas: string[] = [];
    // avança até o próximo alvo
    const delta0 = (alvoIdx - hoje.getUTCDay() + 7) % 7;
    let d = startOfDay(addDays(hoje, delta0));
    for (let i = 0; i < 12; i++) {
      candidatas.push(toISO(d));
      d = addDays(d, 7);
    }

    // 2) Conflitos COMUNS nas candidatas (mesma churrasqueira, turno)
    const agComuns = await prisma.agendamentoChurrasqueira.findMany({
      where: {
        churrasqueiraId,
        turno,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        data: { in: candidatas.map((iso) => toUTC00(iso)) },
      },
      select: { data: true },
      orderBy: { data: "asc" },
    });

    let dataUltimoConflito: string | null = null;
    for (const a of agComuns) {
      const iso = a.data.toISOString().slice(0, 10);
      if (!dataUltimoConflito || parseISO(iso) > parseISO(dataUltimoConflito)) {
        dataUltimoConflito = iso;
      }
    }
    const setConflitosComuns = new Set(agComuns.map((a) => a.data.toISOString().slice(0, 10)));

    // 3) PERMANENTES ativos (mesmo dia/turno/churrasqueira)
    const permanentes = await prisma.agendamentoPermanenteChurrasqueira.findMany({
      where: {
        churrasqueiraId,
        diaSemana,
        turno,
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
      select: {
        id: true,
        dataInicio: true,
        cancelamentos: { select: { data: true } },
      },
    });

    const bloqueadoPorPermanente = (iso: string) => {
      const dt = toUTC00(iso);
      for (const p of permanentes) {
        // se tem dataInicio, só bloqueia a partir dela
        const iniciou = !p.dataInicio || startOfDay(dt) >= startOfDay(new Date(p.dataInicio));
        if (!iniciou) continue;
        // se há exceção nessa data, NÃO bloqueia
        const temExcecao = p.cancelamentos.some(
          (c) => c.data.toISOString().slice(0, 10) === iso
        );
        if (!temExcecao) return true;
      }
      return false;
    };

    // 4) Monta resposta
    const proximasDatasDisponiveis = candidatas
      // sem conflito COMUM
      .filter((iso) => !setConflitosComuns.has(iso))
      // sem bloqueio por PERMANENTE (sem exceção)
      .filter((iso) => !bloqueadoPorPermanente(iso))
      .slice(0, 6); // limita para UI

    return res.status(200).json({
      dataUltimoConflito,
      proximasDatasDisponiveis,
    });
  } catch (error) {
    console.error("Erro proximaDataPermanenteDisponivelChurrasqueira:", error);
    return res
      .status(500)
      .json({ erro: "Erro ao buscar próximas datas disponíveis (churrasqueira)" });
  }
});

export default router;
