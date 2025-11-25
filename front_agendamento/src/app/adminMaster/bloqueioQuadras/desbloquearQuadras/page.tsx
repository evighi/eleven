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

// 👇 Tipo do motivo de bloqueio (mesmo usado no backend)
type MotivoBloqueio = {
  id: string;
  nome: string;
  descricao?: string | null;
};

type Bloqueio = {
  id: string;
  createdAt: string; // ISO completo com horário
  dataBloqueio: string; // vem como ISO Date, mas queremos tratar como YMD
  inicioBloqueio: string; // "HH:MM"
  fimBloqueio: string; // "HH:MM"
  bloqueadoPor: UsuarioResumo;
  quadras: Quadra[];

  // campos novos
  motivoId?: string | null;
  motivo?: MotivoBloqueio | null;
};

export default function DesbloqueioQuadrasPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [bloqueioSelecionado, setBloqueioSelecionado] = useState<Bloqueio | null>(null);
  const [confirmarDesbloqueio, setConfirmarDesbloqueio] = useState<boolean>(false);
  const [deletando, setDeletando] = useState<boolean>(false);

  // 👇 NOVO: lista de motivos para o select
  const [motivos, setMotivos] = useState<MotivoBloqueio[]>([]);
  // 👇 NOVO: motivo selecionado no filtro
  const [motivoIdFiltro, setMotivoIdFiltro] = useState<string>("");

  // Carrega motivos ativos para o select
  useEffect(() => {
    const fetchMotivos = async () => {
      try {
        const res = await axios.get<MotivoBloqueio[]>(
          `${API_URL}/motivos-bloqueio`,
          {
            params: { ativos: "true" },
            withCredentials: true,
          }
        );
        setMotivos(res.data);
      } catch (error) {
        console.error("Erro ao buscar motivos de bloqueio:", error);
      }
    };

    fetchMotivos();
  }, [API_URL]);

  // Carrega bloqueios (com filtro opcional por motivoId)
  useEffect(() => {
    const fetchBloqueios = async () => {
      setLoading(true);
      try {
        const params: any = {};
        if (motivoIdFiltro) {
          params.motivoId = motivoIdFiltro;
        }

        const res = await axios.get<Bloqueio[]>(`${API_URL}/bloqueios`, {
          params,
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
  }, [API_URL, motivoIdFiltro]);

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

  // NÃO usar new Date para campos "date-only" vindos do back como 00:00Z
  const formatDateYMD = (isoLike: string) => {
    const m = isoLike.match(/^(\d{4}-\d{2}-\d{2})/);
    const ymd = m ? m[1] : isoLike.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return isoLike; // fallback
    const [y, mth, d] = ymd.split("-");
    return `${d}/${mth}/${y}`;
  };

  // createdAt é um carimbo completo (data+hora)
  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-orange-700">Desbloquear Quadras</h1>

      {/* 👇 Filtro por motivo */}
      <div className="bg-white p-4 rounded-lg shadow flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Filtrar por motivo
          </label>
          <select
            value={motivoIdFiltro}
            onChange={(e) => setMotivoIdFiltro(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm min-w-[220px]"
          >
            <option value="">Todos os motivos</option>
            <option value="SEM_MOTIVO">Sem motivo definido</option>
            {motivos.map((motivo) => (
              <option key={motivo.id} value={motivo.id}>
                {motivo.nome}
              </option>
            ))}
          </select>
        </div>

        {motivoIdFiltro && (
          <button
            type="button"
            onClick={() => setMotivoIdFiltro("")}
            className="text-sm px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            Limpar filtro
          </button>
        )}
      </div>

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
                          Criado em:{" "}
                          <span className="font-medium">
                            {formatDateTime(bloqueio.createdAt)}
                          </span>
                        </p>
                        <p className="text-sm text-gray-600">
                          Dia bloqueado:{" "}
                          <span className="font-medium">
                            {formatDateYMD(bloqueio.dataBloqueio)}
                          </span>
                        </p>
                        <p className="text-sm text-gray-600">
                          Horário:{" "}
                          <span className="font-medium">
                            {bloqueio.inicioBloqueio} – {bloqueio.fimBloqueio}
                          </span>
                        </p>

                        {/* Motivo, se existir */}
                        {bloqueio.motivo && (
                          <div className="mt-2 text-sm text-gray-700">
                            <p>
                              <span className="font-semibold">Motivo:</span>{" "}
                              {bloqueio.motivo.nome}
                            </p>
                            {bloqueio.motivo.descricao && (
                              <p className="text-gray-600">
                                <span className="font-semibold">Detalhes:</span>{" "}
                                {bloqueio.motivo.descricao}
                              </p>
                            )}
                          </div>
                        )}
                        {!bloqueio.motivo && (
                          <p className="mt-2 text-sm text-gray-500">
                            <span className="font-semibold">Motivo:</span> — (não informado)
                          </p>
                        )}
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
                      <p className="text-sm text-gray-700 font-medium mb-1">
                        Quadras bloqueadas:
                      </p>
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
