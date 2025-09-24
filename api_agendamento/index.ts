import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from "path";
import cookieParser from "cookie-parser";

import './utils/audit';

import routesLogin from './routes/login';
import routesClientes from './routes/clientes';
import routesRecuperacao from "./routes/recuperacao";
import routesAdmin from "./routes/admin";
import routesEsportes from "./routes/esportes";
import routesQuadras from "./routes/quadras";
import routesAgendamentos from "./routes/agendamentos";
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

import verificarToken from "./middleware/authMiddleware";  // middleware de auth

const app = express();
const port = 3001;

// Middlewares
app.use(express.json());
app.use(cookieParser());

// Configurar CORS para aceitar cookies
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000", // URL do seu front
  credentials: true,
}));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Rotas públicas (sem auth)
app.use('/login', routesLogin);
app.use('/clientes', routesClientes);
app.use('/recuperacao', routesRecuperacao);
app.use('/admin', routesAdmin); // Se quiser, pode proteger depois

// Middleware para proteger rotas abaixo
app.use(verificarToken);

// Rotas protegidas (exigem token válido)
app.use('/esportes', routesEsportes);
app.use('/quadras', routesQuadras);
app.use('/agendamentos', routesAgendamentos);
app.use('/agendamentosPermanentes', routesAgendamentosPermanentes);
app.use('/disponibilidade', routesDisponibilidade);
app.use("/proximaDataPermanenteDisponivel", proximaDataPermanenteDisponivel);
app.use('/churrasqueiras', routesChurrasqueiras);
app.use('/agendamentosChurrasqueiras', routesAgendamentosChurrasqueiras);
app.use('/agendamentosPermanentesChurrasqueiras', routesAgendamentosPermanentesChurrasqueiras);
app.use('/disponibilidadeChurrasqueiras', routesDisponibilidadeChurrasqueiras);
app.use('/disponibilidadeGeral', routesDisponibilidadeGeral);
app.use("/usuariosAdmin", routesUsuariosAdmin);
app.use("/bloqueios", routesBloqueios);
app.use("/usuarios", routesUsuarios);
app.use("/audit", routesAudit); 

// Rota raiz
app.get('/', (req, res) => {
  res.send('API: Eleven');
});

// Start server
app.listen(port, () => {
  console.log(`Servidor rodando na porta: ${port}`);
});
