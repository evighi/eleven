'use client';

import { useEffect, useState } from "react";
import AppImage from "@/components/AppImage";

interface Churrasqueira {
  id: string;
  nome: string;
  imagem?: string | null;     // pode ser URL absoluta (R2) ou nome de arquivo (legado)
  numero?: number;
  observacao?: string | null;
}

export default function ExcluirChurrasqueiras() {
  const [churrasqueiras, setChurrasqueiras] = useState<Churrasqueira[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmarId, setConfirmarId] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const resolveImg = (v?: string | null) => {
    if (!v) return "/quadra.png";
    if (/^https?:\/\//i.test(v)) return v; // já está em R2/absoluta
    return `${API_URL}/uploads/churrasqueiras/${v}`; // legado
  };

  useEffect(() => {
    fetch(`${API_URL}/churrasqueiras`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setChurrasqueiras(data))
      .catch(() => alert("Erro ao carregar churrasqueiras"));
  }, [API_URL]);

  const handleExcluir = async (id: string) => {
    setLoadingId(id);
    try {
      const res = await fetch(`${API_URL}/churrasqueiras/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          data?.erro ||
          (res.status === 400
            ? "Não foi possível excluir (talvez exista vínculo com agendamentos)."
            : "Não foi possível excluir a churrasqueira.");
        alert(`Erro: ${msg}`);
      } else {
        setChurrasqueiras((prev) => prev.filter((c) => c.id !== id));
      }
    } catch {
      alert("Erro ao excluir a churrasqueira.");
    } finally {
      setLoadingId(null);
      setConfirmarId(null);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Excluir Churrasqueira</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {churrasqueiras.map((ch) => (
          <div
            key={ch.id}
            className="border rounded-xl p-4 shadow hover:shadow-lg transition bg-white flex flex-col items-center relative"
          >
            <span className="text-lg font-semibold mb-2 text-center">{ch.nome}</span>

            <div className="relative w-full h-40 rounded mb-2 overflow-hidden">
              <AppImage
                src={resolveImg(ch.imagem)}
                alt={`Imagem da churrasqueira ${ch.nome}`}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>

            <span className="text-sm text-gray-700 mb-1">Número: {ch.numero ?? "N/A"}</span>
            <span className="text-sm text-gray-600 mb-4 text-center">
              {ch.observacao || "Sem observações"}
            </span>

            <button
              onClick={() => setConfirmarId(ch.id)}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
            >
              Excluir
            </button>

            {confirmarId === ch.id && (
              <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-10">
                <p className="text-center mb-4">
                  Tem certeza que deseja excluir<strong> {ch.nome}</strong>?
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleExcluir(ch.id)}
                    disabled={loadingId === ch.id}
                    className="bg-red-600 text-white px-4 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                  >
                    {loadingId === ch.id ? "Excluindo..." : "Sim"}
                  </button>
                  <button
                    onClick={() => setConfirmarId(null)}
                    className="bg-gray-300 text-black px-4 py-1 rounded hover:bg-gray-400 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
