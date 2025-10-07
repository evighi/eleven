"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import { useAuthStore } from "@/context/AuthStore";
import { useRouter, useSearchParams } from "next/navigation";

/* =========================
   Tipos da rota /disponibilidadeGeral/permanentes
========================= */
type Usuario = { nome: string; email?: string; celular?: string | null };

type PermMeta = {
  proximaData: string | null;     // YYYY-MM-DD
  dataInicio: string | null;      // YYYY-MM-DD
  excecoes: { id: string; data: string; motivo: string | null }[];
};

type SlotInfoPerm = {
  disponivel: boolean;
  tipoReserva?: "permanente";
  usuario?: Usuario;
  agendamentoId?: string;
  permanenteMeta?: PermMeta;
};

type QuadraSlots = {
  quadraId: string;
  nome: string;
  numero: number;
  slots: Record<string, SlotInfoPerm>; // hora -> slot
};

type EsporteBlock = {
  quadras: QuadraSlots[];
  grupos: QuadraSlots[][];
};

type ApiResp = {
  diaSemana: DiaSemana;  // "SEGUNDA" | ...
  horas: string[];       // ["07:00", ... "23:00"]
  esportes: Record<string, EsporteBlock>;
};

type DiaSemana =
  | "DOMINGO"
  | "SEGUNDA"
  | "TERCA"
  | "QUARTA"
  | "QUINTA"
  | "SEXTA"
  | "SABADO";

/* =========================
   Modal de detalhes (reaproveita seu formato)
========================= */
type JogadorRef = { nome: string };
type AgendamentoSelecionado = {
  horario: string;         // HH:MM
  usuario: string | Usuario | "—";
  esporte?: string | null;
  tipoReserva: "permanente";
  agendamentoId: string;
  tipoLocal: "quadra";
  diaSemana?: string | null;
  dataInicio?: string | null; // YYYY-MM-DD
  proximaData?: string | null;
  excecoes?: { id: string; data: string; motivo: string | null }[];
};

/* ===== Helpers ===== */
const SP_TZ = "America/Sao_Paulo";
const DIA_LABEL: Record<DiaSemana, string> = {
  DOMINGO: "Domingo",
  SEGUNDA: "Segunda",
  TERCA: "Terça",
  QUARTA: "Quarta",
  QUINTA: "Quinta",
  SEXTA: "Sexta",
  SABADO: "Sábado",
};
const JS_DAY_2_ENUM: Record<number, DiaSemana> = {
  0: "DOMINGO",
  1: "SEGUNDA",
  2: "TERCA",
  3: "QUARTA",
  4: "QUINTA",
  5: "SEXTA",
  6: "SABADO",
};

function onlyHour(hhmm?: string) {
  if (!hhmm) return "";
  const [hh] = hhmm.split(":");
  return hh || hhmm;
}
function firstName(full?: string) {
  if (!full) return "";
  const [a] = full.trim().split(/\s+/);
  return a || "";
}

/* =========================
   Página
========================= */
export default function PermanentesGridPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const { usuario } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  // diaSemana: default = hoje (timezone SP)
  const [diaSemana, setDiaSemana] = useState<DiaSemana>(() => {
    const now = new Date(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: SP_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()) + "T00:00:00-03:00"
    );
    return JS_DAY_2_ENUM[now.getDay()];
  });

  const [horas, setHoras] = useState<string[]>([]);
  const [esportes, setEsportes] = useState<Record<string, EsporteBlock> | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal de detalhes
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [agendamentoSelecionado, setAgendamentoSelecionado] =
    useState<AgendamentoSelecionado | null>(null);

  // inicializa via query (?diaSemana=SEGUNDA)
  useEffect(() => {
    const q = searchParams.get("diaSemana") as DiaSemana | null;
    if (q && ["DOMINGO","SEGUNDA","TERCA","QUARTA","QUINTA","SEXTA","SABADO"].includes(q)) {
      setDiaSemana(q);
    }
  }, [searchParams]);

  const carregar = useCallback(
    async (dia: DiaSemana) => {
      setErro("");
      setLoading(true);
      try {
        const url = `${API_URL}/disponibilidadeGeral/permanentes`;
        const { data: resp } = await axios.get<ApiResp>(url, {
          params: { diaSemana: dia },
          withCredentials: true,
        });

        setHoras(resp.horas || []);
        setEsportes(resp.esportes || {});
      } catch (e) {
        console.error(e);
        setEsportes(null);
        setErro("Erro ao carregar a grade de permanentes.");
      } finally {
        setLoading(false);
      }
    },
    [API_URL]
  );

  useEffect(() => {
    if (diaSemana) carregar(diaSemana);
  }, [carregar, diaSemana]);

  const refresh = useCallback(() => {
    if (diaSemana) carregar(diaSemana);
  }, [carregar, diaSemana]);

  // Abre modal com detalhes do PERMANENTE
  const abrirDetalhes = useCallback(
    async (agendamentoId: string, horario: string, esporte: string, meta?: PermMeta) => {
      if (!agendamentoId) return;

      try {
        setLoadingDetalhes(true);
        const { data: det } = await axios.get(`${API_URL}/agendamentosPermanentes/${agendamentoId}`, {
          withCredentials: true,
        });

        const usuarioValor: string | Usuario =
          typeof det?.usuario === "object" || typeof det?.usuario === "string"
            ? det.usuario
            : "—";

        const esporteNome =
          (typeof det?.esporte === "string" ? det.esporte : det?.esporte?.nome) ?? (esporte ?? null);

        setAgendamentoSelecionado({
          horario,
          usuario: usuarioValor,
          esporte: esporteNome,
          tipoReserva: "permanente",
          agendamentoId,
          tipoLocal: "quadra",
          diaSemana: det?.diaSemana ?? null,
          dataInicio: meta?.dataInicio ?? (det?.dataInicio ? String(det.dataInicio).slice(0, 10) : null),
          proximaData: meta?.proximaData ?? null,
          excecoes: meta?.excecoes ?? [],
        });
      } catch (err) {
        console.error("Erro ao buscar detalhes:", err);
      } finally {
        setLoadingDetalhes(false);
      }
    },
    [API_URL]
  );

  // célula (apenas permanentes em verde; vazias não clicam)
  const Cell = ({
    slot,
    hora,
    esporte,
  }: {
    slot: SlotInfoPerm;
    hora: string;
    esporte: string;
  }) => {
    const isPerm = slot.tipoReserva === "permanente";
    const base =
      "min-h-7 xs:min-h-8 sm:min-h-9 md:min-h-10 text-[9px] xs:text-[10px] sm:text-[11px] md:text-xs " +
      "rounded-none border flex items-center justify-center text-center px-1 py-1 whitespace-normal break-words leading-tight";

    let cls = "bg-white text-gray-900 border-gray-300";
    if (isPerm) cls = "bg-emerald-600 text-white border-emerald-700";

    const hourLabel = onlyHour(hora);
    const label = isPerm
      ? `${firstName(slot.usuario?.nome)} - ${hourLabel}`
      : `Sem permanente - ${hourLabel}`;

    const clickable = isPerm && !!slot.agendamentoId;

    const onClick = () => {
      if (!clickable) return;
      abrirDetalhes(slot.agendamentoId!, hora, esporte, slot.permanenteMeta);
    };

    const title = isPerm
      ? [
          slot.usuario?.nome,
          slot.permanenteMeta?.proximaData ? `Próxima: ${slot.permanenteMeta.proximaData}` : null,
          slot.permanenteMeta?.dataInicio ? `Início: ${slot.permanenteMeta.dataInicio}` : null,
        ]
          .filter(Boolean)
          .join(" | ")
      : "Sem permanente";

    return (
      <button
        type="button"
        disabled={!clickable}
        onClick={onClick}
        title={title}
        className={`${base} ${cls} ${clickable ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
      >
        <span>{label}</span>
      </button>
    );
  };

  const Conteudo = useMemo(() => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-gray-700">
          <Spinner /> <span>Carregando permanentes…</span>
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
                    {/* Cabeçalho por grupo (ex: Beach Tennis – 1 - 6) */}
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
  }, [loading, erro, esportes, horas, abrirDetalhes]);

  return (
    <div className="px-2 sm:px-3 md:px-4 py-4">
      {/* Filtro: Dia da semana */}
      <div className="bg-white p-3 sm:p-4 shadow rounded-lg max-w-md mb-4">
        <label className="text-sm text-gray-600">Dia da semana</label>
        <select
          className="border p-2 rounded-lg w-full"
          value={diaSemana}
          onChange={(e) => {
            const v = e.target.value as DiaSemana;
            setDiaSemana(v);
            const url = new URL(window.location.href);
            url.searchParams.set("diaSemana", v);
            router.replace(url.toString(), { scroll: false });
          }}
        >
          {(["DOMINGO","SEGUNDA","TERCA","QUARTA","QUINTA","SEXTA","SABADO"] as DiaSemana[]).map((d) => (
            <option key={d} value={d}>{DIA_LABEL[d]}</option>
          ))}
        </select>
        <p className="text-[11px] text-gray-500 mt-1">
          Clique nos blocos verdes para ver detalhes do permanente.
        </p>
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

      {/* MODAL DE DETALHES (PERMANENTE) */}
      {agendamentoSelecionado && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-80 relative max-h-[90vh] overflow-auto">
            <h2 className="text-lg font-semibold mb-4">Agendamento Permanente</h2>

            <p><strong>Dia da semana:</strong> {agendamentoSelecionado.diaSemana ?? "-"}</p>
            <p><strong>Horário:</strong> {agendamentoSelecionado.horario}</p>
            {agendamentoSelecionado.esporte && <p><strong>Esporte:</strong> {agendamentoSelecionado.esporte}</p>}
            <p>
              <strong>Usuário:</strong>{" "}
              {typeof agendamentoSelecionado.usuario === "string"
                ? agendamentoSelecionado.usuario
                : [agendamentoSelecionado.usuario?.nome, agendamentoSelecionado.usuario?.celular]
                    .filter(Boolean)
                    .join(" — ")}
            </p>
            <p><strong>Início do contrato:</strong> {agendamentoSelecionado.dataInicio ?? "—"}</p>
            <p><strong>Próxima data:</strong> {agendamentoSelecionado.proximaData ?? "—"}</p>

            <div className="mt-3">
              <strong>Exceções:</strong>
              {agendamentoSelecionado.excecoes && agendamentoSelecionado.excecoes.length > 0 ? (
                <ul className="list-disc list-inside text-sm text-gray-700 mt-2">
                  {agendamentoSelecionado.excecoes.map((e) => (
                    <li key={e.id}>
                      {e.data} {e.motivo ? `— ${e.motivo}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-600 mt-1">Nenhuma exceção cadastrada.</p>
              )}
            </div>

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
