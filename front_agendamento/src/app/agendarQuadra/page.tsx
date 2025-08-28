"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type PropsWithChildren,
  memo,
} from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import { isoLocalDate } from "@/utils/date";
import AppImage from "@/components/AppImage";

/* =========================================================
   Tipos
========================================================= */
type EsporteAPI = { id: string | number; nome: string; imagem?: string | null; logoUrl?: string | null };
type QuadraAPI = {
  id?: string;
  quadraId?: string;
  nome: string;
  numero: number;
  logoUrl?: string | null;
  imagem?: string | null;
  arquivo?: string | null;
};
type Disponibilidade = { quadraId: string; nome: string; numero: number; disponivel?: boolean };

type Esporte = { id: string; nome: string; logoUrl?: string };
type QuadraDisponivel = { quadraId: string; nome: string; numero: number; logoUrl?: string };

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type PlayerKind = "owner" | "registered" | "guest";
type Player = {
  id: string;
  kind: PlayerKind;
  value: string;
  userId?: string;
  // campos antigos (mantidos para compat)
  open?: boolean;
  search?: string;
  loading?: boolean;
  results?: { id: string; nome: string; email?: string }[];
};

type UsuarioBusca = { id: string; nome: string; email?: string | null };

type ReservaPayloadBase = {
  data: string;
  horario: string;
  esporteId: string;
  quadraId: string;
  tipoReserva: "COMUM";
};
type ReservaPayloadExtra = {
  jogadoresIds?: string[];
  convidadosNomes?: string[];
};

/* =========================================================
   Constantes e helpers
========================================================= */
const HORARIOS = [
  "08:00", "09:00", "10:00", "11:00", "12:00", "13:00",
  "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00",
] as const;

// Helpers de data/hora no fuso de São Paulo
const SP_TZ = "America/Sao_Paulo";
const todayIsoSP = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date()); // ex: "2025-03-07"

const hourNowSP = parseInt(
  new Intl.DateTimeFormat("en-US", {
    timeZone: SP_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(new Date()),
  10
); // ex: 18 (hora atual em SP)

function diasProximos(qtd = 7) {
  const out: { iso: string; d: number; mes: string; wd: string }[] = [];
  const wd = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const meses = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

  const base = new Date();
  for (let i = 0; i < qtd; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    const iso = isoLocalDate(dt);
    out.push({ iso, d: dt.getDate(), mes: meses[dt.getMonth()], wd: wd[dt.getDay()] });
  }
  return out;
}

function formatarDia(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function cryptoRandom() {
  if (typeof crypto !== "undefined") {
    const c = crypto as { randomUUID?: () => string };
    if (typeof c.randomUUID === "function") return c.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/* =========================================================
   Avatar + UserPicker (autocomplete)
========================================================= */
function initialsFromName(nome?: string) {
  if (!nome) return "";
  const [a = "", b = ""] = nome.trim().split(/\s+/);
  return (a[0] || "").concat(b[0] || "").toUpperCase();
}

function AvatarCircle({ label }: { label?: string }) {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-[12px] font-semibold text-gray-600">
      {initialsFromName(label)}
    </div>
  );
}

type UserPickerProps = {
  apiUrl: string;
  placeholder?: string;
  value?: string;
  onSelect(user: UsuarioBusca): void;
  onClear?(): void;
  excludeIds?: string[];
};

function UserPicker({
  apiUrl,
  placeholder = "Insira o nome do usuário",
  value,
  onSelect,
  onClear,
  excludeIds = [],
}: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(value || "");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UsuarioBusca[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTerm(value || "");
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open || term.trim().length < 2) {
      setResults([]);
      return;
    }

    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await axios.get<UsuarioBusca[]>(`${apiUrl}/clientes`, {
          params: { nome: term.trim() },
          withCredentials: true,
        });
        if (!cancel) {
          const lista = (res.data || []).filter((u) => !excludeIds.includes(u.id));
          setResults(lista);
        }
      } catch {
        if (!cancel) setResults([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    }, 300);

    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [open, term, apiUrl, excludeIds]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2">
        <input
          value={term}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-600/60"
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              setResults([]);
              setOpen(true);
              onClear?.();
            }}
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
            title="Limpar"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 overflow-hidden rounded-lg border bg-white shadow-lg ring-1 ring-black/5"
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading && (
            <div className="px-3 py-2 text-sm text-gray-500 flex items-center gap-2">
              <Spinner /> <span>Buscando…</span>
            </div>
          )}

          {!loading && results.length === 0 && term.trim().length >= 2 && (
            <div className="px-3 py-2 text-sm text-gray-500">Nenhum usuário encontrado.</div>
          )}

          {!loading && results.length > 0 && (
            <ul className="max-h-56 overflow-y-auto divide-y">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-orange-50"
                    onClick={() => {
                      onSelect(u);
                      setTerm(u.nome);
                      setOpen(false);
                    }}
                  >
                    <AvatarCircle label={u.nome || u.email || ""} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-800">{u.nome}</div>
                      {u.email && <div className="truncate text-[11px] text-gray-500">{u.email}</div>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   GuestField: input de convidado isolado
========================================================= */
const GuestField = memo(function GuestField({
  id,
  initialValue,
  onCommit,
  onRemove,
}: {
  id: string;
  initialValue: string;
  onCommit: (val: string) => void;
  onRemove: () => void;
}) {
  const [val, setVal] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setVal(initialValue ?? "");
  }, [initialValue]);

  const scheduleCommit = useCallback(
    (next: string) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        onCommit(next);
        timerRef.current = null;
      }, 120);
    },
    [onCommit]
  );

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={val}
        onChange={(e) => {
          const next = e.target.value;
          setVal(next);
          scheduleCommit(next);
        }}
        onBlur={() => onCommit(val)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        placeholder="Jogador convidado (sem cadastro)"
        className="w-full rounded-md border px-3 py-2 text-sm bg-white"
        ref={inputRef}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
        title="Remover"
      >
        ×
      </button>
    </div>
  );
});

/* =========================================================
   Página
========================================================= */
export default function AgendarQuadraCliente() {
  const router = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  // protege a rota
  const { isChecking } = useRequireAuth(["CLIENTE", "ADMIN_MASTER"]);
  const { usuario } = useAuthStore();

  // helpers URL (memoizada p/ não quebrar deps)
  const toAbs = useCallback(
    (u?: string | null) => {
      if (!u) return "";
      if (/^(https?:|data:|blob:)/i.test(u)) return u; // absolutas
      if (u.startsWith("/")) return `${API_URL}${u}`; // relativo do servidor
      return `${API_URL}/${u}`; // fallback (legado "uploads/...")
    },
    [API_URL]
  );

  // ESPORTES
  const buildEsporteLogo = useCallback(
    (e: EsporteAPI) => {
      const candidate = e.logoUrl || e.imagem || "";
      const normalized =
        candidate &&
        !/^(https?:|data:|blob:)/i.test(candidate) &&
        !candidate.startsWith("/") &&
        !candidate.includes("/")
          ? `/uploads/esportes/${candidate}`
          : candidate;

      return toAbs(normalized) || "/icons/ball.png";
    },
    [toAbs]
  );

  // QUADRAS
  const buildQuadraLogo = useCallback(
    (q: Partial<QuadraAPI>) => {
      const candidate = q.logoUrl || q.imagem || q.arquivo || "";
      const normalized =
        candidate &&
        !/^(https?:|data:|blob:)/i.test(String(candidate)) &&
        !String(candidate).startsWith("/") &&
        !String(candidate).includes("/")
          ? `/uploads/quadras/${candidate}`
          : String(candidate);

      return toAbs(normalized);
    },
    [toAbs]
  );

  // wizard
  const [step, setStep] = useState<Step>(1);

  // dados
  const [esportes, setEsportes] = useState<Esporte[]>([]);
  const [loadingEsportes, setLoadingEsportes] = useState(false);
  const [esporteId, setEsporteId] = useState<string>("");
  const dias = useMemo(() => diasProximos(7), []);
  const [diaISO, setDiaISO] = useState<string>(dias[0]?.iso || "");
  const [horario, setHorario] = useState<string>("");

  const [quadras, setQuadras] = useState<QuadraDisponivel[]>([]);
  const [quadraId, setQuadraId] = useState<string>("");

  const [quadraLogos, setQuadraLogos] = useState<Record<string, string>>({});

  const [horariosMap, setHorariosMap] = useState<Record<string, boolean>>({});
  const [carregandoHorarios, setCarregandoHorarios] = useState(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // ======== JOGADORES ========
  const [players, setPlayers] = useState<Player[]>([]);

  // inicia players com dono + um campo "com cadastro"
  useEffect(() => {
    const ownerName = usuario?.nome ?? "";
    const base: Player[] = [
      { id: cryptoRandom(), kind: "owner", value: ownerName },
      { id: cryptoRandom(), kind: "registered", value: "" },
    ];
    setPlayers(base);
  }, [usuario?.nome]);

  // helpers jogador
  const updatePlayer = (id: string, patch: Partial<Player>) =>
    setPlayers((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // não remove o dono
  const removePlayer = (id: string) =>
    setPlayers((cur) => cur.filter((p) => p.id !== id || p.kind === "owner"));

  const addRegisteredField = () =>
    setPlayers((cur) => [...cur, { id: cryptoRandom(), kind: "registered", value: "" }]);

  const addGuestField = () =>
    setPlayers((cur) => [...cur, { id: cryptoRandom(), kind: "guest", value: "" }]);

  // ===== Vôlei selecionado? =====
  const isVoleiSelected = useMemo(() => {
    const nome = (esportes.find((e) => String(e.id) === String(esporteId))?.nome || "").toLowerCase();
    return nome.includes("vôlei") || nome.includes("volei");
  }, [esportes, esporteId]);

  // validação mínima (2 jogadores)
  const jogadoresValidos = players.filter(
    (p) =>
      (p.kind === "owner" && p.value.trim() !== "") ||
      (p.kind === "registered" && !!p.userId) ||
      (p.kind === "guest" && p.value.trim() !== "")
  );
  const podeReservar = jogadoresValidos.length >= 2;

  /* ========= Carregamentos ========= */
  // 1) Esportes
  useEffect(() => {
    if (isChecking) return;
    const loadEsportes = async () => {
      try {
        setLoadingEsportes(true);
        const { data } = await axios.get<EsporteAPI[]>(`${API_URL}/esportes`, { withCredentials: true });
        const list: Esporte[] = (data || []).map((e) => ({
          id: String(e.id),
          nome: e.nome,
          logoUrl: buildEsporteLogo(e),
        }));
        setEsportes(list);
      } catch (e) {
        console.error("Erro ao carregar esportes", e);
      } finally {
        setLoadingEsportes(false);
      }
    };
    loadEsportes();
  }, [isChecking, buildEsporteLogo, API_URL]);

  // 2) Logos das quadras
  useEffect(() => {
    if (isChecking) return;
    const loadQuadras = async () => {
      try {
        const { data } = await axios.get<QuadraAPI[]>(`${API_URL}/quadras`, { withCredentials: true });
        const map: Record<string, string> = {};
        (data || []).forEach((q) => {
          const id = String(q.id ?? q.quadraId ?? "");
          if (!id) return;
          const logo = buildQuadraLogo(q);
          if (logo) map[id] = logo;
        });
        setQuadraLogos(map);
      } catch (e) {
        console.warn("Não foi possível carregar /quadras para logos.", e);
      }
    };
    loadQuadras();
  }, [isChecking, buildQuadraLogo, API_URL]);

  // 3) Mapa de horários
  useEffect(() => {
    if (isChecking) return;
    setHorario("");
    setQuadraId("");
    setQuadras([]);
    setMsg("");

    let alive = true;
    const fetchHorarios = async () => {
      if (!esporteId || !diaISO) {
        setHorariosMap({});
        return;
      }

      // se for hoje, só liberar horários estritamente posteriores à hora atual (SP)
      const isToday = diaISO === todayIsoSP;
      const hoursToCheck = isToday
        ? HORARIOS.filter((h) => Number(h.slice(0, 2)) > hourNowSP)
        : HORARIOS;

      setCarregandoHorarios(true);
      try {
        const results = await Promise.all(
          hoursToCheck.map(async (h) => {
            try {
              const { data } = await axios.get<Disponibilidade[]>(
                `${API_URL}/disponibilidade`,
                { withCredentials: true, params: { data: diaISO, horario: h, esporteId } }
              );
              const available = (data || []).some((q) => q.disponivel !== false);
              return [h, available] as const;
            } catch {
              return [h, false] as const;
            }
          })
        );
        if (!alive) return;

        // monta o mapa: tudo bloqueado por padrão; habilita só o que consultamos/estiver disponível
        const map: Record<string, boolean> = {};
        HORARIOS.forEach((h) => (map[h] = false));
        results.forEach(([h, ok]) => (map[h] = ok));
        setHorariosMap(map);
      } finally {
        if (alive) setCarregandoHorarios(false);
      }
    };
    fetchHorarios();
    return () => {
      alive = false;
    };
  }, [API_URL, esporteId, diaISO, isChecking]);

  // 4) Lista de quadras disponíveis
  useEffect(() => {
    if (isChecking) return;
    const buscar = async () => {
      setQuadras([]);
      setMsg("");
      if (!diaISO || !horario || !esporteId) return;
      setLoading(true);
      try {
        const { data } = await axios.get<Disponibilidade[]>(
          `${API_URL}/disponibilidade`,
          { withCredentials: true, params: { data: diaISO, horario, esporteId } }
        );
        const disponiveis = (data || [])
          .filter((q) => q.disponivel !== false)
          .map((q) => {
            const id = String(q.quadraId);
            return { quadraId: id, nome: q.nome, numero: q.numero, logoUrl: quadraLogos[id] || "" };
          });
        setQuadras(disponiveis);
        if (disponiveis.length === 0) setMsg("Nenhuma quadra disponível neste horário.");
      } catch (e) {
        console.error(e);
        setMsg("Erro ao verificar disponibilidade.");
      } finally {
        setLoading(false);
      }
    };
    buscar();
  }, [API_URL, diaISO, horario, esporteId, quadraLogos, isChecking]);

  /* ========= Navegação ========= */
  const confirmarEsporte = () => {
    if (!esporteId) return setMsg("Selecione um esporte.");
    setMsg("");
    setStep(2);
  };
  const confirmarDia = () => {
    if (!diaISO) return setMsg("Selecione um dia.");
    setMsg("");
    setStep(3);
  };
  const confirmarHorario = () => {
    if (!horario) return setMsg("Selecione um horário.");
    setMsg("");
    setStep(4);
  };
  const avancarQuadra = () => {
    if (!quadraId) return setMsg("Selecione uma quadra.");
    setMsg("");
    setStep(isVoleiSelected ? 6 : 5);
  };
  const confirmarJogadores = () => {
    if (!podeReservar) return setMsg("Informe pelo menos 2 jogadores.");
    setMsg("");
    setStep(6);
  };

  function toErrorMessage(err: unknown): string {
    const maybeAxios = err as { response?: { data?: unknown; statusText?: string }; message?: string };
    const data = maybeAxios.response?.data;

    if (isRecord(data) && typeof data.erro === "string") return data.erro;

    if (isRecord(data) && Array.isArray((data as Record<string, unknown>).issues)) {
      const items = (data as Record<string, unknown>).issues as unknown[];
      const msgs = items
        .map((i) => (isRecord(i) && typeof i.message === "string" ? i.message : null))
        .filter((s): s is string => !!s);
      if (msgs.length) return msgs.join(" • ");
    }

    if (isRecord(data) && typeof data.message === "string") return data.message;
    if (maybeAxios.response?.statusText) return String(maybeAxios.response.statusText);
    if (typeof maybeAxios.message === "string") return maybeAxios.message;

    try {
      return JSON.stringify(data ?? err);
    } catch {
      return "Não foi possível processar a solicitação.";
    }
  }

  const realizarReserva = async () => {
    if (!quadraId || !diaISO || !horario || !esporteId) return;

    const precisaJogadores = !isVoleiSelected;
    if (precisaJogadores && !podeReservar) {
      setMsg("Informe pelo menos 2 jogadores.");
      return;
    }

    const base: ReservaPayloadBase = { data: diaISO, horario, esporteId, quadraId, tipoReserva: "COMUM" };
    const extra: ReservaPayloadExtra = {};

    if (precisaJogadores) {
      const jogadoresIds = players
        .filter((p) => p.kind === "registered" && p.userId)
        .map((p) => String(p.userId));
      const convidadosNomes = players
        .filter((p) => p.kind === "guest" && p.value.trim() !== "")
        .map((p) => p.value.trim());

      if (jogadoresIds.length) extra.jogadoresIds = jogadoresIds;
      if (convidadosNomes.length) extra.convidadosNomes = convidadosNomes;
    }

    const payload: ReservaPayloadBase & ReservaPayloadExtra = { ...base, ...extra };

    setLoading(true);
    setMsg("");
    try {
      await axios.post(`${API_URL}/agendamentos`, payload, { withCredentials: true });
      setStep(7);
    } catch (e: unknown) {
      console.error(e);
      setMsg(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (step > 1) setStep((prev: Step) => (prev - 1) as Step);
    else router.back();
  };

  /* ========= Loading global durante a checagem de auth ========= */
  if (isChecking) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#f5f5f5]">
        <div className="flex items-center gap-3 text-gray-600">
          <Spinner size="w-8 h-8" /> <span>Carregando…</span>
        </div>
      </main>
    );
  }

  /* ========= UI helpers ========= */
  const Card = ({ children, className = "" }: PropsWithChildren<{ className?: string }>) => (
    <div className={`bg-white rounded-2xl shadow-md p-4 ${className}`}>{children}</div>
  );
  const Btn = ({
    children,
    onClick,
    disabled = false,
    className = "",
  }: PropsWithChildren<{ onClick: () => void; disabled?: boolean; className?: string }>) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-lg px-4 py-2 font-semibold transition
        ${disabled ? "bg-gray-300 text-white" : "bg-orange-600 text-white hover:bg-orange-700"}
        ${className}`}
    >
      {children}
    </button>
  );

  /* ========= Render ========= */
  return (
    <main className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 py-5">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={goBack}
            aria-label="Voltar"
            className="rounded-full bg-white/15 hover:bg-white/25 transition p-2 leading-none"
          >
            <span className="inline-block rotate-180 text-xl cursor-pointer">➜</span>
          </button>
          <h1 className="text-2xl font-extrabold drop-shadow-sm">
            {step === 7 ? "Reserva confirmada" : "Marque a sua quadra"}
          </h1>
        </div>
      </header>

      <section className="px-4 py-4">
        <div className="max-w-sm mx-auto space-y-4">
          {msg && <div className="text-center text-sm text-red-600">{msg}</div>}

          {/* STEP 1 - Esporte */}
          {step === 1 && (
            <Card>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Escolha o esporte:</p>

              {loadingEsportes && (
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                  <Spinner /> <span>Carregando esportes…</span>
                </div>
              )}

              {!loadingEsportes && esportes.length === 0 && (
                <p className="text-sm text-gray-500">Nenhum esporte disponível.</p>
              )}

              <div className="grid grid-cols-4 gap-3">
                {esportes.map((e) => {
                  const ativo = String(esporteId) === String(e.id);
                  return (
                    <button
                      key={e.id}
                      className={`rounded-xl border text-center px-2 py-3 text-[12px] leading-tight
                        ${ativo ? "bg-orange-50 border-orange-400 text-orange-700" : "bg-gray-50 border-gray-200 text-gray-700"}
                      `}
                      onClick={() => setEsporteId(String(e.id))}
                    >
                      <div className="mx-auto mb-2 w-9 h-9 rounded-full bg-gray-200 overflow-hidden relative flex items-center justify-center">
                        <AppImage
                          src={e.logoUrl || "/icons/ball.png"}
                          alt={e.nome}
                          fill
                          className="object-contain"
                          fallbackSrc="/icons/ball.png"
                        />
                      </div>
                      {e.nome}
                    </button>
                  );
                })}
              </div>
              <Btn className="mt-4 cursor-pointer" onClick={confirmarEsporte}>
                Confirmar
              </Btn>
            </Card>
          )}

          {/* STEP 2 - Dia */}
          {step === 2 && (
            <Card>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Escolha o dia:</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {dias.map((d) => {
                  const ativo = diaISO === d.iso;
                  return (
                    <button
                      key={d.iso}
                      onClick={() => setDiaISO(d.iso)}
                      className={`min-w-[90px] rounded-xl border px-2 py-2 text-[12px] text-center
                        ${ativo ? "bg-orange-100 border-orange-500 text-orange-700" : "bg-gray-100 border-gray-200 text-gray-700"}
                      `}
                    >
                      <div className="text-[11px]">{d.mes}</div>
                      <div className="text-lg font-bold">{String(d.d).padStart(2, "0")}</div>
                      <div className="text-[11px]">{d.wd}</div>
                    </button>
                  );
                })}
              </div>
              <Btn className="mt-4 cursor-pointer" onClick={confirmarDia}>
                Avançar
              </Btn>
            </Card>
          )}

          {/* STEP 3 - Horário */}
          {step === 3 && (
            <Card>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Escolha o horário:</p>
              {carregandoHorarios && (
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                  <Spinner /> <span>Checando horários disponíveis…</span>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2">
                {HORARIOS.map((h) => {
                  const ativo = horario === h;
                  const enabled = horariosMap[h] === true;
                  return (
                    <button
                      key={h}
                      onClick={() => enabled && setHorario(h)}
                      disabled={!enabled}
                      className={`rounded-md px-2 py-2 text-sm border
                        ${ativo ? "bg-orange-100 border-orange-500 text-orange-700" : "bg-gray-100 border-gray-200 text-gray-700"}
                        ${enabled ? "" : "opacity-50 cursor-not-allowed"}
                      `}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
              <Btn className="mt-4 cursor-pointer" onClick={confirmarHorario} disabled={!horario}>
                Confirmar
              </Btn>
            </Card>
          )}

          {/* STEP 4 - Quadra */}
          {step === 4 && (
            <Card>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Escolha a quadra:</p>

              {loading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Spinner /> <span>Carregando disponibilidade…</span>
                </div>
              )}

              {!loading && quadras.length === 0 && (
                <p className="text-sm text-gray-500">Nenhuma quadra disponível.</p>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {quadras.map((q) => {
                  const ativo = String(quadraId) === String(q.quadraId);
                  const src = q.logoUrl || "/quadra.png";
                  return (
                    <button
                      key={q.quadraId}
                      onClick={() => setQuadraId(String(q.quadraId))}
                      className={`rounded-xl border p-3 transition flex flex-col items-center text-center
              ${ativo ? "bg-orange-50 border-orange-500" : "bg-gray-50 border-gray-200 hover:border-gray-300"}
            `}
                    >
                      <div className="relative w-full h-15 md:h-32 overflow-hidden flex items-center justify-center mb-2">
                        <AppImage
                          src={src || "/quadra.png"}
                          alt={q.nome}
                          fill
                          className="object-contain"
                          fallbackSrc="/quadra.png"
                        />
                      </div>
                      <p className="text-[13px] font-semibold text-gray-800 truncate">{q.nome}</p>
                      <p className="text-[12px] text-gray-500">Quadra {q.numero}</p>
                    </button>
                  );
                })}
              </div>

              <Btn className="mt-4 cursor-pointer" onClick={avancarQuadra}>
                Avançar
              </Btn>
            </Card>
          )}

          {/* STEP 5 - Jogadores (não é vôlei) */}
          {step === 5 && !isVoleiSelected && (
            <Card>
              <h1 className="text-[13px] font-bold text-gray-600 mb-2">Informe o nome dos jogadores:</h1>
              <p className="text-[13px] font-small text-gray-600 mb-2">
                Para continuar a reserva é necessário inserir no minímo 2 jogadores
              </p>

              <div className="space-y-3">
                {players.map((p) => (
                  <div key={p.id}>
                    {p.kind === "owner" && (
                      <input
                        type="text"
                        disabled
                        value={p.value}
                        className="w-full rounded-md border px-3 py-2 text-sm bg-gray-100 text-gray-600"
                        placeholder="Jogador 1"
                      />
                    )}

                    {p.kind === "registered" && (
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <UserPicker
                            apiUrl={API_URL}
                            value={p.value}
                            excludeIds={[usuario?.id ?? ""]}
                            placeholder="Jogador com cadastro"
                            onClear={() => updatePlayer(p.id, { value: "", userId: undefined })}
                            onSelect={(u) => updatePlayer(p.id, { value: u.nome, userId: u.id })}
                          />
                        </div>
                      </div>
                    )}

                    {p.kind === "guest" && (
                      <GuestField
                        id={p.id}
                        initialValue={p.value}
                        onCommit={(next) => updatePlayer(p.id, { value: next })}
                        onRemove={() => removePlayer(p.id)}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-2 space-y-2">
                <button
                  type="button"
                  onClick={addRegisteredField}
                  className="w-full rounded-md bg-[#f3f3f3] hover:bg-[#ececec] text-[12px] font-semibold text-gray-700 px-3 py-2 text-left cursor-pointer"
                >
                  <span className="inline-block mr-2 text-orange-600">+</span>
                  Adicionar mais jogadores cadastrados
                </button>

                <p className="text-[13px] font-small text-gray-600 mb-2">
                  Caso os jogadores não tenham cadastro, informe o nome deles abaixo:
                </p>

                <button
                  type="button"
                  onClick={addGuestField}
                  className="w-full rounded-md bg-[#f3f3f3] hover:bg-[#ececec] text-[12px] font-semibold text-gray-700 px-3 py-2 text-left cursor-pointer"
                >
                  <span className="inline-block mr-2 text-orange-600">+</span>
                  Adicione jogadores convidados (sem cadastro)
                </button>
              </div>

              <Btn className="mt-4 cursor-pointer" onClick={confirmarJogadores} disabled={!podeReservar}>
                Confirmar
              </Btn>
            </Card>
          )}

          {/* STEP 6 - Confirmar */}
          {step === 6 && (
            <Card>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Confirmar Reserva:</p>

              <Resumo label="Escolha o Dia:" valor={formatarDia(diaISO)} onChange={() => setStep(2)} />
              <Resumo label="Escolha o Horário:" valor={horario} onChange={() => setStep(3)} />
              <Resumo
                label="Escolha o Esporte:"
                valor={esportes.find((e) => String(e.id) === String(esporteId))?.nome || ""}
                onChange={() => setStep(1)}
              />
              <Resumo
                label="Escolha a Quadra:"
                valor={`${quadras.find((q) => String(q.quadraId) === String(quadraId))?.nome || ""
                  } - Quadra ${quadras.find((q) => String(q.quadraId) === String(quadraId))?.numero || ""}`}
                onChange={() => setStep(4)}
              />
              <Resumo
                label="Jogadores:"
                valor={players
                  .filter((p) => (p.kind !== "registered" ? (p.value ?? "").trim() !== "" : !!p.userId))
                  .map((p) => p.value.trim())
                  .join(", ")}
                onChange={() => setStep(5)}
              />

              <Btn className="mt-2 cursor-pointer" onClick={realizarReserva} disabled={loading}>
                {loading ? "Enviando..." : "Realizar Reserva"}
              </Btn>
            </Card>
          )}

          {/* STEP 7 - Sucesso */}
          {step === 7 && (
            <Card className="flex flex-col items-center text-center py-10">
              <div className="relative w-60 h-60 mb-4">
                <AppImage
                  src="/icons/realizada.png"
                  alt=""
                  fill
                  className="object-contain"
                  priority
                />
              </div>
              <h2 className="text-xl font-extrabold text-orange-600 mb-3">Reserva Realizada!</h2>
              <Btn onClick={() => router.push("/")}>Voltar à página inicial</Btn>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}

/* =========================================================
   Subcomponentes
========================================================= */
function Resumo({ label, valor, onChange }: { label: string; valor: string; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-gray-100 rounded-lg px-3 py-2 mb-2">
      <div>
        <p className="text-[12px] text-gray-500">{label}</p>
        <p className="text-[13px] font-semibold text-gray-800">{valor}</p>
      </div>
      <button
        onClick={onChange}
        className="rounded-md bg-gray-300 hover:bg-gray-400 text-gray-800 text-[12px] font-semibold px-3 py-1 transition"
      >
        Alterar
      </button>
    </div>
  );
}
