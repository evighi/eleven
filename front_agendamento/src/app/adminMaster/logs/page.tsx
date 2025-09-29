"use client";

// src/app/adminMaster/logs/page.tsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  actorDisplay,
  eventLabel,
  targetTypeLabel,
  targetDisplay,
  ownerDisplay,
  resumoHumano,
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

  if (loading && !data) return <div>Carregando logs…</div>;
  if (!data || data.items.length === 0)
    return (
      <div className="p-4">
        <h1 className="text-xl font-semibold mb-2">Logs de Auditoria</h1>
        {erro ? (
          <div className="text-sm text-red-600">{erro}</div>
        ) : (
          <div>Nenhum log encontrado.</div>
        )}
      </div>
    );

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Logs de Auditoria</h1>
      {erro && <div className="text-sm text-red-600">{erro}</div>}

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
            {data.items.map((it) => (
              <tr key={it.id} className="border-t">
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

      {/* Paginação simples */}
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1 rounded border disabled:opacity-50"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Anterior
        </button>
        <span>
          Página {data.page} / {Math.max(1, Math.ceil(data.total / data.size))}
        </span>
        <button
          className="px-3 py-1 rounded border disabled:opacity-50"
          disabled={data.page * data.size >= data.total || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
