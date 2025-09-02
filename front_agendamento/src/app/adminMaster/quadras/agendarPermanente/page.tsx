"use client";

import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";

type QuadraDisponivel = {
  quadraId: string;
  nome: string;
  numero: number;
  disponivel: boolean;
  conflitoComum?: boolean;
  conflitoPermanente?: boolean;
};

type Esporte = { id: string; nome: string };
type UsuarioBusca = { id: string; nome: string; email?: string | null };
type ProximasDatasResp = { proximasDatasDisponiveis: string[]; dataUltimoConflito: string | null };

const diasEnum = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"] as const;
const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

export default function CadastrarPermanente() {
  const router = useRouter();

  const [diaSemana, setDiaSemana] = useState<string>("");
  const [esporteId, setEsporteId] = useState<string>("");
  const [quadraId, setQuadraId] = useState<string>("");
  const [horario, setHorario] = useState<string>("");

  // Dono cadastrado
  const [usuarioId, setUsuarioId] = useState<string>("");
  const [busca, setBusca] = useState<string>("");
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState<boolean>(false);
  const [listaAberta, setListaAberta] = useState<boolean>(false);

  // Convidado como dono (nome livre)
  const [convidadoDonoNome, setConvidadoDonoNome] = useState<string>("");

  // Datas e disponibilidade
  const [dataInicio, setDataInicio] = useState<string>("");
  const [esportes, setEsportes] = useState<Esporte[]>([]);
  const [quadras, setQuadras] = useState<QuadraDisponivel[]>([]);
  const [existeAgendamentoComum, setExisteAgendamentoComum] = useState<boolean>(false);
  const [dataUltimoConflito, setDataUltimoConflito] = useState<string | null>(null);
  const [proximasDatasDisponiveis, setProximasDatasDisponiveis] = useState<string[]>([]);

  // Spinner do botão
  const [submitting, setSubmitting] = useState(false);

  // Esportes
  useEffect(() => {
    axios
      .get<Esporte[]>(`${API_URL}/esportes`, { withCredentials: true })
      .then((res) => setEsportes(res.data))
      .catch(console.error);
  }, []);

  // Disponibilidade (permanente)
  useEffect(() => {
    if (!esporteId || !horario || diaSemana === "") {
      setQuadras([]);
      setExisteAgendamentoComum(false);
      setDataInicio("");
      setDataUltimoConflito(null);
      setProximasDatasDisponiveis([]);
      return;
    }

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
        setQuadraId("");
      })
      .catch((err) => {
        console.error(err);
        setQuadras([]);
        setExisteAgendamentoComum(false);
        setDataInicio("");
        setDataUltimoConflito(null);
        setProximasDatasDisponiveis([]);
      });
  }, [esporteId, horario, diaSemana]);

  // Próximas datas quando há conflito comum
  useEffect(() => {
    if (!diaSemana || !horario || !quadraId) {
      setProximasDatasDisponiveis([]);
      setDataUltimoConflito(null);
      setDataInicio("");
      return;
    }

    const quadraSelecionada = quadras.find((q) => q.quadraId === quadraId);
    const deveBuscarDatas = quadraSelecionada?.conflitoComum && !quadraSelecionada?.conflitoPermanente;

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
      })
      .catch((err) => {
        console.error(err);
        setProximasDatasDisponiveis([]);
        setDataUltimoConflito(null);
        setDataInicio("");
      });
  }, [diaSemana, horario, quadraId, quadras]);

  // Busca usuários (apenas com a lista aberta)
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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // precisa de um dono: usuarioId OU convidadoDonoNome
    if (!usuarioId && convidadoDonoNome.trim() === "") {
      alert("Informe um usuário (selecionando da lista) OU um convidado como dono.");
      return;
    }

    if (existeAgendamentoComum && proximasDatasDisponiveis.length > 0 && !dataInicio) {
      alert("Por favor, selecione uma data de início válida.");
      return;
    }

    const body: Record<string, any> = {
      diaSemana,
      esporteId,
      quadraId,
      horario,
      ...(usuarioId
        ? { usuarioId }
        : { convidadosNomes: [convidadoDonoNome.trim()] }), // ← conforme o back
      ...(existeAgendamentoComum ? { dataInicio } : {}),
    };

    try {
      setSubmitting(true);
      await axios.post(`${API_URL}/agendamentosPermanentes`, body, { withCredentials: true });
      alert("Agendamento permanente cadastrado com sucesso!");
      router.push("/adminMaster/quadras");
    } catch (error) {
      console.error(error);
      alert("Erro ao cadastrar permanente");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-6">Cadastrar Permanente</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Dia da Semana */}
        <div>
          <label className="block font-semibold mb-1">Dia da Semana</label>
          <select
            value={diaSemana}
            onChange={(e) => setDiaSemana(e.target.value)}
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
            onChange={(e) => setEsporteId(e.target.value)}
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

        {/* Horário */}
        <div>
          <label className="block font-semibold mb-1">Horário</label>
          <select
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
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
        </div>

        {/* Quadra */}
        <div>
          <label className="block font-semibold mb-1">Quadra</label>
          <select
            value={quadraId}
            onChange={(e) => setQuadraId(e.target.value)}
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
              }}
              onFocus={() => setListaAberta(true)}
              placeholder="Buscar usuário por nome ou e-mail"
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
                    }}
                  >
                    <div className="font-medium text-gray-800">{u.nome}</div>
                    {u.email && <div className="text-xs text-gray-500">{u.email}</div>}
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
              }}
              placeholder="Ou informe um convidado como dono (nome e telefone opcional)"
              className="w-full border rounded p-2"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Preencha <strong>um</strong> dos dois: usuário cadastrado <em>ou</em> convidado dono.
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
            ${submitting ? "bg-orange-400 cursor-not-allowed" : "bg-orange-500 hover:bg-orange-600"}`}
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
