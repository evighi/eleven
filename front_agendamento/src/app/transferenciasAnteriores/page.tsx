"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

import { useAuthStore } from "@/context/AuthStore";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import { isoLocalDate } from "@/utils/date";

/* ===== Tipos vindos da rota /agendamentos/transferidos/me ===== */
type TransferidoAPI = {
  id: string;
  data: string;                         // "YYYY-MM-DD"
  horario: string;                      // "HH:mm"
  status: "TRANSFERIDO";
  quadraNome?: string;
  quadraNumero?: number | string | null;
  quadraImagem?: string | null;         // nome do arquivo (ex: 1752877664044.PNG)
  quadraLogoUrl?: string | null;        // url absoluta se APP_URL configurado no backend
  esporteNome?: string;
  transferidoPara: { id: string; nome: string; email: string } | null;
  novoAgendamentoId: string | null;
};

/* ===== Modelo para exibição ===== */
type Card = {
  id: string;
  logoUrl: string;
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;       // "dd/MM"
  hora: string;      // "HH:mm"
  paraQuem?: string; // nome completo de quem recebeu
};

/** Img com fallback único (evita loop em caso de 404) */
function SafeImg({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const FALLBACK = "/quadra.png";
  const tried = useRef(false);
  const [imgSrc, setImgSrc] = useState(
    src && String(src).trim().length ? String(src) : FALLBACK
  );

  useEffect(() => {
    setImgSrc(src && String(src).trim().length ? String(src) : FALLBACK);
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

/** Junta base + path sem barras duplicadas */
function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

export default function TransferenciasAnterioresPage() {
  // 🔒 Proteção (mesmo conjunto da Home)
  const { isChecking } = useRequireAuth([
    "CLIENTE",
    "ADMIN_MASTER",
    "ADMIN_ATENDENTE",
    "ADMIN_PROFESSORES",
  ]);

  const router = useRouter();
  const { usuario } = useAuthStore();

  const [itens, setItens] = useState<Card[]>([]);
  const [carregando, setCarregando] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const UPLOADS_PREFIX =
    (process.env.NEXT_PUBLIC_UPLOADS_PREFIX || "/uploads/quadras").trim();

  const hojeISO = useMemo(() => isoLocalDate(new Date(), "America/Sao_Paulo"), []);

  // Helpers
  const paraDDMM = (iso?: string) => {
    const s = (iso || hojeISO).slice(0, 10);
    const [, m, d] = s.split("-");
    return `${d}/${m}`;
  };

  /** Deixa passar absoluto (https:, data:, blob:) e prefixa API_URL no resto */
  function toAbs(API_URL: string, u?: string | null) {
    if (!u) return "";
    const v = u.trim();
    if (/^(https?:|data:|blob:)/i.test(v)) return v;     // R2 ou data/blob
    if (v.startsWith("/")) return joinUrl(API_URL, v);   // /uploads/...
    return joinUrl(API_URL, v);                          // "uploads/..." etc
  }

  /** Resolve a melhor URL possível para a imagem da quadra (R2 ou legado) */
  function resolveImg(raw: TransferidoAPI, API_URL: string, UPLOADS_PREFIX: string) {
    const candidates = [
      raw.quadraLogoUrl,     // back novo já pode mandar absoluto
      raw.quadraImagem,      // legado: nome do arquivo
    ].filter((v): v is string => !!v && v.trim().length > 0);

    for (const c of candidates) {
      const v = c.trim();

      // 1) absoluto
      if (/^(https?:|data:|blob:)/i.test(v)) return v;

      // 2) veio com /uploads/... relativo
      if (v.startsWith("/uploads/") || v.includes("/uploads/")) {
        return toAbs(API_URL, v);
      }

      // 3) apenas nome do arquivo (ex: "1752877664044.PNG")
      if (/^[\w.\-]+$/.test(v)) {
        const prefix = (UPLOADS_PREFIX || "/uploads/quadras").trim();
        return toAbs(API_URL, joinUrl(prefix, v));
      }

      // 4) qualquer outro relativo
      return toAbs(API_URL, v);
    }

    return "/quadra.png";
  }

  const normalizar = (raw: TransferidoAPI): Card => ({
    id: raw.id,
    logoUrl: resolveImg(raw, API_URL, UPLOADS_PREFIX),
    quadraNome: raw.quadraNome || "Quadra",
    numero: raw.quadraNumero != null ? String(raw.quadraNumero) : undefined,
    esporte: raw.esporteNome || "",
    dia: paraDDMM(raw.data),
    hora: raw.horario,
    paraQuem: raw.transferidoPara?.nome || undefined,
  });

  useEffect(() => {
    if (isChecking) return;

    const fetch = async () => {
      setCarregando(true);
      try {
        const { data } = await axios.get<TransferidoAPI[]>(
          `${API_URL}/agendamentos/transferidos/me`,
          { withCredentials: true }
        );

        // ordena do mais recente para o mais antigo (data+hora DESC)
        const ordenado = [...(data || [])].sort((a, b) => {
          const da = (a.data ?? "").slice(0, 10);
          const db = (b.data ?? "").slice(0, 10);
          if (da !== db) return db.localeCompare(da);
          return (b.horario || "").localeCompare(a.horario || "");
        });

        setItens(ordenado.map(normalizar));
      } catch (e) {
        console.error(e);
        setItens([]);
      } finally {
        setCarregando(false);
      }
    };
    fetch();
  }, [API_URL, isChecking]);

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
      {/* Header laranja */}
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
            Transferências anteriores
          </h1>
        </div>
      </header>

      {/* Conteúdo */}
      <section className="px-0 py-0">
        <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-md p-4">
          <h2 className="text-[13px] font-semibold text-gray-600 mb-3">
            Reservas transferidas
          </h2>

          {carregando && (
            <div className="flex items-center gap-2 text-gray-600">
              <Spinner size="w-4 h-4" />
              <span className="text-sm">Carregando…</span>
            </div>
          )}

          {!carregando && itens.length === 0 && (
            <p className="text-sm text-gray-500">
              Você não possui transferências.
            </p>
          )}

          <div className="space-y-3">
            {itens.map((a) => (
              <div
                key={a.id}
                className="rounded-xl bg-[#f3f3f3] px-3 py-2.5 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0 w-28 h-12 sm:w-36 sm:h-14 md:w-40 md:h-16 flex items-center justify-center overflow-hidden">
                    <SafeImg
                      src={a.logoUrl}
                      alt={a.quadraNome}
                      className="w-full h-full object-contain select-none"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-gray-800 truncate">
                      {a.quadraNome}
                    </p>
                    <p className="text-[12px] text-gray-600 leading-tight">
                      {a.esporte}
                    </p>
                    <p className="text-[12px] text-gray-500">
                      Dia {a.dia} às {a.hora}
                    </p>
                    {!!a.numero && (
                      <p className="text-[11px] text-gray-500">
                        Quadra {a.numero}
                      </p>
                    )}
                  </div>
                </div>

                {/* Linha divisória fina */}
                <div className="my-2 border-t border-gray-300/70" />

                <p className="text-[12px] text-gray-600">
                  Transferência realizada para:{" "}
                  <span className="font-semibold text-gray-700">
                    {a.paraQuem ?? "—"}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* safe-area iOS */}
      <div className="supports-[padding:env(safe-area-inset-bottom)]:pb-[env(safe-area-inset-bottom)]" />
    </main>
  );
}
