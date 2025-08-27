/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { isoLocalDate } from "@/utils/date";

import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";

type AgendamentoAPI = {
  id: string;
  horario: string;
  data?: string;
  nome?: string;
  local?: string;
  logoUrl?: string;
  quadraNome?: string;
  quadraNumero?: number | string | null;
  quadraLogoUrl?: string;
  esporteNome?: string;
  status?: "CONFIRMADO" | "FINALIZADO" | "CANCELADO" | "TRANSFERIDO";
};

type AgendamentoCard = {
  id: string;
  logoUrl: string;
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;
  hora: string;
};

export default function VerQuadrasPage() {
  const { isChecking } = useRequireAuth([
    "CLIENTE",
    "ADMIN_MASTER",
    "ADMIN_ATENDENTE",
    "ADMIN_PROFESSORES",
  ]);

  const router = useRouter();

  const [agendamentos, setAgendamentos] = useState<AgendamentoCard[]>([]);
  const [carregando, setCarregando] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const hojeISO = useMemo(() => isoLocalDate(new Date(), "America/Sao_Paulo"), []);

  const paraDDMM = useCallback(
    (iso?: string) => {
      const s = iso || hojeISO;
      const [, m, d] = s.split("-");
      return `${d}/${m}`;
    },
    [hojeISO]
  );

  const extrairNumeroDoLocal = useCallback((local?: string) => {
    if (!local) return undefined;
    const m = local.match(/N[ºo]\s*(\d+)/i);
    return m?.[1];
  }, []);

  const toAbsolute = useCallback(
    (u?: string) => {
      if (!u) return "/quadra.png";
      if (/^https?:\/\//i.test(u)) return u;
      return `${API_URL}${u.startsWith("/") ? "" : "/"}${u}`;
    },
    [API_URL]
  );

  const getNumero = useCallback(
    (raw: AgendamentoAPI) => {
      const n = raw.quadraNumero ?? extrairNumeroDoLocal(raw.local) ?? "";
      return String(n || "") || undefined;
    },
    [extrairNumeroDoLocal]
  );

  const normalizar = useCallback(
    (raw: AgendamentoAPI): AgendamentoCard => ({
      id: raw.id,
      logoUrl: toAbsolute(raw.quadraLogoUrl ?? raw.logoUrl),
      quadraNome: raw.quadraNome || (raw.local?.split(" - Nº")[0] ?? "Quadra"),
      numero: getNumero(raw),
      esporte: raw.esporteNome ?? raw.nome ?? "",
      dia: paraDDMM(raw.data),
      hora: raw.horario,
    }),
    [toAbsolute, getNumero, paraDDMM]
  );

  useEffect(() => {
    if (isChecking) return;

    const fetchAgendamentos = async () => {
      setCarregando(true);
      try {
        const res = await axios.get<AgendamentoAPI[]>(
          `${API_URL}/agendamentos/me`,
          { withCredentials: true, params: { data: hojeISO } }
        );

        const confirmados = (res.data || []).filter((a) => a.status === "CONFIRMADO");
        setAgendamentos(confirmados.map(normalizar));
      } catch (e) {
        console.error(e);
        setAgendamentos([]);
      } finally {
        setCarregando(false);
      }
    };

    fetchAgendamentos();
  }, [API_URL, hojeISO, isChecking, normalizar]);

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
      {/* Header laranja, com título e voltar */}
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 py-5">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label="Voltar"
            className="rounded-full bg-white/15 hover:bg-white/25 transition p-2 leading-none"
          >
            {/* ícone simples de voltar (caret) */}
            <span className="inline-block rotate-180 text-xl cursor-pointer">➜</span>
          </button>
          <h1 className="text-2xl font-extrabold tracking-wide drop-shadow-sm">
            Suas quadras
          </h1>
        </div>
      </header>

      {/* Card branco com a lista */}
      <section className="px-0 py-0">
        <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-md p-4">
          <h2 className="text-[13px] font-semibold text-gray-500 mb-3">
            Suas quadras:
          </h2>

          {carregando && (
            <div className="flex items-center gap-2 text-gray-600">
              <Spinner size="w-4 h-4" />
              <span className="text-sm">Carregando…</span>
            </div>
          )}

          {!carregando && agendamentos.length === 0 && (
            <p className="text-sm text-gray-500">
              Você não tem agendamentos para hoje.
            </p>
          )}

          <div className="space-y-3">
            {agendamentos.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl bg-[#f3f3f3] px-3 py-2.5 shadow-sm"
              >
                {/* Logo (mais larga e sem borda) */}
                <div className="shrink-0 w-28 h-12 sm:w-36 sm:h-14 md:w-40 md:h-16 flex items-center justify-center overflow-hidden">
                  <img
                    src={a.logoUrl}
                    alt={a.quadraNome}
                    className="w-full h-full object-contain select-none"
                    onError={(ev) => ((ev.currentTarget as HTMLImageElement).src = "/quadra.png")}
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
                  {a.numero && (
                    <p className="text-[11px] text-gray-500">Quadra {a.numero}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
