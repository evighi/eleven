"use client";

import Link from "next/link";
import Image from "next/image";
import { Menu, ChevronLeft, ChevronRight, Bell } from "lucide-react";
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
    { nome: "Quadras", url: "/adminMaster/quadras", imagem: "/icons/icon_quadras.png" },
    { nome: "Esportes", url: "/adminMaster/esportes", imagem: "/icons/icone_esportes.png" },
    { nome: "Churrasqueiras", url: "/adminMaster/churrasqueiras", imagem: "/icons/icone_churrasqueiras.png" },
    { nome: "Registros", url: "/adminMaster/logs", imagem: "/icons/icone_registros.png" },
    { nome: "Bloqueio de Quadras", url: "/adminMaster/bloqueioQuadras", imagem: "/icons/icone_bloqueio.png" },
    { nome: "Usuários", url: "/adminMaster/usuarios", imagem: "/icons/icone_usuarios.png" },
    { nome: "Professores", url: "/adminMaster/professores", imagem: "/icons/icone_professores.png" },
    // se depois tiver "Patrocinadores", é só adicionar aqui no mesmo padrão
  ];

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = dir === "left" ? -220 : 220;
    scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
  };

  return (
    <>
      {/* Drawer lateral */}
      <AdminSideMenu open={open} onClose={() => setOpen(false)} />

      {/* HEADER SUPERIOR */}
      <header className="bg-white text-gray-800 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <Link
          href="/adminMaster"
          aria-label="Ir para o painel Admin Master"
          className="flex items-center"
        >
          <Image
            src="/logoelevenhor.png"
            alt="Logo da Eleven"
            width={160}
            height={48}
            priority
            className="w-auto h-10"
          />
        </Link>

        <div className="flex items-center gap-3">
          {/* sino de notificações, só visual por enquanto */}
          <button
            type="button"
            className="p-2 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
            aria-label="Notificações"
          >
            <Bell size={20} />
          </button>

          {/* menu hamburguer */}
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
            aria-label="Abrir menu"
          >
            <Menu size={22} />
          </button>
        </div>
      </header>

      {/* FAIXA DOS BOTÕES (tipo “pills”) */}
      <div className="relative bg-[#f4f4f5] border-b border-gray-200 py-2">
        {/* setas de navegação (somem no mobile) */}
        <button
          onClick={() => scroll("left")}
          className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition"
          aria-label="Rolar para a esquerda"
        >
          <ChevronLeft size={18} />
        </button>

        <div
          ref={scrollRef}
          className="flex items-center gap-3 px-4 sm:px-10 overflow-x-auto scrollbar-hide scroll-smooth"
          style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
        >
          {opcoes.map(({ nome, url, imagem }) => (
            <Link
              key={nome}
              href={url}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-white border border-gray-300 shadow-sm text-xs sm:text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900 transition whitespace-nowrap"
            >
              <Image
                src={imagem}
                alt={nome}
                width={18}
                height={18}
                className="w-[18px] h-[18px] object-contain"
              />
              <span className="font-medium">{nome}</span>
            </Link>
          ))}
        </div>

        <button
          onClick={() => scroll("right")}
          className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-md bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition"
          aria-label="Rolar para a direita"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </>
  );
}
