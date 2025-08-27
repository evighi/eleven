"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect } from "react";
import { useAuthStore } from "@/context/AuthStore";
import { useLoadUser } from "@/hooks/useLoadUser";
import { useLogout } from "@/hooks/useLogout";
import AppImage from "@/components/AppImage";

type Props = { open: boolean; onClose: () => void };

export default function AdminSideMenu({ open, onClose }: Props) {
  const { usuario } = useAuthStore();
  const logout = useLogout();
  useLoadUser();

  const nome = usuario?.nome ? usuario.nome.split(" ")[0] : "Admin";

  // ESC para fechar
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 🔒 Congela o fundo quando o menu está aberto
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const body = document.body;

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 z-50 h-dvh max-h-[100dvh] bg-white shadow-2xl rounded-r-2xl
          w-3/5 max-w-xs sm:max-w-sm transition-transform duration-300 ease-out
          flex flex-col
          ${open ? "translate-x-0" : "-translate-x-full"}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu Admin"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            <h2 className="text-xl font-extrabold text-orange-600">Oi, {nome} ;)</h2>
            <p className="text-xs text-gray-400 -mt-1">Admin Master</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="Fechar menu">
            <X size={20} />
          </button>
        </div>

        {/* Conteúdo rolável */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-3 pb-6"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        >
          <nav className="space-y-2 mt-1">
            <Item href="/adminMaster/usuarios" label="Perfil de Usuários" icon="/icons/perfis.png" onClose={onClose} />
            <Item href="/adminMaster/esportes" label="Esportes" icon="/icons/editar.png" onClose={onClose} />
            <Item href="/adminMaster/quadras" label="Quadras" icon="/icons/editar.png" onClose={onClose} />
            <Item href="/adminMaster/churrasqueiras" label="Churrasqueiras" icon="/icons/editar.png" onClose={onClose} />
            <Item href="/adminMaster/bloqueioQuadras" label="Bloqueio de Quadras" icon="/icons/bloq.png" onClose={onClose} />

            {/* ⇩ novo botão para ir ao perfil do cliente */}
            <Item
              href="/"
              label="Ir para o perfil do cliente"
              icon="/icons/sair.png"
              onClose={onClose}
            />

            {/* Sair */}
            <ItemButton
              label="Sair"
              icon="/icons/sair.png"
              onClick={async () => {
                try {
                  await logout();
                } finally {
                  onClose();
                }
              }}
            />
          </nav>
        </div>

        {/* safe-area iOS */}
        <div className="pb-[env(safe-area-inset-bottom)]" />
      </aside>
    </>
  );
}

function Item({
  href,
  label,
  icon,
  onClose,
}: {
  href: string;
  label: string;
  icon: string;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="flex items-center gap-3 rounded-xl bg-gray-100 hover:bg-gray-200 transition px-3 py-3"
    >
      <AppImage
        src={icon}
        alt={label}
        width={20}
        height={20}
        className="w-5 h-5 object-contain"
        priority={false}
      />
      <span className="text-[14px] font-medium text-gray-800">{label}</span>
    </Link>
  );
}

function ItemButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 rounded-xl bg-gray-100 hover:bg-gray-200 transition px-3 py-3 cursor-pointer"
    >
      <AppImage
        src={icon}
        alt={label}
        width={20}
        height={20}
        className="w-5 h-5 object-contain"
        priority={false}
      />
      <span className="text-[14px] font-medium text-gray-800">{label}</span>
    </button>
  );
}
