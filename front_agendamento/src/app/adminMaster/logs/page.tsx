"use client";

// src/app/adminMaster/logs/page.tsx
import React, { useEffect, useState } from "react";
import {
  actorDisplay,
  eventLabel,
  targetTypeLabel,
  targetDisplay,
  ownerDisplay,
  resumoHumano,
  type AuditItem,
} from "../../../utils/auditUi"; // <- caminho corrigido

type ApiResponse = {
  page: number;
  size: number;
  total: number;
  items: AuditItem[];
};

export default function LogsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  async function fetchLogs(p = 1) {
    setLoading(true);
    try {
      const res = await fetch(`/audit/logs?page=${p}&size=50`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const json: ApiResponse = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs(page);
  }, [page]);

  if (loading && !data) return <div>Carregando logs…</div>;
  if (!data) return <div>Nenhum log encontrado.</div>;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Logs de Auditoria</h1>

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
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Anterior
        </button>
        <span>
          Página {data.page} / {Math.max(1, Math.ceil(data.total / data.size))}
        </span>
        <button
          className="px-3 py-1 rounded border disabled:opacity-50"
          disabled={data.page * data.size >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
