"use client";

import { useEffect, useState, FormEvent } from "react";
import axios from "axios";
import SystemAlert, { AlertVariant } from "@/components/SystemAlert";

type MotivoBloqueio = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
};

type Feedback = { kind: "success" | "error" | "info"; text: string };

export default function MotivosBloqueioPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [motivos, setMotivos] = useState<MotivoBloqueio[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);

  // campo que vira `nome` na API
  const [nome, setNome] = useState<string>("");
  const [ativo, setAtivo] = useState<boolean>(true);

  // controla se o card de formulário está visível
  const [mostrarForm, setMostrarForm] = useState<boolean>(false);

  // ✅ feedback padronizado
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const closeFeedback = () => setFeedback(null);

  function mensagemErroAxios(error: any, fallback = "Ocorreu um erro. Tente novamente."): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data as any;

      const serverMsg =
        data && (data.erro || data.error || data.message || data.msg)
          ? String(data.erro || data.error || data.message || data.msg)
          : "";

      if (status === 409) return serverMsg || "Conflito: motivo já existe ou está em uso.";
      if (status === 400 || status === 422) return serverMsg || "Dados inválidos.";
      if (status === 401) return "Não autorizado.";
      return serverMsg || fallback;
    }
    return fallback;
  }

  const resetForm = () => {
    setEditandoId(null);
    setNome("");
    setAtivo(true);
    setMostrarForm(false); // esconde o formulário
    setFeedback(null);
  };

  const carregarMotivos = async () => {
    setCarregando(true);
    try {
      const res = await axios.get<MotivoBloqueio[]>(`${API_URL}/motivosBloqueio`, {
        withCredentials: true,
      });
      setMotivos(res.data);
    } catch (err) {
      console.error(err);
      setFeedback({ kind: "error", text: "Erro ao carregar motivos de bloqueio." });
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarMotivos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!nome.trim()) {
      setFeedback({ kind: "error", text: "Informe a descrição do motivo." });
      return;
    }

    setSalvando(true);
    try {
      if (editandoId) {
        // PUT envia nome + ativo
        await axios.put(
          `${API_URL}/motivosBloqueio/${editandoId}`,
          {
            nome: nome.trim(),
            ativo,
          },
          { withCredentials: true }
        );

        setFeedback({ kind: "success", text: "Motivo atualizado com sucesso!" });
      } else {
        // POST envia nome + ativo
        await axios.post(
          `${API_URL}/motivosBloqueio`,
          {
            nome: nome.trim(),
            ativo,
          },
          { withCredentials: true }
        );

        setFeedback({ kind: "success", text: "Motivo criado com sucesso!" });
      }

      resetForm(); // limpa e fecha o form
      await carregarMotivos();
    } catch (err: any) {
      console.error(err);
      const msg = mensagemErroAxios(err, "Erro ao salvar motivo.");
      setFeedback({ kind: "error", text: msg });
    } finally {
      setSalvando(false);
    }
  };

  const handleEditar = (motivo: MotivoBloqueio) => {
    setFeedback(null);
    setEditandoId(motivo.id);
    setNome(motivo.nome);
    setAtivo(motivo.ativo);
    setMostrarForm(true); // abre o form em modo edição
  };

  const handleExcluir = async (id: string) => {
    setFeedback(null);
    if (!window.confirm("Tem certeza que deseja excluir este motivo?")) return;

    try {
      await axios.delete(`${API_URL}/motivosBloqueio/${id}`, {
        withCredentials: true,
      });

      setFeedback({ kind: "success", text: "Motivo excluído com sucesso!" });
      await carregarMotivos();
    } catch (err: any) {
      console.error(err);
      const msg = mensagemErroAxios(err, "Erro ao excluir motivo.");
      setFeedback({ kind: "error", text: msg });
    }
  };

  const handleCriarNovoClick = () => {
    // garantir que seja um cadastro novo
    setFeedback(null);
    setEditandoId(null);
    setNome("");
    setAtivo(true);
    setMostrarForm(true);
  };

  return (
    <div className="space-y-8">
      {/* ✅ ALERTA PADRONIZADO */}
      <SystemAlert
        open={!!feedback}
        variant={(feedback?.kind as AlertVariant) || "info"}
        message={feedback?.text || ""}
        onClose={closeFeedback}
      />

      {/* Título + botão de criar */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-orange-700">Motivos de Bloqueio</h1>

        {!mostrarForm && (
          <button
            type="button"
            onClick={handleCriarNovoClick}
            className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded text-sm"
          >
            + Criar novo motivo
          </button>
        )}
      </div>

      {/* Formulário (só aparece quando mostrarForm = true) */}
      {mostrarForm && (
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
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  setFeedback(null);
                }}
                placeholder="Ex.: Manutenção, Torneio, Evento, etc."
              />
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => {
                  setAtivo(e.target.checked);
                  setFeedback(null);
                }}
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

              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex items-center mb-3">
          <h2 className="text-lg font-semibold">Motivos cadastrados</h2>
          <div className="flex-1 border-t border-gray-300 ml-3" />
        </div>

        {carregando ? (
          <p>Carregando motivos...</p>
        ) : motivos.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum motivo cadastrado ainda.</p>
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
                  <td className="py-2">{m.nome}</td>
                  <td className="py-2">
                    {m.ativo ? (
                      <span className="text-green-700 font-medium">Ativo</span>
                    ) : (
                      <span className="text-gray-500">Inativo</span>
                    )}
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button onClick={() => handleEditar(m)} className="text-blue-600 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => handleExcluir(m.id)} className="text-red-600 hover:underline">
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
