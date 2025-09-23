'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import Spinner from '@/components/Spinner'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

type Esporte = { id: number | string; nome: string }

// Agora traz também o celular (telefone)
type Usuario = {
  id: number | string
  nome: string
  celular?: string | null
}

type Quadra = { quadraId: number | string; nome: string; numero: number }
type DisponibilidadeQuadra = Quadra & { disponivel: boolean }

type Feedback = { kind: 'success' | 'error' | 'info'; text: string }

export default function AgendamentoComum() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'
  const searchParams = useSearchParams()
  const router = useRouter()

  const [data, setData] = useState<string>('')
  const [esportes, setEsportes] = useState<Esporte[]>([])
  const [esporteSelecionado, setEsporteSelecionado] = useState<string>('') // sempre guarda o ID
  const [horario, setHorario] = useState<string>('')

  const [quadrasDisponiveis, setQuadrasDisponiveis] = useState<Quadra[]>([])
  const [quadraSelecionada, setQuadraSelecionada] = useState<string>('')

  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // busca/seleção de jogadores cadastrados (agora com telefone)
  const [buscaUsuario, setBuscaUsuario] = useState<string>('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<Usuario[]>([])
  const [jogadores, setJogadores] = useState<Usuario[]>([])

  // convidado como DONO (opcional, agora com nome e telefone separados)
  const [ownerGuestNome, setOwnerGuestNome] = useState<string>('')
  const [ownerGuestTelefone, setOwnerGuestTelefone] = useState<string>('')

  // feedback do submit
  const [salvando, setSalvando] = useState<boolean>(false)

  // --- guardar o parâmetro de esporte (pode vir id OU nome) para mapear quando esportes carregarem
  const [esporteParam, setEsporteParam] = useState<string>('')

  // ler params vindos da Home e pré-preencher
  useEffect(() => {
    const d = searchParams.get('data')
    const h = searchParams.get('horario')
    const q = searchParams.get('quadraId')
    const e = searchParams.get('esporteId') || searchParams.get('esporte') // aceita id OU nome

    if (d) setData(d)
    if (h) setHorario(h)
    if (q) setQuadraSelecionada(q)
    if (e) setEsporteParam(e)
  }, [searchParams])

  // Esportes
  useEffect(() => {
    axios
      .get<Esporte[]>(`${API_URL}/esportes`, { withCredentials: true })
      .then((res) => setEsportes(res.data || []))
      .catch((err) => {
        console.error(err)
        setFeedback({ kind: 'error', text: 'Falha ao carregar esportes.' })
      })
  }, [API_URL])

  // quando a lista de esportes chegar, mapeia o param (id ou nome) para o ID correto
  useEffect(() => {
    if (!esportes.length || !esporteParam) return

    // tenta por ID
    const byId = esportes.find((e) => String(e.id) === String(esporteParam))
    if (byId) {
      setEsporteSelecionado(String(byId.id))
      return
    }
    // tenta por NOME (case-insensitive)
    const byName = esportes.find(
      (e) => e.nome?.trim().toLowerCase() === esporteParam.trim().toLowerCase()
    )
    if (byName) setEsporteSelecionado(String(byName.id))
  }, [esportes, esporteParam])

  // Disponibilidade
  useEffect(() => {
    const buscarDisponibilidade = async () => {
      if (!data || !esporteSelecionado || !horario) {
        setQuadrasDisponiveis([])
        return
      }
      setFeedback(null)

      try {
        const { data: disp } = await axios.get<DisponibilidadeQuadra[]>(
          `${API_URL}/disponibilidade`,
          {
            params: { data, horario, esporteId: esporteSelecionado },
            withCredentials: true,
          }
        )

        const filtradas = (disp || [])
          .filter((q) => q.disponivel)
          .map(({ quadraId, nome, numero }) => ({ quadraId, nome, numero }))

        setQuadrasDisponiveis(filtradas)
        if (filtradas.length === 0) {
          setFeedback({ kind: 'info', text: 'Nenhuma quadra disponível para este horário.' })
        } else {
          setFeedback(null)
        }
      } catch (err) {
        console.error(err)
        setFeedback({ kind: 'error', text: 'Erro ao verificar disponibilidade.' })
      }
    }

    buscarDisponibilidade()
  }, [API_URL, data, esporteSelecionado, horario])

  // Busca de usuários cadastrados — agora esperamos { id, nome, celular }
  useEffect(() => {
    const buscar = async () => {
      if (buscaUsuario.trim().length < 2) {
        setUsuariosEncontrados([])
        return
      }

      try {
        const { data } = await axios.get<Usuario[]>(`${API_URL}/clientes`, {
          params: { nome: buscaUsuario },
          withCredentials: true,
        })
        // Back padronizado deve devolver nome + celular (telefone).
        setUsuariosEncontrados(data || [])
      } catch (err) {
        console.error(err)
      }
    }

    const delay = setTimeout(buscar, 300)
    return () => clearTimeout(delay)
  }, [API_URL, buscaUsuario])

  const adicionarJogador = (usuario: Usuario) => {
    setJogadores((prev) =>
      prev.find((j) => String(j.id) === String(usuario.id)) ? prev : [...prev, usuario]
    )
    setBuscaUsuario('')
    setUsuariosEncontrados([])
    setFeedback(null)
  }

  const removerJogador = (id: number | string) => {
    setJogadores((prev) => prev.filter((j) => String(j.id) !== String(id)))
  }

  function mensagemErroAxios(error: any): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const data = error.response?.data as any
      const serverMsg =
        (data && (data.erro || data.message || data.msg)) ? String(data.erro || data.message || data.msg) : ''

      if (status === 409) return serverMsg || 'Conflito: horário já reservado.'
      if (status === 400 || status === 422) return serverMsg || 'Requisição inválida.'
      if (status === 401) return 'Não autorizado.'
      return serverMsg || 'Falha ao realizar agendamento.'
    }
    return 'Falha ao realizar agendamento.'
  }

  const agendar = async () => {
    setFeedback(null)

    if (!quadraSelecionada || (jogadores.length === 0 && ownerGuestNome.trim() === '')) {
      setFeedback({
        kind: 'error',
        text: 'Selecione uma quadra e pelo menos um jogador, ou informe um convidado como dono.'
      })
      return
    }

    // se for convidado dono, exigir telefone
    if (ownerGuestNome.trim() && !ownerGuestTelefone.trim()) {
      setFeedback({
        kind: 'error',
        text: 'Informe o telefone do convidado dono.'
      })
      return
    }

    const usuarioIdTemp = jogadores[0]?.id

    const payload: any = {
      data,
      horario,
      esporteId: String(esporteSelecionado),
      quadraId: String(quadraSelecionada),
      jogadoresIds: jogadores.map((j) => String(j.id)),
      // concatena "Nome Telefone" para manter compatibilidade com o backend atual
      convidadosNomes:
        ownerGuestNome.trim()
          ? [`${ownerGuestNome.trim()} ${ownerGuestTelefone.trim()}`.trim()]
          : undefined,
    }
    if (usuarioIdTemp) payload.usuarioId = String(usuarioIdTemp)

    setSalvando(true)
    try {
      // 1) cria o agendamento
      const { data: novo } = await axios.post(`${API_URL}/agendamentos`, payload, {
        withCredentials: true,
      })

      // 2) se tiver “convidado dono”, transfere titularidade
      if (ownerGuestNome.trim()) {
        const alvoNome = ownerGuestNome.trim().toLowerCase()
        const convidado = Array.isArray(novo?.jogadores)
          ? novo.jogadores.find((j: any) => {
              const nome = String(j?.nome || '').trim().toLowerCase()
              // cobre ambos os casos: nome exato OU nome + telefone concatenado
              return nome === alvoNome || nome.startsWith(alvoNome + ' ')
            })
          : null

        if (convidado?.id) {
          await axios.patch(
            `${API_URL}/agendamentos/${novo.id}/transferir`,
            { novoUsuarioId: String(convidado.id) },
            { withCredentials: true }
          )
        }
      }

      // sucesso: feedback visual + toast + redirecionar para todosHorarios no mesmo dia
      setFeedback({ kind: 'success', text: 'Agendamento realizado com sucesso!' })
      toast.success('Agendamento realizado com sucesso!')

      // limpa seleções
      setQuadraSelecionada('')
      setQuadrasDisponiveis([])
      setJogadores([])
      setOwnerGuestNome('')
      setOwnerGuestTelefone('')

      // redirect (mantém o toast visível)
      const params = new URLSearchParams({ data })
      setTimeout(() => {
        router.push(`/adminMaster/todosHorarios?${params.toString()}`)
      }, 350)
    } catch (error) {
      console.error(error)
      setFeedback({ kind: 'error', text: mensagemErroAxios(error) })
      toast.error(mensagemErroAxios(error))
    } finally {
      setSalvando(false)
    }
  }

  const horas = [
    '07:00','08:00','09:00','10:00','11:00','12:00','13:00',
    '14:00','15:00','16:00','17:00','18:00','19:00',
    '20:00','21:00','22:00','23:00'
  ]

  const alertClasses =
    feedback?.kind === 'success'
      ? 'border-green-200 bg-green-50 text-green-800'
      : feedback?.kind === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-sky-200 bg-sky-50 text-sky-800'

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white shadow rounded-xl">
      <h1 className="text-2xl font-bold mb-4">Agendar Quadra Comum</h1>

      {/* ALERTA */}
      {feedback && (
        <div
          className={`mb-4 rounded-md border px-3 py-2 text-sm ${alertClasses}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}
        >
          {feedback.text}
        </div>
      )}

      <label className="block mb-2">Data</label>
      <input
        type="date"
        className="w-full p-2 border rounded mb-4"
        value={data}
        onChange={(e) => {
          setData(e.target.value)
          setFeedback(null)
        }}
      />

      <label className="block mb-2">Esporte</label>
      <select
        className="w-full p-2 border rounded mb-4"
        value={esporteSelecionado}
        onChange={(e) => {
          setEsporteSelecionado(e.target.value)
          setFeedback(null)
        }}
      >
        <option value="">Selecione um esporte</option>
        {esportes.map((e) => (
          <option key={String(e.id)} value={String(e.id)}>
            {e.nome}
          </option>
        ))}
      </select>

      <label className="block mb-2">Horário</label>
      <select
        className="w-full p-2 border rounded mb-4"
        value={horario}
        onChange={(e) => {
          setHorario(e.target.value)
          setFeedback(null)
        }}
      >
        <option value="">Selecione um horário</option>
        {horas.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>

      {/* Dono convidado (opcional) */}
      <div className="mb-4">
        <label className="block mb-1 font-medium">Convidado dono</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            className="w-full p-2 border rounded"
            placeholder="Nome do convidado (obrigatório se usar convidado)"
            value={ownerGuestNome}
            onChange={(e) => setOwnerGuestNome(e.target.value)}
          />
          <input
            type="tel"
            className="w-full p-2 border rounded"
            placeholder="Telefone do convidado (obrigatório)"
            value={ownerGuestTelefone}
            onChange={(e) => setOwnerGuestTelefone(e.target.value)}
          />
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Preencha estes campos <b>apenas</b> se o dono não é cadastrado.
        </p>
      </div>

      {/* Busca e seleção de jogadores cadastrados */}
      <div className="mb-4">
        <label className="block mb-1 font-medium">Adicionar Jogadores (cadastrados)</label>
        <input
          type="text"
          className="w-full p-2 border rounded mb-2"
          placeholder="Buscar por nome do usuário"
          value={buscaUsuario}
          onChange={(e) => setBuscaUsuario(e.target.value)}
        />

        {usuariosEncontrados.length > 0 && (
          <ul className="border rounded mb-2 max-h-60 overflow-y-auto divide-y">
            {usuariosEncontrados.map((u) => (
              <li
                key={String(u.id)}
                className="p-2 hover:bg-gray-100 cursor-pointer"
                onClick={() => adicionarJogador(u)}
                title={u.celular || ''}
              >
                <div className="font-medium">{u.nome}</div>
                {u.celular && <div className="text-xs text-gray-600">{u.celular}</div>}
              </li>
            ))}
          </ul>
        )}

        {jogadores.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 font-medium">Jogadores Selecionados:</p>
            <ul className="flex flex-wrap gap-2">
              {jogadores.map((j) => (
                <li
                  key={String(j.id)}
                  className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center gap-2"
                  title={j.celular || ''}
                >
                  {j.nome}{j.celular ? ` (${j.celular})` : ''}
                  <button
                    onClick={() => removerJogador(j.id)}
                    className="ml-1 text-red-500"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-500 mt-1">
              Obs.: se não informar “Convidado dono”, o primeiro jogador cadastrado será o dono inicial.
            </p>
          </div>
        )}
      </div>

      {quadrasDisponiveis.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-semibold">Quadras Disponíveis</h2>
          <div className="grid grid-cols-2 gap-2">
            {quadrasDisponiveis.map((q) => (
              <button
                key={String(q.quadraId)}
                className={`p-2 rounded border ${
                  quadraSelecionada === String(q.quadraId)
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100'
                }`}
                onClick={() => {
                  setQuadraSelecionada(String(q.quadraId))
                  setFeedback(null)
                }}
              >
                {q.nome} - {q.numero}
              </button>
            ))}
          </div>

          <button
            className={`mt-4 px-4 py-2 rounded text-white ${
              salvando ? 'bg-orange-500/70 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700'
            }`}
            onClick={agendar}
            disabled={salvando}
            aria-busy={salvando}
          >
            {salvando ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="w-4 h-4" /> <span>Enviando…</span>
              </span>
            ) : (
              'Confirmar Agendamento'
            )}
          </button>
        </div>
      )}
    </div>
  )
}
