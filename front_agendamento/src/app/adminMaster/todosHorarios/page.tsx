"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";

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
   Tipos para modal de detalhes
========================= */
type JogadorRef = { nome: string };
type TipoReserva = "comum" | "permanente";
type AgendamentoSelecionado = {
  dia: string;
  horario: string;
  usuario: string | Usuario | "—";
  jogadores: JogadorRef[];
  esporte?: string | null;
  tipoReserva: TipoReserva;
  agendamentoId: string;
  tipoLocal: "quadra";
};

const SP_TZ = "America/Sao_Paulo";
const todayStrSP = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
} as any).format(new Date()) as string;

/* helpers */
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

  const [data, setData] = useState<string>(todayStrSP);
  const [horas, setHoras] = useState<string[]>([]);
  const [esportes, setEsportes] = useState<Record<string, EsporteBlock> | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal de detalhes
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [agendamentoSelecionado, setAgendamentoSelecionado] = useState<AgendamentoSelecionado | null>(null);

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
    carregar(data);
  }, [carregar, data]);

  // Abre modal com detalhes completos (nome completo etc.)
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

        const usuario =
          (det?.usuario && typeof det.usuario === "object" ? det.usuario.nome : det?.usuario) || "—";
        const jogadores: JogadorRef[] = Array.isArray(det?.jogadores) ? det.jogadores : [];

        setAgendamentoSelecionado({
          dia: data,
          horario,
          usuario,
          jogadores,
          esporte,
          tipoReserva,
          agendamentoId,
          tipoLocal: "quadra",
        });
      } catch (err) {
        console.error("Erro ao buscar detalhes:", err);
      } finally {
        setLoadingDetalhes(false);
      }
    },
    [API_URL, data]
  );

  // Célula da “tabela”
  const Cell = ({
    slot,
    hora,
    esporte,
  }: {
    slot: SlotInfo;
    hora: string;
    esporte: string;
  }) => {
    const isLivre = slot.disponivel && !slot.bloqueada;
    const isBloq = !!slot.bloqueada;
    const isPerm = slot.tipoReserva === "permanente";
    const isComum = slot.tipoReserva === "comum";

    // estilos bem compactos no mobile para caber 6 colunas
    const base =
      "h-6 xs:h-7 sm:h-8 md:h-9 lg:h-10 text-[8px] xs:text-[9px] sm:text-[10px] md:text-xs rounded-[6px] flex items-center justify-center text-center px-1 whitespace-nowrap overflow-hidden";
    let cls = "bg-white border border-gray-300 text-gray-900"; // livre
    if (isBloq) cls = "bg-gray-200 text-gray-600 border border-gray-300";
    if (isPerm) cls = "bg-emerald-600 text-white";
    if (isComum) cls = "bg-orange-600 text-white";

    const hourLabel = onlyHour(hora);
    const label = isBloq
      ? `Bloqueada - ${hourLabel}`
      : isLivre
      ? `Livre - ${hourLabel}`
      : `${firstName(slot.usuario?.nome)} - ${hourLabel}`;

    const clickable = !!(slot.agendamentoId && slot.tipoReserva && !isBloq);

    return (
      <button
        type="button"
        disabled={!clickable}
        onClick={() =>
          clickable &&
          abrirDetalhes(slot.agendamentoId!, slot.tipoReserva as TipoReserva, hora, esporte)
        }
        title={slot.usuario?.nome || (isBloq ? "Bloqueada" : isLivre ? "Livre" : label)}
        className={`${base} ${cls} ${clickable ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
      >
        <span className="truncate">{label}</span>
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
        {Object.entries(esportes).map(([esporteNome, bloco]) => {
          if (!bloco?.grupos?.length) return null;

          return (
            <div key={esporteNome} className="space-y-10">
              {bloco.grupos.map((grupo, gi) => {
                if (!grupo?.length) return null;

                const minNum = Math.min(...grupo.map((q) => q.numero));
                const maxNum = Math.max(...grupo.map((q) => q.numero));

                return (
                  <section key={`${esporteNome}-${gi}`}>
                    {/* Cabeçalho por grupo (ex: Beach Tennis – 1 - 6) */}
                    <h2 className="text-center text-xl sm:text-2xl md:text-3xl font-extrabold text-gray-900 mb-3">
                      {esporteNome} – {minNum} - {maxNum}
                    </h2>

                    {/* Linha com os números das quadras (6 colunas fixas) */}
                    <div className="grid grid-cols-6 gap-1 mb-1">
                      {grupo.map((q) => (
                        <div
                          key={q.quadraId}
                          className="h-6 xs:h-7 sm:h-8 md:h-9 lg:h-10 rounded-[6px] bg-gray-100 text-gray-700 text-[8px] xs:text-[9px] sm:text-[10px] md:text-xs flex items-center justify-center font-semibold"
                          title={q.nome}
                        >
                          {q.numero}
                        </div>
                      ))}
                      {/* Padding pra fechar 6 colunas se tiver menos de 6 quadras */}
                      {Array.from({ length: Math.max(0, 6 - grupo.length) }).map((_, i) => (
                        <div key={`void-${i}`} />
                      ))}
                    </div>

                    {/* “Tabela”: horas x 6 colunas (sem coluna lateral de horários) */}
                    <div className="space-y-[4px]">
                      {horas.map((hora) => (
                        <div key={hora} className="grid grid-cols-6 gap-1">
                          {grupo.map((q) => {
                            const slot = q.slots[hora] || { disponivel: true };
                            return (
                              <Cell
                                key={`${q.quadraId}-${hora}`}
                                slot={slot}
                                hora={hora}
                                esporte={esporteNome}
                              />
                            );
                          })}
                          {Array.from({ length: Math.max(0, 6 - grupo.length) }).map((_, i) => (
                            <div key={`pad-${i}`} />
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
  }, [loading, erro, esportes, horas, abrirDetalhes]);

  return (
    <div className="px-2 sm:px-3 md:px-4 py-4">
      {/* Filtro: Data */}
      <div className="bg-white p-3 sm:p-4 shadow rounded-lg max-w-md mb-4">
        <label className="text-sm text-gray-600">Data</label>
        <input
          type="date"
          className="border p-2 rounded-lg w-full"
          value={data}
          onChange={(e) => setData(e.target.value)}
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

      {/* MODAL DE DETALHES (nome COMPLETO aqui) */}
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
                : agendamentoSelecionado.usuario?.nome || "—"}
            </p>
            <p>
              <strong>Tipo:</strong> {agendamentoSelecionado.tipoReserva}
            </p>

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

            <button
              onClick={() => setAgendamentoSelecionado(null)}
              className="mt-4 w-full bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
