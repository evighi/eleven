"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import SystemAlert, { AlertVariant } from "@/components/SystemAlert";

type Feedback = { kind: "success" | "error" | "info"; text: string };

type AulaExtraConfig = {
    aulaExtraAtiva: boolean;
    aulaExtraInicioHHMM: string; // "18:00"
    aulaExtraFimHHMM: string; // "23:00"
    valorAulaExtra: string; // "50.00" (string vindo do backend)
};

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

function isHHMM(v: unknown): v is string {
    return typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
}

function normalizeHHMM(v: string) {
    if (!isHHMM(v)) return null;
    const [hh, mm] = v.split(":").map(Number);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// comparação lexicográfica funciona pra HH:MM
function cmpHHMM(a: string, b: string) {
    return a.localeCompare(b);
}

export default function ConfigAulaExtraPage() {
    const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

    const [valorAtual, setValorAtual] = useState<AulaExtraConfig | null>(null);
    const [form, setForm] = useState<AulaExtraConfig>({
        aulaExtraAtiva: true,
        aulaExtraInicioHHMM: "18:00",
        aulaExtraFimHHMM: "23:00",
        valorAulaExtra: "50,00",
    });

    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);

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
            if (status === 400 || status === 422) return serverMsg || "Dados inválidos.";
            return serverMsg || fallback;
        }
        return fallback;
    }

    // carrega config atual
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                setCarregando(true);
                setFeedback(null);

                const res = await axios.get<AulaExtraConfig>(
                    `${API_URL}/configuracoes/config/aula-extra`,
                    { withCredentials: true }
                );

                const cfg = res.data;

                // normaliza visual no input de valor (vírgula)
                const valorStr = String(cfg?.valorAulaExtra ?? "50.00").replace(".", ",");

                const normalized: AulaExtraConfig = {
                    aulaExtraAtiva: !!cfg?.aulaExtraAtiva,
                    aulaExtraInicioHHMM: cfg?.aulaExtraInicioHHMM ?? "18:00",
                    aulaExtraFimHHMM: cfg?.aulaExtraFimHHMM ?? "23:00",
                    valorAulaExtra: valorStr,
                };

                setValorAtual({
                    ...normalized,
                    // para guardar o "atual" como veio do backend, mantém string "xx,yy" no front mesmo
                    valorAulaExtra: valorStr,
                });
                setForm(normalized);
            } catch (e: any) {
                console.error(e);
                setFeedback({
                    kind: "error",
                    text: mensagemErroAxios(e, "Erro ao carregar configuração de aula extra."),
                });
            } finally {
                setCarregando(false);
            }
        };

        void fetchConfig();
    }, [API_URL]);

    const valorAulaExtraNumber = useMemo(() => toNumber(form.valorAulaExtra), [form.valorAulaExtra]);

    const handleSalvarClick = () => {
        setFeedback(null);

        const ini = normalizeHHMM(form.aulaExtraInicioHHMM);
        const fim = normalizeHHMM(form.aulaExtraFimHHMM);

        if (!ini || !fim) {
            setFeedback({ kind: "error", text: "Horários inválidos. Use o formato HH:MM." });
            return;
        }

        if (cmpHHMM(ini, fim) >= 0) {
            setFeedback({ kind: "error", text: "O horário de início deve ser menor que o horário de fim." });
            return;
        }

        if (!Number.isFinite(valorAulaExtraNumber) || valorAulaExtraNumber < 0) {
            setFeedback({ kind: "error", text: "Informe um valor válido maior ou igual a zero." });
            return;
        }

        setMostrarConfirmacao(true);
    };

    const confirmarAlteracao = async () => {
        try {
            setSalvando(true);
            setFeedback(null);

            const payload = {
                aulaExtraAtiva: form.aulaExtraAtiva,
                aulaExtraInicioHHMM: normalizeHHMM(form.aulaExtraInicioHHMM),
                aulaExtraFimHHMM: normalizeHHMM(form.aulaExtraFimHHMM),
                valorAulaExtra: valorAulaExtraNumber,
            };

            const res = await axios.put(
                `${API_URL}/configuracoes/config/aula-extra`,
                payload,
                { withCredentials: true }
            );

            // backend pode devolver string "50.00"
            const retorno = res.data as any;

            const updated: AulaExtraConfig = {
                aulaExtraAtiva:
                    typeof retorno?.aulaExtraAtiva === "boolean"
                        ? retorno.aulaExtraAtiva
                        : payload.aulaExtraAtiva,

                aulaExtraInicioHHMM:
                    typeof retorno?.aulaExtraInicioHHMM === "string"
                        ? retorno.aulaExtraInicioHHMM
                        : String(payload.aulaExtraInicioHHMM),

                aulaExtraFimHHMM:
                    typeof retorno?.aulaExtraFimHHMM === "string"
                        ? retorno.aulaExtraFimHHMM
                        : String(payload.aulaExtraFimHHMM),

                valorAulaExtra: String(
                    retorno?.valorAulaExtra !== undefined ? retorno.valorAulaExtra : valorAulaExtraNumber
                ).replace(".", ","),
            };


            setValorAtual(updated);
            setForm(updated);

            setFeedback({ kind: "success", text: "Configuração de aula extra atualizada com sucesso." });
            setMostrarConfirmacao(false);
        } catch (e: any) {
            console.error(e);
            setFeedback({
                kind: "error",
                text: mensagemErroAxios(e, "Erro ao atualizar configuração de aula extra."),
            });
        } finally {
            setSalvando(false);
        }
    };

    const cancelarAlteracao = () => setMostrarConfirmacao(false);

    const atualValorNum = valorAtual ? toNumber(valorAtual.valorAulaExtra) : 0;
    const novoValorNum = toNumber(form.valorAulaExtra);

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
                Configuração — Aula extra (após horário)
            </h1>

            <p className="text-[13px] text-gray-600 mb-4">
                Define o valor fixo cobrado quando o agendamento for uma <b>AULA</b> dentro da janela configurada.
            </p>

            {carregando && (
                <div className="flex items-center gap-2 text-gray-600 mb-3">
                    <Spinner /> <span>Carregando configuração…</span>
                </div>
            )}

            {!carregando && (
                <>
                    {/* resumo atual */}
                    <div className="mb-4 space-y-2">
                        <div className="rounded-md bg-gray-50 px-3 py-2 border border-gray-200 text-[13px] text-gray-700">
                            <div className="flex items-center justify-between">
                                <span>Status:</span>
                                <span className={`font-semibold ${valorAtual?.aulaExtraAtiva ? "text-emerald-700" : "text-gray-600"}`}>
                                    {valorAtual?.aulaExtraAtiva ? "Ativo" : "Desativado"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                                <span>Janela atual:</span>
                                <span className="font-semibold">
                                    {valorAtual?.aulaExtraInicioHHMM ?? "--:--"} — {valorAtual?.aulaExtraFimHHMM ?? "--:--"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                                <span>Valor atual:</span>
                                <span className="font-semibold">{currencyBRL(atualValorNum)}</span>
                            </div>
                        </div>

                        {/* form */}
                        <div className="flex flex-col gap-3">
                            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={form.aulaExtraAtiva}
                                    onChange={(e) => {
                                        setForm((p) => ({ ...p, aulaExtraAtiva: e.target.checked }));
                                        setFeedback(null);
                                        setMostrarConfirmacao(false);
                                    }}
                                />
                                Ativar cobrança de aula extra
                            </label>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="flex flex-col">
                                    <label className="text-sm text-gray-700 mb-1">Início da janela (HH:MM)</label>
                                    <input
                                        type="time"
                                        value={form.aulaExtraInicioHHMM}
                                        onChange={(e) => {
                                            setForm((p) => ({ ...p, aulaExtraInicioHHMM: e.target.value }));
                                            setFeedback(null);
                                            setMostrarConfirmacao(false);
                                        }}
                                        className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                                    />
                                </div>

                                <div className="flex flex-col">
                                    <label className="text-sm text-gray-700 mb-1">Fim da janela (HH:MM)</label>
                                    <input
                                        type="time"
                                        value={form.aulaExtraFimHHMM}
                                        onChange={(e) => {
                                            setForm((p) => ({ ...p, aulaExtraFimHHMM: e.target.value }));
                                            setFeedback(null);
                                            setMostrarConfirmacao(false);
                                        }}
                                        className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col">
                                <label className="text-sm text-gray-700 mb-1">Valor fixo da aula extra (R$)</label>
                                <input
                                    type="text"
                                    value={form.valorAulaExtra}
                                    onChange={(e) => {
                                        setForm((p) => ({ ...p, valorAulaExtra: e.target.value }));
                                        setFeedback(null);
                                        setMostrarConfirmacao(false);
                                    }}
                                    className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                                    placeholder="Ex.: 50,00"
                                />
                                <p className="text-[12px] text-gray-500 mt-1">
                                    Ex.: {currencyBRL(novoValorNum)}
                                </p>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleSalvarClick}
                        disabled={salvando}
                        className="w-full sm:w-auto px-4 py-2 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-300"
                    >
                        {salvando ? "Salvando…" : "Salvar configuração"}
                    </button>

                    {/* confirmação */}
                    {mostrarConfirmacao && (
                        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] text-gray-700 shadow-sm">
                            <p className="mb-2">
                                Confirmar alteração da aula extra para:
                            </p>

                            <ul className="mb-3 space-y-1">
                                <li>
                                    <span className="text-gray-600">Status:</span>{" "}
                                    <span className="font-semibold">{form.aulaExtraAtiva ? "Ativo" : "Desativado"}</span>
                                </li>
                                <li>
                                    <span className="text-gray-600">Janela:</span>{" "}
                                    <span className="font-semibold">
                                        {form.aulaExtraInicioHHMM} — {form.aulaExtraFimHHMM}
                                    </span>
                                </li>
                                <li>
                                    <span className="text-gray-600">Valor:</span>{" "}
                                    <span className="font-semibold text-orange-700">{currencyBRL(novoValorNum)}</span>
                                </li>
                            </ul>

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
