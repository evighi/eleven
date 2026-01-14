// src/hooks/useLoadUser.ts
"use client";
import { useEffect } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";
import type { UsuarioLogadoItf } from "@/context/AuthStore";

export function useLoadUser() {
  const { logaUsuario, deslogaUsuario, setCarregandoUser, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (!hasHydrated) return;

    let cancelado = false;

    (async () => {
      setCarregandoUser(true);
      try {
        const base = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

        type ApiMeResponse = Omit<UsuarioLogadoItf, "token">;

        const { data } = await axios.get<ApiMeResponse>(`${base}/usuarios/me`, {
          withCredentials: true,
        });

        if (cancelado) return;

        const usuario: UsuarioLogadoItf = {
          ...data,
          token: "",
          // ✅ garante array (evita undefined no menu)
          atendenteFeatures:
            data.tipo === "ADMIN_ATENDENTE" ? (data.atendenteFeatures ?? []) : [],
        };

        logaUsuario(usuario);
      } catch (err: unknown) {
        if (cancelado) return;

        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if (status === 401 || status === 403) {
            deslogaUsuario();
          }
        }
        // demais erros: mantém usuário persistido
      } finally {
        if (!cancelado) setCarregandoUser(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [logaUsuario, deslogaUsuario, setCarregandoUser, hasHydrated]);
}
