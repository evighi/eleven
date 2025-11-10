"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import { useAuthStore } from "@/context/AuthStore";
import { useRouter, useSearchParams } from "next/navigation";

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
   Tipos para modal de detalhes (agora com as mesmas ações da Home)
========================= */
type JogadorRef = { nome: string };
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

/* ===== Helpers comuns (iguais à Home) ===== */
const SP_TZ = "America/Sao_Paulo";
const todayStrSP = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // ex: 2025-03-07

const DIA_IDX: Record<string, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
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
  let delta = (target - startDow + 7) % 7; // 0 = mesmo dia
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

/** Helper para busca "sem acento" */
const normalizeText = (s?: string | null) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/* helpers visuais já existentes */
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

/* =========================
   Página
========================= */
export default function TodosHorariosPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const { usuario } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<string>(""); // será inicializada pelo query param
  const [horas, setHoras] = useState<string[]>([]);
  const [esportes, setEsportes] = useState<Record<string, EsporteBlock> | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal de detalhes
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [agendamentoSelecionado, setAgendamentoSelecionado] =
    useState<AgendamentoSelecionado | null>(null);

  // === AÇÕES (iguais à Home) ===
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [mostrarOpcoesCancelamento, setMostrarOpcoesCancelamento] = useState(false);
  const [loadingCancelamento, setLoadingCancelamento] = useState(false);

  // Exceção (permanente: cancelar 1 dia)
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
  const [loadingTransferencia, setLoadingTransferencia] = useState(false);
  const [copiarExcecoes, setCopiarExcecoes] = useState(true); // só usado para permanentes

  // Adicionar jogadores
  const [abrirModalJogadores, setAbrirModalJogadores] = useState(false);
  const [buscaJogador, setBuscaJogador] = useState("");
  const [usuariosParaJogadores, setUsuariosParaJogadores] = useState<UsuarioLista[]>([]);
  const [jogadoresSelecionadosIds, setJogadoresSelecionadosIds] = useState<string[]>([]);
  const [convidadoNome, setConvidadoNome] = useState("");
  const [convidadosPendentes, setConvidadosPendentes] = useState<string[]>([]);
  const [carregandoJogadores, setCarregandoJogadores] = useState(false);
  const [addingPlayers, setAddingPlayers] = useState(false);

  // NOVO: confirmação de agendamento rápido (slot livre)
  const [confirmAgendar, setConfirmAgendar] = useState(false);
  const [agendarCtx, setAgendarCtx] = useState<{
    hora: string;
    esporte: string;
    quadraId: string;
    quadraNome: string;
    quadraNumero: number;
  } | null>(null);

  // 🔹 Inicializa a data a partir do query param (?data=YYYY-MM-DD) ou usa hoje
  useEffect(() => {
    const q = searchParams.get("data");
    const isISO = q && /^\d{4}-\d{2}-\d{2}$/.test(q);
    setData(isISO ? q! : todayStrSP());
  }, [searchParams]);

  const carregar = useCallback(
    async (d: string) => {
      setErro("");
      setLoading(true);
      try {
        const url = `${API_URL}/disponibilidadeGeral/dia`;
        const { data: resp } = await axios.get<ApiResp>(url, {
          params: { data: d },
          withCredentials: true,
        });

        setHoras(resp.horas || []);
        setEsportes(resp.esportes || {});
      } catch (e) {
        console.error(e);
        setEsportes(null);
        setErro("Erro ao carregar a disponibilidade do dia.");
      } finally {
        setLoading(false);
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

  // Abre modal com detalhes (busca igual à Home; inclui campos para PERMANENTE)
  const abrirDetalhes = useCallback(
    async (agendamentoId: string, tipoReserva: TipoReserva, horario: string, esporte: string) => {
      if (!agendamentoId || !tipoReserva) return;

      try {
        setLoadingDetalhes(true);
        const rota =
          tipoReserva === "permanente"
            ? `agendamentosPermanentes/${agendamentoId}`
            : `agendamentos/${agendamentoId}`;

        const { data: det } = await axios.get(`${API_URL}/${rota}`, { withCredentials: true });

        // aceita usuário como string OU objeto { nome, celular }
        const usuarioValor: string | Usuario =
          typeof det?.usuario === "object" || typeof det?.usuario === "string"
            ? det.usuario
            : "—";

        const jogadores: JogadorRef[] = Array.isArray(det?.jogadores) ? det.jogadores : [];

        // prioriza SEMPRE o esporte do agendamento (API); usa o do grid só como fallback
        const esporteNome =
          (typeof det?.esporte === "string" ? det.esporte : det?.esporte?.nome) ??
          (esporte ?? null);

        setAgendamentoSelecionado({
          dia: data,
          horario,
          usuario: usuarioValor,
          jogadores,
          esporte: esporteNome,
          tipoReserva,
          agendamentoId,
          tipoLocal: "quadra",
          diaSemana: det?.diaSemana ?? null,
          dataInicio: det?.dataInicio ? String(det.dataInicio).slice(0, 10) : null,
        });
      } catch (err) {
        console.error("Erro ao buscar detalhes:", err);
      } finally {
        setLoadingDetalhes(false);
      }
    },
    [API_URL, data]
  );

  /* ====== Clique em slot LIVRE -> confirmação e redirect ====== */
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

  /* ====== AÇÕES: cancelar ====== */
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
    if (!agendamentoSelecionado) return;
    setLoadingCancelamento(true);

    const { agendamentoId, tipoReserva } = agendamentoSelecionado;
    const rota =
      tipoReserva === "permanente"
        ? `agendamentosPermanentes/cancelar/${agendamentoId}`
        : `agendamentos/cancelar/${agendamentoId}`;

    try {
      await axios.post(`${API_URL}/${rota}`, {}, { withCredentials: true });
      alert("Agendamento cancelado com sucesso!");
      setAgendamentoSelecionado(null);
      setConfirmarCancelamento(false);
      setMostrarOpcoesCancelamento(false);
      refresh();
    } catch (error) {
      console.error("Erro ao cancelar agendamento:", error);
      alert("Erro ao cancelar agendamento.");
    } finally {
      setLoadingCancelamento(false);
    }
  };

  /* ====== PERMANENTE: exceção (cancelar 1 dia) ====== */
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

  const confirmarExcecao = async () => {
    if (!agendamentoSelecionado?.agendamentoId || !dataExcecaoSelecionada) return;
    try {
      setPostandoExcecao(true);
      await axios.post(
        `${API_URL}/agendamentosPermanentes/${agendamentoSelecionado.agendamentoId}/cancelar-dia`,
        { data: dataExcecaoSelecionada, usuarioId: (usuario as any)?.id },
        { withCredentials: true }
      );
      alert("Exceção criada com sucesso (cancelado somente este dia).");
      setMostrarExcecaoModal(false);
      setAgendamentoSelecionado(null);
      refresh();
    } catch (e: any) {
      console.error(e);
      const raw = e?.response?.data?.erro ?? e?.response?.data?.message ?? e?.message;
      alert(typeof raw === "string" ? raw : JSON.stringify(raw));
    } finally {
      setPostandoExcecao(false);
    }
  };

  /* ====== Transferência (busca sem acento) ====== */
  const buscarUsuarios = useCallback(
    async (termo: string) => {
      const term = termo.trim();
      if (term.length === 0) {
        setUsuariosFiltrados([]);
        return;
      }
      setCarregandoUsuarios(true);
      try {
        const res = await axios.get<UsuarioLista[]>(`${API_URL}/clientes`, {
          params: { nome: term },
          withCredentials: true,
        });

        const tNorm = normalizeText(term);
        const filtrados = (res.data || []).filter((u) =>
          normalizeText(u.nome).includes(tNorm)
        );

        setUsuariosFiltrados(filtrados);
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

      alert("Agendamento transferido com sucesso!");
      setAgendamentoSelecionado(null);
      setAbrirModalTransferencia(false);
      refresh();
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

  /* ====== Jogadores (busca sem acento) ====== */
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
      const term = termo.trim();
      if (term.length < 2) {
        setUsuariosParaJogadores([]);
        return;
      }
      setCarregandoJogadores(true);
      try {
        const res = await axios.get<UsuarioLista[]>(`${API_URL}/clientes`, {
          params: { nome: term },
          withCredentials: true,
        });

        const tNorm = normalizeText(term);
        const filtrados = (res.data || []).filter((u) =>
          normalizeText(u.nome).includes(tNorm)
        );

        setUsuariosParaJogadores(filtrados);
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
      refresh();
    } catch (e) {
      console.error(e);
      alert("Erro ao adicionar jogadores.");
    } finally {
      setAddingPlayers(false);
    }
  };

  // Célula da grade
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
        abrirDetalhes(slot.agendamentoId!, slot.tipoReserva as TipoReserva, hora, esporte);
      }
    };

    return (
      <button
        type="button"
        disabled={!clickable}
        onClick={onClick}
        title={slot.usuario?.nome || (isBloq ? "Bloqueada" : isLivre ? "Livre" : label)}
        className={`${base} ${cls} ${
          clickable ? "cursor-pointer hover:brightness-95" : "cursor-default"
        }`}
      >
        <span>{label}</span>
      </button>
    );
  };

  const Conteudo = useMemo(() => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-gray-700">
          <Spinner /> <span>Carregando disponibilidade…</span>
        </div>
      );
    }
    if (erro) {
      return <div className="text-red-600 text-sm">{erro}</div>;
    }
    if (!esportes || horas.length === 0) {
      return <div className="text-gray-500 text-sm">Nada para mostrar.</div>;
    }

    return (
      <div className="space-y-10">
        {Object.entries(esportes).map(([esporte, bloco]) => {
          if (!bloco?.grupos?.length) return null;

          return (
            <div key={esporte} className="space-y-10">
              {bloco.grupos.map((grupo, gi) => {
                if (!grupo?.length) return null;

                const minNum = Math.min(...grupo.map((q) => q.numero));
                const maxNum = Math.max(...grupo.map((q) => q.numero));

                return (
                  <section key={`${esporte}-${gi}`}>
                    {/* Cabeçalho por grupo */}
                    <h2 className="text-center text-xl sm:text-2xl md:text-3xl font-extrabold text-gray-900 mb-3">
                      {esporte} – {minNum} - {maxNum}
                    </h2>

                    {/* Linha com os números das quadras */}
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

                    {/* Grade: horas x quadras */}
                    <div className="space-y-0">
                      {horas.map((hora) => (
                        <div key={hora} className="grid grid-cols-6 gap-0">
                          {grupo.map((q) => {
                            const slot = q.slots[hora] || { disponivel: true };
                            return (
                              <Cell
                                key={`${q.quadraId}-${hora}`}
                                slot={slot}
                                hora={hora}
                                esporte={esporte}
                                quadra={{
                                  quadraId: q.quadraId,
                                  nome: q.nome,
                                  numero: q.numero,
                                }}
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
    );
  }, [loading, erro, esportes, horas, abrirDetalhes, abrirConfirmAgendar]);

  return (
    <div className="px-2 sm:px-3 md:px-4 py-4">
      {/* Filtro: Data */}
      <div className="bg-white p-3 sm:p-4 shadow rounded-lg max-w-md mb-4">
        <label className="text-sm text-gray-600">Data</label>
        <input
          type="date"
          className="border p-2 rounded-lg w-full"
          value={data}
          onChange={(e) => {
            const v = e.target.value;
            setData(v);
            router.replace(`/adminMaster/todosHorarios?data=${v}`, { scroll: false });
          }}
        />
      </div>

      {/* Conteúdo (tabela/grade) */}
      {Conteudo}

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

      {/* CONFIRMAÇÃO DE AGENDAMENTO RÁPIDO (slot livre) */}
      {confirmAgendar && agendarCtx && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[65]">
          <div className="bg-white rounded-lg p-5 w-[90%] max-w-md">
            <h3 className="text-lg font-semibold mb-2">Confirmar agendamento</h3>
            <p className="text-sm text-gray-700 mb-4">
              Deseja agendar a <b>Quadra {agendarCtx.quadraNumero}</b> ({agendarCtx.quadraNome})
              em <b>{toDdMm(data)}</b> às <b>{agendarCtx.hora}</b> para{" "}
              <b>{agendarCtx.esporte}</b>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmAgendar(false);
                  setAgendarCtx(null);
                }}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarAgendamentoRapido}
                className="px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
              >
                Sim, agendar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES + AÇÕES */}
      {agendamentoSelecionado && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-80 relative max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-semibold mb-4">Detalhes do Agendamento</h2>
            <p>
              <strong>Dia:</strong> {agendamentoSelecionado.dia}
            </p>
            <p>
              <strong>Horário:</strong> {agendamentoSelecionado.horario}
            </p>
            {agendamentoSelecionado.esporte && (
              <p>
                <strong>Esporte:</strong> {agendamentoSelecionado.esporte}
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
            <p>
              <strong>Tipo:</strong> {agendamentoSelecionado.tipoReserva}
            </p>

            {/* Jogadores (COMUM) */}
            {agendamentoSelecionado.tipoReserva === "comum" && (
              <div className="mt-2">
                <strong>Jogadores:</strong>
                <ul className="list-disc list-inside text-sm text-gray-700 mt-2">
                  {agendamentoSelecionado.jogadores?.length > 0 ? (
                    agendamentoSelecionado.jogadores.map((j, idx) => (
                      <li key={idx}>{j.nome}</li>
                    ))
                  ) : (
                    <li>Nenhum jogador cadastrado</li>
                  )}
                </ul>
              </div>
            )}

            {/* --- AÇÕES --- */}

            {/* Adicionar Jogadores (somente COMUM) */}
            {agendamentoSelecionado.tipoReserva === "comum" && (
              <button
                type="button"
                onClick={abrirModalAdicionarJogadores}
                className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-4 rounded cursor-pointer"
              >
                Adicionar jogadores
              </button>
            )}

            {/* Transferir (COMUM e PERMANENTE) */}
            <button
              onClick={abrirModalTransferir}
              disabled={loadingTransferencia}
              className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded cursor-pointer disabled:opacity-60"
            >
              {loadingTransferencia ? "Transferindo..." : "Transferir Agendamento"}
            </button>

            {/* Cancelar */}
            <button
              onClick={abrirFluxoCancelamento}
              className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded cursor-pointer"
            >
              Cancelar Agendamento
            </button>

            {/* Fechar */}
            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="mt-2 w-full bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded cursor-pointer"
            >
              Fechar
            </button>

            {/* Confirmar cancelamento (comum) */}
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

            {/* Opções para PERMANENTE */}
            {mostrarOpcoesCancelamento && (
              <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-50">
                <div className="bg-white rounded-lg p-4 w-full">
                  <p className="font-semibold mb-3 text-center">
                    Cancelar apenas 1 dia deste agendamento permanente
                  </p>
                  <div className="grid gap-3">
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

            {/* Modal de EXCEÇÃO */}
            {mostrarExcecaoModal && (
              <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 rounded-xl z-50">
                <div className="bg-white rounded-lg p-4 w-full max-w-sm">
                  <h3 className="text-lg font-semibold mb-2">Cancelar apenas 1 dia</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Selecione uma data (próximas {datasExcecao.length} datas em{" "}
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
              {agendamentoSelecionado?.tipoReserva === "permanente"
                ? "(Permanente)"
                : "(Comum)"}
            </h3>

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
                  title={user.celular || ""}
                >
                  {user.nome}
                  {user.celular
                    ? ` (${user.celular})`
                    : user.email
                    ? ` (${user.email})`
                    : ""}
                </li>
              ))}
            </ul>

            {/* Opção extra apenas para permanentes */}
            {agendamentoSelecionado?.tipoReserva === "permanente" && (
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
                      {u.celular
                        ? ` (${u.celular})`
                        : u.email
                        ? ` (${u.email})`
                        : ""}
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

            {/* convidado (apenas nome) */}
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
    </div>
  );
}
