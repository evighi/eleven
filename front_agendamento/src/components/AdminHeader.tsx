"use client";

import Link from "next/link";
import Image from "next/image";
import { Menu, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { useLoadUser } from "@/hooks/useLoadUser";
import AdminSideMenu from "@/components/AdminSideMenu";

export default function AdminHeader() {
  useLoadUser();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { usuario, carregandoUser } = useAuthStore();
  const router = useRouter();

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!carregandoUser && !usuario) router.push("/login");
    else if (!carregandoUser && usuario?.tipo !== "ADMIN_MASTER") router.push("/");
  }, [usuario, carregandoUser, router]);

  if (!usuario || usuario.tipo !== "ADMIN_MASTER") {
    return <div className="flex justify-center items-center h-screen">Carregando...</div>;
  }

  const opcoes = [
    { nome: "Perfil de Usuários", url: "/adminMaster/usuarios", imagem: "/icons/perfis.png" },
    { nome: "Professores", url: "/adminMaster/professores", imagem: "/icons/perfis.png" },
    { nome: "Esportes", url: "/adminMaster/esportes", imagem: "/icons/editar.png" },
    { nome: "Quadras", url: "/adminMaster/quadras", imagem: "/icons/editar.png" },
    { nome: "Churrasqueiras", url: "/adminMaster/churrasqueiras", imagem: "/icons/editar.png" },
    { nome: "Registros", url: "/adminMaster/logs", imagem: "/icons/editar.png" },
    { nome: "Bloqueio de Quadras", url: "/adminMaster/bloqueioQuadras", imagem: "/icons/bloq.png" },
    { nome: "Configurar Valor da Multa", url: "/adminMaster/configMulta", imagem: "/icons/editar.png" },
  ];

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = dir === "left" ? -200 : 200;
    scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
  };

  return (
    <>
      {/* Drawer */}
      <AdminSideMenu open={open} onClose={() => setOpen(false)} />

      {/* HEADER */}
      <header className="bg-gray-300 text-gray-800 p-4 flex items-center justify-between shadow">
        <Link href="/adminMaster" aria-label="Ir para o painel Admin Master" className="flex items-center">
          <Image
            src="/logoelevenhor.png"
            alt="Logo da Eleven"
            width={160}
            height={48}
            priority
            className="w-auto h-12"
          />
        </Link>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setOpen(true)}
            className="bg-gray-300 p-2 rounded hover:bg-gray-400 transition cursor-pointer"
            aria-label="Abrir menu"
          >
            <Menu size={24} />
          </button>
        </div>
      </header>

      {/* CARROSSEL CENTRALIZADO */}
      <div className="relative bg-gray-50 p-3 shadow flex items-center justify-center">
        <button
          onClick={() => scroll("left")}
          className="absolute left-2 z-10 bg-white p-2 rounded-full shadow-md hover:bg-gray-100 transition hidden sm:flex"
          aria-label="Rolar para a esquerda"
        >
          <ChevronLeft size={20} />
        </button>

        <div
          ref={scrollRef}
          className="flex overflow-x-auto gap-6 px-8 scrollbar-hide scroll-smooth snap-x snap-mandatory"
          style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
        >
          {opcoes.map(({ nome, url, imagem }) => (
            <Link
              key={nome}
              href={url}
              className="flex flex-col items-center min-w-[80px] text-gray-700 hover:text-orange-600 transition snap-start"
            >
              <div className="w-14 h-14 flex items-center justify-center bg-white rounded-full shadow-md">
                <Image
                  src={imagem}
                  alt={nome}
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <span className="text-xs mt-2 text-center">{nome}</span>
            </Link>
          ))}
        </div>

        <button
          onClick={() => scroll("right")}
          className="absolute right-2 z-10 bg-white p-2 rounded-full shadow-md hover:bg-gray-100 transition hidden sm:flex"
          aria-label="Rolar para a direita"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </>
  );
}
