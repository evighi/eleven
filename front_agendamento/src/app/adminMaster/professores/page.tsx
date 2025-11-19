"use client";
import Link from "next/link";
import AppImage from "@/components/AppImage";

export default function EsportesHome() {
  const opcoes = [
    { nome: "Quadro dos professores", url: "/adminMaster/professores/quadroProfessores", imagem: "/icons/editar.png" },
    { nome: "Configurar Valor da Multa", url: "/adminMaster/professores/configMulta", imagem: "/icons/editar.png"  },
  ];

  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-medium text-center mb-10 text-orange-700">Administrar Professores</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {opcoes.map(({ nome, url, imagem }) => (
          <Link
            key={nome}
            href={url}
            className="bg-gray-200 rounded-xl p-4 flex flex-col items-center justify-center hover:bg-gray-300 transition text-gray-700"
          >
            <AppImage
              src={imagem}
              alt={nome}
              width={32}
              height={32}
              className="mb-2"
              fallbackSrc="/icons/editar.png"
            />
            <span className="text-sm text-center">{nome}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
