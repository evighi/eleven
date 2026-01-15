"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { format, parseISO, addDays } from "date-fns";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";

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

// Busca de usuários (inclui tipo opcional se sua API retornar)
type UsuarioBusca = { id: string; nome: string; celular?: string | null; tipo?: string | null };

type ProximasDatasResp = { proximasDatasDisponiveis: string[]; dataUltimoConflito: string | null };

type Feedback = { kind: "success" | "error" | "info"; text: string };

const diasEnum = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"] as const;
const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

const DIA_IDX: Record<(typeof diasEnum)[number], number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6,
};

function proximaDataParaDiaSemana(diaSemana: string): string {
  const target = DIA_IDX[diaSemana as (typeof diasEnum)[number]] ?? 0;
  const now = new Date();
  const delta = (target - now.getDay() + 7) % 7;
  const d = addDays(now, delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function AgendarChurrasqueiraPermanente() {
  const searchParams = useSearchParams();

  const [diaSemana, setDiaSemana] = useState<string>("");
  const [turno, setTurno] = useState<string>("");

  const [churrasqueiras, setChurrasqueiras] = useState<ChurrasqueiraDisponivel[]>([]);
  const [churrasqueiraId, setChurrasqueiraId] = useState<string>("");

  // ⚠ agora o controle de conflito é *por churrasqueira selecionada*
  const [dataUltimoConflito, setDataUltimoConflito] = useState<string | null>(null);
  const [proximasDatasDisponiveis, setProximasDatasDisponiveis] = useState<string[]>([]);
  const [dataInicio, setDataInicio] = useState<string>("");

  // Dono cadastrado
  const [usuarioId, setUsuarioId] = useState<string>("");
  const [busca, setBusca] = useState<string>("");
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState<boolean>(false);
  const [listaAberta, setListaAberta] = useState<boolean>(false);

  // Convidado como dono
  const [convidadoDonoNome, setConvidadoDonoNome] = useState<string>("");
  const [convidadoDonoTelefone, setConvidadoDonoTelefone] = useState<string>("");

  // UI
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // estabilizar seleção entre recargas de lista
  const prefillRef = useRef(true);

  // ✅ NOVO: garante que o prefill via URL rode só 1 vez
  const initializedFromQueryRef = useRef(false);

  /* =========================
     ✅ PREFILL VIA QUERY PARAMS
     URL exemplo:
     ?diaSemana=QUINTA&turno=DIA&churrasqueiraId=xxxxx
  ========================= */
  useEffect(() => {
    if (initializedFromQueryRef.current) return;

    const qDia = searchParams.get("diaSemana");
    const qTurno = searchParams.get("turno");
    const qChId = searchParams.get("churrasqueiraId");

    // normaliza pra evitar caso venha em minúsculo
    const diaNorm = qDia ? qDia.toUpperCase() : null;
    const turnoNorm = qTurno ? qTurno.toUpperCase() : null;

    const diaOk = !!diaNorm && diasEnum.includes(diaNorm as any);
    const turnoOk = turnoNorm === "DIA" || turnoNorm === "NOITE";

    if (diaOk) setDiaSemana(diaNorm!);
    if (turnoOk) setTurno(turnoNorm!);
    if (qChId) setChurrasqueiraId(qChId);

    // se veio algo na URL, não queremos que ele sugira a primeira automaticamente
    if (diaOk || turnoOk || qChId) {
      prefillRef.current = false;
    }

    initializedFromQueryRef.current = true;
  }, [searchParams]);

  /* ===== Disponibilidade (permanente) ===== */
  useEffect(() => {
    if (!diaSemana || !turno) {
      setChurrasqueiras([]);
      setDataInicio("");
      setDataUltimoConflito(null);
      setProximasDatasDisponiveis([]);
      return;
    }

    setFeedback(null);

    // Disponibilidade de churrasqueiras usa DATA + TURNO.
    // Vamos perguntar a disponibilidade na **próxima data** que cai no diaSemana escolhido.
    const data = proximaDataParaDiaSemana(diaSemana);

    axios
      .get<ChurrasqueiraDisponivel[]>(`${API_URL}/disponibilidadeChurrasqueiras`, {
        params: { data, turno },
        withCredentials: true,
      })
      .then((res) => {
        const lista = res.data || [];
        setChurrasqueiras(lista);

        // sempre que recarregar disponibilidade, resetamos infos de conflito
        setDataInicio("");
        setDataUltimoConflito(null);
        setProximasDatasDisponiveis([]);

        // --------- estabiliza a seleção da churrasqueira ----------
        if (prefillRef.current && !churrasqueiraId) {
          // 1ª carga: se existir alguma disponível, sugere a primeira
          const firstViable = lista.find(
            (c) => c.disponivel || c.conflitoComum || c.conflitoPermanente
          );
          if (firstViable) setChurrasqueiraId(firstViable.churrasqueiraId);
        } else {
          // cargas subsequentes: mantém se ainda for válida
          const selecionadaAindaExiste = lista.some(
            (c) =>
              c.churrasqueiraId === churrasqueiraId &&
              (c.disponivel || c.conflitoComum || c.conflitoPermanente)
          );
          if (!selecionadaAindaExiste) setChurrasqueiraId("");
        }
        prefillRef.current = false;
        // ---------------------------------------------------------
      })
      .catch((err) => {
        console.error(err);
        setChurrasqueiras([]);
        setDataInicio("");
        setDataUltimoConflito(null);
        setProximasDatasDisponiveis([]);
        setFeedback({ kind: "error", text: "Erro ao buscar disponibilidade." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diaSemana, turno]);

  /* ===== Próximas datas quando há conflito comum NA SELECIONADA ===== */
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

  /* ===== Busca usuários (apenas com a lista aberta) ===== */
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
  }, [busca, listaAberta]);

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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFeedback(null);

    // precisa de um dono: usuarioId OU convidadoDonoNome
    if (!usuarioId && convidadoDonoNome.trim() === "") {
      setFeedback({
        kind: "error",
        text: "Informe um usuário (selecionando da lista) OU um convidado como dono.",
      });
      return;
    }
    // se for convidado, exigir telefone
    if (convidadoDonoNome.trim() && !convidadoDonoTelefone.trim()) {
      setFeedback({ kind: "error", text: "Informe o telefone do convidado dono." });
      return;
    }
    if (!diaSemana || !turno || !churrasqueiraId) {
      setFeedback({ kind: "error", text: "Selecione dia, turno e a churrasqueira." });
      return;
    }

    // 🔍 verifica conflito *na churrasqueira selecionada*
    const selecionada = churrasqueiras.find((c) => c.churrasqueiraId === churrasqueiraId);
    const temConflitoComumSelecionada =
      !!selecionada && !!selecionada.conflitoComum && !selecionada.conflitoPermanente;

    const precisaDataInicio = temConflitoComumSelecionada && proximasDatasDisponiveis.length > 0;

    if (precisaDataInicio && !dataInicio) {
      setFeedback({ kind: "error", text: "Selecione uma data de início válida." });
      return;
    }

    const body: Record<string, any> = {
      diaSemana,
      turno,
      churrasqueiraId,
      ...(usuarioId
        ? { usuarioId }
        : {
            convidadosNomes: [
              `${convidadoDonoNome.trim()} ${convidadoDonoTelefone.trim()}`.trim(),
            ],
          }),
      ...(precisaDataInicio && dataInicio ? { dataInicio } : {}),
    };

    try {
      setSubmitting(true);
      await axios.post(`${API_URL}/agendamentosPermanentesChurrasqueiras`, body, {
        withCredentials: true,
      });

      setFeedback({ kind: "success", text: "Agendamento permanente cadastrado com sucesso!" });
      toast.success("Agendamento permanente cadastrado com sucesso!");

      // limpar campos principais
      setUsuarioId("");
      setConvidadoDonoNome("");
      setConvidadoDonoTelefone("");
      setChurrasqueiraId("");
      setDataInicio("");
    } catch (error) {
      console.error(error);
      const msg = mensagemErroAxios(error);
      setFeedback({ kind: "error", text: msg });
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const alertClasses =
    feedback?.kind === "success"
      ? "border-green-200 bg-green-50 text-green-800"
      : feedback?.kind === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-sky-200 bg-sky-50 text-sky-800";

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-6">Cadastrar Permanente (Churrasqueira)</h1>

      {/* ALERTA */}
      {feedback && (
        <div
          className={`mb-4 rounded-md border px-3 py-2 text-sm ${alertClasses}`}
          role={feedback.kind === "error" ? "alert" : "status"}
          aria-live={feedback.kind === "error" ? "assertive" : "polite"}
        >
          {feedback.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Dia da Semana */}
        <div>
          <label className="block font-semibold mb-1">Dia da Semana</label>
          <select
            value={diaSemana}
            onChange={(e) => {
              setDiaSemana(e.target.value);
              setFeedback(null);
            }}
            className="w-full border rounded p-2"
            required
          >
            <option value="">Selecione</option>
            {diasEnum.map((dia) => (
              <option key={dia} value={dia}>
                {dia}
              </option>
            ))}
          </select>
        </div>

        {/* Turno */}
        <div>
          <label className="block font-semibold mb-1">Turno</label>
          <select
            value={turno}
            onChange={(e) => {
              setTurno(e.target.value);
              setFeedback(null);
            }}
            className="w-full border rounded p-2"
            required
          >
            <option value="">Selecione o turno</option>
            <option value="DIA">Dia</option>
            <option value="NOITE">Noite</option>
          </select>
        </div>

        {/* Churrasqueira */}
        <div>
          <label className="block font-semibold mb-1">Churrasqueira</label>
          <select
            value={churrasqueiraId}
            onChange={(e) => {
              setChurrasqueiraId(e.target.value);
              setFeedback(null);
            }}
            className="w-full border rounded p-2"
            required
            disabled={!churrasqueiras.length}
          >
            <option value="">Selecione</option>
            {churrasqueiras.map((c) => {
              const podeMostrar = c.disponivel || c.conflitoComum || c.conflitoPermanente;
              if (!podeMostrar) return null;

              const desabilitar = c.conflitoPermanente || (!c.disponivel && !c.conflitoComum);

              return (
                <option key={c.churrasqueiraId} value={c.churrasqueiraId} disabled={desabilitar}>
                  {c.nome} - {c.numero}
                  {!c.disponivel ? " (Indisponível)" : ""}
                  {c.conflitoComum ? " (Conflito com agendamento comum)" : ""}
                  {c.conflitoPermanente ? " (Conflito com agendamento permanente)" : ""}
                </option>
              );
            })}
          </select>
        </div>

        {/* Dono cadastrado OU Convidado dono */}
        <div className="space-y-2">
          <label className="block font-semibold">Dono do agendamento</label>

          {/* Busca usuário cadastrado */}
          <div>
            <input
              type="text"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setUsuarioId("");
                setListaAberta(true);
                setFeedback(null);
              }}
              onFocus={() => setListaAberta(true)}
              placeholder="Buscar usuário por nome"
              className="w-full border rounded p-2"
            />

            {carregandoUsuarios && <div className="text-sm text-gray-500 mt-1">Buscando...</div>}

            {listaAberta && usuariosEncontrados.length > 0 && (
              <ul className="mt-1 border rounded w-full max-h-48 overflow-y-auto divide-y">
                {usuariosEncontrados.map((u) => (
                  <li
                    key={u.id}
                    className="px-3 py-2 hover:bg-orange-50 cursor-pointer"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setUsuarioId(u.id);
                      setBusca(u.nome);
                      setUsuariosEncontrados([]);
                      setListaAberta(false);
                      setConvidadoDonoNome("");
                      setConvidadoDonoTelefone("");
                    }}
                    title={u.celular || ""}
                  >
                    <div className="font-medium text-gray-800">{u.nome}</div>
                    {u.celular && <div className="text-xs text-gray-500">{u.celular}</div>}
                  </li>
                ))}
              </ul>
            )}

            {listaAberta &&
              busca.trim().length >= 2 &&
              !carregandoUsuarios &&
              usuariosEncontrados.length === 0 && (
                <div className="text-xs text-gray-500 mt-1">Nenhum usuário encontrado.</div>
              )}

            {usuarioId && <div className="text-xs text-green-700 mt-1">Usuário selecionado.</div>}
          </div>

          {/* Convidado dono */}
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={convidadoDonoNome}
                onChange={(e) => {
                  setConvidadoDonoNome(e.target.value);
                  if (e.target.value.trim()) {
                    setUsuarioId("");
                    setBusca("");
                    setUsuariosEncontrados([]);
                    setListaAberta(false);
                  }
                  setFeedback(null);
                }}
                placeholder="Convidado: nome (obrigatório se usar convidado)"
                className="w-full border rounded p-2"
              />
              <input
                type="tel"
                value={convidadoDonoTelefone}
                onChange={(e) => {
                  setConvidadoDonoTelefone(e.target.value);
                  if (e.target.value.trim()) {
                    setUsuarioId("");
                  }
                  setFeedback(null);
                }}
                placeholder="Convidado: telefone (obrigatório)"
                className="w-full border rounded p-2"
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Preencha <strong>um</strong> dos dois: usuário cadastrado <em>ou</em> convidado dono.
              Se usar convidado, informe também o telefone.
            </p>
          </div>
        </div>

        {/* Conflito + datas de início */}
        {dataUltimoConflito && proximasDatasDisponiveis.length > 0 && (
          <div className="mt-4 p-4 border border-yellow-400 bg-yellow-100 rounded">
            <p className="mb-2 font-semibold text-yellow-700">
              A churrasqueira selecionada possui conflito com agendamento comum no dia{" "}
              {format(parseISO(dataUltimoConflito), "dd/MM/yyyy")}. Selecione uma data de início
              disponível:
            </p>

            <div className="grid grid-cols-3 gap-2">
              {proximasDatasDisponiveis.map((dataStr) => {
                const dataFormatada = format(parseISO(dataStr), "dd/MM/yyyy");
                return (
                  <button
                    key={dataStr}
                    type="button"
                    className={`py-2 px-3 border rounded ${
                      dataInicio === dataStr ? "bg-orange-500 text-white" : "bg-white"
                    }`}
                    onClick={() => setDataInicio(dataStr)}
                  >
                    {dataFormatada}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className={`w-full text-white font-semibold py-2 px-4 rounded mt-4 transition
            ${submitting ? "bg-orange-400 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-700"}`}
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
              Cadastrando…
            </span>
          ) : (
            "Cadastrar"
          )}
        </button>
      </form>
    </div>
  );
}
