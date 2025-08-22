"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import FooterNav from "@/components/FooterNav";

export default function ClientShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // páginas sem header/footer
  const paginasPublicas = ["/login", "/cadastro", "/esqueci-senha"];
  const isPublic = paginasPublicas.includes(pathname);

  // esconder FOOTER no admin
  const hideFooterOnPrefixes = ["/adminMaster"];
  const hideFooter = hideFooterOnPrefixes.some((p) => pathname.startsWith(p));

  if (isPublic) return <>{children}</>;

  return (
    <>
      {/* wrapper do conteúdo: reserva espaço do footer de forma invisível */}
      <div className={!hideFooter ? "min-h-screen pb-[var(--footer-safe)]" : ""}>
        {children}
      </div>

      {!hideFooter && <FooterNav />}
    </>
  );
}
