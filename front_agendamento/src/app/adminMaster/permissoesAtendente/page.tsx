"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

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

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

export default function PermissoesAtendentePage() {
  // ✅ padrão do teu projeto (redirect automático)
  const { isChecking, usuario } = useRequireAuth(["ADMIN_MASTER"]);

  // ✅ mesma env var do resto do teu painel
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [features, setFeatures] = useState<AtendenteFeature[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedById, setUpdatedById] = useState<string | null>(null);

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
          desc: "Libera telas/rotas de relatórios (ex.: professores).",
        },
      ] as const,
    []
  );

  async function load() {
    setLoading(true);
    setErro(null);
    try {
      const { data } = await axios.get<ApiResp>(`${API_URL}/permissoes-atendente`, {
        withCredentials: true, // ✅ cookie
      });

      setFeatures(data.features ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setUpdatedById(data.updatedById ?? null);
    } catch (e: any) {
      console.error(e);
      const msg = e?.response?.data?.erro ?? "Erro ao carregar permissões do atendente.";
      setErro(typeof msg === "string" ? msg : "Erro ao carregar permissões do atendente.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isChecking) return;
    // se passou do requireAuth, é master
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChecking]);

  function toggleFeature(key: AtendenteFeature) {
    setFeatures((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }

  async function salvar() {
    setSaving(true);
    setErro(null);
    try {
      const { data } = await axios.put<ApiResp>(
        `${API_URL}/permissoes-atendente`,
        { features },
        {
          withCredentials: true, // ✅ cookie
          headers: { "Content-Type": "application/json" },
        }
      );

      setFeatures(data.features ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setUpdatedById(data.updatedById ?? null);

      toast.success("Permissões do atendente atualizadas!");
    } catch (e: any) {
      console.error(e);
      const msg = e?.response?.data?.erro ?? "Erro ao salvar permissões.";
      setErro(typeof msg === "string" ? msg : "Erro ao salvar permissões.");
      toast.error("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (isChecking) return null;

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Header padrão do painel */}
        <div className="mb-4">
          <h1 className="text-[32px] font-bold text-orange-600 leading-tight">Permissões do atendente</h1>
          <p className="text-[16px] text-gray-500 -mt-0.5">
            Defina quais módulos o <b>ADMIN_ATENDENTE</b> pode usar
          </p>
        </div>

        {/* Card padrão (bg-gray-100 rounded) */}
        <div className="bg-gray-100 rounded-lg p-4 border border-gray-200">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-gray-600">
              <div>
                Última atualização: <b>{fmtDate(updatedAt)}</b>
              </div>
              <div>
                Alterado por: <b>{updatedById ?? "—"}</b>
              </div>
            </div>

            <button
              onClick={salvar}
              disabled={saving || loading}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Salvando…
                </span>
              ) : (
                "Salvar"
              )}
            </button>
          </div>

          <div className="border-t border-gray-200 my-4" />

          {loading ? (
            <div className="text-sm text-gray-600 inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
            </div>
          ) : erro ? (
            <div className="text-sm text-red-600">{erro}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {allFeatures.map((f) => {
                const checked = features.includes(f.key);
                return (
                  <label
                    key={f.key}
                    className={[
                      "bg-[#F3F3F3] rounded-lg px-4 py-3 border",
                      "flex items-start gap-3 cursor-pointer transition",
                      checked ? "border-orange-300 bg-orange-50/60" : "border-gray-200 hover:bg-orange-50/40",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFeature(f.key)}
                      className="mt-1 accent-orange-600"
                    />

                    <div>
                      <div className="text-[13px] font-semibold text-gray-800">{f.label}</div>
                      <div className="text-[11px] text-gray-600 mt-1">{f.desc}</div>
                      <div className="text-[10px] text-gray-500 mt-1">Chave: {f.key}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
