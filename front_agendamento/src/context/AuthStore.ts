// src/context/AuthStore.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TipoUsuario = "CLIENTE" | "ADMIN_MASTER" | "ADMIN_ATENDENTE" | "ADMIN_PROFESSORES";

export interface UsuarioLogadoItf {
  id: string;
  nome: string;
  tipo: TipoUsuario;
  token?: string;
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
      carregandoUser: true,    // começamos carregando
      hasHydrated: false,      // saber quando o persist terminou
      logaUsuario: (u) => set({ usuario: u }),
      deslogaUsuario: () => set({ usuario: null }),
      setCarregandoUser: (b) => set({ carregandoUser: b }),
      setHasHydrated: (b) => set({ hasHydrated: b }),
    }),
    {
      name: "auth-store",
      storage: createJSONStorage(() => localStorage),
      // só persista o usuário (não flags)
      partialize: (s) => ({ usuario: s.usuario }),
      onRehydrateStorage: () => (state) => {
        // é chamado ao terminar de hidratar do localStorage
        state?.setHasHydrated(true);
      },
    }
  )
);
