"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import SystemAlert, { AlertVariant } from "@/components/SystemAlert";

const toNumber = (v: unknown) => {
  const n = Number(typeof v === "string" ? v.replace(".", "").replace(",", ".") : v);
  return Number.isFinite(n) ? n : 0;
};

const currencyBRL = (n: number | string) =>
  toNumber(n).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

type Feedback = { kind: "success" | "error" | "info"; text: string };

export default function ConfigValorMultaPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [valorAtual, setValorAtual] = useState<string>("0");
  const [novoValor, setNovoValor] = useState<string>("0");

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // ✅ Feedback padronizado
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const closeFeedback = () => setFeedback(null);

  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false);

  function mensagemErroAxios(error: any, fallback = "Ocorreu um erro. Tente novamente.") {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data as any;

      const serverMsg =
        data && (data.erro || data.error || data.message || data.msg)
          ? String(data.erro || data.error || data.message || data.msg)
          : "";

      if (status === 401) return "Não autorizado.";
      if (status === 403) return "Acesso negado.";
      if (status === 400 || status === 422) return serverMsg || "Valor inválido.";
      return serverMsg || fallback;
    }
    return fallback;
  }

  // carrega valor atual da multa
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setCarregando(true);
        setFeedback(null);

        const res = await axios.get<{ valorMultaPadrao: string }>(
          `${API_URL}/configuracoes/config/multa`,
          { withCredentials: true }
        );

        const valor = res.data?.valorMultaPadrao || "50";
        setValorAtual(valor);
        setNovoValor(valor.replace(".", ","));
      } catch (e: any) {
        console.error(e);
        setFeedback({
          kind: "error",
          text: mensagemErroAxios(e, "Erro ao carregar configuração de multa."),
        });
      } finally {
        setCarregando(false);
      }
    };

    void fetchConfig();
  }, [API_URL]);

  const handleSalvarClick = () => {
    setFeedback(null);

    const n = toNumber(novoValor);
    if (!Number.isFinite(n) || n < 0) {
      setFeedback({ kind: "error", text: "Informe um valor válido maior ou igual a zero." });
      return;
    }

    // abre cardzinho de confirmação
    setMostrarConfirmacao(true);
  };

  const confirmarAlteracao = async () => {
    const valorNumber = toNumber(novoValor);

    try {
      setSalvando(true);
      setFeedback(null);

      const res = await axios.put(
        `${API_URL}/configuracoes/config/multa`,
        { valorMultaPadrao: valorNumber },
        { withCredentials: true }
      );

      const valorResp: string = res.data?.valorMultaPadrao ?? String(valorNumber);

      setValorAtual(valorResp);
      setNovoValor(valorResp.replace(".", ","));

      setFeedback({ kind: "success", text: "Valor da multa atualizado com sucesso." });
      setMostrarConfirmacao(false);
    } catch (e: any) {
      console.error(e);
      setFeedback({
        kind: "error",
        text: mensagemErroAxios(e, "Erro ao atualizar o valor da multa."),
      });
    } finally {
      setSalvando(false);
    }
  };

  const cancelarAlteracao = () => {
    setMostrarConfirmacao(false);
  };

  const valorAtualNumber = toNumber(valorAtual);
  const novoValorNumber = toNumber(novoValor);

  return (
    <div className="max-w-xl mx-auto mt-6 sm:mt-10 p-4 sm:p-6 bg-white rounded-xl shadow-sm border border-gray-200">
      {/* ✅ ALERTA PADRONIZADO */}
      <SystemAlert
        open={!!feedback}
        variant={(feedback?.kind as AlertVariant) || "info"}
        message={feedback?.text || ""}
        onClose={closeFeedback}
      />

      <h1 className="text-lg sm:text-xl font-semibold tracking-tight mb-2">
        Configuração — Valor padrão da multa
      </h1>

      <p className="text-[13px] text-gray-600 mb-4">
        Este valor é usado como padrão para novas multas aplicadas no sistema (automáticas ou manuais).
        Multas já registradas não são alteradas quando você muda este valor.
      </p>

      {carregando && (
        <div className="flex items-center gap-2 text-gray-600 mb-3">
          <Spinner /> <span>Carregando valor atual…</span>
        </div>
      )}

      {!carregando && (
        <>
          <div className="mb-4 space-y-2">
            <div className="rounded-md bg-gray-50 px-3 py-2 border border-gray-200 text-[13px] text-gray-700">
              <div className="flex items-center justify-between">
                <span>Valor atual da multa:</span>
                <span className="font-semibold">{currencyBRL(valorAtualNumber)}</span>
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-sm text-gray-700 mb-1">Novo valor padrão (R$)</label>
              <input
                type="text"
                value={novoValor}
                onChange={(e) => {
                  setNovoValor(e.target.value);
                  setFeedback(null);
                  setMostrarConfirmacao(false);
                }}
                className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                placeholder="Ex.: 50,00"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSalvarClick}
            disabled={salvando}
            className="w-full sm:w-auto px-4 py-2 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            {salvando ? "Salvando…" : "Salvar novo valor"}
          </button>

          {/* Cardzinho de confirmação */}
          {mostrarConfirmacao && (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] text-gray-700 shadow-sm">
              <p className="mb-2">
                Confirmar alteração do valor da multa de{" "}
                <span className="font-semibold">{currencyBRL(valorAtualNumber)}</span>{" "}
                para{" "}
                <span className="font-semibold text-orange-700">{currencyBRL(novoValorNumber)}</span>?
              </p>

              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                <button
                  type="button"
                  onClick={confirmarAlteracao}
                  disabled={salvando}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {salvando ? "Confirmando…" : "Confirmar"}
                </button>

                <button
                  type="button"
                  onClick={cancelarAlteracao}
                  disabled={salvando}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-100 text-sm font-medium text-gray-700 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
