"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { format, parseISO, addDays } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import SystemAlert, { AlertVariant } from "@/components/SystemAlert";
import Spinner from "@/components/Spinner";
import AppImage from "@/components/AppImage";
import Image from "next/image";
import { ChevronDown } from "lucide-react";

/** =========================
 *  TIPOS
========================= */
type ChurrasqueiraDisponivel = {
  churrasqueiraId: string;
  nome: string;
  numero: number;
  disponivel: boolean;
  conflitoComum?: boolean;
  conflitoPermanente?: boolean;
  imagem?: string | null;
  imagemUrl?: string | null;
  logoUrl?: string | null;
};

type ChurrasqueiraAPI = {
  id: string;
  nome: string;
  numero: number;
  imagem?: string | null;
  logoUrl?: string | null;
};

type UsuarioBusca = {
  id: string;
  nome: string;
  celular?: string | null;
  tipo?: string | null;
};

type ProximasDatasResp = {
  proximasDatasDisponiveis: string[];
  dataUltimoConflito: string | null;
};

type Feedback = { kind: AlertVariant; text: string };

const diasEnum = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"] as const;
type DiaSemana = (typeof diasEnum)[number];

const DIA_LABEL: Record<DiaSemana, string> = {
  DOMINGO: "Domingo",
  SEGUNDA: "Segunda",
  TERCA: "Terça",
  QUARTA: "Quarta",
  QUINTA: "Quinta",
  SEXTA: "Sexta",
  SABADO: "Sábado",
};

const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

type Turno = "DIA" | "NOITE";

const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

function proximaDataParaDiaSemana(diaSemana: DiaSemana): string {
  const target = DIA_IDX[diaSemana] ?? 0;
  const now = new Date();
  const delta = (target - now.getDay() + 7) % 7;
  const d = addDays(now, delta);
  return format(d, "yyyy-MM-dd");
}

export default function AgendarChurrasqueiraPermanente() {
  const router = useRouter();
  const searchParams = useSearchParams();

  /** =========================
   *  STATES PRINCIPAIS
  ========================= */
  const [diaSemana, setDiaSemana] = useState<DiaSemana | "">("");
  const [turno, setTurno] = useState<Turno | "">("");

  const [churrasqueiras, setChurrasqueiras] = useState<ChurrasqueiraDisponivel[]>([]);
  const [churrasqueiraId, setChurrasqueiraId] = useState<string>("");

  // ✅ NOVO: mapa de logos/imagens (mesma lógica do avulso)
  const [churrasqueiraLogos, setChurrasqueiraLogos] = useState<Record<string, string>>({});

  // conflito comum selecionada
  const [dataUltimoConflito, setDataUltimoConflito] = useState<string | null>(null);
  const [proximasDatasDisponiveis, setProximasDatasDisponiveis] = useState<string[]>([]);
  const [dataInicio, setDataInicio] = useState<string>("");

  // Dono cadastrado
  const [usuarioId, setUsuarioId] = useState<string>("");
  const [busca, setBusca] = useState<string>("");
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState<boolean>(false);
  const [listaAberta, setListaAberta] = useState<boolean>(false);

  // Convidado dono
  const [convidadoDonoNome, setConvidadoDonoNome] = useState<string>("");
  const [convidadoDonoTelefone, setConvidadoDonoTelefone] = useState<string>("");
  const [convidadoSelecionado, setConvidadoSelecionado] = useState<boolean>(false);

  // UI
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // estabiliza seleção
  const prefillRef = useRef(true);
  const initializedFromQueryRef = useRef(false);

  // dropdowns padronizados
  const [diaAberto, setDiaAberto] = useState(false);
  const [turnoAberto, setTurnoAberto] = useState(false);
  const diaRef = useRef<HTMLDivElement | null>(null);
  const turnoRef = useRef<HTMLDivElement | null>(null);

  // imagem loading (cards)
  const [imgLoaded, setImgLoaded] = useState<Record<string, boolean>>({});
  const marcarCarregada = (id: string) => setImgLoaded((p) => ({ ...p, [id]: true }));

  // fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (diaRef.current && !diaRef.current.contains(t)) setDiaAberto(false);
      if (turnoRef.current && !turnoRef.current.contains(t)) setTurnoAberto(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /** =========================
   *  ✅ 1) Carrega mapa de logos em /churrasqueiras
   *  (igual no agendarchurrasqueira avulso)
   ========================= */
  useEffect(() => {
    const carregarChurrasqueiras = async () => {
      try {
        const { data } = await axios.get<ChurrasqueiraAPI[]>(`${API_URL}/churrasqueiras`, {
          withCredentials: true,
        });

        const map: Record<string, string> = {};
        (data || []).forEach((c) => {
          const id = String(c.id);
          const src = c.logoUrl || c.imagem || "";
          if (!id || !src) return;
          map[id] = src;
        });

        setChurrasqueiraLogos(map);
      } catch (e) {
        console.warn("Não foi possível carregar /churrasqueiras para montar os logos.", e);
      }
    };

    carregarChurrasqueiras();
  }, []);

  /* =========================
     PREFILL VIA QUERY PARAMS
     ?diaSemana=QUINTA&turno=DIA&churrasqueiraId=xxxxx
  ========================= */
  useEffect(() => {
    if (initializedFromQueryRef.current) return;

    const qDia = searchParams.get("diaSemana");
    const qTurno = searchParams.get("turno");
    const qChId = searchParams.get("churrasqueiraId");

    const diaNorm = qDia ? qDia.toUpperCase() : null;
    const turnoNorm = qTurno ? qTurno.toUpperCase() : null;

    const diaOk = !!diaNorm && (diasEnum as readonly string[]).includes(diaNorm);
    const turnoOk = turnoNorm === "DIA" || turnoNorm === "NOITE";

    if (diaOk) setDiaSemana(diaNorm as DiaSemana);
    if (turnoOk) setTurno(turnoNorm as Turno);
    if (qChId) setChurrasqueiraId(qChId);

    // se veio algo na URL, não sugerir automaticamente
    if (diaOk || turnoOk || qChId) {
      prefillRef.current = false;
    }

    initializedFromQueryRef.current = true;
  }, [searchParams]);

  /* =========================
     Disponibilidade (permanente)
  ========================= */
  useEffect(() => {
    if (!diaSemana || !turno) {
      setChurrasqueiras([]);
      setChurrasqueiraId("");
      setDataInicio("");
      setDataUltimoConflito(null);
      setProximasDatasDisponiveis([]);
      return;
    }

    setFeedback(null);

    const data = proximaDataParaDiaSemana(diaSemana);

    axios
      .get<ChurrasqueiraDisponivel[]>(`${API_URL}/disponibilidadeChurrasqueiras`, {
        params: { data, turno },
        withCredentials: true,
      })
      .then((res) => {
        const listaRaw = Array.isArray(res.data) ? res.data : [];

        // ✅ NOVO: injeta logoUrl/imagem da tabela /churrasqueiras (igual avulso)
        const lista: ChurrasqueiraDisponivel[] = listaRaw.map((c) => {
          const id = String(c.churrasqueiraId);
          const logoFromMap = churrasqueiraLogos[id];
          return {
            ...c,
            logoUrl: logoFromMap || c.logoUrl || c.imagemUrl || c.imagem || null,
          };
        });

        setChurrasqueiras(lista);

        // reseta datas ao atualizar parâmetros
        setDataInicio("");
        setDataUltimoConflito(null);
        setProximasDatasDisponiveis([]);

        // estabiliza seleção
        if (prefillRef.current && !churrasqueiraId) {
          const firstViable = lista.find((c) => c.disponivel || c.conflitoComum || c.conflitoPermanente);
          if (firstViable) setChurrasqueiraId(firstViable.churrasqueiraId);
        } else {
          const selecionadaAindaExiste = lista.some(
            (c) =>
              c.churrasqueiraId === churrasqueiraId &&
              (c.disponivel || c.conflitoComum || c.conflitoPermanente)
          );
          if (!selecionadaAindaExiste) setChurrasqueiraId("");
        }

        prefillRef.current = false;
      })
      .catch((err) => {
        console.error(err);
        setChurrasqueiras([]);
        setChurrasqueiraId("");
        setDataInicio("");
        setDataUltimoConflito(null);
        setProximasDatasDisponiveis([]);
        setFeedback({ kind: "error", text: "Erro ao buscar disponibilidade." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diaSemana, turno, churrasqueiraLogos]);

  /* =========================
     Próximas datas quando há conflito comum NA SELECIONADA
  ========================= */
  useEffect(() => {
    if (!diaSemana || !turno || !churrasqueiraId) {
      setProximasDatasDisponiveis([]);
      setDataUltimoConflito(null);
      setDataInicio("");
      return;
    }

    const selecionada = churrasqueiras.find((c) => c.churrasqueiraId === churrasqueiraId);
    const deveBuscarDatas = selecionada?.conflitoComum && !selecionada?.conflitoPermanente;

    if (!deveBuscarDatas) {
      setProximasDatasDisponiveis([]);
      setDataUltimoConflito(null);
      setDataInicio("");
      return;
    }

    axios
      .get<ProximasDatasResp>(`${API_URL}/proximaDataPermanenteDisponivelChurrasqueira`, {
        params: { diaSemana, turno, churrasqueiraId },
        withCredentials: true,
      })
      .then((res) => {
        setProximasDatasDisponiveis(res.data.proximasDatasDisponiveis || []);
        setDataUltimoConflito(res.data.dataUltimoConflito || null);
        setDataInicio("");

        if (!res.data.proximasDatasDisponiveis || res.data.proximasDatasDisponiveis.length === 0) {
          setFeedback({
            kind: "info",
            text: "Sem datas futuras disponíveis para iniciar este permanente.",
          });
        }
      })
      .catch((err) => {
        console.error(err);
        setProximasDatasDisponiveis([]);
        setDataUltimoConflito(null);
        setDataInicio("");
        setFeedback({ kind: "error", text: "Erro ao consultar próximas datas." });
      });
  }, [diaSemana, turno, churrasqueiraId, churrasqueiras]);

  /* =========================
     Busca usuários (lista aberta)
  ========================= */
  useEffect(() => {
    let cancel = false;

    const run = async () => {
      if (!listaAberta) {
        if (!cancel) setUsuariosEncontrados([]);
        return;
      }

      const termo = busca.trim();
      if (termo.length < 2) {
        if (!cancel) setUsuariosEncontrados([]);
        return;
      }

      setCarregandoUsuarios(true);
      try {
        const res = await axios.get<UsuarioBusca[]>(`${API_URL}/clientes`, {
          params: { nome: termo },
          withCredentials: true,
        });
        if (!cancel) setUsuariosEncontrados(res.data || []);
      } catch {
        if (!cancel) setUsuariosEncontrados([]);
      } finally {
        if (!cancel) setCarregandoUsuarios(false);
      }
    };

    const t = setTimeout(run, 300);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [API_URL, busca, listaAberta]);

  function mensagemErroAxios(error: any): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data as any;
      const serverMsg =
        data && (data.erro || data.message || data.msg)
          ? String(data.erro || data.message || data.msg)
          : "";

      if (status === 409) return serverMsg || "Conflito: horário já reservado.";
      if (status === 400 || status === 422) return serverMsg || "Requisição inválida.";
      if (status === 401) return "Não autorizado.";
      return serverMsg || "Falha ao cadastrar permanente.";
    }
    return "Falha ao cadastrar permanente.";
  }

  const exigeDataInicio = useMemo(() => {
    const selecionada = churrasqueiras.find((c) => c.churrasqueiraId === churrasqueiraId);
    return Boolean(selecionada?.conflitoComum && !selecionada?.conflitoPermanente);
  }, [churrasqueiras, churrasqueiraId]);

  const podeCadastrar =
    !submitting &&
    !!diaSemana &&
    !!turno &&
    !!churrasqueiraId &&
    (!!usuarioId || convidadoSelecionado) &&
    (!convidadoSelecionado || (!!convidadoDonoNome.trim() && !!convidadoDonoTelefone.trim())) &&
    (!exigeDataInicio || !!dataInicio);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFeedback(null);

    if (!usuarioId && !convidadoSelecionado) {
      setFeedback({
        kind: "error",
        text: "Informe um usuário (selecionando da lista) OU um convidado como dono (clicando em Adicionar).",
      });
      return;
    }

    if (convidadoSelecionado && (!convidadoDonoNome.trim() || !convidadoDonoTelefone.trim())) {
      setFeedback({ kind: "error", text: "Informe nome e telefone do convidado dono." });
      return;
    }

    if (!diaSemana || !turno || !churrasqueiraId) {
      setFeedback({ kind: "error", text: "Selecione dia, turno e a churrasqueira." });
      return;
    }

    if (exigeDataInicio && !dataInicio) {
      setFeedback({ kind: "error", text: "Selecione uma data de início válida." });
      return;
    }

    const body: Record<string, any> = {
      diaSemana,
      turno,
      churrasqueiraId,
    };

    if (usuarioId) {
      body.usuarioId = usuarioId;
    } else {
      body.convidadosNomes = [`${convidadoDonoNome.trim()} ${convidadoDonoTelefone.trim()}`.trim()];
    }

    if (exigeDataInicio && dataInicio) body.dataInicio = dataInicio;

    try {
      setSubmitting(true);
      await axios.post(`${API_URL}/agendamentosPermanentesChurrasqueiras`, body, {
        withCredentials: true,
      });

      const msgSucesso = "Agendamento permanente cadastrado com sucesso!";
      setFeedback({ kind: "success", text: msgSucesso });

      // limpar
      setUsuarioId("");
      setBusca("");
      setUsuariosEncontrados([]);
      setListaAberta(false);

      setConvidadoDonoNome("");
      setConvidadoDonoTelefone("");
      setConvidadoSelecionado(false);

      setChurrasqueiraId("");
      setDataInicio("");
      setDataUltimoConflito(null);
      setProximasDatasDisponiveis([]);
    } catch (error) {
      console.error(error);
      const msg = mensagemErroAxios(error);
      setFeedback({ kind: "error", text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] px-5 sm:px-10 py-7 sm:py-9 relative">
        {/* ALERTA GLOBAL */}
        <SystemAlert
          open={!!feedback}
          message={feedback?.text ?? ""}
          variant={feedback?.kind ?? "info"}
          autoHideMs={feedback?.kind === "error" ? 4000 : 4000}
          onClose={() => setFeedback(null)}
        />

        {/* BOTÃO X */}
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute right-4 top-4 sm:right-6 sm:top-5 text-gray-400 hover:text-gray-600 text-3xl leading-none p-2"
          aria-label="Fechar"
        >
          ×
        </button>

        {/* TÍTULO */}
        <header className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-orange-500">Agendar Permanente (Churrasqueira)</h1>
        </header>

        <form onSubmit={handleSubmit} className="space-y-7">
          {/* DIA E TURNO – card cinza */}
          <section className="mb-2">
            <p className="text-sm font-semibold text-orange-600 mb-3">Dia e turno:</p>

            <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* DIA */}
                <div ref={diaRef}>
                  <p className="text-xs text-gray-500 mb-1">Escolha o dia:</p>

                  <div className="flex items-center gap-2">
                    <Image src="/icons/iconcalendar.png" alt="Calendário" width={24} height={24} className="w-6 h-6" />

                    <div className="relative w-full">
                      <button
                        type="button"
                        onClick={() => setDiaAberto((v) => !v)}
                        className="flex items-center justify-between h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
                      >
                        <span className="text-sm text-gray-800">
                          {diaSemana ? DIA_LABEL[diaSemana] : "Selecione um dia"}
                        </span>

                        <ChevronDown
                          className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${diaAberto ? "rotate-180" : ""}`}
                        />
                      </button>

                      {diaAberto && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border border-gray-200 bg-white shadow-lg text-sm overflow-hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setDiaSemana("");
                              setDiaAberto(false);
                              setFeedback(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 ${
                              !diaSemana ? "bg-orange-100 text-orange-700 font-semibold" : "hover:bg-orange-50 text-gray-800"
                            }`}
                          >
                            Selecione um dia
                          </button>

                          {diasEnum.map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => {
                                setDiaSemana(d);
                                setDiaAberto(false);
                                setFeedback(null);
                              }}
                              className={`w-full text-left px-3 py-1.5 ${
                                diaSemana === d
                                  ? "bg-orange-100 text-orange-700 font-semibold"
                                  : "hover:bg-orange-50 text-gray-800"
                              }`}
                            >
                              {DIA_LABEL[d]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* TURNO */}
                <div ref={turnoRef}>
                  <p className="text-xs text-gray-500 mb-1">Escolha o turno:</p>

                  <div className="flex items-center gap-2">
                    <Image src="/icons/iconhoraio.png" alt="Turno" width={24} height={24} className="w-6 h-6" />

                    <div className="relative w-full">
                      <button
                        type="button"
                        onClick={() => setTurnoAberto((v) => !v)}
                        className="flex items-center justify-between h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
                      >
                        <span className="text-sm text-gray-800">
                          {turno ? (turno === "DIA" ? "Dia" : "Noite") : "Selecione um turno"}
                        </span>

                        <ChevronDown
                          className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${turnoAberto ? "rotate-180" : ""}`}
                        />
                      </button>

                      {turnoAberto && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border border-gray-200 bg-white shadow-lg text-sm overflow-hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setTurno("");
                              setTurnoAberto(false);
                              setFeedback(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 ${
                              !turno ? "bg-orange-100 text-orange-700 font-semibold" : "hover:bg-orange-50 text-gray-800"
                            }`}
                          >
                            Selecione um turno
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setTurno("DIA");
                              setTurnoAberto(false);
                              setFeedback(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 ${
                              turno === "DIA"
                                ? "bg-orange-100 text-orange-700 font-semibold"
                                : "hover:bg-orange-50 text-gray-800"
                            }`}
                          >
                            Dia
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setTurno("NOITE");
                              setTurnoAberto(false);
                              setFeedback(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 ${
                              turno === "NOITE"
                                ? "bg-orange-100 text-orange-700 font-semibold"
                                : "hover:bg-orange-50 text-gray-800"
                            }`}
                          >
                            Noite
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-gray-500 mt-3">
                A disponibilidade é consultada usando a <b>próxima data</b> que cai no dia escolhido.
              </p>
            </div>
          </section>

          {/* DONO */}
          <section>
            <p className="text-sm font-semibold text-orange-600 mb-3">Dono do agendamento:</p>

            <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-5 space-y-5">
              {/* usuário cadastrado */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">Adicionar atletas cadastrados</p>

                <div className="flex items-start gap-3">
                  <Image
                    src="/iconescards/icone-permanente.png"
                    alt="Atleta cadastrado"
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-80 hidden sm:block mt-2"
                  />

                  <div className="flex-1">
                    <input
                      type="text"
                      value={busca}
                      onFocus={() => setListaAberta(true)}
                      onChange={(e) => {
                        setBusca(e.target.value);
                        setUsuarioId("");
                        setListaAberta(true);
                        setFeedback(null);

                        // mexeu aqui? remove confirmação do convidado
                        setConvidadoSelecionado(false);
                      }}
                      placeholder="Buscar usuário por nome"
                      className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                                 focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />

                    {carregandoUsuarios && (
                      <div className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                        <Spinner size="w-4 h-4" />
                        <span>Buscando usuários…</span>
                      </div>
                    )}

                    {listaAberta && usuariosEncontrados.length > 0 && (
                      <ul className="mt-2 border border-gray-200 rounded-md bg-white max-h-60 overflow-y-auto divide-y text-sm">
                        {usuariosEncontrados.map((u) => (
                          <li
                            key={String(u.id)}
                            className="px-3 py-2 hover:bg-orange-50 cursor-pointer"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setUsuarioId(String(u.id));
                              setBusca(u.nome);
                              setUsuariosEncontrados([]);
                              setListaAberta(false);

                              // limpa convidado
                              setConvidadoDonoNome("");
                              setConvidadoDonoTelefone("");
                              setConvidadoSelecionado(false);

                              setFeedback(null);
                            }}
                            title={u.celular || ""}
                          >
                            <div className="font-medium text-gray-800">{u.nome}</div>
                            {u.celular && <div className="text-[11px] text-gray-500">{u.celular}</div>}
                          </li>
                        ))}
                      </ul>
                    )}

                    {listaAberta && busca.trim().length >= 2 && !carregandoUsuarios && usuariosEncontrados.length === 0 && (
                      <div className="text-[11px] text-gray-500 mt-2">Nenhum usuário encontrado.</div>
                    )}
                  </div>
                </div>

                {usuarioId && (
                  <div className="mt-2 text-xs rounded-md px-3 py-2 border text-green-700 bg-green-50 border-green-200">
                    Usuário selecionado.
                  </div>
                )}
              </div>

              {/* convidado dono */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">Ou informar convidado dono</p>

                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <div className="flex-1 flex items-center gap-2">
                    <Image
                      src="/iconescards/icone-permanente.png"
                      alt="Convidado"
                      width={20}
                      height={20}
                      className="w-5 h-5 opacity-80 hidden sm:block"
                    />
                    <input
                      type="text"
                      value={convidadoDonoNome}
                      onChange={(e) => {
                        setConvidadoDonoNome(e.target.value);
                        setConvidadoSelecionado(false);

                        if (e.target.value.trim()) {
                          setUsuarioId("");
                          setBusca("");
                          setUsuariosEncontrados([]);
                          setListaAberta(false);
                        }

                        setFeedback(null);
                      }}
                      placeholder="Nome do convidado"
                      className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                                 focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />
                  </div>

                  <div className="flex-1 flex items-center gap-2">
                    <Image src="/iconescards/icone_phone.png" alt="Telefone" width={20} height={20} className="w-5 h-5 hidden sm:block" />
                    <input
                      type="tel"
                      value={convidadoDonoTelefone}
                      onChange={(e) => {
                        setConvidadoDonoTelefone(e.target.value);
                        setConvidadoSelecionado(false);
                        setFeedback(null);
                      }}
                      placeholder="(00) 000000000"
                      className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                                 focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />

                    {!convidadoSelecionado ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!convidadoDonoNome.trim()) {
                            setFeedback({ kind: "error", text: "Informe o nome do convidado." });
                            return;
                          }
                          if (!convidadoDonoTelefone.trim()) {
                            setFeedback({ kind: "error", text: "Informe o telefone do convidado." });
                            return;
                          }

                          setConvidadoSelecionado(true);

                          // limpa usuário
                          setUsuarioId("");
                          setBusca("");
                          setUsuariosEncontrados([]);
                          setListaAberta(false);

                          setFeedback(null);
                        }}
                        className="h-10 px-4 rounded-md border text-sm font-semibold
                                   border-orange-500 text-orange-700 bg-orange-100 hover:bg-orange-200 transition"
                      >
                        Adicionar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConvidadoSelecionado(false)}
                        className="h-10 px-4 rounded-md border text-sm font-semibold
                                   border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition"
                        title="Editar convidado"
                      >
                        Editar
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-gray-500 mt-2">
                  Preencha <strong>um</strong> dos dois: usuário cadastrado <em>ou</em> convidado dono. Se usar convidado, informe também o telefone e clique em <b>Adicionar</b>.
                </p>

                {convidadoSelecionado && (
                  <div className="mt-2 text-xs rounded-md px-3 py-2 border text-green-700 bg-green-50 border-green-200">
                    Convidado selecionado como dono do agendamento.
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* CHURRASQUEIRAS */}
          <section>
            <p className="text-sm font-semibold mb-3 text-orange-600">Churrasqueiras:</p>

            {!diaSemana || !turno ? (
              <p className="text-xs text-gray-500">
                Selecione <b>dia</b> e <b>turno</b> para ver as churrasqueiras disponíveis.
              </p>
            ) : churrasqueiras.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Spinner size="w-4 h-4" />
                <span>Carregando disponibilidade…</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {churrasqueiras
                    .filter((c) => c.disponivel || c.conflitoComum || c.conflitoPermanente)
                    .map((c) => {
                      const idStr = String(c.churrasqueiraId);
                      const selected = churrasqueiraId === idStr;

                      const disabled = c.conflitoPermanente || (!c.disponivel && !c.conflitoComum);

                      const numeroFmt = String(c.numero).padStart(2, "0");

                      // ✅ NOVO: mesma escolha de src do avulso + legacyDir
                      const imgSrc =
                        churrasqueiraLogos[idStr] ||
                        c.logoUrl ||
                        c.imagemUrl ||
                        c.imagem ||
                        undefined;

                      return (
                        <button
                          key={idStr}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setChurrasqueiraId(idStr);
                            setFeedback(null);
                          }}
                          className={`relative flex flex-col overflow-hidden rounded-xl border shadow-sm transition ${
                            disabled
                              ? "opacity-50 cursor-not-allowed border-gray-200"
                              : selected
                              ? "border-orange-500 shadow-[0_0_0_2px_rgba(233,122,31,0.35)]"
                              : "border-gray-200 hover:border-orange-400 hover:shadow-md"
                          }`}
                          title={
                            c.conflitoPermanente
                              ? "Conflito com permanente"
                              : !c.disponivel && !c.conflitoComum
                              ? "Indisponível"
                              : c.conflitoComum
                              ? "Conflito com comum (exige data de início)"
                              : ""
                          }
                        >
                          <div className="relative w-full h-28 sm:h-40 flex items-center justify-center">
                            <AppImage
                              src={imgSrc}
                              legacyDir="churrasqueiras"
                              alt={c.nome}
                              fill
                              className={`object-contain pointer-events-none select-none transition-opacity duration-150 ${
                                imgLoaded[idStr] ? "opacity-100" : "opacity-0"
                              }`}
                              fallbackSrc="/churrasqueira.png"
                              onLoadingComplete={() => marcarCarregada(idStr)}
                            />

                            {!imgLoaded[idStr] && (
                              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
                                <Spinner size="w-5 h-5" />
                              </div>
                            )}
                          </div>

                          <div className="px-3 py-3 bg-white text-center">
                            <p className="text-[11px] text-gray-500 mb-1">Churrasqueira {numeroFmt}</p>
                            <p className="text-[12px] font-semibold text-gray-800 truncate">{c.nome}</p>

                            {c.conflitoComum && !c.conflitoPermanente && (
                              <p className="mt-1 text-[10px] text-yellow-700">Conflito com comum</p>
                            )}
                            {c.conflitoPermanente && (
                              <p className="mt-1 text-[10px] text-red-600">Conflito com permanente</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>

                {/* conflito comum -> escolher data de início */}
                {dataUltimoConflito && proximasDatasDisponiveis.length > 0 && (
                  <div className="mt-6 rounded-xl bg-[#F6F6F6] border border-yellow-200 px-4 py-4 sm:px-5 sm:py-5">
                    <p className="text-sm font-semibold text-yellow-700">
                      Conflito com agendamento comum em{" "}
                      <span className="text-yellow-900">{format(parseISO(dataUltimoConflito), "dd/MM/yyyy")}</span>
                    </p>

                    <p className="text-[11px] text-gray-600 mt-1">Selecione uma data de início disponível para o permanente:</p>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {proximasDatasDisponiveis.map((dataStr) => {
                        const dataFormatada = format(parseISO(dataStr), "dd/MM/yyyy");
                        const selected = dataInicio === dataStr;

                        return (
                          <button
                            key={dataStr}
                            type="button"
                            onClick={() => setDataInicio(dataStr)}
                            className={`h-10 rounded-md border text-xs font-semibold transition ${
                              selected
                                ? "border-orange-500 text-orange-700 bg-orange-100"
                                : "border-gray-200 text-gray-700 bg-white hover:bg-orange-50"
                            }`}
                          >
                            {dataFormatada}
                          </button>
                        );
                      })}
                    </div>

                    {!dataInicio && (
                      <p className="mt-2 text-[11px] text-gray-500">
                        *obrigatório escolher a data de início quando houver conflito com comum.
                      </p>
                    )}
                  </div>
                )}

                {/* BOTÃO FINAL */}
                <div className="mt-8 flex justify-center">
                  <button
                    type="submit"
                    disabled={!podeCadastrar}
                    aria-busy={submitting}
                    className={`w-full max-w-[340px] sm:min-w-[340px] h-11 rounded-md border text-sm font-semibold ${
                      !podeCadastrar
                        ? "border-orange-200 text-orange-200 bg-white cursor-not-allowed"
                        : "border-orange-500 text-orange-700 bg-orange-100 hover:bg-orange-200"
                    }`}
                    title={
                      !diaSemana
                        ? "Selecione o dia."
                        : !turno
                        ? "Selecione o turno."
                        : !churrasqueiraId
                        ? "Selecione uma churrasqueira."
                        : !usuarioId && !convidadoSelecionado
                        ? "Selecione um usuário ou informe convidado dono e clique em Adicionar."
                        : exigeDataInicio && !dataInicio
                        ? "Selecione uma data de início disponível."
                        : undefined
                    }
                  >
                    {submitting ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner size="w-4 h-4" />
                        <span>Cadastrando…</span>
                      </span>
                    ) : (
                      "Confirmar Permanente"
                    )}
                  </button>
                </div>
              </>
            )}
          </section>
        </form>
      </div>
    </div>
  );
}
