// src/hooks/useLoadUser.ts
"use client";

import { useEffect, useRef } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";
import type { UsuarioLogadoItf } from "@/context/AuthStore";

export function useLoadUser() {
  const startedRef = useRef(false);

  const {
    logaUsuario,
    deslogaUsuario,
    setCarregandoUser,
  } = useAuthStore();

  useEffect(() => {
    // ✅ evita disparar 10x em vários componentes
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelado = false;

    (async () => {
      setCarregandoUser(true);

      try {
        const base =
          process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

        type ApiMeResponse = Omit<UsuarioLogadoItf, "token">;

        const { data } = await axios.get<ApiMeResponse>(`${base}/usuarios/me`, {
          withCredentials: true,
        });

        if (cancelado) return;

        const usuario: UsuarioLogadoItf = {
          ...data,
          token: "",
          atendenteFeatures:
            data.tipo === "ADMIN_ATENDENTE"
              ? (data.atendenteFeatures ?? [])
              : [],
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
        // Outros erros: mantém o usuario do persist
      } finally {
        if (!cancelado) setCarregandoUser(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [logaUsuario, deslogaUsuario, setCarregandoUser]);
}
