import { Router } from "express";
import { PrismaClient, DiaSemana } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import {
  startOfDay,
  addDays,
  getDay,
} from "date-fns";
import cron from "node-cron"; // ⏰ cron para finalizar vencidos
import verificarToken from "../middleware/authMiddleware";
import { r2PublicUrl } from "../src/lib/r2";


function getUtcDayRange(dateStr?: string) {
  // Se o front informou "YYYY-MM-DD", respeitamos esse dia
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const base = dateStr.slice(0, 10);
    const inicio = new Date(`${base}T00:00:00Z`);
    const fim = new Date(`${base}T00:00:00Z`);
    fim.setUTCDate(fim.getUTCDate() + 1);
    return { inicio, fim };
  }

  // Caso contrário, usamos o DIA LOCAL (America/Sao_Paulo) para gerar os boundaries em UTC
  const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(new Date());
  return { inicio: hojeUTC00, fim: amanhaUTC00 };
}

/**
 * ⚠️ IMPORTANTE SOBRE O CAMPO `data`:
 * No POST você manda "YYYY-MM-DD", que o Node interpreta como MEIA-NOITE EM UTC daquele dia.
 * Portanto, no banco o campo `data` representa "00:00 UTC do dia pretendido".
 * Para comparar com "hoje" local, converta o dia local para esse MESMO formato:
 *   Date.UTC(anoLocal, mesLocal, diaLocal, 0, 0, 0) => boundary correto para consultas.
 */
// Força o dia local em America/Sao_Paulo e devolve os limites em UTC [início, fim)
function getStoredUtcBoundaryForLocalDay(dLocal = new Date()) {
  // pega YYYY-MM-DD do ponto de vista de São Paulo
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(dLocal).split("-").map(Number);

  // 00:00:00 UTC do mesmo YYYY-MM-DD (é exatamente como você salva no banco)
  const hojeUTC00 = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const amanhaUTC00 = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));

  return { hojeUTC00, amanhaUTC00 };
}

// helper no topo do arquivo (perto dos outros helpers)
function resolveQuadraImg(imagem?: string | null) {
  if (!imagem) return null;

  // 1) Se for uma chave do R2 (ex.: "quadras/..." ou algo com "/"), gere URL pública
  const isHttp = /^https?:\/\//i.test(imagem);
  const looksLikeR2Key = !isHttp && (imagem.includes("/") || imagem.startsWith("quadras"));

  if (looksLikeR2Key) {
    const url = r2PublicUrl(imagem);
    if (url) return url;
  }

  // 2) Se já é URL absoluta, só devolve
  if (isHttp) return imagem;

  // 3) Legado: nome de arquivo salvo em /uploads/quadras
  const base = process.env.APP_URL
    ? `${process.env.APP_URL}/uploads/quadras/`
    : `/uploads/quadras/`;
  return `${base}${imagem}`;
}



const prisma = new PrismaClient();
const router = Router();

const addJogadoresSchema = z.object({
  jogadoresIds: z.array(z.string().uuid()).optional().default([]),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});

// Validação do corpo (flexível p/ admin ou cliente)
const agendamentoSchema = z.object({
  data: z.coerce.date(),
  horario: z.string().min(1),
  quadraId: z.string().uuid(),
  esporteId: z.string().uuid(),
  // admin pode mandar; cliente não precisa mandar (vem do token)
  usuarioId: z.string().uuid().optional(),
  jogadoresIds: z.array(z.string().uuid()).optional().default([]),
  convidadosNomes: z.array(z.string().trim().min(1)).optional().default([]),
});

async function criarConvidadoComoUsuario(nomeConvidado: string) {
  const cleanName = nomeConvidado.trim().replace(/\s+/g, " ");
  const localPart = cleanName.toLowerCase().replace(/\s+/g, ".");
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 chars para unicidade
  const emailSintetico = `${localPart}+guest.${suffix}@noemail.local`;

  const randomPass = crypto.randomUUID();
  const hashed = await bcrypt.hash(randomPass, 10);

  const convidado = await prisma.usuario.create({
    data: {
      nome: cleanName,
      email: emailSintetico,
      senha: hashed,
      tipo: "CLIENTE",
      celular: null,
      cpf: null,
      nascimento: null,
    },
    select: { id: true, nome: true, email: true },
  });

  return convidado;
}

const diasEnum = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"];

/**
 * ⛳ Finaliza agendamentos CONFIRMADOS cujo dia/horário já passaram.
 * Regras:
 *  1) data < HOJE(UTC00 do dia local)  -> FINALIZADO
 *  2) HOJE <= data < AMANHÃ (utc00) e horario < HH:mm atual -> FINALIZADO
 * Obs: 'horario' no formato 'HH:mm' permite comparação lexicográfica.
 * A GRANDE DIFERENÇA: usamos HOJE/AMANHÃ calculados em UTC 00 com base no dia local,
 * alinhando com o formato em que `data` é salvo (00:00 UTC do dia pretendido).
 */
async function finalizarAgendamentosVencidos() {
  const agora = new Date();
  const { hojeUTC00, amanhaUTC00 } = getStoredUtcBoundaryForLocalDay(agora);

  const hh = String(agora.getHours()).padStart(2, "0");
  const mm = String(agora.getMinutes()).padStart(2, "0");
  const agoraHHMM = `${hh}:${mm}`;

  // 1) Qualquer dia anterior a hoje (usando boundary compatível com armazenamento)
  const r1 = await prisma.agendamento.updateMany({
    where: {
      status: "CONFIRMADO",
      data: { lt: hojeUTC00 },
    },
    data: { status: "FINALIZADO" },
  });

  // 2) Hoje, mas com horário já passado
  const r2 = await prisma.agendamento.updateMany({
    where: {
      status: "CONFIRMADO",
      data: { gte: hojeUTC00, lt: amanhaUTC00 },
      horario: { lt: agoraHHMM },
    },
    data: { status: "FINALIZADO" },
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[finalizarAgendamentosVencidos] < hoje=${r1.count} | hoje<${agoraHHMM}=${r2.count} (boundaries: ${hojeUTC00.toISOString()} .. ${amanhaUTC00.toISOString()})`
    );
  }
}

// Agenda o job a cada 5 min (evita duplicar no hot-reload em DEV)
const globalAny = global as any;
if (!globalAny.__cronFinalizaVencidos__) {
  cron.schedule(
    "1 * * * *",
    () => {
      finalizarAgendamentosVencidos().catch((e) =>
        console.error("Cron finalizarAgendamentosVencidos erro:", e)
      );
    },
    { timezone: process.env.TZ || "America/Sao_Paulo" }
  );
  globalAny.__cronFinalizaVencidos__ = true;
}

router.post("/", verificarToken, async (req, res) => {
  const parsed = agendamentoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.format() });
  }

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  const {
    data, horario, quadraId, esporteId,
    usuarioId: usuarioIdBody,
    jogadoresIds = [],
    convidadosNomes = [],
  } = parsed.data;

  // dono = quem veio no body (admin) OU o usuário do token (cliente)
  const usuarioIdDono = usuarioIdBody || reqCustom.usuario.usuarioLogadoId;

  try {
    // ── checagens de conflito ───────────────────────────────────────────────────
    const diaSemanaEnum = diasEnum[getDay(data)] as DiaSemana;
    const dataInicio = startOfDay(data);
    const dataFim = addDays(dataInicio, 1);

    const agendamentoExistente = await prisma.agendamento.findFirst({
      where: {
        quadraId,
        horario,
        data: { gte: dataInicio, lt: dataFim },
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
      },
    });
    if (agendamentoExistente) {
      return res.status(409).json({ erro: "Já existe um agendamento para essa quadra, data e horário" });
    }

    const conflitoPermanente = await prisma.agendamentoPermanente.findFirst({
      where: { diaSemana: diaSemanaEnum, horario, quadraId, status: { notIn: ["CANCELADO", "TRANSFERIDO"] } },
    });
    if (conflitoPermanente) {
      return res.status(409).json({ erro: "Horário ocupado por um agendamento permanente" });
    }

    // ── cria usuários mínimos para cada convidado ───────────────────────────────
    const convidadosCriadosIds: string[] = [];
    for (const nome of convidadosNomes) {
      const convidado = await criarConvidadoComoUsuario(nome);
      convidadosCriadosIds.push(convidado.id);
    }

    // ── monta todos os jogadores: dono + cadastrados + convidados (sem duplicar) ─
    const connectIds = Array.from(
      new Set<string>([usuarioIdDono, ...jogadoresIds, ...convidadosCriadosIds])
    ).map((id) => ({ id }));

    // ── cria agendamento já conectando jogadores ───────────────────────────────
    const novoAgendamento = await prisma.agendamento.create({
      data: {
        data,
        horario,
        quadraId,
        esporteId,
        usuarioId: usuarioIdDono,
        status: "CONFIRMADO", // se tiver default no schema, pode remover esta linha
        jogadores: { connect: connectIds },
      },
      include: {
        jogadores: { select: { id: true, nome: true, email: true } },
        usuario: { select: { id: true, nome: true, email: true } },
        quadra: { select: { id: true, nome: true, numero: true } },
        esporte: { select: { id: true, nome: true } },
      },
    });

    return res.status(201).json(novoAgendamento);
  } catch (err) {
    console.error("Erro ao criar agendamento", err);
    return res.status(500).json({ erro: "Erro ao criar agendamento" });
  }
});

router.get("/", async (req, res) => {
  const { data, quadraId, usuarioId } = req.query;

  try {
    // monta where de forma flexível
    const where: any = {
      ...(quadraId ? { quadraId: String(quadraId) } : {}),
      ...(usuarioId ? { usuarioId: String(usuarioId) } : {}),
    };

    // se vier "data=YYYY-MM-DD", filtra o dia inteiro (00:00..00:00) em UTC com base no dia local
    if (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const { inicio, fim } = getUtcDayRange(data);
      where.data = { gte: inicio, lt: fim };
    } else if (data) {
      // fallback antigo (não recomendado, mas mantém compat)
      where.data = new Date(String(data));
    }

    const agendamentos = await prisma.agendamento.findMany({
      where,
      include: {
        quadra: {
          select: { id: true, nome: true, numero: true, tipoCamera: true, imagem: true },
        },
        usuario: {
          select: { id: true, nome: true, email: true },
        },
        jogadores: {
          select: { id: true, nome: true, email: true },
        },
        esporte: {
          select: { id: true, nome: true },
        },
      },
      orderBy: [{ data: "asc" }, { horario: "asc" }],
    });

    // acrescenta campo calculado compatível com o front novo/antigo
    const resposta = agendamentos.map(a => ({
      ...a,
      quadraLogoUrl: resolveQuadraImg(a.quadra?.imagem) || "/quadra.png",
    }));

    res.json(resposta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});


// GET /agendamentos/me  (coloque ANTES de "/:id")
router.get("/me", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoNome?: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  try {
    const usuarioId = reqCustom.usuario.usuarioLogadoId;
    const { inicio, fim } = getUtcDayRange(req.query.data as string | undefined);

    const agendamentos = await prisma.agendamento.findMany({
      where: {
        data: { gte: inicio, lt: fim },
        status: { notIn: ["CANCELADO", "TRANSFERIDO"] },
        OR: [{ usuarioId }, { jogadores: { some: { id: usuarioId } } }],
      },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } }, // +imagem
        esporte: { select: { id: true, nome: true } },
        jogadores: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } },
      },
      orderBy: [{ horario: "asc" }],
    });

    const resp = agendamentos.map((a) => {
      const quadraLogoUrl = resolveQuadraImg(a.quadra?.imagem) || "/quadra.png";
      return {
        id: a.id,
        // compat atual:
        nome: a.esporte?.nome ?? "Quadra",
        local: a.quadra ? `${a.quadra.nome} - Nº ${a.quadra.numero}` : "",
        horario: a.horario,
        tipoReserva: "COMUM",
        status: a.status,
        logoUrl: quadraLogoUrl,
        data: a.data.toISOString().slice(0, 10),

        // novos campos para o front:
        quadraNome: a.quadra?.nome ?? "",
        quadraNumero: a.quadra?.numero ?? null,
        quadraLogoUrl,
        esporteNome: a.esporte?.nome ?? "",
      };
    });

    return res.json(resp);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro ao listar agendamentos do usuário" });
  }
});

// 🔎 Lista transferências feitas pelo usuário logado + "para quem" foi transferido
router.get("/transferidos/me", verificarToken, async (req, res) => {
  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) return res.status(401).json({ erro: "Não autenticado" });

  try {
    const usuarioId = reqCustom.usuario.usuarioLogadoId;

    // 1) Pega todos os agendamentos do usuário cujo status é TRANSFERIDO (o “original”)
    const transferidos = await prisma.agendamento.findMany({
      where: { usuarioId, status: "TRANSFERIDO" },
      include: {
        quadra: { select: { id: true, nome: true, numero: true, imagem: true } },
        esporte: { select: { id: true, nome: true } },
      },
      orderBy: [{ data: "desc" }, { horario: "desc" }],
    });
    // se front e back estão em hosts diferentes, configure APP_URL

    // 2) Para cada "original", acha o "novo" agendamento equivalente (mesmo slot) que ficou com o novo usuário
    const resposta = await Promise.all(
      transferidos.map(async (t) => {
        const novo = await prisma.agendamento.findFirst({
          where: {
            id: { not: t.id },
            data: t.data,
            horario: t.horario,
            quadraId: t.quadraId,
            esporteId: t.esporteId,
            status: { notIn: ["CANCELADO", "TRANSFERIDO"] }, // normalmente CONFIRMADO/FINALIZADO
          },
          include: { usuario: { select: { id: true, nome: true, email: true } } },
        });

        const quadraLogoUrl = resolveQuadraImg(t.quadra?.imagem);

        return {
          id: t.id,                                // id do agendamento original (marcado como TRANSFERIDO)
          data: t.data.toISOString().slice(0, 10),
          horario: t.horario,
          status: t.status,                         // "TRANSFERIDO"
          // dados da quadra/esporte para o card:
          quadraNome: t.quadra?.nome ?? "",
          quadraNumero: t.quadra?.numero ?? null,
          quadraImagem: t.quadra?.imagem ?? null,   // se preferir montar no front
          quadraLogoUrl,                            // url já pronta (se APP_URL configurada)
          esporteNome: t.esporte?.nome ?? "",
          // para quem foi transferido:
          transferidoPara: novo?.usuario
            ? { id: novo.usuario.id, nome: novo.usuario.nome, email: novo.usuario.email }
            : null,
          novoAgendamentoId: novo?.id ?? null,
        };
      })
    );

    return res.json(resposta);
  } catch (e) {
    console.error("Erro ao listar transferidos:", e);
    return res.status(500).json({ erro: "Erro ao listar agendamentos transferidos" });
  }
});


// 🚀 Rota manual para finalizar vencidos (útil em DEV/homolog)
router.post("/_finaliza-vencidos", async (_req, res) => {
  try {
    await finalizarAgendamentosVencidos();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Falha ao finalizar vencidos" });
  }
});

// 📄 Detalhes de um agendamento comum
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        jogadores: { select: { id: true, nome: true, email: true } },
        quadra: { select: { nome: true, numero: true } },
        esporte: { select: { nome: true } },
      },
    });

    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    res.json({
      id: agendamento.id,
      tipoReserva: "COMUM",
      dia: agendamento.data.toISOString().split("T")[0],
      horario: agendamento.horario,
      usuario: agendamento.usuario.nome,
      usuarioId: agendamento.usuario.id,
      esporte: agendamento.esporte.nome,
      quadra: `${agendamento.quadra.nome} (Nº ${agendamento.quadra.numero})`,
      jogadores: agendamento.jogadores.map(j => ({ nome: j.nome, email: j.email })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar agendamento" });
  }
});

// ✅ Cancelar agendamento comum
router.post("/cancelar/:id", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const agendamento = await prisma.agendamento.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoPorId: usuarioId,
      },
    });

    res.status(200).json({
      message: "Agendamento cancelado com sucesso.",
      agendamento,
    });
  } catch (error) {
    console.error("Erro ao cancelar agendamento:", error);
    res.status(500).json({ error: "Erro ao cancelar agendamento." });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
    });

    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    await prisma.agendamento.delete({
      where: { id },
    });

    res.json({ message: "Agendamento deletado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao deletar agendamento" });
  }
});

router.patch("/:id/transferir", async (req, res) => {
  const { id } = req.params;
  const { novoUsuarioId, transferidoPorId } = req.body;

  if (!novoUsuarioId) {
    return res.status(400).json({ erro: "Novo usuário é obrigatório" });
  }

  try {
    // 1) busca agendamento original + info necessária
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
      include: { jogadores: true },
    });
    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    // 2) valida novo usuário
    const novoUsuario = await prisma.usuario.findUnique({
      where: { id: novoUsuarioId },
    });
    if (!novoUsuario) {
      return res.status(404).json({ erro: "Novo usuário não encontrado" });
    }

    // 3) transação: marca original como TRANSFERIDO + zera jogadores,
    //    e cria o novo com apenas o novo usuário na lista de jogadores
    const [agendamentoOriginalAtualizado, novoAgendamento] = await prisma.$transaction([
      prisma.agendamento.update({
        where: { id },
        data: {
          status: "TRANSFERIDO",
          transferidoPorId: transferidoPorId ?? null,
          // ZERA os jogadores do agendamento antigo
          jogadores: { set: [] },
        },
        include: { jogadores: true },
      }),

      prisma.agendamento.create({
        data: {
          data: agendamento.data,
          horario: agendamento.horario,
          usuarioId: novoUsuarioId,        // dono do novo agendamento
          quadraId: agendamento.quadraId,
          esporteId: agendamento.esporteId,
          // Apenas o novo usuário como jogador
          jogadores: { connect: [{ id: novoUsuarioId }] },
        },
        include: {
          usuario: true,
          jogadores: true,
          quadra: true,
        },
      }),
    ]);

    return res.status(200).json({
      message: "Agendamento transferido com sucesso",
      agendamentoOriginalId: id,
      novoAgendamento: {
        id: novoAgendamento.id,
        data: novoAgendamento.data,
        horario: novoAgendamento.horario,
        usuario: novoAgendamento.usuario
          ? {
            id: novoAgendamento.usuario.id,
            nome: novoAgendamento.usuario.nome,
            email: novoAgendamento.usuario.email,
          }
          : null,
        jogadores: novoAgendamento.jogadores.map((j) => ({
          id: j.id,
          nome: j.nome,
          email: j.email,
        })),
        quadra: novoAgendamento.quadra
          ? {
            id: novoAgendamento.quadra.id,
            nome: novoAgendamento.quadra.nome,
            numero: novoAgendamento.quadra.numero,
          }
          : null,
      },
    });
  } catch (error) {
    console.error("Erro ao transferir agendamento:", error);
    return res.status(500).json({ erro: "Erro ao transferir agendamento" });
  }
});

router.patch("/:id/jogadores", verificarToken, async (req, res) => {
  const parsed = addJogadoresSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: parsed.error.format() });
  }
  const { jogadoresIds, convidadosNomes } = parsed.data;
  const { id } = req.params;

  const reqCustom = req as typeof req & {
    usuario?: { usuarioLogadoId: string; usuarioLogadoTipo?: string };
  };
  if (!reqCustom.usuario) {
    return res.status(401).json({ erro: "Não autenticado" });
  }

  try {
    // 2) Carrega agendamento
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
      include: { jogadores: { select: { id: true } } },
    });
    if (!agendamento) {
      return res.status(404).json({ erro: "Agendamento não encontrado" });
    }

    if (["CANCELADO", "TRANSFERIDO"].includes(agendamento.status)) {
      return res.status(400).json({ erro: "Não é possível alterar jogadores deste agendamento" });
    }

    // 3) Autorização
    const isAdmin = ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"]
      .includes(reqCustom.usuario.usuarioLogadoTipo || "");
    const isOwner = agendamento.usuarioId === reqCustom.usuario.usuarioLogadoId;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ erro: "Sem permissão para alterar este agendamento" });
    }

    // 4) Buscar usuários válidos por ID (se houver)
    const usuariosValidos = jogadoresIds.length
      ? await prisma.usuario.findMany({
        where: { id: { in: jogadoresIds } },
        select: { id: true },
      })
      : [];

    if (usuariosValidos.length !== jogadoresIds.length) {
      return res.status(400).json({ erro: "Um ou mais jogadores não existem" });
    }

    // 5) Criar “convidados” (usuarios mínimos) e coletar IDs
    const hashDefault = await bcrypt.hash("convidado123", 10);

    // tipagem explícita para não virar never[]
    const convidadosCriados: Array<{ id: string }> = [];

    for (const nome of convidadosNomes) {
      const emailFake = `convidado+${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;

      const novo = await prisma.usuario.create({
        data: {
          nome,
          email: emailFake,
          senha: hashDefault,   // campo senha é obrigatório no seu schema
          tipo: "CLIENTE",
        },
        select: { id: true },
      });

      convidadosCriados.push({ id: novo.id });
    }

    // 6) Evitar duplicatas (IDs já conectados no agendamento)
    const jaConectados = new Set(agendamento.jogadores.map((j) => j.id));

    // IDs de usuários existentes (filtrar só os que ainda não estão)
    const idsNovosExistentes = usuariosValidos
      .map((u) => u.id)
      .filter((uid) => !jaConectados.has(uid));

    // IDs dos convidados criados (todos são novos)
    const idsConvidados = convidadosCriados.map((c) => c.id);

    // Se não há nada novo, retorna o agendamento atual
    if (idsNovosExistentes.length === 0 && idsConvidados.length === 0) {
      const atual = await prisma.agendamento.findUnique({
        where: { id },
        include: { usuario: true, jogadores: true, quadra: true, esporte: true },
      });
      return res.json(atual);
    }

    // 7) Conecta tudo de uma vez
    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        jogadores: {
          connect: [
            ...idsNovosExistentes.map((jid) => ({ id: jid })),
            ...idsConvidados.map((jid) => ({ id: jid })),
          ],
        },
      },
      include: { usuario: true, jogadores: true, quadra: true, esporte: true },
    });

    return res.json({
      id: atualizado.id,
      data: atualizado.data,
      horario: atualizado.horario,
      status: atualizado.status,
      usuario: atualizado.usuario
        ? { id: atualizado.usuario.id, nome: atualizado.usuario.nome, email: atualizado.usuario.email }
        : null,
      jogadores: atualizado.jogadores.map((j) => ({ id: j.id, nome: j.nome, email: j.email })),
      quadra: atualizado.quadra
        ? { id: atualizado.quadra.id, nome: atualizado.quadra.nome, numero: atualizado.quadra.numero }
        : null,
      esporte: atualizado.esporte ? { id: atualizado.esporte.id, nome: atualizado.esporte.nome } : null,
    });
  } catch (err) {
    console.error("Erro ao adicionar jogadores:", err);
    return res.status(500).json({ erro: "Erro ao adicionar jogadores ao agendamento" });
  }
});

export default router;
