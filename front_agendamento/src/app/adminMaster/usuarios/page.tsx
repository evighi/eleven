'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import Spinner from '@/components/Spinner'
import { useRouter } from 'next/navigation'

interface Usuario {
  id: string
  nome: string
  email: string
  celular: string | null
  nascimento: string | null
  cpf: string | null
  tipo: string
  valorQuadra?: number | string | null
}

const tipos = ["CLIENTE", "CLIENTE_APOIADO", "ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"]

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true })

const mostrarCelular = (cel?: string | null) =>
  (cel && cel.trim().length > 0) ? cel : '00000000000'

const onlyDigits = (s: string) => s.replace(/\D+/g, '')
const brToNumber = (s: string) => {
  const clean = s.trim().replace(/\./g, '').replace(',', '.')
  const n = Number(clean)
  return Number.isFinite(n) ? n : NaN
}
const numberToBR = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const toDateInputValue = (isoOrNull: string | null) => {
  if (!isoOrNull) return ''
  const [y, m, d] = isoOrNull.split('T')[0].split('-')
  return `${y}-${m}-${d}`
}

/* ============================
   Tipagens do fluxo de exclusão
   ============================ */
type QueueLastInteraction =
  | {
      type: "AG_COMUM";
      id: string;
      resumo: {
        data: string;
        horario: string;
        status: string;
        quadra?: { id: string; nome: string | null; numero: number | null } | null;
        esporte?: { id: string; nome: string | null } | null;
      };
    }
  | {
      type: "AG_PERM";
      id: string;
      resumo: {
        diaSemana: string;
        horario: string;
        status: string;
        updatedAt: string;
        quadra?: { id: string; nome: string | null; numero: number | null } | null;
        esporte?: { id: string; nome: string | null } | null;
      };
    }
  | {
      type: "CHURRAS";
      id: string;
      resumo: {
        data: string;
        turno: "DIA" | "NOITE";
        status: string;
        churrasqueira?: { id: string; nome: string | null; numero: number | null } | null;
      };
    };

type Delete202Queued = {
  mensagem?: string;
  eligibleAt: string; // ISO
  lastInteraction?: QueueLastInteraction | null;
};

type Delete409HasConfirmed = {
  code?: "HAS_CONFIRMED";
  message?: string;
  details?: {
    agendamentos?: Array<{
      tipo: "AG_COMUM" | "AG_PERM" | "CHURRAS";
      id: string;
      quando?: string;
    }>;
  };
};

const fmtDateTimeBR = (iso?: string | null) => {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    const dd = d.toLocaleDateString('pt-BR')
    const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return `${dd} ${hh}`
  } catch {
    return iso!
  }
}

const tipoInteracaoLabel = (t?: string) => {
  if (t === 'AG_COMUM') return 'Agendamento comum (quadra)'
  if (t === 'AG_PERM') return 'Agendamento permanente (quadra)'
  if (t === 'CHURRAS') return 'Churrasqueira'
  return 'Interação'
}

export default function UsuariosAdmin() {
  const router = useRouter()

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [totalUsuarios, setTotalUsuarios] = useState<number | null>(null) // 👈 total vindo do back

  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null)

  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState({
    nome: '',
    email: '',
    celular: '',
    nascimento: '',
    cpf: '',
    tipo: '' as Usuario['tipo'],
  })

  const [valorQuadraStr, setValorQuadraStr] = useState('')
  const [valorErro, setValorErro] = useState<string>('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // fluxo exclusão
  const [abrirConfirmarExclusao, setAbrirConfirmarExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [resultadoExclusao204, setResultadoExclusao204] = useState<boolean>(false)
  const [resultadoExclusao202, setResultadoExclusao202] = useState<Delete202Queued | null>(null)
  const [resultadoExclusao409, setResultadoExclusao409] = useState<Delete409HasConfirmed | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

  const carregarUsuarios = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/usuariosAdmin`, {
        params: { nome: busca || undefined, tipos: filtroTipo || undefined },
        withCredentials: true,
      })

      // back agora retorna { total, usuarios }
      if (Array.isArray(res.data)) {
        // fallback se por acaso o back ainda estiver antigo
        const lista: Usuario[] = res.data
        lista.sort((a, b) => collator.compare(a?.nome ?? '', b?.nome ?? ''))
        setUsuarios(lista)
        setTotalUsuarios(lista.length)
      } else {
        const { usuarios, total } = res.data as { usuarios: Usuario[]; total: number }
        const lista = Array.isArray(usuarios) ? usuarios.slice() : []
        lista.sort((a, b) => collator.compare(a?.nome ?? '', b?.nome ?? ''))
        setUsuarios(lista)
        setTotalUsuarios(total ?? lista.length)
      }
    } catch (err) {
      console.error(err)
      setUsuarios([])
      setTotalUsuarios(0)
    } finally {
      setLoading(false)
    }
  }, [API_URL, busca, filtroTipo])

  useEffect(() => {
    const delay = setTimeout(() => { void carregarUsuarios() }, 300)
    return () => clearTimeout(delay)
  }, [carregarUsuarios])

  useEffect(() => {
    if (!usuarioSelecionado) {
      setEditMode(false)
      setForm({ nome: '', email: '', celular: '', nascimento: '', cpf: '', tipo: '' as any })
      setValorQuadraStr('')
      setValorErro('')
      return
    }

    setForm({
      nome: usuarioSelecionado.nome ?? '',
      email: usuarioSelecionado.email ?? '',
      celular: usuarioSelecionado.celular ?? '',
      nascimento: toDateInputValue(usuarioSelecionado.nascimento),
      cpf: usuarioSelecionado.cpf ?? '',
      tipo: usuarioSelecionado.tipo,
    })

    const ehProf = usuarioSelecionado.tipo === 'ADMIN_PROFESSORES'
    const v = usuarioSelecionado.valorQuadra
    if (ehProf && v != null && v !== '') {
      const num = typeof v === 'string' ? brToNumber(v) : Number(v)
      if (Number.isFinite(num)) setValorQuadraStr(numberToBR(num))
      else setValorQuadraStr('')
    } else {
      setValorQuadraStr('')
    }
    setValorErro('')
    setEditMode(false)
  }, [usuarioSelecionado])

  const handleValorChange = (raw: string) => {
    setValorErro('')
    const digits = onlyDigits(raw)
    if (!digits) {
      setValorQuadraStr('')
      return
    }
    const cents = digits.padStart(3, '0')
    const intPart = cents.slice(0, -2)
    const fracPart = cents.slice(-2)
    const intFmt = Number(intPart).toLocaleString('pt-BR')
    setValorQuadraStr(`${intFmt},${fracPart}`)
  }

  const mostrarCampoProfessor = form.tipo === 'ADMIN_PROFESSORES'

  const diffPayload = useMemo(() => {
    if (!usuarioSelecionado) return {}

    const base: Record<string, any> = {}

    if (form.nome !== (usuarioSelecionado.nome ?? '')) base.nome = form.nome
    if (form.email !== (usuarioSelecionado.email ?? '')) base.email = form.email
    if ((form.celular || '') !== (usuarioSelecionado.celular || '')) base.celular = form.celular || null

    const nascOriginal = toDateInputValue(usuarioSelecionado.nascimento)
    if ((form.nascimento || '') !== (nascOriginal || '')) {
      base.nascimento = form.nascimento ? new Date(form.nascimento) : null
    }
    if ((form.cpf || '') !== (usuarioSelecionado.cpf || '')) base.cpf = form.cpf || null
    if (form.tipo !== usuarioSelecionado.tipo) base.tipo = form.tipo

    if (form.tipo === 'ADMIN_PROFESSORES') {
      const originalNum = (() => {
        const v = usuarioSelecionado.valorQuadra
        if (v == null || v === '') return null
        return typeof v === 'string' ? brToNumber(v) : Number(v)
      })()
      const novoNum = valorQuadraStr ? brToNumber(valorQuadraStr) : NaN

      if (Number.isFinite(novoNum)) {
        const arred = Number((novoNum).toFixed(2))
        if (originalNum == null || Math.abs(arred - Number(originalNum)) > 0.0001) {
          base.valorQuadra = arred
        }
      } else if (usuarioSelecionado.tipo === 'ADMIN_PROFESSORES' && !valorQuadraStr) {
        base.valorQuadra = null
      }
    } else {
      if (usuarioSelecionado.tipo === 'ADMIN_PROFESSORES' && usuarioSelecionado.valorQuadra != null) {
        base.valorQuadra = null
      }
    }

    return base
  }, [usuarioSelecionado, form, valorQuadraStr])

  const salvarEdicao = async () => {
    if (!usuarioSelecionado) return

    if (form.tipo === 'ADMIN_PROFESSORES') {
      const n = brToNumber(valorQuadraStr || '0')
      if (!Number.isFinite(n) || n < 0.01) {
        setValorErro('Para professor, informe um valor maior ou igual a R$ 0,01.')
        return
      }
    }

    if (Object.keys(diffPayload).length === 0) {
      alert('Nenhuma alteração para salvar.')
      return
    }

    setSaving(true)
    try {
      await axios.put(`${API_URL}/usuarios/${usuarioSelecionado.id}`, diffPayload, {
        withCredentials: true,
      })
      alert('Usuário atualizado com sucesso!')
      setUsuarioSelecionado(null)
      setEditMode(false)
      void carregarUsuarios()
    } catch (err: any) {
      console.error(err)
      const msg = err?.response?.data?.erro || 'Erro ao atualizar usuário'
      alert(msg)
    } finally {
      setSaving(false)
    }
  }

  /* ============================
     Fluxo de exclusão
     ============================ */
  const abrirConfirmacaoExcluir = () => {
    if (!usuarioSelecionado) return
    setResultadoExclusao204(false)
    setResultadoExclusao202(null)
    setResultadoExclusao409(null)
    setAbrirConfirmarExclusao(true)
  }

  const confirmarExcluirUsuario = async () => {
    if (!usuarioSelecionado) return
    setAbrirConfirmarExclusao(false)
    setExcluindo(true)
    try {
      const resp = await axios.delete(`${API_URL}/clientes/${usuarioSelecionado.id}`, {
        withCredentials: true,
        validateStatus: () => true,
      })

      if (resp.status === 204) {
        setResultadoExclusao204(true)
        await carregarUsuarios()
        setUsuarioSelecionado(null)
      } else if (resp.status === 202) {
        setResultadoExclusao202(resp.data as Delete202Queued)
        await carregarUsuarios()
      } else if (resp.status === 409) {
        setResultadoExclusao409(resp.data as Delete409HasConfirmed)
      } else {
        const msg =
          (resp.data && (resp.data.erro || resp.data.message)) ||
          `Falha ao excluir (HTTP ${resp.status})`
        alert(msg)
      }
    } catch (e) {
      console.error(e)
      alert('Erro ao excluir usuário.')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto mt-10 p-6 bg-white rounded shadow">
      <h1 className="text-2xl font-medium mb-2">Gerenciar Usuários Cadastrados no Sistema</h1>

      {/* 👇 linha com o total */}
      {totalUsuarios !== null && (
        <p className="text-sm text-gray-700 mb-3">
          Total de usuários cadastrados (sem convidados):{' '}
          <span className="font-semibold">{totalUsuarios}</span>
        </p>
      )}

      <div className="flex gap-4 mb-4 items-end">
        <div className="flex-1 flex flex-col">
          <label className="font-medium mb-1">Buscar por nome</label>
          <input
            type="text"
            placeholder="Digite o nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="p-2 border rounded w-full"
          />
        </div>

        <div className="flex flex-col w-60">
          <label className="font-medium mb-1">Filtrar por tipo de cadastro</label>
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="p-2 border rounded cursor-pointer w-full"
          >
            <option value="">Todos os tipos</option>
            {tipos.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-600 mb-3">
          <Spinner /> <span>Carregando usuários…</span>
        </div>
      )}

      <ul className="border rounded divide-y">
        {!loading && usuarios.length === 0 && (
          <li className="p-4 text-sm text-gray-600">Nenhum usuário encontrado.</li>
        )}

        {usuarios.map((u) => (
          <li key={u.id}>
            <div
              className="p-3 hover:bg-gray-100 cursor-pointer"
              onClick={() => {
                if (usuarioSelecionado?.id === u.id) {
                  setUsuarioSelecionado(null)
                } else {
                  setUsuarioSelecionado(u)
                }
              }}
            >
              <strong>{u.nome}</strong> — {mostrarCelular(u.celular)} —{' '}
              <span
                className={`italic px-2 py-[2px] rounded text-xs
                  ${u.tipo === 'CLIENTE_APOIADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}
                `}
              >
                {u.tipo}
              </span>
            </div>

            {usuarioSelecionado?.id === u.id && (
              <div className="p-4 border-t bg-gray-50">
                <h2 className="font-bold mb-3">Editar Usuário</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Nome</label>
                    <input
                      type="text"
                      value={form.nome}
                      onChange={(e) => setForm(f => ({ ...f, nome: e.target.value }))}
                      className="w-full p-2 border rounded"
                      disabled={!editMode || saving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">E-mail</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full p-2 border rounded"
                      disabled={!editMode || saving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Celular</label>
                    <input
                      type="text"
                      value={form.celular}
                      onChange={(e) => setForm(f => ({ ...f, celular: e.target.value }))}
                      className="w-full p-2 border rounded"
                      disabled={!editMode || saving}
                      placeholder="Somente dígitos (ex.: 53999999999)"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Data de Nascimento</label>
                    <input
                      type="date"
                      value={form.nascimento}
                      onChange={(e) => setForm(f => ({ ...f, nascimento: e.target.value }))}
                      className="w-full p-2 border rounded"
                      disabled={!editMode || saving}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">CPF</label>
                    <input
                      type="text"
                      value={form.cpf}
                      onChange={(e) => setForm(f => ({ ...f, cpf: e.target.value }))}
                      className="w-full p-2 border rounded"
                      disabled={!editMode || saving}
                      placeholder="Somente dígitos"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Tipo de Usuário</label>
                    <select
                      className="w-full p-2 border rounded cursor-pointer"
                      value={form.tipo}
                      onChange={(e) => {
                        const v = e.target.value
                        setForm(f => ({ ...f, tipo: v }))
                        if (v !== 'ADMIN_PROFESSORES') {
                          setValorErro('')
                        }
                      }}
                      disabled={!editMode || saving}
                    >
                      {tipos.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {mostrarCampoProfessor && (
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium mb-1">Valor cobrado (por aula)</label>
                      <div className="flex items-stretch rounded-lg border overflow-hidden bg-white">
                        <span className="px-3 py-2 text-sm font-semibold bg-gray-100 text-gray-700 select-none">R$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0,00"
                          value={valorQuadraStr}
                          onChange={(e) => handleValorChange(e.target.value)}
                          className="flex-1 px-3 py-2 text-sm outline-none"
                          disabled={!editMode || saving}
                        />
                      </div>
                      {valorErro && (
                        <p className="mt-1 text-xs text-red-600">{valorErro}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={salvarEdicao}
                    disabled={saving}
                    className="bg-green-600 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60 flex items-center gap-2"
                  >
                    {saving && <Spinner size="w-4 h-4" />}
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>

                  <button
                    onClick={() => setEditMode((v) => !v)}
                    disabled={saving}
                    className="px-4 py-2 rounded cursor-pointer disabled:opacity-60 bg-orange-600 text-white"
                  >
                    {editMode ? 'Bloquear Edição' : 'Editar'}
                  </button>

                  <button
                    onClick={() => setUsuarioSelecionado(null)}
                    disabled={saving}
                    className="bg-gray-400 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
                  >
                    Cancelar
                  </button>

                  <button
                    onClick={abrirConfirmacaoExcluir}
                    disabled={saving}
                    className="bg-red-600 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
                    title="Excluir usuário (segue regra de 90 dias e pendências)"
                  >
                    Excluir usuário
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Confirmar exclusão */}
      {abrirConfirmarExclusao && usuarioSelecionado && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
          <div className="bg-white p-5 rounded-lg shadow-lg w-[360px]">
            <h3 className="text-lg font-semibold mb-3">Excluir usuário</h3>
            <p className="text-sm text-gray-700 mb-4">
              Deseja excluir <b>{usuarioSelecionado.nome}</b>?<br />
              A ação seguirá as regras (agendamentos confirmados e janela de 90 dias).
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAbrirConfirmarExclusao(false)}
                disabled={excluindo}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Não
              </button>
              <button
                onClick={confirmarExcluirUsuario}
                disabled={excluindo}
                className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {excluindo ? 'Excluindo…' : 'Sim, excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excluído agora (204) */}
      {resultadoExclusao204 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
          <div className="bg-white p-5 rounded-lg shadow-lg w-[340px]">
            <h3 className="text-lg font-semibold mb-3">Usuário excluído</h3>
            <p className="text-sm text-gray-700 mb-4">
              O usuário foi excluído com sucesso.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setResultadoExclusao204(false)}
                className="px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exclusão pendente (202) */}
      {resultadoExclusao202 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
          <div className="bg-white p-5 rounded-lg shadow-lg w-[420px] max-w-[95vw]">
            <h3 className="text-lg font-semibold mb-3">Exclusão agendada</h3>
            <p className="text-sm text-gray-700">
              O usuário foi marcado como <b>pendente de exclusão</b> e já está com o acesso bloqueado.
            </p>

            <div className="mt-3 text-sm">
              <p><b>Elegível em:</b> {fmtDateTimeBR(resultadoExclusao202.eligibleAt)}</p>
              {resultadoExclusao202.lastInteraction && (
                <div className="mt-2 border rounded p-2 bg-gray-50">
                  <p className="font-semibold mb-1">
                    Última interação: {tipoInteracaoLabel(resultadoExclusao202.lastInteraction.type)}
                  </p>

                  {resultadoExclusao202.lastInteraction.type === "AG_COMUM" && (
                    <ul className="text-xs space-y-1">
                      <li>ID: {resultadoExclusao202.lastInteraction.id}</li>
                      <li>
                        Data/Hora: {fmtDateTimeBR(resultadoExclusao202.lastInteraction.resumo.data)}{" "}
                        {resultadoExclusao202.lastInteraction.resumo.horario || ""}
                      </li>
                      <li>Status: {resultadoExclusao202.lastInteraction.resumo.status}</li>
                    </ul>
                  )}

                  {resultadoExclusao202.lastInteraction.type === "AG_PERM" && (
                    <ul className="text-xs space-y-1">
                      <li>ID: {resultadoExclusao202.lastInteraction.id}</li>
                      <li>
                        Dia/Horário: {resultadoExclusao202.lastInteraction.resumo.diaSemana}{" "}
                        {resultadoExclusao202.lastInteraction.resumo.horario}
                      </li>
                      <li>Status: {resultadoExclusao202.lastInteraction.resumo.status}</li>
                      <li>
                        Atualizado em: {fmtDateTimeBR(resultadoExclusao202.lastInteraction.resumo.updatedAt)}
                      </li>
                    </ul>
                  )}

                  {resultadoExclusao202.lastInteraction.type === "CHURRAS" && (
                    <ul className="text-xs space-y-1">
                      <li>ID: {resultadoExclusao202.lastInteraction.id}</li>
                      <li>
                        Data/Turno: {fmtDateTimeBR(resultadoExclusao202.lastInteraction.resumo.data)}{" "}
                        ({resultadoExclusao202.lastInteraction.resumo.turno})
                      </li>
                      <li>Status: {resultadoExclusao202.lastInteraction.resumo.status}</li>
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => {
                  setResultadoExclusao202(null)
                  router.push('/adminMaster/pendencias')
                }}
                className="px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Impedido (409) */}
      {resultadoExclusao409 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
          <div className="bg-white p-5 rounded-lg shadow-lg w-[420px] max-w-[95vw]">
            <h3 className="text-lg font-semibold mb-3">Não é possível excluir</h3>
            <p className="text-sm text-gray-700">
              {resultadoExclusao409.message || 'Existem agendamentos confirmados/futuros vinculados.'}
            </p>

            {resultadoExclusao409.details?.agendamentos?.length ? (
              <div className="mt-3">
                <p className="text-sm font-semibold">Agendamentos impedindo a exclusão:</p>
                <ul className="mt-1 text-xs list-disc list-inside space-y-1">
                  {resultadoExclusao409.details.agendamentos.map((a, i) => (
                    <li key={`${a.id}-${i}`}>
                      {tipoInteracaoLabel(a.tipo)} — ID {a.id}
                      {a.quando ? ` — ${fmtDateTimeBR(a.quando)}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setResultadoExclusao409(null)}
                className="px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
