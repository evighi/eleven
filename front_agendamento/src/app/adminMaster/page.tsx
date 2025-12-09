"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";
import Spinner from "@/components/Spinner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Clock, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";


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

const formatarDataBR = (iso?: string) => {
  if (!iso) return "Selecione uma data";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

function isoFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  motivoBloqueioNome?: string | null;
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

/** Mostrar só primeiro e último nome na home */
function firstAndLastName(fullName?: string | null) {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first} ${last}`;
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

  const horarioWrapperRef = useRef<HTMLDivElement | null>(null);
  // logo antes do return, dentro do componente:
  const dataInputRef = useRef<HTMLInputElement | null>(null);

  const [horario, setHorario] = useState("");
  const [mostrarDispon, setMostrarDispon] = useState(true);

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

  const [horarioAberto, setHorarioAberto] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const { usuario } = useAuthStore();

  const [data, setData] = useState(""); // você já tem
  const [dataPickerAberto, setDataPickerAberto] = useState(false);

  const [mesExibido, setMesExibido] = useState(() => {
    const base = data ? new Date(data + "T00:00:00") : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // manter o mês em sincronia se data mudar por outro motivo
  useEffect(() => {
    if (!data) return;
    const base = new Date(data + "T00:00:00");
    setMesExibido(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [data]);



  const isAllowed =
    !!usuario &&
    ["ADMIN_MASTER", "ADMIN_PROFESSORES"].includes((usuario as { tipo?: string }).tipo || "");

  // 👋 Nome para saudação
  const nomeSaudacao =
    firstAndLastName((usuario as { nome?: string } | null)?.nome || "") || "Admin";

  const buscarDisponibilidade = useCallback(async () => {
    if (!isAllowed) return;
    if (!data || !horario) {
      setLoadingDispon(true);
      return;
    }
    setLoadingDispon(true);
    try {
      const res = await axios.get<DisponibilidadeGeral>(
        `${API_URL}/disponibilidadeGeral/geral-admin`,
        {
          params: { data, horario },
          withCredentials: true,
        }
      );
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

  // Fecha ao clicar fora
  useEffect(() => {
    if (!horarioAberto) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        horarioWrapperRef.current &&
        !horarioWrapperRef.current.contains(event.target as Node)
      ) {
        setHorarioAberto(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [horarioAberto]);

  // Quando abre, centraliza o horário selecionado na lista
  useEffect(() => {
    if (!horarioAberto) return;

    const selectedId = horario ? `hora-${horario}` : "hora-default";
    const el = document.getElementById(selectedId);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [horarioAberto, horario]);


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
          : (res.data as any)?.esporte?.nome) ?? (extra?.esporte ?? null);

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

  return (
    <div className="space-y-10">
      {/* 👋 SAUDAÇÃO ADMIN – bem próximo do Figma */}
      <div className="mt-4">
        <h1 className="text-[32px] sm:text-[38px] leading-tight font-extrabold text-orange-600 tracking-tight">
          Olá, {nomeSaudacao}! <span className="inline-block align-middle">👋</span>
        </h1>
        <p className="mt-1 text-sm sm:text-base font-medium text-gray-500">
          Administrador Master
        </p>
      </div>

      {/* FILTROS – título + data/horário + botão tudo na mesma linha */}
      <div className="bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        {/* TÍTULO DA SEÇÃO RESERVAS – alinhado com o Administrador Master */}
        <h2 className="text-[24px] sm:text-[26px] font-extrabold text-gray-700 -ml-4 sm:-ml-4">
          Reservas de Quadras
        </h2>

        {/* Bloco com filtros + botão, alinhado à direita e com pouco espaço entre eles */}
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-end gap-3 sm:gap-4">
          {/* Campo Data – custom datepicker, sem input nativo */}
          <div className="relative w-full sm:w-[220px]">
            {/* Botão visual */}
            <button
              type="button"
              onClick={() => setDataPickerAberto((v) => !v)}
              className="flex items-center justify-between h-11 w-full rounded-md border border-gray-600 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
            >
              <div className="flex items-center">
                <Calendar className="w-4 h-4 text-gray-600 mr-2" />
                <span className="text-sm text-gray-800">
                  {formatarDataBR(data)}
                </span>
              </div>

              <ChevronDown
                className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${dataPickerAberto ? "rotate-180" : ""
                  }`}
              />
            </button>

            {/* POPUP do calendário */}
            {dataPickerAberto && (
              <div
                className="
        absolute z-20 mt-1 right-0
        w-full                      /* 👈 mesma largura do botão */
        rounded-lg border border-gray-200 bg-white
        shadow-lg p-3
      "
              >
                {/* Cabeçalho: mês/ano + setas */}
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() =>
                      setMesExibido(
                        (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                      )
                    }
                    className="p-1 rounded hover:bg-gray-100"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <span className="font-semibold text-sm">
                    {mesExibido.toLocaleDateString("pt-BR", {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setMesExibido(
                        (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                      )
                    }
                    className="p-1 rounded hover:bg-gray-100"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Dias da semana */}
                <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
                  {["D", "S", "T", "Q", "Q", "S", "S"].map((d) => (
                    <div key={d} className="text-center">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Dias do mês (6 linhas) */}
                <div className="grid grid-cols-7 gap-1 text-sm">
                  {(() => {
                    const first = new Date(
                      mesExibido.getFullYear(),
                      mesExibido.getMonth(),
                      1
                    );
                    const startWeekday = first.getDay(); // 0=Dom
                    const startDate = new Date(first);
                    startDate.setDate(first.getDate() - startWeekday);

                    const todayIso = isoFromDate(new Date());

                    return Array.from({ length: 42 }, (_, i) => {
                      const d = new Date(startDate);
                      d.setDate(startDate.getDate() + i);

                      const iso = isoFromDate(d);
                      const isCurrentMonth = d.getMonth() === mesExibido.getMonth();
                      const isSelected = data === iso;
                      const isToday = todayIso === iso;

                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => {
                            setData(iso);
                            setDataPickerAberto(false);
                          }}
                          className={[
                            "h-8 w-8 rounded-full flex items-center justify-center mx-auto",
                            !isCurrentMonth ? "text-gray-300" : "text-gray-800",
                            isToday && !isSelected ? "border border-orange-400" : "",
                            isSelected
                              ? "bg-orange-600 text-white font-semibold"
                              : "hover:bg-orange-50",
                          ].join(" ")}
                        >
                          {d.getDate()}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>



          {/* Campo Horário – card inteiro clicável com dropdown customizado */}
          <div
            ref={horarioWrapperRef}
            className="relative flex w-full sm:w-[140px]"
          >
            <button
              type="button"
              onClick={() => setHorarioAberto((v) => !v)}
              className="flex items-center justify-between h-11 border border-gray-600 rounded-md px-3 text-sm bg-white w-full hover:border-gray-900 hover:shadow-sm transition"
            >
              <div className="flex items-center">
                <Clock className="w-4 h-4 text-gray-600 mr-2" />
                <span className="text-sm text-gray-800">
                  {horario || "Selecione um horário"}
                </span>
              </div>

              <ChevronDown
                className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${horarioAberto ? "rotate-180" : ""
                  }`}
              />
            </button>

            {horarioAberto && (
              <div
                className="
      absolute left-0 right-0 top-full mt-1  /* 👈 coloca logo abaixo do botão */
      z-20
      max-h-[70vh] overflow-y-auto
      rounded-md border border-gray-200 bg-white shadow-lg text-sm
    "
              >
                {/* opção "default" */}
                <button
                  id="hora-default"
                  type="button"
                  onClick={() => {
                    setHorario("");
                    setHorarioAberto(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 ${horario === ""
                    ? "bg-orange-100 text-orange-700 font-semibold"
                    : "hover:bg-orange-50 text-gray-800"
                    }`}
                >
                  Selecione um horário
                </button>

                {Array.from({ length: 17 }, (_, i) => {
                  const hora = (7 + i).toString().padStart(2, "0") + ":00";
                  const selecionado = horario === hora;
                  return (
                    <button
                      key={hora}
                      id={`hora-${hora}`}
                      type="button"
                      onClick={() => {
                        setHorario(hora);
                        setHorarioAberto(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 ${selecionado
                        ? "bg-orange-100 text-orange-700 font-semibold"
                        : "hover:bg-orange-50 text-gray-800"
                        }`}
                    >
                      {hora}
                    </button>
                  );
                })}
              </div>
            )}

          </div>


          {/* Botão principal + seta para recolher */}
          <div className="flex items-center gap-2">
            <Link
              href={`/adminMaster/todosHorarios?data=${data || todayStrSP()}`}
              className="inline-flex items-center justify-center h-11 px-6 rounded-md font-semibold bg-orange-600 hover:bg-orange-700 text-white text-sm cursor-pointer transition shadow-sm whitespace-nowrap"
            >
              Ver todas as reservas
            </Link>

            {/* Botão seta para recolher disponibilidade */}
            <button
              type="button"
              onClick={() => setMostrarDispon((v) => !v)}
              className="inline-flex items-center justify-center h-11 w-11 rounded-full text-gray-700 hover:bg-gray-100 transition"
              aria-label={mostrarDispon ? "Recolher disponibilidade" : "Mostrar disponibilidade"}
            >
              <ChevronDown
                className={`w-10 h-10 transition-transform ${mostrarDispon ? "" : "rotate-180"
                  }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* DISPONIBILIDADE */}
      {mostrarDispon &&
        (loadingDispon || !disponibilidade ? (
          <div className="flex items-center gap-2 text-gray-600">
            <Spinner />
            <span>Carregando disponibilidade…</span>
          </div>
        ) : (
          <div className="space-y-8">
            {/* ================== QUADRAS ================== */}
            {Object.keys(disponibilidade.quadras).map((esporte) => (
              <section
                key={esporte}
                className="rounded-3xl bg-gray-100 border border-gray-100 px-4 sm:px-6 py-5 shadow-sm"
              >
                {/* HEADER DO ESPORTE */}
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">
                    {esporte}
                  </h2>
                </div>

                {/* GRID DE CARDS */}
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {disponibilidade.quadras[esporte].map((q: DisponQuadra) => {
                    const clickable = !q.bloqueada;

                    const hasAgendamento =
                      !q.disponivel &&
                      !!q.tipoReserva &&
                      (q.tipoReserva === "permanente" || !q.bloqueada);

                    const isPermanente = q.tipoReserva === "permanente";
                    const isComum = q.tipoReserva === "comum";

                    // cores do card conforme status
                    let statusClasses =
                      "border-slate-300 bg-slate-50 text-slate-800"; // padrão / permanente

                    if (q.bloqueada) {
                      statusClasses = "border-red-400 bg-red-50 text-red-800";
                    } else if (q.disponivel) {
                      statusClasses = "border-emerald-400 bg-emerald-50 text-emerald-800";
                    } else if (isComum) {
                      statusClasses = "border-amber-400 bg-amber-50 text-amber-800";
                    }

                    // cor do texto "Quadra X • Nome" de acordo com o status
                    const nomeQuadraColor =
                      q.bloqueada
                        ? "text-red-700"
                        : q.disponivel
                          ? "text-emerald-700"
                          : isComum
                            ? "text-amber-700"
                            : "text-gray-500"; // permanente / padrão

                    // apenas o primeiro nome da quadra
                    const primeiroNomeQuadra =
                      (q.nome || "").split(" ")[0] || q.nome;

                    const cardBase =
                      "relative flex flex-col justify-between items-stretch " +
                      "rounded-2xl border shadow-sm px-3 py-3 " +
                      "transition-transform hover:-translate-y-0.5 hover:shadow-md " +
                      (clickable ? "cursor-pointer" : "cursor-not-allowed opacity-90");

                    const labelTipo =
                      q.bloqueada
                        ? "Bloqueado"
                        : q.disponivel
                          ? "Disponível"
                          : isPermanente
                            ? "Permanente"
                            : "Avulsa";

                    return (
                      <button
                        key={q.quadraId}
                        type="button"
                        disabled={q.bloqueada}
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
                        className={`${cardBase} ${statusClasses}`}
                      >
                        {/* TOPO: NOME DA QUADRA / LOCAL */}
                        <p
                          className={`
                text-[10px] font-medium mb-1
                whitespace-nowrap overflow-hidden text-ellipsis
                ${nomeQuadraColor}
              `}
                        >
                          Quadra {q.numero} • {primeiroNomeQuadra}
                        </p>

                        {/* MIolo: ÍCONE GRANDE + NOME / BLOQUEADO / DISPONÍVEL */}
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-1">
                          {/* ÍCONE GRANDE POR STATUS */}
                          <div className="mb-1">
                            {q.bloqueada && (
                              <Image
                                src="/iconescards/icone_bloqueado.png"
                                alt="Quadra bloqueada"
                                width={32}
                                height={32}
                                className="w-8 h-8"
                              />
                            )}

                            {q.disponivel && !q.bloqueada && (
                              <Image
                                src="/iconescards/icone_liberado.png"
                                alt="Quadra disponível"
                                width={32}
                                height={32}
                                className="w-4 h-4"
                              />
                            )}

                            {!q.disponivel && !q.bloqueada && isPermanente && (
                              <Image
                                src="/iconescards/icone-permanente.png"
                                alt="Reserva permanente"
                                width={32}
                                height={32}
                                className="w-4 h-4"
                              />
                            )}

                            {!q.disponivel && !q.bloqueada && isComum && (
                              <Image
                                src="/iconescards/icone-reservado.png"
                                alt="Reserva avulsa"
                                width={32}
                                height={32}
                                className="w-4 h-4"
                              />
                            )}
                          </div>

                          {q.bloqueada ? (
                            <>
                              <p className="text-sm font-extrabold leading-tight">
                                {q.usuario?.nome
                                  ? firstAndLastName(q.usuario.nome)
                                  : "Bloqueado"}
                              </p>
                              <p className="text-[11px] mt-1 font-semibold">
                                {q.motivoBloqueioNome || "Manutenção"}
                              </p>
                            </>
                          ) : hasAgendamento ? (
                            <>
                              <p className="text-sm font-bold leading-tight">
                                {firstAndLastName(q.usuario?.nome)}
                              </p>

                              {/* TELEFONE + ÍCONE (preto ou laranja) */}
                              {q.usuario?.celular && (
                                <div className="mt-1 flex items-center justify-center gap-1 text-[10px] whitespace-nowrap overflow-hidden text-ellipsis">
                                  <Image
                                    src={
                                      isComum
                                        ? "/iconescards/icone_phone_orange.png"
                                        : "/iconescards/icone_phone.png"
                                    }
                                    alt="Telefone"
                                    width={14}
                                    height={14}
                                    className="w-2.5 h-2.5 flex-shrink-0"
                                  />
                                  <span className="overflow-hidden text-ellipsis">
                                    {q.usuario.celular}
                                  </span>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm font-extrabold leading-tight">
                              Disponível
                            </p>
                          )}
                        </div>

                        {/* BASE DO CARD: tipo + ÍCONE PEQUENO CENTRALIZADO */}
                        <div className="mt-1 pt-1 flex items-center justify-center text-[11px]">
                          <div className="inline-flex items-center gap-1">
                            {/* ÍCONE PEQUENO POR STATUS */}
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/60 overflow-hidden">
                              {q.bloqueada && (
                                <Image
                                  src="/iconescards/icone_bloqueado.png"
                                  alt="Bloqueado"
                                  width={12}
                                  height={12}
                                  className="w-3 h-3"
                                />
                              )}

                              {q.disponivel && !q.bloqueada && (
                                <Image
                                  src="/iconescards/icone_liberado.png"
                                  alt="Disponível"
                                  width={12}
                                  height={12}
                                  className="w-2.5 h-2.5"
                                />
                              )}

                              {!q.disponivel && !q.bloqueada && isPermanente && (
                                <Image
                                  src="/iconescards/icone_permanente_name.png"
                                  alt="Permanente"
                                  width={12}
                                  height={12}
                                  className="w-2.5 h-2.5"
                                />
                              )}

                              {!q.disponivel && !q.bloqueada && isComum && (
                                <Image
                                  src="/iconescards/icone_reserva_avulsa.png"
                                  alt="Avulsa"
                                  width={12}
                                  height={12}
                                  className="w-2.5 h-2.5"
                                />
                              )}
                            </span>

                            <span className="font-semibold">{labelTipo}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}


            {/* ================== CHURRASQUEIRAS ================== */}
            <section className="rounded-3xl bg-gray-100 border border-gray-100 px-4 sm:px-6 py-5 shadow-sm">
              {/* Header igual ao das quadras */}
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-800">
                  Churrasqueiras
                </h2>
              </div>

              {/* === DIA === */}
              <h3 className="text-sm font-semibold mb-2 text-gray-700">
                Dia
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mb-4">
                {disponibilidade.churrasqueiras.map((c: ChurrasqueiraDisp) => {
                  const diaInfo = c.disponibilidade.find((t) => t.turno === "DIA");

                  const disponivel = !!diaInfo?.disponivel;
                  const isPerm = diaInfo?.tipoReserva === "permanente";
                  const isComum = diaInfo?.tipoReserva === "comum";

                  // mesmas cores de status dos cards de quadra
                  let statusClasses =
                    "border-slate-300 bg-slate-50 text-slate-800";

                  if (disponivel) {
                    statusClasses = "border-emerald-400 bg-emerald-50 text-emerald-800";
                  } else if (isComum) {
                    statusClasses = "border-amber-400 bg-amber-50 text-amber-800";
                  } else if (isPerm) {
                    statusClasses = "border-slate-300 bg-slate-50 text-slate-800";
                  }

                  // cor da linha "Churrasqueira X • Nome"
                  const nomeChurrasColor =
                    disponivel
                      ? "text-emerald-700"
                      : isComum
                        ? "text-amber-700"
                        : isPerm
                          ? "text-gray-500"
                          : "text-gray-500";

                  // só o primeiro nome da churrasqueira
                  const primeiroNomeChurras =
                    (c.nome || "").split(" ")[0] || c.nome;

                  const cardBase =
                    "relative flex flex-col justify-between items-stretch " +
                    "rounded-2xl border shadow-sm px-3 py-3 " +
                    "transition-transform hover:-translate-y-0.5 hover:shadow-md cursor-pointer";

                  const labelTipo = disponivel
                    ? "Disponível"
                    : isPerm
                      ? "Permanente"
                      : "Avulsa";

                  return (
                    <button
                      key={c.churrasqueiraId + "-dia"}
                      type="button"
                      onClick={() => {
                        if (disponivel) {
                          abrirConfirmacaoChurras({
                            data,
                            turno: "DIA",
                            churrasqueiraId: c.churrasqueiraId,
                            churrasqueiraNome: c.nome,
                            churrasqueiraNumero: c.numero,
                          });
                        } else if (diaInfo) {
                          abrirDetalhes(
                            {
                              ...(diaInfo as DetalheItemMin),
                              tipoLocal: "churrasqueira",
                            },
                            { turno: "DIA" }
                          );
                        }
                      }}
                      className={`${cardBase} ${statusClasses}`}
                    >
                      {/* TOPO: NOME DA CHURRASQUEIRA / LOCAL */}
                      <p
                        className={`
              text-[10px] font-medium mb-1
              whitespace-nowrap overflow-hidden text-ellipsis
              ${nomeChurrasColor}
            `}
                      >
                        Churrasqueira {c.numero} • {primeiroNomeChurras}
                      </p>

                      {/* MIolo: ÍCONE GRANDE + NOME / DISPONÍVEL / RESERVA */}
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-1">
                        {/* ÍCONE GRANDE POR STATUS */}
                        <div className="mb-1">
                          {disponivel && (
                            <Image
                              src="/iconescards/icone_liberado.png"
                              alt="Churrasqueira disponível"
                              width={32}
                              height={32}
                              className="w-4 h-4"
                            />
                          )}

                          {!disponivel && isPerm && (
                            <Image
                              src="/iconescards/icone-permanente.png"
                              alt="Reserva permanente"
                              width={32}
                              height={32}
                              className="w-4 h-4"
                            />
                          )}

                          {!disponivel && isComum && (
                            <Image
                              src="/iconescards/icone-reservado.png"
                              alt="Reserva avulsa"
                              width={32}
                              height={32}
                              className="w-4 h-4"
                            />
                          )}
                        </div>

                        {disponivel ? (
                          <p className="text-sm font-extrabold leading-tight">
                            Disponível
                          </p>
                        ) : (
                          <>
                            <p className="text-sm font-extrabold leading-tight">
                              {firstAndLastName(diaInfo?.usuario?.nome)}
                            </p>

                            {/* TELEFONE + ÍCONE (preto/laranja) */}
                            {diaInfo?.usuario?.celular && (
                              <div className="mt-1 flex items-center justify-center gap-1 text-[10px] whitespace-nowrap overflow-hidden text-ellipsis">
                                <Image
                                  src={
                                    isComum
                                      ? "/iconescards/icone_phone_orange.png"
                                      : "/iconescards/icone_phone.png"
                                  }
                                  alt="Telefone"
                                  width={14}
                                  height={14}
                                  className="w-2.5 h-2.5 flex-shrink-0"
                                />
                                <span className="overflow-hidden text-ellipsis">
                                  {diaInfo.usuario.celular}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* BASE DO CARD: tipo + ÍCONE PEQUENO CENTRALIZADO */}
                      <div className="mt-1 pt-1 flex items-center justify-center text-[11px]">
                        <div className="inline-flex items-center gap-1">
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/60 overflow-hidden">
                            {disponivel && (
                              <Image
                                src="/iconescards/icone_liberado.png"
                                alt="Disponível"
                                width={12}
                                height={12}
                                className="w-2.5 h-2.5"
                              />
                            )}

                            {!disponivel && isPerm && (
                              <Image
                                src="/iconescards/icone_permanente_name.png"
                                alt="Permanente"
                                width={12}
                                height={12}
                                className="w-2.5 h-2.5"
                              />
                            )}

                            {!disponivel && isComum && (
                              <Image
                                src="/iconescards/icone_reserva_avulsa.png"
                                alt="Avulsa"
                                width={12}
                                height={12}
                                className="w-2.5 h-2.5"
                              />
                            )}
                          </span>

                          <span className="font-semibold">{labelTipo}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* === NOITE === */}
              <h3 className="text-sm font-semibold mb-2 text-gray-700">
                Noite
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {disponibilidade.churrasqueiras.map((c: ChurrasqueiraDisp) => {
                  const noiteInfo = c.disponibilidade.find((t) => t.turno === "NOITE");

                  const disponivel = !!noiteInfo?.disponivel;
                  const isPerm = noiteInfo?.tipoReserva === "permanente";
                  const isComum = noiteInfo?.tipoReserva === "comum";

                  let statusClasses =
                    "border-slate-300 bg-slate-50 text-slate-800";

                  if (disponivel) {
                    statusClasses = "border-emerald-400 bg-emerald-50 text-emerald-800";
                  } else if (isComum) {
                    statusClasses = "border-amber-400 bg-amber-50 text-amber-800";
                  } else if (isPerm) {
                    statusClasses = "border-slate-300 bg-slate-50 text-slate-800";
                  }

                  const nomeChurrasColor =
                    disponivel
                      ? "text-emerald-700"
                      : isComum
                        ? "text-amber-700"
                        : isPerm
                          ? "text-gray-500"
                          : "text-gray-500";

                  const primeiroNomeChurras =
                    (c.nome || "").split(" ")[0] || c.nome;

                  const cardBase =
                    "relative flex flex-col justify-between items-stretch " +
                    "rounded-2xl border shadow-sm px-3 py-3 " +
                    "transition-transform hover:-translate-y-0.5 hover:shadow-md cursor-pointer";

                  const labelTipo = disponivel
                    ? "Disponível"
                    : isPerm
                      ? "Permanente"
                      : "Avulsa";

                  return (
                    <button
                      key={c.churrasqueiraId + "-noite"}
                      type="button"
                      onClick={() => {
                        if (disponivel) {
                          abrirConfirmacaoChurras({
                            data,
                            turno: "NOITE",
                            churrasqueiraId: c.churrasqueiraId,
                            churrasqueiraNome: c.nome,
                            churrasqueiraNumero: c.numero,
                          });
                        } else if (noiteInfo) {
                          abrirDetalhes(
                            {
                              ...(noiteInfo as DetalheItemMin),
                              tipoLocal: "churrasqueira",
                            },
                            { turno: "NOITE" }
                          );
                        }
                      }}
                      className={`${cardBase} ${statusClasses}`}
                    >
                      <p
                        className={`
              text-[10px] font-medium mb-1
              whitespace-nowrap overflow-hidden text-ellipsis
              ${nomeChurrasColor}
            `}
                      >
                        Churrasqueira {c.numero} • {primeiroNomeChurras}
                      </p>

                      <div className="flex-1 flex flex-col items-center justify-center text-center py-1">
                        <div className="mb-1">
                          {disponivel && (
                            <Image
                              src="/iconescards/icone_liberado.png"
                              alt="Churrasqueira disponível"
                              width={32}
                              height={32}
                              className="w-4 h-4"
                            />
                          )}

                          {!disponivel && isPerm && (
                            <Image
                              src="/iconescards/icone_churrasqueira_permanente.png"
                              alt="Reserva permanente"
                              width={32}
                              height={32}
                              className="w-4 h-4"
                            />
                          )}

                          {!disponivel && isComum && (
                            <Image
                              src="/iconescards/icone_churrasqueira_avulsa.png"
                              alt="Reserva avulsa"
                              width={32}
                              height={32}
                              className="w-4 h-4"
                            />
                          )}
                        </div>

                        {disponivel ? (
                          <p className="text-sm font-extrabold leading-tight">
                            Disponível
                          </p>
                        ) : (
                          <>
                            <p className="text-sm font-extrabold leading-tight">
                              {firstAndLastName(noiteInfo?.usuario?.nome)}
                            </p>

                            {noiteInfo?.usuario?.celular && (
                              <div className="mt-1 flex items-center justify-center gap-1 text-[10px] whitespace-nowrap overflow-hidden text-ellipsis">
                                <Image
                                  src={
                                    isComum
                                      ? "/iconescards/icone_phone_orange.png"
                                      : "/iconescards/icone_phone.png"
                                  }
                                  alt="Telefone"
                                  width={14}
                                  height={14}
                                  className="w-2.5 h-2.5 flex-shrink-0"
                                />
                                <span className="overflow-hidden text-ellipsis">
                                  {noiteInfo.usuario.celular}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      <div className="mt-1 pt-1 flex items-center justify-center text-[11px]">
                        <div className="inline-flex items-center gap-1">
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/60 overflow-hidden">
                            {disponivel && (
                              <Image
                                src="/iconescards/icone_liberado.png"
                                alt="Disponível"
                                width={12}
                                height={12}
                                className="w-2.5 h-2.5"
                              />
                            )}

                            {!disponivel && isPerm && (
                              <Image
                                src="/iconescards/icone_permanente_name.png"
                                alt="Permanente"
                                width={12}
                                height={12}
                                className="w-2.5 h-2.5"
                              />
                            )}

                            {!disponivel && isComum && (
                              <Image
                                src="/iconescards/icone_reserva_avulsa.png"
                                alt="Avulsa"
                                width={12}
                                height={12}
                                className="w-2.5 h-2.5"
                              />
                            )}
                          </span>

                          <span className="font-semibold">{labelTipo}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ))}


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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] relative flex flex-col overflow-hidden">
            {/* BOTÃO X */}
            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="absolute right-5 top-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            {/* CABEÇALHO */}
            <div className="px-8 pt-6 pb-4 border-b border-gray-200 text-center">
              <p className="text-sm font-semibold text-orange-600">
                Informações de reserva
              </p>

              {/* QUADRA / CHURRASQUEIRA */}
              <p className="mt-4 text-xs text-gray-500">
                {agendamentoSelecionado.tipoLocal === "churrasqueira"
                  ? "Churrasqueira"
                  : "Quadra"}
                :{" "}
                <span className="text-gray-900 font-semibold">
                  {(() => {
                    const sel = agendamentoSelecionado as any;

                    const numero =
                      sel.numero ?? sel.quadraNumero ?? sel.churrasqueiraNumero;
                    const nome = sel.nome ?? sel.quadraNome ?? sel.churrasqueiraNome;

                    const numeroFmt =
                      typeof numero === "number" || typeof numero === "string"
                        ? String(numero).padStart(2, "0")
                        : "";

                    if (!numeroFmt && !nome) return "-";

                    return `${numeroFmt}${nome ? ` - ${nome}` : ""}`;
                  })()}
                </span>
              </p>
            </div>

            {/* CONTEÚDO ROLÁVEL */}
            <div className="px-8 py-6 space-y-6 overflow-y-auto">
              {/* BLOCO ATLETA */}
              <div className="flex flex-col items-center text-center gap-2">
                {/* ÍCONE GRANDE DO ATLETA */}
                <div className="mb-1">
                  {/* troque o src pelo ícone desejado */}
                  <Image
                    src="/iconesmodal/icone_atleta.png"
                    alt="Atleta"
                    width={40}
                    height={40}
                    className="w-10 h-10"
                  />
                </div>

                <p className="text-sm text-gray-600">
                  Atleta:{" "}
                  <span className="font-semibold text-gray-900">
                    {typeof agendamentoSelecionado.usuario === "string"
                      ? agendamentoSelecionado.usuario
                      : agendamentoSelecionado.usuario?.nome || "-"}
                  </span>
                </p>

                {/* Telefone */}
                {typeof agendamentoSelecionado.usuario !== "string" &&
                  agendamentoSelecionado.usuario?.celular && (
                    <div className="flex items-center justify-center gap-1 text-xs text-gray-600">
                      {/* ÍCONE TELEFONE */}
                      <Image
                        src="/iconesmodal/icone_telefone.png"
                        alt="Telefone"
                        width={14}
                        height={14}
                        className="w-3.5 h-3.5"
                      />
                      <span>{agendamentoSelecionado.usuario.celular}</span>
                    </div>
                  )}
              </div>

              {/* LINHA DE INFOS (Dia / Esporte / Horário / Tipo) */}
              <div className="flex flex-col sm:flex-row gap-y-2 gap-x-8 text-xs">
                {/* COLUNA ESQUERDA (Dia / Esporte) */}
                <div className="flex-1 space-y-1">
                  {/* Dia */}
                  <div className="flex items-center gap-2">
                    {/* ÍCONE DIA */}
                    <Image
                      src="/iconesmodal/icone_dia.png"
                      alt="Dia"
                      width={14}
                      height={14}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-gray-600">
                      Dia:{" "}
                      <span className="font-semibold text-gray-800">
                        {formatarDataBR(agendamentoSelecionado.dia)}
                      </span>
                    </span>
                  </div>

                  {/* Esporte */}
                  {agendamentoSelecionado.esporte && (
                    <div className="flex items-center gap-2">
                      {/* ÍCONE ESPORTE */}
                      <Image
                        src="/iconesmodal/icone_esporte.png"
                        alt="Esporte"
                        width={14}
                        height={14}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-gray-600">
                        Esporte:{" "}
                        <span className="font-semibold text-gray-800">
                          {agendamentoSelecionado.esporte}
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                {/* COLUNA DIREITA (Horário/Turno / Tipo) */}
                <div className="flex-1 space-y-1">
                  {/* Horário ou Turno */}
                  {agendamentoSelecionado.horario ? (
                    <div className="flex items-center gap-2">
                      {/* ÍCONE HORÁRIO */}
                      <Image
                        src="/iconesmodal/icone_horario.png"
                        alt="Horário"
                        width={14}
                        height={14}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-gray-600">
                        Horário:{" "}
                        <span className="font-semibold text-gray-800">
                          {agendamentoSelecionado.horario}
                        </span>
                      </span>
                    </div>
                  ) : agendamentoSelecionado.turno ? (
                    <div className="flex items-center gap-2">
                      {/* ÍCONE TURNO */}
                      <Image
                        src="/iconesmodal/icone_turno.png"
                        alt="Turno"
                        width={14}
                        height={14}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-gray-600">
                        Turno:{" "}
                        <span className="font-semibold text-gray-800">
                          {agendamentoSelecionado.turno}
                        </span>
                      </span>
                    </div>
                  ) : null}

                  {/* Tipo */}
                  <div className="flex items-center gap-2">
                    {/* ÍCONE TIPO (permanente/avulsa) */}
                    <Image
                      src="/iconesmodal/icone_tipo.png"
                      alt="Tipo de reserva"
                      width={14}
                      height={14}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-gray-600">
                      Tipo:{" "}
                      <span className="font-semibold text-gray-800">
                        {agendamentoSelecionado.tipoReserva === "permanente"
                          ? "Permanente"
                          : agendamentoSelecionado.tipoReserva === "comum"
                            ? "Avulsa"
                            : agendamentoSelecionado.tipoReserva}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* JOGADORES */}
              {agendamentoSelecionado.tipoLocal === "quadra" && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-orange-600">
                    Jogadores:
                  </p>

                  <div className="flex flex-wrap gap-3">
                    {agendamentoSelecionado.jogadores.length > 0 ? (
                      agendamentoSelecionado.jogadores.map((jog, idx) => {
                        const celular = (jog as any).celular as
                          | string
                          | undefined;

                        return (
                          <div
                            key={idx}
                            className="flex-1 min-w-[140px] max-w-[180px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700"
                          >
                            <p className="font-semibold text-[13px] truncate">
                              {jog.nome}
                            </p>

                            {celular && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-600">
                                <Image
                                  src="/iconesmodal/icone_telefone_mini.png"
                                  alt="Telefone"
                                  width={12}
                                  height={12}
                                  className="w-3 h-3"
                                />
                                <span className="truncate">{celular}</span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-xs text-gray-500">
                        Nenhum jogador cadastrado
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* BOTÃO ADICIONAR JOGADORES (quando permitido) */}
              {agendamentoSelecionado.tipoReserva === "comum" &&
                agendamentoSelecionado.tipoLocal === "quadra" && (
                  <div className="pt-2">
                    <button
                      onClick={abrirModalAdicionarJogadores}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-full border border-orange-500 bg-orange-50 text-orange-700 text-sm py-2 cursor-pointer hover:bg-orange-100 transition"
                    >
                      {/* ÍCONE "+" LARANJA */}
                      <Image
                        src="/iconesmodal/icone_add_jogador.png"
                        alt="Adicionar jogadores"
                        width={14}
                        height={14}
                        className="w-3.5 h-3.5"
                      />
                      <span>Adicionar mais jogadores</span>
                    </button>
                  </div>
                )}

              {/* LINHA DIVISÓRIA */}
              <div className="border-t border-gray-200 pt-4 mt-2" />

              {/* BOTÕES DE AÇÃO INFERIORES */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={abrirFluxoCancelamento}
                  className="flex-1 border border-red-500 text-red-600 hover:bg-red-50 rounded-full py-2 text-sm font-medium cursor-pointer"
                >
                  Cancelar reserva
                </button>

                {agendamentoSelecionado.tipoLocal === "quadra" && (
                  <button
                    onClick={abrirModalTransferir}
                    disabled={loadingTransferencia}
                    className="flex-1 border border-gray-400 text-gray-700 hover:bg-gray-50 rounded-full py-2 text-sm font-medium cursor-pointer disabled:opacity-60"
                  >
                    {loadingTransferencia
                      ? "Transferindo..."
                      : "Transferir reserva"}
                  </button>
                )}
              </div>
            </div>

            {/* --- OVERLAYS INTERNOS (mantidos, só estilos ajustados) --- */}
            {confirmarCancelamento && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center p-4 rounded-3xl z-50">
                <div className="bg-white rounded-2xl p-5 w-full max-w-sm text-center shadow-xl">
                  <p className="text-sm text-gray-800 mb-4">
                    Tem certeza que deseja cancelar esta reserva?
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={cancelarAgendamento}
                      disabled={loadingCancelamento}
                      className="px-4 py-2 rounded-full bg-red-600 text-white hover:bg-red-700 text-sm cursor-pointer disabled:opacity-70"
                    >
                      {loadingCancelamento ? "Cancelando..." : "Sim, cancelar"}
                    </button>
                    <button
                      onClick={() => setConfirmarCancelamento(false)}
                      className="px-4 py-2 rounded-full bg-gray-200 hover:bg-gray-300 text-sm cursor-pointer"
                    >
                      Não
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mostrarOpcoesCancelamento && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center p-4 rounded-3xl z-50">
                <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
                  <p className="font-semibold mb-3 text-center text-sm">
                    Cancelar apenas 1 dia deste agendamento permanente
                  </p>
                  <div className="grid gap-3">
                    <button
                      onClick={abrirExcecao}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-full cursor-pointer text-sm"
                    >
                      Cancelar APENAS 1 dia
                    </button>
                    <button
                      onClick={() => setMostrarOpcoesCancelamento(false)}
                      className="w-full bg-gray-200 hover:bg-gray-300 text-black py-2 rounded-full cursor-pointer text-sm"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mostrarExcecaoModal && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 rounded-3xl z-50">
                <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
                  <h3 className="text-lg font-semibold mb-2">
                    Cancelar apenas 1 dia
                  </h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Selecione uma data (próximas {datasExcecao.length} datas que
                    caem em {agendamentoSelecionado?.diaSemana ?? "-"}).
                  </p>

                  {datasExcecao.length === 0 ? (
                    <div className="text-sm text-gray-600 mb-3">
                      Não há datas disponíveis.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto mb-4">
                      {datasExcecao.map((d) => {
                        const ativo = dataExcecaoSelecionada === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDataExcecaoSelecionada(d)}
                            className={`px-3 py-2 rounded-full border text-sm ${ativo
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
                      className="px-4 py-2 rounded-full bg-gray-200 hover:bg-gray-300 text-sm"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={confirmarExcecao}
                      disabled={!dataExcecaoSelecionada || postandoExcecao}
                      className="px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300 text-sm"
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
                  className={`p-2 cursor-pointer hover:bg-blue-100 ${usuarioSelecionado?.id === user.id ? "bg-blue-300 font-semibold" : ""
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
                    className={`p-2 cursor-pointer flex items-center justify-between hover:bg-orange-50 ${ativo ? "bg-orange-100" : ""
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
                  <li className="p-2 text-sm text-gray-500">
                    Nenhum usuário encontrado
                  </li>
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

            {(jogadoresSelecionadosIds.length > 0 ||
              convidadosPendentes.length > 0) && (
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
