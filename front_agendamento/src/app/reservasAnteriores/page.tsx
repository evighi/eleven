"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

import { useAuthStore } from "@/context/AuthStore";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import { isoLocalDate } from "@/utils/date";

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

type Card = {
  id: string;
  logoUrl: string;
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;
  hora: string;
};

/** Img com fallback único (evita loop em caso de 404) */
function SafeImg({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const FALLBACK = "/quadra.png";
  const tried = useRef(false);
  const [imgSrc, setImgSrc] = useState(src && src.trim() ? src : FALLBACK);

  useEffect(() => {
    setImgSrc(src && src.trim() ? src : FALLBACK);
    tried.current = false;
  }, [src]);

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      onError={() => {
        if (tried.current) return;
        tried.current = true;
        setImgSrc(FALLBACK);
      }}
    />
  );
}

/** junta base + path sem barras duplicadas */
function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

export default function HistoricoAgendamentos() {
  // 🔒 Proteção (mesmo conjunto da sua Home)
  const { isChecking } = useRequireAuth(["CLIENTE", "ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"]);

  const router = useRouter();
  const { usuario } = useAuthStore();

  const [itens, setItens] = useState<Card[]>([]);
  const [carregando, setCarregando] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const UPLOADS_PREFIX = (process.env.NEXT_PUBLIC_UPLOADS_PREFIX || "/uploads/quadras").trim();

  const hojeISO = useMemo(() => isoLocalDate(new Date(), "America/Sao_Paulo"), []);

  const paraDDMM = (iso?: string) => {
    const s = (iso || hojeISO).slice(0, 10);
    const [, m, d] = s.split("-");
    return `${d}/${m}`;
  };

  const extrairNumeroDoLocal = (local?: string) => {
    if (!local) return undefined;
    const m = local.match(/N[ºo]\s*(\d+)/i);
    return m?.[1] || undefined;
  };

  const toAbs = (API_URL: string, u?: string | null) => {
    if (!u) return "";
    if (/^(https?:|data:|blob:)/i.test(u)) return u; // R2, data:, blob:
    if (u.startsWith("/")) return joinUrl(API_URL, u); // /uploads/...
    return joinUrl(API_URL, u); // "uploads/..." ou outro relativo
  };

  /** Resolve a melhor URL possível para a imagem da quadra */
  const resolveQuadraImg = (raw: AgendamentoAPI) => {
    const candidates = [
      raw.quadraLogoUrl,               // back novo já pode mandar pronto
      raw.logoUrl,                     // compat velho
      raw.quadra?.imagem ?? undefined, // legado: nome do arquivo
    ].filter((v): v is string => !!v && v.trim().length > 0);

    for (const c of candidates) {
      const v = c.trim();

      // 1) já é absoluto (R2/externo)
      if (/^(https?:|data:|blob:)/i.test(v)) return v;

      // 2) veio com /uploads/... (relativo) -> prefixa API_URL
      if (v.startsWith("/uploads/") || v.includes("/uploads/"))
        return toAbs(API_URL, v);

      // 3) veio só o NOME do arquivo (legado: "quadra1.png")
      if (/^[\w.\-]+$/.test(v)) {
        const prefix = (process.env.NEXT_PUBLIC_UPLOADS_PREFIX || "/uploads/quadras").trim();
        return toAbs(API_URL, joinUrl(prefix, v));
      }

      // 4) qualquer outro relativo
      return toAbs(API_URL, v);
    }

    return "/quadra.png";
  };

  const normalizar = (raw: AgendamentoAPI): Card => {
    const esporte = raw.esporteNome || raw.esporte?.nome || raw.nome || "";
    const quadraNome = raw.quadraNome || raw.quadra?.nome || (raw.local?.split(" - Nº")[0] ?? "Quadra");
    const numero =
      String(raw.quadraNumero ?? raw.quadra?.numero ?? extrairNumeroDoLocal(raw.local) ?? "") || undefined;

    const logoUrl = resolveQuadraImg(raw);

    return {
      id: raw.id,
      logoUrl,
      quadraNome,
      numero,
      esporte,
      dia: paraDDMM(raw.data),
      hora: raw.horario,
    };
  };

  useEffect(() => {
    if (isChecking) return;
    if (!usuario?.id) return;

    const fetch = async () => {
      setCarregando(true);
      try {
        // pega todos do usuário e filtra FINALIZADO
        const { data } = await axios.get<AgendamentoAPI[]>(
          `${API_URL}/agendamentos`,
          { withCredentials: true, params: { usuarioId: usuario.id } }
        );

        const finalizados = (data || []).filter(a => a.status === "FINALIZADO");

        // ordena por data+horário DESC
        finalizados.sort((a, b) => {
          const da = (a.data ?? "").slice(0, 10);
          const db = (b.data ?? "").slice(0, 10);
          if (da !== db) return db.localeCompare(da);
          return (b.horario || "").localeCompare(a.horario || "");
        });

        setItens(finalizados.map(normalizar));
      } catch (e) {
        console.error(e);
        setItens([]);
      } finally {
        setCarregando(false);
      }
    };
    fetch();
  }, [API_URL, usuario?.id, hojeISO, isChecking]);

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

  return (
    <main className="min-h-screen bg-[#f5f5f5]">
      {/* Header laranja com título e voltar */}
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 py-5">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label="Voltar"
            className="rounded-full bg-white/15 hover:bg-white/25 transition p-2 leading-none"
          >
            <span className="inline-block rotate-180 text-xl cursor-pointer">➜</span>
          </button>
          <h1 className="text-2xl font-extrabold drop-shadow-sm">
            Reservas anteriores
          </h1>
        </div>
      </header>

      <section className="px-0 py-0">
        <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-md p-4">
          <h2 className="text-[13px] font-semibold text-gray-600 mb-3">
            Jogos anteriores:
          </h2>

          {carregando && (
            <div className="flex items-center gap-2 text-gray-600">
              <Spinner size="w-4 h-4" />
              <span className="text-sm">Carregando…</span>
            </div>
          )}

          {!carregando && itens.length === 0 && (
            <p className="text-sm text-gray-500">Você não possui reservas finalizadas.</p>
          )}

          <div className="space-y-3">
            {itens.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl bg-[#f3f3f3] px-3 py-2.5 shadow-sm"
              >
                <div className="shrink-0 w-28 h-12 sm:w-36 sm:h-14 md:w-40 md:h-16 flex items-center justify-center overflow-hidden">
                  <SafeImg src={a.logoUrl} alt={a.quadraNome} className="w-full h-full object-contain select-none" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">{a.quadraNome}</p>
                  <p className="text-[12px] text-gray-600 leading-tight">{a.esporte}</p>
                  <p className="text-[12px] text-gray-500">Dia {a.dia} às {a.hora}</p>
                  {!!a.numero && <p className="text-[11px] text-gray-500">Quadra {a.numero}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="supports-[padding:env(safe-area-inset-bottom)]:pb-[env(safe-area-inset-bottom)]" />
    </main>
  );
}
