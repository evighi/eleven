"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";

type QuadraDTO = {
  id: string;
  nome: string;
  numero: number;
  esportes: { id: string; nome: string }[];
};

type MotivoBloqueio = {
  id: string;
  descricao: string;
  ativo: boolean;
};

export default function BloqueioQuadrasPage() {
  const { usuario } = useAuthStore();
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  // Filtros / Formulário
  const [data, setData] = useState<string>(""); // Data do bloqueio
  const [inicio, setInicio] = useState<string>(""); // Início do bloqueio (HH:MM)
  const [fim, setFim] = useState<string>(""); // Fim do bloqueio (HH:MM ou "00:00" na UI)

  // Quadras
  const [quadras, setQuadras] = useState<QuadraDTO[]>([]);
  const [loadingQuadras, setLoadingQuadras] = useState<boolean>(false);
  const [quadrasSelecionadas, setQuadrasSelecionadas] = useState<string[]>([]);

  // Motivos
  const [motivos, setMotivos] = useState<MotivoBloqueio[]>([]);
  const [loadingMotivos, setLoadingMotivos] = useState<boolean>(false);
  const [motivoSelecionadoId, setMotivoSelecionadoId] = useState<string>("");

  // Submissão
  const [enviando, setEnviando] = useState<boolean>(false);

  // Horas base: 07:00..23:00 (inteiras)
  const HORAS_BASE = useMemo(
    () => Array.from({ length: 17 }, (_, i) => `${String(7 + i).padStart(2, "0")}:00`),
    []
  );

  const opcoesHoraInicio = HORAS_BASE;
  const opcoesHoraFimUI = useMemo(() => [...HORAS_BASE, "00:00"], [HORAS_BASE]);

  const normalizeFim = (valor: string) => (valor === "00:00" ? "23:59" : valor);

  // Carregar quadras (com esportes) ao entrar
  useEffect(() => {
    const fetchQuadras = async () => {
      setLoadingQuadras(true);
      try {
        const res = await fetch(`${API_URL}/quadras`, { credentials: "include" });
        if (!res.ok) throw new Error("Falha ao carregar quadras");
        const data: QuadraDTO[] = await res.json();
        setQuadras(data);
      } catch (error) {
        console.error("Erro ao buscar quadras:", error);
      } finally {
        setLoadingQuadras(false);
      }
    };
    fetchQuadras();
  }, [API_URL]);

  // Carregar motivos de bloqueio (somente ativos)
  useEffect(() => {
    const fetchMotivos = async () => {
      setLoadingMotivos(true);
      try {
        const res = await axios.get<MotivoBloqueio[]>(`${API_URL}/motivosBloqueio`, {
          withCredentials: true,
        });
        const ativos = res.data.filter((m) => m.ativo);
        setMotivos(ativos);

        // Se tiver exatamente 1 motivo, já pré-seleciona
        if (ativos.length === 1) {
          setMotivoSelecionadoId(ativos[0].id);
        }
      } catch (error) {
        console.error("Erro ao buscar motivos de bloqueio:", error);
      } finally {
        setLoadingMotivos(false);
      }
    };
    fetchMotivos();
  }, [API_URL]);

  const semMotivos = !loadingMotivos && motivos.length === 0;

  // Agrupar quadras por esporte
  const quadrasPorEsporte = useMemo(() => {
    const map: Record<string, QuadraDTO[]> = {};

    quadras.forEach((q) => {
      const esportes = (q.esportes && q.esportes.map((qe) => qe.nome).filter(Boolean)) || [];

      if (esportes.length === 0) {
        map["Outros"] = map["Outros"] || [];
        map["Outros"].push(q);
      } else {
        esportes.forEach((nome) => {
          map[nome] = map[nome] || [];
          map[nome].push(q);
        });
      }
    });

    Object.keys(map).forEach((k) => map[k].sort((a, b) => a.numero - b.numero));

    return map;
  }, [quadras]);

  // Seleção de quadra
  const toggleQuadraSelecionada = (id: string) => {
    setQuadrasSelecionadas((prev) =>
      prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]
    );
  };

  // Validação simples
  const validar = () => {
    if (!data) return "Selecione a data.";
    if (!inicio || !fim) return "Selecione o horário de início e de fim.";

    const fimComparacao = normalizeFim(fim);
    if (inicio >= fimComparacao) {
      return "O horário de início deve ser menor que o horário de fim.";
    }

    if (!usuario) return "Usuário não autenticado.";
    if (quadrasSelecionadas.length === 0) return "Selecione pelo menos uma quadra.";

    if (!motivoSelecionadoId) {
      return "Selecione o motivo do bloqueio.";
    }

    return null;
  };

  // Submissão do bloqueio
  const enviarBloqueio = async () => {
    const erro = validar();
    if (erro) {
      alert(erro);
      return;
    }

    const fimReq = normalizeFim(fim);

    setEnviando(true);
    try {
      await axios.post(
        `${API_URL}/bloqueios`,
        {
          quadraIds: quadrasSelecionadas,
          dataBloqueio: data, // "YYYY-MM-DD"
          inicioBloqueio: inicio, // ex.: "22:00"
          fimBloqueio: fimReq, // "23:59" quando UI seleciona "00:00"
          motivoBloqueioId: motivoSelecionadoId,
          // bloqueadoPorId é ignorado no back (usamos o usuário do token)
        },
        { withCredentials: true }
      );

      alert("Quadras bloqueadas com sucesso!");
      setQuadrasSelecionadas([]);
      // mantém data/horários e motivo selecionado, se você quiser resetar tudo, pode limpar aqui também
    } catch (e: unknown) {
      console.error(e);
      let msg = "Erro ao criar bloqueio.";
      if (axios.isAxiosError(e)) {
        const d = e.response?.data as { erro?: string; error?: string } | undefined;
        msg = d?.erro || d?.error || msg;
      }
      alert(msg);
    } finally {
      setEnviando(false);
    }
  };

  // Definir data inicial se não houver
  useEffect(() => {
    if (!data) {
      const hoje = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const d = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
      setData(d);
    }
  }, [data]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-orange-700">Bloquear Quadras</h1>

      {/* Filtros / Formulário */}
      <div className="bg-white p-4 shadow rounded-lg grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Data</label>
          <input
            type="date"
            className="border p-2 rounded-lg"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Início</label>
          <select
            className="border p-2 rounded-lg"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          >
            <option value="">Selecione</option>
            {opcoesHoraInicio.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Fim</label>
          <select
            className="border p-2 rounded-lg"
            value={fim}
            onChange={(e) => setFim(e.target.value)}
          >
            <option value="">Selecione</option>
            {opcoesHoraFimUI.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span className="mt-1 text-[11px] text-gray-500">
            Dica: selecione <strong>00:00</strong> para bloquear até o fim do dia
            (enviado como 23:59).
          </span>
        </div>

        {/* Motivo do bloqueio */}
        <div className="flex flex-col">
          <label className="text-sm text-gray-600">Motivo do bloqueio</label>
          <select
            className="border p-2 rounded-lg"
            value={motivoSelecionadoId}
            onChange={(e) => setMotivoSelecionadoId(e.target.value)}
            disabled={loadingMotivos || semMotivos}
          >
            <option value="">
              {loadingMotivos
                ? "Carregando motivos..."
                : semMotivos
                ? "Nenhum motivo cadastrado"
                : "Selecione o motivo"}
            </option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.descricao}
              </option>
            ))}
          </select>
          <span className="mt-1 text-[11px] text-gray-500">
            Cadastre e gerencie motivos em{" "}
            <strong>Admin &gt; Bloqueios &gt; Motivos</strong>.
          </span>
        </div>
      </div>

      {/* Seleção de quadras */}
      <div>
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold text-orange-700">Selecione as quadras</h2>
          <div className="flex-1 border-t border-gray-300 ml-3" />
        </div>

        {loadingQuadras ? (
          <p>Carregando quadras...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(quadrasPorEsporte).map(([esporte, lista]) => (
              <div key={esporte} className="bg-white rounded-lg shadow p-3">
                <h3 className="font-semibold mb-3 text-orange-700 text-center">{esporte}</h3>

                <div className="grid grid-cols-2 gap-3">
                  {lista.map((q) => {
                    const selecionada = quadrasSelecionadas.includes(q.id);
                    return (
                      <div
                        key={q.id}
                        onClick={() => toggleQuadraSelecionada(q.id)}
                        className={`p-3 rounded-lg text-center cursor-pointer select-none transition border
                          ${
                            selecionada
                              ? "border-green-600 bg-green-100"
                              : "border-gray-300 hover:border-orange-500 hover:bg-orange-50"
                          }`}
                      >
                        <p className="font-medium">{q.nome}</p>
                        <p className="text-xs text-gray-700">Quadra {q.numero}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-sm text-gray-700">
          Selecionadas: <span className="font-semibold">{quadrasSelecionadas.length}</span>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <button
          onClick={enviarBloqueio}
          disabled={enviando}
          className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
        >
          {enviando ? "Bloqueando..." : "Bloquear quadras"}
        </button>
        <button
          onClick={() => setQuadrasSelecionadas([])}
          className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded cursor-pointer"
        >
          Limpar seleção
        </button>
      </div>
    </div>
  );
}
