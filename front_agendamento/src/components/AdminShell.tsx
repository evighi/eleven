// components/AdminGuard.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore, TipoUsuario } from "@/context/AuthStore";
import { useLoadUser } from "@/hooks/useLoadUser";

const DEFAULT_ALLOWED: TipoUsuario[] = [
  "ADMIN_MASTER",
  "ADMIN_ATENDENTE",
  "ADMIN_PROFESSORES",
];

export default function AdminGuard({
  children,
  allowed = DEFAULT_ALLOWED,
  loadingFallback = <div className="p-6 max-w-6xl mx-auto text-gray-600">Carregando…</div>,
}: {
  children: ReactNode;
  allowed?: TipoUsuario[];
  loadingFallback?: ReactNode;
}) {
  // 🚀 O PRÓPRIO GUARD dispara o carregamento do /usuarios/me
  useLoadUser();

  const router = useRouter();
  const pathname = usePathname();
  const { usuario, carregandoUser } = useAuthStore();

  // Evita qualquer piscada/hidratation mismatch no primeiro tick
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  // Quando terminar de carregar, decide o que fazer
  useEffect(() => {
    if (!ready || carregandoUser) return;

    // não logado -> manda pro login (com returnUrl)
    if (!usuario) {
      router.replace(`/login?returnUrl=${encodeURIComponent(pathname || "/")}`);
      return;
    }

    // sem permissão -> manda pra home
    if (!allowed.includes(usuario.tipo)) {
      router.replace("/");
      return;
    }
  }, [ready, carregandoUser, usuario, allowed, router, pathname]);

  // Enquanto checa, mostra loading
  if (!ready || carregandoUser) return <>{loadingFallback}</>;

  // Se não há usuário (e o redirect acima já foi disparado), não fica preso no loading
  if (!usuario) return null;

  // Sem permissão (redirect já disparado)
  if (!allowed.includes(usuario.tipo)) return null;

  // ✅ Autorizado
  return <>{children}</>;
}
