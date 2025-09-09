'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import Image from 'next/image'

interface Churrasqueira {
  churrasqueiraId: string
  nome: string
  numero: number
  imagem?: string | null
  imagemUrl?: string | null
  logoUrl?: string | null
  disponivel?: boolean
}
type UsuarioBusca = { id: string; nome: string }

export default function AgendamentoChurrasqueiraPermanente() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001"

  const [diaSemana, setDiaSemana] = useState('')
  const [turno, setTurno] = useState('')
  const [churrasqueirasDisponiveis, setChurrasqueirasDisponiveis] = useState<Churrasqueira[]>([])
  const [churrasqueiraSelecionada, setChurrasqueiraSelecionada] = useState('')
  const [mensagem, setMensagem] = useState('')

  // Dono cadastrado
  const [buscaUsuario, setBuscaUsuario] = useState('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([])
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<UsuarioBusca | null>(null)
  const [buscandoUsuarios, setBuscandoUsuarios] = useState(false)

  // Convidado como dono
  const [convidadoDonoNome, setConvidadoDonoNome] = useState('')

  const diasEnum = ["DOMINGO","SEGUNDA","TERCA","QUARTA","QUINTA","SEXTA","SABADO"] as const
  const DIA_IDX: Record<string, number> = { DOMINGO:0, SEGUNDA:1, TERCA:2, QUARTA:3, QUINTA:4, SEXTA:5, SABADO:6 }

  function nextISOForDiaSemana(dia: string): string | null {
    const target = DIA_IDX[dia]
    if (typeof target !== 'number') return null
    const hoje = new Date()
    const delta = (target - hoje.getDay() + 7) % 7
    const dt = new Date(hoje)
    dt.setDate(hoje.getDate() + delta)
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const d = String(dt.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const toImgUrl = (c: Churrasqueira) => {
    const v = c.imagemUrl ?? c.logoUrl ?? c.imagem ?? ''
    if (!v) return '/churrasqueira.png'
    if (/^https?:\/\//i.test(v)) return v
    if (v.startsWith('/uploads/')) return `${API_URL}${v}`
    return `${API_URL}/uploads/churrasqueiras/${v}`
  }

  const canOptimize = (url: string) => {
    try {
      const u = new URL(url)
      return u.protocol === 'https:' &&
        (u.hostname.endsWith('r2.dev') || u.hostname.endsWith('cloudflarestorage.com'))
    } catch { return false }
  }

  // Disponibilidade: diaSemana -> próxima data ISO
  useEffect(() => {
    const buscar = async () => {
      if (!diaSemana || !turno) {
        setChurrasqueirasDisponiveis([])
        setMensagem('')
        return
      }
      const data = nextISOForDiaSemana(diaSemana)
      if (!data) {
        setChurrasqueirasDisponiveis([])
        setMensagem('Dia da semana inválido.')
        return
      }
      try {
        const res = await axios.get(`${API_URL}/disponibilidadeChurrasqueiras`, {
          params: { data, turno },
          withCredentials: true,
        })
        const lista: Churrasqueira[] = Array.isArray(res.data) ? res.data : []
        const disponiveis = lista.filter(c => c.disponivel !== false)
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
    const q = buscaUsuario.trim()
    if (q.length < 2) {
      setUsuariosEncontrados([])
      setBuscandoUsuarios(false)
      return
    }
    const ctrl = new AbortController()
    setBuscandoUsuarios(true)
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get<UsuarioBusca[]>(
          `${API_URL}/clientes`,
          { params: { nome: q }, withCredentials: true, signal: ctrl.signal as any }
        )
        setUsuariosEncontrados(Array.isArray(data) ? data : [])
      } catch (err:any) {
        if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          console.error('Falha ao buscar usuários:', err)
        }
        setUsuariosEncontrados([])
      } finally {
        setBuscandoUsuarios(false)
      }
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [buscaUsuario, API_URL])

  const agendar = async () => {
    if (!diaSemana || !turno || !churrasqueiraSelecionada || (!usuarioSelecionado && !convidadoDonoNome.trim())) {
      setMensagem('Selecione dia, turno, churrasqueira e um usuário OU informe um convidado.')
      return
    }

    const body: Record<string, any> = {
      diaSemana,
      turno,
      churrasqueiraId: churrasqueiraSelecionada,
      ...(usuarioSelecionado
        ? { usuarioId: usuarioSelecionado.id }
        : { convidadosNomes: [convidadoDonoNome.trim()] } // <- chave correta para o backend
      ),
    }

    try {
      await axios.post(`${API_URL}/agendamentosPermanentesChurrasqueiras`, body, { withCredentials: true })
      setMensagem('✅ Agendamento permanente realizado com sucesso!')
      setChurrasqueiraSelecionada('')
      setUsuarioSelecionado(null)
      setBuscaUsuario('')
      setUsuariosEncontrados([])
      setConvidadoDonoNome('')
    } catch (err: any) {
      console.error(err)
      const msg =
        err?.response?.data?.erro ||
        err?.response?.data?.message ||
        'Erro ao realizar agendamento permanente.'
      setMensagem(msg)
    }
  }

  const botaoDesabilitado =
    !diaSemana || !turno || !churrasqueiraSelecionada || (!usuarioSelecionado && !convidadoDonoNome.trim())

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
        {diasEnum.map((d) => <option key={d} value={d}>{d}</option>)}
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

      {/* Dono do agendamento */}
      <div className="space-y-2 mb-4">
        <label className="block font-semibold">Dono do agendamento</label>

        {/* Busca usuário cadastrado */}
        <div>
          <input
            type="text"
            className="w-full p-2 border rounded mb-2"
            placeholder="Buscar usuário por nome"
            value={buscaUsuario}
            onChange={(e) => {
              setBuscaUsuario(e.target.value)
              setUsuarioSelecionado(null)
            }}
          />
          {buscandoUsuarios && <div className="text-xs text-gray-500 mb-1">Buscando…</div>}
          {usuariosEncontrados.length > 0 && (
            <ul className="border rounded mb-2 max-h-40 overflow-y-auto">
              {usuariosEncontrados.map((u) => (
                <li
                  key={u.id}
                  className="p-2 hover:bg-gray-100 cursor-pointer"
                  onClick={() => {
                    setUsuarioSelecionado(u)
                    setBuscaUsuario('')
                    setUsuariosEncontrados([])
                    setConvidadoDonoNome('')
                  }}
                >
                  {u.nome}
                </li>
              ))}
            </ul>
          )}
          {usuarioSelecionado && (
            <p className="text-xs text-green-700">Usuário selecionado: <strong>{usuarioSelecionado.nome}</strong></p>
          )}
        </div>

        {/* Convidado dono */}
        <div>
          <input
            type="text"
            className="w-full p-2 border rounded"
            placeholder="Ou informe um convidado como dono (ex.: Nome do Convidado)"
            value={convidadoDonoNome}
            onChange={(e) => {
              setConvidadoDonoNome(e.target.value)
              if (e.target.value.trim()) {
                setUsuarioSelecionado(null)
                setBuscaUsuario('')
                setUsuariosEncontrados([])
              }
            }}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Preencha <strong>um</strong> dos dois: usuário cadastrado <em>ou</em> convidado dono.
          </p>
        </div>
      </div>

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
                  className={`p-2 rounded border text-left bg-gray-50 hover:bg-gray-100 transition ${isActive ? 'ring-2 ring-green-600 bg-green-50' : ''}`}
                  onClick={() => setChurrasqueiraSelecionada(String(c.churrasqueiraId))}
                >
                  <div className="relative w-full aspect-[4/3] rounded overflow-hidden bg-white border mb-2">
                    <Image
                      src={img}
                      alt={c.nome}
                      fill
                      sizes="(max-width: 640px) 50vw, 33vw"
                      className="object-cover"
                      unoptimized={!canOptimize(img)}
                      onError={(e) => { (e.currentTarget as any).src = '/churrasqueira.png' }}
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
            disabled={botaoDesabilitado}
          >
            Confirmar Agendamento
          </button>
        </div>
      )}

      {mensagem && <p className="mt-4 text-center text-sm text-gray-700">{mensagem}</p>}
    </div>
  )
}
