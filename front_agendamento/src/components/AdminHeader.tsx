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
    {
      nome: "Churrasqueiras",
      url: "/adminMaster/churrasqueiras",
      imagem: "/icons/icone_churrasqueiras.png",
    },
    { nome: "Registros", url: "/adminMaster/logs", imagem: "/icons/icone_registros.png" },
    {
      nome: "Bloqueio de Quadras",
      url: "/adminMaster/bloqueioQuadras",
      imagem: "/icons/icone_bloqueio.png",
    },
    { nome: "Usuários", url: "/adminMaster/usuarios", imagem: "/icons/icone_usuarios.png" },
    {
      nome: "Professores",
      url: "/adminMaster/professores",
      imagem: "/icons/icone_professores.png",
    },
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

      {/* BLOCO DO HEADER (logo + botões) CENTRALIZADO */}
      <div className="border-b border-gray-200">
        <div className="max-w-6xl mx-auto bg-white">
          {/* HEADER SUPERIOR */}
          <header className="text-gray-800 px-4 py-3 flex items-center justify-between">
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
              <button
                type="button"
                className="p-2 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
                aria-label="Notificações"
              >
                <Bell size={20} />
              </button>

              <button
                onClick={() => setOpen(true)}
                className="p-2 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                aria-label="Abrir menu"
              >
                <Menu size={22} />
              </button>
            </div>
          </header>

          {/* FAIXA DOS BOTÕES */}
          <div className="relative py-2">
            {/* setas fixas nos cantos (desktop) */}
            <button
              onClick={() => scroll("left")}
              className="
                hidden sm:flex
                absolute left-4 top-1/2 -translate-y-1/2 z-10
                p-1
                bg-transparent
                text-gray-700
                hover:text-gray-500
                transition
              "
              aria-label="Rolar para a esquerda"
            >
              <ChevronLeft size={24} />
            </button>

            <button
              onClick={() => scroll("right")}
              className="
                hidden sm:flex
                absolute right-4 top-1/2 -translate-y-1/2 z-10
                p-1
                bg-transparent
                text-gray-700
                hover:text-gray-500
                transition
              "
              aria-label="Rolar para a direita"
            >
              <ChevronRight size={24} />
            </button>

            {/* container dos botões */}
            <div className="px-2 sm:px-8">
              <div
                ref={scrollRef}
                className="
                  mx-auto 
                  flex 
                  items-center 
                  justify-start sm:justify-center 
                  gap-2 sm:gap-3 
                  overflow-x-auto 
                  scrollbar-hide 
                  scroll-smooth 
                  min-w-0
                "
                style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
              >
                {opcoes.map(({ nome, url, imagem }) => (
                  <Link
                    key={nome}
                    href={url}
                    className="
                      shrink-0
                      inline-flex items-center 
                      px-4 py-3
                      rounded-md 
                      bg-white 
                      border border-[#AFAFAF]
                      text-xs sm:text-sm 
                      text-gray-700 
                      shadow-[0_4px_8px_rgba(0,0,0,0.1)]
                      hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900 
                      transition 
                      whitespace-nowrap
                    "
                  >
                    <span className="inline-flex items-center gap-2">
                      <Image
                        src={imagem}
                        alt={nome}
                        width={20}
                        height={20}
                        className="w-5 h-5 object-contain"
                      />
                      <span className="font-medium">{nome}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
