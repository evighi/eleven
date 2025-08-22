// src/hooks/useRequireAuth.ts
"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore, TipoUsuario } from "@/context/AuthStore";

export function useRequireAuth(allowed?: TipoUsuario[]) {
  const router = useRouter();
  const pathname = usePathname();
  const { usuario, carregandoUser } = useAuthStore();

  // Garante que só vamos redirecionar após o 1º ciclo no client
  const [bootReady, setBootReady] = useState(false);
  useEffect(() => {
    // um tick suficiente para o UserLoader disparar
    const t = setTimeout(() => setBootReady(true), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // ainda carregando ou ainda não hidratou -> não decide nada
    if (!bootReady || carregandoUser) return;

    // sessão ausente -> login (com returnUrl)
    if (!usuario) {
      const ret = encodeURIComponent(pathname || "/");
      router.replace(`/login?returnUrl=${ret}`);
      return;
    }

    // sem permissão -> home
    if (allowed?.length && !allowed.includes(usuario.tipo)) {
      router.replace("/");
    }
  }, [bootReady, carregandoUser, usuario, allowed, router, pathname]);

  // informa se a página deve "aguardar"
  const isChecking = !bootReady || carregandoUser || !usuario;
  return { isChecking, usuario };
}
