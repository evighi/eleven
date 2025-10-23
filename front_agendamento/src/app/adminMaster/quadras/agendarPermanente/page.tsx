"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO, addDays } from "date-fns";
import { toast } from "sonner";

type QuadraDisponivel = {
  quadraId: string;
  nome: string;
  numero: number;
  disponivel: boolean;
  conflitoComum?: boolean;
  conflitoPermanente?: boolean;
};

type Esporte = { id: string; nome: string };

// ✅ agora também recebemos "tipo" para saber se é professor
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

function proximaDataParaDiaSemana(diaSemana: string, horario?: string): string {
  const target = DIA_IDX[diaSemana as (typeof diasEnum)[number]] ?? 0;
  const now = new Date();
  let delta = (target - now.getDay() + 7) % 7;

  if (delta === 0 && horario && /^\d{2}:\d{2}$/.test(horario)) {
    const [hh, mm] = horario.split(":").map(Number);
    const passou = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= (mm ?? 0));
    if (passou) delta = 7;
  }

  const d = addDays(now, delta);
  return format(d, "yyyy-MM-dd");
}

// < 18:00 ?
const horarioAntesDe18 = (h: string) => {
  if (!/^\d{2}:\d{2}$/.test(h)) return false;
  const [hh] = h.split(":").map(Number);
  return hh < 18;
};

export default function CadastrarPermanente() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [diaSemana, setDiaSemana] = useState<string>("");
  const [esporteId, setEsporteId] = useState<string>("");
  const [quadraId, setQuadraId] = useState<string>("");
  const [horario, setHorario] = useState<string>("");

  // ✅ tipo da sessão (mostra/exige quando DONO selecionado for professor e horário < 18:00)
  const [tipoSessao, setTipoSessao] = useState<"" | "AULA" | "JOGO">("");
  const [selectedOwnerIsProfessor, setSelectedOwnerIsProfessor] = useState<boolean>(false);

  // Dono cadastrado
  const [usuarioId, setUsuarioId] = useState<string>("");
  const [busca, setBusca] = useState<string>("");
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState<boolean>(false);
  const [listaAberta, setListaAberta] = useState<boolean>(false);

  // Convidado como dono (campos separados)
  const [convidadoDonoNome, setConvidadoDonoNome] = useState<string>("");
  const [convidadoDonoTelefone, setConvidadoDonoTelefone] = useState<string>("");

  // Datas e disponibilidade
  const [dataInicio, setDataInicio] = useState<string>("");
  const [esportes, setEsportes] = useState<Esporte[]>([]);
  const [quadras, setQuadras] = useState<QuadraDisponivel[]>([]);
  const [existeAgendamentoComum, setExisteAgendamentoComum] = useState<boolean>(false);
  const [dataUltimoConflito, setDataUltimoConflito] = useState<string | null>(null);
  const [proximasDatasDisponiveis, setProximasDatasDisponiveis] = useState<string[]>([]);

  // Pré-preenchimento vindo da URL
  const [esporteQuery, setEsporteQuery] = useState<string | null>(null);
  const [quadraIdQuery, setQuadraIdQuery] = useState<string | null>(null);
  const prefillRef = useRef(true); // true só na primeira carga

  // UI
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  /* ===== Ler parâmetros da URL e pré-preencher base ===== */
  useEffect(() => {
    if (!searchParams) return;
    const qsDia = searchParams.get("diaSemana");
    const qsHora = searchParams.get("horario");
    const qsQuadra = searchParams.get("quadraId");
    const qsEsporte = searchParams.get("esporte"); // pode vir nome OU id

    if (qsDia && (diasEnum as readonly string[]).includes(qsDia)) setDiaSemana(qsDia);
    if (qsHora && /^\d{2}:\d{2}$/.test(qsHora)) setHorario(qsHora);
    if (qsQuadra) setQuadraIdQuery(qsQuadra);
    if (qsEsporte) setEsporteQuery(qsEsporte);
  }, [searchParams]);

  /* ===== Esportes (e mapear query -> esporteId) ===== */
  useEffect(() => {
    axios
      .get<Esporte[]>(`${API_URL}/esportes`, { withCredentials: true })
      .then((res) => {
        setEsportes(res.data);

        // Se veio "esporte" na URL, tentar mapear para id
        if (esporteQuery && !esporteId) {
          const byId = res.data.find((e) => e.id === esporteQuery);
          const byName = res.data.find(
            (e) => e.nome.trim().toLowerCase() === esporteQuery.trim().toLowerCase()
          );
          const chosen = byId?.id || byName?.id || "";
          if (chosen) setEsporteId(chosen);
        }
      })
      .catch(() => setFeedback({ kind: "error", text: "Falha ao carregar esportes." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esporteQuery]);

  /* ===== Disponibilidade (permanente) ===== */
  useEffect(() => {
    if (!esporteId || !horario || diaSemana === "") {
      setQuadras([]);
      setExisteAgendamentoComum(false);
      setDataInicio("");
      setDataUltimoConflito(null);
      setProximasDatasDisponiveis([]);
      return;
    }

    setFeedback(null);
    axios
      .get<QuadraDisponivel[]>(`${API_URL}/disponibilidade`, {
        params: { diaSemana, horario, esporteId },
        withCredentials: true,
      })
      .then((res) => {
        setQuadras(res.data);

        const existeConflitoComum = res.data.some(
          (q) => !q.disponivel && q.conflitoComum && !q.conflitoPermanente
        );
        setExisteAgendamentoComum(existeConflitoComum);
        setDataInicio("");
        setDataUltimoConflito(null);
        setProximasDatasDisponiveis([]);

        // --------- estabiliza a seleção da quadra ----------
        // 1) se é a 1ª carga e veio quadraId pela URL, tenta aplicar
        if (prefillRef.current && quadraIdQuery && !quadraId) {
          const existeNaLista = res.data.some((q) => q.quadraId === quadraIdQuery);
          if (existeNaLista) setQuadraId(quadraIdQuery);
        } else {
          // 2) em cargas subsequentes, só limpe se a quadra atual deixar de existir/ser válida
          const selecionadaAindaExiste = res.data.some(
            (q) =>
              q.quadraId === quadraId &&
              (q.disponivel || q.conflitoComum || q.conflitoPermanente)
          );
          if (!selecionadaAindaExiste) setQuadraId("");
        }
        prefillRef.current = false;
        // ---------------------------------------------------
      })
      .catch((err) => {
        console.error(err);
        setQuadras([]);
        setExisteAgendamentoComum(false);
        setDataInicio("");
        setDataUltimoConflito(null);
        setProximasDatasDisponiveis([]);
        setFeedback({ kind: "error", text: "Erro ao buscar disponibilidade." });
      });
    // IMPORTANTE: não colocar `quadraId` nas deps para não criar loop de limpeza/seleção
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esporteId, horario, diaSemana, quadraIdQuery]);

  /* ===== Próximas datas quando há conflito comum ===== */
  useEffect(() => {
    if (!diaSemana || !horario || !quadraId) {
      setProximasDatasDisponiveis([]);
      setDataUltimoConflito(null);
      setDataInicio("");
      return;
    }

    const quadraSelecionada = quadras.find((q) => q.quadraId === quadraId);
    const deveBuscarDatas =
      quadraSelecionada?.conflitoComum && !quadraSelecionada?.conflitoPermanente;

    if (!deveBuscarDatas) {
      setProximasDatasDisponiveis([]);
      setDataUltimoConflito(null);
      setDataInicio("");
      return;
    }

    axios
      .get<ProximasDatasResp>(`${API_URL}/proximaDataPermanenteDisponivel`, {
        params: { diaSemana, horario, quadraId },
        withCredentials: true,
      })
      .then((res) => {
        setProximasDatasDisponiveis(res.data.proximasDatasDisponiveis);
        setDataUltimoConflito(res.data.dataUltimoConflito);
        setDataInicio("");
        if (res.data.proximasDatasDisponiveis.length === 0) {
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
  }, [diaSemana, horario, quadraId, quadras]);

  /* ===== Busca usuários (apenas com a lista aberta) — recebe celular e tipo ===== */
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

  // ✅ regra de exibição igual ao Comum: dono selecionado é professor e horário < 18
  const showTipoSessao = selectedOwnerIsProfessor && horarioAntesDe18(horario);

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
      setFeedback({
        kind: "error",
        text: "Informe o telefone do convidado dono.",
      });
      return;
    }

    // se o seletor de tipo estiver visível, exigir escolha
    if (showTipoSessao && !tipoSessao) {
      setFeedback({ kind: "error", text: "Informe se é AULA ou JOGO." });
      return;
    }

    if (existeAgendamentoComum && proximasDatasDisponiveis.length > 0 && !dataInicio) {
      setFeedback({ kind: "error", text: "Selecione uma data de início válida." });
      return;
    }

    const body: Record<string, any> = {
      diaSemana,
      esporteId,
      quadraId,
      horario,
      ...(showTipoSessao && tipoSessao ? { tipoSessao } : {}), // envia apenas quando aplicável
      ...(usuarioId
        ? { usuarioId }
        : {
            // concatena "Nome Telefone" para manter compatibilidade com o backend
            convidadosNomes: [
              `${convidadoDonoNome.trim()} ${convidadoDonoTelefone.trim()}`.trim(),
            ],
          }),
      ...(existeAgendamentoComum ? { dataInicio } : {}),
    };

    try {
      setSubmitting(true);
      await axios.post(`${API_URL}/agendamentosPermanentes`, body, { withCredentials: true });

      setFeedback({ kind: "success", text: "Agendamento permanente cadastrado com sucesso!" });
      toast.success("Agendamento permanente cadastrado com sucesso!");

      // decide a data para abrir em todosHorarios:
      const redirectYmd =
        (existeAgendamentoComum && dataInicio) || proximaDataParaDiaSemana(diaSemana, horario);

      // limpar campos principais
      setUsuarioId("");
      setConvidadoDonoNome("");
      setConvidadoDonoTelefone("");
      setQuadraId("");
      setTipoSessao("");

      setTimeout(() => {
        const params = new URLSearchParams({ data: redirectYmd });
        router.push(`/adminMaster/todosHorarios?${params.toString()}`);
      }, 350);
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
      <h1 className="text-2xl font-bold mb-6">Cadastrar Permanente</h1>

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

        {/* Esporte */}
        <div>
          <label className="block font-semibold mb-1">Esporte</label>
          <select
            value={esporteId}
            onChange={(e) => {
              setEsporteId(e.target.value);
              setFeedback(null);
            }}
            className="w-full border rounded p-2"
            required
          >
            <option value="">Selecione</option>
            {esportes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>

        {/* Horário + Tipo de Sessão (condicional) */}
        <div>
          <label className="block font-semibold mb-1">Horário</label>
          <select
            value={horario}
            onChange={(e) => {
              setHorario(e.target.value);
              setFeedback(null);
            }}
            className="w-full border rounded p-2"
            required
          >
            <option value="">Selecione um horário</option>
            {Array.from({ length: 16 }, (_, i) => {
              const hour = 8 + i;
              const label = hour.toString().padStart(2, "0") + ":00";
              return (
                <option key={label} value={label}>
                  {label}
                </option>
              );
            })}
          </select>

          {/* ✅ Campo tipo da sessão — aparece quando dono é professor e horário < 18h */}
          {showTipoSessao && (
            <div className="mt-2">
              <label className="block font-semibold mb-1">
                Tipo da sessão <span className="text-xs text-gray-500">(apenas para professores, antes das 18h)</span>
              </label>
              <select
                value={tipoSessao}
                onChange={(e) => setTipoSessao(e.target.value as "AULA" | "JOGO" | "")}
                className="w-full border rounded p-2"
                required={showTipoSessao}
              >
                <option value="">Selecione</option>
                <option value="AULA">Aula</option>
                <option value="JOGO">Jogo</option>
              </select>
            </div>
          )}
        </div>

        {/* Quadra */}
        <div>
          <label className="block font-semibold mb-1">Quadra</label>
          <select
            value={quadraId}
            onChange={(e) => {
              setQuadraId(e.target.value);
              setFeedback(null);
            }}
            className="w-full border rounded p-2"
            required
            disabled={!quadras.length}
          >
            <option value="">Selecione</option>
            {quadras.map((q) => {
              const podeMostrar = q.disponivel || q.conflitoComum || q.conflitoPermanente;
              if (!podeMostrar) return null;

              const desabilitar = q.conflitoPermanente || (!q.disponivel && !q.conflitoComum);

              return (
                <option key={q.quadraId} value={q.quadraId} disabled={desabilitar}>
                  {q.nome} - {q.numero}
                  {!q.disponivel ? " (Indisponível)" : ""}
                  {q.conflitoComum ? " (Conflito com agendamento comum)" : ""}
                  {q.conflitoPermanente ? " (Conflito com agendamento permanente)" : ""}
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

                      // ✅ DONO selecionado é professor?
                      const t = (u.tipo || "").toString().toUpperCase();
                      setSelectedOwnerIsProfessor(t === "ADMIN_PROFESSORES");
                      // ao trocar dono, zera tipoSessao para forçar escolha novamente se campo estiver visível
                      setTipoSessao("");
                    }}
                    title={u.celular || ""}
                  >
                    <div className="font-medium text-gray-800">{u.nome}</div>
                    {u.tipo && (
                      <div className="text-[11px] text-gray-500">{String(u.tipo).toUpperCase()}</div>
                    )}
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

          {/* Convidado dono (nome + telefone) */}
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
                    setSelectedOwnerIsProfessor(false); // convidado não tem papel de professor no sistema
                    setTipoSessao("");
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
              A quadra selecionada possui conflito com agendamento comum no dia{" "}
              {format(parseISO(dataUltimoConflito), "dd/MM/yyyy")}. Selecione uma data de início disponível:
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
