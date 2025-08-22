'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'

interface Usuario {
  id: string
  nome: string
  email: string
  celular: string
  nascimento: string | null
  cpf: string | null
  tipo: string
}

const tipos = ["CLIENTE", "ADMIN_MASTER", "ADMIN_ATENDENTE", "ADMIN_PROFESSORES"]

export default function UsuariosAdmin() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null)
  const [novoTipo, setNovoTipo] = useState('')

  const carregarUsuarios = async () => {
    try {
      const res = await axios.get('http://localhost:3001/usuariosAdmin', {
        params: {
          nome: busca || undefined,
          tipo: filtroTipo || undefined
        },
        withCredentials: true
      })
      setUsuarios(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    const delay = setTimeout(() => {
      carregarUsuarios()
    }, 300)
    return () => clearTimeout(delay)
  }, [busca, filtroTipo])

  const salvarTipo = async () => {
    if (!usuarioSelecionado) return
    try {
      await axios.put(
        `http://localhost:3001/usuariosAdmin/${usuarioSelecionado.id}/tipo`,
        { tipo: novoTipo },
        { withCredentials: true }
      )
      alert("Tipo atualizado com sucesso!")
      setUsuarioSelecionado(null)
      carregarUsuarios()
    } catch (err) {
      console.error(err)
      alert("Erro ao atualizar tipo")
    }
  }

  const formatarData = (data: string | null) => {
    if (!data) return "-"
    const [ano, mes, dia] = data.split("T")[0].split("-")
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
            {tipos.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <ul className="border rounded divide-y">
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
              <strong>{u.nome}</strong> — {u.email} — <span className="italic">{u.tipo}</span>
            </div>

            {/* Aba de edição */}
            {usuarioSelecionado?.id === u.id && (
              <div className="p-4 border-t bg-gray-50">
                <h2 className="font-bold mb-2">Editar Usuário</h2>
                <p><strong>Nome:</strong> {usuarioSelecionado.nome}</p>
                <p><strong>Email:</strong> {usuarioSelecionado.email}</p>
                <p><strong>Celular:</strong> {usuarioSelecionado.celular}</p>
                <p><strong>Data de Nascimento:</strong> {formatarData(usuarioSelecionado.nascimento)}</p>
                <p><strong>CPF:</strong> {usuarioSelecionado.cpf || "-"}</p>

                <label className="block mt-3 mb-1 font-medium">Tipo de Usuário</label>
                <select
                  className="w-full p-2 border rounded mb-3 cursor-pointer"
                  value={novoTipo}
                  onChange={(e) => setNovoTipo(e.target.value)}
                >
                  {tipos.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>

                <div className="flex gap-2">
                  <button
                    onClick={salvarTipo}
                    className="bg-green-600 text-white px-4 py-2 rounded cursor-pointer"
                  >
                    Salvar
                  </button>
                  <button
                    onClick={() => setUsuarioSelecionado(null)}
                    className="bg-gray-400 text-white px-4 py-2 rounded cursor-pointer"
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
