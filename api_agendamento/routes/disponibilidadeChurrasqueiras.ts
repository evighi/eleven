import { Router } from "express";
import { PrismaClient, DiaSemana, Turno } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

const diasEnum: DiaSemana[] = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"];

router.get("/", async (req, res) => {
  const { diaSemana, turno } = req.query;

  if (!diaSemana || !turno) {
    return res.status(400).json({ erro: "Parâmetros obrigatórios: diaSemana e turno" });
  }

  if (!diasEnum.includes(diaSemana as DiaSemana)) {
    return res.status(400).json({ erro: "Dia da semana inválido" });
  }

  if (!(turno === "DIA" || turno === "NOITE")) {
    return res.status(400).json({ erro: "Turno inválido" });
  }

  try {
    const churrasqueiras = await prisma.churrasqueira.findMany();

    const resultado = await Promise.all(
      churrasqueiras.map(async (churrasqueira) => {
        // Conflito permanente (ignorando cancelados)
        const conflitoPermanente = await prisma.agendamentoPermanenteChurrasqueira.findFirst({
          where: { 
            diaSemana: diaSemana as DiaSemana, 
            turno: turno as Turno, 
            churrasqueiraId: churrasqueira.id,
            status: { not: "CANCELADO" }
          }
        });

        // Conflito comum (ignorando cancelados)
        const conflitoComum = await prisma.agendamentoChurrasqueira.findFirst({
          where: { 
            diaSemana: diaSemana as DiaSemana, 
            turno: turno as Turno, 
            churrasqueiraId: churrasqueira.id,
            status: { not: "CANCELADO" }
          }
        });

        return {
          churrasqueiraId: churrasqueira.id,
          nome: churrasqueira.nome,
          numero: churrasqueira.numero,
          disponivel: !conflitoPermanente && !conflitoComum,
          conflitoPermanente: !!conflitoPermanente,
          conflitoComum: !!conflitoComum
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
