"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";

/* ================= Helpers de data (SP) ================= */
const SP_TZ = "America/Sao_Paulo";
const todayIsoSP = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date()); // YYYY-MM-DD

const HORAS: string[] = Array.from({ length: 17 }, (_, i) =>
  `${String(7 + i).padStart(2, "0")}:00`
);

/* ================= Tipagens do front (normalizadas) ================= */
type StatusCelula = "livre" | "comum" | "permanente" | "bloqueada";

type UsuarioSlim = { nome?: string; email?: string };

type Celula = {
  status: StatusCelula;
  usuario?: UsuarioSlim | null;
  agendamentoId?: string | null;
  tipoReserva?: "comum" | "permanente";
};

type LinhaHorario = {
  hora: string; // "07:00"
  colunas: Celula[]; // sempre 6 (preenche com livres quando sobrar)
};

type QuadraSlim = { quadraId: string; numero: number; nome: string };

type Grupo = {
  titulo: string; // ex.: "Quadras 1 a 6"
  quadras: QuadraSlim[]; // até 6
  horarios: LinhaHorario[]; // linhas por hora
};

type EsporteBloco = {
  esporte: string; // ex.: "Beach Tennis"
  grupos: Grupo[]; // grupos de 6 colunas
};

/* ================== Utilidades ================== */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function firstName(nome?: string) {
  if (!nome) return "";
  const p = nome.trim().split(/\s+/);
  return p[0] || "";
}

/* ========= Normalizador do retorno da API /disponibilidadeDia/diario ========= */
function normalizeApi(payload: any): EsporteBloco[] {
  const esportesArray: any[] =
    payload?.esportes ??
    Object.keys(payload || {}).map((key) => ({
      esporte: key,
      ...(payload?.[key] || {}),
    }));

  const resultado: EsporteBloco[] = [];

  for (const esp of esportesArray) {
    const nomeEsporte: string =
      esp?.esporte || esp?.nome || esp?.titulo || "Esporte";

    const quadrasSrc: any[] = esp?.quadras || esp?.quadrasDoEsporte || [];
    const quadras: QuadraSlim[] = (quadrasSrc as any[]).map((q: any) => ({
      quadraId: String(q?.id ?? q?.quadraId ?? ""),
      numero: Number(q?.numero ?? 0),
      nome: String(q?.nome ?? `Quadra ${q?.numero ?? ""}`),
    }));

    let tabela: Record<string, any[]> = {};
    if (Array.isArray(esp?.horarios)) {
      for (const linha of esp.horarios as any[]) {
        if (linha?.hora) tabela[linha.hora] = linha.colunas || [];
      }
    } else if (esp?.horas) {
      tabela = esp.horas as Record<string, any[]>;
    } else if (esp?.horariosPorHora) {
      tabela = esp.horariosPorHora as Record<string, any[]>;
    }

    const grupos: Grupo[] = [];
    const gruposQuadras = chunk(quadras, 6);

    for (const qGroup of gruposQuadras) {
      if (qGroup.length === 0) continue;

      const inicio = qGroup[0]?.numero ?? 0;
      const fim = qGroup[qGroup.length - 1]?.numero ?? inicio;
      const titulo = `${nomeEsporte} - Quadras ${inicio} à ${fim}`;

      const linhas: LinhaHorario[] = HORAS.map((h) => {
        const fullRow = (tabela?.[h] as any[]) || [];

        const colunas: Celula[] = qGroup.map((q) => {
          const idx = quadras.findIndex((orig) => orig.quadraId === q.quadraId);
          const cel: any = idx >= 0 ? fullRow[idx] : null;

          const status: StatusCelula = ((): StatusCelula => {
            const s = (cel?.status || "").toString().toLowerCase();
            if (s === "comum") return "comum";
            if (s === "permanente") return "permanente";
            if (s === "bloqueada" || s === "bloqueio") return "bloqueada";
            return "livre";
          })();

          const usuario: UsuarioSlim | null = cel?.usuario
            ? { nome: cel.usuario?.nome, email: cel.usuario?.email }
            : null;

          return {
            status,
            usuario,
            agendamentoId: cel?.agendamentoId ?? null,
            tipoReserva:
              status === "comum"
                ? "comum"
                : status === "permanente"
                ? "permanente"
                : undefined,
          };
        });

        while (colunas.length < 6) colunas.push({ status: "livre" });

        return { hora: h, colunas };
      });

      grupos.push({ titulo, quadras: qGroup, horarios: linhas });
    }

    resultado.push({ esporte: nomeEsporte, grupos });
  }

  return resultado;
}

/* ===================== Cell (AGORA NO ESCOPO DO MÓDULO) ===================== */
function Cell({
  cel,
  onClick,
}: {
  cel: Celula;
  onClick?: () => void;
}) {
  const clickable = cel.status !== "livre";
  const base =
    "w-full h-9 flex items-center justify-center text-xs rounded transition";
  const cls =
    cel.status === "permanente"
      ? "bg-green-600 text-white"
      : cel.status === "comum"
      ? "bg-orange-600 text-white"
      : cel.status === "bloqueada"
      ? "bg-gray-400 text-white"
      : "bg-white text-gray-800 border";

  return (
    <div
      className={`${base} ${cls} ${
        clickable ? "cursor-pointer hover:opacity-90" : "cursor-default"
      }`}
      onClick={clickable ? onClick : undefined}
      title={
        cel.status === "livre"
          ? "Livre"
          : `${cel.tipoReserva ?? cel.status}${
              cel?.usuario?.nome ? ` — ${cel.usuario.nome}` : ""
            }`
      }
    >
      {cel.status === "livre"
        ? ""
        : cel?.usuario?.nome
        ? firstName(cel.usuario.nome)
        : cel.tipoReserva === "permanente"
        ? "Permanente"
        : "Comum"}
    </div>
  );
}

/* ===================== Row de horário (fora do componente principal) ===================== */
function FragmentRow({
  hora,
  colunas,
  quadras,
  onOpen,
}: {
  hora: string;
  colunas: Celula[];
  quadras: QuadraSlim[];
  onOpen: (colIdx: number) => void;
}) {
  return (
    <>
      <div className="h-9 flex items-center justify-center text-xs text-gray-600">
        {hora}
      </div>
      {Array.from({ length: 6 }).map((_, i) => {
        const cel = colunas[i] ?? { status: "livre" as StatusCelula };
        const q = quadras[i];
        return (
          <Cell
            key={`${hora}-${i}-${q?.quadraId || "empty"}`}
            cel={cel}
            onClick={() => onOpen(i)}
          />
        );
      })}
    </>
  );
}

/* =========================== Página =========================== */
export default function TodosHorariosPage() {
  const RAW_API_URL =
    process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const API_URL = useMemo(() => RAW_API_URL.replace(/\/$/, ""), [RAW_API_URL]);

  const [data, setData] = useState<string>(todayIsoSP);
  const [esportes, setEsportes] = useState<EsporteBloco[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [erro, setErro] = useState<string>("");

  const [detalhe, setDetalhe] = useState<{
    hora: string;
    quadra: QuadraSlim;
    celula: Celula;
    tituloGrupo: string;
  } | null>(null);

  const carregar = useCallback(
    async (d: string) => {
      setErro("");
      setLoading(true);
      try {
        const url = `${API_URL}/disponibilidadeDia/diario`;
        const { data: resp } = await axios.get(url, {
          params: { data: d },
          withCredentials: true,
        });
        const norm = normalizeApi(resp);
        setEsportes(norm);
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
  }, [data, carregar]);

  return (
    <div className="p-4 space-y-6">
      {/* Filtro de Data */}
      <div className="bg-white p-4 shadow rounded-lg inline-flex flex-col sm:flex-row items-start sm:items-end gap-3">
        <div className="flex flex-col">
          <label className="text-sm text-gray-600 mb-1">Data</label>
          <input
            type="date"
            className="border p-2 rounded-lg"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
      </div>

      {loading && (
        <div className="text-gray-600">Carregando disponibilidade…</div>
      )}
      {erro && <div className="text-red-600">{erro}</div>}

      {!loading && !erro && (esportes?.length ?? 0) === 0 && (
        <div className="text-gray-600">Nenhum dado para este dia.</div>
      )}

      {!loading &&
        !erro &&
        (esportes ?? []).map((esp) =>
          esp.grupos.map((g) => (
            <section key={g.titulo} className="space-y-3">
              <h2 className="text-lg font-semibold text-center text-gray-800">
                {g.titulo}
              </h2>

              <div className="grid grid-cols-[64px_repeat(6,minmax(90px,1fr))] gap-2">
                <div />
                {g.quadras.map((q) => (
                  <div
                    key={q.quadraId}
                    className="text-center text-xs text-gray-700 font-medium"
                  >
                    {String(q.numero).padStart(2, "0")}
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 6 - g.quadras.length) }).map(
                  (_, i) => (
                    <div key={`emptyh-${i}`} />
                  )
                )}

                {g.horarios.map((linha) => (
                  <FragmentRow
                    key={linha.hora}
                    hora={linha.hora}
                    colunas={linha.colunas}
                    quadras={g.quadras}
                    onOpen={(idx) => {
                      const q = g.quadras[idx];
                      const cel = linha.colunas[idx];
                      setDetalhe({
                        hora: linha.hora,
                        quadra: q,
                        celula: cel,
                        tituloGrupo: g.titulo,
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}

      {detalhe && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-4 w-[320px]">
            <h3 className="text-lg font-semibold mb-2">Detalhes</h3>
            <div className="text-sm space-y-1">
              <div>
                <strong>Grupo:</strong> {detalhe.tituloGrupo}
              </div>
              <div>
                <strong>Hora:</strong> {detalhe.hora}
              </div>
              <div>
                <strong>Quadra:</strong> {detalhe.quadra.numero} —{" "}
                {detalhe.quadra.nome}
              </div>
              <div>
                <strong>Status:</strong>{" "}
                {detalhe.celula.tipoReserva ?? detalhe.celula.status}
              </div>
              {detalhe.celula.usuario?.nome && (
                <div>
                  <strong>Usuário:</strong> {detalhe.celula.usuario.nome}
                </div>
              )}
              {detalhe.celula.agendamentoId && (
                <div className="break-all">
                  <strong>Agendamento ID:</strong>{" "}
                  {detalhe.celula.agendamentoId}
                </div>
              )}
            </div>

            <button
              className="mt-4 w-full rounded-md bg-orange-600 text-white py-2 hover:bg-orange-700"
              onClick={() => setDetalhe(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
