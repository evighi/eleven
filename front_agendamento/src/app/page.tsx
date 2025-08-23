"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { isoLocalDate } from "@/utils/date";

import { useAuthStore } from "@/context/AuthStore";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";
// remova as versões locais de API_URL/toAbsolute e importe:
import { API_URL, toAbsolute } from "@/utils/urls";


type StatusAgendamento = "CONFIRMADO" | "FINALIZADO" | "CANCELADO" | "TRANSFERIDO";

type AgendamentoAPI = {
  id: string;
  horario: string;
  data?: string;

  // legado
  nome?: string;          // nome do esporte
  local?: string;         // “Quadra X - Nº 3”
  logoUrl?: string;       // legado

  // novo (backend já retorna)
  quadraNome?: string;
  quadraNumero?: number | string | null;
  quadraLogoUrl?: string; // <- ABSOLUTA quando vier do R2
  esporteNome?: string;
  status?: StatusAgendamento;
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

export default function Home() {
  // 🔒 Proteção por perfil
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
  const [carregando, setCarregando] = useState(false);

  const hojeISO = useMemo(() => isoLocalDate(), []);

  useEffect(() => {
    if (usuario?.nome) setNomeUsuario(usuario.nome.split(" ")[0]);
  }, [usuario?.nome]);

  const paraDDMM = (iso?: string) => {
    const s = iso || hojeISO;
    const [, m, d] = s.split("-");
    return `${d}/${m}`;
  };

  const extrairNumeroDoLocal = (local?: string) => {
    if (!local) return undefined;
    const m = local.match(/N[ºo]\s*(\d+)/i);
    return m?.[1] || undefined;
  };

  // Garante URL correta pra imagem (R2 ou legado)
  const toAbsolute = (url?: string) => {
    if (!url) return "/quadra.png";
    return /^https?:\/\//i.test(url) ? url : `${API_URL}${url}`;
  };

  const normalizar = (raw: AgendamentoAPI): AgendamentoCard => {
    const logo = raw.quadraLogoUrl ?? raw.logoUrl ?? "/quadra.png";
    const quadraNome =
      raw.quadraNome || (raw.local?.split(" - Nº")[0] ?? "Quadra");

    return {
      id: raw.id,
      logoUrl: toAbsolute(logo),
      quadraNome,
      numero: String(
        raw.quadraNumero ?? extrairNumeroDoLocal(raw.local) ?? ""
      ),
      esporte: raw.esporteNome ?? raw.nome ?? "",
      dia: paraDDMM(raw.data),
      hora: raw.horario,
    };
  };

  useEffect(() => {
    if (isChecking) return;

    const fetchAgendamentos = async () => {
      setCarregando(true);
      try {
        const res = await axios.get<AgendamentoAPI[]>(
          `${API_URL}/agendamentos/me`,
          {
            withCredentials: true,
            params: { data: hojeISO },
          }
        );
        const confirmados = (res.data || []).filter(
          (a) => a.status === "CONFIRMADO"
        );
        setAgendamentos(confirmados.map(normalizar));
      } catch {
        setAgendamentos([]);
      } finally {
        setCarregando(false);
      }
    };

    fetchAgendamentos();
  }, [API_URL, hojeISO, isChecking]);

  // Loading global enquanto checa cookie/usuário
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
            Você tem {agendamentos.length} quadra
            {agendamentos.length === 1 ? "" : "s"} marcad
            {agendamentos.length === 1 ? "a" : "as"} para hoje!
          </p>
        </div>
      </header>

      {/* CONTEÚDO */}
      <section className="px-4 md:px-6 py-3 md:py-4">
        <div className="mx-auto max-w-md md:max-w-lg lg:max-w-xl">
          {/* Cartão Suas quadras */}
          <div className="-mt-3 bg-white rounded-2xl shadow-md p-4 sm:p-5 md:p-6">
            <h2 className="text-[13px] sm:text-sm font-semibold text-gray-500 mb-3">
              Suas quadras
            </h2>

            {carregando && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner /> <span>Carregando agendamentos…</span>
              </div>
            )}

            {!carregando && agendamentos.length === 0 && (
              <p className="text-sm text-gray-500">
                Você não tem agendamentos hoje.
              </p>
            )}

            <div className="space-y-3">
              {agendamentos.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 sm:gap-4 rounded-xl bg-[#f3f3f3] px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm"
                >
                  {/* Logo */}
                  <div className="shrink-0 w-28 h-12 sm:w-36 sm:h-14 md:w-40 md:h-16 flex items-center justify-center overflow-hidden">
                    <img
                      src={a.logoUrl}
                      alt={a.quadraNome}
                      className="w-full h-full object-contain select-none"
                      onError={(ev) =>
                        ((ev.currentTarget as HTMLImageElement).src =
                          "/quadra.png")
                      }
                    />
                  </div>

                  {/* Texto */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] sm:text-[15px] font-semibold text-gray-800 truncate">
                      {a.quadraNome}
                    </p>
                    <p className="text-[12px] sm:text-[13px] text-gray-600 leading-tight">
                      {a.esporte}
                    </p>
                    <p className="text-[12px] sm:text-[13px] text-gray-500">
                      Dia {a.dia} às {a.hora}
                    </p>
                    {a.numero && (
                      <p className="text-[11px] sm:text-[12px] text-gray-500">
                        Quadra {a.numero}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/verQuadras"
              className="mt-3 inline-flex w-full justify-center rounded-xl bg-[#f3f3f3] py-2 md:py-2.5 text-[13px] md:text-sm font-semibold text-orange-600 hover:bg-[#ececec] transition"
            >
              Veja as suas quadras
            </Link>
          </div>

          {/* Ações */}
          <div className="mt-4 md:mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <img
                      src="/marcar.png"
                      alt=""
                      className="w-9 h-9 sm:w-10 sm:h-10 opacity-70"
                    />
                  </div>
                  <div className="w-px h-10 sm:h-12 bg-gray-300" />
                  <span className="pl-3 text-[14px] sm:text-[15px] font-semibold text-orange-600 cursor-pointer">
                    Marque a sua quadra
                  </span>
                </div>
              </button>
            </div>

            {/* Transferir */}
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
                    <img
                      src="/icons/transferencia.png"
                      alt=""
                      className="w-9 h-9 sm:w-10 sm:h-10 opacity-70"
                    />
                  </div>
                  <div className="w-px h-10 sm:h-12 bg-gray-300" />
                  <span className="pl-3 text-[14px] sm:text-[15px] font-semibold text-orange-600 cursor-pointer">
                    Transfira a sua quadra
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="supports-[padding:env(safe-area-inset-bottom)]:pb-[env(safe-area-inset-bottom)]" />
    </main>
  );
}
