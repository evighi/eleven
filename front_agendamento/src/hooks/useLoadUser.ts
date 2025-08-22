// src/hooks/useLoadUser.ts
"use client";
import { useEffect } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";
import type { UsuarioLogadoItf } from "@/context/AuthStore";

export function useLoadUser() {
  const { logaUsuario, deslogaUsuario, setCarregandoUser, hasHydrated } = useAuthStore();

  useEffect(() => {
    // aguarda hidratar o Zustand; evita piscar/redirect prematuro
    if (!hasHydrated) return;

    let cancelado = false;
    async function fetchUser() {
      setCarregandoUser(true);
      try {
        const base = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
        const { data } = await axios.get(`${base}/usuarios/me`, { withCredentials: true });
        if (cancelado) return;
        const usuario: UsuarioLogadoItf = { ...data, token: "" };
        logaUsuario(usuario);               // 1) seta usuário
      } catch (err: any) {
        if (cancelado) return;
        const status = err?.response?.status;
        // Só derruba sessão se token inválido/expirado
        if (status === 401 || status === 403) {
          deslogaUsuario();
        }
        // Em outros erros (rede/5xx), mantém usuário persistido (se houver)
      } finally {
        if (!cancelado) setCarregandoUser(false); // 2) só então tira o loading
      }
    }

    fetchUser();
    return () => { cancelado = true; };
  }, [logaUsuario, deslogaUsuario, setCarregandoUser, hasHydrated]);
}
