"use client";

import { useEffect, useState, FormEvent } from "react";
import axios from "axios";

type MotivoBloqueio = {
  id: string;
  descricao: string;
  ativo: boolean;
};

export default function MotivosBloqueioPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [motivos, setMotivos] = useState<MotivoBloqueio[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [descricao, setDescricao] = useState<string>("");
  const [ativo, setAtivo] = useState<boolean>(true);

  const resetForm = () => {
    setEditandoId(null);
    setDescricao("");
    setAtivo(true);
  };

  const carregarMotivos = async () => {
    setCarregando(true);
    try {
      const res = await axios.get<MotivoBloqueio[]>(`${API_URL}/motivos-bloqueio`, {
        withCredentials: true,
      });
      setMotivos(res.data);
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar motivos de bloqueio.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarMotivos();
  }, [API_URL]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!descricao.trim()) {
      alert("Informe a descrição do motivo.");
      return;
    }

    setSalvando(true);
    try {
      if (editandoId) {
        await axios.put(
          `${API_URL}/motivos-bloqueio/${editandoId}`,
          { descricao: descricao.trim(), ativo },
          { withCredentials: true }
        );
        alert("Motivo atualizado com sucesso!");
      } else {
        await axios.post(
          `${API_URL}/motivos-bloqueio`,
          { descricao: descricao.trim(), ativo },
          { withCredentials: true }
        );
        alert("Motivo criado com sucesso!");
      }

      resetForm();
      await carregarMotivos();
    } catch (err: any) {
      console.error(err);
      const msg =
        err?.response?.data?.erro ||
        err?.response?.data?.error ||
        "Erro ao salvar motivo.";
      alert(msg);
    } finally {
      setSalvando(false);
    }
  };

  const handleEditar = (motivo: MotivoBloqueio) => {
    setEditandoId(motivo.id);
    setDescricao(motivo.descricao);
    setAtivo(motivo.ativo);
  };

  const handleExcluir = async (id: string) => {
    if (!window.confirm("Tem certeza que deseja excluir este motivo?")) return;

    try {
      await axios.delete(`${API_URL}/motivos-bloqueio/${id}`, {
        withCredentials: true,
      });
      alert("Motivo excluído com sucesso!");
      await carregarMotivos();
    } catch (err: any) {
      console.error(err);
      const msg =
        err?.response?.data?.erro ||
        err?.response?.data?.error ||
        "Erro ao excluir motivo.";
      alert(msg);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-orange-700">
        Motivos de Bloqueio
      </h1>

      {/* Formulário */}
      <div className="bg-white p-4 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-3">
          {editandoId ? "Editar motivo" : "Cadastrar novo motivo"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col">
            <label className="text-sm text-gray-600">Descrição</label>
            <input
              type="text"
              className="border p-2 rounded-lg"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Manutenção, Torneio, Evento, etc."
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            Motivo ativo
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={salvando}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded disabled:opacity-60"
            >
              {salvando
                ? editandoId
                  ? "Salvando..."
                  : "Criando..."
                : editandoId
                ? "Salvar alterações"
                : "Criar motivo"}
            </button>

            {editandoId && (
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded"
              >
                Cancelar edição
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Lista */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex items-center mb-3">
          <h2 className="text-lg font-semibold">Motivos cadastrados</h2>
          <div className="flex-1 border-t border-gray-300 ml-3" />
        </div>

        {carregando ? (
          <p>Carregando motivos...</p>
        ) : motivos.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nenhum motivo cadastrado ainda.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Descrição</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {motivos.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2">{m.descricao}</td>
                  <td className="py-2">
                    {m.ativo ? (
                      <span className="text-green-700 font-medium">Ativo</span>
                    ) : (
                      <span className="text-gray-500">Inativo</span>
                    )}
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      onClick={() => handleEditar(m)}
                      className="text-blue-600 hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleExcluir(m.id)}
                      className="text-red-600 hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
