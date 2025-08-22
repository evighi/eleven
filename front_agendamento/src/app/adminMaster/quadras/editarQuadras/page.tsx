'use client';

import { useEffect, useState } from "react";
import Link from "next/link";

interface Quadra {
  id: string;
  nome: string;
  numero: number;
  imagem: string | null; // pode ser URL absoluta (nova) ou nome de arquivo antigo
  tipoCamera: "COM_CAMERA" | "SEM_CAMERA";
  esportes: { id?: string; nome: string }[];
}

export default function EditarQuadras() {
  const [quadras, setQuadras] = useState<Quadra[]>([]);
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const resolveImg = (img?: string | null) => {
    if (!img) return "/quadra.png";
    if (/^https?:\/\//i.test(img)) return img;              // já é URL absoluta (R2)
    return `${API_URL}/uploads/quadras/${img}`;             // legado
  };

  useEffect(() => {
    const carregar = async () => {
      try {
        const res = await fetch(`${API_URL}/quadras`, { credentials: "include" });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error("Falha ao carregar quadras");
        const data = await res.json();
        setQuadras(data);
      } catch {
        alert("Erro ao carregar quadras");
      }
    };
    carregar();
  }, [API_URL]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Escolha uma quadra para editar:</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {quadras.map((quadra) => (
          <Link
            key={quadra.id}
            href={`/adminMaster/quadras/editarQuadras/${quadra.id}`}
            className="border rounded-xl p-4 shadow hover:shadow-lg transition cursor-pointer flex flex-col items-center bg-white"
          >
            <img
              src={resolveImg(quadra.imagem)}
              alt={quadra.nome}
              className="w-32 h-32 object-cover mb-2 rounded"
              onError={(e) => ((e.currentTarget as HTMLImageElement).src = "/quadra.png")}
            />
            <span className="text-lg font-semibold">{quadra.nome}</span>
            <span className="text-sm text-gray-500">
              Esportes: {quadra.esportes.map((e) => e.nome).join(", ")}
            </span>
            <span className="text-sm text-gray-500">Nº {quadra.numero}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
