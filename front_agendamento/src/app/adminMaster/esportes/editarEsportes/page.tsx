'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import AppImage from "@/components/AppImage";

interface Esporte {
  id: string;
  nome: string;
  imagem: string | null; // URL absoluta (ou null)
}

export default function EditarEsportes() {
  const [esportes, setEsportes] = useState<Esporte[]>([]);
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  useEffect(() => {
    fetch(`${API_URL}/esportes`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setEsportes(data))
      .catch(() => alert("Erro ao carregar esportes"));
  }, [API_URL]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Escolha um esporte para editar:</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {esportes.map((esporte) => (
          <Link
            key={esporte.id}
            href={`/adminMaster/esportes/editarEsportes/${esporte.id}`}
            className="border rounded-xl p-4 shadow hover:shadow-lg transition cursor-pointer flex flex-col items-center bg-white"
          >
            <AppImage
              src={esporte.imagem || "/esporte.png"}
              alt={esporte.nome}
              width={128}
              height={128}
              className="w-32 h-32 object-cover mb-2 rounded"
              fallbackSrc="/esporte.png"
            />
            <span className="text-lg font-semibold">{esporte.nome}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
