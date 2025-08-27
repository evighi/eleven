"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/context/AuthStore";
import { useLoadUser } from "@/hooks/useLoadUser";
import { useLogout } from "@/hooks/useLogout";
import AppImage from "@/components/AppImage";

type Props = { open: boolean; onClose: () => void };

// util seguro para ler possíveis chaves de “perfil” do usuário
function readUserRole(u: unknown): string {
  if (!u || typeof u !== "object") return "";
  const obj = u as Record<string, unknown>;
  const raw = obj.tipo ?? obj.usuarioLogadoTipo ?? obj.perfil;
  return typeof raw === "string" ? raw : "";
}

// util seguro para pegar primeiro nome
function readFirstName(u: unknown): string | null {
  if (!u || typeof u !== "object") return null;
  const n = (u as Record<string, unknown>).nome;
  return typeof n === "string" ? n.split(" ")[0] : null;
}

export default function SideMenu({ open, onClose }: Props) {
  const { usuario } = useAuthStore();
  const logout = useLogout();
  useLoadUser();

  const [nomeUsuario, setNomeUsuario] = useState("Usuário");
  useEffect(() => {
    const first = readFirstName(usuario);
    if (first) setNomeUsuario(first);
  }, [usuario]);

  // identifica ADMIN_MASTER tolerando diferentes chaves (tipo / usuarioLogadoTipo / perfil)
  const isAdminMaster = useMemo(() => {
    return readUserRole(usuario).toUpperCase() === "ADMIN_MASTER";
  }, [usuario]);

  const roleLabel = isAdminMaster ? "Administrador" : "Atleta";

  // ESC para fechar
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Congela o fundo quando o menu está aberto
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
        aria-label="Menu"
      >
        {/* Header (fixo) */}
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            <h2 className="text-xl font-extrabold text-orange-600">
              Oi, {nomeUsuario} ;)
            </h2>
            <p className="text-xs text-gray-400 -mt-1">{roleLabel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="p-1 rounded-full hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* Conteúdo rolável */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-3 pb-6"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        >
          <nav className="space-y-2 mt-1">
            <Item href="/perfil" label="Perfil" icon="/icons/meuperfil.png" onClose={onClose} />
            <Item href="/agendarQuadra" label="Marcar quadra" icon="/icons/marcarquadra.png" onClose={onClose} />
            <Item href="/transferirQuadra" label="Transferir quadras" icon="/icons/transferquadra.png" onClose={onClose} />
            <Item href="/verQuadras" label="Suas quadras" icon="/icons/suasquadras.png" onClose={onClose} />
            <Item href="/reservasAnteriores" label="Ver reservas anteriores" icon="/icons/verreservasanter.png" onClose={onClose} />
            <Item href="/transferenciasAnteriores" label="Ver transferências anteriores" icon="/icons/vertransferenciasanter.png" onClose={onClose} />

            {/* item exclusivo do ADMIN_MASTER */}
            {isAdminMaster && (
              <Item
                href="/adminMaster"
                label="Ir para o perfil do administrador"
                icon="/icons/sair.png"
                onClose={onClose}
              />
            )}

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

          {/* Contatos */}
          <div className="px-1 mt-4">
            <p className="text-sm font-semibold text-orange-600 mb-2">Entre em contato ;)</p>
            <hr className="my-3 border-gray-200" />
            <div className="space-y-3 text-sm">
              <Contato numero="(53) 9935-6649" setor="Churrasqueiras/ Eventos" />
              <Contato numero="(53) 99176-2332" setor="Quadras" />
              <Contato numero="(53) 99990-8424" setor="Jogos" />
              <Contato numero="(53) 99103-2959" setor="Administrativo" />
            </div>
          </div>
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

function Contato({ numero, setor }: { numero: string; setor: string }) {
  return (
    <div>
      <p className="font-bold text-gray-800">{numero}</p>
      <p className="text-gray-500 text-[13px]">{setor}</p>
    </div>
  );
}
