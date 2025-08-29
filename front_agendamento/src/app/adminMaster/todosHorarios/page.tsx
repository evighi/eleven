"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams } from "next/navigation";
import Spinner from "@/components/Spinner";

/* ================= Helpers SP ================= */
const SP_TZ = "America/Sao_Paulo";
const todayStrSP = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

const HORAS_PADRAO = Array.from({ length: 17 }, (_, i) =>
  `${String(7 + i).padStart(2, "0")}:00`
);

/* ================ Tipagens esperadas ================ */
type StatusSlot = "livre" | "bloqueada" | "comum" | "permanente";
type TipoReserva = "comum" | "permanente";

type UsuarioRef = { nome?: string; email?: string; celular?: string };

type Slot = {
  status?: StatusSlot; // "livre" | "bloqueada" | "comum" | "permanente"
  tipoReserva?: TipoReserva | null;
  usuario?: UsuarioRef | null;
  agendamentoId?: string;
};

type HoraLinha = { hora: string; slots: Slot[] };

type QuadraRef = { quadraId: string; nome: string; numero: number };

type GrupoEsporte = {
  label: string; // "Quadras 1 à 6" (ou “Areia 1 - 6”)
  quadras: QuadraRef[]; // tamanho 1..6 (preenchemos para 6)
  horas: HoraLinha[]; // cada linha com 6 slots no mesmo índice das quadras
};

type EsporteBloco = { esporte: string; grupos: GrupoEsporte[] };

type ApiResp = {
  esportes: EsporteBloco[];
  meta?: { data?: string; horas?: string[] };
};

/* =================== Utils UI =================== */
const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
const ROTA = "/disponibilidadeDia/diario";

const firstName = (nome?: string) =>
  (nome || "")
    .trim()
    .split(/\s+/)[0]
    .toUpperCase();

function padToSix<T>(arr: T[]): (T | null)[] {
  const out = [...arr] as (T | null)[];
  while (out.length < 6) out.push(null);
  return out.slice(0, 6);
}

function bgFor(slot: Slot | null): string {
  if (!slot) return "bg-white border-gray-200 text-gray-800";
  const s = slot.status || (slot.tipoReserva as StatusSlot) || "livre";
  if (s === "permanente") return "bg-green-600 text-white border-green-700";
  if (s === "comum") return "bg-orange-600 text-white border-orange-700";
  if (s === "bloqueada") return "bg-gray-500 text-white border-gray-600";
  return "bg-white border-gray-300 text-gray-800";
}

function isClickable(slot: Slot | null): boolean {
  if (!slot) return false;
  const s = slot.status || (slot.tipoReserva as StatusSlot);
  return !!slot.agendamentoId && (s === "comum" || s === "permanente");
}

function labelFor(slot: Slot | null, hora: string): string {
  const h = hora.slice(0, 2); // "07:00" -> "07"
  if (!slot) return String(parseInt(h, 10)); // número da hora sem :00
  const s = slot.status || (slot.tipoReserva as StatusSlot) || "livre";
  if (s === "livre") return String(parseInt(h, 10));
  if (s === "bloqueada") return `BLOQUEADA - ${parseInt(h, 10)}`;
  const nome = firstName(slot.usuario?.nome || "");
  return `${nome || "—"} - ${parseInt(h, 10)}`;
}

/* ===================== Página ===================== */
export default function TodosHorariosPage() {
  const search = useSearchParams();
  const initialDate = search.get("data") || todayStrSP();

  const [data, setData] = useState(initialDate);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const horas = useMemo(
    () => resp?.meta?.horas || HORAS_PADRAO,
    [resp?.meta?.horas]
  );

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const r = await axios.get<ApiResp>(`${API_URL}${ROTA}`, {
        params: { data },
        withCredentials: true,
      });
      setResp(r.data);
    } catch (e) {
      console.error(e);
      setErro("Erro ao carregar a disponibilidade do dia.");
      setResp(null);
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /* -------- Modal de Detalhes -------- */
  const [modalOpen, setModalOpen] = useState(false);
  const [detLoading, setDetLoading] = useState(false);
  const [det, setDet] = useState<{
    dia: string;
    horario: string;
    esporte?: string;
    quadra?: string;
    nome?: string;
    tipo?: "Comum" | "Permanente";
  } | null>(null);

  async function abrirDetalhes(slot: Slot, hora: string, esporte: string, quadra: QuadraRef) {
    const permanente = (slot.status || slot.tipoReserva) === "permanente";
    const rota = permanente
      ? `${API_URL}/agendamentosPermanentes/${slot.agendamentoId}`
      : `${API_URL}/agendamentos/${slot.agendamentoId}`;

    try {
      setDetLoading(true);
      const r = await axios.get(rota, { withCredentials: true });
      const nomeDet =
        (r.data?.usuario && (typeof r.data.usuario === "string" ? r.data.usuario : r.data.usuario?.nome)) ||
        slot.usuario?.nome ||
        "—";

      setDet({
        dia: data,
        horario: hora,
        esporte,
        quadra: `${quadra.nome} (Quadra ${quadra.numero})`,
        nome: nomeDet,
        tipo: permanente ? "Permanente" : "Comum",
      });
      setModalOpen(true);
    } catch (e) {
      console.error(e);
      alert("Não foi possível carregar os detalhes.");
    } finally {
      setDetLoading(false);
    }
  }

  return (
    <div className="p-4 space-y-6">
      {/* Filtro de Data */}
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
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-700">
          <Spinner />
          <span>Carregando todos os horários…</span>
        </div>
      ) : erro ? (
        <div className="text-red-600">{erro}</div>
      ) : !resp || resp.esportes.length === 0 ? (
        <div className="text-gray-600">Nenhum dado para o dia.</div>
      ) : (
        <div className="space-y-12">
          {resp.esportes.map((bloco) => (
            <div key={bloco.esporte} className="space-y-8">
              {bloco.grupos.map((grupo, idx) => {
                // Garantir 6 colunas
                const quadras6 = padToSix(grupo.quadras);

                return (
                  <section key={grupo.label + idx}>
                    {/* Título ao estilo do mock: “Areia 1 - 6” */}
                    <h2 className="text-2xl sm:text-3xl font-semibold text-center text-gray-800 mb-3">
                      {grupo.label}
                    </h2>

                    {/* Grade: SEM coluna de horário; exatamente 6 colunas de quadra.
                        Para não quebrar, dá uma largura mínima e permite scroll horizontal */}
                    <div className="w-full overflow-x-auto">
                      <div className="min-w-[900px]">
                        {/* Cabeçalho com números das quadras */}
                        <div className="grid grid-cols-6 gap-[2px] px-1 pb-2">
                          {quadras6.map((q, i) => (
                            <div
                              key={i}
                              className="text-sm font-semibold text-gray-600 text-center"
                            >
                              {q ? String(q.numero) : "—"}
                            </div>
                          ))}
                        </div>

                        {/* Linhas por hora */}
                        <div className="space-y-[2px]">
                          {grupo.horas.map((linha) => {
                            // slots alinhados às quadras
                            const slots6 = padToSix(linha.slots);

                            return (
                              <div key={linha.hora} className="grid grid-cols-6 gap-[2px]">
                                {slots6.map((slot, i) => {
                                  const q = quadras6[i]!;
                                  const clickable = isClickable(slot);
                                  const label = labelFor(slot, linha.hora);

                                  return (
                                    <button
                                      key={i}
                                      type="button"
                                      disabled={!clickable || !q}
                                      onClick={
                                        clickable && q
                                          ? () => abrirDetalhes(slot as Slot, linha.hora, bloco.esporte, q as QuadraRef)
                                          : undefined
                                      }
                                      className={`h-12 sm:h-14 md:h-16 rounded-[3px] border text-xs sm:text-sm font-medium flex items-center justify-center ${bgFor(
                                        slot
                                      )} ${clickable ? "hover:brightness-95 cursor-pointer" : "cursor-default"}`}
                                      title={clickable ? "Ver detalhes" : ""}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Modal Detalhes */}
      {modalOpen && det && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-5 w-80">
            <h3 className="text-lg font-semibold mb-3">Detalhes</h3>
            {detLoading ? (
              <div className="flex items-center gap-2 text-gray-700">
                <Spinner /> <span>Carregando…</span>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                <p><strong>Dia:</strong> {det.dia}</p>
                <p><strong>Horário:</strong> {det.horario}</p>
                {det.esporte && <p><strong>Esporte:</strong> {det.esporte}</p>}
                {det.quadra && <p><strong>Quadra:</strong> {det.quadra}</p>}
                <p><strong>Usuário:</strong> {det.nome || "—"}</p>
                <p><strong>Tipo:</strong> {det.tipo || "—"}</p>
              </div>
            )}
            <button
              onClick={() => setModalOpen(false)}
              className="mt-4 w-full bg-orange-600 hover:bg-orange-700 text-white py-2 rounded cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
