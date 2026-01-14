"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { useLoadUser } from "@/hooks/useLoadUser";
import { useLogout } from "@/hooks/useLogout";
import AppImage from "@/components/AppImage";
import type { RefObject } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
};

type Pos = { top: number; right: number; width: number };

type AtendenteFeature =
  | "ATD_AGENDAMENTOS"
  | "ATD_PERMANENTES"
  | "ATD_CHURRAS"
  | "ATD_BLOQUEIOS"
  | "ATD_USUARIOS_LEITURA"
  | "ATD_USUARIOS_EDICAO"
  | "ATD_RELATORIOS";

type MenuItemDef = {
  href: string;
  label: string;
  icon: string;
  feature?: AtendenteFeature; // se definido, atendente precisa ter
  neverForAtendente?: boolean; // nunca aparece pra atendente
};

export default function AdminSideMenu({ open, onClose, anchorRef }: Props) {
  const { usuario } = useAuthStore();
  const logout = useLogout();
  const pathname = usePathname();
  useLoadUser();

  const isAtendente = usuario?.tipo === "ADMIN_ATENDENTE";
  const atendenteFeatures = (usuario as any)?.atendenteFeatures as AtendenteFeature[] | undefined;

  const items: MenuItemDef[] = useMemo(
    () => [
      {
        href: "/adminMaster/painelAdm",
        label: "Painel Administrativo",
        icon: "/icons/config.png",
        neverForAtendente: true,
      },
      {
        href: "/adminMaster/bloqueioQuadras",
        label: "Bloqueio de Quadras",
        icon: "/icons/bloqueio.png",
        feature: "ATD_BLOQUEIOS",
      },
      {
        href: "/adminMaster/professores",
        label: "Professores",
        icon: "/icons/icone_professores.png",
        feature: "ATD_RELATORIOS",
      },
      {
        href: "/adminMaster/logs",
        label: "Registros",
        icon: "/icons/icone_registros.png",
        neverForAtendente: true,
      },
      {
        href: "/adminMaster/usuarios/perfis",
        label: "Usuários",
        icon: "/icons/icone_usuarios.png",
        feature: "ATD_USUARIOS_LEITURA",
      },

      // ✅ sempre aparece
      { href: "/", label: "Perfil atletas", icon: "/icons/atletas.png" },
    ],
    []
  );

  // ESC para fechar
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 📍 posição do popover abaixo do botão
  const [pos, setPos] = useState<Pos>({ top: 72, right: 16, width: 310 });

  const recomputePos = () => {
    const el = anchorRef?.current;
    const vw = window.innerWidth;
    const isMobile = vw < 640;

    const width = isMobile ? Math.min(340, vw - 32) : 310;

    if (!el) {
      setPos({ top: 72, right: 16, width });
      return;
    }

    const r = el.getBoundingClientRect();
    const top = Math.round(r.bottom + 8);

    const container = el.closest("[data-admin-header-container]") as HTMLElement | null;
    const cr = container?.getBoundingClientRect();

    const PADDING = 16; // px-4

    let desiredRightEdge = r.right;
    if (cr) desiredRightEdge = cr.right - PADDING;

    let right = Math.max(12, Math.round(vw - desiredRightEdge));

    if (cr) {
      const left = vw - right - width;
      const minLeft = cr.left + PADDING;
      if (left < minLeft) {
        right = Math.max(12, Math.round(vw - (minLeft + width)));
      }
    }

    setPos({ top, right, width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recomputePos();

    const onResize = () => recomputePos();
    const onScroll = () => recomputePos();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // ✅ aplica regra por item:
  // - atendente nunca vê itens "neverForAtendente"
  // - se item tem "feature", atendente só navega se possuir a feature
  const visibleItems = items.filter((it) => {
    if (!isAtendente) return true;
    if (it.neverForAtendente) return false;
    return true;
  });

  return (
    <>
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/20 sm:bg-transparent"
      />

      <aside
        className="
          fixed z-50
          bg-white border border-gray-200
          shadow-[0_12px_30px_rgba(0,0,0,0.12)]
          rounded-md
        "
        style={{
          top: pos.top,
          right: pos.right,
          width: pos.width,
          maxHeight: "calc(100dvh - 120px)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu Admin"
      >
        <div
          className="px-3 py-3 overflow-y-auto"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        >
          <nav className="space-y-2">
            {visibleItems.map((it) => {
              const active = isActivePath(pathname, it.href);

              const needsFeature = isAtendente && !!it.feature;
              const hasFeature = !needsFeature
                ? true
                : (atendenteFeatures ?? []).includes(it.feature!);

              // ✅ se preferir ESCONDER ao invés de DESABILITAR:
              // if (isAtendente && it.feature && !hasFeature) return null;

              return hasFeature ? (
                <MenuItem
                  key={it.href}
                  href={it.href}
                  label={it.label}
                  icon={it.icon}
                  active={active}
                  onClose={onClose}
                />
              ) : (
                <MenuItemDisabled
                  key={it.href}
                  label={it.label}
                  icon={it.icon}
                  reason="Sem permissão"
                />
              );
            })}

            <MenuButton
              label="Sair"
              icon="/icons/exit.png"
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

        <div className="pb-[env(safe-area-inset-bottom)]" />
      </aside>
    </>
  );
}

function isActivePath(pathname: string, href: string) {
  if (!href || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MenuItem({
  href,
  label,
  icon,
  active,
  onClose,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={[
        "relative flex items-center gap-2 px-3 py-2 rounded-md",
        "bg-[#F4F4F4]",
        "text-[13px] font-semibold text-gray-700",
        "hover:bg-[#EFEFEF] hover:border-[#DDDDDD] transition",
        active ? "bg-[#EFEFEF] border-orange-300 text-gray-900" : "",
      ].join(" ")}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-orange-500 rounded-r" />
      )}

      <span className="w-6 flex items-center justify-center">
        <AppImage
          src={icon}
          alt={label}
          width={18}
          height={18}
          className="w-[18px] h-[18px] object-contain opacity-90"
          priority={false}
        />
      </span>

      <span className="leading-none">{label}</span>
    </Link>
  );
}

function MenuItemDisabled({
  label,
  icon,
  reason,
}: {
  label: string;
  icon: string;
  reason?: string;
}) {
  return (
    <div
      className={[
        "relative flex items-center gap-2 px-3 py-2 rounded-md",
        "bg-[#F4F4F4]",
        "text-[13px] font-semibold text-gray-400",
        "opacity-70 cursor-not-allowed",
      ].join(" ")}
      title={reason ?? "Indisponível"}
      aria-disabled="true"
    >
      <span className="w-6 flex items-center justify-center">
        <AppImage
          src={icon}
          alt={label}
          width={18}
          height={18}
          className="w-[18px] h-[18px] object-contain opacity-50"
          priority={false}
        />
      </span>

      <span className="leading-none">{label}</span>
    </div>
  );
}

function MenuButton({
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
      className={[
        "relative w-full text-left flex items-center gap-2 px-3 py-2 rounded-md",
        "bg-[#F4F4F4]",
        "text-[13px] font-semibold text-gray-700",
        "hover:bg-[#EFEFEF] hover:border-[#DDDDDD] transition cursor-pointer",
      ].join(" ")}
    >
      <span className="w-6 flex items-center justify-center">
        <AppImage
          src={icon}
          alt={label}
          width={18}
          height={18}
          className="w-[18px] h-[18px] object-contain opacity-90"
          priority={false}
        />
      </span>
      <span className="leading-none">{label}</span>
    </button>
  );
}
