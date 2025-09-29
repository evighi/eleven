"use client";

// src/app/adminMaster/logs/page.tsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import {
  actorDisplay,
  eventLabel,
  targetTypeLabel,
  targetDisplay,
  ownerDisplay,
  resumoHumano,
  fullSentence,
  type AuditItem,
} from "../../../utils/auditUi";

type ApiResponse = {
  page: number;
  size: number;
  total: number;
  items: AuditItem[];
};

export default function LogsPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(300); // padrão 300
  const [goto, setGoto] = useState<string>("");
  const [erro, setErro] = useState<string>("");

  // modal de detalhes
  const [selecionado, setSelecionado] = useState<AuditItem | null>(null);

  async function fetchLogs(p = 1, size = pageSize) {
    setLoading(true);
    setErro("");
    try {
      const { data: json } = await axios.get<ApiResponse>(`${API_URL}/audit/logs`, {
        params: { page: p, size },
        withCredentials: true,
      });
      setData(json);
    } catch (e: any) {
      console.error("Falha ao carregar logs:", e);
      const msg =
        e?.response?.data?.erro ||
        e?.response?.data?.message ||
        "Erro ao carregar os logs.";
      setErro(String(msg));
      setData({ page: 1, size, total: 0, items: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total || 0) / (data?.size || pageSize))),
    [data?.total, data?.size, pageSize]
  );

  const jumpPages = (delta: number) => {
    setPage((p) => Math.min(totalPages, Math.max(1, p + delta)));
  };

  const onGoto = () => {
    const n = parseInt(goto, 10);
    if (Number.isFinite(n)) setPage(Math.min(totalPages, Math.max(1, n)));
  };

  const fmtPtBR = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return (
    <div className="p-4 space-y-4">
      {/* Top bar + controles - empilha no mobile */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Logs de Auditoria</h1>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600">Qntd de Registros por página:</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={pageSize}
            onChange={(e) => {
              const sz = parseInt(e.target.value, 10);
              setPageSize(sz);
              setPage(1);
            }}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={300}>300</option>
          </select>

          <button
            onClick={() => fetchLogs(page, pageSize)}
            disabled={loading}
            className="px-3 py-1 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
            title="Atualizar"
          >
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </div>

      {erro && <div className="text-sm text-red-600">{erro}</div>}

      {/* Loading inicial */}
      {loading && !data && (
        <div className="flex items-center gap-2 text-gray-700">
          <Spinner /> <span>Carregando logs…</span>
        </div>
      )}

      {/* ===== Mobile (cards) ===== */}
      {data && (
        <div className="space-y-2 md:hidden">
          {data.items.length === 0 && !loading && (
            <div className="text-gray-600">Nenhum log encontrado.</div>
          )}

          {data.items.map((it) => {
            const [titulo] = fullSentence(it);
            return (
              <button
                key={it.id}
                className="w-full text-left bg-white border rounded-lg p-3 shadow-sm active:scale-[0.99]"
                onClick={() => setSelecionado(it)}
                title="Ver detalhes"
              >
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">{fmtPtBR(it.createdAt)}</div>
                  <div className="font-medium text-sm leading-snug break-words">
                    {eventLabel(it.event)}
                  </div>
                  <div className="text-xs text-gray-500">{targetTypeLabel(it.targetType)}</div>
                </div>

                <div className="mt-2 text-sm">
                  <div className="text-gray-900 line-clamp-3">{titulo}</div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div className="truncate"><span className="text-gray-500">Quem: </span>{actorDisplay(it)}</div>
                    <div className="truncate"><span className="text-gray-500">Dono: </span>{ownerDisplay(it)}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ===== Desktop (tabela sem rolagem horizontal; quebra de linha automática) ===== */}
      {data && (
        <div className="rounded border relative hidden md:block">
          {loading && (
            <div className="absolute inset-x-0 top-0 bg-white/70 backdrop-blur-sm py-1 flex items-center justify-center border-b z-10">
              <span className="inline-flex items-center gap-2 text-gray-700 text-sm">
                <Spinner /> carregando…
              </span>
            </div>
          )}

          <table className="w-full table-auto text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left p-2 align-top">Quando</th>
                <th className="text-left p-2 align-top">Evento</th>
                <th className="text-left p-2 align-top">Quem fez</th>
                <th className="text-left p-2 align-top">Alvo</th>
                <th className="text-left p-2 align-top">Dono do Alvo</th>
                <th className="text-left p-2 align-top">Resumo</th>
              </tr>
            </thead>
            <tbody>
              {!loading && data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3 text-gray-600">
                    Nenhum log encontrado.
                  </td>
                </tr>
              )}

              {data.items.map((it) => (
                <tr
                  key={it.id}
                  className="border-t hover:bg-orange-50 cursor-pointer align-top"
                  onClick={() => setSelecionado(it)}
                  title="Ver detalhes"
                >
                  {/* Quando: mantém sem quebra pra data/hora */}
                  <td className="p-2 whitespace-nowrap align-top">{fmtPtBR(it.createdAt)}</td>

                  {/* Demais colunas: permitem quebra e crescer em altura */}
                  <td className="p-2 whitespace-normal break-words align-top">
                    <div className="font-medium">{eventLabel(it.event)}</div>
                    <div className="text-gray-500">{targetTypeLabel(it.targetType)}</div>
                  </td>
                  <td className="p-2 whitespace-normal break-words align-top">
                    {actorDisplay(it)}
                  </td>
                  <td className="p-2 whitespace-normal break-words align-top">
                    {targetDisplay(it)}
                  </td>
                  <td className="p-2 whitespace-normal break-words align-top">
                    {ownerDisplay(it)}
                  </td>
                  <td className="p-2 whitespace-normal break-words align-top">
                    {resumoHumano(it)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação responsiva */}
      {data && data.total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage(1)}
              title="Primeira"
            >
              «
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => jumpPages(-5)}
              title="-5 páginas"
            >
              « −5
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              title="Anterior"
            >
              Anterior
            </button>
          </div>

          <span className="text-sm">
            Página {data.page} / {totalPages}
          </span>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={data.page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              title="Próxima"
            >
              Próxima
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={data.page >= totalPages || loading}
              onClick={() => jumpPages(+5)}
              title="+5 páginas"
            >
              +5 »
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={data.page >= totalPages || loading}
              onClick={() => setPage(totalPages)}
              title="Última"
            >
              »
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Ir para:</label>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={goto}
              onChange={(e) => setGoto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onGoto();
              }}
              className="w-24 border rounded px-2 py-1 text-sm"
            />
            <button
              onClick={onGoto}
              disabled={loading || !goto}
              className="px-3 py-1 rounded border"
            >
              Ir
            </button>
          </div>

          {loading && (
            <span className="inline-flex items-center gap-2 text-gray-600">
              <Spinner /> trocando de página…
            </span>
          )}
        </div>
      )}

      {/* MODAL — full-screen no mobile */}
      {selecionado && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-0 md:p-3">
          <div className="bg-white rounded-none md:rounded-lg shadow-lg w-full h-full md:h-auto md:max-w-2xl md:p-5 p-4 overflow-y-auto relative">
            <button
              className="absolute right-3 top-3 text-gray-500 hover:text-gray-800 text-2xl"
              onClick={() => setSelecionado(null)}
              aria-label="Fechar"
            >
              ×
            </button>

            <h2 className="text-lg font-semibold mb-1">
              {eventLabel(selecionado.event)}
            </h2>
            <p className="text-xs md:text-sm text-gray-600 mb-3">
              {fmtPtBR(selecionado.createdAt)}
            </p>

            <div className="space-y-3">
              {(() => {
                const [titulo, bullets] = fullSentence(selecionado);
                return (
                  <>
                    <p className="text-base leading-relaxed">{titulo}</p>
                    {bullets.length > 0 && (
                      <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
                        {bullets.map((b, i) => (
                          <li key={i} className="break-words">{b}</li>
                        ))}
                      </ul>
                    )}
                  </>
                );
              })()}
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-600">
                Ver detalhes técnicos
              </summary>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-gray-500">Quem fez:</span>{" "}
                  <span className="font-medium">{actorDisplay(selecionado)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Tipo de alvo:</span>{" "}
                  <span className="font-medium">
                    {targetTypeLabel(selecionado.targetType)}
                  </span>
                </div>
                <div className="break-words">
                  <span className="text-gray-500">Alvo:</span>{" "}
                  <span className="font-medium">{targetDisplay(selecionado)}</span>
                </div>
                <div className="break-words">
                  <span className="text-gray-500">Dono do alvo:</span>{" "}
                  <span className="font-medium">{ownerDisplay(selecionado)}</span>
                </div>
                {selecionado.ip && (
                  <div>
                    <span className="text-gray-500">IP:</span>{" "}
                    <span className="font-medium">{selecionado.ip}</span>
                  </div>
                )}
                {selecionado.userAgent && (
                  <div className="sm:col-span-2 break-words">
                    <span className="text-gray-500">Navegador:</span>{" "}
                    <span className="font-medium">{selecionado.userAgent}</span>
                  </div>
                )}
              </div>

              {selecionado.metadata && (
                <pre className="mt-3 p-2 bg-gray-50 rounded border overflow-auto text-xs">
                  {JSON.stringify(selecionado.metadata, null, 2)}
                </pre>
              )}
            </details>

            <div className="mt-5 flex justify-end">
              <button
                className="px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
                onClick={() => setSelecionado(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
