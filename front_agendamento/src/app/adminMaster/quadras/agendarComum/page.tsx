'use client'

import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback
} from 'react'
import axios from 'axios'
import Spinner from '@/components/Spinner'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import Image from 'next/image'
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import AppImage from '@/components/AppImage'

type Esporte = { id: number | string; nome: string }

// Agora traz também o celular (telefone)
type Usuario = {
  id: number | string
  nome: string
  celular?: string | null
  tipo?: string | null // ex.: 'ADMIN_PROFESSORES', 'CLIENTE', 'CLIENTE_APOIADO', etc.
}

type QuadraAPI = {
  id?: number | string
  quadraId?: number | string
  nome: string
  numero: number
  logoUrl?: string | null
  imagem?: string | null
  arquivo?: string | null
}

type Quadra = {
  quadraId: number | string
  nome: string
  numero: number
  logoUrl?: string
}

type DisponibilidadeQuadra = Quadra & { disponivel?: boolean }

type Feedback = { kind: 'success' | 'error' | 'info'; text: string }

type TipoSessao = 'AULA' | 'JOGO'

const SP_TZ = 'America/Sao_Paulo'

const todayStrSP = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d)

const hourStrSP = (d = new Date()) => {
  const hh = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SP_TZ,
      hour: '2-digit',
      hour12: false
    }).format(d),
    10
  )
  const clamped = Math.min(23, Math.max(7, hh)) // janela 07..23
  return `${String(clamped).padStart(2, '0')}:00`
}

const formatarDataBR = (iso?: string) => {
  if (!iso) return 'Selecione uma data'
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

function isoFromDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/* ===== Helpers mínimos ===== */
const norm = (s?: string | null) => String(s || '').trim().toUpperCase()

// ✅ tipos permitidos como "apoiado" (mesma regra do backend)
const APOIADO_TIPOS_PERMITIDOS = [
  'CLIENTE_APOIADO',
  'ADMIN_MASTER',
  'ADMIN_ATENDENTE',
  'ADMIN_PROFESSORES'
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

  // 🔹 estados do calendário/horário customizados (mesmo padrão da Home)
  const [dataPickerAberto, setDataPickerAberto] = useState(false)
  const [mesExibido, setMesExibido] = useState(() => {
    const base = data ? new Date(data + 'T00:00:00') : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const [horarioAberto, setHorarioAberto] = useState(false)
  const horarioWrapperRef = useRef<HTMLDivElement | null>(null)

  const [quadrasDisponiveis, setQuadrasDisponiveis] = useState<Quadra[]>([])
  const [quadraSelecionada, setQuadraSelecionada] = useState<string>('')

  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // busca/seleção de jogadores cadastrados (agora com telefone)
  const [buscaUsuario, setBuscaUsuario] = useState<string>('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<Usuario[]>([])
  const [jogadores, setJogadores] = useState<Usuario[]>([])

  // convidados "manuais" terão id começando com "guest-"
  const jogadoresCadastrados = useMemo(
    () => jogadores.filter((j) => !String(j.id).startsWith('guest-')),
    [jogadores]
  )

  // ✅ Quem é o DONO atual?
  // preferimos o primeiro jogador cadastrado; se não tiver, usamos o primeiro da lista
  const ownerSelecionado = jogadoresCadastrados[0] || jogadores[0]

  const selectedOwnerIsProfessor = useMemo(() => {
    const t = norm(ownerSelecionado?.tipo)
    return t === 'ADMIN_PROFESSORES'
  }, [ownerSelecionado])

  // convidado como DONO (opcional, agora com nome e telefone separados)
  const [ownerGuestNome, setOwnerGuestNome] = useState<string>('')
  const [ownerGuestTelefone, setOwnerGuestTelefone] = useState<string>('')

  // feedback do submit
  const [salvando, setSalvando] = useState<boolean>(false)

  // --- guardar o parâmetro de esporte (pode vir id OU nome) para mapear quando esportes carregarem
  const [esporteParam, setEsporteParam] = useState<string>('')

  // ✅ Aula x Jogo (agora guiado pelo backend)
  const [tipoSessao, setTipoSessao] = useState<TipoSessao>('AULA')
  const [permitidos, setPermitidos] = useState<TipoSessao[]>([])
  const [loadingPermitidos, setLoadingPermitidos] = useState<boolean>(false)

  // ✅ Só exibir UI de TipoSessao se já houver horário E se o dono selecionado for professor
  const showTipoSessaoUI = Boolean(horario) && selectedOwnerIsProfessor

  // ===== ✅ APOIADO (só quando dono é professor, tipo=AULA e AULA está permitido) =====
  const showApoiadoUI =
    showTipoSessaoUI && permitidos.includes('AULA') && tipoSessao === 'AULA'
  const [isApoiado, setIsApoiado] = useState<boolean>(false)

  // busca/seleção de usuário apoiado
  const [apoiadoBusca, setApoiadoBusca] = useState<string>('')
  const [apoiadoResultados, setApoiadoResultados] = useState<Usuario[]>([])
  const [apoiadoSelecionado, setApoiadoSelecionado] = useState<Usuario | null>(null)

  // observação (vai para campo obs no backend)
  const [obs, setObs] = useState<string>('')

  // 🔄 loading específico para quadras
  const [loadingQuadras, setLoadingQuadras] = useState<boolean>(false)

  // 🔄 logos das quadras (para exibir imagem)
  const [quadraLogos, setQuadraLogos] = useState<Record<string, string>>({})

  // helper de URL absoluta
  const toAbs = useCallback(
    (u?: string | null) => {
      if (!u) return ''
      if (/^(https?:|data:|blob:)/i.test(u)) return u
      if (u.startsWith('/')) return `${API_URL}${u}`
      return `${API_URL}/${u}`
    },
    [API_URL]
  )

  const buildQuadraLogo = useCallback(
    (q: Partial<QuadraAPI>) => {
      const candidate = q.logoUrl || q.imagem || q.arquivo || ''
      const normalized =
        candidate &&
          !/^(https?:|data:|blob:)/i.test(String(candidate)) &&
          !String(candidate).startsWith('/') &&
          !String(candidate).includes('/')
          ? `/uploads/quadras/${candidate}`
          : String(candidate)

      return toAbs(normalized)
    },
    [toAbs]
  )

  // ✅ controle de imagem carregada por quadra
  const [quadraImgLoaded, setQuadraImgLoaded] = useState<Record<string, boolean>>({})

  const marcarQuadraCarregada = (id: string) => {
    setQuadraImgLoaded(prev => ({
      ...prev,
      [id]: true
    }))
  }

  // carregar /quadras para mapear as imagens (logoUrl/imagem/arquivo)
  useEffect(() => {
    const loadQuadrasLogos = async () => {
      try {
        const { data } = await axios.get<QuadraAPI[]>(`${API_URL}/quadras`, {
          withCredentials: true
        })
        const map: Record<string, string> = {}
          ; (data || []).forEach(q => {
            const id = String(q.id ?? q.quadraId ?? '')
            if (!id) return
            const logo = buildQuadraLogo(q)
            if (logo) map[id] = logo
          })
        setQuadraLogos(map)
      } catch (err) {
        console.warn('Não foi possível carregar /quadras para logos.', err)
      }
    }

    loadQuadrasLogos()
  }, [API_URL, buildQuadraLogo])

  // limpar UI de apoiado quando deixar de ser aplicável
  useEffect(() => {
    if (!showApoiadoUI) {
      setIsApoiado(false)
      setApoiadoBusca('')
      setApoiadoResultados([])
      setApoiadoSelecionado(null)
    }
  }, [showApoiadoUI])

  // ler params vindos da Home e pré-preencher (ou usar padrão SP se não vier nada)
  useEffect(() => {
    const d = searchParams.get('data')
    const h = searchParams.get('horario')
    const q = searchParams.get('quadraId')
    const e = searchParams.get('esporteId') || searchParams.get('esporte') // aceita id OU nome

    setData(d || todayStrSP())
    setHorario(h || hourStrSP())
    if (q) setQuadraSelecionada(q)
    if (e) setEsporteParam(e)
  }, [searchParams])

  // manter o mês em sincronia se data mudar
  useEffect(() => {
    if (!data) return
    const base = new Date(data + 'T00:00:00')
    setMesExibido(new Date(base.getFullYear(), base.getMonth(), 1))
  }, [data])

  // fechar dropdown de horário ao clicar fora (igual Home)
  useEffect(() => {
    if (!horarioAberto) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        horarioWrapperRef.current &&
        !horarioWrapperRef.current.contains(event.target as Node)
      ) {
        setHorarioAberto(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [horarioAberto])

  useEffect(() => {
    if (!horarioAberto) return

    const selectedId = horario ? `hora-${horario}` : 'hora-default'
    const el = document.getElementById(selectedId)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [horarioAberto, horario])

  // Esportes
  useEffect(() => {
    axios
      .get<Esporte[]>(`${API_URL}/esportes`, { withCredentials: true })
      .then(res => setEsportes(res.data || []))
      .catch(err => {
        console.error(err)
        setFeedback({ kind: 'error', text: 'Falha ao carregar esportes.' })
      })
  }, [API_URL])

  // quando a lista de esportes chegar, mapeia o param (id ou nome) para o ID correto
  useEffect(() => {
    if (!esportes.length || !esporteParam) return

    // tenta por ID
    const byId = esportes.find(e => String(e.id) === String(esporteParam))
    if (byId) {
      setEsporteSelecionado(String(byId.id))
      return
    }
    // tenta por NOME (case-insensitive)
    const byName = esportes.find(
      e => e.nome?.trim().toLowerCase() === esporteParam.trim().toLowerCase()
    )
    if (byName) setEsporteSelecionado(String(byName.id))
  }, [esportes, esporteParam])

  // Disponibilidade das quadras
  useEffect(() => {
    const buscarDisponibilidade = async () => {
      if (!data || !esporteSelecionado || !horario) {
        setQuadrasDisponiveis([])
        setLoadingQuadras(false)
        return
      }
      setFeedback(null)
      setLoadingQuadras(true)

      try {
        const { data: disp } = await axios.get<DisponibilidadeQuadra[]>(
          `${API_URL}/disponibilidade`,
          {
            params: { data, horario, esporteId: esporteSelecionado },
            withCredentials: true
          }
        )

        const filtradas = (disp || [])
          .filter(q => q.disponivel !== false)
          .map(({ quadraId, nome, numero }) => {
            const id = String(quadraId)
            return {
              quadraId,
              nome,
              numero,
              logoUrl: quadraLogos[id] || ''
            }
          })

        setQuadrasDisponiveis(filtradas)
        if (filtradas.length === 0) {
          setFeedback({
            kind: 'info',
            text: 'Nenhuma quadra disponível para este horário.'
          })
        } else {
          setFeedback(null)
        }
      } catch (err) {
        console.error(err)
        setFeedback({ kind: 'error', text: 'Erro ao verificar disponibilidade.' })
      } finally {
        setLoadingQuadras(false)
      }
    }

    buscarDisponibilidade()
  }, [API_URL, data, esporteSelecionado, horario, quadraLogos])

  // ✅ NOVO: buscar tipos de sessão permitidos (AULA/JOGO) para esporte+data+horário
  useEffect(() => {
    const fetchPermitidos = async () => {
      setPermitidos([])
      if (!data || !esporteSelecionado || !horario) return
      try {
        setLoadingPermitidos(true)
        const { data: resp } = await axios.get<{ allow: TipoSessao[] }>(
          `${API_URL}/agendamentos/_sessoes-permitidas`,
          {
            params: { esporteId: esporteSelecionado, data, horario },
            withCredentials: true
          }
        )
        const allow = Array.isArray(resp?.allow) ? (resp.allow as TipoSessao[]) : []
        setPermitidos(allow)

        // Ajuste automático do tipo quando dono for professor:
        // - se só 1 permitido, trava nesse
        // - se 2 e o atual não for permitido (ex.: mudou o horário), cai para o primeiro
        if (selectedOwnerIsProfessor) {
          if (allow.length === 1) {
            setTipoSessao(allow[0])
          } else if (allow.length >= 2 && !allow.includes(tipoSessao)) {
            setTipoSessao(allow[0])
          }
        }
      } catch (err) {
        console.error(err)
        setPermitidos([])
      } finally {
        setLoadingPermitidos(false)
      }
    }

    fetchPermitidos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL, data, esporteSelecionado, horario, selectedOwnerIsProfessor])

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
          withCredentials: true
        })
        // Ideal: backend devolver também "tipo" (quando usuário for professor/apoiado)
        setUsuariosEncontrados(data || [])
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
          withCredentials: true
        })
        setApoiadoResultados(data || [])
      } catch (err) {
        console.error(err)
      }
    }
    const delay = setTimeout(buscar, 300)
    return () => clearTimeout(delay)
  }, [API_URL, isApoiado, apoiadoBusca])

  const adicionarJogador = (usuario: Usuario) => {
    setJogadores(prev =>
      prev.find(j => String(j.id) === String(usuario.id)) ? prev : [...prev, usuario]
    )
    setBuscaUsuario('')
    setUsuariosEncontrados([])
    setFeedback(null)
  }

  const removerJogador = (id: number | string) => {
    setJogadores(prev => prev.filter(j => String(j.id) !== String(id)))
  }

  // ✅ adicionar convidado manual à lista de jogadores
  const adicionarConvidadoManual = () => {
    const nome = ownerGuestNome.trim()
    const telefone = ownerGuestTelefone.trim()

    if (!nome) {
      setFeedback({
        kind: 'error',
        text: 'Informe o nome do convidado para adicioná-lo.'
      })
      return
    }

    const novoConvidado: Usuario = {
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      nome,
      celular: telefone || undefined,
      tipo: 'CONVIDADO'
    }

    setJogadores(prev => {
      const jaExiste = prev.some(
        j =>
          norm(j.nome) === norm(novoConvidado.nome) &&
          (j.celular || '') === (novoConvidado.celular || '')
      )
      return jaExiste ? prev : [...prev, novoConvidado]
    })

    setFeedback(null)
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

    // Se o dono for professor e existir restrição de sessão, valida no front também
    if (selectedOwnerIsProfessor) {
      if (permitidos.length === 0) {
        setFeedback({
          kind: 'error',
          text: 'Neste horário não há sessão permitida para este esporte.'
        })
        return
      }
      if (!permitidos.includes(tipoSessao)) {
        setFeedback({
          kind: 'error',
          text: `Tipo de sessão inválido para o horário. Permitidos: ${permitidos.join(', ')}.`
        })
        return
      }
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

    // separa cadastrados x convidados
    const soCadastrados = jogadoresCadastrados
    const convidadosDaLista = jogadores
      .filter(j => String(j.id).startsWith('guest-'))
      .map(j => `${j.nome}${j.celular ? ` ${j.celular}` : ''}`.trim())

    const convidadoDono =
      ownerGuestNome.trim()
        ? `${ownerGuestNome.trim()} ${ownerGuestTelefone.trim()}`.trim()
        : ''

    const todosConvidados: string[] = [
      ...(convidadoDono ? [convidadoDono] : []),
      ...convidadosDaLista
    ]

    const usuarioIdTemp = soCadastrados[0]?.id

    const payload: any = {
      data,
      horario,
      esporteId: String(esporteSelecionado),
      quadraId: String(quadraSelecionada),
      jogadoresIds: soCadastrados.map(j => String(j.id))
    }

    if (todosConvidados.length > 0) {
      payload.convidadosNomes = todosConvidados
    }

    // ✅ Envie tipoSessao somente quando o dono for professor (o backend valida/auto-define)
    if (selectedOwnerIsProfessor) {
      payload.tipoSessao = tipoSessao
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
        withCredentials: true
      })

      // 🔔 AVISO DE MULTA (somente se o backend aplicou multa automática)
      const multaValor = Number(novo?.multa || 0)
      if (multaValor > 0) {
        const valorFmt = multaValor.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        })
        toast.warning(
          `Multa aplicada de ${valorFmt} por agendar em horário que já passou.`
        )
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
    '07:00',
    '08:00',
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '18:00',
    '19:00',
    '20:00',
    '21:00',
    '22:00',
    '23:00'
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

  // Estados auxiliares para UI do tipo de sessão
  const onlyOne = permitidos.length === 1 ? permitidos[0] : null
  const noneAllowed = permitidos.length === 0

  return (
    <div className="min-h-screen flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] px-5 sm:px-10 py-7 sm:py-9 relative">
        {/* BOTÃO X (fechar) */}
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute right-6 top-5 text-gray-400 hover:text-gray-600 text-3xl leading-none"
          aria-label="Fechar"
        >
          ×
        </button>

        {/* TÍTULO */}
        <header className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-orange-500">
            Agendar Quadra Avulsa
          </h1>
        </header>

        {/* ALERTA */}
        {feedback && (
          <div
            className={`mb-6 rounded-md border px-3 py-2 text-sm ${alertClasses}`}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}
          >
            {feedback.text}
          </div>
        )}

        {/* DIA E HORÁRIO – em card cinza com ícones fora do botão */}
        <section className="mb-6">
          <p className="text-sm font-semibold text-orange-600 mb-3">
            Dia e horário:
          </p>

          <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* DATA – ícone fora + botão */}
              <div>
                <p className="text-xs text-gray-500 mb-1">Escolha o dia:</p>
                <div className="flex items-center gap-2">
                  {/* ÍCONE DO CALENDÁRIO */}
                  <Image
                    src="/icons/iconcalendar.png"
                    alt="Calendário"
                    width={24}
                    height={24}
                    className="w-6 h-6"
                  />

                  <div className="relative w-full">
                    <button
                      type="button"
                      onClick={() => setDataPickerAberto(v => !v)}
                      className="flex items-center justify-between h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
                    >
                      <span className="text-sm text-gray-800">
                        {formatarDataBR(data)}
                      </span>

                      <ChevronDown
                        className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${dataPickerAberto ? 'rotate-180' : ''
                          }`}
                      />
                    </button>

                    {dataPickerAberto && (
                      <div className="absolute z-20 mt-1 right-0 w-full rounded-lg border border-gray-200 bg-white shadow-lg p-3">
                        {/* Cabeçalho: mês/ano + setas */}
                        <div className="flex items-center justify-between mb-2">
                          <button
                            type="button"
                            onClick={() =>
                              setMesExibido(
                                prev =>
                                  new Date(
                                    prev.getFullYear(),
                                    prev.getMonth() - 1,
                                    1
                                  )
                              )
                            }
                            className="p-1 rounded hover:bg-gray-100"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>

                          <span className="font-semibold text-sm">
                            {mesExibido.toLocaleDateString('pt-BR', {
                              month: 'long',
                              year: 'numeric'
                            })}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              setMesExibido(
                                prev =>
                                  new Date(
                                    prev.getFullYear(),
                                    prev.getMonth() + 1,
                                    1
                                  )
                              )
                            }
                            className="p-1 rounded hover:bg-gray-100"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Dias da semana */}
                        <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
                          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => (
                            <div key={d} className="text-center">
                              {d}
                            </div>
                          ))}
                        </div>

                        {/* Dias do mês (6 linhas) */}
                        <div className="grid grid-cols-7 gap-1 text-sm">
                          {(() => {
                            const first = new Date(
                              mesExibido.getFullYear(),
                              mesExibido.getMonth(),
                              1
                            )
                            const startWeekday = first.getDay() // 0=Dom
                            const startDate = new Date(first)
                            startDate.setDate(first.getDate() - startWeekday)

                            const todayIso = isoFromDate(new Date())

                            return Array.from({ length: 42 }, (_, i) => {
                              const d = new Date(startDate)
                              d.setDate(startDate.getDate() + i)

                              const iso = isoFromDate(d)
                              const isCurrentMonth =
                                d.getMonth() === mesExibido.getMonth()
                              const isSelected = data === iso
                              const isToday = todayIso === iso

                              return (
                                <button
                                  key={iso}
                                  type="button"
                                  onClick={() => {
                                    setData(iso)
                                    setDataPickerAberto(false)
                                    setFeedback(null)
                                  }}
                                  className={[
                                    'h-8 w-8 rounded-full flex items-center justify-center mx-auto',
                                    !isCurrentMonth
                                      ? 'text-gray-300'
                                      : 'text-gray-800',
                                    isToday && !isSelected
                                      ? 'border border-orange-400'
                                      : '',
                                    isSelected
                                      ? 'bg-orange-600 text-white font-semibold'
                                      : 'hover:bg-orange-50'
                                  ].join(' ')}
                                >
                                  {d.getDate()}
                                </button>
                              )
                            })
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* HORÁRIO – ícone fora + botão */}
              <div>
                <p className="text-xs text-gray-500 mb-1">Escolha o horário:</p>
                <div
                  ref={horarioWrapperRef}
                  className="flex items-center gap-2 w-full"
                >
                  {/* ÍCONE DO RELÓGIO */}
                  <Image
                    src="/icons/iconhoraio.png"
                    alt="Relógio"
                    width={24}
                    height={24}
                    className="w-6 h-6"
                  />

                  <div className="relative w-full">
                    <button
                      type="button"
                      onClick={() => setHorarioAberto(v => !v)}
                      className="flex items-center justify-between h-9 border border-gray-300 rounded-md px-3 text-sm bg-white w-full hover:border-gray-900 hover:shadow-sm transition"
                    >
                      <span className="text-sm text-gray-800">
                        {horario || 'Selecione um horário'}
                      </span>

                      <ChevronDown
                        className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${horarioAberto ? 'rotate-180' : ''
                          }`}
                      />
                    </button>

                    {horarioAberto && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm">
                        {/* opção "default" */}
                        <button
                          id="hora-default"
                          type="button"
                          onClick={() => {
                            setHorario('')
                            setHorarioAberto(false)
                            setFeedback(null)
                          }}
                          className={`w-full text-left px-3 py-1.5 ${horario === ''
                              ? 'bg-orange-100 text-orange-700 font-semibold'
                              : 'hover:bg-orange-50 text-gray-800'
                            }`}
                        >
                          Selecione um horário
                        </button>

                        {horas.map(h => {
                          const selecionado = horario === h
                          return (
                            <button
                              key={h}
                              id={`hora-${h}`}
                              type="button"
                              onClick={() => {
                                setHorario(h)
                                setHorarioAberto(false)
                                setFeedback(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 ${selecionado
                                  ? 'bg-orange-100 text-orange-700 font-semibold'
                                  : 'hover:bg-orange-50 text-gray-800'
                                }`}
                            >
                              {h}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TIPO DE SESSÃO (AULA / JOGO) – chips laranjas */}
        {showTipoSessaoUI && (
          <section className="mb-6">
            <p className="text-sm font-semibold text-gray-800 mb-2">
              Tipo de agendamento:
            </p>

            {loadingPermitidos ? (
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs bg-gray-100 border border-gray-200 text-gray-700">
                <Spinner size="w-4 h-4" />
                <span>Verificando opções…</span>
              </div>
            ) : noneAllowed ? (
              <div className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700">
                <span>
                  Nenhuma sessão permitida neste horário para o esporte
                  selecionado.
                </span>
              </div>
            ) : onlyOne ? (
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs bg-gray-100 border border-gray-200 text-gray-700">
                <span className="font-semibold">
                  {onlyOne === 'AULA' ? 'Aula' : 'Jogo'}
                </span>
                <span className="text-[10px] text-gray-500">
                  (definido pelas regras do esporte)
                </span>
              </div>
            ) : (
              <div className="inline-flex gap-2">
                <button
                  type="button"
                  onClick={() => setTipoSessao('AULA')}
                  disabled={!permitidos.includes('AULA')}
                  className={`px-4 py-1.5 rounded-full border text-xs font-medium transition ${tipoSessao === 'AULA'
                      ? 'bg-orange-100 border-orange-500 text-orange-700'
                      : 'bg-gray-100 border-gray-300 text-gray-700'
                    } ${!permitidos.includes('AULA')
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-orange-50'
                    }`}
                >
                  Aula
                </button>
                <button
                  type="button"
                  onClick={() => setTipoSessao('JOGO')}
                  disabled={!permitidos.includes('JOGO')}
                  className={`px-4 py-1.5 rounded-full border text-xs font-medium transition ${tipoSessao === 'JOGO'
                      ? 'bg-orange-100 border-orange-500 text-orange-700'
                      : 'bg-gray-100 border-gray-300 text-gray-700'
                    } ${!permitidos.includes('JOGO')
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-orange-50'
                    }`}
                >
                  Jogo
                </button>
              </div>
            )}

            <p className="text-[11px] text-gray-500 mt-1">
              As opções seguem as janelas configuradas para o esporte no
              dia/horário escolhido.
            </p>
          </section>
        )}

        {/* ESPORTE – em card cinza com ícone fora do select */}
        <section className="mb-6">
          <p className="text-sm font-semibold text-orange-600 mb-2">Esporte:</p>

          <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-3">
            <p className="text-xs text-gray-500 mb-2">Escolha o esporte</p>

            <div className="flex items-center gap-2">
              {/* ÍCONE DO ESPORTE */}
              <Image
                src="/icons/icon_quadras.png"
                alt="Esporte"
                width={24}
                height={24}
                className="w-6 h-6 opacity-70"
              />

              <div className="relative w-full">
                <select
                  className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 pr-10 text-sm text-gray-700
                     focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400
                     appearance-none"
                  value={esporteSelecionado}
                  onChange={e => {
                    setEsporteSelecionado(e.target.value)
                    setFeedback(null)
                  }}
                >
                  <option value="">Selecione o esporte</option>
                  {esportes.map(e => (
                    <option key={String(e.id)} value={String(e.id)}>
                      {e.nome}
                    </option>
                  ))}
                </select>

                {/* setinha usando o mesmo ícone do dia/horário */}
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
              </div>
            </div>
          </div>
        </section>

        {/* APOIADO (quando aplicável) */}
        {showApoiadoUI && (
          <section className="mb-6">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-sm font-semibold text-gray-800">Apoiado</p>
                <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={isApoiado}
                    onChange={e => setIsApoiado(e.target.checked)}
                  />
                  <span>Este agendamento é de aluno apoiado?</span>
                </label>
              </div>

              {isApoiado && (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Selecionar usuário apoiado
                  </label>
                  <input
                    type="text"
                    className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm bg-white mb-2
                               focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    placeholder="Buscar por nome do usuário apoiado"
                    value={apoiadoBusca}
                    onChange={e => {
                      setApoiadoBusca(e.target.value)
                      setApoiadoSelecionado(null)
                    }}
                  />

                  {apoiadoResultados.length > 0 && !apoiadoSelecionado && (
                    <ul className="border border-gray-200 rounded-md bg-white max-h-60 overflow-y-auto divide-y text-sm">
                      {apoiadoResultados.map(u => {
                        const tag = norm(u.tipo)
                        const ehElegivel = isUsuarioElegivelApoio(u)
                        return (
                          <li
                            key={String(u.id)}
                            className="p-2 hover:bg-orange-50 cursor-pointer"
                            onClick={() => {
                              setApoiadoSelecionado(u)
                              setApoiadoResultados([])
                              setApoiadoBusca(u.nome)
                            }}
                            title={u.celular || ''}
                          >
                            <div className="font-medium text-gray-800">
                              {u.nome}
                            </div>
                            <div className="text-[11px] text-gray-600">
                              {tag || 'SEM TIPO'}
                              {ehElegivel
                                ? ' • elegível para apoio'
                                : ' • não elegível'}
                            </div>
                            {u.celular && (
                              <div className="text-[11px] text-gray-500">
                                {u.celular}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {apoiadoSelecionado && (
                    <div
                      className={`mt-2 text-xs rounded-md px-3 py-2 border ${isUsuarioElegivelApoio(apoiadoSelecionado)
                          ? 'text-green-700 bg-green-50 border-green-200'
                          : 'text-amber-800 bg-amber-50 border-amber-200'
                        }`}
                    >
                      Usuário apoiado selecionado:{' '}
                      <b>{apoiadoSelecionado.nome}</b>
                      {!isUsuarioElegivelApoio(apoiadoSelecionado) && (
                        <span className="block text-[11px] mt-1">
                          Atenção: este usuário não é elegível para apoio
                          (permitido:{' '}
                          <b>
                            CLIENTE_APOIADO, ADMIN_MASTER, ADMIN_ATENDENTE,
                            ADMIN_PROFESSORES
                          </b>
                          ).
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* JOGADORES */}
        <section className="mb-8">
          <p className="text-sm font-semibold text-orange-600 mb-3">
            Jogadores:
          </p>

          <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-5 space-y-5">
            {/* Jogadores cadastrados */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">
                Adicionar atletas cadastrados
              </p>
              <div className="flex items-center gap-3">
                <Image
                  src="/iconescards/icone-permanente.png"
                  alt="Atleta cadastrado"
                  width={20}
                  height={20}
                  className="w-5 h-5 opacity-80 hidden sm:block"
                />
                <input
                  type="text"
                  className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                             focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                  placeholder="Insira o nome do atleta cadastrado"
                  value={buscaUsuario}
                  onChange={e => setBuscaUsuario(e.target.value)}
                />
              </div>

              {usuariosEncontrados.length > 0 && (
                <ul className="mt-2 border border-gray-200 rounded-md bg-white max-h-60 overflow-y-auto divide-y text-sm">
                  {usuariosEncontrados.map(u => (
                    <li
                      key={String(u.id)}
                      className="px-3 py-2 hover:bg-orange-50 cursor-pointer"
                      onClick={() => adicionarJogador(u)}
                      title={u.celular || ''}
                    >
                      <div className="font-medium text-gray-800">{u.nome}</div>
                      {u.tipo && (
                        <div className="text-[11px] text-gray-500">
                          {norm(u.tipo)}
                        </div>
                      )}
                      {u.celular && (
                        <div className="text-[11px] text-gray-500">
                          {u.celular}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Convidado dono */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">
                Adicionar atletas convidados{' '}
                <span className="text-[11px] font-normal text-gray-500">
                  *jogadores sem cadastro no sistema
                </span>
              </p>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="flex-1 flex items-center gap-2">
                  <Image
                    src="/iconescards/icone-permanente.png"
                    alt="Convidado"
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-80 hidden sm:block"
                  />
                  <input
                    type="text"
                    className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                               focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    placeholder="Insira o nome do convidado (dono)"
                    value={ownerGuestNome}
                    onChange={e => setOwnerGuestNome(e.target.value)}
                  />
                </div>

                <div className="flex-1 flex items-center gap-2">
                  <Image
                    src="/iconescards/icone_phone.png"
                    alt="Telefone"
                    width={20}
                    height={20}
                    className="w-5 h-5 hidden sm:block"
                  />
                  <input
                    type="tel"
                    className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                               focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    placeholder="(00) 000000000"
                    value={ownerGuestTelefone}
                    onChange={e => setOwnerGuestTelefone(e.target.value)}
                  />
                </div>

                {/* Botão ADICIONAR convidado à lista */}
                <div className="flex justify-end sm:justify-start">
                  <button
                    type="button"
                    onClick={adicionarConvidadoManual}
                    disabled={!ownerGuestNome.trim()}
                    className="mt-2 sm:mt-0 inline-flex items-center justify-center h-10 px-3 rounded-md
                               border border-orange-500 bg-white text-[11px] font-semibold text-orange-600
                               hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed
                               transition-colors"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              <p className="mt-2 text-[11px] text-gray-500">
                *o atleta responsável pela reserva será o primeiro jogador a ser
                selecionado ou o convidado informado acima.
              </p>
            </div>

            {/* Lista de jogadores adicionados */}
            {jogadores.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Jogadores adicionados:
                </p>

                <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-4 justify-items-center">
                  {jogadores.map(j => (
                    <div key={j.id ?? j.nome} className="flex items-center gap-3">
                      {/* Card cinza do jogador */}
                      <div
                        className="flex-1 flex flex-col gap-0.5 px-4 py-1 rounded-md
                       bg-[#F4F4F4] border border-[#D3D3D3] shadow-sm
                       min-w-[180px] max-w-[200px]"
                      >
                        {/* Nome + ícone de usuário */}
                        <div className="flex items-center gap-1 text-[11px] text-[#555555] truncate">
                          <Image
                            src="/iconescards/icone-permanente.png"
                            alt="Atleta"
                            width={14}
                            height={14}
                            className="w-3.5 h-3.5 flex-shrink-0 opacity-80"
                          />
                          <span className="font-semibold truncate">
                            {j.nome}
                          </span>
                        </div>

                        {/* Telefone com ícone */}
                        {j.celular && (
                          <div className="flex items-center gap-1 text-[11px] text-[#777777] truncate">
                            <Image
                              src="/iconescards/icone_phone.png"
                              alt="Telefone"
                              width={12}
                              height={12}
                              className="w-3 h-3 flex-shrink-0"
                            />
                            <span className="truncate">{j.celular}</span>
                          </div>
                        )}

                        {/* Tipo */}
                        {j.tipo && (
                          <div className="flex items-center gap-1 text-[9px] text-[#999999] truncate">
                            <span className="truncate">{norm(j.tipo)}</span>
                          </div>
                        )}
                      </div>

                      {/* Botão remover */}
                      <button
                        type="button"
                        onClick={() => removerJogador(j.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-[2px] rounded-sm
                       border border-[#C73737] bg-[#FFE9E9] text-[#B12A2A] text-[10px] font-semibold
                       hover:bg-[#FFDADA] disabled:opacity-60
                       transition-colors shadow-[0_1px_0_rgba(0,0,0,0.05)]"
                      >
                        <X className="w-4 h-4" strokeWidth={4} />
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* QUADRAS */}
        <section>
          <p className="text-sm font-semibold text-gray-800 mb-3 text-orange-600">
            Quadras:
          </p>

          {loadingQuadras ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Spinner size="w-4 h-4" />
              <span>Carregando quadras disponíveis…</span>
            </div>
          ) : quadrasDisponiveis.length === 0 ? (
            <p className="text-xs text-gray-500">
              Selecione data, horário e esporte para ver as quadras disponíveis.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {quadrasDisponiveis.map(q => {
                  const selected = quadraSelecionada === String(q.quadraId)
                  const numeroFmt =
                    typeof q.numero === 'number' || typeof q.numero === 'string'
                      ? String(q.numero).padStart(2, '0')
                      : ''
                  const src = q.logoUrl || '/quadra.png'
                  const idStr = String(q.quadraId)

                  return (
                    <button
                      key={idStr}
                      type="button"
                      onClick={() => {
                        setQuadraSelecionada(idStr)
                        setFeedback(null)
                      }}
                      className={`flex flex-col overflow-hidden rounded-xl border shadow-sm transition ${selected
                          ? 'border-orange-500 shadow-[0_0_0_2px_rgba(233,122,31,0.35)]'
                          : 'border-gray-200 hover:border-orange-400 hover:shadow-md'
                        }`}
                    >
                      {/* imagem da quadra */}
                      <div className="relative w-full h-40 flex items-center justify-center">
                        {/* imagem (fica por baixo) */}
                        <AppImage
                          src={src}
                          alt={q.nome}
                          fill
                          className={`object-contain pointer-events-none select-none transition-opacity duration-150 ${quadraImgLoaded[idStr] ? "opacity-100" : "opacity-0"
                            }`}
                          fallbackSrc="/quadra.png"
                          onLoadingComplete={() => marcarQuadraCarregada(idStr)}
                        />

                        {/* overlay com spinner enquanto NÃO carregou */}
                        {!quadraImgLoaded[idStr] && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
                            <Spinner size="w-5 h-5" />
                          </div>
                        )}
                      </div>


                      {/* texto */}
                      <div className="px-3 py-3 bg-white text-center">
                        <p className="text-[11px] text-gray-500 mb-1">
                          Quadra {numeroFmt}
                        </p>
                        <p className="text-[12px] font-semibold text-gray-800 truncate">
                          {q.nome}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Botão final – Realizar Reserva */}
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={agendar}
                  disabled={salvando || selecionadoInvalido}
                  aria-busy={salvando}
                  className={`min-w-[340px] h-11 rounded-md border text-sm font-semibold ${salvando || selecionadoInvalido
                      ? 'border-orange-200 text-orange-200 bg-white cursor-not-allowed'
                      : 'border-orange-500 text-orange-700 bg-orange-100 hover-orange-200'
                    }`}
                  title={
                    selecionadoInvalido
                      ? 'O usuário selecionado não é elegível para apoio.'
                      : undefined
                  }
                >
                  {salvando ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner size="w-4 h-4" />
                      <span>Enviando…</span>
                    </span>
                  ) : (
                    'Realizar Reserva'
                  )}
                </button>
              </div>

              {selecionadoInvalido && (
                <p className="mt-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  O apoiado selecionado não é elegível para apoio. Tipos
                  permitidos:{' '}
                  <b>
                    CLIENTE_APOIADO, ADMIN_MASTER, ADMIN_ATENDENTE,
                    ADMIN_PROFESSORES
                  </b>
                  .
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
