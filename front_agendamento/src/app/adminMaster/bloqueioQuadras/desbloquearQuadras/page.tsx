"use client";

import { useEffect, useState } from "react";
import axios from "axios";

type Quadra = {
  id: string;
  nome: string;
  numero: number;
};

type UsuarioResumo = {
  id?: string;
  nome: string;
};

type Bloqueio = {
  id: string;
  createdAt: string;       // ISO
  dataBloqueio: string;    // ISO "YYYY-MM-DD" vinda do back como Date -> serializada
  inicioBloqueio: string;  // "HH:MM"
  fimBloqueio: string;     // "HH:MM"
  bloqueadoPor: UsuarioResumo;
  quadras: Quadra[];
};

export default function DesbloqueioQuadrasPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [bloqueioSelecionado, setBloqueioSelecionado] = useState<Bloqueio | null>(null);
  const [confirmarDesbloqueio, setConfirmarDesbloqueio] = useState<boolean>(false);
  const [deletando, setDeletando] = useState<boolean>(false);

  // Carregar lista de bloqueios
  useEffect(() => {
    const fetchBloqueios = async () => {
      setLoading(true);
      try {
        const res = await axios.get<Bloqueio[]>(`${API_URL}/bloqueios`, {
          withCredentials: true,
        });
        setBloqueios(res.data);
      } catch (error) {
        console.error("Erro ao buscar bloqueios:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchBloqueios();
  }, [API_URL]);

  const confirmarDesbloqueioHandler = async () => {
    if (!bloqueioSelecionado) return;
    setDeletando(true);
    try {
      await axios.delete(`${API_URL}/bloqueios/${bloqueioSelecionado.id}`, {
        withCredentials: true,
      });
      alert("Quadras desbloqueadas com sucesso!");
      setBloqueios((prev) => prev.filter((b) => b.id !== bloqueioSelecionado.id));
      setConfirmarDesbloqueio(false);
      setBloqueioSelecionado(null);
    } catch (error) {
      console.error("Erro ao desbloquear quadras:", error);
      alert("Erro ao desbloquear quadras.");
    } finally {
      setDeletando(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-orange-700">Desbloquear Quadras</h1>

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
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold text-orange-700">
                          Bloqueio criado por {bloqueio.bloqueadoPor?.nome ?? "—"}
                        </h2>
                        <p className="text-sm text-gray-600">
                          Criado em: <span className="font-medium">{formatDateTime(bloqueio.createdAt)}</span>
                        </p>
                        <p className="text-sm text-gray-600">
                          Dia bloqueado:{" "}
                          <span className="font-medium">{formatDate(bloqueio.dataBloqueio)}</span>
                        </p>
                        <p className="text-sm text-gray-600">
                          Horário:{" "}
                          <span className="font-medium">
                            {bloqueio.inicioBloqueio} – {bloqueio.fimBloqueio}
                          </span>
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          setBloqueioSelecionado(bloqueio);
                          setConfirmarDesbloqueio(true);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded cursor-pointer"
                      >
                        Desbloquear
                      </button>
                    </div>

                    <div className="mt-3">
                      <p className="text-sm text-gray-700 font-medium mb-1">Quadras bloqueadas:</p>
                      <ul className="list-disc ml-5 text-sm text-gray-700">
                        {bloqueio.quadras.map((quadra) => (
                          <li key={quadra.id}>
                            {quadra.nome} — Nº {quadra.numero}
                          </li>
                        ))}
                      </ul>
                    </div>
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
            <p className="mt-4">
              Tem certeza que deseja desbloquear as quadras deste bloqueio?
            </p>
            <div className="mt-6 flex justify-end gap-4">
              <button
                onClick={() => setConfirmarDesbloqueio(false)}
                className="bg-gray-300 text-black px-4 py-2 rounded cursor-pointer"
                disabled={deletando}
              >
                Cancelar
              </button>
              <button
                onClick={confirmarDesbloqueioHandler}
                className="bg-red-600 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
                disabled={deletando}
              >
                {deletando ? "Desbloqueando..." : "Confirmar Desbloqueio"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
