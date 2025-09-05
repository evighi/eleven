"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

import { isoLocalDate } from "@/utils/date";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
import AppImage from "@/components/AppImage";
import { useAuthStore } from "@/context/AuthStore";

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
  // guardas úteis para exibir detalhes no modal
  _rawDataISO?: string | null;
};

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

  // feedback global pós-cancelamento ou de erro
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // modal de cancelamento
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AgendamentoCard | null>(null);
  const [cancelSending, setCancelSending] = useState(false);
  const [cancelError, setCancelError] = useState<string>("");

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
        _rawDataISO: raw.data ?? raw.proximaData ?? null,
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
          { withCredentials: true }
        );

        const list = (res.data || []).map(normalizar);

        // ordenar por data (ou proximaData) + hora
        list.sort((a, b) => {
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

  const parseErro = (e: unknown): string => {
    const ax = e as { response?: { data?: any; status?: number; statusText?: string } };
    const body = ax?.response?.data;
    if (body?.erro) return String(body.erro);
    if (body?.message) return String(body.message);
    if (ax?.response?.statusText) return String(ax.response.statusText);
    try {
      return JSON.stringify(body || e);
    } catch {
      return "Não foi possível cancelar. Tente novamente.";
    }
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

  const confirmarCancelamento = async () => {
    if (!cancelTarget) return;
    setCancelError("");
    setCancelSending(true);

    try {
      // 1) rota nova com regra 12h/15min no back
      await axios.post(
        `${API_URL}/agendamentos/cancelar-cliente/${cancelTarget.id}`,
        {},
        { withCredentials: true }
      );
      // sucesso: remove da lista
      setAgendamentos((cur) => cur.filter((x) => x.id !== cancelTarget.id));
      setBanner({ kind: "ok", text: "Agendamento cancelado com sucesso." });
      fecharModalCancelar();
      return;
    } catch (e: any) {
      if (e?.response?.status === 404) {
        // 2) fallback compat (rota antiga exige usuarioId no body)
        try {
          await axios.post(
            `${API_URL}/agendamentos/cancelar/${cancelTarget.id}`,
            { usuarioId: usuario?.id },
            { withCredentials: true }
          );
          setAgendamentos((cur) => cur.filter((x) => x.id !== cancelTarget.id));
          setBanner({ kind: "ok", text: "Agendamento cancelado com sucesso." });
          fecharModalCancelar();
          return;
        } catch (e2) {
          setCancelError(parseErro(e2));
        }
      } else {
        setCancelError(parseErro(e));
      }
    } finally {
      setCancelSending(false);
    }
  };

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

      {/* Banner de feedback */}
      {banner && (
        <div className={`px-4 pt-3`}>
          <div className={`max-w-sm mx-auto rounded-xl px-3 py-2 text-sm ${banner.kind === "ok"
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
            }`}>
            {banner.text}
          </div>
        </div>
      )}

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
                        className={`text-[10px] px-2 py-[2px] rounded-full ${a.tipo === "PERMANENTE"
                            ? "bg-gray-200 text-gray-800"
                            : "bg-orange-100 text-orange-600"
                          }`}
                        title={a.tipo === "PERMANENTE" ? "Agendamento permanente" : "Agendamento comum"}
                      >
                        {a.tipo === "PERMANENTE" ? "Permanente" : "Comum"}
                      </span>
                    </p>

                    <p className="text-[12px] text-gray-500">
                      {/^\d{2}\/\d{2}$/.test(a.dia)
                        ? <>Dia {a.dia} às {a.hora}</>
                        : <>Toda {a.dia} às {a.hora}</>}
                    </p>

                    {a.numero && (
                      <p className="text-[11px] text-gray-500">Quadra {a.numero}</p>
                    )}
                  </div>
                </div>

                {/* Ações */}
                {a.tipo === "COMUM" && (
                  <>
                    <div className="mt-2 border-t border-gray-300/70" />
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => abrirModalCancelar(a)}
                        className="w-full py-2 text-[13px] font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                      >
                        Cancelar agendamento
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modal: confirmar cancelamento */}
      {cancelOpen && cancelTarget && (
        <div className="fixed inset-0 z-50">
          {/* fundo translúcido */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={fecharModalCancelar}
          />
          {/* caixinha */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-4">
              <h3 className="text-base font-bold text-gray-800 mb-1">
                Confirmar cancelamento?
              </h3>
              <p className="text-sm text-gray-600">
                Você está cancelando: <strong>{cancelTarget.esporte}</strong> —{" "}
                <strong>{cancelTarget.quadraNome}</strong> (Quadra {cancelTarget.numero ?? "—"})<br />
                Dia {cancelTarget.dia} às {cancelTarget.hora}
              </p>

              <p className="mt-2 text-[12px] text-gray-500">
                Regra: permitido até <strong>12h</strong> antes do horário.
                Se já faltarem menos de 12h, o cancelamento só é permitido até{" "}
                <strong>15 minutos</strong> após a criação da reserva (validado no servidor).
              </p>

              {cancelError && (
                <div className="mt-2 rounded-md bg-red-100 text-red-800 text-[13px] px-3 py-2">
                  {cancelError}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
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
                  className="rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {cancelSending && <Spinner size="w-4 h-4" />}
                  {cancelSending ? "Cancelando..." : "Confirmar cancelamento"}
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
