"use client";
import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";
import Spinner from "@/components/Spinner";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** Helpers de data/hora em America/Sao_Paulo */
const SP_TZ = "America/Sao_Paulo";
const todayStrSP = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // ex: 2025-03-07

const hourStrSP = (d = new Date()) => {
  const hh = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SP_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(d),
    10
  );
  const clamped = Math.min(23, Math.max(7, hh)); // janela 07..23
  return `${String(clamped).padStart(2, "0")}:00`;
};

/* ================== TIPAGENS ================== */
type TipoReserva = "comum" | "permanente";
type Turno = "DIA" | "NOITE";
type TipoLocal = "quadra" | "churrasqueira";

interface UsuarioRef {
  id?: string;
  nome?: string;
  email?: string;
}

interface DisponQuadra {
  quadraId: string;
  nome: string;
  numero: number;
  disponivel: boolean;
  bloqueada?: boolean;
  usuario?: UsuarioRef;
  tipoReserva?: TipoReserva;
  agendamentoId?: string;
  id?: string;
  tipoLocal?: TipoLocal;
}

interface ChurrasTurno {
  turno: Turno;
  disponivel: boolean;
  usuario?: UsuarioRef;
  tipoReserva?: TipoReserva;
  agendamentoId?: string;
  id?: string;
}

interface ChurrasqueiraDisp {
  churrasqueiraId: string;
  nome: string;
  numero: number;
  disponibilidade: ChurrasTurno[];
  disponivel?: boolean;
  tipoReserva?: TipoReserva;
}

interface DisponibilidadeGeral {
  quadras: Record<string, DisponQuadra[]>;
  churrasqueiras: ChurrasqueiraDisp[];
}

interface DetalheItemMin {
  agendamentoId?: string;
  id?: string;
  tipoLocal?: TipoLocal;
  tipoReserva?: TipoReserva;
}

interface DetalheExtra {
  horario?: string;
  turno?: Turno;
  esporte?: string;
}

interface JogadorRef {
  nome: string;
}

interface AgendamentoSelecionado {
  dia: string;
  horario?: string | null;
  turno?: Turno | null;
  usuario: string | UsuarioRef | "—";
  jogadores: JogadorRef[];
  esporte?: string | null;
  tipoReserva: TipoReserva;
  agendamentoId: string;
  tipoLocal: TipoLocal;
  // novos (para exceção):
  diaSemana?: string | null;
  dataInicio?: string | null; // YYYY-MM-DD
}

interface UsuarioLista {
  id: string;
  nome: string;
  email?: string;
}

/** Novo: pré-reserva para confirmar agendar comum */
type PreReserva = {
  data: string;
  horario: string;
  esporte: string; // se seu agendarcomum espera ID, troque para esporteId
  quadraId: string;
  quadraNome: string;
  quadraNumero: number;
};
/* ============================================= */

/** Map DiaSemana -> index JS */
const DIA_IDX: Record<string, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

/** Formata Date -> YYYY-MM-DD em SP */
function toYmdSP(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function toDdMm(isoYmd: string) {
  const [y, m, d] = isoYmd.split("-");
  return `${d}-${m}`;
}

/** Próximas datas do mesmo dia-da-semana. */
function gerarProximasDatasDiaSemana(
  diaSemana: string,
  baseYmd?: string | null,
  dataInicio?: string | null,
  quantidade = 4,
  incluirBase = true
): string[] {
  const target = DIA_IDX[diaSemana] ?? 0;

  // Base em SP (início do dia)
  const baseIso = (baseYmd || todayStrSP()) + "T00:00:00-03:00";
  const start = new Date(baseIso);
  start.setHours(0, 0, 0, 0);

  // Respeita dataInicio (se for mais à frente que a base)
  if (dataInicio) {
    const di = new Date(`${dataInicio}T00:00:00-03:00`);
    di.setHours(0, 0, 0, 0);
    if (di > start) start.setTime(di.getTime());
  }

  const startDow = start.getDay(); // 0..6
  let delta = (target - startDow + 7) % 7; // 0 significa “mesmo dia da semana”
  if (delta === 0 && !incluirBase) delta = 7; // pular para a próxima semana se não quiser incluir a base

  const first = new Date(start);
  first.setDate(first.getDate() + delta);

  const out: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i * 7);
    out.push(toYmdSP(d));
  }
  return out;
}

export default function AdminHome() {
  const router = useRouter();

  const [data, setData] = useState("");
  const [horario, setHorario] = useState("");

  const [disponibilidade, setDisponibilidade] = useState<DisponibilidadeGeral | null>(null);
  const [loadingDispon, setLoadingDispon] = useState<boolean>(true);

  const [agendamentoSelecionado, setAgendamentoSelecionado] =
    useState<AgendamentoSelecionado | null>(null);
  const [loadingDetalhes, setLoadingDetalhes] = useState<boolean>(false);

  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false); // fluxo antigo
  const [loadingCancelamento, setLoadingCancelamento] = useState(false);
  const [loadingTransferencia, setLoadingTransferencia] = useState(false);

  // Opções p/ permanente
  const [mostrarOpcoesCancelamento, setMostrarOpcoesCancelamento] = useState(false);
  const [confirmarCancelamentoForever, setConfirmarCancelamentoForever] = useState(false);

  // Exceção (cancelar 1 dia)
  const [mostrarExcecaoModal, setMostrarExcecaoModal] = useState(false);
  const [datasExcecao, setDatasExcecao] = useState<string[]>([]);
  const [dataExcecaoSelecionada, setDataExcecaoSelecionada] = useState<string | null>(null);
  const [postandoExcecao, setPostandoExcecao] = useState(false);

  // Transferência
  const [abrirModalTransferencia, setAbrirModalTransferencia] = useState(false);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [usuariosFiltrados, setUsuariosFiltrados] = useState<UsuarioLista[]>([]);
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<UsuarioLista | null>(null);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);

  // ➕ Adicionar jogadores
  const [abrirModalJogadores, setAbrirModalJogadores] = useState(false);
  const [buscaJogador, setBuscaJogador] = useState("");
  const [usuariosParaJogadores, setUsuariosParaJogadores] = useState<UsuarioLista[]>([]);
  const [jogadoresSelecionadosIds, setJogadoresSelecionadosIds] = useState<string[]>([]);
  const [convidadoNome, setConvidadoNome] = useState("");
  const [convidadosPendentes, setConvidadosPendentes] = useState<string[]>([]);
  const [carregandoJogadores, setCarregandoJogadores] = useState(false);
  const [addingPlayers, setAddingPlayers] = useState(false);

  // Novo: confirmação para agendar comum quando quadra está livre
  const [mostrarConfirmaAgendar, setMostrarConfirmaAgendar] = useState(false);
  const [preReserva, setPreReserva] = useState<PreReserva | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const { usuario } = useAuthStore();

  const isAllowed =
    !!usuario &&
    ["ADMIN_MASTER", "ADMIN_PROFESSORES"].includes((usuario as { tipo?: string }).tipo || "");

  const buscarDisponibilidade = useCallback(async () => {
    if (!isAllowed) return;
    if (!data || !horario) {
      setLoadingDispon(true);
      return;
    }
    setLoadingDispon(true);
    try {
      const res = await axios.get<DisponibilidadeGeral>(`${API_URL}/disponibilidadeGeral/geral`, {
        params: { data, horario },
        withCredentials: true,
      });
      setDisponibilidade(res.data);
    } catch (error) {
      console.error(error);
      setDisponibilidade(null);
    } finally {
      setLoadingDispon(false);
    }
  }, [API_URL, data, horario, isAllowed]);

  // 🔧 Inicializa data/horário (SP)
  useEffect(() => {
    setData(todayStrSP());
    setHorario(hourStrSP());
  }, []);

  // Busca disponibilidade quando data/horário mudam
  useEffect(() => {
    buscarDisponibilidade();
  }, [buscarDisponibilidade]);

  // Detalhes
  const abrirDetalhes = async (item: DetalheItemMin, extra?: DetalheExtra) => {
    const agendamentoId = item.agendamentoId || item.id;
    if (!agendamentoId || !item.tipoReserva) return;

    const tipoLocal: TipoLocal = item.tipoLocal || "quadra";

    let rota = "";
    if (tipoLocal === "churrasqueira") {
      rota =
        item.tipoReserva === "permanente"
          ? `agendamentosPermanentesChurrasqueiras/${agendamentoId}`
          : `agendamentosChurrasqueiras/${agendamentoId}`;
    } else {
      rota =
        item.tipoReserva === "permanente"
          ? `agendamentosPermanentes/${agendamentoId}`
          : `agendamentos/${agendamentoId}`;
    }

    try {
      setLoadingDetalhes(true);
      const res = await axios.get(`${API_URL}/${rota}`, { withCredentials: true });

      setAgendamentoSelecionado({
        dia: data,
        horario: extra?.horario || null,
        turno: extra?.turno || null,
        usuario: (res.data as { usuario?: string | UsuarioRef })?.usuario || "—",
        jogadores: (res.data as { jogadores?: JogadorRef[] })?.jogadores || [],
        esporte:
          extra?.esporte || (res.data as { esporte?: { nome?: string } })?.esporte?.nome || null,
        tipoReserva: item.tipoReserva,
        agendamentoId,
        tipoLocal,
        // backend de quadra e churrasqueira retornam diaSemana/dataInicio para permanentes
        diaSemana: (res.data as any)?.diaSemana ?? null,
        dataInicio:
          (res.data as any)?.dataInicio
            ? String((res.data as any).dataInicio).slice(0, 10)
            : null,
      });
    } catch (error) {
      console.error("Erro ao buscar detalhes:", error);
    } finally {
      setLoadingDetalhes(false);
    }
  };

  /** Decide qual modal abrir quando clicar em "Cancelar Agendamento" */
  const abrirFluxoCancelamento = () => {
    if (!agendamentoSelecionado) return;
    const { tipoReserva } = agendamentoSelecionado;

    // Para qualquer permanente (quadra OU churrasqueira), mostrar opções
    if (tipoReserva === "permanente") {
      setMostrarOpcoesCancelamento(true);
    } else {
      // fluxo antigo: confirmação simples
      setConfirmarCancelamento(true);
    }
  };

  // Cancelar (POST) — usado no fluxo antigo e também no "para sempre"
  const cancelarAgendamento = async () => {
    if (!agendamentoSelecionado) return;
    setLoadingCancelamento(true);

    const { agendamentoId, tipoReserva, tipoLocal } = agendamentoSelecionado;

    let rota = "";
    if (tipoLocal === "churrasqueira") {
      rota =
        tipoReserva === "permanente"
          ? `agendamentosPermanentesChurrasqueiras/cancelar/${agendamentoId}`
          : `agendamentosChurrasqueiras/cancelar/${agendamentoId}`;
    } else {
      rota =
        tipoReserva === "permanente"
          ? `agendamentosPermanentes/cancelar/${agendamentoId}`
          : `agendamentos/cancelar/${agendamentoId}`;
    }

    try {
      await axios.post(`${API_URL}/${rota}`, {}, { withCredentials: true });
      alert("Agendamento cancelado com sucesso!");
      setAgendamentoSelecionado(null);
      setConfirmarCancelamento(false);
      setMostrarOpcoesCancelamento(false);
      setConfirmarCancelamentoForever(false);
      buscarDisponibilidade();
    } catch (error) {
      console.error("Erro ao cancelar agendamento:", error);
      alert("Erro ao cancelar agendamento.");
    } finally {
      setLoadingCancelamento(false);
    }
  };

  // Abrir modal de exceção (cancelar apenas 1 dia)
  const abrirExcecao = () => {
    if (!agendamentoSelecionado?.diaSemana) {
      alert("Não foi possível identificar o dia da semana deste permanente.");
      return;
    }

    // agora: só 6 datas e inclui a base (data selecionada)
    const lista = gerarProximasDatasDiaSemana(
      agendamentoSelecionado.diaSemana,
      data || todayStrSP(),
      agendamentoSelecionado.dataInicio || null,
      6, // quantidade
      true // incluir a própria base, se for o mesmo dia da semana
    );

    setDatasExcecao(lista);
    setDataExcecaoSelecionada(null);
    setMostrarExcecaoModal(true);
    setMostrarOpcoesCancelamento(false);
  };

  /** Confirma a exceção chamando o endpoint POST correto (quadra/churrasqueira) */
  const confirmarExcecao = async () => {
    if (!agendamentoSelecionado?.agendamentoId || !dataExcecaoSelecionada) return;
    try {
      setPostandoExcecao(true);

      const rota =
        agendamentoSelecionado.tipoLocal === "churrasqueira"
          ? `agendamentosPermanentesChurrasqueiras/${agendamentoSelecionado.agendamentoId}/cancelar-dia`
          : `agendamentosPermanentes/${agendamentoSelecionado.agendamentoId}/cancelar-dia`;

      await axios.post(
        `${API_URL}/${rota}`,
        { data: dataExcecaoSelecionada, usuarioId: (usuario as any)?.id },
        { withCredentials: true }
      );

      alert("Exceção criada com sucesso (cancelado somente este dia).");
      setMostrarExcecaoModal(false);
      setAgendamentoSelecionado(null);
      buscarDisponibilidade();
    } catch (e: any) {
      console.error(e);
      const raw = e?.response?.data?.erro ?? e?.response?.data?.message ?? e?.message;
      const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
      alert(msg);
    } finally {
      setPostandoExcecao(false);
    }
  };

  // Buscar usuários (transferência)
  const [abrirModalTransferenciaState] = useState(false); // placeholder (não alterar comportamento)
  const buscarUsuarios = useCallback(
    async (termo: string) => {
      if (termo.trim().length === 0) {
        setUsuariosFiltrados([]);
        return;
      }
      setCarregandoUsuarios(true);
      try {
        const res = await axios.get<UsuarioLista[]>(`${API_URL}/clientes`, {
          params: { nome: buscaUsuario },
          withCredentials: true,
        });
        setUsuariosFiltrados(res.data);
      } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        setUsuariosFiltrados([]);
      } finally {
        setCarregandoUsuarios(false);
      }
    },
    [API_URL, buscaUsuario]
  );

  useEffect(() => {
    const t = setTimeout(() => buscarUsuarios(buscaUsuario), 300);
    return () => clearTimeout(t);
  }, [buscaUsuario, buscarUsuarios]);

  const abrirModalTransferir = () => {
    setBuscaUsuario("");
    setUsuariosFiltrados([]);
    setUsuarioSelecionado(null);
    setAbrirModalTransferencia(true);
  };

  const confirmarTransferencia = async () => {
    if (!agendamentoSelecionado) return alert("Nenhum agendamento selecionado.");
    if (!usuarioSelecionado) return alert("Selecione um usuário para transferir.");

    setLoadingTransferencia(true);
    try {
      await axios.patch(
        `${API_URL}/agendamentos/${agendamentoSelecionado.agendamentoId}/transferir`,
        {
          novoUsuarioId: usuarioSelecionado.id,
          transferidoPorId: usuarioSelecionado.id, // ajuste se necessário
        },
        { withCredentials: true }
      );

      alert("Agendamento transferido com sucesso!");
      setAgendamentoSelecionado(null);
      setAbrirModalTransferencia(false);
      buscarDisponibilidade();
    } catch (error) {
      console.error("Erro ao transferir agendamento:", error);
      alert("Erro ao transferir agendamento.");
    } finally {
      setLoadingTransferencia(false);
    }
  };

  // ====== ➕ ADICIONAR JOGADORES ======
  const abrirModalAdicionarJogadores = () => {
    setBuscaJogador("");
    setUsuariosParaJogadores([]);
    setJogadoresSelecionadosIds([]);
    setConvidadoNome("");
    setConvidadosPendentes([]);
    setAbrirModalJogadores(true);
  };

  const buscarUsuariosParaJogadores = useCallback(
    async (termo: string) => {
      if (termo.trim().length < 2) {
        setUsuariosParaJogadores([]);
        return;
      }
      setCarregandoJogadores(true);
      try {
        const res = await axios.get<UsuarioLista[]>(`${API_URL}/clientes`, {
          params: { nome: termo },
          withCredentials: true,
        });
        setUsuariosParaJogadores(res.data || []);
      } catch (e) {
        console.error(e);
        setUsuariosParaJogadores([]);
      } finally {
        setCarregandoJogadores(false);
      }
    },
    [API_URL]
  );

  useEffect(() => {
    const t = setTimeout(() => buscarUsuariosParaJogadores(buscaJogador), 300);
    return () => clearTimeout(t);
  }, [buscaJogador, buscarUsuariosParaJogadores]);

  const alternarSelecionado = (id: string) => {
    setJogadoresSelecionadosIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const adicionarConvidado = () => {
    const nome = convidadoNome.trim();
    if (!nome) return;
    if (!convidadosPendentes.includes(nome)) {
      setConvidadosPendentes((prev) => [...prev, nome]);
    }
    setConvidadoNome("");
  };

  const removerConvidado = (nome: string) => {
    setConvidadosPendentes((prev) => prev.filter((n) => n !== nome));
  };

  const confirmarAdicionarJogadores = async () => {
    if (!agendamentoSelecionado?.agendamentoId) return;

    try {
      setAddingPlayers(true);

      await axios.patch(
        `${API_URL}/agendamentos/${agendamentoSelecionado.agendamentoId}/jogadores`,
        {
          jogadoresIds: jogadoresSelecionadosIds,
          convidadosNomes: convidadosPendentes,
        },
        { withCredentials: true }
      );

      alert("Jogadores adicionados com sucesso!");

      setJogadoresSelecionadosIds([]);
      setConvidadosPendentes([]);
      setConvidadoNome("");
      setAbrirModalJogadores(false);

      buscarDisponibilidade();
    } catch (e) {
      console.error(e);
      alert("Erro ao adicionar jogadores.");
    } finally {
      setAddingPlayers(false);
    }
  };

  // ====== NOVO: confirmação para agendar comum quando quadra está livre ======
  const abrirConfirmacaoAgendar = (info: PreReserva) => {
    setPreReserva(info);
    setMostrarConfirmaAgendar(true);
  };

  const irParaAgendarComum = () => {
    if (!preReserva) return;
    const qs = new URLSearchParams({
      data: preReserva.data,
      horario: preReserva.horario,
      esporte: preReserva.esporte, // troque para esporteId se necessário
      quadraId: preReserva.quadraId,
    }).toString();

    // ajuste o caminho se seu agendarcomum estiver em outro diretório
    router.push(`/adminMaster/quadras/agendarComum?${qs}`);
  };

  return (
    <div className="space-y-8">
      {/* FILTROS */}
      <div className="bg-white p-4 shadow rounded-lg flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex flex-col w-full sm:w-auto">
          <label className="text-sm text-gray-600">Data</label>
          <input
            type="date"
            className="border p-2 rounded-lg"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>

        <div className="flex flex-col w-full sm:w-auto">
          <label className="text-sm text-gray-600">Horário</label>
          <select
            className="border p-2 rounded-lg"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
          >
            <option value="">Selecione</option>
            {Array.from({ length: 17 }, (_, i) => {
              const hora = (7 + i).toString().padStart(2, "0") + ":00";
              return (
                <option key={hora} value={hora}>
                  {hora}
                </option>
              );
            })}
          </select>
        </div>

        {/* Botão que leva para a página "todosHorarios" */}
        <div className="sm:ml-auto">
          <Link
            href={`/adminMaster/todosHorarios`}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg font-semibold bg-orange-600 hover:bg-orange-700 text-white cursor-pointer"
          >
            Ver todos os horários
          </Link>
        </div>
      </div>

      {/* DISPONIBILIDADE */}
      {loadingDispon || !disponibilidade ? (
        <div className="flex items-center gap-2 text-gray-600">
          <Spinner />
          <span>Carregando disponibilidade…</span>
        </div>
      ) : (
        <div className="space-y-10">
          {/* QUADRAS */}
          {Object.keys(disponibilidade.quadras).map((esporte) => (
            <div key={esporte}>
              <div className="flex items-center mb-4">
                <h2 className="text-lg font-semibold text-orange-700">
                  {esporte}, {horario}
                </h2>
                <div className="flex-1 border-t border-gray-300 ml-3" />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                {disponibilidade.quadras[esporte].map((q: DisponQuadra) => {
                  const clickable = !q.bloqueada; // bloqueada não clica
                  const clsBase =
                    "p-3 rounded-lg text-center shadow-sm flex flex-col justify-center " +
                    (clickable ? "cursor-pointer" : "cursor-not-allowed");

                  return (
                    <div
                      key={q.quadraId}
                      onClick={() => {
                        if (q.bloqueada) return;
                        if (q.disponivel) {
                          abrirConfirmacaoAgendar({
                            data,
                            horario,
                            esporte,
                            quadraId: q.quadraId,
                            quadraNome: q.nome,
                            quadraNumero: q.numero,
                          });
                        } else {
                          abrirDetalhes(q, { horario, esporte });
                        }
                      }}
                      className={`${clsBase} ${
                        q.bloqueada
                          ? "border-2 border-red-500 bg-red-50"
                          : q.disponivel
                          ? "border-2 border-green-500 bg-green-50"
                          : "border-2 border-gray-500 bg-gray-50"
                      }`}
                    >
                      <p className="font-medium">{q.nome}</p>
                      <p className="text-xs text-gray-700">Quadra {q.numero}</p>
                      {q.bloqueada && <div className="text-red-600 font-bold">Bloqueada</div>}
                      {!q.disponivel && (
                        <div>
                          <p className="font-bold">{q.usuario?.nome}</p>
                          {q.tipoReserva}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* CHURRASQUEIRAS */}
          <div>
            <div className="flex items-center mb-4">
              <h2 className="text-lg font-semibold text-orange-700">Churrasqueiras</h2>
              <div className="flex-1 border-t border-gray-300 ml-3" />
            </div>

            {/* Dia */}
            <h3 className="text-sm font-semibold mb-2 text-gray-800">Dia</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4 mb-6">
              {disponibilidade.churrasqueiras.map((c: ChurrasqueiraDisp) => {
                const diaInfo = c.disponibilidade.find((t) => t.turno === "DIA");
                const disponivel = !!diaInfo?.disponivel;

                return (
                  <div
                    key={c.churrasqueiraId + "-dia"}
                    onClick={() =>
                      !disponivel &&
                      abrirDetalhes(
                        { ...(diaInfo as DetalheItemMin), tipoLocal: "churrasqueira" },
                        { turno: "DIA" }
                      )
                    }
                    className={`p-3 rounded-lg text-center shadow-sm flex flex-col justify-center cursor-pointer ${
                      disponivel
                        ? "border-2 border-green-500 bg-green-50"
                        : "border-2 border-gray-500 bg-gray-50"
                    }`}
                  >
                    <p className="font-medium">{c.nome}</p>
                    <p className="text-xs text-gray-700">Churrasqueira {c.numero}</p>

                    {!disponivel && (
                      <div className="mt-1">
                        <p className="font-bold">{diaInfo?.usuario?.nome}</p>
                        <span className="inline-block text-[11px] px-2 py-0.5 rounded bg-white/70">
                          {diaInfo?.tipoReserva === "permanente" ? "Permanente" : "Comum"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Noite */}
            <h3 className="text-sm font-semibold mb-2 text-gray-800">Noite</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
              {disponibilidade.churrasqueiras.map((c: ChurrasqueiraDisp) => {
                const noiteInfo = c.disponibilidade.find((t) => t.turno === "NOITE");
                const disponivel = !!noiteInfo?.disponivel;

                return (
                  <div
                    key={c.churrasqueiraId + "-noite"}
                    onClick={() =>
                      !disponivel &&
                      abrirDetalhes(
                        { ...(noiteInfo as DetalheItemMin), tipoLocal: "churrasqueira" },
                        { turno: "NOITE" }
                      )
                    }
                    className={`p-3 rounded-lg text-center shadow-sm flex flex-col justify-center cursor-pointer ${
                      disponivel
                        ? "border-2 border-green-500 bg-green-50"
                        : "border-2 border-gray-500 bg-gray-50"
                    }`}
                  >
                    <p className="font-medium">{c.nome}</p>
                    <p className="text-xs text-gray-700">Churrasqueira {c.numero}</p>

                    {!disponivel && (
                      <div className="mt-1">
                        <p className="font-bold">{noiteInfo?.usuario?.nome}</p>
                        <span className="inline-block text-[11px] px-2 py-0.5 rounded bg-white/70">
                          {noiteInfo?.tipoReserva === "permanente" ? "Permanente" : "Comum"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY: carregando detalhes */}
      {loadingDetalhes && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-md px-4 py-3">
            <div className="flex items-center gap-2 text-gray-700">
              <Spinner /> <span>Carregando detalhes…</span>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES */}
      {agendamentoSelecionado && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-80 relative max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-semibold mb-4">Detalhes do Agendamento</h2>
            <p>
              <strong>Dia:</strong> {agendamentoSelecionado.dia}
            </p>
            {agendamentoSelecionado.horario && (
              <p>
                <strong>Horário:</strong> {agendamentoSelecionado.horario}
              </p>
            )}
            {agendamentoSelecionado.turno && (
              <p>
                <strong>Turno:</strong> {agendamentoSelecionado.turno}
              </p>
            )}
            <p>
              <strong>Usuário:</strong> {agendamentoSelecionado.usuario as string}
            </p>
            {agendamentoSelecionado.esporte && (
              <p>
                <strong>Esporte:</strong> {agendamentoSelecionado.esporte}
              </p>
            )}
            <p>
              <strong>Tipo:</strong> {agendamentoSelecionado.tipoReserva}
            </p>

            {agendamentoSelecionado.tipoReserva === "comum" &&
              agendamentoSelecionado.tipoLocal === "quadra" && (
                <div className="mt-2">
                  <div className="flex items-center justify-between">
                    <strong>Jogadores:</strong>
                    <button
                      type="button"
                      onClick={abrirModalAdicionarJogadores}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                      title="Adicionar jogadores"
                    >
                      +
                    </button>
                  </div>

                  <ul className="list-disc list-inside text-sm text-gray-700 mt-2">
                    {agendamentoSelecionado.jogadores.length > 0 ? (
                      agendamentoSelecionado.jogadores.map((j, idx) => (
                        <li key={idx}>{j.nome}</li>
                      ))
                    ) : (
                      <li>Nenhum jogador cadastrado</li>
                    )}
                  </ul>
                </div>
              )}

            {/* Transferir (somente comum/quadra) */}
            {agendamentoSelecionado.tipoReserva === "comum" &&
              agendamentoSelecionado.tipoLocal === "quadra" && (
                <button
                  onClick={abrirModalTransferir}
                  disabled={loadingTransferencia}
                  className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded cursor-pointer"
                >
                  {loadingTransferencia ? "Transferindo..." : "Transferir Agendamento"}
                </button>
              )}

            <button
              onClick={abrirFluxoCancelamento}
              className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded cursor-pointer"
            >
              Cancelar Agendamento
            </button>

            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="mt-2 w-full bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded cursor-pointer"
            >
              Fechar
            </button>

            {/* Fluxo antigo: confirmação simples */}
            {confirmarCancelamento && (
              <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-50">
                <p className="text-center text-white mb-4">
                  Tem certeza que deseja cancelar este agendamento?
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={cancelarAgendamento}
                    disabled={loadingCancelamento}
                    className="bg-red-600 text-white px-4 py-1 rounded hover:bg-red-700 transition cursor-pointer"
                  >
                    {loadingCancelamento ? "Cancelando..." : "Sim"}
                  </button>
                  <button
                    onClick={() => setConfirmarCancelamento(false)}
                    className="bg-gray-300 text-black px-4 py-1 rounded hover:bg-gray-400 transition cursor-pointer"
                  >
                    Não
                  </button>
                </div>
              </div>
            )}

            {/* Opções para AGENDAMENTO PERMANENTE */}
            {mostrarOpcoesCancelamento && (
              <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-50">
                <div className="bg-white rounded-lg p-4 w-full">
                  <p className="font-semibold mb-3 text-center">
                    Como deseja cancelar este agendamento permanente?
                  </p>
                  <div className="grid gap-3">
                    <button
                      onClick={() => {
                        setMostrarOpcoesCancelamento(false);
                        setConfirmarCancelamentoForever(true);
                      }}
                      className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded cursor-pointer"
                    >
                      Cancelar PARA SEMPRE
                    </button>
                    <button
                      onClick={abrirExcecao}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded cursor-pointer"
                    >
                      Cancelar APENAS 1 dia
                    </button>
                    <button
                      onClick={() => setMostrarOpcoesCancelamento(false)}
                      className="w-full bg-gray-300 hover:bg-gray-400 text-black py-2 rounded cursor-pointer"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Confirmação "para sempre" */}
            {confirmarCancelamentoForever && (
              <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-50">
                <p className="text-center text-white mb-4">
                  Tem certeza que deseja cancelar <b>para sempre</b> este agendamento permanente?
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={cancelarAgendamento}
                    disabled={loadingCancelamento}
                    className="bg-red-600 text-white px-4 py-1 rounded hover:bg-red-700 transition cursor-pointer"
                  >
                    {loadingCancelamento ? "Cancelando..." : "Sim, cancelar para sempre"}
                  </button>
                  <button
                    onClick={() => setConfirmarCancelamentoForever(false)}
                    className="bg-gray-300 text-black px-4 py-1 rounded hover:bg-gray-400 transition cursor-pointer"
                  >
                    Não
                  </button>
                </div>
              </div>
            )}

            {/* Modal de EXCEÇÃO (cancelar apenas 1 dia) */}
            {mostrarExcecaoModal && (
              <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 rounded-xl z-50">
                <div className="bg-white rounded-lg p-4 w-full max-w-sm">
                  <h3 className="text-lg font-semibold mb-2">Cancelar apenas 1 dia</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Selecione uma data (próximas {datasExcecao.length} datas que caem em{" "}
                    {agendamentoSelecionado?.diaSemana ?? "-"}).
                  </p>

                  {datasExcecao.length === 0 ? (
                    <div className="text-sm text-gray-600">Não há datas disponíveis.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto mb-3">
                      {datasExcecao.map((d) => {
                        const ativo = dataExcecaoSelecionada === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDataExcecaoSelecionada(d)}
                            className={`px-3 py-2 rounded border text-sm ${
                              ativo
                                ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                                : "border-gray-300 hover:bg-gray-50"
                            }`}
                          >
                            {toDdMm(d)}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setMostrarExcecaoModal(false)}
                      disabled={postandoExcecao}
                      className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={confirmarExcecao}
                      disabled={!dataExcecaoSelecionada || postandoExcecao}
                      className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300"
                    >
                      {postandoExcecao ? "Salvando..." : "Confirmar exceção"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE TRANSFERÊNCIA */}
      {abrirModalTransferencia && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-60">
          <div className="bg-white p-6 rounded-lg shadow-lg w-96 max-h-[80vh] overflow-auto relative">
            <h3 className="text-lg font-semibold mb-4">Transferir Agendamento</h3>

            <input
              type="text"
              className="border p-2 rounded w-full mb-3"
              placeholder="Digite nome ou email do usuário"
              value={buscaUsuario}
              onChange={(e) => setBuscaUsuario(e.target.value)}
              autoFocus
            />

            {carregandoUsuarios && <p>Carregando usuários...</p>}

            {!carregandoUsuarios &&
              usuariosFiltrados.length === 0 &&
              buscaUsuario.trim().length > 0 && (
                <p className="text-sm text-gray-500">Nenhum usuário encontrado</p>
              )}

            <ul className="max-h-64 overflow-y-auto border rounded mb-4">
              {usuariosFiltrados.map((user) => (
                <li
                  key={user.id}
                  className={`p-2 cursor-pointer hover:bg-blue-100 ${
                    usuarioSelecionado?.id === user.id ? "bg-blue-300 font-semibold" : ""
                  }`}
                  onClick={() => setUsuarioSelecionado(user)}
                >
                  {user.nome} ({user.email})
                </li>
              ))}
            </ul>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setAbrirModalTransferencia(false)}
                disabled={loadingTransferencia}
                className="px-4 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarTransferencia}
                disabled={!usuarioSelecionado || loadingTransferencia}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {loadingTransferencia ? "Transferindo..." : "Confirmar Transferência"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ➕ ADICIONAR JOGADORES */}
      {abrirModalJogadores && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-60">
          <div className="bg-white p-6 rounded-lg shadow-lg w-96 max-h-[80vh] overflow-auto relative">
            <h3 className="text-lg font-semibold mb-4">Adicionar Jogadores</h3>

            {/* Busca usuários existentes */}
            <input
              type="text"
              className="border p-2 rounded w-full mb-3"
              placeholder="Buscar por nome ou e-mail"
              value={buscaJogador}
              onChange={(e) => setBuscaJogador(e.target.value)}
              autoFocus
            />

            {carregandoJogadores && <p>Carregando...</p>}

            <ul className="max-h-64 overflow-y-auto border rounded mb-3">
              {usuariosParaJogadores.map((u) => {
                const ativo = jogadoresSelecionadosIds.includes(u.id);
                return (
                  <li
                    key={u.id}
                    className={`p-2 cursor-pointer flex items-center justify-between hover:bg-orange-50 ${
                      ativo ? "bg-orange-100" : ""
                    }`}
                    onClick={() => alternarSelecionado(u.id)}
                  >
                    <span>
                      {u.nome} ({u.email})
                    </span>
                    <input type="checkbox" readOnly checked={ativo} />
                  </li>
                );
              })}
              {!carregandoJogadores &&
                usuariosParaJogadores.length === 0 &&
                buscaJogador.trim().length >= 2 && (
                  <li className="p-2 text-sm text-gray-500">Nenhum usuário encontrado</li>
                )}
            </ul>

            {/* ---- CONVIDADO (apenas nome) ---- */}
            <div className="mb-2">
              <label className="block text-sm font-medium mb-1">Adicionar convidado (só nome)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="border p-2 rounded flex-1"
                  placeholder="Ex.: João Convidado"
                  value={convidadoNome}
                  onChange={(e) => setConvidadoNome(e.target.value)}
                />
                <button
                  type="button"
                  onClick={adicionarConvidado}
                  disabled={!convidadoNome.trim()}
                  className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300"
                >
                  + Adicionar
                </button>
              </div>

              {/* Chips de convidados pendentes */}
              {convidadosPendentes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {convidadosPendentes.map((nome) => (
                    <span
                      key={nome}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs"
                    >
                      {nome}
                      <button
                        type="button"
                        onClick={() => removerConvidado(nome)}
                        className="text-emerald-700 hover:text-emerald-900"
                        title="Remover"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {(jogadoresSelecionadosIds.length > 0 || convidadosPendentes.length > 0) && (
              <div className="text-xs text-gray-600 mb-2">
                Selecionados: {jogadoresSelecionadosIds.length} · Convidados:{" "}
                {convidadosPendentes.length}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setAbrirModalJogadores(false)}
                disabled={addingPlayers}
                className="px-4 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarAdicionarJogadores}
                disabled={
                  addingPlayers ||
                  (jogadoresSelecionadosIds.length === 0 && convidadosPendentes.length === 0)
                }
                className="px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:bg-orange-300"
              >
                {addingPlayers ? "Adicionando..." : "Adicionar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOVO MODAL: Confirmar agendamento comum (quadra livre) */}
      {mostrarConfirmaAgendar && preReserva && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70]">
          <div className="bg-white p-5 rounded-lg shadow-lg w-[340px]">
            <h3 className="text-lg font-semibold mb-3">Confirmar agendamento</h3>
            <p className="text-sm text-gray-700 mb-4">
              Deseja agendar <b>{preReserva.esporte}</b> na{" "}
              <b>
                {preReserva.quadraNome} (nº {preReserva.quadraNumero})
              </b>
              <br />
              em <b>{preReserva.data}</b> às <b>{preReserva.horario}</b>?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMostrarConfirmaAgendar(false)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Não
              </button>
              <button
                onClick={irParaAgendarComum}
                className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Sim, agendar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
