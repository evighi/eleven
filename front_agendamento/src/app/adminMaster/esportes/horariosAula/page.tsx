"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuthStore } from "@/context/AuthStore";

/** ====== CONSTS / TYPES ====== */
const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

type Dia =
  | "DOMINGO" | "SEGUNDA" | "TERCA" | "QUARTA" | "QUINTA" | "SEXTA" | "SABADO";
type TipoSessao = "AULA" | "JOGO";

type Regra = {
  id?: string;
  esporteId: string;
  esporteNome?: string | null;
  diaSemana: Dia | null;           // null = PADRÃO
  tipoSessao: TipoSessao;
  inicioHHMM: string;              // "HH:mm"
  fimHHMM: string;                 // "HH:mm"
  ativo: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type Esporte = { id: string; nome: string };

/** ====== HELPERS ====== */
const DIAS_UI: (Dia | "PADRAO")[] = [
  "PADRAO", "DOMINGO","SEGUNDA","TERCA","QUARTA","QUINTA","SEXTA","SABADO"
];

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

/** ====== PAGE ====== */
export default function ConfigHorariosEsportesPage() {
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

  // estado do formulário de criação rápida
  const [novo, setNovo] = useState<Regra>({
    esporteId: "",
    diaSemana: null,         // PADRÃO por default
    tipoSessao: "AULA",
    inicioHHMM: "06:00",
    fimHHMM: "19:00",
    ativo: true,
  });

  useEffect(() => {
    (async () => {
      try {
        // lista esportes
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
    if (!esporteId) return;
    carregarRegras(esporteId);
  }, [esporteId]);

  async function carregarRegras(id: string) {
    try {
      setLoading(true);
      const r = await axios.get(`${API_URL}/config/esporte-horarios/${id}`, {
        withCredentials: true,
      });
      const items: Regra[] = (r.data || []).map((x: any) => ({
        id: x.id,
        esporteId: x.esporteId,
        esporteNome: x.esporteNome ?? null,
        diaSemana: x.diaSemana,
        tipoSessao: x.tipoSessao,
        inicioHHMM: x.inicioHHMM,
        fimHHMM: x.fimHHMM,
        ativo: !!x.ativo,
        createdAt: x.createdAt,
        updatedAt: x.updatedAt,
      }));
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
        diaSemana: novo.diaSemana,          // null = padrão (o back entende)
        tipoSessao: novo.tipoSessao,
        inicioHHMM: ini,
        fimHHMM: fim,
        ativo: novo.ativo,
      };
      await axios.post(`${API_URL}/config/esporte-horarios`, payload, {
        withCredentials: true,
      });
      await carregarRegras(novo.esporteId);
      // reseta o formulário mantendo esporte e dia
      setNovo((p) => ({ ...p, inicioHHMM: "06:00", fimHHMM: "19:00", tipoSessao: "AULA", ativo: true }));
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
      const body: any = {
        esporteId: r.esporteId,
        diaSemana: r.diaSemana,     // pode ser null (padrão)
        tipoSessao: r.tipoSessao,
        inicioHHMM: ini,
        fimHHMM: fim,
        ativo: r.ativo,
      };
      await axios.put(`${API_URL}/config/esporte-horarios/${r.id}`, body, {
        withCredentials: true,
      });
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
      await axios.delete(`${API_URL}/config/esporte-horarios/${r.id}`, {
        withCredentials: true,
      });
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

  const regrasAgrupadas = useMemo(() => {
    const map = new Map<(Dia | "PADRAO"), Regra[]>();
    for (const key of DIAS_UI) map.set(key, []);
    for (const r of regras) {
      const k = (r.diaSemana ?? "PADRAO") as Dia | "PADRAO";
      map.get(k)!.push(r);
    }
    // ordena por tipo (AULA/JOGO) e início
    for (const [k, arr] of map) {
      arr.sort((a, b) => {
        if (a.tipoSessao !== b.tipoSessao) return a.tipoSessao.localeCompare(b.tipoSessao);
        return a.inicioHHMM.localeCompare(b.inicioHHMM);
      });
      map.set(k, arr);
    }
    return map;
  }, [regras]);

  if (!isAdmin) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Configurar horários por esporte</h1>
        <p className="text-red-600 mt-2">Acesso permitido apenas para administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Configurar horários de AULA/JOGO</h1>
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
              <option value={e.id} key={e.id}>{e.nome}</option>
            ))}
          </select>
        </div>
        {loading && <span className="text-sm text-gray-500">Carregando…</span>}
      </div>

      {/* Criar nova regra */}
      <div className="bg-white rounded-xl p-4 shadow">
        <h2 className="font-medium mb-3">Nova regra</h2>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-3">
            <label className="block text-xs mb-1">Dia</label>
            <select
              className="w-full border rounded px-2 py-2"
              value={novo.diaSemana ?? "PADRAO"}
              onChange={(e) =>
                onChangeNovo("diaSemana", e.target.value === "PADRAO" ? null : (e.target.value as Dia))
              }
            >
              {DIAS_UI.map((d) => (
                <option key={d} value={d}>{d === "PADRAO" ? "PADRÃO (todos os dias)" : d}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs mb-1">Tipo</label>
            <select
              className="w-full border rounded px-2 py-2"
              value={novo.tipoSessao}
              onChange={(e) => onChangeNovo("tipoSessao", e.target.value as TipoSessao)}
            >
              <option value="AULA">AULA</option>
              <option value="JOGO">JOGO</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs mb-1">Início</label>
            <input
              type="time"
              step={60}
              className="w-full border rounded px-2 py-2"
              value={novo.inicioHHMM}
              onChange={(e) => onChangeNovo("inicioHHMM", e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs mb-1">Fim</label>
            <input
              type="time"
              step={60}
              className="w-full border rounded px-2 py-2"
              value={novo.fimHHMM}
              onChange={(e) => onChangeNovo("fimHHMM", e.target.value)}
            />
          </div>

          <div className="sm:col-span-2 flex items-end gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={novo.ativo}
                onChange={(e) => onChangeNovo("ativo", e.target.checked)}
              />
              Ativo
            </label>
          </div>

          <div className="sm:col-span-1 flex items-end">
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

      {/* Lista/edição das regras */}
      <div className="bg-white rounded-xl p-4 shadow">
        <h2 className="font-medium mb-3">Regras do esporte</h2>

        {DIAS_UI.map((dKey) => {
          const group = regrasAgrupadas.get(dKey) || [];
          if (!group.length) return null;

          return (
            <div key={dKey} className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-sm font-semibold text-gray-800">
                  {dKey === "PADRAO" ? "PADRÃO (aplica a todos os dias)" : dKey}
                </h3>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-3">Tipo</th>
                      <th className="py-2 pr-3">Início</th>
                      <th className="py-2 pr-3">Fim</th>
                      <th className="py-2 pr-3">Ativo</th>
                      <th className="py-2 pr-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((r) => (
                      <EditableRow
                        key={r.id}
                        regra={r}
                        onChange={(reg) =>
                          setRegras((prev) =>
                            prev.map((x) => (x.id === reg.id ? reg : x))
                          )
                        }
                        onSave={salvarEdicao}
                        onDelete={remover}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {!regras.length && (
          <p className="text-sm text-gray-500">Nenhuma regra configurada para este esporte.</p>
        )}
      </div>
    </div>
  );
}

/** ====== Row editável ====== */
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
  }, [regra.id]); // troca de item reseta estado

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
          value={local.tipoSessao}
          onChange={(e) => upd("tipoSessao", e.target.value as TipoSessao)}
        >
          <option value="AULA">AULA</option>
          <option value="JOGO">JOGO</option>
        </select>
      </td>
      <td className="py-2 pr-3">
        <input
          type="time"
          step={60}
          className="border rounded px-2 py-1"
          value={local.inicioHHMM}
          onChange={(e) => upd("inicioHHMM", e.target.value)}
        />
      </td>
      <td className="py-2 pr-3">
        <input
          type="time"
          step={60}
          className="border rounded px-2 py-1"
          value={local.fimHHMM}
          onChange={(e) => upd("fimHHMM", e.target.value)}
        />
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
