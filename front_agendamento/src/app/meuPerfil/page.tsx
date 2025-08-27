"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";

type Me = { id: string; nome: string; tipo: string };
type Cliente = {
  id: string;
  nome: string;
  email?: string | null;
  celular?: string | null;
  nascimento?: string | null; // ISO
  cpf?: string | null;
  tipo?: string | null;
};

// Helper para mensagens de erro sem usar "any"
function toApiMsg(err: unknown): string {
  if (typeof err === "object" && err && "response" in err) {
    const resp = (err as { response?: unknown }).response;
    if (typeof resp === "object" && resp) {
      const d = (resp as { data?: unknown; statusText?: unknown }).data;
      const statusText = (resp as { data?: unknown; statusText?: unknown }).statusText;

      if (typeof d === "object" && d) {
        const erro = (d as { erro?: unknown }).erro;
        const message = (d as { message?: unknown }).message;
        if (typeof erro === "string" && erro.trim()) return erro;
        if (typeof message === "string" && message.trim()) return message;
      }
      if (typeof statusText === "string" && statusText.trim()) return statusText;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Ocorreu um erro. Tente novamente.";
}

export default function EditarInformacoesPage() {
  const { isChecking } = useRequireAuth();
  const router = useRouter();

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [me, setMe] = useState<Me | null>(null);
  const [dados, setDados] = useState<Cliente | null>(null);

  const [celular, setCelular] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const [carregandoPerfil, setCarregandoPerfil] = useState(true);

  useEffect(() => {
    if (isChecking) return;

    const load = async () => {
      setCarregandoPerfil(true);
      setMsg("");
      try {
        const rMe = await axios.get<Me>(`${API_URL}/usuarios/me`, {
          withCredentials: true,
        });
        setMe(rMe.data);

        try {
          const rCli = await axios.get<Cliente[]>(
            `${API_URL}/clientes`,
            { withCredentials: true, params: { nome: rMe.data.nome } }
          );

          const candidato = (rCli.data || []).find(c => String(c.id) === String(rMe.data.id));
          const completo: Cliente = candidato || { id: rMe.data.id, nome: rMe.data.nome, tipo: rMe.data.tipo };
          setDados(completo);
          setCelular(completo.celular || "");
        } catch {
          setDados({ id: rMe.data.id, nome: rMe.data.nome, tipo: rMe.data.tipo } as Cliente);
          setCelular("");
        }
      } catch (e: unknown) {
        console.error(e);
        setMsg(toApiMsg(e));
      } finally {
        setCarregandoPerfil(false);
      }
    };

    load();
  }, [API_URL, isChecking]);

  const formatISODate = (iso?: string | null) => {
    if (!iso) return "";
    const s = String(iso).slice(0, 10);
    const [y, m, d] = s.split("-");
    if (!y || !m || !d) return "";
    return `${d}/${m}/${y}`;
  };

  const celularValido = celular.trim().length >= 10;
  const houveMudanca = celular.trim() !== (dados?.celular || "");

  const salvar = async () => {
    if (!celularValido || !houveMudanca) return;
    setSalvando(true);
    setMsg("");
    try {
      const r = await axios.patch<Cliente>(
        `${API_URL}/usuarios/me/celular`,
        { celular: celular.trim() },
        { withCredentials: true }
      );
      setDados(r.data);
      setCelular(r.data.celular || "");
      setMsg("Celular atualizado com sucesso!");
    } catch (e: unknown) {
      console.error(e);
      setMsg(toApiMsg(e));
    } finally {
      setSalvando(false);
    }
  };

  if (isChecking) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#f5f5f5]">
        <div className="flex items-center gap-3 text-gray-600">
          <Spinner size="w-8 h-8" /> <span>Carregando…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 py-5">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label="Voltar"
            className="rounded-full bg-white/15 hover:bg-white/25 transition p-2 leading-none"
          >
            <span className="inline-block rotate-180 text-xl cursor-pointer">➜</span>
          </button>
          <h1 className="text-2xl font-extrabold drop-shadow-sm">Perfil</h1>
        </div>
      </header>

      <section className="px-4 py-4">
        <div className="mx-auto max-w-sm bg-white rounded-2xl shadow-md p-4 space-y-3">
          {msg && (
            <div
              className={`text-center text-[13px] rounded-md px-3 py-2 ${
                msg.toLowerCase().includes("sucesso")
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {msg}
            </div>
          )}

          {carregandoPerfil ? (
            <div className="py-10 flex items-center justify-center text-gray-600">
              <Spinner /> <span className="ml-2 text-sm">Carregando perfil…</span>
            </div>
          ) : (
            <>
              <Campo label="Nome completo">
                <input
                  type="text"
                  disabled
                  value={dados?.nome || me?.nome || ""}
                  className="w-full rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-700"
                  placeholder="Insira o nome do usuário"
                />
              </Campo>

              <Campo label="Data de nascimento">
                <input
                  type="text"
                  disabled
                  value={formatISODate(dados?.nascimento)}
                  className="w-full rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-700"
                  placeholder="Insira a data de nascimento"
                />
              </Campo>

              <Campo label="CPF">
                <input
                  type="text"
                  disabled
                  value={dados?.cpf || ""}
                  className="w-full rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-700"
                  placeholder="Insira o CPF"
                />
              </Campo>

              <Campo label="E-mail">
                <input
                  type="email"
                  disabled
                  value={dados?.email || ""}
                  className="w-full rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-700"
                  placeholder="Insira o e-mail"
                />
              </Campo>

              <Campo label="Celular">
                <input
                  type="tel"
                  value={celular}
                  onChange={(e) => setCelular(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                  placeholder="Insira o telefone"
                />
              </Campo>

              <button
                onClick={salvar}
                disabled={!celularValido || !houveMudanca || salvando}
                className={`w-full rounded-lg px-4 py-2 font-semibold text-white transition
                  ${
                    !celularValido || !houveMudanca || salvando
                      ? "bg-orange-400/60 cursor-not-allowed"
                      : "bg-orange-600 hover:bg-orange-700"
                  }`}
              >
                {salvando ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size="w-4 h-4" /> Salvando…
                  </span>
                ) : (
                  "Salvar alterações"
                )}
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-gray-600 mb-1">
        {label}:
      </label>
      {children}
    </div>
  );
}
