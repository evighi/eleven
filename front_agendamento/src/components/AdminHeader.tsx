"use client";

import Link from "next/link";
import Image from "next/image";
import { Bell, Menu } from "lucide-react";
import { useRef, useState } from "react";
import { useAuthStore } from "@/context/AuthStore";
import AdminSideMenu from "@/components/AdminSideMenu";

export default function AdminHeader() {
  const { usuario } = useAuthStore();
  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // ✅ Se não tem usuário, não renderiza nada
  if (!usuario) return null;

  return (
    <>
      <AdminSideMenu open={open} onClose={() => setOpen(false)} anchorRef={menuBtnRef} />

      <div className="bg-white">
        <div className="max-w-6xl mx-auto border-b border-gray-300">
          <header className="px-4 py-3 flex items-center justify-between">
            <Link href="/adminMaster" className="flex items-center">
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
              <button
                type="button"
                className="p-2 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition"
                aria-label="Notificações"
              >
                <Bell size={24} className="text-gray-600" fill="currentColor" />
              </button>

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
