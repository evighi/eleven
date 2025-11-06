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
  celular?: string | null;
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
  diaSemana?: string | null;
  dataInicio?: string | null; // YYYY-MM-DD
}

interface UsuarioLista {
  id: string;
  nome: string;
  celular?: string | null;
}

/** Pré-reserva para confirmação (quadra) */
type PreReserva = {
  data: string;
  horario: string;
  esporte: string;
  quadraId: string;
  quadraNome: string;
  quadraNumero: number;
};

/** Pré-reserva para confirmação (churrasqueira) */
type PreReservaChurras = {
  data: string;
  turno: Turno;
  churrasqueiraId: string;
  churrasqueiraNome: string;
  churrasqueiraNumero: number;
};

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
  const baseIso = (baseYmd || todayStrSP()) + "T00:00:00-03:00";
  const start = new Date(baseIso);
  start.setHours(0, 0, 0, 0);

  if (dataInicio) {
    const di = new Date(`${dataInicio}T00:00:00-03:00`);
    di.setHours(0, 0, 0, 0);
    if (di > start) start.setTime(di.getTime());
  }

  const startDow = start.getDay();
  let delta = (target - startDow + 7) % 7;
  if (delta === 0 && !incluirBase) delta = 7;

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

  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [loadingCancelamento, setLoadingCancelamento] = useState(false);
  const [loadingTransferencia, setLoadingTransferencia] = useState(false);

  // Opções p/ permanente
  const [mostrarOpcoesCancelamento, setMostrarOpcoesCancelamento] = useState(false);

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
  const [copiarExcecoes, setCopiarExcecoes] = useState(true); // apenas para permanentes

  // ➕ Adicionar jogadores
  const [abrirModalJogadores, setAbrirModalJogadores] = useState(false);
  const [buscaJogador, setBuscaJogador] = useState("");
  const [usuariosParaJogadores, setUsuariosParaJogadores] = useState<UsuarioLista[]>([]);
  const [jogadoresSelecionadosIds, setJogadoresSelecionadosIds] = useState<string[]>([]);
  const [convidadoNome, setConvidadoNome] = useState("");
  const [convidadosPendentes, setConvidadosPendentes] = useState<string[]>([]);
  const [carregandoJogadores, setCarregandoJogadores] = useState(false);
  const [addingPlayers, setAddingPlayers] = useState(false);

  // Confirmação para agendar (quadra livre)
  const [mostrarConfirmaAgendar, setMostrarConfirmaAgendar] = useState(false);
  const [preReserva, setPreReserva] = useState<PreReserva | null>(null);

  // Confirmação para agendar (churrasqueira livre)
  const [mostrarConfirmaChurras, setMostrarConfirmaChurras] = useState(false);
  const [preReservaChurras, setPreReservaChurras] = useState<PreReservaChurras | null>(null);

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

  // Inicializa data/horário (SP)
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

      // aceita esporte como string OU { nome }
      // prioriza SEMPRE o esporte vindo do agendamento (API)
      const esporteNome =
        (typeof (res.data as any)?.esporte === "string"
          ? (res.data as any).esporte
          : (res.data as any)?.esporte?.nome) ??
        (extra?.esporte ?? null);

      setAgendamentoSelecionado({
        dia: data,
        horario: extra?.horario || null,
        turno: extra?.turno || null,
        // mantém o que vier: string OU objeto { nome, celular }
        usuario: (res.data as { usuario?: string | UsuarioRef })?.usuario || "—",
        jogadores: (res.data as { jogadores?: JogadorRef[] })?.jogadores || [],
        esporte: esporteNome,
        tipoReserva: item.tipoReserva,
        agendamentoId,
        tipoLocal,
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
    if (tipoReserva === "permanente") {
      setMostrarOpcoesCancelamento(true);
    } else {
      setConfirmarCancelamento(true);
    }
  };

  // Cancelar (POST) — comum e permanente de quadra/churrasqueira (não é o "para sempre")
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
    const lista = gerarProximasDatasDiaSemana(
      agendamentoSelecionado.diaSemana,
      data || todayStrSP(),
      agendamentoSelecionado.dataInicio || null,
      6,
      true
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
  const buscarUsuarios = useCallback(
    async (termo: string) => {
      if (termo.trim().length === 0) {
        setUsuariosFiltrados([]);
        return;
      }
      setCarregandoUsuarios(true);
      try {
        const res = await axios.get<UsuarioLista[]>(`${API_URL}/clientes`, {
          params: { nome: termo },
          withCredentials: true,
        });
        setUsuariosFiltrados(res.data || []);
      } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        setUsuariosFiltrados([]);
      } finally {
        setCarregandoUsuarios(false);
      }
    },
    [API_URL]
  );

  useEffect(() => {
    const t = setTimeout(() => buscarUsuarios(buscaUsuario), 300);
    return () => clearTimeout(t);
  }, [buscaUsuario, buscarUsuarios]);

  const abrirModalTransferir = () => {
    setBuscaUsuario("");
    setUsuariosFiltrados([]);
    setUsuarioSelecionado(null);
    setCopiarExcecoes(true); // padrão
    setAbrirModalTransferencia(true);
  };

  const confirmarTransferencia = async () => {
    if (!agendamentoSelecionado) return alert("Nenhum agendamento selecionado.");
    if (!usuarioSelecionado) return alert("Selecione um usuário para transferir.");

    // Apenas quadras: comum e permanente (se precisar para churrasqueira, criar rotas no backend)
    if (agendamentoSelecionado.tipoLocal !== "quadra") {
      alert("Transferência disponível apenas para quadras neste momento.");
      return;
    }

    setLoadingTransferencia(true);
    try {
      const isPerm = agendamentoSelecionado.tipoReserva === "permanente";
      const rota = isPerm
        ? `agendamentosPermanentes/${agendamentoSelecionado.agendamentoId}/transferir`
        : `agendamentos/${agendamentoSelecionado.agendamentoId}/transferir`;

      const body: any = {
        novoUsuarioId: usuarioSelecionado.id,
        transferidoPorId: (usuario as any)?.id, // quem executa a ação
      };
      if (isPerm) body.copiarExcecoes = copiarExcecoes;

      await axios.patch(`${API_URL}/${rota}`, body, { withCredentials: true });

      alert("Agendamento transferido com sucesso!");
      setAgendamentoSelecionado(null);
      setAbrirModalTransferencia(false);
      buscarDisponibilidade();
    } catch (error: any) {
      console.error("Erro ao transferir agendamento:", error);
      const msg =
        error?.response?.data?.erro ||
        error?.response?.data?.message ||
        "Erro ao transferir agendamento.";
      alert(msg);
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

  // ====== CONFIRMAÇÃO (quadra) ======
  const abrirConfirmacaoAgendar = (info: PreReserva) => {
    setPreReserva(info);
    setMostrarConfirmaAgendar(true);
  };

  const irParaAgendarComum = () => {
    if (!preReserva) return;
    const qs = new URLSearchParams({
      data: preReserva.data,
      horario: preReserva.horario,
      esporte: preReserva.esporte,
      quadraId: preReserva.quadraId,
    }).toString();
    router.push(`/adminMaster/quadras/agendarComum?${qs}`);
  };

  // ====== CONFIRMAÇÃO (churrasqueira) — NOVO ======
  const abrirConfirmacaoChurras = (info: PreReservaChurras) => {
    setPreReservaChurras(info);
    setMostrarConfirmaChurras(true);
  };

  const irParaAgendarChurrasqueira = () => {
    if (!preReservaChurras) return;
    const qs = new URLSearchParams({
      data: preReservaChurras.data,
      turno: preReservaChurras.turno,
      churrasqueiraId: preReservaChurras.churrasqueiraId,
    }).toString();
    router.push(`/adminMaster/churrasqueiras/agendarChurrasqueira?${qs}`);
  };

  /** Novo: ação direta para "Cancelar PARA SEMPRE" (apenas redireciona com aviso) */
  const redirecionarParaPermanentes = () => {
    alert(
      "Para cancelar um agendamento PERMANENTE para sempre, use a página de controle de permanentes."
    );
    setMostrarOpcoesCancelamento(false);
    setAgendamentoSelecionado(null);
    router.push("/adminMaster/todosHorariosPermanentes");
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

        <div className="sm:ml-auto">
          <Link
            href={`/adminMaster/todosHorarios?data=${data || todayStrSP()}`}
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
                  const clickable = !q.bloqueada;
                  const clsBase =
                    "p-3 rounded-lg text-center shadow-sm flex flex-col justify-center " +
                    (clickable ? "cursor-pointer" : "cursor-not-allowed");

                  // ✅ Só mostra "Comum/Permanente" quando realmente há agendamento
                  const hasAgendamento =
                    !q.disponivel && !q.bloqueada && !!q.tipoReserva;

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
                      {q.bloqueada && (
                        <div className="text-red-600 font-bold">Bloqueada</div>
                      )}

                      {hasAgendamento && (
                        <div className="mt-1">
                          <p className="font-bold">{q.usuario?.nome}</p>
                          {q.usuario?.celular && (
                            <p className="text-[11px] text-gray-700">
                              {q.usuario.celular}
                            </p>
                          )}
                          <span className="inline-block text-[11px] mt-1 px-2 py-0.5 rounded bg-white/70">
                            {q.tipoReserva === "permanente"
                              ? "Permanente"
                              : "Comum"}
                          </span>
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
              <h2 className="text-lg font-semibold text-orange-700">
                Churrasqueiras
              </h2>
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
                    onClick={() => {
                      if (disponivel) {
                        abrirConfirmacaoChurras({
                          data,
                          turno: "DIA",
                          churrasqueiraId: c.churrasqueiraId,
                          churrasqueiraNome: c.nome,
                          churrasqueiraNumero: c.numero,
                        });
                      } else {
                        abrirDetalhes(
                          { ...(diaInfo as DetalheItemMin), tipoLocal: "churrasqueira" },
                          { turno: "DIA" }
                        );
                      }
                    }}
                    className={`p-3 rounded-lg text-center shadow-sm flex flex-col justify-center cursor-pointer ${
                      disponivel
                        ? "border-2 border-green-500 bg-green-50"
                        : "border-2 border-gray-500 bg-gray-50"
                    }`}
                  >
                    <p className="font-medium">{c.nome}</p>
                    <p className="text-xs text-gray-700">
                      Churrasqueira {c.numero}
                    </p>

                    {!disponivel && (
                      <div className="mt-1">
                        <p className="font-bold">{diaInfo?.usuario?.nome}</p>
                        {diaInfo?.usuario?.celular && (
                          <p className="text-[11px] text-gray-700">
                            {diaInfo.usuario.celular}
                          </p>
                        )}
                        <span className="inline-block text-[11px] px-2 py-0.5 rounded bg-white/70">
                          {diaInfo?.tipoReserva === "permanente"
                            ? "Permanente"
                            : "Comum"}
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
                    onClick={() => {
                      if (disponivel) {
                        abrirConfirmacaoChurras({
                          data,
                          turno: "NOITE",
                          churrasqueiraId: c.churrasqueiraId,
                          churrasqueiraNome: c.nome,
                          churrasqueiraNumero: c.numero,
                        });
                      } else {
                        abrirDetalhes(
                          { ...(noiteInfo as DetalheItemMin), tipoLocal: "churrasqueira" },
                          { turno: "NOITE" }
                        );
                      }
                    }}
                    className={`p-3 rounded-lg text-center shadow-sm flex flex-col justify-center cursor-pointer ${
                      disponivel
                        ? "border-2 border-green-500 bg-green-50"
                        : "border-2 border-gray-500 bg-gray-50"
                    }`}
                  >
                    <p className="font-medium">{c.nome}</p>
                    <p className="text-xs text-gray-700">
                      Churrasqueira {c.numero}
                    </p>

                    {!disponivel && (
                      <div className="mt-1">
                        <p className="font-bold">{noiteInfo?.usuario?.nome}</p>
                        {noiteInfo?.usuario?.celular && (
                          <p className="text-[11px] text-gray-700">
                            {noiteInfo.usuario.celular}
                          </p>
                        )}
                        <span className="inline-block text-[11px] px-2 py-0.5 rounded bg-white/70">
                          {noiteInfo?.tipoReserva === "permanente"
                            ? "Permanente"
                            : "Comum"}
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
              <strong>Usuário:</strong>{" "}
              {typeof agendamentoSelecionado.usuario === "string"
                ? agendamentoSelecionado.usuario
                : [agendamentoSelecionado.usuario?.nome, agendamentoSelecionado.usuario?.celular]
                    .filter(Boolean)
                    .join(" — ")}
            </p>
            {agendamentoSelecionado.esporte && (
              <p>
                <strong>Esporte:</strong> {agendamentoSelecionado.esporte}
              </p>
            )}
            <p>
              <strong>Tipo:</strong> {agendamentoSelecionado.tipoReserva}
            </p>

            {/* Jogadores (comum/quadra) — sem o botão "+" */}
            {agendamentoSelecionado.tipoReserva === "comum" &&
              agendamentoSelecionado.tipoLocal === "quadra" && (
                <div className="mt-2">
                  <strong>Jogadores:</strong>
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

            {/* BOTÕES DE AÇÃO */}
            {/* Adicionar Jogadores (somente comum/quadra) */}
            {agendamentoSelecionado.tipoReserva === "comum" &&
              agendamentoSelecionado.tipoLocal === "quadra" && (
                <button
                  onClick={abrirModalAdicionarJogadores}
                  className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-4 rounded cursor-pointer"
                >
                  Adicionar jogadores
                </button>
              )}

            {/* Transferir (quadra: comum e permanente) */}
            {agendamentoSelecionado.tipoLocal === "quadra" && (
              <button
                onClick={abrirModalTransferir}
                disabled={loadingTransferencia}
                className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded cursor-pointer disabled:opacity-60"
              >
                {loadingTransferencia ? "Transferindo..." : "Transferir Agendamento"}
              </button>
            )}

            <button
              onClick={abrirFluxoCancelamento}
              className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded cursor-pointer"
            >
              Cancelar Agendamento
            </button>

            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="mt-3 w-full bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded cursor-pointer"
            >
              Fechar
            </button>

            {/* Confirmar cancelamento (somente agendamentos não permanentes) */}
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

            {/* Opções de cancelamento para PERMANENTE */}
            {mostrarOpcoesCancelamento && (
              <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-50">
                <div className="bg-white rounded-lg p-4 w-full">
                  <p className="font-semibold mb-3 text-center">
                    Como deseja cancelar este agendamento permanente?
                  </p>
                  <div className="grid gap-3">
                    <button
                      onClick={redirecionarParaPermanentes}
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
            <h3 className="text-lg font-semibold mb-4">
              Transferir Agendamento{" "}
              {agendamentoSelecionado?.tipoLocal === "quadra" &&
              agendamentoSelecionado?.tipoReserva === "permanente"
                ? "(Permanente)"
                : "(Comum)"}
            </h3>

            <input
              type="text"
              className="border p-2 rounded w-full mb-3"
              placeholder="Digite o nome do usuário"
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
                  title={user.celular || ""}
                >
                  {user.nome}
                  {user.celular ? ` (${user.celular})` : ""}
                </li>
              ))}
            </ul>

            {/* Somente quando o selecionado é permanente (quadra) */}
            {agendamentoSelecionado?.tipoLocal === "quadra" &&
              agendamentoSelecionado?.tipoReserva === "permanente" && (
                <label className="flex items-center gap-2 mb-4 text-sm">
                  <input
                    type="checkbox"
                    checked={copiarExcecoes}
                    onChange={(e) => setCopiarExcecoes(e.target.checked)}
                  />
                  Copiar exceções (datas já canceladas)
                </label>
              )}

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
              placeholder="Buscar por nome"
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
                    title={u.celular || ""}
                  >
                    <span>
                      {u.nome}
                      {u.celular ? ` (${u.celular})` : ""}
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
              <label className="block text-sm font-medium mb-1">
                Adicionar convidado (só nome)
              </label>
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
                  (jogadoresSelecionadosIds.length === 0 &&
                    convidadosPendentes.length === 0)
                }
                className="px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:bg-orange-300"
              >
                {addingPlayers ? "Adicionando..." : "Adicionar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirmar agendamento (quadra livre) */}
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
              em <b>{toDdMm(preReserva.data)}</b> às <b>{preReserva.horario}</b>?
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

      {/* MODAL: Confirmar agendamento (churrasqueira livre) — NOVO */}
      {mostrarConfirmaChurras && preReservaChurras && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70]">
          <div className="bg-white p-5 rounded-lg shadow-lg w-[360px]">
            <h3 className="text-lg font-semibold mb-3">Confirmar agendamento</h3>
            <p className="text-sm text-gray-700 mb-4">
              Deseja agendar a{" "}
              <b>
                {preReservaChurras.churrasqueiraNome} (nº{" "}
                {preReservaChurras.churrasqueiraNumero})
              </b>
              <br />
              em <b>{toDdMm(preReservaChurras.data)}</b> no turno{" "}
              <b>{preReservaChurras.turno}</b>?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMostrarConfirmaChurras(false)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Não
              </button>
              <button
                onClick={irParaAgendarChurrasqueira}
                className="px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
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
