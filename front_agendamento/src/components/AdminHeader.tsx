"use client";

import Link from "next/link";
import Image from "next/image";
import { Bell, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { useLoadUser } from "@/hooks/useLoadUser";
import AdminSideMenu from "@/components/AdminSideMenu";

export default function AdminHeader() {
  useLoadUser();
  const { usuario, carregandoUser } = useAuthStore();
  const router = useRouter();

  const [open, setOpen] = useState(false);

  // 👇 ref do botão do hamburger, para o menu abrir exatamente embaixo dele
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!carregandoUser && !usuario) router.push("/login");
    else if (!carregandoUser && usuario?.tipo !== "ADMIN_MASTER") router.push("/");
  }, [usuario, carregandoUser, router]);

  if (!usuario || usuario.tipo !== "ADMIN_MASTER") {
    return <div className="flex justify-center items-center h-screen">Carregando...</div>;
  }

  return (
    <>
      <AdminSideMenu open={open} onClose={() => setOpen(false)} anchorRef={menuBtnRef} />

      {/* Fundo ocupa a tela toda */}
      <div className="bg-white">
        {/* ✅ linha/borda limitada ao max-w-6xl */}
        <div className="max-w-6xl mx-auto border-b border-gray-300">
          <header className="px-4 py-3 flex items-center justify-between">
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

            <div className="flex items-center gap-2">
              {/* 🔔 Notificações (sem função, só visual) */}
              <button
                type="button"
                className="p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition"
                aria-label="Notificações"
              >
                <Bell size={24} className="text-gray-600" fill="currentColor" />
              </button>

              {/* ☰ Menu */}
              <button
                ref={menuBtnRef}
                onClick={() => setOpen((v) => !v)}
                className="p-2 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer"
                aria-label="Abrir menu"
              >
                <Menu size={34} />
              </button>
            </div>
          </header>
        </div>
      </div>
    </>
  );
}
