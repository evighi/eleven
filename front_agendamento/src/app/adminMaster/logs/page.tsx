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
  detailLines,
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
  const [erro, setErro] = useState<string>("");

  // modal de detalhes
  const [selecionado, setSelecionado] = useState<AuditItem | null>(null);

  async function fetchLogs(p = 1) {
    setLoading(true);
    setErro("");
    try {
      const { data: json } = await axios.get<ApiResponse>(`${API_URL}/audit/logs`, {
        params: { page: p, size: 50 },
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
      setData({ page: 1, size: 50, total: 0, items: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total || 0) / (data?.size || 50))),
    [data]
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Logs de Auditoria</h1>
        <button
          onClick={() => fetchLogs(page)}
          disabled={loading}
          className="px-3 py-1 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
          title="Atualizar"
        >
          {loading ? "Atualizando…" : "Atualizar"}
        </button>
      </div>

      {erro && <div className="text-sm text-red-600">{erro}</div>}

      {/* Loading inicial */}
      {loading && !data && (
        <div className="flex items-center gap-2 text-gray-700">
          <Spinner /> <span>Carregando logs…</span>
        </div>
      )}

      {/* Tabela */}
      {data && (
        <div className="rounded border overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Quando</th>
                <th className="text-left p-2">Evento</th>
                <th className="text-left p-2">Quem fez</th>
                <th className="text-left p-2">Alvo</th>
                <th className="text-left p-2">Dono do Alvo</th>
                <th className="text-left p-2">Resumo</th>
              </tr>
            </thead>
            <tbody>
              {loading && data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3">
                    <div className="flex items-center gap-2 text-gray-700">
                      <Spinner /> <span>Carregando…</span>
                    </div>
                  </td>
                </tr>
              )}

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
                  className="border-t hover:bg-orange-50 cursor-pointer"
                  onClick={() => setSelecionado(it)}
                  title="Ver detalhes"
                >
                  <td className="p-2 whitespace-nowrap">
                    {new Date(it.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{eventLabel(it.event)}</div>
                    <div className="text-gray-500">
                      {targetTypeLabel(it.targetType)}
                    </div>
                  </td>
                  <td className="p-2">{actorDisplay(it)}</td>
                  <td className="p-2">{targetDisplay(it)}</td>
                  <td className="p-2">{ownerDisplay(it)}</td>
                  <td className="p-2">{resumoHumano(it)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação simples com melhor UX */}
      {data && data.total > 0 && (
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded border disabled:opacity-50"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>

          <span>
            Página {data.page} / {totalPages}
          </span>

          <button
            className="px-3 py-1 rounded border disabled:opacity-50"
            disabled={data.page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>

          {loading && (
            <span className="inline-flex items-center gap-2 text-gray-600 ml-2">
              <Spinner /> trocando de página…
            </span>
          )}
        </div>
      )}

      {/* MODAL DE DETALHES — linguagem simples */}
      {selecionado && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3">
          <div className="bg-white rounded-lg shadow-lg w-[95%] max-w-2xl p-5 relative">
            <button
              className="absolute right-3 top-3 text-gray-500 hover:text-gray-800 text-xl"
              onClick={() => setSelecionado(null)}
              aria-label="Fechar"
            >
              ×
            </button>

            <h2 className="text-lg font-semibold mb-2">
              {eventLabel(selecionado.event)}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              {new Date(selecionado.createdAt).toLocaleString("pt-BR")}
            </p>

            {/* Título + bullets descritivos */}
            <div className="space-y-3">
              {(() => {
                const [titulo, bullets] = fullSentence(selecionado);
                return (
                  <>
                    <p className="text-base">{titulo}</p>
                    {bullets.length > 0 && (
                      <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
                        {bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Bloco técnico opcional (p/ admin avançado) */}
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
                <div>
                  <span className="text-gray-500">Alvo:</span>{" "}
                  <span className="font-medium">{targetDisplay(selecionado)}</span>
                </div>
                <div>
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
                  <div className="sm:col-span-2">
                    <span className="text-gray-500">Navegador:</span>{" "}
                    <span className="font-medium">{selecionado.userAgent}</span>
                  </div>
                )}
              </div>

              {/* Metadata bruta (legível) */}
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
