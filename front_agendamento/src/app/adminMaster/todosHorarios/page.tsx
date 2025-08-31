"use client";

import { useCallback, useEffect, useState, Fragment } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import { useAuthStore } from "@/context/AuthStore";

/* ===== Helpers de data (America/Sao_Paulo) ===== */
const SP_TZ = "America/Sao_Paulo";
const todayIsoSP = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const DEFAULT_HOURS = Array.from({ length: 17 }, (_, i) => `${String(7 + i).padStart(2, "0")}:00`);

/* ===== Tipagens do payload da API ===== */
type TipoReserva = "comum" | "permanente";
type UsuarioMin = { nome?: string | null };

type SlotInfo = {
  disponivel: boolean;
  bloqueada?: boolean;
  tipoReserva?: TipoReserva;
  usuario?: UsuarioMin | null;
  agendamentoId?: string;
};

type QuadraAPI = {
  quadraId: string;
  nome: string;
  numero: number;
  slots: Record<string, SlotInfo>;
};

type EsporteAPI = {
  quadras: QuadraAPI[];
  grupos?: QuadraAPI[][];
};

type ApiDia = {
  data: string;
  horas: string[];
  esportes: Record<string, EsporteAPI>;
};

/* ===== Tipagens internas de render ===== */
type SlotCell = {
  numero: number | null; // null = coluna de padding
  hour: string;
  status: "livre" | "comum" | "permanente" | "bloqueada";
  label: string;
  clickable: boolean;
  slot?: SlotInfo | null;
};

type GroupMatrix = {
  title: string; // "Quadras X à Y"
  numbers: (number | null)[]; // sempre 6 itens
  rows: (SlotCell | null)[][]; // rows[hourIndex][colIndex]
};

type EsporteView = {
  nome: string;
  grupos: GroupMatrix[];
};

/* ===== Utils ===== */
const firstName = (full?: string | null) => (full ? (full.trim().split(/\s+/)[0] || "") : "");

const chunk6 = <T,>(arr: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 6) out.push(arr.slice(i, i + 6));
  return out;
};

// type guard para garantir que não é null
function isSlotCell(c: SlotCell | null | undefined): c is SlotCell {
  return !!c;
}

/* ===== Normalização do payload /disponibilidadeGeral/dia ===== */
function normalizeApi(resp: ApiDia): { hours: string[]; esportes: EsporteView[] } {
  const hours = Array.isArray(resp?.horas) && resp.horas.length > 0 ? resp.horas : DEFAULT_HOURS;
  const esportesIn = resp?.esportes || {};
  const esportesOut: EsporteView[] = [];

  for (const nome of Object.keys(esportesIn)) {
    const list = Array.isArray(esportesIn[nome]?.quadras) ? [...esportesIn[nome].quadras] : [];
    list.sort((a, b) => a.numero - b.numero);
    const gruposRaw = chunk6(list);

    const grupos: GroupMatrix[] = gruposRaw.map((quadras) => {
      const nums = quadras.map((q) => q.numero);
      const title =
        nums.length >= 2 ? `Quadras ${nums[0]} à ${nums[nums.length - 1]}` : `Quadra ${nums[0]}`;

      const numbers: (number | null)[] = [...nums];
      while (numbers.length < 6) numbers.push(null);

      const rows: (SlotCell | null)[][] = hours.map((h) => {
        const line: (SlotCell | null)[] = quadras.map((q) => {
          const s = q.slots?.[h];
          let status: SlotCell["status"] = "livre";
          let label = "Livre";
          let clickable = false;

          if (s?.bloqueada) {
            status = "bloqueada";
            label = "Bloqueada";
          } else if (s?.tipoReserva === "permanente") {
            status = "permanente";
            label = firstName(s?.usuario?.nome) || "Permanente";
            clickable = true;
          } else if (s?.tipoReserva === "comum") {
            status = "comum";
            label = firstName(s?.usuario?.nome) || "Comum";
            clickable = true;
          } else if (s && s.disponivel === false) {
            status = "comum";
            label = firstName(s?.usuario?.nome) || "Reservado";
            clickable = true;
          }

          const cell: SlotCell = {
            numero: q.numero,
            hour: h,
            status,
            label,
            clickable,
            slot: s ?? null,
          };

          return cell;
        });

        while (line.length < 6) {
          line.push({
            numero: null,
            hour: h,
            status: "livre",
            label: "",
            clickable: false,
            slot: null,
          });
        }

        return line;
      });

      return { title, numbers, rows };
    });

    esportesOut.push({ nome, grupos });
  }

  return { hours, esportes: esportesOut };
}

/* ===== Componente ===== */
export default function TodosHorarios() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const { usuario } = useAuthStore();

  const [data, setData] = useState<string>(todayIsoSP());
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string>("");
  const [hours, setHours] = useState<string[]>(DEFAULT_HOURS);
  const [esportes, setEsportes] = useState<EsporteView[] | null>(null);

  const carregar = useCallback(
    async (d: string) => {
      setErro("");
      setLoading(true);
      try {
        const { data: resp } = await axios.get<ApiDia>(`${API_URL}/disponibilidadeGeral/dia`, {
          params: { data: d },
          withCredentials: true,
        });
        const norm = normalizeApi(resp);
        setHours(norm.hours);
        setEsportes(norm.esportes);
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
  }, [data, carregar]);

  const onChangeDate = (e: React.ChangeEvent<HTMLInputElement>) => setData(e.target.value);

  const cellClass = (c: SlotCell | null) => {
    if (!isSlotCell(c)) return "border h-9";
    switch (c.status) {
      case "permanente":
        return "border h-9 bg-green-600 text-white text-xs flex items-center justify-center font-medium";
      case "comum":
        return "border h-9 bg-orange-600 text-white text-xs flex items-center justify-center font-medium";
      case "bloqueada":
        return "border h-9 bg-red-600 text-white text-xs flex items-center justify-center font-medium";
      default:
        return "border h-9 bg-white text-xs flex items-center justify-center text-gray-700";
    }
  };

  const abrirDetalhes = (c: SlotCell | null, esporte: string) => {
    if (!isSlotCell(c) || !c.clickable || !c.slot) return;
    const tipo = c.status === "permanente" ? "Permanente" : "Comum";
    const nome = c.slot.usuario?.nome ? firstName(c.slot.usuario.nome) : "—";
    alert(`Esporte: ${esporte}\nQuadra: ${c.numero ?? "—"}\nHora: ${c.hour}\nTipo: ${tipo}\nUsuário: ${nome}`);
    // TODO: integrar com modal de detalhes (igual à Home Admin)
  };

  return (
    <div className="space-y-8">
      {/* FILTRO */}
      <div className="bg-white p-4 shadow rounded-lg flex flex-col sm:flex-row gap-4">
        <div className="flex flex-col w-full sm:w-auto">
          <label className="text-sm text-gray-600">Data</label>
          <input type="date" className="border p-2 rounded-lg" value={data} onChange={onChangeDate} />
        </div>
      </div>

      {/* CONTEÚDO */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-600">
          <Spinner /> <span>Carregando…</span>
        </div>
      ) : erro ? (
        <div className="text-red-600">{erro}</div>
      ) : !esportes || esportes.length === 0 ? (
        <div className="text-gray-600">Nenhuma quadra para este dia.</div>
      ) : (
        <div className="space-y-10">
          {esportes.map((esp) =>
            esp.grupos.length === 0 ? (
              <div key={esp.nome}>
                <div className="flex items-center mb-3">
                  <h2 className="text-lg font-semibold text-orange-700">{esp.nome}</h2>
                  <div className="flex-1 border-t border-gray-300 ml-3" />
                </div>
                <div className="text-sm text-gray-500">Nenhuma quadra cadastrada para este dia.</div>
              </div>
            ) : (
              esp.grupos.map((g, gi) => (
                <div key={`${esp.nome}-${gi}`}>
                  <div className="flex items-center mb-3">
                    <h2 className="text-lg font-semibold text-orange-700">
                      {esp.nome} – {g.title}
                    </h2>
                    <div className="flex-1 border-t border-gray-300 ml-3" />
                  </div>

                  <div className="overflow-auto">
                    <div className="grid grid-cols-7 min-w-[680px]">
                      {/* Cabeçalho */}
                      <div className="p-2 text-sm font-semibold text-gray-700 border bg-gray-50">Horário</div>
                      {g.numbers.map((n, i) => (
                        <div
                          key={`head-${gi}-${i}`}
                          className="p-2 text-sm font-semibold text-gray-700 border bg-gray-50 text-center"
                        >
                          {n ? String(n).padStart(2, "0") : "—"}
                        </div>
                      ))}

                      {/* Linhas */}
                      {hours.map((h, rIdx) => (
                        <Fragment key={h}>
                          <div className="border text-xs h-9 flex items-center justify-center bg-gray-50">{h}</div>
                          {g.rows[rIdx].map((cel, cIdx) => (
                            <button
                              key={`${h}-${cIdx}`}
                              type="button"
                              onClick={() => abrirDetalhes(cel, esp.nome)}
                              disabled={!isSlotCell(cel) || !cel.clickable}
                              className={`${cellClass(cel)} ${
                                isSlotCell(cel) && cel.clickable ? "cursor-pointer" : "cursor-default"
                              }`}
                              title={isSlotCell(cel) && cel.clickable ? `${cel.label} (${cel.status})` : ""}
                            >
                              {isSlotCell(cel) ? cel.label : ""}
                            </button>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      )}
    </div>
  );
}
