"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import SystemAlert, { AlertVariant } from "@/components/SystemAlert";

type MotivoBloqueio = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo?: boolean;
};

type RelatorioHorasResponse = {
  periodo: { inicio: string; fim: string };
  motivoId: string;
  totalHoras: number;
  porQuadra: Array<{
    quadraId: string;
    nome: string;
    numero: number;
    horas: number;
  }>;
};

type Feedback = { kind: "success" | "error" | "info"; text: string };

// helper: YYYY-MM-DD de hoje (sem timezone trap)
const todayYMD = () => {
  const hoje = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
};

export default function RelatorioBloqueiosHorasPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  // ✅ Feedback padronizado
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const closeFeedback = () => setFeedback(null);

  // filtros
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [motivoId, setMotivoId] = useState<string>("");

  // motivos
  const [motivos, setMotivos] = useState<MotivoBloqueio[]>([]);
  const [loadingMotivos, setLoadingMotivos] = useState(false);

  // resultado
  const [resultado, setResultado] = useState<RelatorioHorasResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // ---- carregar motivos (ativos) ----
  useEffect(() => {
    const fetchMotivos = async () => {
      setLoadingMotivos(true);
      try {
        const res = await axios.get<MotivoBloqueio[]>(`${API_URL}/motivosBloqueio`, {
          params: { ativos: "true" },
          withCredentials: true,
        });

        // alguns endpoints já retornam só ativos; ainda assim filtramos por segurança
        const ativos = (res.data || []).filter((m) => (m.ativo === undefined ? true : !!m.ativo));
        setMotivos(ativos);

        // se tiver só 1 motivo, pré-seleciona
        if (ativos.length === 1) setMotivoId(ativos[0].id);
      } catch (error) {
        console.error("Erro ao carregar motivos:", error);
        setFeedback({ kind: "error", text: "Erro ao carregar motivos de bloqueio." });
      } finally {
        setLoadingMotivos(false);
      }
    };

    fetchMotivos();
  }, [API_URL]);

  // ---- set datas default (hoje) ----
  useEffect(() => {
    if (!dataInicio) setDataInicio(todayYMD());
    if (!dataFim) setDataFim(todayYMD());
  }, [dataInicio, dataFim]);

  const semMotivos = !loadingMotivos && motivos.length === 0;

  const validar = () => {
    if (!dataInicio) return "Selecione a data de início.";
    if (!dataFim) return "Selecione a data de fim.";
    if (dataInicio > dataFim) return "A data de início não pode ser maior que a data de fim.";
    if (semMotivos) return "Não há motivos cadastrados. Cadastre ao menos 1 motivo.";
    if (!motivoId) return "Selecione o motivo.";
    return null;
  };

  const calcular = async () => {
    const erro = validar();
    if (erro) {
      setFeedback({ kind: "error", text: erro });
      return;
    }

    setLoading(true);
    setFeedback(null);
    setResultado(null);

    try {
      const res = await axios.get<RelatorioHorasResponse>(`${API_URL}/bloqueios/relatorio-horas`, {
        params: {
          dataInicio,
          dataFim,
          motivoId,
        },
        withCredentials: true,
      });

      setResultado(res.data);

      if ((res.data?.totalHoras ?? 0) === 0) {
        setFeedback({ kind: "info", text: "Nenhum bloqueio encontrado nesse período para esse motivo." });
      } else {
        setFeedback({ kind: "success", text: "Relatório gerado com sucesso!" });
      }
    } catch (e: unknown) {
      console.error(e);
      let msg = "Erro ao gerar relatório.";
      if (axios.isAxiosError(e)) {
        const d = e.response?.data as { erro?: string; error?: string; message?: string } | undefined;
        msg = d?.erro || d?.error || d?.message || msg;
      }
      setFeedback({ kind: "error", text: msg });
    } finally {
      setLoading(false);
    }
  };

  const motivoSelecionado = useMemo(
    () => motivos.find((m) => m.id === motivoId) || null,
    [motivos, motivoId]
  );

  return (
    <div className="space-y-8">
      {/* ✅ ALERTA PADRONIZADO */}
      <SystemAlert
        open={!!feedback}
        variant={(feedback?.kind as AlertVariant) || "info"}
        message={feedback?.text || ""}
        onClose={closeFeedback}
      />

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-orange-700">Relatório de Bloqueios (Horas)</h1>
        <div className="flex-1 border-t border-gray-300" />
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 shadow rounded-lg grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Data início</label>
          <input
            type="date"
            className="border p-2 rounded-lg"
            value={dataInicio}
            onChange={(e) => {
              setDataInicio(e.target.value);
              setFeedback(null);
            }}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Data fim</label>
          <input
            type="date"
            className="border p-2 rounded-lg"
            value={dataFim}
            onChange={(e) => {
              setDataFim(e.target.value);
              setFeedback(null);
            }}
          />
        </div>

        <div className="flex flex-col md:col-span-2">
          <label className="text-sm text-gray-600">Motivo</label>
          <select
            className="border p-2 rounded-lg"
            value={motivoId}
            onChange={(e) => {
              setMotivoId(e.target.value);
              setFeedback(null);
            }}
            disabled={loadingMotivos || semMotivos}
          >
            <option value="">
              {loadingMotivos
                ? "Carregando motivos..."
                : semMotivos
                  ? "Nenhum motivo cadastrado"
                  : "Selecione o motivo"}
            </option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>

          {motivoSelecionado?.descricao && (
            <p className="mt-1 text-[11px] text-gray-500">
              <span className="font-semibold">Detalhes:</span> {motivoSelecionado.descricao}
            </p>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <button
          onClick={calcular}
          disabled={loading}
          className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
        >
          {loading ? "Calculando..." : "Calcular"}
        </button>

        <button
          onClick={() => {
            setResultado(null);
            setFeedback(null);
          }}
          className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded cursor-pointer"
        >
          Limpar resultado
        </button>
      </div>

      {/* Resultado */}
      {resultado && (
        <div className="space-y-4">
          {/* Cards resumo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-600">Motivo</p>
              <p className="font-semibold text-gray-900">{motivoSelecionado?.nome || "—"}</p>
            </div>

            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-600">Total de horas bloqueadas</p>
              <p className="text-2xl font-bold text-orange-700">{resultado.totalHoras.toFixed(2)}h</p>
              <p className="text-[11px] text-gray-500">Soma de todas as quadras no período.</p>
            </div>
          </div>

          {/* Tabela por quadra */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold text-orange-700">Horas por quadra</h2>
              <p className="text-sm text-gray-600">
                {resultado.porQuadra.length} quadra(s) com bloqueio no período.
              </p>
            </div>

            {resultado.porQuadra.length === 0 ? (
              <div className="p-4 text-sm text-gray-700">Nenhuma quadra teve bloqueio nesse período.</div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left">
                      <th className="px-4 py-3 font-semibold text-gray-700">Quadra</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">Número</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">Horas bloqueadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.porQuadra.map((q) => (
                      <tr key={q.quadraId} className="border-t">
                        <td className="px-4 py-3 text-gray-900">{q.nome}</td>
                        <td className="px-4 py-3 text-gray-700">{q.numero}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{q.horas.toFixed(2)}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
