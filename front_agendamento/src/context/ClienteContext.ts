import { ClienteItf } from '@/utils/types/ClienteItf';
import { create } from 'zustand';

type ClienteStore = {
  cliente: ClienteItf | null;                 // ← pode ser null
  logaCliente: (clienteLogado: ClienteItf) => void;
  deslogaCliente: () => void;
};

export const useClienteStore = create<ClienteStore>((set) => ({
  cliente: null,                              // ← começa sem usuário
  logaCliente: (clienteLogado) => set({ cliente: clienteLogado }),
  deslogaCliente: () => set({ cliente: null }), // ← limpa
}));
