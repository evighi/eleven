// index.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import cookieParser from "cookie-parser";

import { initAuditRetentionScheduler } from "./utils/audit"; // purge audit 90d
import { scheduleLimpezaDiaria } from "./src/limpezaAgendamentos"; // 👈 volta o job de agendamentos antigos

import routesLogin from "./routes/login";
import routesClientes from "./routes/clientes";
import routesRecuperacao from "./routes/recuperacao";
import routesAdmin from "./routes/admin";
import routesEsportes from "./routes/esportes";
import routesQuadras from "./routes/quadras";
import routesAgendamentos from "./routes/agendamentos"; // cron hh:01 continua aqui
import routesAgendamentosPermanentes from "./routes/agendamentosPermanentes";
import routesDisponibilidade from "./routes/disponibilidade";
import proximaDataPermanenteDisponivel from "./routes/proximaDataPermanenteDisponivel";
import routesChurrasqueiras from "./routes/churrasqueiras";
import routesAgendamentosChurrasqueiras from "./routes/agendamentosChurrasqueiras";
import routesAgendamentosPermanentesChurrasqueiras from "./routes/agendamentosPermanentesChurrasqueiras";
import routesDisponibilidadeChurrasqueiras from "./routes/disponibilidadeChurrasqueiras";
import routesDisponibilidadeGeral from "./routes/disponibilidadeGeral";
import routesUsuariosAdmin from "./routes/usuariosAdmin";
import routesBloqueios from "./routes/bloqueios";
import routesUsuarios from "./routes/usuarios";
import routesAudit from "./routes/audit";
import routesProfessores from "./routes/professores";

// 👇 NOVO: rota de deleções (pendências + desfazer)
import routesDelecoes from "./routes/delecoes";

import verificarToken from "./middleware/authMiddleware";

const app = express();
const port = Number(process.env.PORT || 3001);

// Middlewares
app.use(express.json());
app.use(cookieParser());

// CORS (com cookies)
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Arquivos estáticos
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Rotas públicas
app.use("/login", routesLogin);
app.use("/clientes", routesClientes);
app.use("/recuperacao", routesRecuperacao);
app.use("/admin", routesAdmin);

// Auth global para as próximas
app.use(verificarToken);

// Rotas protegidas
app.use("/esportes", routesEsportes);
app.use("/quadras", routesQuadras);
app.use("/agendamentos", routesAgendamentos);
app.use("/agendamentosPermanentes", routesAgendamentosPermanentes);
app.use("/disponibilidade", routesDisponibilidade);
app.use("/proximaDataPermanenteDisponivel", proximaDataPermanenteDisponivel);
app.use("/churrasqueiras", routesChurrasqueiras);
app.use("/agendamentosChurrasqueiras", routesAgendamentosChurrasqueiras);
app.use("/agendamentosPermanentesChurrasqueiras", routesAgendamentosPermanentesChurrasqueiras);
app.use("/disponibilidadeChurrasqueiras", routesDisponibilidadeChurrasqueiras);
app.use("/disponibilidadeGeral", routesDisponibilidadeGeral);
app.use("/usuariosAdmin", routesUsuariosAdmin);
app.use("/bloqueios", routesBloqueios);
app.use("/usuarios", routesUsuarios);
app.use("/audit", routesAudit);
app.use("/professores", routesProfessores);

// 👇 NOVO: expõe as rotas de deleções (precisa ser protegida)
app.use("/delecoes", routesDelecoes);

// Health/root
app.get("/", (_req, res) => {
  res.send("API: Eleven");
});

// Start server
app.listen(port, () => {
  console.log(`Servidor rodando na porta: ${port}`);

  // ✅ cron de “finalizar vencidos” continua dentro de routes/agendamentos.ts (hh:01)
  // ✅ inicia o scheduler de purga de logs (90 dias)
  initAuditRetentionScheduler();

  // ✅ inicia o job de limpeza de agendamentos antigos (o que já tínhamos adicionado)
  scheduleLimpezaDiaria();
});
