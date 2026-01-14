// src/context/AuthStore.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TipoUsuario =
  | "CLIENTE"
  | "ADMIN_MASTER"
  | "ADMIN_ATENDENTE"
  | "ADMIN_PROFESSORES"
  | "CLIENTE_APOIADO";

export type AtendenteFeature =
  | "ATD_AGENDAMENTOS"
  | "ATD_PERMANENTES"
  | "ATD_CHURRAS"
  | "ATD_BLOQUEIOS"
  | "ATD_USUARIOS_LEITURA"
  | "ATD_USUARIOS_EDICAO"
  | "ATD_RELATORIOS";

export interface UsuarioLogadoItf {
  id: string;
  nome: string;
  tipo: TipoUsuario;
  token?: string;

  // ✅ NOVO: vem do /usuarios/me (só faz sentido pro atendente)
  atendenteFeatures?: AtendenteFeature[];
}

type AuthState = {
  usuario: UsuarioLogadoItf | null;
  carregandoUser: boolean;
  hasHydrated: boolean;
  logaUsuario: (u: UsuarioLogadoItf | null) => void;
  deslogaUsuario: () => void;
  setCarregandoUser: (b: boolean) => void;
  setHasHydrated: (b: boolean) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      usuario: null,
      carregandoUser: true,
      hasHydrated: false,
      logaUsuario: (u) => set({ usuario: u }),
      deslogaUsuario: () => set({ usuario: null }),
      setCarregandoUser: (b) => set({ carregandoUser: b }),
      setHasHydrated: (b) => set({ hasHydrated: b }),
    }),
    {
      name: "auth-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ usuario: s.usuario }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
