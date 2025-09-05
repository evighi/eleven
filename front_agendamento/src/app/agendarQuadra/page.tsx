"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  memo,
  type PropsWithChildren,
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
  // compat
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

const SP_TZ = "America/Sao_Paulo";
const todayIsoSP = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const hourNowSP = parseInt(
  new Intl.DateTimeFormat("en-US", {
    timeZone: SP_TZ,
    hour: "2-digit",
    hour12: false,
  }).format(new Date()),
  10
);

function dateFromIsoSP(isoYmd: string) {
  return new Date(`${isoYmd}T00:00:00-03:00`);
}

const DOW_MIXED = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DOW_UPPER = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];

function diasProximos(qtd = 7) {
  const out: { iso: string; d: number; mes: string; wdShort: string; wdFull: string }[] = [];
  const wdShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const meses = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

  const base = new Date();
  for (let i = 0; i < qtd; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    const iso = isoLocalDate(dt);
    const sp = dateFromIsoSP(iso);
    const dow = sp.getDay();
    out.push({
      iso,
      d: dt.getDate(),
      mes: meses[dt.getMonth()],
      wdShort: wdShort[dow],
      wdFull: DOW_MIXED[dow],
    });
  }
  return out;
}

function formatarDia(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function formatarDiaCurto(iso: string) {
  if (!iso) return "";
  const sp = dateFromIsoSP(iso);
  const dow = sp.getDay();
  const [y, m, d] = iso.split("-");
  return `${DOW_UPPER[dow]} ${d}/${m}`;
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
   Helpers do stepper (caminho de rato)
========================================================= */
function firstWord(s?: string) {
  if (!s) return "";
  return s.trim().split(/\s+/)[0] || "";
}

function StepTrail({
  items,
  currentStep,
  onJump,
}: {
  items: { step: number; hint: string; value?: string | null }[];
  currentStep: number;
  onJump: (s: number) => void;
}) {
  return (
    <div className="max-w-sm mx-auto mt-3 mb-4">
      <div className="flex items-center gap-2 overflow-x-auto">
        {items.map((it, i) => {
          const isCurrent = it.step === currentStep;
          const isDone = it.step < currentStep;
          const label = (it.value && String(it.value)) || it.hint;

          const base =
            "whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-semibold transition";

          const cls = isCurrent
            ? "bg-orange-600 border-orange-600 text-white"
            : isDone
            ? "bg-gray-300 border-gray-400 text-gray-900"
            : "bg-gray-100 border-gray-300 text-gray-700";

          return (
            <div key={it.step} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (isDone ? onJump(it.step) : undefined)}
                className={`${base} ${cls} ${isDone ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                title={isDone ? "Voltar para este passo" : undefined}
              >
                {label}
              </button>
              {i < items.length - 1 && <span className="text-gray-400">›</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
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
   GuestFieldUncontrolled (convidados sem cadastro)
========================================================= */
const GuestFieldUncontrolled = memo(function GuestFieldUncontrolled({
  id,
  initialValue,
  onDebouncedCommit,
  onBlurCommit,
  onRemove,
  inputRef,
}: {
  id: string;
  initialValue: string;
  onDebouncedCommit: (val: string) => void;
  onBlurCommit: (val: string) => void;
  onRemove: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const localRef = useRef<HTMLInputElement | null>(null);
  const tRef = useRef<number | null>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.value !== initialValue) {
      localRef.current.value = initialValue ?? "";
    }
  }, [initialValue]);

  const setRefs = (el: HTMLInputElement | null) => {
    localRef.current = el;
    inputRef(el);
  };

  const debounced = (val: string) => {
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => {
      onDebouncedCommit(val);
      tRef.current = null;
    }, 150);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        key={id}
        ref={setRefs}
        type="text"
        defaultValue={initialValue}
        onInput={(e) => debounced((e.target as HTMLInputElement).value)}
        onBlur={(e) => onBlurCommit((e.target as HTMLInputElement).value)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        placeholder="Jogador convidado (sem cadastro)"
        className="w-full rounded-md border px-3 py-2 text-sm bg-white"
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

  // helpers URL
  const toAbs = useCallback(
    (u?: string | null) => {
      if (!u) return "";
      if (/^(https?:|data:|blob:)/i.test(u)) return u;
      if (u.startsWith("/")) return `${API_URL}${u}`;
      return `${API_URL}/${u}`;
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

  // ======== feedback/tap lock ========
  const [navLock, setNavLock] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [pressEsporteId, setPressEsporteId] = useState<string | null>(null);
  const [pressDiaISO, setPressDiaISO] = useState<string | null>(null);
  const [pressQuadraId, setPressQuadraId] = useState<string | null>(null);

  const flashAdvance = (msg: string, run: () => void, after?: () => void) => {
    setNavLock(true);
    setAutoMsg(msg);
    // pequeno atraso para mostrar o estado pressionado
    setTimeout(() => {
      run();
      // mantém o lock por um curto período para o usuário perceber o feedback
      setTimeout(() => {
        setNavLock(false);
        setAutoMsg(null);
        after?.();
      }, 350);
    }, 80);
  };

  // ======== JOGADORES (opcional) ========
  const [players, setPlayers] = useState<Player[]>([]);
  const guestRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const ownerName = usuario?.nome ?? "";
    const base: Player[] = [
      { id: cryptoRandom(), kind: "owner", value: ownerName },
      { id: cryptoRandom(), kind: "registered", value: "" },
    ];
    setPlayers(base);
  }, [usuario?.nome]);

  const updatePlayer = (id: string, patch: Partial<Player>) =>
    setPlayers((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
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

  /* ========= Carregamentos ========= */
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

  /* ======= Rótulos do stepper ======= */
  const esporteNome = useMemo(
    () => esportes.find((e) => String(e.id) === String(esporteId))?.nome || "",
    [esportes, esporteId]
  );
  const quadraSel = useMemo(
    () => quadras.find((q) => String(q.quadraId) === String(quadraId)),
    [quadras, quadraId]
  );
  const trailItems = useMemo(
    () => [
      { step: 1, hint: "Escolha o esporte", value: esporteId ? firstWord(esporteNome) : null },
      { step: 2, hint: "Selecione o dia", value: diaISO ? formatarDiaCurto(diaISO) : null },
      { step: 3, hint: "Selecione o horário", value: horario || null },
      {
        step: 4,
        hint: "Escolha a quadra",
        value: quadraSel ? `${quadraSel.numero} - ${quadraSel.nome}` : null,
      },
      { step: 5, hint: isVoleiSelected ? "Jogadores (pulado)" : "Jogadores (opcional)", value: null },
      { step: 6, hint: "Confirmar", value: null },
    ],
    [esporteId, esporteNome, diaISO, horario, quadraSel, isVoleiSelected]
  );

  /* ========= Navegação ========= */
  const confirmarHorario = () => {
    if (!horario) return setMsg("Selecione um horário.");
    setMsg("");
    setStep(4);
  };

  const avancarQuadraDireto = (id: string) => {
    setQuadraId(id);
    setMsg("");
    setStep(isVoleiSelected ? 6 : 5);
  };

  const confirmarJogadores = () => {
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

    const base: ReservaPayloadBase = { data: diaISO, horario, esporteId, quadraId, tipoReserva: "COMUM" };

    const jogadoresIds = players
      .filter((p) => p.kind === "registered" && p.userId)
      .map((p) => String(p.userId));

    const convidadosNomes = players
      .filter((p) => p.kind === "guest")
      .map((p) => (guestRefs.current[p.id]?.value ?? p.value ?? "").trim())
      .filter(Boolean);

    const extra: ReservaPayloadExtra = {};
    if (jogadoresIds.length) extra.jogadoresIds = jogadoresIds;
    if (convidadosNomes.length) extra.convidadosNomes = convidadosNomes;

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

      {step < 7 && (
        <StepTrail
          items={trailItems}
          currentStep={step}
          onJump={(s) => {
            if (s < step && !navLock) setStep(s as Step);
          }}
        />
      )}

      <section className="px-4 py-4 relative">
        {/* Chip flutuante de feedback */}
        {navLock && (
          <div className="fixed inset-x-0 top-3 z-50 flex justify-center px-4 pointer-events-none">
            <div className="flex items-center gap-2 bg-black/70 text-white text-xs px-3 py-1 rounded-full shadow">
              <Spinner size="w-4 h-4" /> <span>{autoMsg ?? "Avançando..."}</span>
            </div>
          </div>
        )}

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
                  const pressed = pressEsporteId === String(e.id);
                  return (
                    <button
                      key={e.id}
                      disabled={navLock}
                      className={`rounded-xl border text-center px-2 py-3 text-[12px] leading-tight transition
                        active:scale-[0.98]
                        ${ativo ? "bg-orange-50 border-orange-400 text-orange-700" : "bg-gray-50 border-gray-200 text-gray-700"}
                        ${navLock ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
                        ${pressed ? "ring-2 ring-orange-500 animate-pulse" : ""}
                      `}
                      onClick={() => {
                        if (navLock) return;
                        setMsg("");
                        setPressEsporteId(String(e.id));
                        flashAdvance(`Esporte: ${e.nome}`, () => {
                          setEsporteId(String(e.id));
                          setStep(2);
                        }, () => setPressEsporteId(null));
                      }}
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
            </Card>
          )}

          {/* STEP 2 - Dia */}
          {step === 2 && (
            <Card>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Escolha o dia:</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {dias.map((d) => {
                  const ativo = diaISO === d.iso;
                  const pressed = pressDiaISO === d.iso;
                  return (
                    <button
                      key={d.iso}
                      disabled={navLock}
                      onClick={() => {
                        if (navLock) return;
                        setMsg("");
                        setPressDiaISO(d.iso);
                        flashAdvance(`Dia: ${formatarDiaCurto(d.iso)}`, () => {
                          setDiaISO(d.iso);
                          setStep(3);
                        }, () => setPressDiaISO(null));
                      }}
                      className={`min-w-[110px] rounded-xl border px-2 py-2 text-[12px] text-center transition active:scale-[0.98]
                        ${ativo ? "bg-orange-100 border-orange-500 text-orange-700" : "bg-gray-100 border-gray-200 text-gray-700"}
                        ${navLock ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
                        ${pressed ? "ring-2 ring-orange-500 animate-pulse" : ""}
                      `}
                    >
                      <div className="text-[11px]">{d.mes}</div>
                      <div className="text-lg font-bold">{String(d.d).padStart(2, "0")}</div>
                      <div className="text-[11px]">{d.wdFull}</div>
                    </button>
                  );
                })}
              </div>
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
                      disabled={!enabled || navLock}
                      className={`rounded-md px-2 py-2 text-sm border transition active:scale-[0.98]
                        ${ativo ? "bg-orange-100 border-orange-500 text-orange-700" : "bg-gray-100 border-gray-200 text-gray-700"}
                        ${enabled && !navLock ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}
                      `}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
              <Btn className="mt-4 cursor-pointer" onClick={confirmarHorario} disabled={!horario || navLock}>
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
                  const pressed = pressQuadraId === String(q.quadraId);
                  const src = q.logoUrl || "/quadra.png";
                  return (
                    <button
                      key={q.quadraId}
                      disabled={navLock}
                      onClick={() => {
                        if (navLock) return;
                        setPressQuadraId(String(q.quadraId));
                        flashAdvance(`Quadra ${q.numero} - ${q.nome}`, () => {
                          avancarQuadraDireto(String(q.quadraId));
                        }, () => setPressQuadraId(null));
                      }}
                      className={`rounded-xl border p-3 transition flex flex-col items-center text-center active:scale-[0.98]
                        ${ativo ? "bg-orange-50 border-orange-500" : "bg-gray-50 border-gray-200 hover:border-gray-300"}
                        ${navLock ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
                        ${pressed ? "ring-2 ring-orange-500 animate-pulse" : ""}
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

              {/* botão Avançar removido */}
            </Card>
          )}

          {/* STEP 5 - Jogadores (opcional) */}
          {step === 5 && !isVoleiSelected && (
            <Card>
              <h1 className="text-[13px] font-bold text-gray-600 mb-2">Jogadores (opcional)</h1>
              <p className="text-[13px] text-gray-600 mb-2">
                Adicione jogadores cadastrados ou convidados, se quiser. Você pode continuar sem preencher.
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
                      <GuestFieldUncontrolled
                        id={p.id}
                        initialValue={p.value}
                        inputRef={(el) => {
                          guestRefs.current[p.id] = el;
                        }}
                        onDebouncedCommit={() => {}}
                        onBlurCommit={(val) => {
                          updatePlayer(p.id, { value: val });
                        }}
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
                  Adicionar jogador cadastrado
                </button>

                <button
                  type="button"
                  onClick={addGuestField}
                  className="w-full rounded-md bg-[#f3f3f3] hover:bg-[#ececec] text-[12px] font-semibold text-gray-700 px-3 py-2 text-left cursor-pointer"
                >
                  <span className="inline-block mr-2 text-orange-600">+</span>
                  Adicionar convidado (sem cadastro)
                </button>
              </div>

              <Btn className="mt-4 cursor-pointer" onClick={confirmarJogadores} disabled={navLock}>
                Confirmar
              </Btn>
            </Card>
          )}

          {/* STEP 6 - Confirmar */}
          {step === 6 && (
            <Card>
              <p className="text-[13px] font-semibold text-gray-600 mb-3">Confirmar Reserva:</p>

              <Resumo label="Escolha o Dia:" valor={formatarDiaCurto(diaISO)} onChange={() => setStep(2)} />
              <Resumo label="Escolha o Horário:" valor={horario} onChange={() => setStep(3)} />
              <Resumo
                label="Escolha o Esporte:"
                valor={esporteNome}
                onChange={() => setStep(1)}
              />
              <Resumo
                label="Escolha a Quadra:"
                valor={`${quadraSel?.numero ?? ""} - ${quadraSel?.nome ?? ""}`}
                onChange={() => setStep(4)}
              />
              <Resumo
                label="Jogadores:"
                valor={
                  players
                    .filter((p) => (p.kind !== "registered" ? (p.value ?? "").trim() !== "" : !!p.userId))
                    .map((p) => p.value.trim())
                    .join(", ") || "—"
                }
                onChange={() => setStep(5)}
              />

              <Btn className="mt-2 cursor-pointer" onClick={realizarReserva} disabled={loading || navLock}>
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
