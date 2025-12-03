"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import axios from "axios";

import { useAuthStore } from "@/context/AuthStore";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import { isoLocalDate } from "@/utils/date";
import AppImage from "@/components/AppImage";

/* ========= Tipos ========= */
type AgendamentoAPI = {
  id: string;
  status?: "CONFIRMADO" | "FINALIZADO" | "CANCELADO" | "TRANSFERIDO";
  horario: string;
  data?: string;
  nome?: string;
  local?: string;
  logoUrl?: string;
  quadraNome?: string;
  quadraNumero?: number | string | null;
  quadraLogoUrl?: string;
  esporteNome?: string;
  quadra?: { nome?: string; numero?: number | string | null; imagem?: string | null };
  esporte?: { nome?: string };
};

type CardAgendamento = {
  id: string;
  rawId: string;
  logoUrl: string;
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;
  hora: string;
};

type UsuarioBusca = { id: string; nome: string; email: string };

/* ========= Página ========= */
export default function TransferirQuadraPage() {
  // 🔒 Proteção (mesmo conjunto da Home)
  const { isChecking } = useRequireAuth([
    "CLIENTE",
    "ADMIN_MASTER",
    "ADMIN_ATENDENTE",
    "ADMIN_PROFESSORES",
  ]);

  const router = useRouter();
  const { usuario } = useAuthStore();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [lista, setLista] = useState<CardAgendamento[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(false);

  const [selecionado, setSelecionado] = useState<CardAgendamento | null>(null);

  // busca destino
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<UsuarioBusca[]>([]);
  const [carregandoBusca, setCarregandoBusca] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [destino, setDestino] = useState<UsuarioBusca | null>(null);

  const [enviando, setEnviando] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const UPLOADS_PREFIX = (process.env.NEXT_PUBLIC_UPLOADS_PREFIX || "/uploads/quadras").trim();
  const hojeISO = useMemo(() => isoLocalDate(new Date(), "America/Sao_Paulo"), []);

  const paraDDMM = useCallback((iso?: string) => {
    const s = (iso || hojeISO).slice(0, 10);
    const [, m, d] = s.split("-");
    return `${d}/${m}`;
  }, [hojeISO]);

  const extrairNumeroDoLocal = (local?: string) => {
    if (!local) return undefined;
    const m = local.match(/N[ºo]\s*(\d+)/i);
    return m?.[1] || undefined;
  };

  /** Normaliza item para card (deixa a AppImage resolver a URL) */
  const normalizar = useCallback(
    (raw: AgendamentoAPI): CardAgendamento => {
      const logoUrl =
        (raw.quadraLogoUrl || raw.logoUrl || raw.quadra?.imagem || "/quadra.png");

      const esporte = raw.esporteNome || raw.esporte?.nome || raw.nome || "";
      const quadraNome =
        raw.quadraNome || raw.quadra?.nome || (raw.local?.split(" - Nº")[0] ?? "Quadra");
      const numero =
        String(raw.quadraNumero ?? raw.quadra?.numero ?? extrairNumeroDoLocal(raw.local) ?? "") ||
        undefined;

      return {
        id: raw.id,
        rawId: raw.id,
        logoUrl,
        quadraNome,
        numero,
        esporte,
        dia: paraDDMM(raw.data),
        hora: raw.horario,
      };
    },
    [paraDDMM]
  );

  /* === Carrega CONFIRMADOS futuros do usuário === */
  useEffect(() => {
    if (isChecking) return;
    const fetch = async () => {
      if (!usuario?.id) return;
      setCarregandoLista(true);
      try {
        const { data } = await axios.get<AgendamentoAPI[]>(`${API_URL}/agendamentos`, {
          withCredentials: true,
          params: { usuarioId: usuario.id },
        });
        const hoje = hojeISO;
        const confirmadosFuturos = (data || [])
          .filter((a) => a.status === "CONFIRMADO")
          .filter((a) => (a.data ?? "").slice(0, 10) >= hoje);

        confirmadosFuturos.sort((a, b) => {
          const da = (a.data ?? "").slice(0, 10);
          const db = (b.data ?? "").slice(0, 10);
          if (da !== db) return da.localeCompare(db);
          return (a.horario || "").localeCompare(b.horario || "");
        });

        setLista(confirmadosFuturos.map(normalizar));
      } catch (e) {
        console.error(e);
        setLista([]);
      } finally {
        setCarregandoLista(false);
      }
    };
    fetch();
  }, [API_URL, usuario?.id, hojeISO, isChecking, normalizar]);

  /* === Autocomplete === */
  useEffect(() => {
    if (isChecking) return;

    let cancel = false;
    const run = async () => {
      const termo = busca.trim();
      if (termo.length < 2) {
        setResultados([]);
        setActiveIndex(-1);
        return;
      }
      setCarregandoBusca(true);
      try {
        const { data } = await axios.get<UsuarioBusca[]>(`${API_URL}/clientes`, {
          params: { nome: termo },
          withCredentials: true,
        });
        if (!cancel) {
          const filtrados = (data || []).filter((u) => u.id !== usuario?.id).slice(0, 8);
          setResultados(filtrados);
          setActiveIndex(filtrados.length ? 0 : -1);
        }
      } catch {
        if (!cancel) {
          setResultados([]);
          setActiveIndex(-1);
        }
      } finally {
        if (!cancel) setCarregandoBusca(false);
      }
    };
    const t = setTimeout(run, 220);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [busca, API_URL, usuario?.id, isChecking]);

  /* === Ação: transferir === */
  const podeTransferir = !!selecionado && !!destino && destino.id !== usuario?.id && !enviando;

  const realizarTransferencia = async () => {
    if (!selecionado || !destino || !usuario?.id) return;
    setEnviando(true);
    try {
      await axios.patch(
        `${API_URL}/agendamentos/${selecionado.rawId}/transferir`,
        { novoUsuarioId: destino.id, transferidoPorId: usuario.id },
        { withCredentials: true }
      );
      setStep(3);
    } catch (e) {
      console.error(e);
      alert("Não foi possível realizar a transferência. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  /* === Navegação (voltar no header) === */
  const handleBack = () => {
    if (step === 1) return router.back();
    if (step === 2) {
      setDestino(null);
      setBusca("");
      setResultados([]);
      setActiveIndex(-1);
      return setStep(1);
    }
    if (step === 3) return router.push("/");
  };

  /* === Header (estilo do protótipo) === */
  const Header = (
    <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 py-5  shadow">
      <div className="max-w-sm mx-auto flex items-center gap-3">
        <button
          onClick={handleBack}
          aria-label="Voltar"
          className="rounded-full bg-white/15 hover:bg-white/25 transition p-2 leading-none"
        >
          <span className="inline-block rotate-180 text-xl cursor-pointer">➜</span>
        </button>
        <h1 className="text-2xl font-extrabold tracking-wide drop-shadow-sm">
          {step === 1 && "Transfira a sua quadra"}
          {step === 2 && "Transfira a sua quadra"}
          {step === 3 && "Transferência confirmada"}
        </h1>
      </div>
    </header>
  );

  /* === Busca (refinada) === */
  const BuscaUsuario = (
    <div className="relative">
      <label className="text-sm text-gray-700">Transferir para:</label>

      {destino ? (
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
            {destino.nome.split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-800 truncate">{destino.nome}</div>
            <div className="text-[12px] text-gray-500 truncate">{destino.email}</div>
          </div>
          <button
            onClick={() => {
              setDestino(null);
              setBusca("");
              setResultados([]);
              setActiveIndex(-1);
            }}
            className="ml-auto rounded-md px-2 py-1 text-[12px] bg-gray-100 hover:bg-gray-200 cursor-pointer"
          >
            Limpar
          </button>
        </div>
      ) : (
        <div className="mt-1 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-60">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={(e) => {
              if (!resultados.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % resultados.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + resultados.length) % resultados.length);
              } else if (e.key === "Enter" && activeIndex >= 0) {
                e.preventDefault();
                const u = resultados[activeIndex];
                setDestino(u);
                setResultados([]);
                setBusca("");
                setActiveIndex(-1);
              } else if (e.key === "Escape") {
                setResultados([]);
                setActiveIndex(-1);
              }
            }}
            placeholder="Insira o nome do usuário"
            className="w-full rounded-xl border border-gray-300 bg-gray-50 pl-9 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {carregandoBusca && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Spinner size="w-4 h-4" />
            </div>
          )}

          {busca.trim().length >= 2 && resultados.length > 0 && (
            <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
              <ul role="listbox" className="max-h-64 overflow-auto divide-y divide-gray-100">
                {resultados.map((u, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => {
                          setDestino(u);
                          setResultados([]);
                          setBusca("");
                          setActiveIndex(-1);
                        }}
                        className={`w-full px-3 py-2 flex items-center gap-3 text-left transition ${isActive ? "bg-orange-50" : "bg-white"
                          } hover:bg-orange-50`}
                      >
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
                          {u.nome.split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-gray-800 truncate">{u.nome}</div>
                          <div className="text-[12px] text-gray-500 truncate">{u.email}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {busca.trim().length >= 2 && !carregandoBusca && resultados.length === 0 && (
            <div className="absolute z-10 mt-2 w-full rounded-xl border bg-white p-3 text-sm text-gray-500 shadow">
              Nenhum usuário encontrado.
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ⏳ Enquanto verifica cookie/usuário
  if (isChecking) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#f5f5f5]">
        <div className="flex items-center gap-3 text-gray-600">
          <Spinner size="w-8 h-8" />
          <span>Carregando…</span>
        </div>
      </main>
    );
  }

  /* ========= UI ========= */
  return (
    <main className="min-h-screen bg-[#f5f5f5]">
      {Header}

      <section className="px-4 md:px-0 py-4">
        <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-md p-4">
          {/* STEP 1 — lista */}
          {step === 1 && (
            <>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Escolha a quadra:</p>

              {carregandoLista && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Spinner size="w-4 h-4" />
                  <span className="text-sm">Carregando…</span>
                </div>
              )}

              {!carregandoLista && lista.length === 0 && (
                <p className="text-sm text-gray-500">Você não tem reservas confirmadas futuras.</p>
              )}

              <div className="space-y-3">
                {lista.map((a) => (
                  <div key={a.id} className="rounded-xl bg-[#f3f3f3] pt-3 pb-2 px-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 w-28 h-12 sm:w-36 sm:h-14 md:w-40 md:h-16 flex items-center justify-center overflow-hidden">
                        <AppImage
                          src={a.logoUrl}
                          alt={a.quadraNome}
                          width={320}
                          height={128}
                          className="w-full h-full object-contain select-none"
                          legacyDir="quadras"
                          fallbackSrc="/quadra.png"
                          forceUnoptimized
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-gray-800 truncate">{a.quadraNome}</p>
                        <p className="text-[12px] text-gray-600 leading-tight">{a.esporte}</p>
                        <p className="text-[12px] text-gray-500">
                          Dia {a.dia} às {a.hora}
                        </p>
                        {!!a.numero && <p className="text-[11px] text-gray-500">Quadra {a.numero}</p>}
                      </div>
                    </div>

                    <div className="mt-2 border-t border-gray-300/70" />
                    <button
                      onClick={() => {
                        setSelecionado(a);
                        setStep(2);
                      }}
                      className="w-full py-2 text-[13px] font-semibold text-orange-600 hover:text-orange-700 cursor-pointer"
                    >
                      Transferir quadra
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* STEP 2 — escolher destino */}
          {step === 2 && selecionado && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="rounded-xl bg-gray-50 p-2">
                  <div className="flex items-center gap-5">
                    <div className="shrink-0 w-28 h-12 sm:w-36 sm:h-14 md:w-40 md:h-16 flex items-center justify-center overflow-hidden">
                      <AppImage
                        src={selecionado.logoUrl}
                        alt={selecionado.quadraNome}
                        width={320}
                        height={128}
                        className="w-full h-full object-contain select-none"
                        legacyDir="quadras"
                        fallbackSrc="/quadra.png"
                        forceUnoptimized
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-gray-800 truncate">{selecionado.quadraNome}</p>
                      <p className="text-[12px] text-gray-600 leading-tight">{selecionado.esporte}</p>
                      <p className="text-[12px] text-gray-500">Dia {selecionado.dia} às {selecionado.hora}</p>
                    </div>
                  </div>
                </div>
              </div>

              {BuscaUsuario}

              <div className="pt-1">
                <button
                  disabled={!podeTransferir}
                  onClick={realizarTransferencia}
                  className={`mx-auto flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-white text-sm font-semibold shadow-md cursor-pointer ${podeTransferir ? "bg-orange-600 hover:bg-orange-700" : "bg-orange-400/60 cursor-not-allowed"
                    }`}
                >
                  {enviando && <Spinner size="w-4 h-4" />}
                  <span>{enviando ? "Enviando..." : "Realizar Transferência"}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — sucesso */}
          {step === 3 && (
            <div className="flex flex-col items-center text-center py-8">
              <div className="w-56 h-56 mb-4">
                <Image
                  src="/icons/realizada.png"
                  alt=""
                  width={224}
                  height={224}
                  className="w-full h-full object-contain"
                  priority
                />
              </div>
              <h2 className="text-xl font-extrabold text-orange-600 mb-4">Tranferência Realizada!</h2>
              <button
                onClick={() => router.push("/")}
                className="rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold px-4 py-2 shadow-md cursor-pointer"
              >
                Voltar à página inicial
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="supports-[padding:env(safe-area-inset-bottom)]:pb-[env(safe-area-inset-bottom)]" />
    </main>
  );
}


