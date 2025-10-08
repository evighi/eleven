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
}

const tipos = ["CLIENTE", "ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"]

// Collator para ordenar sem diferenciar acentos/maiúsculas
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true })

// fallback para celular
const mostrarCelular = (cel?: string | null) =>
  (cel && cel.trim().length > 0) ? cel : '00000000000'

export default function UsuariosAdmin() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null)
  const [novoTipo, setNovoTipo] = useState('')

  // ✅ novos estados de carregamento
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

  const carregarUsuarios = useCallback(async () => {
    setLoading(true) // <-- inicia spinner
    try {
      const res = await axios.get(`${API_URL}/usuariosAdmin`, {
        params: {
          nome: busca || undefined,
          tipo: filtroTipo || undefined,
        },
        withCredentials: true,
      })
      const lista: Usuario[] = Array.isArray(res.data) ? res.data : []
      // ordena por nome ignorando acentos/maiúsculas
      lista.sort((a, b) => collator.compare(a?.nome ?? '', b?.nome ?? ''))
      setUsuarios(lista)
    } catch (err) {
      console.error(err)
      setUsuarios([])
    } finally {
      setLoading(false) // <-- finaliza spinner
    }
  }, [API_URL, busca, filtroTipo])

  useEffect(() => {
    const delay = setTimeout(() => {
      void carregarUsuarios()
    }, 300)
    return () => clearTimeout(delay)
  }, [carregarUsuarios])

  const salvarTipo = async () => {
    if (!usuarioSelecionado) return
    setSaving(true) // <-- spinner no botão salvar
    try {
      await axios.put(
        `${API_URL}/usuariosAdmin/${usuarioSelecionado.id}/tipo`,
        { tipo: novoTipo },
        { withCredentials: true }
      )
      alert('Tipo atualizado com sucesso!')
      setUsuarioSelecionado(null)
      void carregarUsuarios()
    } catch (err) {
      console.error(err)
      alert('Erro ao atualizar tipo')
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
              <option key={t} value={t}>
                {t}
              </option>
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
                <p>
                  <strong>Nome:</strong> {usuarioSelecionado.nome}
                </p>
                <p>
                  <strong>Email:</strong> {usuarioSelecionado.email}
                </p>
                <p>
                  <strong>Celular:</strong> {mostrarCelular(usuarioSelecionado.celular)}
                </p>
                <p>
                  <strong>Data de Nascimento:</strong> {formatarData(usuarioSelecionado.nascimento)}
                </p>
                <p>
                  <strong>CPF:</strong> {usuarioSelecionado.cpf || '-'}
                </p>

                <label className="block mt-3 mb-1 font-medium">Tipo de Usuário</label>
                <select
                  className="w-full p-2 border rounded mb-3 cursor-pointer"
                  value={novoTipo}
                  onChange={(e) => setNovoTipo(e.target.value)}
                  disabled={saving}
                >
                  {tipos.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>

                <div className="flex gap-2">
                  <button
                    onClick={salvarTipo}
                    disabled={saving}
                    className="bg-green-600 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60 flex items-center gap-2"
                  >
                    {saving && <Spinner size="w-4 h-4" />} {/* ✅ spinner no botão */}
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
