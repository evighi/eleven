'use client'

import { useEffect, useMemo, useState } from 'react'
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
  tipo?: string | null // ex.: 'ADMIN_PROFESSORES', 'CLIENTE', 'CLIENTE_APOIADO', etc.
}

type Quadra = { quadraId: number | string; nome: string; numero: number }
type DisponibilidadeQuadra = Quadra & { disponivel: boolean }

type Feedback = { kind: 'success' | 'error' | 'info'; text: string }

/* ===== Helpers mínimos ===== */
const norm = (s?: string | null) => String(s || '').trim().toUpperCase()

// 🔤 helper para ignorar acentos na comparação de nomes
const normalizeText = (s?: string | null) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

// ✅ tipos permitidos como "apoiado" (mesma regra do backend)
const APOIADO_TIPOS_PERMITIDOS = [
  'CLIENTE_APOIADO',
  'ADMIN_MASTER',
  'ADMIN_ATENDENTE',
  'ADMIN_PROFESSORES',
]

// elegível para isenção de apoio
const isUsuarioElegivelApoio = (u?: Usuario | null) =>
  APOIADO_TIPOS_PERMITIDOS.includes(norm(u?.tipo))

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

  // ✅ NOVO: Aula x Jogo
  const [tipoSessao, setTipoSessao] = useState<'AULA' | 'JOGO'>('AULA')
  const isNoite = useMemo(() => {
    if (!horario) return false
    const hh = parseInt(horario.slice(0, 2), 10)
    return hh >= 18
  }, [horario])

  // ✅ Se for 18h+ força JOGO automaticamente
  useEffect(() => {
    if (isNoite) setTipoSessao('JOGO')
  }, [isNoite])

  // ✅ Quem é o DONO atual? (regra existente: primeiro jogador cadastrado vira dono inicial
  // quando não há "convidado dono")
  const ownerSelecionado = jogadores[0]
  const selectedOwnerIsProfessor = useMemo(() => {
    const t = norm(ownerSelecionado?.tipo)
    return t === 'ADMIN_PROFESSORES'
  }, [ownerSelecionado])

  // ✅ Só exibir UI de TipoSessao se já houver horário E se o dono selecionado for professor
  const showTipoSessaoUI = Boolean(horario) && selectedOwnerIsProfessor

  // ===== ✅ APOIADO (apenas se DONO é professor e tipoSessao = AULA) =====
  const showApoiadoUI = showTipoSessaoUI && tipoSessao === 'AULA' && !isNoite
  const [isApoiado, setIsApoiado] = useState<boolean>(false)

  // busca/seleção de usuário apoiado
  const [apoiadoBusca, setApoiadoBusca] = useState<string>('')
  const [apoiadoResultados, setApoiadoResultados] = useState<Usuario[]>([])
  const [apoiadoSelecionado, setApoiadoSelecionado] = useState<Usuario | null>(null)

  // observação (vai para campo obs no backend)
  const [obs, setObs] = useState<string>('')

  // limpar UI de apoiado quando deixar de ser aplicável
  useEffect(() => {
    if (!showApoiadoUI) {
      setIsApoiado(false)
      setApoiadoBusca('')
      setApoiadoResultados([])
      setApoiadoSelecionado(null)
    }
  }, [showApoiadoUI])

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

  // Busca de usuários cadastrados — agora esperamos { id, nome, celular, tipo? }
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

        // 🔤 filtro no front ignorando acentos
        const qNorm = normalizeText(buscaUsuario)
        const filtrados = (data || []).filter((u) =>
          normalizeText(u.nome).includes(qNorm)
        )

        setUsuariosEncontrados(filtrados)
      } catch (err) {
        console.error(err)
      }
    }

    const delay = setTimeout(buscar, 300)
    return () => clearTimeout(delay)
  }, [API_URL, buscaUsuario])

  // Busca de usuário APOIADO
  useEffect(() => {
    const buscar = async () => {
      if (!isApoiado || apoiadoBusca.trim().length < 2) {
        setApoiadoResultados([])
        return
      }
      try {
        const { data } = await axios.get<Usuario[]>(`${API_URL}/clientes`, {
          params: { nome: apoiadoBusca },
          withCredentials: true,
        })

        // 🔤 filtro no front ignorando acentos
        const qNorm = normalizeText(apoiadoBusca)
        const filtrados = (data || []).filter((u) =>
          normalizeText(u.nome).includes(qNorm)
        )

        setApoiadoResultados(filtrados)
      } catch (err) {
        console.error(err)
      }
    }
    const delay = setTimeout(buscar, 300)
    return () => clearTimeout(delay)
  }, [API_URL, isApoiado, apoiadoBusca])

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
        data && (data.erro || data.message || data.msg)
          ? String(data.erro || data.message || data.msg)
          : ''

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

    // Validação extra do fluxo Apoiado
    if (showApoiadoUI && isApoiado) {
      if (!apoiadoSelecionado?.id) {
        setFeedback({ kind: 'error', text: 'Selecione o usuário que receberá o apoio.' })
        return
      }
      // 🚦 NOVO: só permite tipos elegíveis (CLIENTE_APOIADO + admins/professor)
      if (!isUsuarioElegivelApoio(apoiadoSelecionado)) {
        const msg =
          'O usuário selecionado não é elegível para apoio (permitido: CLIENTE_APOIADO, ADMIN_MASTER, ADMIN_ATENDENTE ou ADMIN_PROFESSORES).'
        setFeedback({ kind: 'error', text: msg })
        toast.error(msg)
        return
      }
    }

    const usuarioIdTemp = jogadores[0]?.id

    const payload: any = {
      data,
      horario,
      esporteId: String(esporteSelecionado),
      quadraId: String(quadraSelecionada),
      // ✅ Envia o tipo da sessão (AULA/JOGO)
      tipoSessao,
      jogadoresIds: jogadores.map((j) => String(j.id)),
      // concatena "Nome Telefone" para manter compatibilidade com o backend atual
      convidadosNomes:
        ownerGuestNome.trim()
          ? [`${ownerGuestNome.trim()} ${ownerGuestTelefone.trim()}`.trim()]
          : undefined,
    }
    if (usuarioIdTemp) payload.usuarioId = String(usuarioIdTemp)

    // Campos Apoiado (apenas se aplicável)
    if (showApoiadoUI) {
      payload.isApoiado = Boolean(isApoiado)
      if (isApoiado && apoiadoSelecionado?.id) {
        payload.apoiadoUsuarioId = String(apoiadoSelecionado.id)
      }
      if (obs.trim()) payload.obs = obs.trim()
    } else {
      if (obs.trim()) payload.obs = obs.trim()
    }

    setSalvando(true)
    try {
      // 1) cria o agendamento
      const { data: novo } = await axios.post(`${API_URL}/agendamentos`, payload, {
        withCredentials: true,
      })

      // 🔔 AVISO DE MULTA (somente se o backend aplicou multa automática)
      const multaValor = Number(novo?.multa || 0)
      if (multaValor > 0) {
        const valorFmt = multaValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        toast.warning(`Multa aplicada de ${valorFmt} por agendar em horário que já passou.`)
      }

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
      setApoiadoBusca('')
      setApoiadoResultados([])
      setApoiadoSelecionado(null)
      setIsApoiado(false)
      setObs('')

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

  // 🔧 garante boolean (evita 'boolean | Usuario | null')
  const selecionadoInvalido: boolean = !!(
    showApoiadoUI &&
    isApoiado &&
    apoiadoSelecionado &&
    !isUsuarioElegivelApoio(apoiadoSelecionado)
  )

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
        className="w-full p-2 border rounded mb-2"
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

      {/* ✅ Tipo de Sessão (Aula/Jogo) — só aparece se HÁ usuário e ele é ADMIN_PROFESSORES */}
      {showTipoSessaoUI && (
        <div className="mb-4">
          <label className="block mb-1 font-medium">Tipo de Agendamento</label>

          {isNoite ? (
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm bg-gray-100 border border-gray-200 text-gray-700">
              <span className="font-semibold">Jogo</span>
              <span className="text-[11px] text-gray-500">(automático a partir das 18h)</span>
            </div>
          ) : (
            <div className="inline-flex gap-2">
              <button
                type="button"
                onClick={() => setTipoSessao('AULA')}
                className={`px-3 py-1 rounded-md border text-sm ${
                  tipoSessao === 'AULA'
                    ? 'bg-orange-100 border-orange-500 text-orange-700'
                    : 'bg-gray-100 border-gray-300 text-gray-700'
                }`}
              >
                Aula
              </button>
              <button
                type="button"
                onClick={() => setTipoSessao('JOGO')}
                className={`px-3 py-1 rounded-md border text-sm ${
                  tipoSessao === 'JOGO'
                    ? 'bg-orange-100 border-orange-500 text-orange-700'
                    : 'bg-gray-100 border-gray-300 text-gray-700'
                }`}
              >
                Jogo
              </button>
            </div>
          )}

          <p className="text-[11px] text-gray-500 mt-1">
            A partir das 18:00 o sistema define automaticamente como <b>Jogo</b>.
          </p>
        </div>
      )}

      {/* ===== ✅ Fluxo APOIADO (só quando dono é professor e tipo=AULA) ===== */}
      {showApoiadoUI && (
        <div className="mb-4 rounded-lg border border-gray-200 p-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <label className="font-medium">Apoiado</label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={isApoiado}
                onChange={(e) => setIsApoiado(e.target.checked)}
              />
              <span>Este agendamento é de aluno apoiado?</span>
            </label>
          </div>

          {isApoiado && (
            <>
              <div className="mt-3">
                <label className="block mb-1 font-medium">Selecionar Usuário Apoiado</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded mb-2"
                  placeholder="Buscar por nome do usuário apoiado"
                  value={apoiadoBusca}
                  onChange={(e) => {
                    setApoiadoBusca(e.target.value)
                    setApoiadoSelecionado(null)
                  }}
                />

                {/* resultados de busca */}
                {apoiadoResultados.length > 0 && !apoiadoSelecionado && (
                  <ul className="border rounded mb-2 max-h-60 overflow-y-auto divide-y">
                    {apoiadoResultados.map((u) => {
                      const tag = norm(u.tipo)
                      const ehElegivel = isUsuarioElegivelApoio(u)
                      return (
                        <li
                          key={String(u.id)}
                          className="p-2 hover:bg-gray-100 cursor-pointer"
                          onClick={() => {
                            setApoiadoSelecionado(u)
                            setApoiadoResultados([])
                            setApoiadoBusca(u.nome)
                          }}
                          title={u.celular || ''}
                        >
                          <div className="font-medium">{u.nome}</div>
                          <div className="text-[11px] text-gray-600">
                            {tag || 'SEM TIPO'}
                            {ehElegivel ? ' • elegível para apoio' : ' • não elegível'}
                          </div>
                          {u.celular && <div className="text-xs text-gray-600">{u.celular}</div>}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* selecionado */}
                {apoiadoSelecionado && (
                  <div
                    className={`text-sm rounded px-3 py-2 border
                    ${isUsuarioElegivelApoio(apoiadoSelecionado)
                      ? 'text-green-700 bg-green-50 border-green-200'
                      : 'text-amber-800 bg-amber-50 border-amber-200'}
                  `}
                  >
                    Usuário apoiado selecionado: <b>{apoiadoSelecionado.nome}</b>
                    {!isUsuarioElegivelApoio(apoiadoSelecionado) && (
                      <span className="block text-[11px] mt-1">
                        Atenção: este usuário não é elegível para apoio
                        (permitido: <b>CLIENTE_APOIADO, ADMIN_MASTER, ADMIN_ATENDENTE, ADMIN_PROFESSORES</b>).
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

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
                {/* opcional: exibe o tipo no resultado para facilitar */}
                {u.tipo && (
                  <div className="text-[11px] text-gray-500">
                    {norm(u.tipo)}
                  </div>
                )}
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
                  {j.tipo && <span className="text-[10px] ml-1 opacity-70">{norm(j.tipo)}</span>}
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
            disabled={salvando || selecionadoInvalido}
            aria-busy={salvando}
            title={
              selecionadoInvalido
                ? 'O usuário selecionado não é elegível para apoio.'
                : undefined
            }
          >
            {salvando ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="w-4 h-4" /> <span>Enviando…</span>
              </span>
            ) : (
              'Confirmar Agendamento'
            )}
          </button>

          {/* dica quando estiver inválido */}
          {selecionadoInvalido && (
            <p className="mt-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              O apoiado selecionado não é elegível para apoio.
              Tipos permitidos: <b>CLIENTE_APOIADO, ADMIN_MASTER, ADMIN_ATENDENTE, ADMIN_PROFESSORES</b>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
