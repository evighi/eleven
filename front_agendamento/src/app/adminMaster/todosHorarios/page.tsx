"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import { useAuthStore } from "@/context/AuthStore";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Check, X } from "lucide-react";

/* =========================
   Tipos da rota /disponibilidadeGeral/dia
========================= */
type Usuario = { nome: string; email?: string; celular?: string };

type SlotInfo = {
  disponivel: boolean;
  bloqueada?: boolean;
  tipoReserva?: "comum" | "permanente";
  usuario?: Usuario;
  agendamentoId?: string;
};

type QuadraSlots = {
  quadraId: string;
  nome: string;
  numero: number;
  slots: Record<string, SlotInfo>; // hora -> slot
};

type EsporteBlock = {
  quadras: QuadraSlots[];
  grupos: QuadraSlots[][];
};

type ApiResp = {
  data: string; // YYYY-MM-DD
  horas: string[]; // ["07:00", ... "23:00"]
  esportes: Record<string, EsporteBlock>;
};

/* =========================
   Tipos para modais (mesma lógica da Home)
========================= */
type JogadorRef = { nome: string; celular?: string | null };
type TipoReserva = "comum" | "permanente";

type AgendamentoSelecionado = {
  dia: string; // YYYY-MM-DD (data do filtro da página)
  horario: string; // HH:MM
  usuario: string | Usuario | "—";
  jogadores: JogadorRef[];
  esporte?: string | null;
  tipoReserva: TipoReserva;
  agendamentoId: string;
  tipoLocal: "quadra";
  quadraNumero?: number | null;
  quadraNome?: string | null;

  // p/ permanente:
  diaSemana?: string | null;
  dataInicio?: string | null; // YYYY-MM-DD
};

type UsuarioLista = {
  id: string;
  nome: string;
  email?: string;
  celular?: string | null;
};

type AlertVariant = "success" | "error" | "info";

/* =========================
   SystemAlert (igual o da Home)
========================= */
function SystemAlert({
  open,
  message,
  variant = "info",
  onClose,
}: {
  open: boolean;
  message: string;
  variant?: AlertVariant;
  onClose: () => void;
}) {
  if (!open || !message) return null;

  const styles =
    (
      {
        success: {
          container: "bg-emerald-50 border-emerald-200 text-emerald-800",
          chip: "bg-emerald-100 border border-emerald-300 text-emerald-800",
        },
        error: {
          container: "bg-red-50 border-red-200 text-red-800",
          chip: "bg-red-100 border border-red-300 text-red-800",
        },
        info: {
          container: "bg-orange-50 border-orange-200 text-orange-800",
          chip: "bg-orange-100 border border-orange-300 text-orange-800",
        },
      } as const
    )[variant] || {
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
            <span className="text-[11px] uppercase tracking-[0.16em] text-black/50">
              Eleven Sports • Aviso
            </span>
            <span className="mt-1 text-sm font-medium leading-snug">{message}</span>
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

/* =========================
   Helpers de data (iguais à Home)
========================= */
const SP_TZ = "America/Sao_Paulo";

const todayStrSP = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

function isoFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const formatarDataBR = (iso?: string) => {
  if (!iso) return "Selecione uma data";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

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

function firstAndLastName(fullName?: string | null) {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/* helpers visuais do QUADRO ANTIGO */
function firstName(full?: string) {
  if (!full) return "";
  const [a] = full.trim().split(/\s+/);
  return a || "";
}
function onlyHour(hhmm?: string) {
  if (!hhmm) return "";
  const [hh] = hhmm.split(":");
  return hh || hhmm;
}

const DIA_IDX: Record<string, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

/** Próximas datas do mesmo dia-da-semana (idêntico à Home) */
function gerarProximasDatasDiaSemana(
  diaSemana: string,
  baseYmd?: string | null,
  dataInicio?: string | null,
  quantidade = 6,
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

/* =========================
   Página
========================= */
export default function TodosHorariosPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const { usuario } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  // 🔔 Alerta estilo Home
  const [alertConfig, setAlertConfig] = useState<{
    message: string;
    variant: AlertVariant;
  } | null>(null);

  const showAlert = useCallback((message: string, variant: AlertVariant = "info") => {
    setAlertConfig({ message, variant });
  }, []);

  useEffect(() => {
    if (!alertConfig) return;
    const id = setTimeout(() => setAlertConfig(null), 3500);
    return () => clearTimeout(id);
  }, [alertConfig]);

  const [data, setData] = useState<string>("");
  const [horas, setHoras] = useState<string[]>([]);
  const [esportes, setEsportes] = useState<Record<string, EsporteBlock> | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);

  // Calendário (mesmo da Home)
  const [dataPickerAberto, setDataPickerAberto] = useState(false);
  const calendarioWrapperRef = useRef<HTMLDivElement | null>(null);

  const [mesExibido, setMesExibido] = useState(() => {
    const base = data ? new Date(data + "T00:00:00") : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (!data) return;
    const base = new Date(data + "T00:00:00");
    setMesExibido(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [data]);

  // Modal de detalhes
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [agendamentoSelecionado, setAgendamentoSelecionado] =
    useState<AgendamentoSelecionado | null>(null);

  // Ações (iguais à Home)
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [mostrarOpcoesCancelamento, setMostrarOpcoesCancelamento] = useState(false);
  const [loadingCancelamento, setLoadingCancelamento] = useState(false);

  // Exceção (permanente: cancelar 1 dia)
  const [mostrarExcecaoModal, setMostrarExcecaoModal] = useState(false);
  const [datasExcecao, setDatasExcecao] = useState<string[]>([]);
  const [dataExcecaoSelecionada, setDataExcecaoSelecionada] = useState<string | null>(
    null
  );
  const [postandoExcecao, setPostandoExcecao] = useState(false);

  // Transferência
  const [abrirModalTransferencia, setAbrirModalTransferencia] = useState(false);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [usuariosFiltrados, setUsuariosFiltrados] = useState<UsuarioLista[]>([]);
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<UsuarioLista | null>(
    null
  );
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);
  const [loadingTransferencia, setLoadingTransferencia] = useState(false);
  const [copiarExcecoes, setCopiarExcecoes] = useState(true);

  // Adicionar jogadores
  const [abrirModalJogadores, setAbrirModalJogadores] = useState(false);
  const [buscaJogador, setBuscaJogador] = useState("");
  const [usuariosParaJogadores, setUsuariosParaJogadores] = useState<UsuarioLista[]>(
    []
  );
  const [jogadoresSelecionadosIds, setJogadoresSelecionadosIds] = useState<string[]>(
    []
  );
  const [jogadoresSelecionadosDetalhes, setJogadoresSelecionadosDetalhes] =
    useState<UsuarioLista[]>([]);
  const [convidadoNome, setConvidadoNome] = useState("");
  const [convidadoTelefone, setConvidadoTelefone] = useState("");
  const [convidadosPendentes, setConvidadosPendentes] = useState<string[]>([]);
  const [carregandoJogadores, setCarregandoJogadores] = useState(false);
  const [addingPlayers, setAddingPlayers] = useState(false);

  // Confirmação de agendamento rápido (slot livre)
  const [confirmAgendar, setConfirmAgendar] = useState(false);
  const [agendarCtx, setAgendarCtx] = useState<{
    hora: string;
    esporte: string;
    quadraId: string;
    quadraNome: string;
    quadraNumero: number;
  } | null>(null);

  // ✅ evita "flash" de datas: ignora respostas antigas
  const carregarSeqRef = useRef(0);
  const dataAtualRef = useRef<string>("");

  useEffect(() => {
    dataAtualRef.current = data;
  }, [data]);


  /* =========================
     Inicialização / URL params
  ========================= */
  useEffect(() => {
    const q = searchParams.get("data");
    const isISO = q && /^\d{4}-\d{2}-\d{2}$/.test(q);
    setData(isISO ? q! : todayStrSP());
  }, [searchParams]);

  // consumir alertSuccess/alertInfo da URL (e mostrar como alert da Home)
  useEffect(() => {
    const msgSuccess = searchParams.get("alertSuccess");
    const msgInfo = searchParams.get("alertInfo");

    if (msgSuccess || msgInfo) {
      if (msgSuccess) showAlert(msgSuccess, "success");

      if (msgInfo) {
        if (msgSuccess) {
          setTimeout(() => showAlert(msgInfo, "info"), 3800);
        } else {
          showAlert(msgInfo, "info");
        }
      }

      const params = new URLSearchParams(searchParams.toString());
      params.delete("alertSuccess");
      params.delete("alertInfo");

      const qs = params.toString();
      const basePath = "/adminMaster/todosHorarios";
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router, showAlert]);

  // Fecha calendário ao clicar fora
  useEffect(() => {
    if (!dataPickerAberto) return;
    const onDown = (e: MouseEvent) => {
      if (
        calendarioWrapperRef.current &&
        !calendarioWrapperRef.current.contains(e.target as Node)
      ) {
        setDataPickerAberto(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [dataPickerAberto]);

  // ESC fecha tudo (igual Home)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      if (alertConfig) {
        setAlertConfig(null);
        return;
      }

      if (abrirModalTransferencia) {
        if (!loadingTransferencia) setAbrirModalTransferencia(false);
        return;
      }

      if (abrirModalJogadores) {
        if (!addingPlayers) setAbrirModalJogadores(false);
        return;
      }

      if (agendamentoSelecionado) {
        setAgendamentoSelecionado(null);
        setConfirmarCancelamento(false);
        setMostrarOpcoesCancelamento(false);
        setMostrarExcecaoModal(false);
        return;
      }

      if (confirmAgendar) {
        setConfirmAgendar(false);
        setAgendarCtx(null);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    alertConfig,
    agendamentoSelecionado,
    abrirModalJogadores,
    addingPlayers,
    abrirModalTransferencia,
    loadingTransferencia,
    confirmAgendar,
  ]);

  /* =========================
     Carregar dia
  ========================= */
  const carregar = useCallback(
    async (d: string) => {
      const seq = ++carregarSeqRef.current; // ✅ id único para esta chamada

      setErro("");
      setLoading(true);

      try {
        const url = `${API_URL}/disponibilidadeGeral/dia`;
        const { data: resp } = await axios.get<ApiResp>(url, {
          params: { data: d },
          withCredentials: true,
        });

        // ✅ se houve outra seleção/request depois desta, ignora esta resposta
        if (seq !== carregarSeqRef.current) return;
        // ✅ extra segurança: se a data atual já mudou, ignora também
        if (dataAtualRef.current && dataAtualRef.current !== d) return;

        setHoras(resp.horas || []);
        setEsportes(resp.esportes || {});
      } catch (e) {
        // ✅ não mostra erro de request antigo
        if (seq !== carregarSeqRef.current) return;

        console.error(e);
        setEsportes(null);
        setErro("Erro ao carregar a disponibilidade do dia.");
      } finally {
        // ✅ só encerra loading se esta for a request mais recente
        if (seq === carregarSeqRef.current) setLoading(false);
      }
    },
    [API_URL]
  );

  useEffect(() => {
    if (data) carregar(data);
  }, [carregar, data]);

  const refresh = useCallback(() => {
    if (data) carregar(data);
  }, [carregar, data]);

  /* =========================
     Detalhes (igual Home)
  ========================= */
  const abrirDetalhes = useCallback(
    async (
      agendamentoId: string,
      tipoReserva: TipoReserva,
      horario: string,
      esporte: string,
      quadraNumero?: number,
      quadraNome?: string
    ) => {
      if (!agendamentoId || !tipoReserva) return;

      try {
        setLoadingDetalhes(true);
        const rota =
          tipoReserva === "permanente"
            ? `agendamentosPermanentes/${agendamentoId}`
            : `agendamentos/${agendamentoId}`;

        const { data: det } = await axios.get(`${API_URL}/${rota}`, {
          withCredentials: true,
        });

        const usuarioValor: string | Usuario =
          typeof det?.usuario === "object" || typeof det?.usuario === "string"
            ? det.usuario
            : "—";

        const jogadores: JogadorRef[] = Array.isArray(det?.jogadores) ? det.jogadores : [];

        const esporteNome =
          (typeof det?.esporte === "string" ? det.esporte : det?.esporte?.nome) ??
          esporte ??
          null;

        setAgendamentoSelecionado({
          dia: data,
          horario,
          usuario: usuarioValor,
          jogadores,
          esporte: esporteNome,
          tipoReserva,
          agendamentoId,
          tipoLocal: "quadra",
          quadraNumero: quadraNumero ?? null,
          quadraNome: quadraNome ?? null,
          diaSemana: det?.diaSemana ?? null,
          dataInicio: det?.dataInicio ? String(det.dataInicio).slice(0, 10) : null,
        });
      } catch (err) {
        console.error("Erro ao buscar detalhes:", err);
        showAlert("Erro ao buscar detalhes.", "error");
      } finally {
        setLoadingDetalhes(false);
      }
    },
    [API_URL, data, showAlert]
  );

  /* =========================
     Slot livre -> confirmar agendar
  ========================= */
  const abrirConfirmAgendar = useCallback(
    (hora: string, esporte: string, q: { quadraId: string; nome: string; numero: number }) => {
      if (!data) return;
      setAgendarCtx({
        hora,
        esporte,
        quadraId: q.quadraId,
        quadraNome: q.nome,
        quadraNumero: q.numero,
      });
      setConfirmAgendar(true);
    },
    [data]
  );

  const confirmarAgendamentoRapido = () => {
    if (!agendarCtx || !data) return;
    const params = new URLSearchParams({
      data,
      horario: agendarCtx.hora,
      quadraId: agendarCtx.quadraId,
      esporte: agendarCtx.esporte,
    });
    setConfirmAgendar(false);
    setAgendarCtx(null);
    router.push(`/adminMaster/quadras/agendarComum?${params.toString()}`);
  };

  /* =========================
     Cancelar
  ========================= */
  const abrirFluxoCancelamento = () => {
    if (!agendamentoSelecionado) return;
    if (agendamentoSelecionado.tipoReserva === "permanente") {
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

    const { agendamentoId, tipoReserva } = agendamentoSelecionado;
    const rota =
      tipoReserva === "permanente"
        ? `agendamentosPermanentes/cancelar/${agendamentoId}`
        : `agendamentos/cancelar/${agendamentoId}`;

    try {
      await axios.post(`${API_URL}/${rota}`, {}, { withCredentials: true });
      showAlert("Agendamento cancelado com sucesso!", "success");
      setAgendamentoSelecionado(null);
      setConfirmarCancelamento(false);
      setMostrarOpcoesCancelamento(false);
      refresh();
    } catch (error: any) {
      console.error("Erro ao cancelar agendamento:", error);
      const msg =
        error?.response?.data?.erro ||
        error?.response?.data?.message ||
        "Erro ao cancelar agendamento.";
      showAlert(msg, "error");
    } finally {
      setLoadingCancelamento(false);
    }
  };

  /* =========================
     Permanente: exceção (cancelar 1 dia)
  ========================= */
  const abrirExcecao = () => {
    if (!agendamentoSelecionado?.diaSemana) {
      showAlert("Não foi possível identificar o dia da semana deste permanente.", "error");
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

  const confirmarExcecao = async () => {
    if (!agendamentoSelecionado?.agendamentoId || !dataExcecaoSelecionada) {
      showAlert("Selecione uma data para cancelar.", "info");
      return;
    }

    try {
      setPostandoExcecao(true);
      await axios.post(
        `${API_URL}/agendamentosPermanentes/${agendamentoSelecionado.agendamentoId}/cancelar-dia`,
        { data: dataExcecaoSelecionada, usuarioId: (usuario as any)?.id },
        { withCredentials: true }
      );

      showAlert("Exceção criada com sucesso (cancelado somente este dia).", "success");
      setMostrarExcecaoModal(false);
      setAgendamentoSelecionado(null);
      refresh();
    } catch (e: any) {
      console.error(e);
      const raw = e?.response?.data?.erro ?? e?.response?.data?.message ?? e?.message;
      showAlert(typeof raw === "string" ? raw : JSON.stringify(raw), "error");
    } finally {
      setPostandoExcecao(false);
    }
  };

  /* =========================
     Transferência
  ========================= */
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
    setCopiarExcecoes(true);
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

      await axios.patch(`${API_URL}/${rota}`, body, { withCredentials: true });

      showAlert("Agendamento transferido com sucesso!", "success");
      setAgendamentoSelecionado(null);
      setAbrirModalTransferencia(false);
      refresh();
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

  /* =========================
     Jogadores
  ========================= */
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

  const alternarSelecionado = (u: UsuarioLista) => {
    setJogadoresSelecionadosIds((prev) =>
      prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
    );

    setJogadoresSelecionadosDetalhes((prev) => {
      const existe = prev.some((j) => j.id === u.id);
      if (existe) return prev.filter((j) => j.id !== u.id);
      return [...prev, u];
    });
  };

  const adicionarConvidado = () => {
    const nome = convidadoNome.trim();
    const tel = convidadoTelefone.trim();
    if (!nome) return;

    const combinado = tel ? `${nome} ${tel}`.trim() : nome;

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
      refresh();
    } catch (e) {
      console.error(e);
      showAlert("Erro ao adicionar jogadores.", "error");
    } finally {
      setAddingPlayers(false);
    }
  };

  /* =========================
     CELL (EXATAMENTE como era no QUADRO antigo)
  ========================= */
  const Cell = ({
    slot,
    hora,
    esporte,
    quadra,
  }: {
    slot: SlotInfo;
    hora: string;
    esporte: string;
    quadra: { quadraId: string; nome: string; numero: number };
  }) => {
    const isLivre = slot.disponivel && !slot.bloqueada;
    const isBloq = !!slot.bloqueada;
    const isPerm = slot.tipoReserva === "permanente";
    const isComum = slot.tipoReserva === "comum";

    const base =
      "min-h-7 xs:min-h-8 sm:min-h-9 md:min-h-10 text-[9px] xs:text-[10px] sm:text-[11px] md:text-xs " +
      "rounded-none border flex items-center justify-center text-center px-1 py-1 whitespace-normal break-words leading-tight";

    let cls = "bg-white text-gray-900 border-gray-300"; // livre
    if (isBloq) cls = "bg-red-600 text-white border-red-700";
    if (isPerm) cls = "bg-emerald-600 text-white border-emerald-700";
    if (isComum) cls = "bg-orange-600 text-white border-orange-700";

    const hourLabel = onlyHour(hora);
    const label = isBloq
      ? `Bloqueada - ${hourLabel}`
      : isLivre
        ? `Livre - ${hourLabel}`
        : `${firstName(slot.usuario?.nome)} - ${hourLabel}`;

    const isAgendado = !!(slot.agendamentoId && slot.tipoReserva);
    const clickable = !isBloq && (isAgendado || isLivre);

    const onClick = () => {
      if (!clickable) return;
      if (isLivre) {
        abrirConfirmAgendar(hora, esporte, quadra);
      } else {
        abrirDetalhes(
          slot.agendamentoId!,
          slot.tipoReserva as TipoReserva,
          hora,
          esporte,
          quadra.numero,
          quadra.nome
        );
      }
    };

    return (
      <button
        type="button"
        disabled={!clickable}
        onClick={onClick}
        title={slot.usuario?.nome || (isBloq ? "Bloqueada" : isLivre ? "Livre" : label)}
        className={`${base} ${cls} ${clickable ? "cursor-pointer hover:brightness-95" : "cursor-default"
          }`}
      >
        <span>{label}</span>
      </button>
    );
  };

  /* =========================
     Render
  ========================= */
  return (
    <div className="space-y-8">
      <SystemAlert
        open={!!alertConfig}
        message={alertConfig?.message ?? ""}
        variant={alertConfig?.variant ?? "info"}
        onClose={() => setAlertConfig(null)}
      />

      {/* Header / filtros (igual estilo Home) */}
      <div className="bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <h2 className="text-[24px] sm:text-[26px] font-semibold text-gray-700 -ml-4 sm:-ml-4">
          Todas as reservas do dia
        </h2>

        <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-end gap-3 sm:gap-4">
          {/* Campo Data */}
          <div ref={calendarioWrapperRef} className="relative w-full sm:w-[220px]">
            <button
              type="button"
              onClick={() => setDataPickerAberto((v) => !v)}
              className="flex items-center justify-between h-9 w-full rounded-md border border-gray-600 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
            >
              <div className="flex items-center">
                <Calendar className="w-4 h-4 text-gray-600 mr-2" />
                <span className="text-sm text-gray-800">{formatarDataBR(data)}</span>
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

                <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
                  {["D", "S", "T", "Q", "Q", "S", "S"].map((d) => (
                    <div key={d} className="text-center">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1 text-sm">
                  {(() => {
                    const first = new Date(mesExibido.getFullYear(), mesExibido.getMonth(), 1);
                    const startWeekday = first.getDay();
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
                            router.replace(`/adminMaster/todosHorarios?data=${iso}`, {
                              scroll: false,
                            });
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

          {/* Botões à direita */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`/adminMaster?data=${data || todayStrSP()}`)}
              className="inline-flex items-center justify-center h-9 px-6 rounded-md font-semibold bg-orange-600 hover:bg-orange-700 text-white text-sm cursor-pointer transition shadow-sm whitespace-nowrap"
            >
              Voltar
            </button>
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-600">
          <Spinner />
          <span>Carregando disponibilidade do dia…</span>
        </div>
      ) : erro ? (
        <div className="text-sm text-red-600">{erro}</div>
      ) : !esportes ? (
        <div className="text-sm text-gray-500">Nenhum dado disponível.</div>
      ) : (
        /* ✅ QUADRO EXATAMENTE como era antes */
        <div className="space-y-10">
          {Object.entries(esportes).map(([esporte, bloco]) => {
            const grupos =
              bloco?.grupos?.length ? bloco.grupos : bloco?.quadras?.length ? [bloco.quadras] : [];

            if (!grupos?.length) return null;

            return (
              <div key={esporte} className="space-y-10">
                {grupos.map((grupo, gi) => {
                  if (!grupo?.length) return null;

                  const minNum = Math.min(...grupo.map((q) => q.numero));
                  const maxNum = Math.max(...grupo.map((q) => q.numero));

                  return (
                    <section key={`${esporte}-${gi}`}>
                      <h2 className="text-center text-xl sm:text-2xl md:text-3xl font-extrabold text-gray-900 mb-3">
                        {esporte} – {minNum} - {maxNum}
                      </h2>

                      {/* Linha com os números das quadras (antigo) */}
                      <div className="grid grid-cols-6 gap-0">
                        {grupo.map((q) => (
                          <div
                            key={q.quadraId}
                            className="min-h-7 xs:min-h-8 sm:min-h-9 md:min-h-10 rounded-none border border-gray-300 bg-gray-100 text-gray-700 text-[9px] xs:text-[10px] sm:text-[11px] md:text-xs flex items-center justify-center font-semibold"
                            title={q.nome}
                          >
                            {q.numero}
                          </div>
                        ))}
                        {Array.from({ length: Math.max(0, 6 - grupo.length) }).map((_, i) => (
                          <div key={`void-${i}`} className="border border-transparent" />
                        ))}
                      </div>

                      {/* Grade: horas x quadras (antigo) */}
                      <div className="space-y-0">
                        {horas.map((hora) => (
                          <div key={hora} className="grid grid-cols-6 gap-0">
                            {grupo.map((q) => {
                              const slot = q.slots?.[hora] || { disponivel: true };
                              return (
                                <Cell
                                  key={`${q.quadraId}-${hora}`}
                                  slot={slot}
                                  hora={hora}
                                  esporte={esporte}
                                  quadra={{ quadraId: q.quadraId, nome: q.nome, numero: q.numero }}
                                />
                              );
                            })}
                            {Array.from({ length: Math.max(0, 6 - grupo.length) }).map((_, i) => (
                              <div key={`pad-${i}`} className="border border-transparent" />
                            ))}
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            );
          })}
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

      {/* MODAL: Confirmar agendamento rápido (slot livre) */}
      {confirmAgendar && agendarCtx && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-[70]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setConfirmAgendar(false);
              setAgendarCtx(null);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 sm:p-12 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setConfirmAgendar(false);
                setAgendarCtx(null);
              }}
              className="absolute right-5 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            <h3 className="text-base sm:text-lg font-semibold text-left mb-4 text-orange-700">
              Confirmar Agendamento
            </h3>

            <p className="text-sm text-gray-800 mb-7 text-center leading-relaxed">
              Deseja realizar uma reserva de{" "}
              <span className="font-semibold">{agendarCtx.esporte}</span> na{" "}
              <span className="font-semibold">
                quadra {String(agendarCtx.quadraNumero).padStart(2, "0")} -{" "}
                {agendarCtx.quadraNome}
              </span>
              , no dia <span className="font-semibold">{toDdMm(data)}</span> às{" "}
              <span className="font-semibold">{agendarCtx.hora}</span>?
            </p>

            <div className="mt-2 flex flex-col sm:flex-row gap-3 sm:gap-8 justify-center">
              <button
                onClick={() => {
                  setConfirmAgendar(false);
                  setAgendarCtx(null);
                }}
                className="w-full sm:min-w-[160px] px-5 py-2.5 rounded-md border border-[#C73737] bg-[#FFE9E9] text-[#B12A2A] font-semibold hover:bg-[#FFDADA] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Voltar
              </button>

              <button
                onClick={confirmarAgendamentoRapido}
                className="w-full sm:min-w-[160px] px-5 py-2.5 rounded-md border border-[#E97A1F] bg-[#FFF3E0] text-[#D86715] font-semibold hover:bg-[#FFE6C2] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Reservar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES (mesmo estilo Home) */}
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
            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="absolute right-5 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            <div className="px-8 pt-14 pb-3">
              <p className="text-sm font-semibold text-orange-700 text-left">
                Informações de reserva
              </p>

              <p className="mt-4 text-xs text-gray-500 text-center">
                Quadra:{" "}
                <span className="font-semibold text-gray-900">
                  {(() => {
                    const numero =
                      agendamentoSelecionado.quadraNumero ?? "";
                    const nome = agendamentoSelecionado.quadraNome ?? "";
                    const numeroFmt =
                      numero !== "" ? String(numero).padStart(2, "0") : "";
                    if (!numeroFmt && !nome) return "-";
                    return `${numeroFmt}${nome ? ` - ${nome}` : ""}`;
                  })()}
                </span>
              </p>
            </div>

            <div className="px-8 py-6 space-y-6 overflow-y-auto">
              {/* Atleta */}
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

              {/* Infos */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-y-2 sm:gap-y-3 gap-x-8 text-xs text-gray-600">
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

                <div className="flex items-center gap-2">
                  <Image
                    src="/iconescards/horario.png"
                    alt="Horário"
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5"
                  />
                  <span>
                    Horário:{" "}
                    <span className="font-semibold text-gray-800">
                      {agendamentoSelecionado.horario}
                    </span>
                  </span>
                </div>

                {agendamentoSelecionado.esporte ? (
                  <div className="flex items-center gap-2">
                    <Image
                      src="/iconescards/bolaesporte.png"
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
                ) : (
                  <div className="hidden sm:block" />
                )}

                <div className="flex items-center gap-2">
                  <Image
                    src={
                      agendamentoSelecionado.tipoReserva === "permanente"
                        ? "/iconescards/icone_permanente_name.png"
                        : "/iconescards/avulsacinza.png"
                    }
                    alt="Tipo"
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5"
                  />
                  <span className="font-semibold text-gray-800">
                    {agendamentoSelecionado.tipoReserva === "permanente"
                      ? "Permanente"
                      : "Avulsa"}
                  </span>
                </div>
              </div>

              {/* Jogadores */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-orange-700">
                  Jogadores:
                </p>

                <div className="flex flex-wrap gap-3">
                  {agendamentoSelecionado.jogadores.length > 0 ? (
                    agendamentoSelecionado.jogadores.map((jog, idx) => {
                      const cel = (jog as any)?.celular as
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

                          {cel && (
                            <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-600">
                              <Image
                                src="/iconescards/icone_phone.png"
                                alt="Telefone"
                                width={12}
                                height={12}
                                className="w-3 h-3"
                              />
                              <span className="truncate">{cel}</span>
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

              {/* Botão adicionar jogadores (só avulsa) */}
              {agendamentoSelecionado.tipoReserva === "comum" && (
                <div className="pt-2 flex justify-center">
                  <button
                    onClick={abrirModalAdicionarJogadores}
                    className="
                      inline-flex items-center justify-center
                      gap-1 rounded-md
                      border border-orange-500
                      bg-orange-50
                      text-orange-700 text-xs
                      px-3 py-1 cursor-pointer
                      hover:bg-orange-100 transition
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

              <div className="border-t border-gray-200 mt-4 pt-1" />

              <div className="flex flex-col sm:flex-row sm:justify-center gap-3 sm:gap-6">
                <button
                  onClick={abrirFluxoCancelamento}
                  className="
                    w-full sm:w-[200px]
                    inline-flex items-center justify-center
                    rounded-md border border-red-500
                    bg-red-50 text-red-600
                    px-6 py-2.5 text-sm font-semibold
                    cursor-pointer hover:bg-red-100
                    transition-colors
                  "
                >
                  Cancelar reserva
                </button>

                <button
                  onClick={abrirModalTransferir}
                  disabled={loadingTransferencia}
                  className="
                    w-full sm:w-[200px]
                    inline-flex items-center justify-center
                    rounded-md border border-gray-500
                    bg-gray-50 text-gray-700
                    px-6 py-2.5 text-sm font-semibold
                    cursor-pointer hover:bg-gray-100
                    disabled:opacity-60 transition-colors
                  "
                >
                  {loadingTransferencia ? "Transferindo..." : "Transferir"}
                </button>
              </div>
            </div>

            {/* CONFIRMAR CANCELAMENTO AVULSO */}
            {confirmarCancelamento && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-3xl z-50">
                <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 px-8 py-10">
                  <button
                    onClick={() => setConfirmarCancelamento(false)}
                    className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
                    aria-label="Fechar"
                  >
                    ×
                  </button>

                  <h3 className="text-lg font-semibold text-orange-700 text-left">
                    Cancelar Agendamento Avulso
                  </h3>

                  <p className="mt-4 text-sm text-gray-800 text-center leading-relaxed">
                    Você tem certeza que deseja cancelar esta reserva no dia{" "}
                    <span className="font-semibold">
                      {formatarDataBR(agendamentoSelecionado.dia)}
                    </span>{" "}
                    às{" "}
                    <span className="font-semibold">
                      {agendamentoSelecionado.horario}
                    </span>
                    ?
                  </p>

                  <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-8">
                    <button
                      onClick={() => setConfirmarCancelamento(false)}
                      disabled={loadingCancelamento}
                      className="w-full sm:min-w-[150px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                        bg-[#FFF3E0] text-[#D86715] text-sm font-semibold
                        hover:bg-[#FFE6C2] disabled:opacity-60
                        transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={cancelarAgendamento}
                      disabled={loadingCancelamento}
                      className="w-full sm:min-w-[150px] px-5 py-2.5 rounded-md border border-[#C73737]
                        bg-[#FFE9E9] text-[#B12A2A] text-sm font-semibold
                        hover:bg-[#FFDADA] disabled:opacity-60
                        transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      {loadingCancelamento ? "Cancelando..." : "Confirmar"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CANCELAR PERMANENTE (opções) */}
            {mostrarOpcoesCancelamento && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-3xl z-50">
                <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 px-8 py-10">
                  <button
                    onClick={() => setMostrarOpcoesCancelamento(false)}
                    className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
                    aria-label="Fechar"
                  >
                    ×
                  </button>

                  <h3 className="text-lg font-semibold text-orange-700 text-left">
                    Cancelar Agendamento Permanente
                  </h3>

                  <p className="mt-4 text-sm text-gray-800 text-center leading-relaxed">
                    Você deseja cancelar apenas{" "}
                    <span className="font-semibold">um dia</span> (exceção) deste
                    permanente?
                  </p>

                  <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-8">
                    <button
                      onClick={() => setMostrarOpcoesCancelamento(false)}
                      className="w-full sm:min-w-[150px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                        bg-[#FFF3E0] text-[#D86715] text-sm font-semibold
                        hover:bg-[#FFE6C2] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Voltar
                    </button>

                    <button
                      onClick={abrirExcecao}
                      className="w-full sm:min-w-[150px] px-5 py-2.5 rounded-md border border-[#C73737]
                        bg-[#FFE9E9] text-[#B12A2A] text-sm font-semibold
                        hover:bg-[#FFDADA] transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ESCOLHA DO DIA (EXCEÇÃO) */}
            {mostrarExcecaoModal && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-3xl z-50">
                <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 px-8 py-10">
                  <button
                    onClick={() => setMostrarExcecaoModal(false)}
                    className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
                    aria-label="Fechar"
                  >
                    ×
                  </button>

                  <h3 className="text-lg font-semibold text-orange-700 text-left">
                    Escolha o dia do cancelamento
                  </h3>

                  <p className="mt-4 text-sm text-gray-800 text-center leading-relaxed">
                    Você pode cancelar até 6 semanas à frente. <br />
                    Escolha o dia:
                  </p>

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

                  <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-8">
                    <button
                      type="button"
                      onClick={() => setMostrarExcecaoModal(false)}
                      disabled={postandoExcecao}
                      className="w-full sm:min-w-[150px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                        bg-[#FFF3E0] text-[#D86715] text-sm font-semibold
                        hover:bg-[#FFE6C2] disabled:opacity-60
                        transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={confirmarExcecao}
                      disabled={!dataExcecaoSelecionada || postandoExcecao}
                      className="w-full sm:min-w-[150px] px-5 py-2.5 rounded-md border border-[#C73737]
                        bg-[#FFE9E9] text-[#B12A2A] text-sm font-semibold
                        hover:bg-[#FFDADA] disabled:opacity-60
                        transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
                    >
                      {postandoExcecao ? "Cancelando..." : "Confirmar"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE TRANSFERÊNCIA (estilo Home) */}
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
            <button
              onClick={() =>
                !loadingTransferencia && setAbrirModalTransferencia(false)
              }
              className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            <h3 className="text-xl sm:text-2xl font-semibold text-orange-700 mb-6">
              Transferir agendamento
            </h3>

            <div className="bg-[#F6F6F6] border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-6">
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

              {agendamentoSelecionado?.tipoReserva === "permanente" && (
                <button
                  type="button"
                  onClick={() => setCopiarExcecoes((v) => !v)}
                  className="inline-flex items-center gap-2 text-[12px] text-gray-700"
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

            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-[120px]">
              <button
                onClick={() =>
                  !loadingTransferencia && setAbrirModalTransferencia(false)
                }
                disabled={loadingTransferencia}
                className="w-full sm:min-w-[160px] px-5 py-2.5 rounded-md border border-[#C73737]
                  bg-[#FFE9E9] text-[#B12A2A] font-semibold
                  hover:bg-[#FFDADA] disabled:opacity-60
                  transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Voltar
              </button>
              <button
                onClick={confirmarTransferencia}
                disabled={!usuarioSelecionado || loadingTransferencia}
                className="w-full sm:min-w-[190px] px-5 py-2.5 rounded-md border border-[#E97A1F]
                  bg-[#FFF3E0] text-[#D86715] font-semibold
                  hover:bg-[#FFE6C2] disabled:opacity-60
                  transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                {loadingTransferencia
                  ? "Transferindo..."
                  : "Confirmar alteração"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ➕ ADICIONAR JOGADORES (estilo Home) */}
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
            <button
              onClick={() => !addingPlayers && setAbrirModalJogadores(false)}
              className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            <h3 className="text-lg sm:text-xl font-semibold text-orange-700 mb-6">
              Inserir Jogadores
            </h3>

            <div className="bg-[#F6F6F6] border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-6">
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

                {(carregandoJogadores || buscaJogador.trim().length >= 2) && (
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
                        const ativo = jogadoresSelecionadosIds.includes(u.id);

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
                                  <span className="truncate">{u.celular}</span>
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
                      onChange={(e) => setConvidadoTelefone(e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={adicionarConvidado}
                    disabled={!convidadoNome.trim()}
                    className="h-10 px-4 rounded-md border border-[#E97A1F] bg-[#FFF3E0]
                      text-[#D86715] text-sm font-semibold
                      disabled:opacity-60 hover:bg-[#FFE6C2] transition-colors"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Jogadores adicionados:
                </p>

                {jogadoresSelecionadosDetalhes.length > 0 ||
                  convidadosPendentes.length > 0 ? (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 justify-items-stretch">
                    {jogadoresSelecionadosDetalhes.map((u) => (
                      <div key={u.id} className="flex items-center gap-3">
                        <div
                          className="flex-1 flex flex-col gap-0.5 px-4 py-3 rounded-md
                          bg-[#F4F4F4] border border-[#D3D3D3] shadow-sm
                          w-full sm:min-w-[220px] sm:max-w-[240px]"
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
                              <span className="truncate">{u.celular}</span>
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
                          w-full sm:min-w-[220px] sm:max-w-[240px]"
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

            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-[120px]">
              <button
                onClick={() => !addingPlayers && setAbrirModalJogadores(false)}
                disabled={addingPlayers}
                className="min-w-[160px] px-5 py-2.5 rounded-md border border-[#C73737]
                  bg-[#FFE9E9] text-[#B12A2A] font-semibold
                  hover:bg-[#FFDADA] disabled:opacity-60
                  transition-colors shadow-[0_2px_0_rgba(0,0,0,0.05)]"
              >
                Voltar
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
    </div>
  );
}
