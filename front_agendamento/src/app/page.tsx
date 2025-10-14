"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import axios from "axios";
import { isoLocalDate } from "@/utils/date";

import { useAuthStore } from "@/context/AuthStore";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import { API_URL } from "@/utils/urls";
import AppImage from "@/components/AppImage";

type Status = "CONFIRMADO" | "FINALIZADO" | "CANCELADO" | "TRANSFERIDO";
type TipoReserva = "COMUM" | "PERMANENTE";

type AgendamentoAPI = {
  id: string;
  horario: string;
  status?: Status;

  data?: string;

  diaSemana?: "DOMINGO" | "SEGUNDA" | "TERCA" | "QUARTA" | "QUINTA" | "SEXTA" | "SABADO";
  proximaData?: string | null;

  proximaDataBloqueada?: boolean;
  proximaDataBloqueioInicio?: string;
  proximaDataBloqueioFim?: string;

  nome?: string;
  local?: string;
  logoUrl?: string | null;
  quadraNome?: string;
  quadraNumero?: number | string | null;
  quadraLogoUrl?: string | null;
  esporteNome?: string;

  donoId?: string;
  donoNome?: string;
  euSouDono?: boolean;

  tipoReserva: TipoReserva;
};

type AgendamentoCard = {
  id: string;
  logoUrl: string | null;
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;
  hora: string;
  tipo: TipoReserva;

  donoNome?: string | null;
  euSouDono?: boolean;

  bloqueado?: boolean;
  bloqueioInicio?: string | null;
  bloqueioFim?: string | null;

  nextISO: string | null;
  sortTs: number;
};

export default function Home() {
  const { isChecking } = useRequireAuth([
    "CLIENTE",
    "ADMIN_MASTER",
    "ADMIN_ATENDENTE",
    "ADMIN_PROFESSORES",
  ]);

  const router = useRouter();
  const { usuario } = useAuthStore();

  const [nomeUsuario, setNomeUsuario] = useState("Usuário");
  const [agendamentos, setAgendamentos] = useState<AgendamentoCard[]>([]);
  const [totalProximos, setTotalProximos] = useState<number>(0);
  const [carregando, setCarregando] = useState(false);
  const HABILITAR_TRANSFERENCIA = false;

  const hojeISO = useMemo(() => isoLocalDate(), []);

  useEffect(() => {
    if (usuario?.nome) setNomeUsuario(usuario.nome.split(" ")[0]);
  }, [usuario?.nome]);

  const paraDDMM = useCallback(
    (iso?: string | null) => {
      const s = (iso || hojeISO).slice(0, 10);
      const [, m, d] = s.split("-");
      return `${d}/${m}`;
    },
    [hojeISO]
  );

  const prettyDiaSemana = (d?: AgendamentoAPI["diaSemana"]) =>
    d ? d.charAt(0) + d.slice(1).toLowerCase() : "";

  function tsFromSP(ymd: string, hora: string) {
    const safeHora = /^\d{2}:\d{2}$/.test(hora) ? hora : "00:00";
    return new Date(`${ymd}T${safeHora}:00-03:00`).getTime();
  }

  function proximaDataLocalQuandoFaltar(
    diaSemana?: AgendamentoAPI["diaSemana"],
    horario?: string
  ) {
    if (!diaSemana) return null;

    const DIA_IDX: Record<NonNullable<AgendamentoAPI["diaSemana"]>, number> = {
      DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
    };

    const tz = "America/Sao_Paulo";
    const now = new Date();

    const cur = now.getDay();
    const target = DIA_IDX[diaSemana];
    let delta = (target - cur + 7) % 7;

    const hasHM = typeof horario === "string" && /^\d{2}:\d{2}$/.test(horario);
    if (delta === 0 && hasHM) {
      const hmNow = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(now);
      if (hmNow >= horario) delta = 7;
    }

    const d = new Date(now);
    d.setDate(d.getDate() + delta);

    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);

    return ymd;
  }

  const normalizar = useCallback(
    (raw: AgendamentoAPI): AgendamentoCard => {
      const logo = raw.quadraLogoUrl ?? raw.logoUrl ?? null;
      const quadraNome = raw.quadraNome || (raw.local?.split(" - Nº")[0] ?? "Quadra");

      let numero: string | undefined;
      if (raw.quadraNumero != null && raw.quadraNumero !== "") {
        numero = String(raw.quadraNumero);
      } else if (raw.local) {
        const m = raw.local.match(/N[ºo]\s*(\d+)/i);
        if (m?.[1]) numero = m[1];
      }

      const nextISO =
        raw.tipoReserva === "COMUM"
          ? (raw.data ?? null)
          : (raw.proximaData ?? proximaDataLocalQuandoFaltar(raw.diaSemana, raw.horario) ?? null);

      const sortTs = nextISO ? tsFromSP(nextISO, raw.horario) : Number.POSITIVE_INFINITY;

      const dia = nextISO ? paraDDMM(nextISO) : prettyDiaSemana(raw.diaSemana);

      const bloqueado = raw.tipoReserva === "PERMANENTE" ? !!raw.proximaDataBloqueada : false;
      const bloqueioInicio = raw.proximaDataBloqueioInicio ?? null;
      const bloqueioFim = raw.proximaDataBloqueioFim ?? null;

      return {
        id: raw.id,
        logoUrl: logo,
        quadraNome,
        numero,
        esporte: raw.esporteNome ?? raw.nome ?? "",
        dia,
        hora: raw.horario,
        tipo: raw.tipoReserva,
        nextISO,
        sortTs,
        donoNome: raw.donoNome ?? null,
        euSouDono: raw.euSouDono ?? false,
        bloqueado,
        bloqueioInicio,
        bloqueioFim,
      };
    },
    [paraDDMM]
  );

  const [totalListados, setTotalListados] = useState(0);

  useEffect(() => {
    if (isChecking) return;

    const fetchAgendamentos = async () => {
      setCarregando(true);
      try {
        const res = await axios.get<AgendamentoAPI[]>(`${API_URL}/agendamentos/me`, {
          withCredentials: true,
        });

        const list = (res.data || []).map(normalizar);

        const agora = Date.now();
        const futuras = list
          .filter((a) => a.sortTs !== Number.POSITIVE_INFINITY && a.sortTs >= agora)
          .sort((a, b) => a.sortTs - b.sortTs);

        setTotalProximos(futuras.length);
        setTotalListados(futuras.length);
        setAgendamentos(futuras.slice(0, 2));
      } catch {
        setAgendamentos([]);
        setTotalProximos(0);
        setTotalListados(0);
      } finally {
        setCarregando(false);
      }
    };

    fetchAgendamentos();
  }, [isChecking, normalizar]);

  const emExibicao = Math.min(totalProximos, 2);
  const plural = (n: number, s: string, p: string) => (n === 1 ? s : p);

  const ehProfessor = usuario?.tipo === "ADMIN_PROFESSORES";
  const gridColsMd =
    ehProfessor && HABILITAR_TRANSFERENCIA
      ? "md:grid-cols-3"
      : (ehProfessor || HABILITAR_TRANSFERENCIA)
      ? "md:grid-cols-2"
      : "md:grid-cols-1";

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
    <main className="min-h-screen bg-[#f5f5f5] touch-manipulation">
      {/* HEADER */}
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 md:px-6 py-5 md:py-6">
        <div className="mx-auto max-w-md md:max-w-lg lg:max-w-xl">
          <h1 className="text-2xl md:text-3xl font-bold tracking-wide drop-shadow-sm">
            Bem vindo(a), {nomeUsuario}!
          </h1>
          <p className="text-sm md:text-base text-white/85">
            Você tem {totalProximos} {plural(totalProximos, "reserva próxima", "reservas próximas")}!
          </p>
        </div>
      </header>

      {/* CONTEÚDO */}
      <section className="px-4 md:px-6 py-3 md:py-4">
        <div className="mx-auto max-w-md md:max-w-lg lg:max-w-xl">
          {/* Cartão Suas quadras */}
          <div className="-mt-3 bg-white rounded-2xl shadow-md p-4 sm:p-5 md:p-6">
            <h2 className="text-[13px] sm:text-sm font-semibold text-gray-500">Suas quadras</h2>
            <p className="text-[11px] sm:text-xs text-gray-400 mt-1">
              Em exibição {emExibicao} {plural(emExibicao, "reserva próxima.", "reservas próximas.")}
              {totalListados > 2 && " Para ver mais reservas, clique em veja as suas quadras."}
            </p>

            {carregando && (
              <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
                <Spinner /> <span>Carregando agendamentos…</span>
              </div>
            )}

            {!carregando && totalProximos === 0 && (
              <p className="mt-3 text-sm text-gray-500">Você não tem reservas futuras.</p>
            )}

            <div className="mt-3 space-y-3">
              {agendamentos.map((a) => {
                const isBloqueado = a.tipo === "PERMANENTE" && a.bloqueado;

                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 sm:gap-4 rounded-xl bg-[#f3f3f3] px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm"
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
                      <p className="text-[13px] sm:text-[15px] font-semibold text-gray-800 truncate">
                        {a.quadraNome}
                      </p>

                      <p className="text-[12px] sm:text-[13px] text-gray-600 leading-tight flex items-center gap-2">
                        {a.esporte}
                        <span
                          className={`text-[10px] px-2 py-[2px] rounded-full ${
                            a.tipo === "PERMANENTE"
                              ? "bg-gray-200 text-gray-800"
                              : "bg-orange-100 text-orange-700"
                          }`}
                          title={a.tipo === "PERMANENTE" ? "Agendamento permanente" : "Agendamento comum"}
                        >
                          {a.tipo === "PERMANENTE" ? "Permanente" : "Comum"}
                        </span>

                        {isBloqueado && (
                          <span
                            className="text-[10px] px-2 py-[2px] rounded-full bg-red-100 text-red-700"
                            title="Ocorrência bloqueada por evento"
                          >
                            Bloqueado
                          </span>
                        )}
                      </p>

                      <p
                        className={`text-[12px] sm:text-[13px] ${
                          isBloqueado ? "text-red-600 font-semibold" : "text-gray-500"
                        }`}
                      >
                        {/^\d{2}\/\d{2}$/.test(a.dia)
                          ? <>Dia {a.dia} às {a.hora}</>
                          : <>Toda {a.dia} às {a.hora}</>}
                      </p>

                      {isBloqueado && (
                        <p className="mt-0.5 text-[11px] sm:text-[12px] text-red-600">
                          A quadra está bloqueada nesta data
                          {a.bloqueioInicio && a.bloqueioFim ? (
                            <> (das {a.bloqueioInicio} às {a.bloqueioFim})</>
                          ) : null}.
                          Seu agendamento permanece, mas não será utilizável por conta do evento.
                        </p>
                      )}

                      {!a.euSouDono && a.donoNome && (
                        <p className="text-[11px] sm:text-[12px] text-gray-500 italic">
                          Reservado por: {a.donoNome}
                        </p>
                      )}

                      {a.numero && (
                        <p className="text-[11px] sm:text-[12px] text-gray-500">Quadra {a.numero}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Link
              href="/verQuadras"
              className="mt-3 inline-flex w-full justify-center rounded-xl bg-[#f3f3f3] py-2 md:py-2.5 text-[13px] md:text-sm font-semibold text-orange-600 hover:bg-[#ececec] transition"
            >
              Veja as suas quadras
            </Link>
          </div>

          {/* Ações */}
          <div className={`mt-4 md:mt-6 grid grid-cols-1 ${gridColsMd} gap-4`}>
            {/* Marcar */}
            <div className="rounded-2xl bg-white shadow-md p-3 md:p-4">
              <h3 className="text-[13px] sm:text-sm font-semibold text-gray-500 mb-2">
                Marque a sua quadra
              </h3>
              <button
                onClick={() => router.push("/agendarQuadra")}
                className="w-full rounded-xl bg-[#f3f3f3] px-3 sm:px-4 py-3 flex items-center justify-between hover:bg-[#ececec] transition"
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center">
                    <Image
                      src="/marcar.png"
                      alt=""
                      width={40}
                      height={40}
                      className="w-9 h-9 sm:w-10 sm:h-10 opacity-70"
                      priority
                    />
                  </div>
                  <div className="w-px h-10 sm:h-12 bg-gray-300" />
                  <span className="pl-3 text-[14px] sm:text-[15px] font-semibold text-orange-600 cursor-pointer">
                    Marque a sua quadra
                  </span>
                </div>
              </button>
            </div>

            {/* Transferir (condicional) */}
            {HABILITAR_TRANSFERENCIA && (
              <div className="rounded-2xl bg-white shadow-md p-3 md:p-4">
                <h3 className="text-[13px] sm:text-sm font-semibold text-gray-500 mb-2">
                  Transfira a sua quadra
                </h3>
                <button
                  onClick={() => router.push("/transferirQuadra")}
                  className="w-full rounded-xl bg-[#f3f3f3] px-3 sm:px-4 py-3 flex items-center justify-between hover:bg-[#ececec] transition"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center">
                      <Image
                        src="/icons/transferencia.png"
                        alt=""
                        width={40}
                        height={40}
                        className="w-9 h-9 sm:w-10 sm:h-10 opacity-70"
                        priority
                      />
                    </div>
                    <div className="w-px h-10 sm:h-12 bg-gray-300" />
                    <span className="pl-3 text-[14px] sm:text-[15px] font-semibold text-orange-600 cursor-pointer">
                      Transfira a sua quadra
                    </span>
                  </div>
                </button>
              </div>
            )}

            {/* >>> NOVO: Quadro do Professor (apenas para ADMIN_PROFESSORES) */}
            {ehProfessor && (
              <div className="rounded-2xl bg-white shadow-md p-3 md:p-4">
                <h3 className="text-[13px] sm:text-sm font-semibold text-gray-500 mb-2">
                  Seu quadro de aulas
                </h3>
                <button
                  onClick={() => router.push("/detalhesProfessor")}
                  className="w-full rounded-xl bg-[#f3f3f3] px-3 sm:px-4 py-3 flex items-center justify-between hover:bg-[#ececec] transition"
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center">
                      <Image
                        src="/icons/editar.png"
                        alt=""
                        width={40}
                        height={40}
                        className="w-9 h-9 sm:w-10 sm:h-10 opacity-70"
                        priority
                      />
                    </div>
                    <div className="w-px h-10 sm:h-12 bg-gray-300" />
                    <span className="pl-3 text-[14px] sm:text-[15px] font-semibold text-orange-600 cursor-pointer">
                      Ver seu quadro de aulas
                    </span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="supports-[padding:env(safe-area-inset-bottom)]:pb-[env(safe-area-inset-bottom)]" />
    </main>
  );
}
