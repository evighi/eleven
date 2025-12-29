"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import { useAuthStore } from "@/context/AuthStore";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";

/* =========================
   Tipos (Churrasqueiras - Dia)
========================= */
type Usuario = { nome: string; email?: string; celular?: string | null };

type TipoReserva = "comum" | "permanente";
type Turno = "DIA" | "NOITE";

type SlotInfoChurrasqueira = {
  disponivel: boolean;
  bloqueada?: boolean;
  tipoReserva?: TipoReserva | null;
  usuario?: Usuario | null;
  agendamentoId?: string | null;

  // opcional: caso teu backend mande metadados em permanentes
  permanenteMeta?: {
    proximaData: string | null;
    dataInicio: string | null;
    excecoes?: { id: string; data: string; motivo: string | null }[];
  };
};

type ChurrasqueiraLinhaDia = {
  churrasqueiraId: string;
  nome: string;
  numero: number;
  turnos: Record<Turno, SlotInfoChurrasqueira>;
};

/** ===== Tipos RAW (como sua rota realmente retorna) ===== */
type ApiSlotChurrasRaw = {
  turno: Turno;
  disponivel: boolean;
  tipoReserva: TipoReserva | null;
  usuario: Usuario | null;
  agendamentoId: string | null;
  bloqueada?: boolean;
  permanenteMeta?: SlotInfoChurrasqueira["permanenteMeta"];
};

type ApiChurrasqueiraRaw = {
  churrasqueiraId: string;
  nome: string;
  numero: number;
  disponibilidade: ApiSlotChurrasRaw[];
};

type ApiRespChurrasDiaRaw = {
  churrasqueiras: ApiChurrasqueiraRaw[];
  data?: string; // se um dia vier
};

/* =========================
   Tipos para modais
========================= */
type AgendamentoSelecionado = {
  dia: string; // YYYY-MM-DD
  turno: Turno;
  usuario: string | Usuario | "—";
  tipoReserva: TipoReserva;
  agendamentoId: string;
  tipoLocal: "churrasqueira";

  churrasqueiraNumero?: number | null;
  churrasqueiraNome?: string | null;

  // se teu backend retornar algo extra:
  diaSemana?: string | null;
  dataInicio?: string | null;
  proximaData?: string | null;
};

type UsuarioLista = {
  id: string;
  nome: string;
  email?: string;
  celular?: string | null;
};

type AlertVariant = "success" | "error" | "info";

/* =========================
   SystemAlert (igual Home)
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

function toDdMm(isoYmd: string) {
  const [y, m, d] = isoYmd.split("-");
  return `${d}/${m}/${y}`;
}

function firstName(u?: Usuario | null) {
  const full = u?.nome;
  if (!full) return "";
  const [a] = full.trim().split(/\s+/);
  return a || "";
}

/** Normaliza a resposta da API (disponibilidade[]) para turnos{DIA,NOITE} */
function buildTurnos(
  disponibilidade: ApiSlotChurrasRaw[] | undefined | null
): Record<Turno, SlotInfoChurrasqueira> {
  const base: Record<Turno, SlotInfoChurrasqueira> = {
    DIA: { disponivel: true, tipoReserva: null, usuario: null, agendamentoId: null },
    NOITE: { disponivel: true, tipoReserva: null, usuario: null, agendamentoId: null },
  };

  for (const item of disponibilidade || []) {
    const turno = item.turno as Turno;
    if (turno !== "DIA" && turno !== "NOITE") continue;

    base[turno] = {
      disponivel: !!item.disponivel,
      bloqueada: !!item.bloqueada,
      tipoReserva: item.tipoReserva ?? null,
      usuario: item.usuario ?? null,
      agendamentoId: item.agendamentoId ?? null,
      permanenteMeta: item.permanenteMeta ?? undefined,
    };
  }

  return base;
}

/* =========================
   Página
========================= */
export default function TodosHorariosChurrasqueirasPage() {
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
  const [churrasqueiras, setChurrasqueiras] = useState<ChurrasqueiraLinhaDia[] | null>(
    null
  );
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

  // Cancelar (avulso ou permanente)
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [loadingCancelamento, setLoadingCancelamento] = useState(false);

  // Transferência
  const [abrirModalTransferencia, setAbrirModalTransferencia] = useState(false);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [usuariosFiltrados, setUsuariosFiltrados] = useState<UsuarioLista[]>([]);
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<UsuarioLista | null>(
    null
  );
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);
  const [loadingTransferencia, setLoadingTransferencia] = useState(false);

  // Reserva rápida (slot livre)
  const [confirmAgendar, setConfirmAgendar] = useState(false);
  const [agendarCtx, setAgendarCtx] = useState<{
    turno: Turno;
    churrasqueiraId: string;
    churrasqueiraNome: string;
    churrasqueiraNumero: number;
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

  // ESC fecha tudo
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

      if (agendamentoSelecionado) {
        setAgendamentoSelecionado(null);
        setConfirmarCancelamento(false);
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
    abrirModalTransferencia,
    loadingTransferencia,
    agendamentoSelecionado,
    confirmAgendar,
  ]);

  /* =========================
     Carregar dia (Churrasqueiras)
  ========================= */
  const carregar = useCallback(
    async (d: string) => {
      const seq = ++carregarSeqRef.current;

      setErro("");
      setLoading(true);

      try {
        const url = `${API_URL}/disponibilidadeGeral/geral-admin-churrasqueiras`;

        const { data: resp } = await axios.get<ApiRespChurrasDiaRaw>(url, {
          params: { data: d },
          withCredentials: true,
        });

        if (seq !== carregarSeqRef.current) return;
        if (dataAtualRef.current && dataAtualRef.current !== d) return;

        const normalizadas: ChurrasqueiraLinhaDia[] = (resp.churrasqueiras || []).map(
          (ch) => ({
            churrasqueiraId: ch.churrasqueiraId,
            nome: ch.nome,
            numero: ch.numero,
            turnos: buildTurnos(ch.disponibilidade),
          })
        );

        setChurrasqueiras(normalizadas);
      } catch (e) {
        if (seq !== carregarSeqRef.current) return;

        console.error(e);
        setChurrasqueiras(null);
        setErro("Erro ao carregar a disponibilidade das churrasqueiras no dia.");
      } finally {
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
     Detalhes (avulso/permanente)
  ========================= */
  const abrirDetalhes = useCallback(
    async (slot: SlotInfoChurrasqueira, turno: Turno, ch: ChurrasqueiraLinhaDia) => {
      // para detalhes precisamos do id; tipoReserva pode vir null em edge-cases,
      // mas na tua API está vindo — ainda assim, protegemos:
      if (!slot?.agendamentoId) return;

      const tipo = slot.tipoReserva ?? "comum";

      try {
        setLoadingDetalhes(true);

        const rota =
          tipo === "permanente"
            ? `agendamentosPermanentesChurrasqueiras/${slot.agendamentoId}`
            : `agendamentosChurrasqueiras/${slot.agendamentoId}`;

        const { data: det } = await axios.get(`${API_URL}/${rota}`, {
          withCredentials: true,
        });

        const usuarioValor: string | Usuario =
          typeof det?.usuario === "object" || typeof det?.usuario === "string"
            ? det.usuario
            : "—";

        setAgendamentoSelecionado({
          dia: data,
          turno,
          usuario: usuarioValor,
          tipoReserva: tipo,
          agendamentoId: String(slot.agendamentoId),
          tipoLocal: "churrasqueira",
          churrasqueiraNumero: ch.numero ?? null,
          churrasqueiraNome: ch.nome ?? null,
          diaSemana: det?.diaSemana ?? null,
          dataInicio: det?.dataInicio ? String(det.dataInicio).slice(0, 10) : null,
          proximaData: det?.proximaData ? String(det.proximaData).slice(0, 10) : null,
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
     Slot livre -> confirmar reserva rápida
  ========================= */
  const abrirConfirmAgendar = useCallback((turno: Turno, ch: ChurrasqueiraLinhaDia) => {
    if (!data) return;
    setAgendarCtx({
      turno,
      churrasqueiraId: ch.churrasqueiraId,
      churrasqueiraNome: ch.nome,
      churrasqueiraNumero: ch.numero,
    });
    setConfirmAgendar(true);
  }, [data]);

  const confirmarAgendamentoRapido = () => {
    if (!agendarCtx || !data) return;

    const params = new URLSearchParams({
      data,
      turno: agendarCtx.turno,
      churrasqueiraId: agendarCtx.churrasqueiraId,
    });

    setConfirmAgendar(false);
    setAgendarCtx(null);

    router.push(`/adminMaster/churrasqueiras/agendarComum?${params.toString()}`);
  };

  /* =========================
     Cancelar
  ========================= */
  const abrirFluxoCancelamento = () => {
    if (!agendamentoSelecionado) return;
    setConfirmarCancelamento(true);
  };

  const cancelarAgendamento = async () => {
    if (!agendamentoSelecionado) {
      showAlert("Nenhuma reserva selecionada.", "error");
      return;
    }

    setLoadingCancelamento(true);

    const rota =
      agendamentoSelecionado.tipoReserva === "permanente"
        ? `agendamentosPermanentesChurrasqueiras/cancelar/${agendamentoSelecionado.agendamentoId}`
        : `agendamentosChurrasqueiras/cancelar/${agendamentoSelecionado.agendamentoId}`;

    try {
      await axios.post(`${API_URL}/${rota}`, {}, { withCredentials: true });
      showAlert("Reserva cancelada com sucesso!", "success");
      setAgendamentoSelecionado(null);
      setConfirmarCancelamento(false);
      refresh();
    } catch (error: any) {
      console.error("Erro ao cancelar:", error);
      const msg =
        error?.response?.data?.erro ||
        error?.response?.data?.message ||
        "Erro ao cancelar reserva.";
      showAlert(msg, "error");
    } finally {
      setLoadingCancelamento(false);
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
    setAbrirModalTransferencia(true);
  };

  const confirmarTransferencia = async () => {
    if (!agendamentoSelecionado) {
      showAlert("Nenhuma reserva selecionada.", "error");
      return;
    }
    if (!usuarioSelecionado) {
      showAlert("Selecione um usuário para transferir.", "info");
      return;
    }

    setLoadingTransferencia(true);
    try {
      const rota =
        agendamentoSelecionado.tipoReserva === "permanente"
          ? `agendamentosPermanentesChurrasqueiras/${agendamentoSelecionado.agendamentoId}/transferir`
          : `agendamentosChurrasqueiras/${agendamentoSelecionado.agendamentoId}/transferir`;

      await axios.patch(
        `${API_URL}/${rota}`,
        {
          novoUsuarioId: usuarioSelecionado.id,
          transferidoPorId: (usuario as any)?.id,
        },
        { withCredentials: true }
      );

      showAlert("Reserva transferida com sucesso!", "success");
      setAgendamentoSelecionado(null);
      setAbrirModalTransferencia(false);
      refresh();
    } catch (error: any) {
      console.error("Erro ao transferir:", error);
      const msg =
        error?.response?.data?.erro ||
        error?.response?.data?.message ||
        "Erro ao transferir reserva.";
      showAlert(msg, "error");
    } finally {
      setLoadingTransferencia(false);
    }
  };

  /* =========================
     CELL (mesmo padrão visual do quadro das quadras)
  ========================= */
  const Cell = ({
    slot,
    turno,
    ch,
  }: {
    slot: SlotInfoChurrasqueira;
    turno: Turno;
    ch: ChurrasqueiraLinhaDia;
  }) => {
    const isBloq = !!slot.bloqueada;
    const isAgendado = !!slot.agendamentoId; // basta ter id
    const tipo = slot.tipoReserva ?? null;

    const isPerm = tipo === "permanente";
    const isComum = tipo === "comum" || (isAgendado && !tipo); // fallback
    const isLivre = !isBloq && !isAgendado && !!slot.disponivel;

    const base =
      "min-h-9 xs:min-h-10 sm:min-h-11 md:min-h-12 text-[9px] xs:text-[10px] sm:text-[11px] md:text-xs " +
      "rounded-none border flex items-center justify-center text-center px-1 py-1 whitespace-normal break-words leading-tight";

    let cls = "bg-white text-gray-900 border-gray-300"; // livre
    if (isBloq) cls = "bg-red-600 text-white border-red-700";
    else if (isPerm) cls = "bg-emerald-600 text-white border-emerald-700";
    else if (isComum) cls = "bg-orange-600 text-white border-orange-700";

    const label = isBloq
      ? `Bloqueada — ${turno}`
      : isLivre
      ? `Livre — ${turno}`
      : `${firstName(slot.usuario)} — ${turno}`;

    const clickable = !isBloq && (isAgendado || isLivre);

    const onClick = () => {
      if (!clickable) return;
      if (isLivre) {
        abrirConfirmAgendar(turno, ch);
      } else {
        abrirDetalhes(slot, turno, ch);
      }
    };

    return (
      <button
        type="button"
        disabled={!clickable}
        onClick={onClick}
        title={
          slot.usuario?.nome ||
          (isBloq ? "Bloqueada" : isLivre ? "Livre" : label)
        }
        className={`${base} ${cls} ${
          clickable ? "cursor-pointer hover:brightness-95" : "cursor-default"
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
          Reservas das Churrasqueiras
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
                className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${
                  dataPickerAberto ? "rotate-180" : ""
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
                            router.replace(`/adminMaster/todosHorariosChurrasqueiras?data=${iso}`, {
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
          <span>Carregando reservas do dia…</span>
        </div>
      ) : erro ? (
        <div className="text-sm text-red-600">{erro}</div>
      ) : !churrasqueiras ? (
        <div className="text-sm text-gray-500">Nenhum dado disponível.</div>
      ) : churrasqueiras.length === 0 ? (
        <div className="text-sm text-gray-500">Nenhuma churrasqueira cadastrada.</div>
      ) : (
        <section className="space-y-3">
          <h2 className="text-center text-xl sm:text-2xl md:text-3xl font-extrabold text-gray-900 mb-2">
            Churrasqueiras — {toDdMm(data)}
          </h2>

          {/* Cabeçalho (mesma pegada do quadro antigo) */}
          <div className="grid grid-cols-3 gap-0">
            <div className="min-h-9 xs:min-h-10 sm:min-h-11 md:min-h-12 rounded-none border border-gray-300 bg-gray-100 text-gray-700 text-[10px] xs:text-[11px] sm:text-sm flex items-center justify-center font-semibold">
              Churrasqueira
            </div>
            <div className="min-h-9 xs:min-h-10 sm:min-h-11 md:min-h-12 rounded-none border border-gray-300 bg-gray-100 text-gray-700 text-[10px] xs:text-[11px] sm:text-sm flex items-center justify-center font-semibold">
              Dia
            </div>
            <div className="min-h-9 xs:min-h-10 sm:min-h-11 md:min-h-12 rounded-none border border-gray-300 bg-gray-100 text-gray-700 text-[10px] xs:text-[11px] sm:text-sm flex items-center justify-center font-semibold">
              Noite
            </div>
          </div>

          {/* Linhas */}
          {churrasqueiras
            .slice()
            .sort((a, b) => a.numero - b.numero)
            .map((ch) => {
              const dia = ch.turnos?.DIA ?? {
                disponivel: true,
                tipoReserva: null,
                usuario: null,
                agendamentoId: null,
              };
              const noite = ch.turnos?.NOITE ?? {
                disponivel: true,
                tipoReserva: null,
                usuario: null,
                agendamentoId: null,
              };

              return (
                <div key={ch.churrasqueiraId} className="grid grid-cols-3 gap-0">
                  <div
                    className="min-h-9 xs:min-h-10 sm:min-h-11 md:min-h-12 rounded-none border border-gray-300 bg-white text-gray-900 text-[10px] xs:text-[11px] sm:text-sm flex items-center justify-center font-semibold px-2 text-center"
                    title={ch.nome}
                  >
                    {String(ch.numero).padStart(2, "0")} — {ch.nome}
                  </div>

                  <Cell slot={dia} turno="DIA" ch={ch} />
                  <Cell slot={noite} turno="NOITE" ch={ch} />
                </div>
              );
            })}
        </section>
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

      {/* MODAL: Confirmar reserva rápida (slot livre) */}
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
              Confirmar Reserva
            </h3>

            <p className="text-sm text-gray-800 mb-7 text-center leading-relaxed">
              Deseja reservar a{" "}
              <span className="font-semibold">
                churrasqueira {String(agendarCtx.churrasqueiraNumero).padStart(2, "0")} —{" "}
                {agendarCtx.churrasqueiraNome}
              </span>{" "}
              no dia <span className="font-semibold">{toDdMm(data)}</span> no turno{" "}
              <span className="font-semibold">{agendarCtx.turno}</span>?
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

      {/* MODAL DE DETALHES (estilo Home) */}
      {agendamentoSelecionado && (
        <div
          className={`fixed inset-0 flex items-center justify-center z-50 ${
            abrirModalTransferencia ? "bg-transparent" : "bg-black/40"
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setAgendamentoSelecionado(null);
              setConfirmarCancelamento(false);
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
                Churrasqueira:{" "}
                <span className="font-semibold text-gray-900">
                  {(() => {
                    const n = agendamentoSelecionado.churrasqueiraNumero ?? "";
                    const nome = agendamentoSelecionado.churrasqueiraNome ?? "";
                    const nFmt = n !== "" ? String(n).padStart(2, "0") : "";
                    if (!nFmt && !nome) return "-";
                    return `${nFmt}${nome ? ` — ${nome}` : ""}`;
                  })()}
                </span>
              </p>
            </div>

            <div className="px-8 py-6 space-y-6 overflow-y-auto">
              {/* Usuário */}
              <div className="flex flex-col items-center text-center gap-2">
                <div className="mb-1">
                  <Image
                    src="/iconescards/icone-permanente.png"
                    alt="Usuário"
                    width={40}
                    height={40}
                    className="w-10 h-10"
                  />
                </div>

                <p className="text-sm text-gray-600">
                  Cliente:{" "}
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
                    alt="Turno"
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5"
                  />
                  <span>
                    Turno:{" "}
                    <span className="font-semibold text-gray-800">
                      {agendamentoSelecionado.turno}
                    </span>
                  </span>
                </div>

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

                {/* espaço para alinhar grid */}
                <div className="hidden sm:block" />
              </div>

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

            {/* CONFIRMAR CANCELAMENTO */}
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
                    Cancelar Reserva
                  </h3>

                  <p className="mt-4 text-sm text-gray-800 text-center leading-relaxed">
                    Você tem certeza que deseja cancelar esta reserva no dia{" "}
                    <span className="font-semibold">
                      {formatarDataBR(agendamentoSelecionado.dia)}
                    </span>{" "}
                    no turno{" "}
                    <span className="font-semibold">{agendamentoSelecionado.turno}</span>?
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
              onClick={() => !loadingTransferencia && setAbrirModalTransferencia(false)}
              className="absolute right-6 top-4 text-gray-400 hover:text-gray-600 text-3xl leading-none"
              aria-label="Fechar"
            >
              ×
            </button>

            <h3 className="text-xl sm:text-2xl font-semibold text-orange-700 mb-6">
              Transferir reserva
            </h3>

            <div className="bg-[#F6F6F6] border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-6">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Escolha o cliente para transferir a reserva
                </p>

                <div className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1 flex items-center gap-3">
                    <Image
                      src="/iconescards/icone-permanente.png"
                      alt="Cliente"
                      width={20}
                      height={20}
                      className="w-5 h-5"
                    />
                    <input
                      type="text"
                      className="flex-1 h-10 rounded border border-gray-300 px-3 text-sm bg-white
                        focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400
                        placeholder:text-gray-400"
                      placeholder="Insira o nome do cliente cadastrado"
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
                          <span className="font-semibold">"{buscaUsuario.trim()}"</span>.
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
                              ${
                                ativo
                                  ? "bg-orange-50 border-l-4 border-orange-500 font-medium"
                                  : "hover:bg-orange-50"
                              }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-gray-800">{user.nome}</p>
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

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Cliente selecionado:
                </p>

                {usuarioSelecionado ? (
                  <div className="inline-flex items-center gap-3 px-4 py-3 rounded-lg bg-white border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 text-xs text-gray-700">
                      <Image
                        src="/iconescards/icone-permanente.png"
                        alt="Selecionado"
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
                  <p className="text-xs text-gray-500">Nenhum cliente selecionado ainda.</p>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3 sm:gap-[120px]">
              <button
                onClick={() => !loadingTransferencia && setAbrirModalTransferencia(false)}
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
                {loadingTransferencia ? "Transferindo..." : "Confirmar alteração"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
