'use client';

import { useEffect, useState } from "react";

interface Esporte {
  id: string;
  nome: string;
  imagem: string | null; // agora já é URL absoluta (ou null)
}

export default function ExcluirEsportes() {
  const [esportes, setEsportes] = useState<Esporte[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmarId, setConfirmarId] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  useEffect(() => {
    fetch(`${API_URL}/esportes`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setEsportes(data))
      .catch(() => alert("Erro ao carregar esportes"));
  }, [API_URL]);

  const handleExcluir = async (id: string) => {
    setLoadingId(id);
    try {
      const res = await fetch(`${API_URL}/esportes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(`Erro: ${data.erro || "Não foi possível excluir."}`);
      } else {
        setEsportes((prev) => prev.filter((e) => e.id !== id));
      }
    } catch {
      alert("Erro ao excluir o esporte.");
    } finally {
      setLoadingId(null);
      setConfirmarId(null);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Excluir Esporte</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {esportes.map((esporte) => (
          <div
            key={esporte.id}
            className="border rounded-xl p-4 shadow hover:shadow-lg transition bg-white flex flex-col items-center relative"
          >
            <img
              src={esporte.imagem ?? "/esporte.png"}
              alt={esporte.nome}
              className="w-32 h-32 object-cover mb-2 rounded"
              onError={(e) => ((e.currentTarget as HTMLImageElement).src = "/esporte.png")}
            />

            <span className="text-lg font-semibold mb-2">{esporte.nome}</span>

            <button
              onClick={() => setConfirmarId(esporte.id)}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
            >
              Excluir
            </button>

            {confirmarId === esporte.id && (
              <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-10">
                <p className="text-center mb-4">
                  Tem certeza que deseja excluir?
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleExcluir(esporte.id)}
                    disabled={loadingId === esporte.id}
                    className="bg-red-600 text-white px-4 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                  >
                    {loadingId === esporte.id ? "Excluindo..." : "Sim"}
                  </button>
                  <button
                    onClick={() => setConfirmarId(null)}
                    className="bg-gray-300 text-black px-4 py-1 rounded hover:bg-gray-400 transition"
                  >
                    Cancelar
                  </button>
                </div>

                <p className="mt-3 text-xs text-gray-500">
                  Obs.: não é possível excluir se houver quadras associadas a este esporte.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
