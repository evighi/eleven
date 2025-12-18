"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";
import Spinner from "@/components/Spinner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Check,
  X,
} from "lucide-react";
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
  dia?: string; // 👈 para churrasqueiras usarem o dia próprio
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

  // novos campos vindos da API de detalhes
  quadraNumero?: number | null;
  quadraNome?: string | null;
  churrasqueiraNumero?: number | null;
  churrasqueiraNome?: string | null;
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

type AlertVariant = "success" | "error" | "info";

interface SystemAlertProps {
  open: boolean;
  message: string;
  variant?: AlertVariant;
  onClose: () => void;
}

function SystemAlert({
  open,
  message,
  variant = "info",
  onClose,
}: SystemAlertProps) {
  if (!open || !message) return null;

  const styles =
    {
      success: {
        container:
          "bg-emerald-50 border-emerald-200 text-emerald-800",
        chip:
          "bg-emerald-100 border border-emerald-300 text-emerald-800",
      },
      error: {
        container: "bg-red-50 border-red-200 text-red-800",
        chip: "bg-red-100 border border-red-300 text-red-800",
      },
      info: {
        container:
          "bg-orange-50 border-orange-200 text-orange-800",
        chip:
          "bg-orange-100 border border-orange-300 text-orange-800",
      },
    }[variant] || {
      container: "bg-slate-50 border-slate-200 text-slate-800",
      chip: "bg-slate-100 border border-slate-300 text-slate-800",
    };

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none flex justify-center pt-6 sm:pt-8">
      <div className="pointer-events-auto">
        <div
          className={`
            flex items-center gap-4 rounded-2xl px-5 py-3
            min-w-[260px] max-w-[90vw]
            border shadow-xl
            ${styles.container}
          `}
        >
          <div className="flex flex-col">
            {/* “cabeçalho” tipo navegador */}
            <span className="text-[11px] uppercase tracking-[0.16em] text-black/50">
              Eleven Sports • Aviso
            </span>
            <span className="mt-1 text-sm font-medium leading-snug">
              {message}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`
              ml-2 sm:ml-4 px-4 py-1.5 rounded-full text-xs font-semibold
              transition
              ${styles.chip}
            `}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}


export default function AdminHome() {
  const router = useRouter();

  // 🔔 Alerta padrão do sistema (substitui window.alert)
  const [alertConfig, setAlertConfig] = useState<{
    message: string;
    variant: AlertVariant;
  } | null>(null);

  const showAlert = useCallback(
    (message: string, variant: AlertVariant = "info") => {
      setAlertConfig({ message, variant });
    },
    []
  );

  // Fecha sozinho depois de alguns segundos
  useEffect(() => {
    if (!alertConfig) return;
    const id = setTimeout(() => setAlertConfig(null), 3500);
    return () => clearTimeout(id);
  }, [alertConfig]);


  const horarioWrapperRef = useRef<HTMLDivElement | null>(null);
  const dataInputRef = useRef<HTMLInputElement | null>(null);

  const ultimoReqQuadrasRef = useRef<number>(0);
  const ultimoReqChurrasRef = useRef<number>(0);

  // QUADRAS
  const [horario, setHorario] = useState("");
  const [mostrarDisponQuadras, setMostrarDisponQuadras] = useState(true);
  const [disponQuadras, setDisponQuadras] = useState<
    Record<string, DisponQuadra[]> | null
  >(null);
  const [loadingQuadras, setLoadingQuadras] = useState<boolean>(true);

  // CHURRASQUEIRAS
  const [mostrarDisponChurras, setMostrarDisponChurras] = useState(true);
  const [disponChurras, setDisponChurras] = useState<ChurrasqueiraDisp[] | null>(
    null
  );
  const [loadingChurras, setLoadingChurras] = useState<boolean>(true);

  const [agendamentoSelecionado, setAgendamentoSelecionado] =
    useState<AgendamentoSelecionado | null>(null);
  const [loadingDetalhes, setLoadingDetalhes] = useState<boolean>(false);

  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [loadingCancelamento, setLoadingCancelamento] = useState(false);
  const [loadingTransferencia, setLoadingTransferencia] = useState(false);

  // Opções p/ permanente
  const [mostrarOpcoesCancelamento, setMostrarOpcoesCancelamento] =
    useState(false);

  // Exceção (cancelar 1 dia)
  const [mostrarExcecaoModal, setMostrarExcecaoModal] = useState(false);
  const [datasExcecao, setDatasExcecao] = useState<string[]>([]);
  const [dataExcecaoSelecionada, setDataExcecaoSelecionada] = useState<
    string | null
  >(null);
  const [postandoExcecao, setPostandoExcecao] = useState(false);

  // Transferência
  const [abrirModalTransferencia, setAbrirModalTransferencia] = useState(false);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [usuariosFiltrados, setUsuariosFiltrados] = useState<UsuarioLista[]>([]);
  const [usuarioSelecionado, setUsuarioSelecionado] =
    useState<UsuarioLista | null>(null);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);
  const [copiarExcecoes, setCopiarExcecoes] = useState(true); // apenas para permanentes

  // ➕ Adicionar jogadores
  const [abrirModalJogadores, setAbrirModalJogadores] = useState(false);
  const [buscaJogador, setBuscaJogador] = useState("");
  const [usuariosParaJogadores, setUsuariosParaJogadores] = useState<
    UsuarioLista[]
  >([]);
  const [jogadoresSelecionadosIds, setJogadoresSelecionadosIds] = useState<
    string[]
  >([]);
  const [jogadoresSelecionadosDetalhes, setJogadoresSelecionadosDetalhes] =
    useState<UsuarioLista[]>([]);
  const [convidadoNome, setConvidadoNome] = useState("");
  const [convidadoTelefone, setConvidadoTelefone] = useState("");
  const [convidadosPendentes, setConvidadosPendentes] = useState<string[]>([]);
  const [carregandoJogadores, setCarregandoJogadores] = useState(false);
  const [addingPlayers, setAddingPlayers] = useState(false);

  // Confirmação para agendar (quadra livre)
  const [mostrarConfirmaAgendar, setMostrarConfirmaAgendar] = useState(false);
  const [preReserva, setPreReserva] = useState<PreReserva | null>(null);

  // Confirmação para agendar (churrasqueira livre)
  const [mostrarConfirmaChurras, setMostrarConfirmaChurras] =
    useState(false);
  const [preReservaChurras, setPreReservaChurras] =
    useState<PreReservaChurras | null>(null);

  const [horarioAberto, setHorarioAberto] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const { usuario } = useAuthStore();

  // datas
  const [data, setData] = useState(""); // QUADRAS
  const [dataPickerAberto, setDataPickerAberto] = useState(false);

  const [dataChurras, setDataChurras] = useState(""); // CHURRASQUEIRAS
  const [dataPickerChurrasAberto, setDataPickerChurrasAberto] =
    useState(false);

  const [mesExibido, setMesExibido] = useState(() => {
    const base = data ? new Date(data + "T00:00:00") : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const [mesExibidoChurras, setMesExibidoChurras] = useState(() => {
    const base = dataChurras ? new Date(dataChurras + "T00:00:00") : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // manter o mês em sincronia se data mudar por outro motivo (quadras)
  useEffect(() => {
    if (!data) return;
    const base = new Date(data + "T00:00:00");
    setMesExibido(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [data]);

  // manter o mês de churrasqueiras em sincronia
  useEffect(() => {
    if (!dataChurras) return;
    const base = new Date(dataChurras + "T00:00:00");
    setMesExibidoChurras(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [dataChurras]);

  const isAllowed =
    !!usuario &&
    ["ADMIN_MASTER", "ADMIN_PROFESSORES"].includes(
      (usuario as { tipo?: string }).tipo || ""
    );

  // 👋 Nome para saudação
  const nomeSaudacao =
    firstAndLastName((usuario as { nome?: string } | null)?.nome || "") ||
    "Admin";

  // ========= BUSCAS BACKEND =========

  const buscarDisponQuadras = useCallback(async () => {
    if (!isAllowed) return;

    // id único para esta chamada
    const reqId = Date.now();
    ultimoReqQuadrasRef.current = reqId;
    setLoadingQuadras(true);

    // se não tiver data/horário, limpa resultado só se ainda for o último request
    if (!data || !horario) {
      if (ultimoReqQuadrasRef.current === reqId) {
        setDisponQuadras(null);
        setLoadingQuadras(false);
      }
      return;
    }

    try {
      const res = await axios.get<DisponibilidadeGeral>(
        `${API_URL}/disponibilidadeGeral/geral-admin-quadras`,
        {
          params: { data, horario },
          withCredentials: true,
        }
      );

      // se enquanto carregava o usuário mudou o filtro e outra requisição começou,
      // ignoramos essa resposta
      if (ultimoReqQuadrasRef.current !== reqId) return;

      setDisponQuadras(res.data.quadras || {});
    } catch (error) {
      console.error(error);

      if (ultimoReqQuadrasRef.current !== reqId) return;

      setDisponQuadras(null);
    } finally {
      // só tira o spinner se ainda for a requisição mais recente
      if (ultimoReqQuadrasRef.current === reqId) {
        setLoadingQuadras(false);
      }
    }
  }, [API_URL, data, horario, isAllowed]);

  const buscarDisponChurrasqueiras = useCallback(async () => {
    if (!isAllowed) return;

    const reqId = Date.now();
    ultimoReqChurrasRef.current = reqId;
    setLoadingChurras(true);

    if (!dataChurras) {
      if (ultimoReqChurrasRef.current === reqId) {
        setDisponChurras(null);
        setLoadingChurras(false);
      }
      return;
    }

    try {
      const res = await axios.get<DisponibilidadeGeral>(
        `${API_URL}/disponibilidadeGeral/geral-admin-churrasqueiras`,
        {
          params: { data: dataChurras, horario: hourStrSP() },
          withCredentials: true,
        }
      );

      if (ultimoReqChurrasRef.current !== reqId) return;

      setDisponChurras(res.data.churrasqueiras || []);
    } catch (error) {
      console.error(error);

      if (ultimoReqChurrasRef.current !== reqId) return;

      setDisponChurras(null);
    } finally {
      if (ultimoReqChurrasRef.current === reqId) {
        setLoadingChurras(false);
      }
    }
  }, [API_URL, dataChurras, isAllowed]);

  // Inicializa data/horário (SP) para ambos
  useEffect(() => {
    const hoje = todayStrSP();
    setData(hoje);
    setDataChurras(hoje);
    setHorario(hourStrSP());
  }, []);

  // Busca disponibilidade quando data/horário mudam (quadras)
  useEffect(() => {
    buscarDisponQuadras();
  }, [buscarDisponQuadras]);

  // Busca disponibilidade das churrasqueiras quando o dia muda
  useEffect(() => {
    buscarDisponChurrasqueiras();
  }, [buscarDisponChurrasqueiras]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Fecha o alerta primeiro
        if (alertConfig) {
          setAlertConfig(null);
          return;
        }

        if (agendamentoSelecionado) {
          setAgendamentoSelecionado(null);
          setConfirmarCancelamento(false);
          setMostrarOpcoesCancelamento(false);
          setMostrarExcecaoModal(false);
        } else if (mostrarConfirmaAgendar) {
          setMostrarConfirmaAgendar(false);
          setPreReserva(null);
        } else if (mostrarConfirmaChurras) {
          setMostrarConfirmaChurras(false);
          setPreReservaChurras(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    alertConfig,
    agendamentoSelecionado,
    mostrarConfirmaAgendar,
    mostrarConfirmaChurras,
  ]);


  // Fecha dropdown de horário ao clicar fora
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

  // Centraliza horário selecionado ao abrir dropdown
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
      const res = await axios.get(`${API_URL}/${rota}`, {
        withCredentials: true,
      });
      const dataRes = res.data as any;
      const usuarioFromApi = (dataRes as { usuario?: string | UsuarioRef })
        ?.usuario;
      const usuarioFromItem = (item as any)?.usuario;

      // aceita esporte como string OU { nome }
      // prioriza SEMPRE o esporte vindo do agendamento (API)
      const esporteNome =
        (typeof dataRes?.esporte === "string"
          ? dataRes.esporte
          : dataRes?.esporte?.nome) ?? extra?.esporte ?? null;

      setAgendamentoSelecionado({
        dia: extra?.dia || data, // 👈 quadras usam data, churrasqueiras usam dia próprio
        horario: extra?.horario || dataRes.horario || null,
        turno: extra?.turno || dataRes.turno || null,
        usuario: (usuarioFromApi ?? usuarioFromItem ?? "—") as
          | string
          | UsuarioRef
          | "—",
        jogadores: (dataRes as { jogadores?: JogadorRef[] })?.jogadores || [],
        esporte: esporteNome,
        tipoReserva: item.tipoReserva,
        agendamentoId,
        tipoLocal,
        diaSemana: dataRes?.diaSemana ?? null,
        dataInicio: dataRes?.dataInicio
          ? String(dataRes.dataInicio).slice(0, 10)
          : null,

        quadraNumero: dataRes.quadraNumero ?? null,
        quadraNome: dataRes.quadraNome ?? null,
        churrasqueiraNumero: dataRes.churrasqueiraNumero ?? null,
        churrasqueiraNome: dataRes.churrasqueiraNome ?? null,
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

  const cancelarAgendamento = async () => {
    if (!agendamentoSelecionado) {
      showAlert("Nenhum agendamento selecionado.", "error");
      return;
    }

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
      await axios.post(
        `${API_URL}/${rota}`,
        {},
        { withCredentials: true }
      );

      showAlert("Agendamento cancelado com sucesso!", "success");
      setAgendamentoSelecionado(null);
      setConfirmarCancelamento(false);
      setMostrarOpcoesCancelamento(false);

      if (tipoLocal === "quadra") {
        buscarDisponQuadras();
      } else {
        buscarDisponChurrasqueiras();
      }
    } catch (error) {
      console.error("Erro ao cancelar agendamento:", error);
      showAlert("Erro ao cancelar agendamento.", "error");
    } finally {
      setLoadingCancelamento(false);
    }
  };


  // Abrir modal de exceção (cancelar apenas 1 dia)
  // Abrir modal de exceção (cancelar apenas 1 dia)
  const abrirExcecao = () => {
    if (!agendamentoSelecionado?.diaSemana) {
      showAlert(
        "Não foi possível identificar o dia da semana deste permanente.",
        "error"
      );
      return;
    }

    const baseRef =
      agendamentoSelecionado.dia || data || todayStrSP();

    const lista = gerarProximasDatasDiaSemana(
      agendamentoSelecionado.diaSemana,
      baseRef,
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
    if (!agendamentoSelecionado?.agendamentoId || !dataExcecaoSelecionada) {
      showAlert("Selecione uma data para cancelar.", "info");
      return;
    }

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

      showAlert(
        "Exceção criada com sucesso (cancelado somente este dia).",
        "success"
      );
      setMostrarExcecaoModal(false);
      setAgendamentoSelecionado(null);

      if (agendamentoSelecionado.tipoLocal === "quadra") {
        buscarDisponQuadras();
      } else {
        buscarDisponChurrasqueiras();
      }
    } catch (e: any) {
      console.error(e);
      const raw =
        e?.response?.data?.erro ??
        e?.response?.data?.message ??
        e?.message;
      const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
      showAlert(msg, "error");
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
    if (!agendamentoSelecionado) {
      showAlert("Nenhum agendamento selecionado.", "error");
      return;
    }
    if (!usuarioSelecionado) {
      showAlert("Selecione um usuário para transferir.", "info");
      return;
    }

    if (agendamentoSelecionado.tipoLocal !== "quadra") {
      showAlert(
        "Transferência disponível apenas para quadras neste momento.",
        "info"
      );
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
        transferidoPorId: (usuario as any)?.id,
      };
      if (isPerm) body.copiarExcecoes = copiarExcecoes;

      await axios.patch(`${API_URL}/${rota}`, body, {
        withCredentials: true,
      });

      showAlert("Agendamento transferido com sucesso!", "success");
      setAgendamentoSelecionado(null);
      setAbrirModalTransferencia(false);
      buscarDisponQuadras();
    } catch (error: any) {
      console.error("Erro ao transferir agendamento:", error);
      const msg =
        error?.response?.data?.erro ||
        error?.response?.data?.message ||
        "Erro ao transferir agendamento.";
      showAlert(msg, "error");
    } finally {
      setLoadingTransferencia(false);
    }
  };

  // ====== ➕ ADICIONAR JOGADORES ======
  const abrirModalAdicionarJogadores = () => {
    setBuscaJogador("");
    setUsuariosParaJogadores([]);
    setJogadoresSelecionadosIds([]);
    setJogadoresSelecionadosDetalhes([]);
    setConvidadoNome("");
    setConvidadoTelefone("");
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

  const alternarSelecionado = (usuario: UsuarioLista) => {
    setJogadoresSelecionadosIds((prev) =>
      prev.includes(usuario.id)
        ? prev.filter((x) => x !== usuario.id)
        : [...prev, usuario.id]
    );

    setJogadoresSelecionadosDetalhes((prev) => {
      const existe = prev.some((j) => j.id === usuario.id);
      if (existe) {
        return prev.filter((j) => j.id !== usuario.id);
      }
      return [...prev, usuario];
    });
  };

  const adicionarConvidado = () => {
    const nome = convidadoNome.trim();
    const telefone = convidadoTelefone.trim();

    if (!nome) return;

    const combinado = telefone ? `${nome} ${telefone}`.trim() : nome;

    if (!convidadosPendentes.includes(combinado)) {
      setConvidadosPendentes((prev) => [...prev, combinado]);
    }

    setConvidadoNome("");
    setConvidadoTelefone("");
  };

  const removerConvidado = (nome: string) => {
    setConvidadosPendentes((prev) => prev.filter((n) => n !== nome));
  };

  const confirmarAdicionarJogadores = async () => {
    if (!agendamentoSelecionado?.agendamentoId) {
      showAlert("Nenhum agendamento selecionado.", "error");
      return;
    }

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

      showAlert("Jogadores adicionados com sucesso!", "success");
      setJogadoresSelecionadosIds([]);
      setJogadoresSelecionadosDetalhes([]);
      setConvidadosPendentes([]);
      setConvidadoNome("");
      setConvidadoTelefone("");
      setAbrirModalJogadores(false);
      buscarDisponQuadras();
    } catch (e) {
      console.error(e);
      showAlert("Erro ao adicionar jogadores.", "error");
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

  // ====== CONFIRMAÇÃO (churrasqueira) ======
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
    router.push(
      `/adminMaster/churrasqueiras/agendarChurrasqueira?${qs}`
    );
  };

  return (
    <div className="space-y-10">
      <SystemAlert
        open={!!alertConfig}
        message={alertConfig?.message ?? ""}
        variant={alertConfig?.variant ?? "info"}
        onClose={() => setAlertConfig(null)}
      />

      {/* 👋 SAUDAÇÃO ADMIN */}
      <div className="mt-4">

        <h1 className="text-[32px] sm:text-[38px] leading-tight font-extrabold text-orange-600 tracking-tight">
          Olá, {nomeSaudacao}!{" "}
          <span className="inline-block align-middle">👋</span>
        </h1>
        <p className="mt-1 text-sm sm:text-base font-medium text-gray-500">
          Administrador Master
        </p>
      </div>

      {/* ==========================
          FILTROS – QUADRAS
      =========================== */}
      <div className="bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <h2 className="text-[24px] sm:text-[26px] font-semibold text-gray-700 -ml-4 sm:-ml-4">
          Reservas de Quadras
        </h2>

        <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-end gap-3 sm:gap-4">
          {/* Campo Data QUADRAS */}
          <div className="relative w-full sm:w-[220px]">
            <button
              type="button"
              onClick={() => setDataPickerAberto((v) => !v)}
              className="flex items-center justify-between h-9 w-full rounded-md border border-gray-600 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
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

            {dataPickerAberto && (
              <div className="absolute z-20 mt-1 right-0 w-full rounded-lg border border-gray-200 bg-white shadow-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() =>
                      setMesExibido(
                        (prev) =>
                          new Date(
                            prev.getFullYear(),
                            prev.getMonth() - 1,
                            1
                          )
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
                        (prev) =>
                          new Date(
                            prev.getFullYear(),
                            prev.getMonth() + 1,
                            1
                          )
                      )
                    }
                    className="p-1 rounded hover:bg-gray-100"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
                  {["D", "S", "T", "Q", "Q", "S", "S"].map((d) => (
                    <div key={d} className="text-center">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1 text-sm">
                  {(() => {
                    const first = new Date(
                      mesExibido.getFullYear(),
                      mesExibido.getMonth(),
                      1
                    );
                    const startWeekday = first.getDay();
                    const startDate = new Date(first);
                    startDate.setDate(first.getDate() - startWeekday);

                    const todayIso = isoFromDate(new Date());

                    return Array.from({ length: 42 }, (_, i) => {
                      const d = new Date(startDate);
                      d.setDate(startDate.getDate() + i);

                      const iso = isoFromDate(d);
                      const isCurrentMonth =
                        d.getMonth() === mesExibido.getMonth();
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
                            !isCurrentMonth
                              ? "text-gray-300"
                              : "text-gray-800",
                            isToday && !isSelected
                              ? "border border-orange-400"
                              : "",
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

          {/* Campo Horário QUADRAS */}
          <div
            ref={horarioWrapperRef}
            className="relative flex w-full sm:w-[200px]"
          >
            <button
              type="button"
              onClick={() => setHorarioAberto((v) => !v)}
              className="flex items-center justify-between h-9 border border-gray-600 rounded-md px-3 text-sm bg-white w-full hover:border-gray-900 hover:shadow-sm transition"
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
              <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm">
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

          {/* Botão principal + seta para recolher (QUADRAS) */}
          <div className="flex items-center gap-2">
            <Link
              href={`/adminMaster/todosHorarios?data=${data || todayStrSP()}`}
              className="inline-flex items-center justify-center h-9 px-6 rounded-md font-semibold bg-orange-600 hover:bg-orange-700 text-white text-sm cursor-pointer transition shadow-sm whitespace-nowrap"
            >
              Ver todas as reservas
            </Link>

            <button
              type="button"
              onClick={() => setMostrarDisponQuadras((v) => !v)}
              className="inline-flex items-center justify-center h-11 w-11 rounded-full text-gray-700 hover:bg-gray-100 transition"
              aria-label={
                mostrarDisponQuadras
                  ? "Recolher disponibilidade de quadras"
                  : "Mostrar disponibilidade de quadras"
              }
            >
              <ChevronDown
                className={`w-10 h-10 transition-transform ${mostrarDisponQuadras ? "" : "rotate-180"
                  }`}
              />
            </button>
          </div>
        </div>
      </div>


      {/* ==========================
          DISPONIBILIDADE QUADRAS
      =========================== */}
      {mostrarDisponQuadras &&
        (loadingQuadras ? (
          <div className="flex items-center gap-2 text-gray-600">
            <Spinner />
            <span>Carregando disponibilidade de quadras…</span>
          </div>
        ) : !disponQuadras ? (
          <div className="text-sm text-gray-500">
            Não foi possível carregar as quadras.
          </div>
        ) : (
          <div className="space-y-8">
            {Object.keys(disponQuadras).map((esporte) => (
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
                  {(disponQuadras[esporte] || []).map((q: DisponQuadra) => {
                    const clickable = !q.bloqueada;

                    const hasAgendamento =
                      !q.disponivel &&
                      !!q.tipoReserva &&
                      (q.tipoReserva === "permanente" || !q.bloqueada);

                    const isPermanente = q.tipoReserva === "permanente";
                    const isComum = q.tipoReserva === "comum";

                    let statusClasses =
                      "border-slate-300 bg-slate-50 text-slate-800";

                    if (q.bloqueada) {
                      statusClasses =
                        "border-red-400 bg-red-50 text-red-800";
                    } else if (q.disponivel) {
                      statusClasses =
                        "border-emerald-400 bg-emerald-50 text-emerald-800";
                    } else if (isComum) {
                      statusClasses =
                        "border-amber-400 bg-amber-50 text-amber-800";
                    }

                    const nomeQuadraColor = q.bloqueada
                      ? "text-red-700"
                      : q.disponivel
                        ? "text-emerald-700"
                        : isComum
                          ? "text-amber-700"
                          : "text-gray-500";

                    const primeiroNomeQuadra =
                      (q.nome || "").split(" ")[0] || q.nome;

                    const cardBase =
                      "relative flex flex-col justify-between items-stretch " +
                      "rounded-2xl border shadow-sm px-3 py-3 " +
                      "transition-transform hover:-translate-y-0.5 hover:shadow-md " +
                      (clickable
                        ? "cursor-pointer"
                        : "cursor-not-allowed opacity-90");

                    const labelTipo = q.bloqueada
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
                        {/* TOPO */}
                        <p
                          className={`
                            text-[10px] font-medium mb-1
                            whitespace-nowrap overflow-hidden text-ellipsis
                            ${nomeQuadraColor}
                          `}
                        >
                          Quadra {q.numero} • {primeiroNomeQuadra}
                        </p>

                        {/* MIolo */}
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-1">
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

                        {/* BASE DO CARD */}
                        <div className="mt-1 pt-1 flex items-center justify-center text-[11px]">
                          <div className="inline-flex items-center gap-1">
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

                              {!q.disponivel &&
                                !q.bloqueada &&
                                isPermanente && (
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
          </div>
        ))}

      {/* ==========================
          FILTROS – CHURRASQUEIRAS
      =========================== */}
      <div className="bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <h2 className="text-[24px] sm:text-[26px] font-semibold text-gray-700 -ml-4 sm:-ml-4">
          Reservas de Churrasqueiras
        </h2>

        <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-end gap-3 sm:gap-4">
          {/* Campo Data CHURRASQUEIRAS (sem horário) */}
          <div className="relative w-full sm:w-[220px]">
            <button
              type="button"
              onClick={() => setDataPickerChurrasAberto((v) => !v)}
              className="flex items-center justify-between h-9 w-full rounded-md border border-gray-600 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
            >
              <div className="flex items-center">
                <Calendar className="w-4 h-4 text-gray-600 mr-2" />
                <span className="text-sm text-gray-800">
                  {formatarDataBR(dataChurras)}
                </span>
              </div>

              <ChevronDown
                className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${dataPickerChurrasAberto ? "rotate-180" : ""
                  }`}
              />
            </button>

            {dataPickerChurrasAberto && (
              <div className="absolute z-20 mt-1 right-0 w-full rounded-lg border border-gray-200 bg-white shadow-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() =>
                      setMesExibidoChurras(
                        (prev) =>
                          new Date(
                            prev.getFullYear(),
                            prev.getMonth() - 1,
                            1
                          )
                      )
                    }
                    className="p-1 rounded hover:bg-gray-100"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <span className="font-semibold text-sm">
                    {mesExibidoChurras.toLocaleDateString("pt-BR", {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setMesExibidoChurras(
                        (prev) =>
                          new Date(
                            prev.getFullYear(),
                            prev.getMonth() + 1,
                            1
                          )
                      )
                    }
                    className="p-1 rounded hover:bg-gray-100"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
                  {["D", "S", "T", "Q", "Q", "S", "S"].map((d) => (
                    <div key={d} className="text-center">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1 text-sm">
                  {(() => {
                    const first = new Date(
                      mesExibidoChurras.getFullYear(),
                      mesExibidoChurras.getMonth(),
                      1
                    );
                    const startWeekday = first.getDay();
                    const startDate = new Date(first);
                    startDate.setDate(first.getDate() - startWeekday);

                    const todayIso = isoFromDate(new Date());

                    return Array.from({ length: 42 }, (_, i) => {
                      const d = new Date(startDate);
                      d.setDate(startDate.getDate() + i);

                      const iso = isoFromDate(d);
                      const isCurrentMonth =
                        d.getMonth() === mesExibidoChurras.getMonth();
                      const isSelected = dataChurras === iso;
                      const isToday = todayIso === iso;

                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => {
                            setDataChurras(iso);
                            setDataPickerChurrasAberto(false);
                          }}
                          className={[
                            "h-8 w-8 rounded-full flex items-center justify-center mx-auto",
                            !isCurrentMonth
                              ? "text-gray-300"
                              : "text-gray-800",
                            isToday && !isSelected
                              ? "border border-orange-400"
                              : "",
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

          {/* Botão "Ver todas as reservas" + seta para recolher (CHURRASQUEIRAS) */}
          <div className="flex items-center gap-2">
            <Link
              href={`/adminMaster/todosHorarios?data=${data || todayStrSP()
                }`}
              className="inline-flex items-center justify-center h-9 px-6 rounded-md font-semibold bg-orange-600 hover:bg-orange-700 text-white text-sm cursor-pointer transition shadow-sm whitespace-nowrap"
            >
              Ver todas as reservas
            </Link>

            <button
              type="button"
              onClick={() => setMostrarDisponChurras((v) => !v)}
              className="inline-flex items-center justify-center h-11 w-11 rounded-full text-gray-700 hover:bg-gray-100 transition"
              aria-label={
                mostrarDisponChurras
                  ? "Recolher disponibilidade de churrasqueiras"
                  : "Mostrar disponibilidade de churrasqueiras"
              }
            >
              <ChevronDown
                className={`w-10 h-10 transition-transform ${mostrarDisponChurras ? "" : "rotate-180"
                  }`}
              />
            </button>
          </div>
        </div>
      </div>


      {/* ==========================
          DISPONIBILIDADE CHURRASQUEIRAS
      =========================== */}
      {mostrarDisponChurras &&
        (loadingChurras ? (
          <div className="flex items-center gap-2 text-gray-600">
            <Spinner />
            <span>Carregando disponibilidade de churrasqueiras…</span>
          </div>
        ) : !disponChurras ? (
          <div className="text-sm text-gray-500">
            Não foi possível carregar as churrasqueiras.
          </div>
        ) : (
          <section className="rounded-3xl bg-gray-100 border border-gray-100 px-4 sm:px-6 py-5 shadow-sm">
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
              {disponChurras.map((c: ChurrasqueiraDisp) => {
                const diaInfo = c.disponibilidade.find(
                  (t) => t.turno === "DIA"
                );

                const disponivel = !!diaInfo?.disponivel;
                const isPerm = diaInfo?.tipoReserva === "permanente";
                const isComum = diaInfo?.tipoReserva === "comum";

                let statusClasses =
                  "border-slate-300 bg-slate-50 text-slate-800";

                if (disponivel) {
                  statusClasses =
                    "border-emerald-400 bg-emerald-50 text-emerald-800";
                } else if (isComum) {
                  statusClasses =
                    "border-amber-400 bg-amber-50 text-amber-800";
                } else if (isPerm) {
                  statusClasses =
                    "border-slate-300 bg-slate-50 text-slate-800";
                }

                const nomeChurrasColor = disponivel
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
                    key={c.churrasqueiraId + "-dia"}
                    type="button"
                    onClick={() => {
                      if (disponivel) {
                        abrirConfirmacaoChurras({
                          data: dataChurras,
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
                          { turno: "DIA", dia: dataChurras }
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
              {disponChurras.map((c: ChurrasqueiraDisp) => {
                const noiteInfo = c.disponibilidade.find(
                  (t) => t.turno === "NOITE"
                );

                const disponivel = !!noiteInfo?.disponivel;
                const isPerm = noiteInfo?.tipoReserva === "permanente";
                const isComum = noiteInfo?.tipoReserva === "comum";

                let statusClasses =
                  "border-slate-300 bg-slate-50 text-slate-800";

                if (disponivel) {
                  statusClasses =
                    "border-emerald-400 bg-emerald-50 text-emerald-800";
                } else if (isComum) {
                  statusClasses =
                    "border-amber-400 bg-amber-50 text-amber-800";
                } else if (isPerm) {
                  statusClasses =
                    "border-slate-300 bg-slate-50 text-slate-800";
                }

                const nomeChurrasColor = disponivel
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
                          data: dataChurras,
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
                          { turno: "NOITE", dia: dataChurras }
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
        <div
          className={`fixed inset-0 flex items-center justify-center z-50 ${abrirModalTransferencia || abrirModalJogadores
            ? "bg-transparent"
            : "bg-black/40"
            }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setAgendamentoSelecionado(null);
              setConfirmarCancelamento(false);
              setMostrarOpcoesCancelamento(false);
              setMostrarExcecaoModal(false);
            }
          }}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] relative flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* BOTÃO X */}
            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="absolute right-5 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            {/* CABEÇALHO */}
            <div className="px-8 pt-14 pb-3">
              <p className="text-sm font-semibold text-orange-700 text-left">
                Informações de reserva
              </p>

              <p className="mt-4 text-xs text-gray-500 text-center">
                {agendamentoSelecionado.tipoLocal === "churrasqueira"
                  ? "Churrasqueira"
                  : "Quadra"}
                :{" "}
                <span className="font-semibold text-gray-900">
                  {(() => {
                    const sel = agendamentoSelecionado as any;

                    const numero =
                      sel.numero ??
                      sel.quadraNumero ??
                      sel.churrasqueiraNumero;
                    const nome =
                      sel.nome ?? sel.quadraNome ?? sel.churrasqueiraNome;

                    const numeroFmt =
                      typeof numero === "number" ||
                        typeof numero === "string"
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
                <div className="mb-1">
                  <Image
                    src="/iconescards/icone-permanente.png"
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

                {typeof agendamentoSelecionado.usuario !== "string" &&
                  agendamentoSelecionado.usuario?.celular && (
                    <div className="flex items-center justify-center gap-1 text-xs text-gray-600">
                      <Image
                        src="/iconescards/icone_phone.png"
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
              <div className="mt-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-y-2 text-xs text-gray-600">
                {/* COLUNA ESQUERDA (Dia / Esporte) */}
                <div className="flex flex-col gap-1">
                  {/* Dia */}
                  <div className="flex items-center gap-2">
                    <Image
                      src="/iconescards/calendario.png"
                      alt="Dia"
                      width={14}
                      height={14}
                      className="w-3.5 h-3.5"
                    />
                    <span>
                      Dia:{" "}
                      <span className="font-semibold text-gray-800">
                        {formatarDataBR(agendamentoSelecionado.dia)}
                      </span>
                    </span>
                  </div>

                  {/* Esporte */}
                  {agendamentoSelecionado.esporte && (
                    <div className="flex items-center gap-2">
                      <Image
                        src={(() => {
                          const esporteLower = (
                            agendamentoSelecionado.esporte ?? ""
                          ).toLowerCase();

                          if (esporteLower.includes("beach"))
                            return "/iconescards/bolaesporte.png";
                          if (esporteLower.includes("padel"))
                            return "/iconescards/padel.png";
                          if (
                            esporteLower.includes("vôlei") ||
                            esporteLower.includes("volei")
                          )
                            return "/iconescards/volei.png";
                          if (
                            esporteLower.includes("pickle") ||
                            esporteLower.includes("picle")
                          )
                            return "/iconescards/pickleball.png";

                          return "/iconescards/bolaesporte.png";
                        })()}
                        alt="Esporte"
                        width={14}
                        height={14}
                        className="w-3.5 h-3.5"
                      />
                      <span>
                        Esporte:{" "}
                        <span className="font-semibold text-gray-800">
                          {agendamentoSelecionado.esporte}
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                {/* COLUNA DIREITA (Horário/Turno / Tipo) */}
                <div className="flex flex-col gap-1 ml-auto w-fit">
                  {(agendamentoSelecionado.horario ||
                    agendamentoSelecionado.turno) && (
                      <div className="flex items-center gap-2">
                        <Image
                          src="/iconescards/horario.png"
                          alt={
                            agendamentoSelecionado.horario
                              ? "Horário"
                              : "Turno"
                          }
                          width={14}
                          height={14}
                          className="w-3.5 h-3.5"
                        />
                        <span>
                          {agendamentoSelecionado.horario ? (
                            <>
                              Horário:{" "}
                              <span className="font-semibold text-gray-800">
                                {agendamentoSelecionado.horario}
                              </span>
                            </>
                          ) : (
                            <>
                              Turno:{" "}
                              <span className="font-semibold text-gray-800">
                                {agendamentoSelecionado.turno}
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                    )}

                  {/* Tipo */}
                  <div className="flex items-center gap-2">
                    <Image
                      src={(() => {
                        const tipo = agendamentoSelecionado.tipoReserva;
                        if (tipo === "permanente")
                          return "/iconescards/icone_permanente_name.png";
                        if (tipo === "comum")
                          return "/iconescards/avulsacinza.png";
                        return "/iconescards/avulsacinza.png";
                      })()}
                      alt="Tipo de reserva"
                      width={14}
                      height={14}
                      className="w-3.5 h-3.5"
                    />
                    <span className="font-semibold text-gray-800">
                      {agendamentoSelecionado.tipoReserva === "permanente"
                        ? "Permanente"
                        : agendamentoSelecionado.tipoReserva === "comum"
                          ? "Avulsa"
                          : agendamentoSelecionado.tipoReserva}
                    </span>
                  </div>
                </div>
              </div>

              {/* JOGADORES */}
              {agendamentoSelecionado.tipoLocal === "quadra" && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-orange-700">
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
                                  src="/iconescards/icone_phone.png"
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
                  <div className="pt-2 flex justify-center">
                    <button
                      onClick={abrirModalAdicionarJogadores}
                      className="
          inline-flex items-center justify-center
          gap-1
          rounded-md
          border border-orange-500
          bg-orange-50
          text-orange-700 text-xs
          px-3 py-1
          cursor-pointer
          hover:bg-orange-100
          transition
        "
                    >
                      <Image
                        src="/iconescards/addmais.png"
                        alt="Adicionar jogadores"
                        width={12}
                        height={12}
                        className="w-3 h-3"
                      />
                      <span>Adicionar mais jogadores</span>
                    </button>
                  </div>
                )}

              {/* LINHA DIVISÓRIA */}
              <div className="border-t border-gray-200 mt-4 pt-1" />

              {/* BOTÕES DE AÇÃO INFERIORES */}
              <div className="flex flex-col sm:flex-row sm:justify-center gap-4 sm:gap-16">
                <button
                  onClick={abrirFluxoCancelamento}
                  className="
      w-full sm:w-[200px]
      inline-flex items-center justify-center
      rounded-md
      border border-red-500
      bg-red-50
      text-red-600
      px-6 py-2.5
      text-sm font-semibold
      cursor-pointer
      hover:bg-red-100
      transition-colors
    "
                >
                  Cancelar
                </button>

                {agendamentoSelecionado.tipoLocal === "quadra" && (
                  <button
                    onClick={abrirModalTransferir}
                    disabled={loadingTransferencia}
                    className="
        w-full sm:w-[200px]
        inline-flex items-center justify-center
        rounded-md
        border border-gray-500
        bg-gray-50
        text-gray-700
        px-6 py-2.5
        text-sm font-semibold
        cursor-pointer
        hover:bg-gray-100
        disabled:opacity-60
        transition-colors
      "
                  >
                    {loadingTransferencia
                      ? "Transferindo..."
                      : "Transferir"}
                  </button>
                )}
              </div>
            </div>

            {/* --- OVERLAYS INTERNOS (mantidos, só estilos ajustados) --- */}
            {confirmarCancelamento && agendamentoSelecionado && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-3xl z-50">
                <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 px-8 py-10">
                  {/* X para fechar */}
                  <button
                    onClick={() => setConfirmarCancelamento(false)}
                    className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
                    aria-label="Fechar"
                  >
                    ×
                  </button>

                  {/* TÍTULO */}
                  <h3 className="text-lg font-semibold text-orange-700 text-left">
                    Cancelar Agendamento Avulso
                  </h3>

                  {/* TEXTO DESCRITIVO */}
                  {(() => {
                    const usuarioNome =
                      typeof agendamentoSelecionado.usuario === "string"
                        ? agendamentoSelecionado.usuario
                        : agendamentoSelecionado.usuario?.nome || "—";

                    const isQuadra =
                      agendamentoSelecionado.tipoLocal === "quadra";

                    const numero =
                      agendamentoSelecionado.quadraNumero ??
                      agendamentoSelecionado.churrasqueiraNumero ??
                      "";

                    const nomeLocal =
                      agendamentoSelecionado.quadraNome ??
                      agendamentoSelecionado.churrasqueiraNome ??
                      "";

                    const numeroFmt =
                      numero !== "" ? String(numero).padStart(2, "0") : "";

                    let descricaoLocal = "";
                    if (isQuadra) {
                      const esporte =
                        agendamentoSelecionado.esporte || "Quadra";
                      descricaoLocal = `quadra de ${esporte} ${numeroFmt} - ${nomeLocal}`;
                    } else {
                      descricaoLocal = `churrasqueira ${numeroFmt} - ${nomeLocal}`;
                    }

                    const dataFmt = formatarDataBR(
                      agendamentoSelecionado.dia
                    );
                    const horarioFmt =
                      agendamentoSelecionado.horario || "";

                    return (
                      <p className="mt-4 text-sm text-gray-800 text-center leading-relaxed">
                        Você tem certeza que deseja cancelar a reserva de{" "}
                        <span className="font-semibold">{usuarioNome}</span> na{" "}
                        <span className="font-semibold">
                          {descricaoLocal}
                        </span>
                        , no dia{" "}
                        <span className="font-semibold">{dataFmt}</span>
                        {horarioFmt && (
                          <>
                            {" "}
                            às{" "}
                            <span className="font-semibold">
                              {horarioFmt}
                            </span>
                          </>
                        )}{" "}
                        ?
                      </p>
                    );
                  })()}

                  {/* BOTÕES */}
                  <div className="mt-8 flex justify-center gap-[72px]">
                    <button
                      onClick={cancelarAgendamento}
                      disabled={loadingCancelamento}
                      className="min-w-[150px] px-5 py-2.5 rounded-md border border-[#C73737]
                     bg-[#FFE9E9] text-[#B12A2A] text-sm font-semibold
                     hover:bg-[#FFDADA] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      {loadingCancelamento ? "Cancelando..." : "Cancelar"}
                    </button>

                    <button
                      onClick={() => setConfirmarCancelamento(false)}
                      disabled={loadingCancelamento}
                      className="min-w-[150px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                     bg-[#FFF3E0] text-[#D86715] text-sm font-semibold
                     hover:bg-[#FFE6C2] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CONFIRMAR CANCELAMENTO PERMANENTE */}
            {mostrarOpcoesCancelamento && agendamentoSelecionado && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-3xl z-50">
                <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 px-8 py-10">
                  {/* X para fechar */}
                  <button
                    onClick={() => setMostrarOpcoesCancelamento(false)}
                    className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
                    aria-label="Fechar"
                  >
                    ×
                  </button>

                  {/* TÍTULO */}
                  <h3 className="text-lg font-semibold text-orange-700 text-left">
                    Cancelar Agendamento Permanente
                  </h3>

                  {/* TEXTO DESCRITIVO */}
                  {(() => {
                    const usuarioNome =
                      typeof agendamentoSelecionado.usuario === "string"
                        ? agendamentoSelecionado.usuario
                        : agendamentoSelecionado.usuario?.nome || "—";

                    const isQuadra =
                      agendamentoSelecionado.tipoLocal === "quadra";

                    const numero =
                      agendamentoSelecionado.quadraNumero ??
                      agendamentoSelecionado.churrasqueiraNumero ??
                      "";

                    const nomeLocal =
                      agendamentoSelecionado.quadraNome ??
                      agendamentoSelecionado.churrasqueiraNome ??
                      "";

                    const numeroFmt =
                      numero !== "" ? String(numero).padStart(2, "0") : "";

                    let descricaoLocal = "";
                    if (isQuadra) {
                      const esporte =
                        agendamentoSelecionado.esporte || "Quadra";
                      descricaoLocal = `quadra de ${esporte} ${numeroFmt} - ${nomeLocal}`;
                    } else {
                      descricaoLocal = `churrasqueira ${numeroFmt} - ${nomeLocal}`;
                    }

                    const dataFmt = formatarDataBR(
                      agendamentoSelecionado.dia
                    );
                    const horarioFmt =
                      agendamentoSelecionado.horario || "";

                    return (
                      <>
                        <p className="mt-4 text-sm text-gray-800 text-center leading-relaxed">
                          Você tem certeza que deseja cancelar a reserva de{" "}
                          <span className="font-semibold">{usuarioNome}</span>{" "}
                          na{" "}
                          <span className="font-semibold">
                            {descricaoLocal}
                          </span>
                          , no dia{" "}
                          <span className="font-semibold">{dataFmt}</span>
                          {horarioFmt && (
                            <>
                              {" "}
                              às{" "}
                              <span className="font-semibold">
                                {horarioFmt}
                              </span>
                            </>
                          )}{" "}
                          ?
                        </p>
                      </>
                    );
                  })()}

                  {/* BOTÕES (Cancelar -> abrir seleção de dia / Voltar) */}
                  <div className="mt-8 flex justify-center gap-[72px]">
                    <button
                      onClick={abrirExcecao}
                      disabled={loadingCancelamento}
                      className="min-w-[150px] px-5 py-2.5 rounded-md border border-[#C73737]
                     bg-[#FFE9E9] text-[#B12A2A] text-sm font-semibold
                     hover:bg-[#FFDADA] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Cancelar
                    </button>

                    <button
                      onClick={() => setMostrarOpcoesCancelamento(false)}
                      disabled={loadingCancelamento}
                      className="min-w-[150px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                     bg-[#FFF3E0] text-[#D86715] text-sm font-semibold
                     hover:bg-[#FFE6C2] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ESCOLHA DO DIA DO CANCELAMENTO (EXCEÇÃO DO PERMANENTE) */}
            {mostrarExcecaoModal && agendamentoSelecionado && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-3xl z-50">
                <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 px-8 py-10">
                  {/* X para fechar */}
                  <button
                    onClick={() => setMostrarExcecaoModal(false)}
                    className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
                    aria-label="Fechar"
                  >
                    ×
                  </button>

                  {/* TÍTULO */}
                  <h3 className="text-lg font-semibold text-orange-700 text-left">
                    Escolha o dia do cancelamento
                  </h3>

                  {/* TEXTO DESCRITIVO */}
                  <p className="mt-4 text-sm text-gray-800 text-center leading-relaxed">
                    Você pode cancelar até 6 semanas à frente.{" "}
                    <br className="hidden sm:block" />
                    Escolha o dia:
                  </p>

                  {/* GRID DE DATAS (botões 17/12 etc) */}
                  <div className="mt-6 grid grid-cols-3 gap-3 justify-items-center">
                    {datasExcecao.length === 0 ? (
                      <p className="col-span-3 text-xs text-gray-500 text-center">
                        Não há datas disponíveis para exceção.
                      </p>
                    ) : (
                      datasExcecao.map((d) => {
                        const ativo = dataExcecaoSelecionada === d;
                        const [ano, mes, dia] = d.split("-");
                        const label = `${dia}/${mes}`;

                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDataExcecaoSelecionada(d)}
                            className={`min-w-[60px] h-8 px-3 rounded-md border text-sm font-medium
                  ${ativo
                                ? "border-[#E97A1F] bg-[#FFF3E0] text-[#D86715]"
                                : "border-gray-600 bg-white text-gray-800 hover:bg-gray-50"
                              }`}
                          >
                            {label}
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* BOTÕES (Cancelar exceção / Voltar) */}
                  <div className="mt-8 flex justify-center gap-[72px]">
                    <button
                      type="button"
                      onClick={confirmarExcecao}
                      disabled={!dataExcecaoSelecionada || postandoExcecao}
                      className="min-w-[150px] px-5 py-2.5 rounded-md border border-[#C73737]
                     bg-[#FFE9E9] text-[#B12A2A] text-sm font-semibold
                     hover:bg-[#FFDADA] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      {postandoExcecao ? "Cancelando..." : "Cancelar"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setMostrarExcecaoModal(false)}
                      disabled={postandoExcecao}
                      className="min-w-[150px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                     bg-[#FFF3E0] text-[#D86715] text-sm font-semibold
                     hover:bg-[#FFE6C2] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Voltar
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
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70]"
          onClick={(e) => {
            if (e.target === e.currentTarget && !loadingTransferencia) {
              setAbrirModalTransferencia(false);
            }
          }}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl mx-4 p-8 sm:p-10 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* X para fechar */}
            <button
              onClick={() =>
                !loadingTransferencia && setAbrirModalTransferencia(false)
              }
              className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            {/* TÍTULO */}
            <h3 className="text-xl sm:text-2xl font-semibold text-orange-700 mb-6">
              Transferir agendamento
            </h3>

            {/* CARTÃO INTERNO CINZA */}
            <div className="bg-[#F6F6F6] border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-6">
              {/* ====== ESCOLHA O JOGADOR (CADASTRADO) ====== */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Escolha o jogador para transferir a reserva
                </p>

                <div className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1 flex items-center gap-3">
                    <Image
                      src="/iconescards/icone-permanente.png"
                      alt="Atleta cadastrado"
                      width={20}
                      height={20}
                      className="w-5 h-5"
                    />
                    <input
                      type="text"
                      className="flex-1 h-10 rounded border border-gray-300 px-3 text-sm bg-white
                               focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400
                               placeholder:text-gray-400"
                      placeholder="Insira o nome do atleta cadastrado"
                      value={buscaUsuario}
                      onChange={(e) => setBuscaUsuario(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>

                {(carregandoUsuarios || buscaUsuario.trim().length > 0) && (
                  <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white text-sm divide-y">
                    {carregandoUsuarios && (
                      <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
                        <Spinner size="w-4 h-4" />
                        <span>Carregando usuários...</span>
                      </div>
                    )}

                    {!carregandoUsuarios &&
                      buscaUsuario.trim().length > 0 &&
                      usuariosFiltrados.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-500">
                          Nenhum usuário encontrado para{" "}
                          <span className="font-semibold">
                            "{buscaUsuario.trim()}"
                          </span>
                          .
                        </div>
                      )}

                    {!carregandoUsuarios &&
                      usuariosFiltrados.map((user) => {
                        const ativo = usuarioSelecionado?.id === user.id;
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => setUsuarioSelecionado(user)}
                            title={user.celular || ""}
                            className={`w-full px-3 py-2 flex items-center justify-between gap-3 text-left transition
                          ${ativo
                                ? "bg-orange-50 border-l-4 border-orange-500 font-medium"
                                : "hover:bg-orange-50"
                              }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-gray-800">
                                {user.nome}
                              </p>
                              {user.celular && (
                                <p className="text-[11px] text-gray-500 truncate">
                                  {user.celular}
                                </p>
                              )}
                            </div>
                            {ativo && (
                              <span className="text-[11px] text-orange-600 font-semibold">
                                Selecionado
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* ====== TRANSFERIR PARA CONVIDADO (APENAS VISUAL) ====== */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Transferir para convidado{" "}
                  <span className="text-xs font-normal text-gray-500">
                    *jogadores sem cadastro no sistema
                  </span>
                </p>

                <div className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1 flex items-center gap-3 ">
                    <Image
                      src="/iconescards/icone-permanente.png"
                      alt="Convidado"
                      width={20}
                      height={20}
                      className="w-5 h-5"
                    />
                    <input
                      type="text"
                      className="flex-1 h-10 rounded border border-gray-300 px-3 text-sm bg-white
                               placeholder:text-gray-400"
                      placeholder="Insira o nome do convidado"
                      disabled
                    />
                  </div>

                  <div className="flex-1 flex items-center gap-3">
                    <Image
                      src="/iconescards/icone_phone.png"
                      alt="Telefone"
                      width={20}
                      height={20}
                      className="w-5 h-5"
                    />
                    <input
                      type="text"
                      className="flex-1 h-10 rounded border border-gray-300 px-3 text-sm bg-white
                               placeholder:text-gray-400"
                      placeholder="(00) 000000000"
                      disabled
                    />
                  </div>

                  <button
                    type="button"
                    disabled
                    className="h-10 px-5 rounded-md border border-[#E97A1F]
                               bg-[#FFF3E0] text-[#D86715] text-sm font-semibold
                               opacity-40 cursor-not-allowed"
                  >
                    Adicionar
                  </button>
                </div>

                {agendamentoSelecionado?.tipoLocal === "quadra" &&
                  agendamentoSelecionado?.tipoReserva === "permanente" && (
                    <button
                      type="button"
                      onClick={() => setCopiarExcecoes((v) => !v)}
                      className="mt-4 inline-flex items-center gap-2 text-[12px] text-gray-700"
                    >
                      <span
                        className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors
                        ${copiarExcecoes
                            ? "border-[#E97A1F] bg-[#E97A1F]"
                            : "border-gray-400 bg-white"
                          }`}
                      >
                        {copiarExcecoes && (
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        )}
                      </span>
                      <span>Copiar exceções (datas já canceladas)</span>
                    </button>
                  )}
              </div>

              {/* ATLETA SELECIONADO */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Atleta selecionado:
                </p>

                {usuarioSelecionado ? (
                  <div className="inline-flex items-center gap-3 px-4 py-3 rounded-lg bg-white border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 text-xs text-gray-700">
                      <Image
                        src="/iconescards/icone-permanente.png"
                        alt="Atleta selecionado"
                        width={18}
                        height={18}
                        className="w-4 h-4"
                      />
                      <div className="flex flex-col">
                        <span className="font-semibold text-[13px]">
                          {usuarioSelecionado.nome}
                        </span>
                        {usuarioSelecionado.celular && (
                          <span className="text-[11px] text-gray-600">
                            {usuarioSelecionado.celular}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setUsuarioSelecionado(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm
                                 border border-[#C73737] bg-[#FFE9E9]
                                 text-[11px] text-[#B12A2A] font-semibold leading-none
                                 hover:bg-[#FFDADA] transition-colors"
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={3} />
                      Remover
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    Nenhum atleta selecionado ainda.
                  </p>
                )}
              </div>
            </div>

            {/* RODAPÉ – BOTÕES CANCELAR / CONFIRMAR ALTERAÇÃO */}
            <div className="mt-8 flex justify-center gap-[120px] max-sm:gap-6">
              <button
                onClick={() =>
                  !loadingTransferencia && setAbrirModalTransferencia(false)
                }
                disabled={loadingTransferencia}
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#C73737]
                           bg-[#FFE9E9] text-[#B12A2A] font-semibold
                           hover:bg-[#FFDADA] disabled:opacity-60
                           transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarTransferencia}
                disabled={!usuarioSelecionado || loadingTransferencia}
                className="min-w-[190px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                           bg-[#FFF3E0] text-[#D86715] font-semibold
                           hover:bg-[#FFE6C2] disabled:opacity-60
                           transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                {loadingTransferencia ? "Transferindo..." : "Confirmar alteração"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ➕ ADICIONAR JOGADORES */}
      {abrirModalJogadores && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70]"
          onClick={(e) => {
            if (e.target === e.currentTarget && !addingPlayers) {
              setAbrirModalJogadores(false);
            }
          }}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl mx-4 p-8 sm:p-10 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* X para fechar */}
            <button
              onClick={() => !addingPlayers && setAbrirModalJogadores(false)}
              className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            {/* Título */}
            <h3 className="text-lg sm:text-xl font-semibold text-orange-700 mb-6">
              Inserir Jogadores
            </h3>

            {/* CARTÃO CINZA INTERNO */}
            <div className="bg-[#F6F6F6] border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-6">
              {/* ===================== ATLETAS CADASTRADOS ===================== */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-gray-700">
                    Adicionar atletas cadastrados
                  </p>

                  {jogadoresSelecionadosIds.length > 0 && (
                    <span className="text-[11px] text-gray-500">
                      Selecionados:{" "}
                      <span className="font-semibold text-orange-600">
                        {jogadoresSelecionadosIds.length}
                      </span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Image
                    src="/iconescards/icone-permanente.png"
                    alt="Atleta cadastrado"
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-70"
                  />
                  <input
                    type="text"
                    className="flex-1 h-10 rounded border border-gray-300 px-3 text-sm bg-white
                         focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400
                         placeholder:text-gray-400"
                    placeholder="Insira o nome do atleta cadastrado"
                    value={buscaJogador}
                    onChange={(e) => setBuscaJogador(e.target.value)}
                    autoFocus
                  />
                </div>

                {(carregandoJogadores ||
                  buscaJogador.trim().length >= 2) && (
                    <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white text-sm divide-y">
                      {carregandoJogadores && (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
                          <Spinner size="w-4 h-4" />
                          <span>Buscando atletas...</span>
                        </div>
                      )}

                      {!carregandoJogadores &&
                        buscaJogador.trim().length >= 2 &&
                        usuariosParaJogadores.length === 0 && (
                          <div className="px-3 py-2 text-xs text-gray-500">
                            Nenhum atleta encontrado para{" "}
                            <span className="font-semibold">
                              "{buscaJogador.trim()}"
                            </span>
                            .
                          </div>
                        )}

                      {!carregandoJogadores &&
                        usuariosParaJogadores.map((u) => {
                          const ativo =
                            jogadoresSelecionadosIds.includes(u.id);

                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => alternarSelecionado(u)}
                              title={u.celular || ""}
                              className={`w-full px-3 py-2 flex items-center justify-between gap-3 text-left transition
                      ${ativo
                                  ? "bg-orange-50 border-l-4 border-orange-500"
                                  : "hover:bg-orange-50"
                                }`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-800 truncate">
                                  {u.nome}
                                </p>

                                {u.celular && (
                                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500 truncate">
                                    <Image
                                      src="/iconescards/icone_phone.png"
                                      alt="Telefone"
                                      width={12}
                                      height={12}
                                      className="w-3 h-3 flex-shrink-0 opacity-80"
                                    />
                                    <span className="truncate">
                                      {u.celular}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="ml-2 flex items-center gap-2">
                                {ativo ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                                    <Check className="w-3 h-3" />
                                    Selecionado
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-gray-500">
                                    Clique para selecionar
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  )}
              </div>

              {/* ===================== CONVIDADOS ===================== */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Adicionar atletas convidados{" "}
                  <span className="text-xs font-normal text-gray-500">
                    *jogadores sem cadastro no sistema
                  </span>
                </p>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 flex items-center gap-3">
                    <Image
                      src="/iconescards/icone-permanente.png"
                      alt="Convidado"
                      width={20}
                      height={20}
                      className="w-5 h-5 opacity-70"
                    />
                    <input
                      type="text"
                      className="flex-1 h-10 rounded border border-gray-300 px-3 text-sm bg-white
                           focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                      placeholder="Insira o nome do jogador"
                      value={convidadoNome}
                      onChange={(e) => setConvidadoNome(e.target.value)}
                    />
                  </div>

                  <div className="flex-1 flex items-center gap-3">
                    <Image
                      src="/iconescards/icone_phone.png"
                      alt="Telefone"
                      width={20}
                      height={20}
                      className="w-5 h-5"
                    />
                    <input
                      type="text"
                      className="flex-1 h-10 rounded border border-gray-300 px-3 text-sm bg-white
                           focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                      placeholder="(00) 000000000"
                      value={convidadoTelefone}
                      onChange={(e) =>
                        setConvidadoTelefone(e.target.value)
                      }
                    />
                  </div>

                  <button
                    type="button"
                    onClick={adicionarConvidado}
                    disabled={
                      !convidadoNome.trim() ||
                      !convidadoTelefone.trim()
                    }
                    className="h-10 px-4 rounded-md border border-[#E97A1F] bg-[#FFF3E0]
                         text-[#D86715] text-sm font-semibold
                         disabled:opacity-60 hover:bg-[#FFE6C2] transition-colors"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              {/* ===================== JOGADORES ADICIONADOS ===================== */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Jogadores adicionados:
                </p>

                {jogadoresSelecionadosDetalhes.length > 0 ||
                  convidadosPendentes.length > 0 ? (
                  <div className="mt-2 grid grid-cols-2 gap-x-10 gap-y-4 justify-items-center">
                    {jogadoresSelecionadosDetalhes.map((u) => (
                      <div key={u.id} className="flex items-center gap-3">
                        <div
                          className="flex-1 flex flex-col gap-0.5 px-4 py-3 rounded-md
                          bg-[#F4F4F4] border border-[#D3D3D3] shadow-sm
                          min-w-[220px] max-w-[240px]"
                        >
                          <div className="flex items-center gap-1 text-[11px] text-[#555555] truncate">
                            <Image
                              src="/iconescards/icone-permanente.png"
                              alt="Atleta"
                              width={14}
                              height={14}
                              className="w-3.5 h-3.5 flex-shrink-0 opacity-80"
                            />
                            <span className="font-semibold truncate">
                              {u.nome}
                            </span>
                          </div>

                          {u.celular && (
                            <div className="flex items-center gap-1 text-[11px] text-[#777777] truncate">
                              <Image
                                src="/iconescards/icone_phone.png"
                                alt="Telefone"
                                width={12}
                                height={12}
                                className="w-3 h-3 flex-shrink-0 opacity-80"
                              />
                              <span className="truncate">
                                {u.celular}
                              </span>
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => alternarSelecionado(u)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-[2px] rounded-sm
 border border-[#C73737] bg-[#FFE9E9] text-[#B12A2A] text-[10px] font-semibold
 hover:bg-[#FFDADA] disabled:opacity-60
 transition-colors shadow-[0_1px_0_rgba(0,0,0,0.05)]"
                        >
                          <X className="w-4 h-4" strokeWidth={4} />
                          Remover
                        </button>
                      </div>
                    ))}

                    {convidadosPendentes.map((nome) => (
                      <div key={nome} className="flex items-center gap-3">
                        <div
                          className="flex-1 flex flex-col gap-0.5 px-4 py-3 rounded-md
                          bg-[#F4F4F4] border border-[#D3D3D3] shadow-sm
                          min-w-[220px] max-w-[240px]"
                        >
                          <div className="flex items-center gap-1 text-[11px] text-[#555555] truncate">
                            <Image
                              src="/iconescards/icone-permanente.png"
                              alt="Jogador convidado"
                              width={14}
                              height={14}
                              className="w-3.5 h-3.5 flex-shrink-0 opacity-80"
                            />
                            <span className="font-semibold truncate">
                              {nome}
                            </span>
                          </div>

                          <div className="text-[11px] text-[#777777]">
                            Convidado
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removerConvidado(nome)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm
                       border border-[#C73737] bg-white
                       text-[11px] text-[#B12A2A] font-semibold leading-none
                       hover:bg-[#FFE9E9] transition-colors"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={3} />
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    Nenhum jogador adicionado até o momento.
                  </p>
                )}
              </div>
            </div>

            {/* RODAPÉ – BOTÕES CANCELAR / INSERIR */}
            <div className="mt-8 flex justify-center gap-[120px]">
              <button
                onClick={() => !addingPlayers && setAbrirModalJogadores(false)}
                disabled={addingPlayers}
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#C73737]
                     bg-[#FFE9E9] text-[#B12A2A] font-semibold
                     hover:bg-[#FFDADA] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
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
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                     bg-[#FFF3E0] text-[#D86715] font-semibold
                     hover:bg-[#FFE6C2] disabled:opacity-60
                     transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                {addingPlayers ? "Inserindo..." : "Inserir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirmar agendamento (quadra livre) */}
      {mostrarConfirmaAgendar && preReserva && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-[70]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setMostrarConfirmaAgendar(false);
              setPreReserva(null);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-12 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* X para fechar */}
            <button
              onClick={() => setMostrarConfirmaAgendar(false)}
              className="absolute right-5 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            {/* Título */}
            <h3 className="text-base sm:text-lg font-semibold text-left mb-4 text-orange-700">
              Confirmar Agendamento
            </h3>

            {/* Texto */}
            <p className="text-sm text-gray-800 mb-7 text-center leading-relaxed">
              Deseja realizar uma reserva de{" "}
              <span className="font-semibold">
                {preReserva.esporte}
              </span>{" "}
              na{" "}
              <span className="font-semibold">
                quadra {String(preReserva.quadraNumero).padStart(2, "0")} -{" "}
                {preReserva.quadraNome}
              </span>
              , no dia{" "}
              <span className="font-semibold">
                {toDdMm(preReserva.data)}
              </span>{" "}
              às{" "}
              <span className="font-semibold">
                {preReserva.horario}
              </span>
              ?
            </p>

            {/* Botões */}
            <div className="mt-2 flex gap-24 justify-center">
              <button
                onClick={() => setMostrarConfirmaAgendar(false)}
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#C73737] bg-[#FFE9E9] text-[#B12A2A] font-semibold hover:bg-[#FFDADA] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Cancelar
              </button>

              <button
                onClick={irParaAgendarComum}
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#E97A1F] bg-[#FFF3E0] text-[#D86715] font-semibold hover:bg-[#FFE6C2] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Reservar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirmar agendamento (churrasqueira livre) */}
      {mostrarConfirmaChurras && preReservaChurras && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-[70]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setMostrarConfirmaChurras(false);
              setPreReservaChurras(null);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-12 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* X para fechar */}
            <button
              onClick={() => setMostrarConfirmaChurras(false)}
              className="absolute right-5 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            {/* Título */}
            <h3 className="text-base sm:text-lg font-semibold text-left mb-4 text-orange-700">
              Confirmar Agendamento
            </h3>

            {/* Texto */}
            <p className="text-sm text-gray-800 mb-7 text-center leading-relaxed">
              Deseja realizar uma reserva na{" "}
              <span className="font-semibold">
                churrasqueira{" "}
                {String(
                  preReservaChurras.churrasqueiraNumero
                ).padStart(2, "0")}{" "}
                - {preReservaChurras.churrasqueiraNome}
              </span>
              , no dia{" "}
              <span className="font-semibold">
                {toDdMm(preReservaChurras.data)}
              </span>{" "}
              no turno{" "}
              <span className="font-semibold">
                {preReservaChurras.turno}
              </span>
              ?
            </p>

            {/* Botões */}
            <div className="mt-2 flex gap-24 justify-center">
              <button
                onClick={() => setMostrarConfirmaChurras(false)}
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#C73737] bg-[#FFE9E9] text-[#B12A2A] font-semibold hover:bg-[#FFDADA] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Cancelar
              </button>
              <button
                onClick={irParaAgendarChurrasqueira}
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#E97A1F] bg-[#FFF3E0] text-[#D86715] font-semibold hover:bg-[#FFE6C2] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Reservar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

