"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import { isoLocalDate } from "@/utils/date";
import AppImage from "@/components/AppImage";

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
  logoUrl?: string | null; // pode vir vazio/indefinido, o AppImage resolve
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;       // "dd/MM"
  hora: string;      // "HH:mm"
  paraQuem?: string; // nome completo de quem recebeu
};

export default function TransferenciasAnterioresPage() {
  // 🔒 Proteção (mesmo conjunto da Home)
  const { isChecking } = useRequireAuth([
    "CLIENTE",
    "ADMIN_MASTER",
    "ADMIN_ATENDENTE",
    "ADMIN_PROFESSORES",
  ]);

  const router = useRouter();

  const [itens, setItens] = useState<Card[]>([]);
  const [carregando, setCarregando] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const UPLOADS_PREFIX =
    (process.env.NEXT_PUBLIC_UPLOADS_PREFIX || "/uploads/quadras").trim();

  const hojeISO = useMemo(
    () => isoLocalDate(new Date(), "America/Sao_Paulo"),
    []
  );

  // Helpers
  const paraDDMM = useCallback((iso?: string) => {
    const s = (iso || hojeISO).slice(0, 10);
    const [, m, d] = s.split("-");
    return `${d}/${m}`;
  }, [hojeISO]);

  /** Normaliza APENAS o valor bruto: deixa absoluto como está,
   * converte '/uploads/...' para absoluto no backend,
   * deixa nome de arquivo simples para o AppImage resolver (legado).
   */
  const normalizeSrc = useCallback((raw?: string | null) => {
    if (!raw) return null;
    const v = raw.trim();
    if (!v) return null;

    // Absoluto (R2, data, blob) → usa como está
    if (/^(https?:|data:|blob:)/i.test(v)) return v;

    // Caminho do backend começando com /uploads → prefixa o BACKEND
    if (v.startsWith("/uploads/")) return `${API_URL}${v}`;

    // Nome de arquivo simples (legado) → deixe para o AppImage montar com legacyDir
    // Qualquer outro relativo raro → prefixa BACKEND
    if (/^[\w.\-]+$/.test(v)) return v;
    return `${API_URL}/${v.replace(/^\/+/, "")}`;
  }, [API_URL]);

  /** Monta o card e deixa o AppImage completar a URL final */
  const normalizar = useCallback(
    (raw: TransferidoAPI): Card => {
      // prioridade: URL absoluta do backend novo > nome do arquivo legado
      const picked = normalizeSrc(raw.quadraLogoUrl) ?? normalizeSrc(raw.quadraImagem);

      return {
        id: raw.id,
        logoUrl: picked ?? null,
        quadraNome: raw.quadraNome || "Quadra",
        numero: raw.quadraNumero != null ? String(raw.quadraNumero) : undefined,
        esporte: raw.esporteNome || "",
        dia: paraDDMM(raw.data),
        hora: raw.horario,
        paraQuem: raw.transferidoPara?.nome || undefined,
      };
    },
    [normalizeSrc, paraDDMM]
  );

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
  }, [API_URL, isChecking, normalizar]);

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
                    <AppImage
                      src={a.logoUrl ?? undefined}
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
