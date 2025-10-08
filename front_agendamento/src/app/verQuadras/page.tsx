"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import axios from "axios";

import { isoLocalDate } from "@/utils/date";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import AppImage from "@/components/AppImage";
import { useAuthStore } from "@/context/AuthStore";

type Status = "CONFIRMADO" | "FINALIZADO" | "CANCELADO" | "TRANSFERIDO";
type TipoReserva = "COMUM" | "PERMANENTE";

// 👉 TIPOS DE USUÁRIO (para a regra)
type TipoUsuario =
  | "CLIENTE"
  | "ADMIN_MASTER"
  | "ADMIN_ATENDENTE"
  | "ADMIN_PROFESSORES";

type AgendamentoAPI = {
  id: string;
  horario: string;
  status?: Status;

  // comuns
  data?: string;

  // permanentes
  diaSemana?: "DOMINGO" | "SEGUNDA" | "TERCA" | "QUARTA" | "QUINTA" | "SEXTA" | "SABADO";
  proximaData?: string | null;

  // bloqueio (permanente)
  proximaDataBloqueada?: boolean;
  proximaDataBloqueioInicio?: string;
  proximaDataBloqueioFim?: string;

  // metadados
  nome?: string;
  local?: string;
  logoUrl?: string | null;
  quadraNome?: string;
  quadraNumero?: number | string | null;
  quadraLogoUrl?: string | null;
  esporteNome?: string;

  // novos campos
  donoId?: string;
  donoNome?: string;
  euSouDono?: boolean;

  tipoReserva: TipoReserva;
};

type AgendamentoCard = {
  id: string;
  logoUrl?: string | null;
  quadraNome: string;
  numero?: string;
  esporte: string;
  dia: string;             // "dd/mm" ou "Quarta"
  hora: string;
  tipo: TipoReserva;
  _rawDataISO?: string | null; // comuns: data | permanentes: proximaData efetiva

  donoNome?: string | null;
  euSouDono?: boolean;

  // bloqueio (permanentes)
  bloqueado?: boolean;
  bloqueioInicio?: string | null;
  bloqueioFim?: string | null;
};

/* ============================================================
   🔸 Regras de cancelamento — implementadas AQUI no arquivo
   ============================================================ */
function cancellationWindowHours(tipo?: TipoUsuario): number {
  if (tipo === "ADMIN_MASTER" || tipo === "ADMIN_ATENDENTE") return Infinity; // sem limite
  if (tipo === "ADMIN_PROFESSORES") return 2; // 2h antes
  return 12; // cliente
}
/** Converte Y-M-D + HH:mm para timestamp considerando America/Sao_Paulo */
function tsFromSP(ymd: string, hm: string) {
  const safeHM = /^\d{2}:\d{2}$/.test(hm) ? hm : "00:00";
  return new Date(`${ymd}T${safeHM}:00-03:00`).getTime();
}
/** Parecer de cancelamento p/ UI (o back ainda é a autoridade por causa da exceção de 15min) */
function getCancelPolicy({
  userTipo,
  dataISO, // "YYYY-MM-DD"
  horario, // "HH:mm"
  agoraTs = Date.now(),
}: {
  userTipo?: TipoUsuario;
  dataISO: string | null | undefined;
  horario: string;
  agoraTs?: number;
}) {
  if (!dataISO) {
    return {
      regraTexto: "Regra de cancelamento conforme perfil do usuário.",
      minutesLeft: Infinity,
      jaIniciado: false,
      dentroJanela: false,
      canTryCancel: true,
      warning: undefined as string | undefined,
      limitHours: cancellationWindowHours(userTipo),
    };
  }

  const limitHours = cancellationWindowHours(userTipo);
  const startTs = tsFromSP(dataISO, horario);

  const diffMs = startTs - agoraTs;
  const minutesLeft = Math.floor(diffMs / 60000);
  const requiredMinutes = limitHours === Infinity ? 0 : limitHours * 60;

  const jaIniciado = minutesLeft <= 0;
  const dentroJanela = limitHours !== Infinity && minutesLeft < requiredMinutes;

  const regraTexto =
    limitHours === Infinity
      ? "Cancelamento liberado para administradores."
      : `Cancelamento permitido até ${limitHours}h antes do horário.`;

  const canTryCancel = !jaIniciado;

  const warning =
    jaIniciado
      ? "Não é possível cancelar um agendamento já iniciado."
      : dentroJanela
      ? "Falta menos que o limite. O cancelamento pode ser recusado, exceto nos 15min após a criação."
      : undefined;

  return { regraTexto, minutesLeft, jaIniciado, dentroJanela, canTryCancel, warning, limitHours };
}

export default function VerQuadrasPage() {
  const { isChecking } = useRequireAuth([
    "CLIENTE",
    "ADMIN_MASTER",
    "ADMIN_ATENDENTE",
    "ADMIN_PROFESSORES",
  ]);

  const router = useRouter();
  const { usuario } = useAuthStore();

  const [agendamentos, setAgendamentos] = useState<AgendamentoCard[]>([]);
  const [carregando, setCarregando] = useState(false);

  const [view, setView] = useState<"list" | "success">("list");

  // modal de cancelamento
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AgendamentoCard | null>(null);
  const [cancelSending, setCancelSending] = useState(false);
  const [cancelError, setCancelError] = useState<string>("");

  // sucesso
  const [cancelSuccess, setCancelSuccess] = useState<AgendamentoCard | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const hojeISO = useMemo(() => isoLocalDate(new Date(), "America/Sao_Paulo"), []);

  const isCliente = usuario?.tipo === "CLIENTE";
  const isProfessor = usuario?.tipo === "ADMIN_PROFESSORES";
  // (admins com limite infinito não exibirão avisos também)

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

  const prettyDiaSemana = (d?: AgendamentoAPI["diaSemana"]) =>
    d ? d.charAt(0) + d.slice(1).toLowerCase() : "";

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
      timeZone: tz, year: "numeric", month: "2-digit", day: "numeric",
    }).format(d);
    // formata com zero no dia
    const [yy, mm, ddAny] = ymd.split("-");
    const dd = String(ddAny).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  const normalizar = useCallback(
    (raw: AgendamentoAPI): AgendamentoCard => {
      const picked = raw.quadraLogoUrl ?? raw.logoUrl ?? null;

      let isoEfetiva: string | null = null;
      if (raw.tipoReserva === "COMUM") {
        isoEfetiva = raw.data ?? null;
      } else {
        isoEfetiva = raw.proximaData ?? proximaDataLocalQuandoFaltar(raw.diaSemana, raw.horario) ?? null;
      }

      const diaStr =
        isoEfetiva
          ? paraDDMM(isoEfetiva)
          : (raw.tipoReserva === "PERMANENTE" ? prettyDiaSemana(raw.diaSemana) : paraDDMM(raw.data));

      const bloqueado = raw.tipoReserva === "PERMANENTE" ? !!raw.proximaDataBloqueada : false;
      const bloqueioInicio = raw.proximaDataBloqueioInicio ?? null;
      const bloqueioFim = raw.proximaDataBloqueioFim ?? null;

      return {
        id: raw.id,
        logoUrl: picked,
        quadraNome: raw.quadraNome || (raw.local?.split(" - Nº")[0] ?? "Quadra"),
        numero: String(raw.quadraNumero ?? extrairNumeroDoLocal(raw.local) ?? "") || undefined,
        esporte: raw.esporteNome ?? raw.nome ?? "",
        dia: diaStr,
        hora: raw.horario,
        tipo: raw.tipoReserva,
        _rawDataISO: isoEfetiva,

        donoNome: raw.donoNome ?? null,
        euSouDono: raw.euSouDono ?? false,

        bloqueado,
        bloqueioInicio,
        bloqueioFim,
      };
    },
    [extrairNumeroDoLocal, paraDDMM]
  );

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await axios.get<AgendamentoAPI[]>(
        `${API_URL}/agendamentos/me`,
        { withCredentials: true }
      );
      const list = (res.data || []).map(normalizar);

      list.sort((a, b) => {
        const ai = a._rawDataISO, bi = b._rawDataISO;
        if (ai && bi) {
          if (ai !== bi) return ai.localeCompare(bi);
          return a.hora.localeCompare(b.hora);
        }
        if (ai && !bi) return -1;
        if (!ai && bi) return 1;
        const isDDMM = (s: string) => /^\d{2}\/\d{2}$/.test(s);
        const aDD = isDDMM(a.dia), bDD = isDDMM(b.dia);
        if (aDD && bDD) {
          const [ad, am] = a.dia.split("/").map(Number);
          const [bd, bm] = b.dia.split("/").map(Number);
          if (am !== bm) return am - bm;
          if (ad !== bd) return ad - bd;
        } else if (aDD !== bDD) {
          return aDD ? -1 : 1;
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
  }, [API_URL, normalizar]);

  useEffect(() => {
    if (isChecking) return;
    carregarLista();
  }, [carregarLista, isChecking]);

  // Mensagens de erro vindas do back (com 12h/2h)
  const parseErro = (e: unknown): string => {
    const ax = e as { response?: { data?: any; status?: number; statusText?: string } };
    const body = ax?.response?.data;
    const msg =
      (typeof body?.erro === "string" && body.erro) ||
      (typeof body?.message === "string" && body.message) ||
      (ax?.response?.statusText ?? "");
    const lowered = String(msg).toLowerCase();
    if (
      lowered.includes("12h") ||
      lowered.includes("12 horas") ||
      lowered.includes("2h") ||
      lowered.includes("2 horas") ||
      lowered.includes("janela de cancelamento") ||
      lowered.includes("faltam menos de")
    ) {
      return "O prazo para cancelamento desta reserva foi esgotado e não poderá ser cancelado. Contate os administradores. (53) 99103-2959";
    }
    return msg || "Não foi possível cancelar. Tente novamente.";
  };

  const abrirModalCancelar = (a: AgendamentoCard) => {
    setCancelTarget(a);
    setCancelError("");
    setCancelOpen(true);
  };
  const fecharModalCancelar = () => {
    if (cancelSending) return;
    setCancelOpen(false);
    setCancelTarget(null);
    setCancelError("");
  };

  // tenta montar um "card" a partir do retorno do back; se nada, usa fallback
  const montarCardDeRetorno = (resp: any, fallback: AgendamentoCard): AgendamentoCard => {
    try {
      const raw: Partial<AgendamentoAPI> = resp?.agendamento ?? resp ?? {};
      const merged: AgendamentoAPI = {
        id: String(raw.id ?? fallback.id),
        horario: String(raw.horario ?? fallback.hora),
        tipoReserva: (raw.tipoReserva as TipoReserva) ?? fallback.tipo,
        data: (raw.data as string) ?? fallback._rawDataISO ?? undefined,
        proximaData: (raw.proximaData as string | null) ?? (fallback._rawDataISO ?? null),
        diaSemana: (raw.diaSemana as any) ?? undefined,
        nome: raw.nome ?? undefined,
        esporteNome: raw.esporteNome ?? fallback.esporte,
        quadraNome: raw.quadraNome ?? fallback.quadraNome,
        quadraNumero: (raw.quadraNumero as any) ?? fallback.numero,
        quadraLogoUrl: (raw.quadraLogoUrl as any) ?? fallback.logoUrl,
        logoUrl: raw.logoUrl ?? undefined,
        donoNome: raw.donoNome ?? fallback.donoNome,
        euSouDono: raw.euSouDono ?? fallback.euSouDono,
        proximaDataBloqueada: raw.proximaDataBloqueada ?? undefined,
        proximaDataBloqueioInicio: raw.proximaDataBloqueioInicio ?? undefined,
        proximaDataBloqueioFim: raw.proximaDataBloqueioFim ?? undefined,
        local: raw.local ?? undefined,
        status: (raw.status as Status) ?? undefined,
      } as any;

      return normalizar(merged);
    } catch {
      return fallback;
    }
  };

  const confirmarCancelamento = async () => {
    if (!cancelTarget) return;
    setCancelError("");
    setCancelSending(true);

    try {
      let respData: any | null = null;

      if (cancelTarget.tipo === "COMUM") {
        const { data: resp } = await axios.post(
          `${API_URL}/agendamentos/cancelar/${cancelTarget.id}`,
          {},
          { withCredentials: true }
        );
        respData = resp ?? null;

        setAgendamentos((cur) => cur.filter((x) => x.id !== cancelTarget.id));
      } else {
        // permanente → cancelar apenas a PRÓXIMA ocorrência
        const url1 = `${API_URL}/agendamentos-permanentes/${cancelTarget.id}/cancelar-proxima`;
        const url2 = `${API_URL}/agendamentosPermanentes/${cancelTarget.id}/cancelar-proxima`;
        try {
          const { data: resp } = await axios.post(url1, {}, { withCredentials: true });
          respData = resp ?? null;
        } catch (e1: any) {
          if (e1?.response?.status === 404) {
            const { data: resp } = await axios.post(url2, {}, { withCredentials: true });
            respData = resp ?? null;
          } else {
            throw e1;
          }
        }
        await carregarLista();
      }

      const card = montarCardDeRetorno(respData, cancelTarget);
      setCancelSuccess(card);

      fecharModalCancelar();
      setView("success");
      return;
    } catch (e) {
      setCancelError(parseErro(e));
    } finally {
      setCancelSending(false);
    }
  };

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

  // 🔸 Topo: mostrar aviso SOMENTE para professores
  const avisoTopo = isProfessor
    ? "Cancelamento permitido até 2 horas de antecedência. Se a reserva foi criada faltando menos que isso, você pode cancelar em até 15 minutos após a criação. Em caso de dúvidas, contate os administradores. (53) 99103-2959"
    : null;

  const SuccessCard = ({ a }: { a: AgendamentoCard }) => {
    const isPermanente = a.tipo === "PERMANENTE";
    return (
      <div className="w-full rounded-xl bg-[#f7f7f7] pt-3 pb-2 px-3 shadow-sm border border-gray-200">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-28 h-12 sm:w-36 sm:h-14 flex items-center justify-center overflow-hidden">
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
            <p className="text-[13px] font-semibold text-gray-800 truncate">{a.quadraNome}</p>
            <p className="text-[12px] text-gray-600 leading-tight flex items-center gap-2">
              {a.esporte}
              <span
                className={`text-[10px] px-2 py-[2px] rounded-full ${
                  isPermanente ? "bg-gray-200 text-gray-800" : "bg-orange-100 text-orange-600"
                }`}
              >
                {isPermanente ? "Permanente" : "Comum"}
              </span>
            </p>
            <p className="text-[12px] text-gray-500">
              {/^\d{2}\/\d{2}$/.test(a.dia)
                ? <>Dia {a.dia} às {a.hora}</>
                : <>Toda {a.dia} às {a.hora}</>}
              {a.numero ? <> · Quadra {a.numero}</> : null}
            </p>
          </div>
        </div>

        <div className="mt-3 p-3 rounded-lg bg-white">
          {isPermanente ? (
            <p className="text-[13px] text-gray-700">
              Você cancelou <b>apenas a próxima ocorrência</b> deste agendamento permanente.
            </p>
          ) : (
            <p className="text-[13px] text-gray-700">
              Você cancelou esta <b>reserva comum</b>.
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#f5f5f5]">
      {/* Header dinâmico */}
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 py-5">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            onClick={() => (view === "success" ? setView("list") : router.back())}
            aria-label="Voltar"
            className="rounded-full bg-white/15 hover:bg-white/25 transition p-2 leading-none"
          >
            <span className="inline-block rotate-180 text-xl cursor-pointer">➜</span>
          </button>
        <h1 className="text-2xl font-extrabold tracking-wide drop-shadow-sm">
            {view === "success" ? "Reserva cancelada" : "Suas quadras"}
          </h1>
        </div>
      </header>

      {view === "list" && (
        <section className="px-0 py-0">
          <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-md p-4">
            {/* Aviso geral — SOMENTE professores */}
            {avisoTopo && (
              <div className="text-center text-orange-600 text-[12px] leading-snug mb-3">
                <div className="font-semibold text-[11px] tracking-wide uppercase mb-1">Atenção!</div>
                {avisoTopo}
              </div>
            )}

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
              {agendamentos.map((a) => {
                const isBloqueado = a.tipo === "PERMANENTE" && a.bloqueado;

                // policy por item
                const policy = getCancelPolicy({
                  userTipo: usuario?.tipo as TipoUsuario,
                  dataISO: a._rawDataISO,
                  horario: a.hora,
                });

                const cancelarDisabled = policy.jaIniciado || !a.euSouDono;

                return (
                  <div
                    key={a.id}
                    className="rounded-xl bg-[#f3f3f3] pt-3 pb-2 px-3 shadow-sm"
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

                        <p className="text-[12px] text-gray-600 leading-tight flex items-center gap-2">
                          {a.esporte}
                          <span
                            className={`text-[10px] px-2 py-[2px] rounded-full ${
                              a.tipo === "PERMANENTE"
                                ? "bg-gray-200 text-gray-800"
                                : "bg-orange-100 text-orange-600"
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

                        {/* Data/Hora */}
                        <p
                          className={`text-[12px] ${
                            isBloqueado ? "text-red-600 font-semibold" : "text-gray-500"
                          }`}
                        >
                          {/^\d{2}\/\d{2}$/.test(a.dia)
                            ? <>Dia {a.dia} às {a.hora}</>
                            : <>Toda {a.dia} às {a.hora}</>}
                        </p>

                        {isBloqueado && (
                          <p className="mt-0.5 text-[11px] text-red-600">
                            A quadra está bloqueada nesta data
                            {a.bloqueioInicio && a.bloqueioFim ? (
                              <> (das {a.bloqueioInicio} às {a.bloqueioFim})</>
                            ) : null}.
                            Seu agendamento permanece, mas não será utilizável por conta do evento.
                          </p>
                        )}

                        {!a.euSouDono && a.donoNome && (
                          <p className="text-[11px] text-gray-500 italic">
                            Reservado por: {a.donoNome}
                          </p>
                        )}

                        {a.numero && (
                          <p className="text-[11px] text-gray-500">Quadra {a.numero}</p>
                        )}

                        {/* 🔸 Avisos por item — SOMENTE para professores */}
                        {isProfessor && (
                          <div className="mt-1">
                            <p className="text-[11px] text-gray-500">{policy.regraTexto}</p>
                            {policy.warning && (
                              <p className="text-[11px] text-amber-700">{policy.warning}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="mt-2 border-t border-gray-300/70" />
                    <div className="flex gap-2 pt-2">
                      {a.euSouDono ? (
                        <button
                          onClick={() => abrirModalCancelar(a)}
                          disabled={cancelarDisabled}
                          className={`w-full py-2 text-[13px] font-semibold ${
                            cancelarDisabled
                              ? "text-gray-400 cursor-not-allowed"
                              : "text-orange-600 hover:text-orange-700 cursor-pointer"
                          }`}
                          title={
                            !a.euSouDono
                              ? "Apenas o dono pode cancelar esta reserva"
                              : policy.jaIniciado
                              ? "O horário já passou/iniciou."
                              : "Cancelar agendamento"
                          }
                        >
                          Cancelar agendamento
                        </button>
                      ) : (
                        <button
                          disabled
                          className="w-full py-2 text-[13px] font-semibold text-gray-400 cursor-not-allowed"
                          title="Apenas o dono pode cancelar esta reserva"
                        >
                          Cancelar agendamento
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {view === "success" && (
        <section className="px-4 md:px-0 py-6">
          <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-md p-6 flex flex-col items-center text-center">
            <div className="w-56 h-56 mb-4">
              <Image
                src="/icons/realizada.png"
                alt="Reserva cancelada"
                width={224}
                height={224}
                className="w-full h-full object-contain"
                priority
              />
            </div>

            <h2 className="text-xl font-extrabold text-orange-600 mb-2">
              {cancelSuccess?.tipo === "PERMANENTE"
                ? "Próxima ocorrência cancelada!"
                : "Reserva cancelada!"}
            </h2>

            <p className="text-[13px] text-gray-600 mb-4">
              {cancelSuccess?.tipo === "PERMANENTE"
                ? "Cancelamos apenas a próxima data deste agendamento permanente."
                : "Cancelamos sua reserva com sucesso."}
            </p>

            {cancelSuccess && <SuccessCard a={cancelSuccess} />}

            <button
              onClick={() => {
                setView("list");
                carregarLista();
              }}
              className="mt-5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold px-4 py-2 shadow-md cursor-pointer"
            >
              Voltar às suas quadras
            </button>
          </div>
        </section>
      )}

      {/* Modal: confirmar cancelamento */}
      {cancelOpen && cancelTarget && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={fecharModalCancelar}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-4 border border-gray-200">
              <h3 className="text-base font-bold text-gray-800 mb-1 text-center">
                Confirmar cancelamento?
              </h3>

              <p className="text-sm text-gray-700 mb-1">Você está cancelando:</p>

              <p className="text-[13px] font-semibold text-gray-800 mb-2">
                {cancelTarget.esporte} — Quadra {cancelTarget.numero ?? "—"}: {cancelTarget.quadraNome}{" "}
                no dia{" "}
                {cancelTarget._rawDataISO ? paraDDMM(cancelTarget._rawDataISO) : cancelTarget.dia}{" "}
                às {cancelTarget.hora}.
                {cancelTarget.tipo === "PERMANENTE" && " (permanente — próxima reserva)"}
              </p>

              {/* Rodapé da regra — SOMENTE para professores */}
              {isProfessor && (() => {
                const policy = getCancelPolicy({
                  userTipo: usuario?.tipo as TipoUsuario,
                  dataISO: cancelTarget._rawDataISO,
                  horario: cancelTarget.hora,
                });
                return (
                  <>
                    <p className="text-[12px] text-gray-500 italic">{policy.regraTexto}</p>
                    {policy.dentroJanela && (
                      <p className="text-[12px] text-amber-700">
                        Falta menos que o limite. Salvo exceção de 15min após a criação.
                      </p>
                    )}
                    {policy.jaIniciado && (
                      <p className="text-[12px] text-red-600">O horário já passou/iniciou.</p>
                    )}
                  </>
                );
              })()}

              {cancelError && (
                <div className="mt-3 rounded-md bg-red-100 text-red-800 text-[13px] px-3 py-2">
                  {cancelError}
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={fecharModalCancelar}
                  disabled={cancelSending}
                  className="rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-semibold px-4 py-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Voltar
                </button>
                <button
                  onClick={confirmarCancelamento}
                  disabled={cancelSending}
                  className="rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold px-4 py-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {cancelSending && <Spinner size="w-4 h-4" />}
                  {cancelSending ? "Cancelando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="supports-[padding:env(safe-area-inset-bottom)]:pb-[env(safe-area-inset-bottom)]" />
    </main>
  );
}
