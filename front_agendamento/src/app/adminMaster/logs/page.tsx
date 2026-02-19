"use client";

// src/app/adminMaster/logs/page.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Spinner from "@/components/Spinner";
import AppImage from "@/components/AppImage";
import {
  actorDisplay,
  eventLabel,
  targetTypeLabel,
  targetDisplay,
  ownerDisplay,
  resumoHumano,
  fullSentence,
  type AuditItem,
} from "../../../utils/auditUi";
import { useRouter, useSearchParams } from "next/navigation";

type ApiResponse = {
  page: number;
  size: number;
  total: number;
  items: AuditItem[];
};

/** =========================
 *  Tipos (quadras)
========================= */
type QuadraAPI = {
  id?: string;
  quadraId?: string;
  nome: string;
  numero: number;
  logoUrl?: string | null;
  imagem?: string | null;
  arquivo?: string | null;
};

type QuadraOpt = {
  id: string;
  nome: string;
  numero: number;
  logoUrl?: string;
};

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

export default function LogsPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string>("");

  // ✅ controla primeira hidratação da URL
  const [hydrated, setHydrated] = useState(false);

  // paginação
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(300);
  const [goto, setGoto] = useState<string>("");

  // 🔎 filtro por usuário (nome/email/UUID) com debounce + sync URL
  const [qUser, setQUser] = useState<string>("");
  const [qUserDebounced, setQUserDebounced] = useState<string>("");

  // 📅 filtro por DIA e HORA (hora em janela 1h)
  const [day, setDay] = useState<string>("");
  const [hour, setHour] = useState<string>(""); // "" | "0".."23"

  // ✅ filtro de quadra (AGORA: BACKEND) + sync URL
  const [quadras, setQuadras] = useState<QuadraOpt[]>([]);
  const [quadraLogos, setQuadraLogos] = useState<Record<string, string>>({});
  const [quadraId, setQuadraId] = useState<string>(""); // "" = todas
  const [loadingQuadras, setLoadingQuadras] = useState(false);

  // dropdown quadra (com imagem)
  const [quadraOpen, setQuadraOpen] = useState(false);
  const quadraWrapRef = useRef<HTMLDivElement | null>(null);

  // modal de detalhes
  const [selecionado, setSelecionado] = useState<AuditItem | null>(null);

  // ref p/ focar no input (atalho '/')
  const userInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ abort do request anterior (evita corrida e overwrite de dados)
  const abortRef = useRef<AbortController | null>(null);

  // helpers p/ imagem (igual teu padrão)
  const toAbs = (u?: string | null) => {
    if (!u) return "";
    if (/^(https?:|data:|blob:)/i.test(u)) return u;
    if (u.startsWith("/")) return `${API_URL}${u}`;
    return `${API_URL}/${u}`;
  };

  const buildQuadraLogo = (q: Partial<QuadraAPI>) => {
    const candidate = q.logoUrl || q.imagem || q.arquivo || "";
    const normalized =
      candidate &&
        !/^(https?:|data:|blob:)/i.test(String(candidate)) &&
        !String(candidate).startsWith("/") &&
        !String(candidate).includes("/")
        ? `/uploads/quadras/${candidate}`
        : String(candidate);

    return toAbs(normalized) || "";
  };

  // ===== inicializa estados a partir da URL (deep-link)
  useEffect(() => {
    const p = parseInt(searchParams.get("page") || "1", 10);
    const s = parseInt(searchParams.get("size") || "300", 10);
    const q = searchParams.get("qUser") || "";

    const urlDay = searchParams.get("day") || "";
    const urlHour = searchParams.get("hour") || "";
    const urlQuadraId = searchParams.get("quadraId") || "";

    const nextPage = Number.isFinite(p) && p > 0 ? p : 1;
    const nextSize = [25, 50, 100, 300].includes(s) ? s : 300;

    let nextDay = "";
    let nextHour = "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(urlDay)) nextDay = urlDay;

    if (/^\d+$/.test(urlHour) && nextDay) {
      const n = Number(urlHour);
      if (Number.isFinite(n) && n >= 0 && n <= 23) nextHour = String(n);
    }

    setPage(nextPage);
    setPageSize(nextSize);

    setQUser(q);
    setQUserDebounced(q.trim());

    setDay(nextDay);
    setHour(nextHour);

    // ✅ quadraId (URL)
    setQuadraId(urlQuadraId);

    // ✅ libera buscas só depois de setar tudo
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // só na carga

  // ===== fecha dropdown ao clicar fora
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!quadraWrapRef.current) return;
      if (!quadraWrapRef.current.contains(e.target as Node)) setQuadraOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // ===== carrega quadras + mapa de logos (para EXIBIÇÃO/SELETOR)
  useEffect(() => {
    const controller = new AbortController();

    const loadQuadras = async () => {
      try {
        setLoadingQuadras(true);

        const { data } = await axios.get<QuadraAPI[]>(`${API_URL}/quadras`, {
          withCredentials: true,
          signal: controller.signal,
        });

        const list: QuadraOpt[] = [];
        const map: Record<string, string> = {};

        (data || []).forEach((q) => {
          const id = String(q.id ?? q.quadraId ?? "");
          if (!id) return;

          const logo = buildQuadraLogo(q);
          if (logo) map[id] = logo;

          list.push({
            id,
            nome: q.nome,
            numero: q.numero,
            logoUrl: logo || "",
          });
        });

        list.sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0) || a.nome.localeCompare(b.nome));

        setQuadras(list);
        setQuadraLogos(map);
      } catch (e) {
        if (!controller.signal.aborted) {
          console.warn("Não foi possível carregar /quadras para filtro de imagens.", e);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingQuadras(false);
      }
    };

    loadQuadras();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL]);

  // ===== atualiza URL quando page/pageSize/qUserDebounced/day/hour/quadraId mudam
  useEffect(() => {
    if (!hydrated) return;

    const usp = new URLSearchParams();
    usp.set("page", String(page));
    usp.set("size", String(pageSize));
    if (qUserDebounced) usp.set("qUser", qUserDebounced);

    if (day) usp.set("day", day);
    if (day && hour !== "") usp.set("hour", hour);

    // ✅ quadraId (BACKEND)
    if (quadraId) usp.set("quadraId", quadraId);

    router.replace(`/adminMaster/logs?${usp.toString()}`, { scroll: false });
  }, [hydrated, page, pageSize, qUserDebounced, day, hour, quadraId, router]);

  // ===== debounce do qUser digitado
  useEffect(() => {
    const t = setTimeout(() => {
      setQUserDebounced(qUser.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [qUser]);

  // ===== atalho '/' para focar; ESC limpa
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/") {
        e.preventDefault();
        userInputRef.current?.focus();
      } else if (e.key === "Escape") {
        if (qUser.length > 0) {
          setQUser("");
          setQUserDebounced("");
          setPage(1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qUser.length]);

  async function fetchLogs(
    p = 1,
    size = pageSize,
    q?: string,
    opts?: { day?: string; hour?: string; quadraId?: string }
  ) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setErro("");

    try {
      const params: Record<string, any> = { page: p, size };

      if (q && q.length > 0) params.qUser = q;

      if (opts?.day) params.day = opts.day;
      if (opts?.day && opts?.hour !== "" && opts?.hour != null) params.hour = Number(opts.hour);

      // ✅ IMPORTANTE: filtro REAL no BACKEND
      if (opts?.quadraId) params.quadraId = opts.quadraId;

      const { data: json } = await axios.get<ApiResponse>(`${API_URL}/audit/logs`, {
        params,
        withCredentials: true,
        signal: ac.signal,
      });

      setData(json);
    } catch (e: any) {
      if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;

      console.error("Falha ao carregar logs:", e);
      const msg = e?.response?.data?.erro || e?.response?.data?.message || "Erro ao carregar os logs.";
      setErro(String(msg));
      setData({ page: 1, size, total: 0, items: [] });
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }

  // ✅ carrega quando página/tamanho mudam ou quando filtros mudam
  useEffect(() => {
    if (!hydrated) return;
    fetchLogs(page, pageSize, qUserDebounced, { day, hour, quadraId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, page, pageSize, qUserDebounced, day, hour, quadraId]);

  // ✅ cleanup no unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total || 0) / (data?.size || pageSize))),
    [data?.total, data?.size, pageSize]
  );

  const jumpPages = (delta: number) => {
    setPage((p) => Math.min(totalPages, Math.max(1, p + delta)));
  };

  const onGoto = () => {
    const n = parseInt(goto, 10);
    if (Number.isFinite(n)) setPage(Math.min(totalPages, Math.max(1, n)));
  };

  const fmtPtBR = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const fmtDiaPtBR = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    if (!y || !m || !d) return ymd;
    return `${d}/${m}/${y}`;
  };

  const hourLabel = (h: string) =>
    `${h.padStart(2, "0")}:00–${String(Number(h) + 1).padStart(2, "0")}:00`;

  const clearDateHour = () => {
    setDay("");
    setHour("");
    setPage(1);
  };

  const quadraSelecionada = useMemo(() => {
    if (!quadraId) return null;
    return quadras.find((q) => String(q.id) === String(quadraId)) || null;
  }, [quadraId, quadras]);

  const clearQuadra = () => {
    setQuadraId("");
    setPage(1);
  };

  // =========================
  // ✅ Helpers de quadra no log (metadata) — só para EXIBIR
  // =========================
  const getQuadraIdFromItem = (it: AuditItem): string => {
    const md = isRecord((it as any).metadata) ? ((it as any).metadata as any) : null;
    const id = md?.quadraId ?? md?.quadra?.id ?? null;
    return id ? String(id) : "";
  };

  const getQuadraLabelFromItem = (it: AuditItem): { nome: string; numero: string } => {
    const md = isRecord((it as any).metadata) ? ((it as any).metadata as any) : null;

    const nome = md?.quadraNome ? String(md.quadraNome) : "";
    const num =
      md?.quadraNumero != null && md.quadraNumero !== "" ? String(md.quadraNumero) : "";

    const id = getQuadraIdFromItem(it);
    if ((!nome || !num) && id && quadras.length) {
      const q = quadras.find((x) => String(x.id) === String(id));
      if (q) return { nome: nome || q.nome, numero: num || String(q.numero) };
    }

    return { nome, numero: num };
  };

  const getQuadraLogoFromItem = (it: AuditItem): string => {
    const id = getQuadraIdFromItem(it);
    if (!id) return "";
    return quadraLogos[id] || "";
  };

  // ✅ agora a lista vem filtrada do BACK
  const items = data?.items ?? [];

  return (
    <div className="p-4 space-y-4">
      {/* Top bar + controles */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Logs de Auditoria</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 🔎 Campo de busca por usuário */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">Busca por usuário:</label>
            <div className="relative">
              <input
                ref={userInputRef}
                type="text"
                value={qUser}
                onChange={(e) => setQUser(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setQUserDebounced(qUser.trim());
                    setPage(1);
                  }
                }}
                placeholder="Digite o nome..."
                className="border rounded px-3 py-1.5 text-sm w-60 pr-10 focus:outline-none focus:ring-2 focus:ring-orange-300"
                aria-label="Buscar por usuário"
              />

              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                {loading ? (
                  <div className="scale-75 opacity-70">
                    <Spinner />
                  </div>
                ) : (
                  <span className="text-gray-400 text-xs">↵</span>
                )}
              </div>

              {!!qUser && (
                <button
                  type="button"
                  onClick={() => {
                    setQUser("");
                    setQUserDebounced("");
                    setPage(1);
                    userInputRef.current?.focus();
                  }}
                  title="Limpar"
                  className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                  aria-label="Limpar busca"
                >
                  ×
                </button>
              )}
            </div>
          </div>


          {/* 📅 Filtro por DIA */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">Dia:</label>
            <input
              type="date"
              value={day}
              onChange={(e) => {
                const v = e.target.value;
                setDay(v);
                if (!v) setHour("");
                setPage(1);
              }}
              className="border rounded px-2 py-1.5 text-sm"
              aria-label="Filtrar por dia"
            />
          </div>

          {/* 🕐 Filtro por HORA */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">Hora:</label>
            <select
              className="border rounded px-2 py-1.5 text-sm"
              value={hour}
              disabled={!day}
              onChange={(e) => {
                setHour(e.target.value);
                setPage(1);
              }}
              title={!day ? "Selecione um dia primeiro" : "Filtrar por janela de 1 hora"}
              aria-label="Filtrar por hora (janela de 1 hora)"
            >
              <option value="">Todas</option>
              {Array.from({ length: 24 }).map((_, i) => (
                <option key={i} value={String(i)}>
                  {hourLabel(String(i))}
                </option>
              ))}
            </select>

            {(day || hour !== "") && (
              <button
                type="button"
                onClick={clearDateHour}
                className="px-2 py-1.5 rounded border text-sm hover:bg-gray-50"
                title="Limpar data/hora"
              >
                Limpar
              </button>
            )}
          </div>

                    {/* ✅ Filtro por QUADRA (BACKEND) */}
          <div className="flex items-center gap-2" ref={quadraWrapRef}>
            <label className="text-sm text-gray-600 whitespace-nowrap">Quadra:</label>

            <div className="relative">
              <button
                type="button"
                onClick={() => setQuadraOpen((v) => !v)}
                className="border rounded px-2 py-1.5 text-sm bg-white hover:bg-gray-50 flex items-center gap-2 min-w-[220px]"
                title="Filtrar por quadra"
              >
                {quadraSelecionada ? (
                  <>
                    <div className="relative w-10 h-6 overflow-hidden rounded bg-gray-100 border">
                      <AppImage
                        src={quadraSelecionada.logoUrl || "/quadra.png"}
                        alt={quadraSelecionada.nome}
                        fill
                        className="object-contain"
                        fallbackSrc="/quadra.png"
                      />
                    </div>
                    <span className="truncate">
                      {quadraSelecionada.numero} - {quadraSelecionada.nome}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-600">Todas</span>
                )}
                <span className="ml-auto text-gray-400">▾</span>
              </button>

              {quadraOpen && (
                <div
                  className="absolute z-50 mt-1 left-0 right-0 bg-white border rounded-lg shadow-lg overflow-hidden"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50"
                    onClick={() => {
                      setQuadraId("");
                      setPage(1);
                      setQuadraOpen(false);
                    }}
                  >
                    Todas
                  </button>

                  <div className="max-h-72 overflow-y-auto border-t">
                    {loadingQuadras && (
                      <div className="px-3 py-2 text-sm text-gray-500">Carregando quadras…</div>
                    )}

                    {!loadingQuadras && quadras.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500">Nenhuma quadra encontrada.</div>
                    )}

                    {!loadingQuadras &&
                      quadras.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-orange-50 ${String(quadraId) === String(q.id) ? "bg-orange-50" : ""
                            }`}
                          onClick={() => {
                            setQuadraId(String(q.id));
                            setPage(1);
                            setQuadraOpen(false);
                          }}
                        >
                          <div className="relative w-12 h-7 overflow-hidden rounded bg-gray-100  shrink-0">
                            <AppImage
                              src={q.logoUrl || "/quadra.png"}
                              alt={q.nome}
                              fill
                              className="object-contain"
                              fallbackSrc="/quadra.png"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-800 truncate">{q.nome}</div>
                            <div className="text-xs text-gray-500">Quadra {q.numero}</div>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>


          <label className="text-sm text-gray-600">Registros/página:</label>
          <select
            className="border rounded px-2 py-1.5 text-sm"
            value={pageSize}
            onChange={(e) => {
              const sz = parseInt(e.target.value, 10);
              setPageSize(sz);
              setPage(1);
            }}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={300}>300</option>
          </select>

          <button
            onClick={() => fetchLogs(page, pageSize, qUserDebounced, { day, hour, quadraId })}
            disabled={loading || !hydrated}
            className="px-3 py-1.5 rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
            title="Atualizar"
          >
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </div>

      

      {/* Badges/estado da busca */}
      <div className="flex flex-wrap items-center gap-2">
        {qUserDebounced && (
          <span
            className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-gray-100 border"
            title="Filtro aplicado"
          >
            Filtro usuário: <b className="max-w-[220px] truncate">{qUserDebounced}</b>
            <button
              onClick={() => {
                setQUser("");
                setQUserDebounced("");
                setPage(1);
              }}
              className="text-gray-600 hover:text-gray-900"
              title="Limpar filtro"
            >
              ×
            </button>
          </span>
        )}

        {day && (
          <span
            className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-gray-100 border"
            title="Filtro aplicado"
          >
            Dia: <b>{fmtDiaPtBR(day)}</b>
            {hour !== "" && (
              <>
                <span className="text-gray-400">•</span>
                Hora: <b>{hourLabel(hour)}</b>
              </>
            )}
            <button
              onClick={clearDateHour}
              className="text-gray-600 hover:text-gray-900"
              title="Limpar filtro"
            >
              ×
            </button>
          </span>
        )}

        {quadraSelecionada && (
          <span
            className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-gray-100 border"
            title="Filtro de quadra aplicado (backend)"
          >
            Quadra:{" "}
            <b>
              {quadraSelecionada.numero} - {quadraSelecionada.nome}
            </b>
            <button onClick={clearQuadra} className="text-gray-600 hover:text-gray-900" title="Limpar quadra">
              ×
            </button>
          </span>
        )}

        {data && (
          <span className="text-xs text-gray-600">
            Total: <b>{data.total}</b>
          </span>
        )}
      </div>

      {erro && <div className="text-sm text-red-600">{erro}</div>}

      {/* Loading inicial */}
      {loading && !data && (
        <div className="flex items-center gap-2 text-gray-700">
          <Spinner /> <span>Carregando logs…</span>
        </div>
      )}

      {/* ===== Mobile (cards) ===== */}
      {data && (
        <div className="space-y-2 md:hidden">
          {items.length === 0 && !loading && <div className="text-gray-600">Nenhum log encontrado.</div>}

          {items.map((it) => {
            const [titulo] = fullSentence(it);
            const qLabel = getQuadraLabelFromItem(it);
            const qLogo = getQuadraLogoFromItem(it);

            return (
              <button
                key={it.id}
                className="w-full text-left bg-white border rounded-lg p-3 shadow-sm active:scale-[0.99]"
                onClick={() => setSelecionado(it)}
                title="Ver detalhes"
              >
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">{fmtPtBR(it.createdAt)}</div>
                  <div className="font-medium text-sm leading-snug break-words">{eventLabel(it.event)}</div>
                  <div className="text-xs text-gray-500">{targetTypeLabel(it.targetType)}</div>
                </div>

                {(qLabel.nome || qLabel.numero) && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="relative w-12 h-7 overflow-hidden rounded bg-gray-100 border shrink-0">
                      <AppImage
                        src={qLogo || "/quadra.png"}
                        alt={qLabel.nome || "Quadra"}
                        fill
                        className="object-contain"
                        fallbackSrc="/quadra.png"
                      />
                    </div>
                    <div className="text-xs text-gray-700 truncate">
                      <b>{qLabel.numero ? `Quadra ${qLabel.numero}` : "Quadra"}</b>
                      {qLabel.nome ? ` • ${qLabel.nome}` : ""}
                    </div>
                  </div>
                )}

                <div className="mt-2 text-sm">
                  <div className="text-gray-900 line-clamp-3">{titulo}</div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div className="truncate">
                      <span className="text-gray-500">Quem: </span>
                      {actorDisplay(it)}
                    </div>
                    <div className="truncate">
                      <span className="text-gray-500">Dono: </span>
                      {ownerDisplay(it)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ===== Desktop (tabela) ===== */}
      {data && (
        <div className="rounded border relative hidden md:block">
          {loading && (
            <div className="absolute inset-x-0 top-0 bg-white/70 backdrop-blur-sm py-1 flex items-center justify-center border-b z-10">
              <span className="inline-flex items-center gap-2 text-gray-700 text-sm">
                <Spinner /> carregando…
              </span>
            </div>
          )}

          <table className="w-full table-auto text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left p-2 align-top">Quando</th>
                <th className="text-left p-2 align-top">Evento</th>
                <th className="text-left p-2 align-top">Quem fez</th>
                <th className="text-left p-2 align-top">Alvo</th>
                <th className="text-left p-2 align-top">Dono do Alvo</th>
                <th className="text-left p-2 align-top">Resumo</th>
              </tr>
            </thead>
            <tbody>
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-gray-600">
                    Nenhum log encontrado.
                  </td>
                </tr>
              )}

              {items.map((it) => {
                const qLabel = getQuadraLabelFromItem(it);
                const qLogo = getQuadraLogoFromItem(it);

                return (
                  <tr
                    key={it.id}
                    className="border-t hover:bg-orange-50 cursor-pointer align-top"
                    onClick={() => setSelecionado(it)}
                    title="Ver detalhes"
                  >
                    <td className="p-2 whitespace-nowrap align-top">{fmtPtBR(it.createdAt)}</td>
                    <td className="p-2 whitespace-normal break-words align-top">
                      <div className="font-medium">{eventLabel(it.event)}</div>
                      <div className="text-gray-500">{targetTypeLabel(it.targetType)}</div>
                    </td>
                    <td className="p-2 whitespace-normal break-words align-top">{actorDisplay(it)}</td>
                    <td className="p-2 whitespace-normal break-words align-top">{targetDisplay(it)}</td>
                    <td className="p-2 whitespace-normal break-words align-top">{ownerDisplay(it)}</td>


                    <td className="p-2 whitespace-normal break-words align-top">{resumoHumano(it)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {data && data.total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage(1)}
              title="Primeira"
            >
              «
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => jumpPages(-5)}
              title="-5 páginas"
            >
              « −5
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              title="Anterior"
            >
              Anterior
            </button>
          </div>

          <span className="text-sm">
            Página {data.page} / {totalPages}
          </span>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={data.page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              title="Próxima"
            >
              Próxima
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={data.page >= totalPages || loading}
              onClick={() => jumpPages(+5)}
              title="+5 páginas"
            >
              +5 »
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={data.page >= totalPages || loading}
              onClick={() => setPage(totalPages)}
              title="Última"
            >
              »
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Ir para:</label>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={goto}
              onChange={(e) => setGoto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onGoto();
              }}
              className="w-24 border rounded px-2 py-1 text-sm"
            />
            <button onClick={onGoto} disabled={loading || !goto} className="px-3 py-1 rounded border">
              Ir
            </button>
          </div>

          {loading && (
            <span className="inline-flex items-center gap-2 text-gray-600">
              <Spinner /> trocando de página…
            </span>
          )}
        </div>
      )}

      {/* MODAL — full-screen no mobile */}
      {selecionado && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-0 md:p-3">
          <div className="bg-white rounded-none md:rounded-lg shadow-lg w-full h-full md:h-auto md:max-w-2xl md:p-5 p-4 overflow-y-auto relative">
            <button
              className="absolute right-3 top-3 text-gray-500 hover:text-gray-800 text-2xl"
              onClick={() => setSelecionado(null)}
              aria-label="Fechar"
            >
              ×
            </button>

            <h2 className="text-lg font-semibold mb-1">{eventLabel(selecionado.event)}</h2>
            <p className="text-xs md:text-sm text-gray-600 mb-3">{fmtPtBR(selecionado.createdAt)}</p>

            {(() => {
              const qLabel = getQuadraLabelFromItem(selecionado);
              const qLogo = getQuadraLogoFromItem(selecionado);
              if (!qLabel.nome && !qLabel.numero) return null;

              return (
                <div className="mb-3 flex items-center gap-3">
                  <div className="relative w-20 h-12 overflow-hidden rounded bg-gray-100 border shrink-0">
                    <AppImage
                      src={qLogo || "/quadra.png"}
                      alt={qLabel.nome || "Quadra"}
                      fill
                      className="object-contain"
                      fallbackSrc="/quadra.png"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{qLabel.nome || "Quadra"}</div>
                    <div className="text-xs text-gray-500">{qLabel.numero ? `Quadra ${qLabel.numero}` : "—"}</div>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-3">
              {(() => {
                const [titulo, bullets] = fullSentence(selecionado);
                return (
                  <>
                    <p className="text-base leading-relaxed">{titulo}</p>
                    {bullets.length > 0 && (
                      <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
                        {bullets.map((b, i) => (
                          <li key={i} className="break-words">
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                );
              })()}
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-600">Ver detalhes técnicos</summary>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-gray-500">Quem fez:</span>{" "}
                  <span className="font-medium">{actorDisplay(selecionado)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Tipo de alvo:</span>{" "}
                  <span className="font-medium">{targetTypeLabel(selecionado.targetType)}</span>
                </div>
                <div className="break-words">
                  <span className="text-gray-500">Alvo:</span> <span className="font-medium">{targetDisplay(selecionado)}</span>
                </div>
                <div className="break-words">
                  <span className="text-gray-500">Dono do alvo:</span>{" "}
                  <span className="font-medium">{ownerDisplay(selecionado)}</span>
                </div>
                {(selecionado as any).ip && (
                  <div>
                    <span className="text-gray-500">IP:</span> <span className="font-medium">{(selecionado as any).ip}</span>
                  </div>
                )}
                {(selecionado as any).userAgent && (
                  <div className="sm:col-span-2 break-words">
                    <span className="text-gray-500">Navegador:</span>{" "}
                    <span className="font-medium">{(selecionado as any).userAgent}</span>
                  </div>
                )}
              </div>

              {(selecionado as any).metadata && (
                <pre className="mt-3 p-2 bg-gray-50 rounded border overflow-auto text-xs">
                  {JSON.stringify((selecionado as any).metadata, null, 2)}
                </pre>
              )}
            </details>

            <div className="mt-5 flex justify-end">
              <button className="px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700" onClick={() => setSelecionado(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
