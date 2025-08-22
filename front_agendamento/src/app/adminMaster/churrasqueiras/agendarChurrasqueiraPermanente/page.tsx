'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'

interface Churrasqueira {
  churrasqueiraId: string
  nome: string
  numero: number
  // possíveis campos de imagem vindos da API (R2 ou legado)
  imagem?: string | null
  imagemUrl?: string | null
  logoUrl?: string | null
  disponivel?: boolean
}

interface Usuario {
  id: string
  nome: string
}

export default function AgendamentoChurrasqueiraPermanente() {
  const [diaSemana, setDiaSemana] = useState('')
  const [turno, setTurno] = useState('')
  const [churrasqueirasDisponiveis, setChurrasqueirasDisponiveis] = useState<Churrasqueira[]>([])
  const [churrasqueiraSelecionada, setChurrasqueiraSelecionada] = useState('')
  const [mensagem, setMensagem] = useState('')

  const [buscaUsuario, setBuscaUsuario] = useState('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<Usuario[]>([])
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const diasEnum = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"]

  // monta URL de imagem (R2 preferencial; legado como fallback)
  const toImgUrl = (c: Churrasqueira) => {
    const v = c.imagemUrl ?? c.logoUrl ?? c.imagem ?? ''
    if (!v) return '/churrasqueira.png'
    if (/^https?:\/\//i.test(v)) return v
    if (v.startsWith('/uploads/')) return `${API_URL}${v}`
    return `${API_URL}/uploads/churrasqueiras/${v}`
  }

  // Buscar disponibilidade
  useEffect(() => {
    const buscar = async () => {
      if (!diaSemana || !turno) {
        setChurrasqueirasDisponiveis([])
        return
      }

      try {
        const res = await axios.get(`${API_URL}/disponibilidadeChurrasqueiras`, {
          params: { diaSemana, turno },
          withCredentials: true,
        })
        const lista: Churrasqueira[] = Array.isArray(res.data) ? res.data : []
        const disponiveis = lista.filter((c) => c.disponivel !== false)
        setChurrasqueirasDisponiveis(disponiveis)
        setMensagem(disponiveis.length === 0 ? 'Nenhuma churrasqueira disponível.' : '')
      } catch (err) {
        console.error(err)
        setMensagem('Erro ao verificar disponibilidade.')
      }
    }

    buscar()
  }, [diaSemana, turno, API_URL])

  // Buscar usuários
  useEffect(() => {
    const buscar = async () => {
      if (buscaUsuario.trim().length < 2) {
        setUsuariosEncontrados([])
        return
      }
      try {
        const res = await axios.get(`${API_URL}/clientes`, {
          params: { nome: buscaUsuario.trim() },
          withCredentials: true,
        })
        setUsuariosEncontrados(res.data || [])
      } catch (err) {
        console.error(err)
      }
    }

    const delay = setTimeout(buscar, 300)
    return () => clearTimeout(delay)
  }, [buscaUsuario, API_URL])

  const agendar = async () => {
    if (!churrasqueiraSelecionada || !usuarioSelecionado) {
      setMensagem('Selecione uma churrasqueira e um usuário.')
      return
    }

    try {
      await axios.post(`${API_URL}/agendamentosPermanentesChurrasqueiras`, {
        diaSemana,
        turno,
        churrasqueiraId: churrasqueiraSelecionada,
        usuarioId: usuarioSelecionado.id,
      }, { withCredentials: true })
      setMensagem('✅ Agendamento permanente realizado com sucesso!')
      setChurrasqueiraSelecionada('')
      setUsuarioSelecionado(null)
    } catch (err) {
      console.error(err)
      setMensagem('Erro ao realizar agendamento permanente.')
    }
  }

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white shadow rounded-xl">
      <h1 className="text-2xl font-bold mb-4">Agendar Churrasqueira (Permanente)</h1>

      <label className="block mb-2">Dia da Semana</label>
      <select
        className="w-full p-2 border rounded mb-4"
        value={diaSemana}
        onChange={(e) => setDiaSemana(e.target.value)}
      >
        <option value="">Selecione o dia</option>
        {diasEnum.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      <label className="block mb-2">Turno</label>
      <select
        className="w-full p-2 border rounded mb-4"
        value={turno}
        onChange={(e) => setTurno(e.target.value)}
      >
        <option value="">Selecione o turno</option>
        <option value="DIA">Dia</option>
        <option value="NOITE">Noite</option>
      </select>

      {/* Busca de usuário */}
      <label className="block mb-1 font-medium">Selecionar Usuário</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        placeholder="Buscar por nome"
        value={buscaUsuario}
        onChange={(e) => setBuscaUsuario(e.target.value)}
      />
      {usuariosEncontrados.length > 0 && (
        <ul className="border rounded mb-2 max-h-40 overflow-y-auto">
          {usuariosEncontrados.map((u) => (
            <li
              key={u.id}
              className="p-2 hover:bg-gray-100 cursor-pointer"
              onClick={() => { setUsuarioSelecionado(u); setBuscaUsuario(''); setUsuariosEncontrados([]) }}
            >
              {u.nome}
            </li>
          ))}
        </ul>
      )}

      {usuarioSelecionado && (
        <p className="mb-4">👤 Usuário selecionado: <strong>{usuarioSelecionado.nome}</strong></p>
      )}

      {/* Lista de churrasqueiras */}
      {churrasqueirasDisponiveis.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-semibold">Churrasqueiras Disponíveis</h2>

          <div className="grid grid-cols-2 gap-3">
            {churrasqueirasDisponiveis.map((c) => {
              const img = toImgUrl(c)
              const isActive = churrasqueiraSelecionada === String(c.churrasqueiraId)
              return (
                <button
                  key={c.churrasqueiraId}
                  type="button"
                  className={`p-2 rounded border text-left bg-gray-50 hover:bg-gray-100 transition ${
                    isActive ? 'ring-2 ring-green-600 bg-green-50' : ''
                  }`}
                  onClick={() => setChurrasqueiraSelecionada(String(c.churrasqueiraId))}
                >
                  <div className="w-full aspect-[4/3] rounded overflow-hidden bg-white border mb-2 grid place-items-center">
                    <img
                      src={img}
                      alt={c.nome}
                      className="w-full h-full object-cover"
                      onError={(e) => ((e.currentTarget as HTMLImageElement).src = '/churrasqueira.png')}
                    />
                  </div>
                  <div className="text-sm">
                    <p className="font-semibold">{c.nome}</p>
                    <p className="text-gray-600">Nº {c.numero}</p>
                  </div>
                </button>
              )
            })}
          </div>

          <button
            className="mt-4 bg-orange-600 text-white px-4 py-2 rounded disabled:opacity-60"
            onClick={agendar}
            disabled={!churrasqueiraSelecionada || !usuarioSelecionado}
          >
            Confirmar Agendamento
          </button>
        </div>
      )}

      {mensagem && <p className="mt-4 text-center text-sm text-gray-700">{mensagem}</p>}
    </div>
  )
}
