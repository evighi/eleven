"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { useLoadUser } from "@/hooks/useLoadUser";

type AtendenteFeature =
    | "ATD_AGENDAMENTOS"
    | "ATD_PERMANENTES"
    | "ATD_CHURRAS"
    | "ATD_BLOQUEIOS"
    | "ATD_USUARIOS_LEITURA"
    | "ATD_USUARIOS_EDICAO"
    | "ATD_RELATORIOS";

type ApiResp = {
    id: number;
    features: AtendenteFeature[];
    updatedAt: string | null;
    updatedById: string | null;
};

function authHeaders() {
    const token =
        typeof window !== "undefined"
            ? localStorage.getItem("token") || localStorage.getItem("authToken")
            : null;

    return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function PermissoesAtendentePage() {
    useLoadUser();
    const router = useRouter();
    const { usuario, carregandoUser } = useAuthStore();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const [features, setFeatures] = useState<AtendenteFeature[]>([]);
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);
    const [updatedById, setUpdatedById] = useState<string | null>(null);

    // 🔒 só master
    useEffect(() => {
        if (carregandoUser) return;
        if (!usuario) return router.push("/login");
        if (usuario.tipo !== "ADMIN_MASTER") return router.push("/");
    }, [usuario, carregandoUser, router]);

    const allFeatures = useMemo(
        () =>
            [
                {
                    key: "ATD_AGENDAMENTOS" as const,
                    label: "Agendamentos (quadras - comum)",
                    desc: "Permite criar/cancelar/editar agendamentos comuns de quadras (conforme back).",
                },
                {
                    key: "ATD_PERMANENTES" as const,
                    label: "Permanentes (quadras + churrasqueiras)",
                    desc: "Libera rotas de permanentes (quadras e churrasqueiras).",
                },
                {
                    key: "ATD_CHURRAS" as const,
                    label: "Churrasqueiras (comum)",
                    desc: "Libera agendamento comum de churrasqueira (turnos).",
                },
                {
                    key: "ATD_BLOQUEIOS" as const,
                    label: "Bloqueios",
                    desc: "Libera o bloqueio de quadras.",
                },
                {
                    key: "ATD_USUARIOS_LEITURA" as const,
                    label: "Usuários (leitura)",
                    desc: "Permite listar/visualizar usuários (sem editar).",
                },
                {
                    key: "ATD_USUARIOS_EDICAO" as const,
                    label: "Usuários (edição)",
                    desc: "Permite editar usuários (onde o back liberar).",
                },
                {
                    key: "ATD_RELATORIOS" as const,
                    label: "Relatórios",
                    desc: "Libera telas/rotas de relatórios (ex: professores, etc).",
                },
            ] as const,
        []
    );

    async function load() {
        setLoading(true);
        setErro(null);
        try {
            const { data } = await axios.get<ApiResp>(
                `${process.env.NEXT_PUBLIC_API_URL}/permissoes-atendente`,
                { headers: authHeaders() }
            );
            setFeatures(data.features ?? []);
            setUpdatedAt(data.updatedAt ?? null);
            setUpdatedById(data.updatedById ?? null);
        } catch (e: any) {
            console.error(e);
            setErro(e?.response?.data?.erro ?? "Erro ao carregar permissões do atendente.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!usuario || usuario.tipo !== "ADMIN_MASTER") return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [usuario?.tipo]);

    function toggleFeature(key: AtendenteFeature) {
        setFeatures((prev) => {
            const has = prev.includes(key);
            return has ? prev.filter((x) => x !== key) : [...prev, key];
        });
    }

    async function salvar() {
        setSaving(true);
        setErro(null);
        try {
            const { data } = await axios.put<ApiResp>(
                `${process.env.NEXT_PUBLIC_API_URL}/permissoes-atendente`,
                { features },
                { headers: { ...authHeaders(), "Content-Type": "application/json" } }
            );
            setFeatures(data.features ?? []);
            setUpdatedAt(data.updatedAt ?? null);
            setUpdatedById(data.updatedById ?? null);
        } catch (e: any) {
            console.error(e);
            setErro(e?.response?.data?.erro ?? "Erro ao salvar permissões.");
        } finally {
            setSaving(false);
        }
    }

    if (carregandoUser || !usuario) return null;

    return (
        <main className="max-w-3xl mx-auto px-4 py-6">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">Permissões do Atendente</h1>
                    <p className="text-sm text-gray-600 mt-1">
                        Aqui você define quais funcionalidades o <b>ADMIN_ATENDENTE</b> pode usar.
                    </p>

                    <div className="text-xs text-gray-500 mt-2">
                        {updatedAt ? (
                            <>
                                Última atualização: <b>{new Date(updatedAt).toLocaleString()}</b>
                                {updatedById ? <> • por <b>{updatedById}</b></> : null}
                            </>
                        ) : (
                            "Sem histórico de atualização."
                        )}
                    </div>
                </div>

                <button
                    onClick={salvar}
                    disabled={saving || loading}
                    className={[
                        "px-4 py-2 rounded-md text-sm font-semibold",
                        "bg-orange-500 text-white hover:bg-orange-600",
                        "disabled:opacity-60 disabled:cursor-not-allowed",
                    ].join(" ")}
                >
                    {saving ? "Salvando..." : "Salvar"}
                </button>
            </div>

            <div className="border-t border-gray-200 my-4" />

            {loading ? (
                <div className="text-sm text-gray-600">Carregando...</div>
            ) : erro ? (
                <div className="text-sm text-red-600">{erro}</div>
            ) : (
                <div className="space-y-3">
                    {allFeatures.map((f) => {
                        const checked = features.includes(f.key);
                        return (
                            <label
                                key={f.key}
                                className={[
                                    "flex items-start gap-3 p-3 rounded-md border",
                                    checked ? "border-orange-300 bg-orange-50/40" : "border-gray-200 bg-white",
                                    "cursor-pointer",
                                ].join(" ")}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleFeature(f.key)}
                                    className="mt-1"
                                />
                                <div>
                                    <div className="text-sm font-semibold text-gray-900">{f.label}</div>
                                    <div className="text-xs text-gray-600 mt-1">{f.desc}</div>
                                    <div className="text-[11px] text-gray-500 mt-1">Chave: {f.key}</div>
                                </div>
                            </label>
                        );
                    })}
                </div>
            )}

            <div className="mt-6 text-xs text-gray-500">
                * Dica: mesmo que você esconda botões no front, o bloqueio real é sempre o back (middlewares).
            </div>
        </main>
    );
}
