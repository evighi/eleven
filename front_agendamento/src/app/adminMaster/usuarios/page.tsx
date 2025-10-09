'use client'

import { useCallback, useEffect, useState } from 'react'
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

export default function UsuariosAdmin() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null)
  const [novoTipo, setNovoTipo] = useState('')

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

  // quando abre a aba de edição, preenche o valor (se já for professor e tiver valor)
  useEffect(() => {
    if (!usuarioSelecionado) return
    const ehProf = usuarioSelecionado.tipo === 'ADMIN_PROFESSORES'
    const v = usuarioSelecionado.valorQuadra
    if (ehProf && v != null && v !== '') {
      const num = typeof v === 'string' ? brToNumber(v) : Number(v)
      if (Number.isFinite(num)) setValorQuadraStr(numberToBR(num))
    } else {
      setValorQuadraStr('')
    }
    setValorErro('')
  }, [usuarioSelecionado])

  // máscara leve: digita só números, montamos centavos
  const handleValorChange = (raw: string) => {
    setValorErro('')
    // aceita digitação livre, mas vamos normalizar para BR com 2 casas
    // estratégia: manter só dígitos e inserir vírgula para 2 casas
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

  const salvarTipo = async () => {
    if (!usuarioSelecionado) return
    setSaving(true)
    try {
      // valida se for professor
      let payload: any = { tipo: novoTipo }

      if (novoTipo === 'ADMIN_PROFESSORES') {
        const n = brToNumber(valorQuadraStr)
        if (!Number.isFinite(n) || n < 0) {
          setValorErro('Informe um valor válido (ex.: 120,00).')
          setSaving(false)
          return
        }
        payload.valorQuadra = n
      }

      await axios.put(
        `${API_URL}/usuariosAdmin/${usuarioSelecionado.id}/tipo`,
        payload,
        { withCredentials: true }
      )
      alert('Tipo atualizado com sucesso!')
      setUsuarioSelecionado(null)
      void carregarUsuarios()
    } catch (err: any) {
      console.error(err)
      const msg = err?.response?.data?.erro || 'Erro ao atualizar tipo'
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

  const mostrarCampoProfessor = novoTipo === 'ADMIN_PROFESSORES'

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
                  setNovoTipo(u.tipo)
                }
              }}
            >
              <strong>{u.nome}</strong> — {mostrarCelular(u.celular)} —{' '}
              <span className="italic">{u.tipo}</span>
            </div>

            {/* Aba de edição */}
            {usuarioSelecionado?.id === u.id && (
              <div className="p-4 border-t bg-gray-50">
                <h2 className="font-bold mb-2">Editar Usuário</h2>
                <p><strong>Nome:</strong> {usuarioSelecionado.nome}</p>
                <p><strong>Email:</strong> {usuarioSelecionado.email}</p>
                <p><strong>Celular:</strong> {mostrarCelular(usuarioSelecionado.celular)}</p>
                <p><strong>Data de Nascimento:</strong> {formatarData(usuarioSelecionado.nascimento)}</p>
                <p><strong>CPF:</strong> {usuarioSelecionado.cpf || '-'}</p>

                <label className="block mt-3 mb-1 font-medium">Tipo de Usuário</label>
                <select
                  className="w-full p-2 border rounded mb-3 cursor-pointer"
                  value={novoTipo}
                  onChange={(e) => setNovoTipo(e.target.value)}
                  disabled={saving}
                >
                  {tipos.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>

                {/* ⬇️ Campo de valor só quando for professor */}
                {mostrarCampoProfessor && (
                  <div className="mt-2">
                    <label className="block mb-1 font-medium">Valor cobrado (por aula)</label>
                    <div className="flex items-stretch rounded-lg border overflow-hidden bg-white">
                      <span className="px-3 py-2 text-sm font-semibold bg-gray-100 text-gray-700 select-none">R$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="0,00"
                        value={valorQuadraStr}
                        onChange={(e) => handleValorChange(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm outline-none"
                        disabled={saving}
                      />
                    </div>
                    {valorErro && (
                      <p className="mt-1 text-xs text-red-600">{valorErro}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      Defina o valor da aula para professores (ex.: 120,00).
                    </p>
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={salvarTipo}
                    disabled={saving}
                    className="bg-green-600 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60 flex items-center gap-2"
                  >
                    {saving && <Spinner size="w-4 h-4" />}
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                  <button
                    onClick={() => setUsuarioSelecionado(null)}
                    disabled={saving}
                    className="bg-gray-400 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
