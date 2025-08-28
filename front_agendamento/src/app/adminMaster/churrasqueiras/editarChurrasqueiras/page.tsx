/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppImage from "@/components/AppImage";

interface Churrasqueira {
  id: string;
  nome: string;
  numero: number;
  imagem: string | null; // pode vir como nome do arquivo (legado) ou URL absoluta (novo)
}

export default function EditarChurrasqueiras() {
  const [churrasqueiras, setChurrasqueiras] = useState<Churrasqueira[]>([]);
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/churrasqueiras`, { credentials: "include" });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error("Falha ao carregar churrasqueiras");
        const data: Churrasqueira[] = await res.json();
        setChurrasqueiras(data);
      } catch {
        alert("Erro ao carregar churrasqueiras");
      }
    })();
  }, [API_URL]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Escolha uma churrasqueira para editar:</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {churrasqueiras.map((ch) => (
          <Link
            key={ch.id}
            href={`/adminMaster/churrasqueiras/editarChurrasqueiras/${ch.id}`}
            className="border rounded-xl p-4 shadow hover:shadow-lg transition cursor-pointer flex flex-col items-center bg-white"
          >
            <div className="w-32 h-32 mb-2 rounded overflow-hidden">
              <AppImage
                src={ch.imagem ?? undefined}
                alt={ch.nome}
                width={128}
                height={128}
                className="w-full h-full object-cover"
                legacyDir="churrasqueiras"     // quando vier só o nome do arquivo
                fallbackSrc="/quadra.png"       // fallback padrão
                forceUnoptimized                 // evita passar pelo /_next/image
              />
            </div>

            <span className="text-lg font-semibold">{ch.nome}</span>
            <span className="text-sm text-gray-600">Número: {ch.numero}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
