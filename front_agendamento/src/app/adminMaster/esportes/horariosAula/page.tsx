"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";

/** ====== CONSTS / TYPES ====== */
const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
const BASE_CFG = `${API_URL}/configEsportesHorarios/config/esporte-horarios`;

// janelas válidas de hora cheia (07..23)
const HHS = Array.from({ length: 17 }, (_, i) => String(7 + i).padStart(2, "0")); // ["07","08",...,"23"]
const HH_TO_HHMM = (hh: string) => `${hh}:00`;

type Regra = {
  id?: string;
  esporteId: string;
  esporteNome?: string | null;
  diaSemana: null;        // sempre padrão (todos os dias)
  tipoSessao: "AULA";     // sempre AULA
  inicioHHMM: string;     // "HH:mm"
  fimHHMM: string;        // "HH:mm"
  ativo: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type Esporte = { id: string; nome: string };

/** ====== HELPERS ====== */
function isHHMM(v: string) {
  return /^\d{2}:\d{2}$/.test(v);
}
function normalizeHHMM(v: string) {
  const [hh, mm] = v.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function cmpHHMM(a: string, b: string) {
  return a.localeCompare(b);
}
function hhOf(hhmm: string) {
  // "07:00" -> "07"
  return String(hhmm ?? "00:00").slice(0, 2);
}

/** ====== PAGE ====== */
export default function ConfigHorariosAulaEsportePage() {
  const { usuario } = useAuthStore();
  const isAdmin =
    !!usuario &&
    ["ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"].includes(
      (usuario as any)?.tipo || ""
    );

  const [loading, setLoading] = useState(true);
  const [esportes, setEsportes] = useState<Esporte[]>([]);
  const [esporteId, setEsporteId] = useState<string>("");
  const [regras, setRegras] = useState<Regra[]>([]);
  const [salvando, setSalvando] = useState(false);

  // formulário: sempre PADRÃO + AULA
  const [novo, setNovo] = useState<Regra>({
    esporteId: "",
    diaSemana: null,
    tipoSessao: "AULA",
    inicioHHMM: "07:00",
    fimHHMM: "19:00",
    ativo: true,
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/esportes`, { withCredentials: true });
        setEsportes(r.data || []);
        if (r.data?.[0]?.id) {
          setEsporteId(r.data[0].id);
          setNovo((n) => ({ ...n, esporteId: r.data[0].id }));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (esporteId) carregarRegras(esporteId);
  }, [esporteId]);

  async function carregarRegras(id: string) {
    try {
      setLoading(true);
      const r = await axios.get(`${BASE_CFG}/${id}`, { withCredentials: true });
      const items = (r.data || [])
        .filter((x: any) => String(x.tipoSessao).toUpperCase() === "AULA")
        .filter((x: any) => x.diaSemana === null) // somente padrão
        .map((x: any) => ({
          id: x.id,
          esporteId: x.esporteId,
          esporteNome: x.esporteNome ?? null,
          diaSemana: null as null,
          tipoSessao: "AULA" as const,
          inicioHHMM: x.inicioHHMM,
          fimHHMM: x.fimHHMM,
          ativo: !!x.ativo,
          createdAt: x.createdAt,
          updatedAt: x.updatedAt,
        })) as Regra[];
      setRegras(items);
    } catch (e) {
      console.error(e);
      setRegras([]);
    } finally {
      setLoading(false);
    }
  }

  function onChangeNovo<K extends keyof Regra>(k: K, v: Regra[K]) {
    setNovo((prev) => ({ ...prev, [k]: v }));
  }

  async function criar() {
    if (!novo.esporteId) {
      alert("Selecione um esporte.");
      return;
    }
    const ini = normalizeHHMM(novo.inicioHHMM);
    const fim = normalizeHHMM(novo.fimHHMM);
    if (!ini || !fim || !isHHMM(ini) || !isHHMM(fim)) {
      alert("Horários inválidos. Use o formato HH:mm.");
      return;
    }
    if (cmpHHMM(ini, fim) >= 0) {
      alert("O início deve ser menor que o fim.");
      return;
    }

    try {
      setSalvando(true);
      const payload = {
        esporteId: novo.esporteId,
        diaSemana: null,        // padrão
        tipoSessao: "AULA",     // AULA
        inicioHHMM: ini,
        fimHHMM: fim,
        ativo: novo.ativo,
      };
      await axios.post(`${BASE_CFG}`, payload, { withCredentials: true });
      await carregarRegras(novo.esporteId);
      setNovo((p) => ({ ...p, inicioHHMM: "07:00", fimHHMM: "19:00", ativo: true }));
    } catch (e: any) {
      console.error(e);
      const msg =
        e?.response?.data?.erro || e?.response?.data?.message || "Falha ao criar configuração.";
      alert(msg);
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao(r: Regra) {
    if (!r.id) return;
    const ini = normalizeHHMM(r.inicioHHMM);
    const fim = normalizeHHMM(r.fimHHMM);
    if (!ini || !fim || !isHHMM(ini) || !isHHMM(fim)) {
      alert("Horários inválidos. Use o formato HH:mm.");
      return;
    }
    if (cmpHHMM(ini, fim) >= 0) {
      alert("O início deve ser menor que o fim.");
      return;
    }

    try {
      setSalvando(true);
      const body = {
        esporteId: r.esporteId,
        diaSemana: null,     // mantém padrão
        tipoSessao: "AULA",  // mantém AULA
        inicioHHMM: ini,
        fimHHMM: fim,
        ativo: r.ativo,
      };
      await axios.put(`${BASE_CFG}/${r.id}`, body, { withCredentials: true });
      await carregarRegras(r.esporteId);
    } catch (e: any) {
      console.error(e);
      const msg =
        e?.response?.data?.erro || e?.response?.data?.message || "Falha ao atualizar configuração.";
      alert(msg);
    } finally {
      setSalvando(false);
    }
  }

  async function remover(r: Regra) {
    if (!r.id) return;
    if (!confirm("Remover esta configuração?")) return;
    try {
      setSalvando(true);
      await axios.delete(`${BASE_CFG}/${r.id}`, { withCredentials: true });
      await carregarRegras(r.esporteId);
    } catch (e: any) {
      console.error(e);
      const msg =
        e?.response?.data?.erro || e?.response?.data?.message || "Falha ao remover configuração.";
      alert(msg);
    } finally {
      setSalvando(false);
    }
  }

  // Ordena por início
  const regrasOrdenadas: Regra[] = useMemo(
    () => [...regras].sort((a, b) => a.inicioHHMM.localeCompare(b.inicioHHMM)),
    [regras]
  );

  if (!isAdmin) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Configurar horários de AULA</h1>
        <p className="text-red-600 mt-2">Acesso permitido apenas para administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Configurar horários de AULA</h1>
      </div>

      {/* Aviso sobre JOGO */}
      <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3 rounded-lg text-sm">
        <b>JOGO</b> fica liberado para todos os horários <b>07:00–23:00</b>. Aqui você define apenas as janelas
        permitidas para <b>AULA</b>.
      </div>

      {/* Selecionar esporte */}
      <div className="bg-white rounded-xl p-4 shadow flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Esporte:</span>
          <select
            className="border rounded px-3 py-2"
            value={esporteId}
            onChange={(e) => {
              setEsporteId(e.target.value);
              setNovo((n) => ({ ...n, esporteId: e.target.value }));
            }}
          >
            {esportes.map((e) => (
              <option value={e.id} key={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
        {loading && <span className="text-sm text-gray-500">Carregando…</span>}
      </div>

      {/* Criar nova regra (PADRÃO + AULA) */}
      <div className="bg-white rounded-xl p-4 shadow">
        <h2 className="font-medium mb-3">Nova janela de AULA (todos os dias)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-3">
            <label className="block text-xs mb-1">Início</label>
            <select
              className="w-full border rounded px-2 py-2"
              value={hhOf(novo.inicioHHMM)}
              onChange={(e) => onChangeNovo("inicioHHMM", HH_TO_HHMM(e.target.value))}
            >
              {HHS.map((h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label className="block text-xs mb-1">Fim</label>
            <select
              className="w-full border rounded px-2 py-2"
              value={hhOf(novo.fimHHMM)}
              onChange={(e) => onChangeNovo("fimHHMM", HH_TO_HHMM(e.target.value))}
            >
              {HHS.map((h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3 flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={novo.ativo}
                onChange={(e) => onChangeNovo("ativo", e.target.checked)}
              />
              Ativo
            </label>
          </div>

          <div className="sm:col-span-3 flex items-end">
            <button
              onClick={criar}
              disabled={salvando || !esporteId}
              className="w-full bg-black text-white px-3 py-2 rounded hover:bg-gray-900 disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Adicionar"}
            </button>
          </div>
        </div>
      </div>

      {/* Lista / edição */}
      <div className="bg-white rounded-xl p-4 shadow">
        <h2 className="font-medium mb-3">Janelas de AULA (todos os dias)</h2>

        {regrasOrdenadas.length > 0 ? (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 pr-3">Início</th>
                  <th className="py-2 pr-3">Fim</th>
                  <th className="py-2 pr-3">Ativo</th>
                  <th className="py-2 pr-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {regrasOrdenadas.map((r) => (
                  <EditableRow
                    key={r.id}
                    regra={r}
                    onChange={(reg) =>
                      setRegras((prev) => prev.map((x) => (x.id === reg.id ? reg : x)))
                    }
                    onSave={salvarEdicao}
                    onDelete={remover}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Nenhuma janela de AULA configurada para este esporte.</p>
        )}
      </div>
    </div>
  );
}

/** ====== Row editável (hora cheia) ====== */
function EditableRow({
  regra,
  onChange,
  onSave,
  onDelete,
}: {
  regra: Regra;
  onChange: (r: Regra) => void;
  onSave: (r: Regra) => void;
  onDelete: (r: Regra) => void;
}) {
  const [local, setLocal] = useState<Regra>(regra);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLocal(regra);
    setDirty(false);
  }, [regra.id]);

  function upd<K extends keyof Regra>(k: K, v: Regra[K]) {
    setLocal((p) => ({ ...p, [k]: v }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(local);
      onChange(local);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t">
      <td className="py-2 pr-3">
        <select
          className="border rounded px-2 py-1"
          value={hhOf(local.inicioHHMM)}
          onChange={(e) => upd("inicioHHMM", HH_TO_HHMM(e.target.value))}
        >
          {HHS.map((h) => (
            <option key={h} value={h}>
              {h}:00
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-3">
        <select
          className="border rounded px-2 py-1"
          value={hhOf(local.fimHHMM)}
          onChange={(e) => upd("fimHHMM", HH_TO_HHMM(e.target.value))}
        >
          {HHS.map((h) => (
            <option key={h} value={h}>
              {h}:00
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-3">
        <input
          type="checkbox"
          checked={local.ativo}
          onChange={(e) => upd("ativo", e.target.checked)}
        />
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-black text-white text-xs hover:bg-gray-900 disabled:opacity-60"
            onClick={handleSave}
            disabled={saving || !dirty}
            title={dirty ? "Salvar alterações" : "Nada para salvar"}
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
          <button
            className="px-3 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700"
            onClick={() => onDelete(local)}
          >
            Remover
          </button>
        </div>
      </td>
    </tr>
  );
}
