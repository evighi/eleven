"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";

export default function DesbloqueioQuadrasPage() {
  const { usuario } = useAuthStore();

  const [bloqueios, setBloqueios] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [bloqueioSelecionado, setBloqueioSelecionado] = useState<any | null>(null);
  const [confirmarDesbloqueio, setConfirmarDesbloqueio] = useState<boolean>(false);

  // Carregar lista de bloqueios
  useEffect(() => {
    const fetchBloqueios = async () => {
      setLoading(true);
      try {
        const res = await axios.get("http://localhost:3001/bloqueios", {
          withCredentials: true,  // envia cookie de autenticação
        });
        setBloqueios(res.data);
      } catch (error) {
        console.error("Erro ao buscar bloqueios:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBloqueios();
  }, []);

  // Função para confirmar o desbloqueio
  const confirmarDesbloqueioHandler = async () => {
    if (!bloqueioSelecionado) return;

    try {
      await axios.delete(`http://localhost:3001/bloqueios/${bloqueioSelecionado.id}`, {
        withCredentials: true, // envia cookie
      });
      alert("Quadras desbloqueadas com sucesso!");
      setBloqueios(bloqueios.filter((b) => b.id !== bloqueioSelecionado.id));
      setConfirmarDesbloqueio(false);
    } catch (error) {
      console.error("Erro ao desbloquear quadras:", error);
      alert("Erro ao desbloquear quadras.");
    }
  };

  // Se quiser, você pode mostrar o nome do usuário logado em algum lugar, ex:
  // <p>Usuário logado: {usuario?.nome}</p>

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-orange-700">Desbloquear Quadras</h1>

      {/* Lista de Bloqueios */}
      <div>
        {loading ? (
          <p>Carregando bloqueios...</p>
        ) : (
          <div>
            {bloqueios.length === 0 ? (
              <p>Nenhum bloqueio encontrado.</p>
            ) : (
              <div className="space-y-4">
                {bloqueios.map((bloqueio) => (
                  <div key={bloqueio.id} className="bg-white p-4 rounded-lg shadow">
                    <h2 className="text-lg font-semibold text-orange-700">{`Bloqueio de ${bloqueio.bloqueadoPor.nome}`}</h2>
                    <p>Data do Bloqueio: {new Date(bloqueio.dataBloqueio).toLocaleDateString()}</p>
                    <div>
                      <p>Quadras: </p>
                      <ul>
                        {bloqueio.quadras.map((quadra: any) => (
                          <li key={quadra.id}>
                            {quadra.nome} - Quadra {quadra.numero}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      onClick={() => {
                        setBloqueioSelecionado(bloqueio);
                        setConfirmarDesbloqueio(true);
                      }}
                      className="mt-2 bg-red-600 text-white p-2 rounded cursor-pointer"
                    >
                      Desbloquear
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de Confirmação */}
      {confirmarDesbloqueio && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg shadow-lg w-96">
            <h3 className="text-lg font-semibold text-red-600">Confirmar Desbloqueio</h3>
            <p className="mt-4">Tem certeza que deseja desbloquear as quadras selecionadas?</p>
            <div className="mt-6 flex justify-end gap-4">
              <button
                onClick={() => setConfirmarDesbloqueio(false)}
                className="bg-gray-300 text-black px-4 py-2 rounded cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarDesbloqueioHandler}
                className="bg-red-600 text-white px-4 py-2 rounded cursor-pointer"
              >
                Confirmar Desbloqueio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
