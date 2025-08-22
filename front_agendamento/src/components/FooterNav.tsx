"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Home as HomeIcon, User } from "lucide-react";
import { useState } from "react";
import SideMenu from "./SideMenu";

export default function FooterNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const link = (active: boolean) =>
    `flex flex-col items-center justify-center transition ${active ? "text-orange-600" : "text-gray-500"
    }`;

  return (
    <>
      <SideMenu open={open} onClose={() => setOpen(false)} />

      <nav
        className="
          fixed z-40 bottom-0 left-1/2 -translate-x-1/2
          w-full max-w-sm
          rounded-t-2xl
          border-t border-black/5
          bg-[var(--app-bg)]
          shadow-[0_-6px_20px_rgba(0,0,0,0.08)]
          px-3
          min-h-[var(--footer-base)]
          pb-[env(safe-area-inset-bottom)]
          flex justify-around items-center
        "
        aria-label="Navegação inferior"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={link(false)}
          aria-label="Abrir menu"
        >
          <Menu size={26} />
        </button>

        <Link href="/" className={link(pathname === "/")}>
          <HomeIcon size={26} />
        </Link>

        <Link href="/perfil" className={link(pathname === "/perfil")}>
          <User size={26} />
        </Link>
      </nav>
    </>
  );
}
