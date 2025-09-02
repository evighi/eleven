"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

import { isoLocalDate } from "@/utils/date";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import AppImage from "@/components/AppImage";

type Status = "CONFIRMADO" | "FINALIZADO" | "CANCELADO" | "TRANSFERIDO";
type TipoReserva = "COMUM" | "PERMANENTE";

type AgendamentoAPI = {
  id: string;
  horario: string;
  status?: Status;

  // comuns
  data?: string;

  // permanentes
  diaSemana?: "DOMINGO" | "SEGUNDA" | "TERCA" | "QUARTA" | "QUINTA" | "SEXTA" | "SABADO";
  proximaData?: string | null;

  // metadados (compat + novos)
  nome?: string;
  local?: string;
  logoUrl?: string | null;
  quadraNome?: string;
  quadraNumero?: number | string | null;
  quadraLogoUrl?: string | null;
  esporteNome?: string;

  // NOVO (já vem do back)
  tipoReserva: TipoReserva;
};

type AgendamentoCard = {
  id: string;
  logoUrl?: string | null;
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;   // "dd/mm" ou "Quarta"
  hora: string;
  tipo: TipoReserva;
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
    (iso?: string | null) => {
      const s = (iso || hojeISO).slice(0, 10);
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

  const prettyDiaSemana = (d?: AgendamentoAPI["diaSemana"]) => {
    if (!d) return "";
    return d.charAt(0) + d.slice(1).toLowerCase(); // "QUARTA" -> "Quarta"
  };

  const normalizar = useCallback(
    (raw: AgendamentoAPI): AgendamentoCard => {
      const picked = raw.quadraLogoUrl ?? raw.logoUrl ?? null;

      // decidir “dia”
      let diaStr = "";
      if (raw.tipoReserva === "COMUM") {
        diaStr = paraDDMM(raw.data);
      } else {
        // PERMANENTE: usa proximaData (se vier) ou o dia da semana
        diaStr = raw.proximaData ? paraDDMM(raw.proximaData) : prettyDiaSemana(raw.diaSemana);
      }

      return {
        id: raw.id,
        logoUrl: picked,
        quadraNome: raw.quadraNome || (raw.local?.split(" - Nº")[0] ?? "Quadra"),
        numero: String(raw.quadraNumero ?? extrairNumeroDoLocal(raw.local) ?? "") || undefined,
        esporte: raw.esporteNome ?? raw.nome ?? "",
        dia: diaStr,
        hora: raw.horario,
        tipo: raw.tipoReserva,
      };
    },
    [extrairNumeroDoLocal, paraDDMM]
  );

  useEffect(() => {
    if (isChecking) return;

    const fetchAgendamentos = async () => {
      setCarregando(true);
      try {
        const res = await axios.get<AgendamentoAPI[]>(
          `${API_URL}/agendamentos/me`,
          { withCredentials: true } // não precisa mais mandar ?data=...
        );

        // o back já filtra comuns CONFIRMADOS e permanentes ativos
        const list = (res.data || []).map(normalizar);

        // ordenar por data (ou proximaData) + hora
        list.sort((a, b) => {
          // se “dia” for dd/mm, ordenamos por mês/dia; se for “Quarta”, mantém depois
          const isDDMM = (s: string) => /^\d{2}\/\d{2}$/.test(s);
          const aDD = isDDMM(a.dia), bDD = isDDMM(b.dia);
          if (aDD && bDD) {
            const [ad, am] = a.dia.split("/").map(Number);
            const [bd, bm] = b.dia.split("/").map(Number);
            if (am !== bm) return am - bm;
            if (ad !== bd) return ad - bd;
          } else if (aDD !== bDD) {
            return aDD ? -1 : 1; // datas (dd/mm) antes de “Quarta”
          }
          return a.hora.localeCompare(b.hora);
        });

        setAgendamentos(list);
      } catch (e) {
        console.error(e);
        setAgendamentos([]);
      } finally {
        setCarregando(false);
      }
    };

    fetchAgendamentos();
  }, [API_URL, isChecking, normalizar]);

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
      {/* Header */}
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 py-5">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label="Voltar"
            className="rounded-full bg-white/15 hover:bg-white/25 transition p-2 leading-none"
          >
            <span className="inline-block rotate-180 text-xl cursor-pointer">➜</span>
          </button>
          <h1 className="text-2xl font-extrabold tracking-wide drop-shadow-sm">
            Suas quadras
          </h1>
        </div>
      </header>

      {/* Lista */}
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
              Você não tem agendamentos.
            </p>
          )}

          <div className="space-y-3">
            {agendamentos.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl bg-[#f3f3f3] px-3 py-2.5 shadow-sm"
              >
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

                  <p className="text-[12px] text-gray-600 leading-tight flex items-center gap-2">
                    {a.esporte}
                    <span
                      className={`text-[10px] px-2 py-[2px] rounded-full ${
                        a.tipo === "PERMANENTE"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-sky-100 text-sky-700"
                      }`}
                      title={a.tipo === "PERMANENTE" ? "Agendamento permanente" : "Agendamento comum"}
                    >
                      {a.tipo === "PERMANENTE" ? "Permanente" : "Comum"}
                    </span>
                  </p>

                  <p className="text-[12px] text-gray-500">
                    {/* Se “dia” é dd/mm => mostra “Dia”; se for palavra (Quarta) => “Toda” */}
                    {/^\d{2}\/\d{2}$/.test(a.dia)
                      ? <>Dia {a.dia} às {a.hora}</>
                      : <>Toda {a.dia} às {a.hora}</>}
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
