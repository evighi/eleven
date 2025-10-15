'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import Spinner from '@/components/Spinner' // ✅ usa seu Spinner

interface Usuario {
  id: string
  nome: string
  email: string
  celular: string | null
  nascimento: string | null
  cpf: string | null
  tipo: string
  valorQuadra?: number | string | null // ⬅️ novo (vem do back)
}

const tipos = ["CLIENTE", "ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"]

// Collator para ordenar sem diferenciar acentos/maiúsculas
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true })

// fallback para celular
const mostrarCelular = (cel?: string | null) =>
  (cel && cel.trim().length > 0) ? cel : '00000000000'

// Helpers de moeda (BRL)
const onlyDigits = (s: string) => s.replace(/\D+/g, '')
const brToNumber = (s: string) => {
  // aceita "123,45" ou "123.45" ou "12345"
  const clean = s.trim().replace(/\./g, '').replace(',', '.')
  const n = Number(clean)
  return Number.isFinite(n) ? n : NaN
}
const numberToBR = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// YYYY-MM-DD <- data ISO curta para <input type="date">
const toDateInputValue = (isoOrNull: string | null) => {
  if (!isoOrNull) return ''
  const [y, m, d] = isoOrNull.split('T')[0].split('-')
  return `${y}-${m}-${d}`
}

export default function UsuariosAdmin() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null)

  // 🔧 modo de edição e estado dos campos editáveis
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState({
    nome: '',
    email: '',
    celular: '',
    nascimento: '', // yyyy-mm-dd
    cpf: '',
    tipo: '' as Usuario['tipo'],
  })

  // 🔸 campo visual para valor (string formatada) + erro
  const [valorQuadraStr, setValorQuadraStr] = useState('')
  const [valorErro, setValorErro] = useState<string>('')

  // ✅ estados de carregamento
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

  const carregarUsuarios = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/usuariosAdmin`, {
        params: { nome: busca || undefined, tipo: filtroTipo || undefined },
        withCredentials: true,
      })
      const lista: Usuario[] = Array.isArray(res.data) ? res.data : []
      lista.sort((a, b) => collator.compare(a?.nome ?? '', b?.nome ?? ''))
      setUsuarios(lista)
    } catch (err) {
      console.error(err)
      setUsuarios([])
    } finally {
      setLoading(false)
    }
  }, [API_URL, busca, filtroTipo])

  useEffect(() => {
    const delay = setTimeout(() => { void carregarUsuarios() }, 300)
    return () => clearTimeout(delay)
  }, [carregarUsuarios])

  // quando abre a aba de edição, preenche o valor/tipo e os campos do form
  useEffect(() => {
    if (!usuarioSelecionado) {
      setEditMode(false)
      setForm({ nome: '', email: '', celular: '', nascimento: '', cpf: '', tipo: '' as any })
      setValorQuadraStr('')
      setValorErro('')
      return
    }

    // preencher form com dados atuais
    setForm({
      nome: usuarioSelecionado.nome ?? '',
      email: usuarioSelecionado.email ?? '',
      celular: usuarioSelecionado.celular ?? '',
      nascimento: toDateInputValue(usuarioSelecionado.nascimento),
      cpf: usuarioSelecionado.cpf ?? '',
      tipo: usuarioSelecionado.tipo,
    })

    // valor de professor
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
    setEditMode(false) // entra visualizando; clica em "Editar" para liberar
  }, [usuarioSelecionado])

  // máscara leve: digita só números, montamos centavos
  const handleValorChange = (raw: string) => {
    setValorErro('')
    const digits = onlyDigits(raw)
    if (!digits) {
      setValorQuadraStr('')
      return
    }
    const cents = digits.padStart(3, '0') // garante pelo menos 0,0X
    const intPart = cents.slice(0, -2)
    const fracPart = cents.slice(-2)
    const intFmt = Number(intPart).toLocaleString('pt-BR')
    setValorQuadraStr(`${intFmt},${fracPart}`)
  }

  const mostrarCampoProfessor = form.tipo === 'ADMIN_PROFESSORES'

  // calcula o payload com apenas campos alterados
  const diffPayload = useMemo(() => {
    if (!usuarioSelecionado) return {}

    const base: Record<string, any> = {}

    if (form.nome !== (usuarioSelecionado.nome ?? '')) base.nome = form.nome
    if (form.email !== (usuarioSelecionado.email ?? '')) base.email = form.email
    if ((form.celular || '') !== (usuarioSelecionado.celular || '')) base.celular = form.celular || null
    // nascimento vindo do input date
    const nascOriginal = toDateInputValue(usuarioSelecionado.nascimento)
    if ((form.nascimento || '') !== (nascOriginal || '')) {
      base.nascimento = form.nascimento ? new Date(form.nascimento) : null
    }
    if ((form.cpf || '') !== (usuarioSelecionado.cpf || '')) base.cpf = form.cpf || null
    if (form.tipo !== usuarioSelecionado.tipo) base.tipo = form.tipo

    // valor do professor
    if (form.tipo === 'ADMIN_PROFESSORES') {
      // se mudou o tipo para professor ou alterou o valor
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
        // se limpou o valor e já era professor antes
        base.valorQuadra = null
      }
    } else {
      // se deixou de ser professor e havia valor
      if (usuarioSelecionado.tipo === 'ADMIN_PROFESSORES' && usuarioSelecionado.valorQuadra != null) {
        base.valorQuadra = null
      }
    }

    return base
  }, [usuarioSelecionado, form, valorQuadraStr])

  const salvarEdicao = async () => {
    if (!usuarioSelecionado) return

    // valida valor quando tipo = professor
    if (form.tipo === 'ADMIN_PROFESSORES') {
      const n = brToNumber(valorQuadraStr || '0')
      if (!Number.isFinite(n) || n < 0.01) {
        setValorErro('Para professor, informe um valor maior ou igual a R$ 0,01.')
        return
      }
    }

    // nada mudou?
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

  const formatarData = (data: string | null) => {
    if (!data) return '-'
    const [ano, mes, dia] = data.split('T')[0].split('-')
    return `${dia}/${mes}/${ano}`
  }

  return (
    <div className="max-w-4xl mx-auto mt-10 p-6 bg-white rounded shadow">
      <h1 className="text-2xl font-medium mb-4">Gerenciar Usuários Cadastrados no Sistema</h1>

      <div className="flex gap-4 mb-4 items-end">
        {/* Filtro por nome */}
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

        {/* Filtro por tipo */}
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

      {/* Linha de status de carregamento */}
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
            {/* Linha do usuário */}
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
              <span className="italic">{u.tipo}</span>
            </div>

            {/* Aba de edição */}
            {usuarioSelecionado?.id === u.id && (
              <div className="p-4 border-t bg-gray-50">
                <h2 className="font-bold mb-3">Editar Usuário</h2>

                {/* Campos */}
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

                  {/* Valor por aula quando professor */}
                  {form.tipo === 'ADMIN_PROFESSORES' && (
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

                {/* Ações */}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={salvarEdicao}
                    disabled={saving}
                    className="bg-green-600 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60 flex items-center gap-2"
                  >
                    {saving && <Spinner size="w-4 h-4" />}
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>

                  {/* ⬅️ Botão Editar ao lado do Salvar */}
                  <button
                    onClick={() => setEditMode((v) => !v)}
                    disabled={saving}
                    className={`px-4 py-2 rounded cursor-pointer disabled:opacity-60 ${editMode ? 'bg-orange-600 text-white' : 'bg-orange-600 text-white'}`}
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
                </div>

                {/* Diferenças (debug opcional) */}
                {/* <pre className="text-xs mt-3">{JSON.stringify(diffPayload, null, 2)}</pre> */}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
