'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import AppImage from "@/components/AppImage";
import { useSearchParams } from 'next/navigation'
import Spinner from "@/components/Spinner"; // 👈 NOVO

interface Churrasqueira {
  churrasqueiraId: string
  nome: string
  numero: number
  imagem?: string | null
  imagemUrl?: string | null
  logoUrl?: string | null
  disponivel?: boolean
}

// Agora esperamos também o celular (telefone)
type UsuarioBusca = { id: string; nome: string; celular?: string | null }

export default function AgendamentoChurrasqueiraComum() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";
  const searchParams = useSearchParams();

  const [data, setData] = useState<string>("")
  const [turno, setTurno] = useState<string>("")
  const [churrasqueirasDisponiveis, setChurrasqueirasDisponiveis] = useState<Churrasqueira[]>([])
  const [churrasqueiraSelecionada, setChurrasqueiraSelecionada] = useState<string>("")
  const [mensagem, setMensagem] = useState<string>("")
  const [carregandoDisp, setCarregandoDisp] = useState<boolean>(false)

  // 🔄 carregando ao confirmar agendamento
  const [carregandoAgendar, setCarregandoAgendar] = useState<boolean>(false) // 👈 NOVO

  // Dono cadastrado (busca)
  const [buscaUsuario, setBuscaUsuario] = useState<string>("")
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([])
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<UsuarioBusca | null>(null)
  const [buscandoUsuarios, setBuscandoUsuarios] = useState<boolean>(false)

  // Convidado como dono (nome livre)
  const [convidadoDonoNome, setConvidadoDonoNome] = useState<string>("")

  // 🔹 Lê query params e pré-preenche a tela
  useEffect(() => {
    const qData = searchParams.get('data')
    const qTurno = searchParams.get('turno')
    const qChurras = searchParams.get('churrasqueiraId')

    if (qData && /^\d{4}-\d{2}-\d{2}$/.test(qData)) {
      setData(qData)
    }
    if (qTurno && (qTurno === 'DIA' || qTurno === 'NOITE')) {
      setTurno(qTurno)
    }
    if (qChurras) {
      setChurrasqueiraSelecionada(String(qChurras))
    }
  }, [searchParams])

  // Disponibilidade por data + turno
  useEffect(() => {
    const buscar = async () => {
      if (!data || !turno) {
        setChurrasqueirasDisponiveis([])
        setMensagem('')
        return
      }
      setCarregandoDisp(true)
      try {
        const res = await axios.get(`${API_URL}/disponibilidadeChurrasqueiras`, {
          params: { data, turno },
          withCredentials: true,
        })
        const lista: Churrasqueira[] = Array.isArray(res.data) ? res.data : []
        const disponiveis = lista.filter((c) => c.disponivel !== false)
        setChurrasqueirasDisponiveis(disponiveis)
        setMensagem(disponiveis.length === 0 ? 'Nenhuma churrasqueira disponível.' : '')
      } catch (err) {
        console.error(err)
        setMensagem('Erro ao verificar disponibilidade.')
        setChurrasqueirasDisponiveis([])
      } finally {
        setCarregandoDisp(false)
      }
    }
    buscar()
  }, [data, turno, API_URL])

  // Busca usuários (id + nome + celular) — debounce + AbortController
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
        const { data: lista } = await axios.get<UsuarioBusca[]>(
          `${API_URL}/clientes`,
          { params: { nome: q }, withCredentials: true, signal: ctrl.signal as any }
        )
        setUsuariosEncontrados(Array.isArray(lista) ? lista : [])
      } catch (err: any) {
        if (err?.name !== "CanceledError" && err?.code !== "ERR_CANCELED") {
          console.error("Falha ao buscar usuários:", err)
        }
        setUsuariosEncontrados([])
      } finally {
        setBuscandoUsuarios(false)
      }
    }, 300)

    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [buscaUsuario, API_URL])

  const agendar = async () => {
    if (!data || !turno || !churrasqueiraSelecionada || (!usuarioSelecionado && !convidadoDonoNome.trim())) {
      setMensagem('Selecione data, turno, uma churrasqueira e um usuário OU preencha o convidado.')
      return
    }

    const body: Record<string, any> = {
      data,
      turno,
      churrasqueiraId: churrasqueiraSelecionada,
      ...(usuarioSelecionado
        ? { usuarioId: usuarioSelecionado.id }
        : { convidadosNomes: [convidadoDonoNome.trim()] }
      ),
    }

    setCarregandoAgendar(true)   // 👈 liga spinner
    setMensagem('')              // limpa mensagem anterior

    try {
      await axios.post(`${API_URL}/agendamentosChurrasqueiras`, body, { withCredentials: true })
      setMensagem('✅ Agendamento realizado com sucesso!')
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
        'Erro ao realizar agendamento.'
      setMensagem(msg)
    } finally {
      setCarregandoAgendar(false) // 👈 desliga spinner
    }
  }

  // min da data = hoje
  const hoje = new Date()
  const minDate = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

  const botaoDesabilitado =
    !data || !turno || !churrasqueiraSelecionada || (!usuarioSelecionado && !convidadoDonoNome.trim())

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white shadow rounded-xl">
      <h1 className="text-2xl font-bold mb-4">Agendar Churrasqueira (Comum)</h1>

      <label className="block mb-2">Data</label>
      <input
        type="date"
        className="w-full p-2 border rounded mb-4"
        value={data}
        min={minDate}
        onChange={(e) => setData(e.target.value)}
      />

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
                  title={u.celular || ""}
                >
                  <div className="font-medium">{u.nome}</div>
                  {u.celular && <div className="text-xs text-gray-600">{u.celular}</div>}
                </li>
              ))}
            </ul>
          )}

          {usuarioSelecionado && (
            <p className="text-xs text-green-700">
              Usuário selecionado: <strong>{usuarioSelecionado.nome}</strong>
              {usuarioSelecionado.celular ? (
                <> — <span className="text-gray-700">{usuarioSelecionado.celular}</span></>
              ) : null}
            </p>
          )}
        </div>

        {/* Convidado dono (alternativa ao usuário cadastrado) */}
        <div>
          <input
            type="text"
            className="w-full p-2 border rounded"
            placeholder="Ou informe convidado dono (ex.: João — 53 99127-8304)"
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
      {carregandoDisp && (
        <p className="text-sm text-gray-500 mb-2">Carregando disponibilidade…</p>
      )}
      {churrasqueirasDisponiveis.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-semibold">Churrasqueiras Disponíveis</h2>

          <div className="grid grid-cols-2 gap-3">
            {churrasqueirasDisponiveis.map((c) => {
              const isActive = churrasqueiraSelecionada === String(c.churrasqueiraId)
              return (
                <button
                  key={c.churrasqueiraId}
                  type="button"
                  className={`p-2 rounded border text-left bg-gray-50 hover:bg-gray-100 transition ${isActive ? 'ring-2 ring-green-600 bg-green-50' : ''}`}
                  onClick={() => setChurrasqueiraSelecionada(String(c.churrasqueiraId))}
                >
                  <div className="relative w-full aspect-[4/3] rounded overflow-hidden bg-white border mb-2">
                    <AppImage
                      src={c.imagemUrl ?? c.logoUrl ?? c.imagem ?? undefined}
                      legacyDir="churrasqueiras"
                      alt={c.nome}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      fallbackSrc="/churrasqueira.png"
                      priority={false}
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
            className="mt-4 bg-orange-600 text-white px-4 py-2 rounded disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={agendar}
            disabled={botaoDesabilitado || carregandoAgendar} // 👈 trava enquanto envia
          >
            {carregandoAgendar ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="w-4 h-4" /> Agendando…
              </span>
            ) : (
              "Confirmar Agendamento"
            )}
          </button>
        </div>
      )}

      {mensagem && <p className="mt-4 text-center text-sm text-gray-700">{mensagem}</p>}
    </div>
  )
}
