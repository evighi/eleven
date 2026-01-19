"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";

type Quadra = {
  id: string;
  nome: string;
  numero: number;
};

type UsuarioResumo = {
  id?: string;
  nome: string;
};

type MotivoBloqueio = {
  id: string;
  nome: string;
  descricao?: string | null;
};

type Bloqueio = {
  id: string;
  createdAt: string; // ISO completo com horário
  dataBloqueio: string; // ISO date (YYYY-MM-DD...)
  inicioBloqueio: string; // "HH:MM"
  fimBloqueio: string; // "HH:MM"
  bloqueadoPor: UsuarioResumo;
  quadras: Quadra[];

  motivoId?: string | null;
  motivo?: MotivoBloqueio | null;
};

// NÃO usar new Date pra campos date-only que vêm zerados em UTC
const ymdFromIsoLike = (isoLike: string) => {
  const m = isoLike.match(/^(\d{4}-\d{2}-\d{2})/);
  const ymd = m ? m[1] : isoLike.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : "";
};

export default function DesbloqueioQuadrasPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [bloqueioSelecionado, setBloqueioSelecionado] = useState<Bloqueio | null>(null);
  const [confirmarDesbloqueio, setConfirmarDesbloqueio] = useState<boolean>(false);
  const [deletando, setDeletando] = useState<boolean>(false);

  // filtros
  const [motivos, setMotivos] = useState<MotivoBloqueio[]>([]);
  const [motivoIdFiltro, setMotivoIdFiltro] = useState<string>("");
  const [dataFiltro, setDataFiltro] = useState<string>("");

  // ✅ Modal edição
  const [openEditar, setOpenEditar] = useState(false);
  const [editando, setEditando] = useState(false);
  const [erroEditar, setErroEditar] = useState<string>("");

  // dados do formulário de edição
  const [editData, setEditData] = useState<string>(""); // YYYY-MM-DD
  const [editInicio, setEditInicio] = useState<string>(""); // HH:MM
  const [editFim, setEditFim] = useState<string>(""); // HH:MM
  const [editMotivo, setEditMotivo] = useState<string>(""); // "SEM_MOTIVO" | motivoId
  const [editQuadraIds, setEditQuadraIds] = useState<string[]>([]);

  // lista completa de quadras para selecionar no modal
  const [quadrasDisponiveis, setQuadrasDisponiveis] = useState<Quadra[]>([]);
  const [loadingQuadras, setLoadingQuadras] = useState<boolean>(false);

  // ---- Motivos ativos ----
  useEffect(() => {
    const fetchMotivos = async () => {
      try {
        const res = await axios.get<MotivoBloqueio[]>(`${API_URL}/motivosBloqueio`, {
          params: { ativos: "true" },
          withCredentials: true,
        });
        setMotivos(res.data);
      } catch (error) {
        console.error("Erro ao buscar motivos de bloqueio:", error);
      }
    };

    fetchMotivos();
  }, [API_URL]);

  // ---- Bloqueios (filtro por motivo + data) ----
  useEffect(() => {
    const fetchBloqueios = async () => {
      setLoading(true);
      try {
        const params: any = {};

        if (motivoIdFiltro) params.motivoId = motivoIdFiltro;
        if (dataFiltro) params.data = dataFiltro; // YYYY-MM-DD

        const res = await axios.get<Bloqueio[]>(`${API_URL}/bloqueios`, {
          params,
          withCredentials: true,
        });
        setBloqueios(res.data);
      } catch (error) {
        console.error("Erro ao buscar bloqueios:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBloqueios();
  }, [API_URL, motivoIdFiltro, dataFiltro]);

  // createdAt é carimbo completo
  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  const formatDateBR = (isoLike: string) => {
    const ymd = ymdFromIsoLike(isoLike);
    if (!ymd) return isoLike;
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  };

  // ------------------------------------
  // ✅ DESBLOQUEAR (DELETE)
  // ------------------------------------
  const confirmarDesbloqueioHandler = async () => {
    if (!bloqueioSelecionado) return;
    setDeletando(true);
    try {
      await axios.delete(`${API_URL}/bloqueios/${bloqueioSelecionado.id}`, {
        withCredentials: true,
      });
      alert("Quadras desbloqueadas com sucesso!");
      setBloqueios((prev) => prev.filter((b) => b.id !== bloqueioSelecionado.id));
      setConfirmarDesbloqueio(false);
      setBloqueioSelecionado(null);
    } catch (error) {
      console.error("Erro ao desbloquear quadras:", error);
      alert("Erro ao desbloquear quadras.");
    } finally {
      setDeletando(false);
    }
  };

  // ------------------------------------
  // ✅ ABRIR MODAL EDIÇÃO (prefill)
  // ------------------------------------
  const abrirEditar = (bloqueio: Bloqueio) => {
    setErroEditar("");
    setBloqueioSelecionado(bloqueio);

    setEditData(ymdFromIsoLike(bloqueio.dataBloqueio)); // YYYY-MM-DD
    setEditInicio(bloqueio.inicioBloqueio);
    setEditFim(bloqueio.fimBloqueio);

    // motivo: se não tem -> SEM_MOTIVO
    setEditMotivo(bloqueio.motivoId ? bloqueio.motivoId : "SEM_MOTIVO");

    // quadras selecionadas
    setEditQuadraIds(bloqueio.quadras.map((q) => q.id));

    setOpenEditar(true);
  };

  // buscar quadras quando abrir modal (pra editar as quadras)
  useEffect(() => {
    const fetchQuadras = async () => {
      if (!openEditar) return;

      setLoadingQuadras(true);
      try {
        // ⚠️ Ajuste aqui se sua rota for diferente
        const res = await axios.get<Quadra[]>(`${API_URL}/quadras`, {
          withCredentials: true,
        });
        setQuadrasDisponiveis(res.data);
      } catch (error) {
        console.error("Erro ao buscar quadras:", error);
        // se falhar, ainda dá pra salvar usando as quadras já carregadas do bloqueio
        setQuadrasDisponiveis([]);
      } finally {
        setLoadingQuadras(false);
      }
    };

    fetchQuadras();
  }, [openEditar, API_URL]);

  // ------------------------------------
  // ✅ Helper seleção de quadras
  // ------------------------------------
  const toggleQuadra = (id: string) => {
    setEditQuadraIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selecionarTodasQuadras = () => {
    const ids = (quadrasDisponiveis.length > 0 ? quadrasDisponiveis : bloqueioSelecionado?.quadras ?? []).map(
      (q) => q.id
    );
    setEditQuadraIds(Array.from(new Set(ids)));
  };

  const limparSelecaoQuadras = () => {
    setEditQuadraIds([]);
  };

  const quadrasParaExibirNoModal: Quadra[] = useMemo(() => {
    // prioridade: lista completa do endpoint
    if (quadrasDisponiveis.length > 0) return quadrasDisponiveis;

    // fallback: quadras do bloqueio selecionado
    if (bloqueioSelecionado?.quadras?.length) return bloqueioSelecionado.quadras;

    return [];
  }, [quadrasDisponiveis, bloqueioSelecionado]);

  // ------------------------------------
  // ✅ SALVAR EDIÇÃO (PATCH)
  // ------------------------------------
  const salvarEdicao = async () => {
    if (!bloqueioSelecionado) return;
    setErroEditar("");

    // validações do front (para ficar intuitivo)
    if (!editData) {
      setErroEditar("Selecione uma data válida.");
      return;
    }
    if (!editInicio || !editFim) {
      setErroEditar("Selecione o horário de início e fim.");
      return;
    }
    if (editInicio >= editFim) {
      setErroEditar("Hora inicial deve ser menor que a final.");
      return;
    }
    if (editQuadraIds.length === 0) {
      setErroEditar("Não é possível salvar: você removeu todas as quadras do bloqueio.");
      return;
    }

    setEditando(true);

    try {
      // motivoId: se usuário escolheu SEM_MOTIVO => null
      const motivoIdPayload = editMotivo === "SEM_MOTIVO" ? null : editMotivo;

      const payload = {
        quadraIds: editQuadraIds,
        dataBloqueio: editData, // "YYYY-MM-DD" (o zod do back coerce.date resolve)
        inicioBloqueio: editInicio,
        fimBloqueio: editFim,
        motivoId: motivoIdPayload,
      };

      const res = await axios.patch<{ mensagem: string; bloqueio: Bloqueio }>(
        `${API_URL}/bloqueios/${bloqueioSelecionado.id}`,
        payload,
        { withCredentials: true }
      );

      alert("Bloqueio atualizado com sucesso!");

      // atualiza lista local
      setBloqueios((prev) =>
        prev.map((b) => (b.id === bloqueioSelecionado.id ? (res.data.bloqueio as any) : b))
      );

      // fecha modal
      setOpenEditar(false);
      setBloqueioSelecionado(null);
    } catch (error: any) {
      console.error("Erro ao atualizar bloqueio:", error);

      // tenta mostrar a mensagem do backend (409 conflito / 400 etc.)
      const msg =
        error?.response?.data?.erro ||
        error?.response?.data?.message ||
        "Erro ao atualizar o bloqueio. Verifique os dados e tente novamente.";

      setErroEditar(String(msg));
    } finally {
      setEditando(false);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-orange-700">Desbloquear Quadras</h1>

      {/* Filtros (motivo + data) */}
      <div className="bg-white p-4 rounded-lg shadow flex flex-wrap items-end gap-4">
        {/* Filtro por motivo */}
        <div className="flex flex-col">
          <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
          <select
            value={motivoIdFiltro}
            onChange={(e) => setMotivoIdFiltro(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm min-w-[200px]"
          >
            <option value="">Todos os motivos</option>
            <option value="SEM_MOTIVO">Sem motivo definido</option>
            {motivos.map((motivo) => (
              <option key={motivo.id} value={motivo.id}>
                {motivo.nome}
              </option>
            ))}
          </select>
        </div>

        {/* Filtro por data */}
        <div className="flex flex-col">
          <label className="block text-sm font-medium text-gray-700 mb-1">Dia</label>
          <input
            type="date"
            value={dataFiltro}
            onChange={(e) => setDataFiltro(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm min-w-[160px]"
          />
        </div>

        {(motivoIdFiltro || dataFiltro) && (
          <button
            type="button"
            onClick={() => {
              setMotivoIdFiltro("");
              setDataFiltro("");
            }}
            className="text-sm px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Lista de bloqueios */}
      <div>
        {loading ? (
          <p>Carregando bloqueios...</p>
        ) : bloqueios.length === 0 ? (
          <p>Nenhum bloqueio encontrado.</p>
        ) : (
          <div className="space-y-4">
            {bloqueios.map((bloqueio) => (
              <div key={bloqueio.id} className="bg-white p-4 rounded-lg shadow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-orange-700">
                      Bloqueio criado por {bloqueio.bloqueadoPor?.nome ?? "—"}
                    </h2>

                    <p className="text-sm text-gray-600">
                      Criado em: <span className="font-medium">{formatDateTime(bloqueio.createdAt)}</span>
                    </p>

                    <p className="text-sm text-gray-600">
                      Dia bloqueado: <span className="font-medium">{formatDateBR(bloqueio.dataBloqueio)}</span>
                    </p>

                    <p className="text-sm text-gray-600">
                      Horário: <span className="font-medium">{bloqueio.inicioBloqueio} – {bloqueio.fimBloqueio}</span>
                    </p>

                    {/* Motivo */}
                    {bloqueio.motivo ? (
                      <div className="mt-2 text-sm text-gray-700">
                        <p>
                          <span className="font-semibold">Motivo:</span> {bloqueio.motivo.nome}
                        </p>
                        {bloqueio.motivo.descricao && (
                          <p className="text-gray-600">
                            <span className="font-semibold">Detalhes:</span> {bloqueio.motivo.descricao}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500">
                        <span className="font-semibold">Motivo:</span> — (não informado)
                      </p>
                    )}
                  </div>

                  {/* ✅ Ações do card */}
                  <div className="flex flex-col gap-2 min-w-[160px]">
                    <button
                      onClick={() => abrirEditar(bloqueio)}
                      className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded cursor-pointer"
                    >
                      Editar
                    </button>

                    <button
                      onClick={() => {
                        setBloqueioSelecionado(bloqueio);
                        setConfirmarDesbloqueio(true);
                      }}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded cursor-pointer"
                    >
                      Desbloquear
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-sm text-gray-700 font-medium mb-1">Quadras bloqueadas:</p>
                  <ul className="list-disc ml-5 text-sm text-gray-700">
                    {bloqueio.quadras.map((quadra) => (
                      <li key={quadra.id}>
                        {quadra.nome} — Nº {quadra.numero}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ✅ MODAL EDIÇÃO */}
      {openEditar && bloqueioSelecionado && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-[720px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-orange-700">Editar Bloqueio</h3>
                <p className="text-sm text-gray-600">
                  Bloqueio criado por{" "}
                  <span className="font-medium">{bloqueioSelecionado.bloqueadoPor?.nome ?? "—"}</span>
                </p>
              </div>

              <button
                onClick={() => {
                  setOpenEditar(false);
                  setErroEditar("");
                }}
                className="text-sm px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
                disabled={editando}
              >
                Fechar
              </button>
            </div>

            {/* Linha divisória */}
            <div className="border-t border-gray-200 my-4" />

            {/* Form */}
            <div className="space-y-5">
              {/* Data + Horários */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 mb-1">Dia</label>
                  <input
                    type="date"
                    value={editData}
                    onChange={(e) => setEditData(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 mb-1">Início</label>
                  <input
                    type="time"
                    value={editInicio}
                    onChange={(e) => setEditInicio(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 mb-1">Fim</label>
                  <input
                    type="time"
                    value={editFim}
                    onChange={(e) => setEditFim(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Motivo */}
              <div className="flex flex-col">
                <label className="text-sm font-medium text-gray-700 mb-1">Motivo</label>
                <select
                  value={editMotivo}
                  onChange={(e) => setEditMotivo(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="SEM_MOTIVO">Sem motivo definido</option>
                  {motivos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Você pode trocar o motivo ou deixar como “Sem motivo”.
                </p>
              </div>

              {/* Quadras */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Quadras do bloqueio</p>
                    <p className="text-xs text-gray-600">
                      Selecionadas: <span className="font-semibold">{editQuadraIds.length}</span>
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selecionarTodasQuadras}
                      className="text-sm px-3 py-2 rounded bg-white border border-gray-300 hover:bg-gray-100"
                      disabled={editando}
                    >
                      Selecionar todas
                    </button>
                    <button
                      type="button"
                      onClick={limparSelecaoQuadras}
                      className="text-sm px-3 py-2 rounded bg-white border border-gray-300 hover:bg-gray-100"
                      disabled={editando}
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                <div className="mt-3 max-h-[240px] overflow-auto pr-1">
                  {loadingQuadras ? (
                    <p className="text-sm text-gray-600">Carregando quadras...</p>
                  ) : quadrasParaExibirNoModal.length === 0 ? (
                    <p className="text-sm text-gray-600">
                      Não foi possível carregar a lista completa de quadras.
                      Você ainda pode salvar mantendo as quadras do bloqueio atual.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {quadrasParaExibirNoModal.map((q) => {
                        const checked = editQuadraIds.includes(q.id);
                        return (
                          <label
                            key={q.id}
                            className={`flex items-center gap-3 p-2 rounded border cursor-pointer ${
                              checked ? "bg-white border-orange-300" : "bg-white border-gray-200"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleQuadra(q.id)}
                              className="h-4 w-4"
                              disabled={editando}
                            />
                            <span className="text-sm text-gray-800">
                              {q.nome} — Nº {q.numero}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {editQuadraIds.length === 0 && (
                  <p className="mt-2 text-sm text-red-600 font-medium">
                    Você removeu todas as quadras. Selecione ao menos 1 para salvar.
                  </p>
                )}
              </div>

              {/* Erro */}
              {erroEditar && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">
                  {erroEditar}
                </div>
              )}

              {/* Ações */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setOpenEditar(false);
                    setErroEditar("");
                  }}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded cursor-pointer"
                  disabled={editando}
                >
                  Cancelar
                </button>

                <button
                  onClick={salvarEdicao}
                  className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
                  disabled={editando}
                >
                  {editando ? "Salvando..." : "Salvar alterações"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação Desbloqueio */}
      {confirmarDesbloqueio && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-[420px]">
            <h3 className="text-lg font-semibold text-red-600">Confirmar Desbloqueio</h3>
            <p className="mt-4">Tem certeza que deseja desbloquear as quadras deste bloqueio?</p>

            <div className="mt-6 flex justify-end gap-4">
              <button
                onClick={() => setConfirmarDesbloqueio(false)}
                className="bg-gray-300 text-black px-4 py-2 rounded cursor-pointer"
                disabled={deletando}
              >
                Cancelar
              </button>

              <button
                onClick={confirmarDesbloqueioHandler}
                className="bg-red-600 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
                disabled={deletando}
              >
                {deletando ? "Desbloqueando..." : "Confirmar Desbloqueio"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
