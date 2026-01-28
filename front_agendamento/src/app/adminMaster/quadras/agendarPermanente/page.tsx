'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, useCallback } from 'react'
import axios from 'axios'
import { useRouter, useSearchParams } from 'next/navigation'
import { format, parseISO, addDays } from 'date-fns'
import SystemAlert, { AlertVariant } from '@/components/SystemAlert'
import Spinner from '@/components/Spinner'
import AppImage from '@/components/AppImage'
import Image from 'next/image'
import { ChevronDown } from 'lucide-react'

/** =========================
 *  TIPOS
========================= */

type QuadraDisponivel = {
  quadraId: string
  nome: string
  numero: number
  disponivel: boolean
  conflitoComum?: boolean
  conflitoPermanente?: boolean
  imagem?: string | null
  imagemUrl?: string | null
  logoUrl?: string | null
}

type QuadraAPI = {
  id?: string
  quadraId?: string
  nome: string
  numero: number
  logoUrl?: string | null
  imagem?: string | null
  arquivo?: string | null
}

type Esporte = { id: string; nome: string }

type UsuarioBusca = {
  id: string
  nome: string
  celular?: string | null
  tipo?: string | null
}

type ProximasDatasResp = {
  proximasDatasDisponiveis: string[]
  dataUltimoConflito: string | null
}

type Feedback = { kind: AlertVariant; text: string }

type TipoSessao = 'AULA' | 'JOGO'

const diasEnum = [
  'DOMINGO',
  'SEGUNDA',
  'TERCA',
  'QUARTA',
  'QUINTA',
  'SEXTA',
  'SABADO'
] as const

type DiaSemana = (typeof diasEnum)[number]

const DIA_LABEL: Record<DiaSemana, string> = {
  DOMINGO: 'Domingo',
  SEGUNDA: 'Segunda',
  TERCA: 'Terça',
  QUARTA: 'Quarta',
  QUINTA: 'Quinta',
  SEXTA: 'Sexta',
  SABADO: 'Sábado'
}

const DIA_IDX: Record<DiaSemana, number> = {
  DOMINGO: 0,
  SEGUNDA: 1,
  TERCA: 2,
  QUARTA: 3,
  QUINTA: 4,
  SEXTA: 5,
  SABADO: 6
}

const norm = (s?: string | null) => String(s || '').trim().toUpperCase()

const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

function proximaDataParaDiaSemana(diaSemana: DiaSemana, horario?: string): string {
  const target = DIA_IDX[diaSemana] ?? 0
  const now = new Date()
  let delta = (target - now.getDay() + 7) % 7

  if (delta === 0 && horario && /^\d{2}:\d{2}$/.test(horario)) {
    const [hh, mm] = horario.split(':').map(Number)
    const passou =
      now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= (mm ?? 0))
    if (passou) delta = 7
  }

  const d = addDays(now, delta)
  return format(d, 'yyyy-MM-dd')
}

export default function CadastrarPermanente() {
  const router = useRouter()
  const searchParams = useSearchParams()

  /** =========================
   *  STATES PRINCIPAIS
  ========================= */

  const [diaSemana, setDiaSemana] = useState<DiaSemana | ''>('')
  const [esporteId, setEsporteId] = useState<string>('') // sempre guarda o ID
  const [horario, setHorario] = useState<string>('')
  const [quadraId, setQuadraId] = useState<string>('')

  // tipo sessão (professor)
  const [tipoSessao, setTipoSessao] = useState<TipoSessao>('AULA')
  const [permitidos, setPermitidos] = useState<TipoSessao[]>([])
  const [loadingPermitidos, setLoadingPermitidos] = useState<boolean>(false)
  const [selectedOwnerIsProfessor, setSelectedOwnerIsProfessor] = useState<boolean>(false)

  // dono cadastrado
  const [usuarioId, setUsuarioId] = useState<string>('')
  const [busca, setBusca] = useState<string>('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([])
  const [carregandoUsuarios, setCarregandoUsuarios] = useState<boolean>(false)
  const [listaAberta, setListaAberta] = useState<boolean>(false)

  // convidado dono (manual)
  const [convidadoDonoNome, setConvidadoDonoNome] = useState<string>('')
  const [convidadoDonoTelefone, setConvidadoDonoTelefone] = useState<string>('')

  // ✅ novo: convidado confirmado (botão "Adicionar")
  const [convidadoSelecionado, setConvidadoSelecionado] = useState<boolean>(false)

  // listas principais
  const [esportes, setEsportes] = useState<Esporte[]>([])
  const [quadras, setQuadras] = useState<QuadraDisponivel[]>([])

  // conflitos com comum
  const [dataUltimoConflito, setDataUltimoConflito] = useState<string | null>(null)
  const [proximasDatasDisponiveis, setProximasDatasDisponiveis] = useState<string[]>([])
  const [dataInicio, setDataInicio] = useState<string>('')

  // pré-preencher via URL
  const [esporteParam, setEsporteParam] = useState<string>('')
  const [quadraIdQuery, setQuadraIdQuery] = useState<string | null>(null)
  const prefillRef = useRef(true)

  // ui geral
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // logos/quadras (igual comum)
  const [quadraLogos, setQuadraLogos] = useState<Record<string, string>>({})

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

  // spinner por imagem (igual comum)
  const [imgLoaded, setImgLoaded] = useState<Record<string, boolean>>({})
  const marcarCarregada = (id: string) => {
    setImgLoaded((prev) => ({ ...prev, [id]: true }))
  }

  // dropdowns (padrão comum)
  const [diaAberto, setDiaAberto] = useState(false)
  const [horaAberto, setHoraAberto] = useState(false)
  const diaRef = useRef<HTMLDivElement | null>(null)
  const horaRef = useRef<HTMLDivElement | null>(null)

  // scroll no horário (igual comum)
  useEffect(() => {
    if (!horaAberto) return
    const selectedId = horario ? `hora-${horario}` : 'hora-default'
    const el = document.getElementById(selectedId)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [horaAberto, horario])

  // fecha dropdown ao clicar fora (igual comum)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (diaRef.current && !diaRef.current.contains(t)) setDiaAberto(false)
      if (horaRef.current && !horaRef.current.contains(t)) setHoraAberto(false)
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /** =========================
   *  1) LER URL PARAMS
  ========================= */

  useEffect(() => {
    const qsDia = searchParams.get('diaSemana')
    const qsHora = searchParams.get('horario')
    const qsQuadra = searchParams.get('quadraId')
    const qsEsporte = searchParams.get('esporteId') || searchParams.get('esporte') // id ou nome

    if (qsDia && (diasEnum as readonly string[]).includes(qsDia)) {
      setDiaSemana(qsDia as DiaSemana)
    }
    if (qsHora && /^\d{2}:\d{2}$/.test(qsHora)) setHorario(qsHora)
    if (qsQuadra) setQuadraIdQuery(qsQuadra)
    if (qsEsporte) setEsporteParam(qsEsporte)
  }, [searchParams])

  /** =========================
   *  2) CARREGAR ESPORTES
  ========================= */

  useEffect(() => {
    axios
      .get<Esporte[]>(`${API_URL}/esportes`, { withCredentials: true })
      .then((res) => setEsportes(res.data || []))
      .catch(() => setFeedback({ kind: 'error', text: 'Falha ao carregar esportes.' }))
  }, [API_URL])

  // mapear param (id ou nome) para ID real (igual comum)
  useEffect(() => {
    if (!esportes.length || !esporteParam) return

    const byId = esportes.find((e) => String(e.id) === String(esporteParam))
    if (byId) {
      setEsporteId(String(byId.id))
      return
    }

    const byName = esportes.find(
      (e) => e.nome?.trim().toLowerCase() === esporteParam.trim().toLowerCase()
    )
    if (byName) setEsporteId(String(byName.id))
  }, [esportes, esporteParam])

  /** =========================
   *  3) CARREGAR MAPA DE LOGOS /QUADRAS
  ========================= */

  useEffect(() => {
    const loadQuadrasLogos = async () => {
      try {
        const { data } = await axios.get<QuadraAPI[]>(`${API_URL}/quadras`, {
          withCredentials: true
        })

        const map: Record<string, string> = {}
          ; (data || []).forEach((q) => {
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

  /** =========================
   *  4) DISPONIBILIDADE PERMANENTE
  ========================= */

  useEffect(() => {
    if (!esporteId || !horario || !diaSemana) {
      setQuadras([])
      setQuadraId('')
      setDataInicio('')
      setDataUltimoConflito(null)
      setProximasDatasDisponiveis([])
      return
    }

    setFeedback(null)

    axios
      .get<QuadraDisponivel[]>(`${API_URL}/disponibilidade`, {
        params: { diaSemana, horario, esporteId },
        withCredentials: true
      })
      .then((res) => {
        const lista = Array.isArray(res.data) ? res.data : []

        const listaComLogo = lista.map((q) => {
          const id = String(q.quadraId)
          return {
            ...q,
            logoUrl: quadraLogos[id] || toAbs(q.logoUrl || q.imagemUrl || q.imagem || '')
          }
        })

        setQuadras(listaComLogo)

        // estabiliza seleção pela query
        if (prefillRef.current && quadraIdQuery && !quadraId) {
          const existeNaLista = listaComLogo.some(
            (q) => String(q.quadraId) === String(quadraIdQuery)
          )
          if (existeNaLista) setQuadraId(String(quadraIdQuery))
        } else {
          const selecionadaAindaExiste = listaComLogo.some(
            (q) => String(q.quadraId) === String(quadraId)
          )
          if (!selecionadaAindaExiste) setQuadraId('')
        }

        // limpa fluxo de datas quando mudar parâmetros
        setDataInicio('')
        setDataUltimoConflito(null)
        setProximasDatasDisponiveis([])

        prefillRef.current = false
      })
      .catch((err) => {
        console.error(err)
        setQuadras([])
        setQuadraId('')
        setDataInicio('')
        setDataUltimoConflito(null)
        setProximasDatasDisponiveis([])
        setFeedback({ kind: 'error', text: 'Erro ao buscar disponibilidade.' })
      })
  }, [API_URL, diaSemana, horario, esporteId, quadraIdQuery, quadraId, quadraLogos, toAbs])

  /** =========================
   *  5) SESSÕES PERMITIDAS (AULA/JOGO)
  ========================= */

  useEffect(() => {
    setPermitidos([])
    if (!selectedOwnerIsProfessor) return
    if (!esporteId || !horario || !diaSemana) return

    const fetchPermitidos = async () => {
      try {
        setLoadingPermitidos(true)
        const { data: resp } = await axios.get<{ allow: TipoSessao[] }>(
          `${API_URL}/agendamentosPermanentes/_sessoes-permitidas`,
          {
            params: { esporteId, diaSemana, horario },
            withCredentials: true
          }
        )

        const allow = Array.isArray(resp?.allow) ? (resp.allow as TipoSessao[]) : []
        setPermitidos(allow)

        // regra igual comum
        if (allow.length === 1) {
          setTipoSessao(allow[0])
        } else if (allow.length >= 2 && !allow.includes(tipoSessao)) {
          setTipoSessao(allow[0])
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
  }, [API_URL, diaSemana, horario, esporteId, selectedOwnerIsProfessor])

  /** =========================
   *  6) PRÓXIMAS DATAS QUANDO HÁ CONFLITO COMUM
  ========================= */

  useEffect(() => {
    if (!diaSemana || !horario || !quadraId) {
      setProximasDatasDisponiveis([])
      setDataUltimoConflito(null)
      setDataInicio('')
      return
    }

    const quadraSelecionada = quadras.find((q) => String(q.quadraId) === String(quadraId))
    const deveBuscar = quadraSelecionada?.conflitoComum && !quadraSelecionada?.conflitoPermanente

    if (!deveBuscar) {
      setProximasDatasDisponiveis([])
      setDataUltimoConflito(null)
      setDataInicio('')
      return
    }

    axios
      .get<ProximasDatasResp>(`${API_URL}/proximaDataPermanenteDisponivel`, {
        params: { diaSemana, horario, quadraId },
        withCredentials: true
      })
      .then((res) => {
        setProximasDatasDisponiveis(res.data.proximasDatasDisponiveis || [])
        setDataUltimoConflito(res.data.dataUltimoConflito)
        setDataInicio('')

        if ((res.data.proximasDatasDisponiveis || []).length === 0) {
          setFeedback({
            kind: 'info',
            text: 'Sem datas futuras disponíveis para iniciar este permanente.'
          })
        }
      })
      .catch((err) => {
        console.error(err)
        setProximasDatasDisponiveis([])
        setDataUltimoConflito(null)
        setDataInicio('')
        setFeedback({ kind: 'error', text: 'Erro ao consultar próximas datas.' })
      })
  }, [API_URL, diaSemana, horario, quadraId, quadras])

  /** =========================
   *  7) BUSCA USUÁRIOS
  ========================= */

  useEffect(() => {
    let cancel = false

    const run = async () => {
      if (!listaAberta) {
        if (!cancel) setUsuariosEncontrados([])
        return
      }

      const termo = busca.trim()
      if (termo.length < 2) {
        if (!cancel) setUsuariosEncontrados([])
        return
      }

      setCarregandoUsuarios(true)

      try {
        const res = await axios.get<UsuarioBusca[]>(`${API_URL}/clientes`, {
          params: { nome: termo },
          withCredentials: true
        })
        if (!cancel) setUsuariosEncontrados(res.data || [])
      } catch {
        if (!cancel) setUsuariosEncontrados([])
      } finally {
        if (!cancel) setCarregandoUsuarios(false)
      }
    }

    const t = setTimeout(run, 300)
    return () => {
      cancel = true
      clearTimeout(t)
    }
  }, [API_URL, busca, listaAberta])

  /** =========================
   *  HELPERS
  ========================= */

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
      return serverMsg || 'Falha ao cadastrar permanente.'
    }
    return 'Falha ao cadastrar permanente.'
  }

  const showTipoSessaoUI = Boolean(horario) && selectedOwnerIsProfessor
  const onlyOne = permitidos.length === 1 ? permitidos[0] : null
  const noneAllowed = permitidos.length === 0

  // precisa escolher dataInicio se conflito comum na quadra selecionada
  const exigeDataInicio = useMemo(() => {
    const q = quadras.find((x) => String(x.quadraId) === String(quadraId))
    return Boolean(q?.conflitoComum && !q?.conflitoPermanente)
  }, [quadras, quadraId])

  // ✅ regra: precisa ter usuarioId OU convidadoSelecionado (confirmado no botão)
  const podeCadastrar =
    !submitting &&
    !!diaSemana &&
    !!esporteId &&
    !!horario &&
    !!quadraId &&
    (!!usuarioId || convidadoSelecionado) &&
    (!convidadoSelecionado || (!!convidadoDonoNome.trim() && !!convidadoDonoTelefone.trim())) &&
    (!showTipoSessaoUI || !noneAllowed) &&
    (!showTipoSessaoUI || !!onlyOne || permitidos.includes(tipoSessao)) &&
    (!exigeDataInicio || !!dataInicio)

  /** =========================
   *  SUBMIT
  ========================= */

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setFeedback(null)

    if (!usuarioId && !convidadoSelecionado) {
      setFeedback({
        kind: 'error',
        text: 'Informe um usuário (selecionando da lista) OU um convidado como dono (clicando em Adicionar).'
      })
      return
    }

    if (convidadoSelecionado && (!convidadoDonoNome.trim() || !convidadoDonoTelefone.trim())) {
      setFeedback({ kind: 'error', text: 'Informe nome e telefone do convidado dono.' })
      return
    }

    if (showTipoSessaoUI) {
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
          text: `Tipo de sessão inválido. Permitidos: ${permitidos.join(', ')}.`
        })
        return
      }
    }

    if (exigeDataInicio && !dataInicio) {
      setFeedback({
        kind: 'error',
        text: 'Selecione uma data de início disponível (há conflito com comum).'
      })
      return
    }

    const body: Record<string, any> = {
      diaSemana,
      esporteId,
      quadraId,
      horario
    }

    // sessão (só se professor)
    if (showTipoSessaoUI) body.tipoSessao = tipoSessao

    // usuário dono ou convidado dono
    if (usuarioId) {
      body.usuarioId = usuarioId
      if (selectedOwnerIsProfessor && tipoSessao === 'AULA') {
        body.professorId = usuarioId
      }
    } else {
      body.convidadosNomes = [`${convidadoDonoNome.trim()} ${convidadoDonoTelefone.trim()}`.trim()]
    }

    if (exigeDataInicio) body.dataInicio = dataInicio

    try {
      setSubmitting(true)
      await axios.post(`${API_URL}/agendamentosPermanentes`, body, {
        withCredentials: true
      })

      const msgSucesso = 'Agendamento permanente cadastrado com sucesso!'

      const redirectYmd =
        (exigeDataInicio && dataInicio) ||
        proximaDataParaDiaSemana(diaSemana as DiaSemana, horario)

      // limpa tudo
      setUsuarioId('')
      setBusca('')
      setUsuariosEncontrados([])
      setListaAberta(false)

      setSelectedOwnerIsProfessor(false)

      setConvidadoDonoNome('')
      setConvidadoDonoTelefone('')
      setConvidadoSelecionado(false)

      setQuadraId('')
      setPermitidos([])
      setTipoSessao('AULA')

      setDataUltimoConflito(null)
      setProximasDatasDisponiveis([])
      setDataInicio('')

      const params = new URLSearchParams({ data: redirectYmd })
      params.set('alertSuccess', msgSucesso)

      router.push(`/adminMaster/todosHorariosPermanentes?${params.toString()}`)
    } catch (error) {
      console.error(error)
      const msg = mensagemErroAxios(error)
      setFeedback({ kind: 'error', text: msg })
    } finally {
      setSubmitting(false)
    }
  }

  /** =========================
   *  LISTAS / UI HELPERS
  ========================= */

  const horas = useMemo(() => {
    return [
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
  }, [])

  /** =========================
   *  RENDER
  ========================= */

  return (
    <div className="min-h-screen flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] px-5 sm:px-10 py-7 sm:py-9 relative">
        {/* ALERTA GLOBAL */}
        <SystemAlert
          open={!!feedback}
          message={feedback?.text ?? ''}
          variant={feedback?.kind ?? 'info'}
          autoHideMs={feedback?.kind === 'error' ? 4000 : 4000}
          onClose={() => setFeedback(null)}
        />

        {/* BOTÃO X */}
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute right-4 top-4 sm:right-6 sm:top-5 text-gray-400 hover:text-gray-600 text-3xl leading-none p-2"
          aria-label="Fechar"
        >
          ×
        </button>

        {/* TÍTULO */}
        <header className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-orange-500">Agendar Permanente</h1>
        </header>

        <form onSubmit={handleSubmit} className="space-y-7">
          {/* DIA E HORÁRIO – card cinza */}
          <section className="mb-2">
            <p className="text-sm font-semibold text-orange-600 mb-3">Dia e horário:</p>

            <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* DIA */}
                <div ref={diaRef}>
                  <p className="text-xs text-gray-500 mb-1">Escolha o dia:</p>

                  <div className="flex items-center gap-2">
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
                        onClick={() => setDiaAberto((v) => !v)}
                        className="flex items-center justify-between h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
                      >
                        <span className="text-sm text-gray-800">
                          {diaSemana ? DIA_LABEL[diaSemana] : 'Selecione um dia'}
                        </span>

                        <ChevronDown
                          className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${diaAberto ? 'rotate-180' : ''
                            }`}
                        />
                      </button>

                      {diaAberto && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border border-gray-200 bg-white shadow-lg text-sm overflow-hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setDiaSemana('')
                              setDiaAberto(false)
                              setFeedback(null)
                            }}
                            className={`w-full text-left px-3 py-1.5 ${!diaSemana
                                ? 'bg-orange-100 text-orange-700 font-semibold'
                                : 'hover:bg-orange-50 text-gray-800'
                              }`}
                          >
                            Selecione um dia
                          </button>

                          {diasEnum.map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => {
                                setDiaSemana(d)
                                setDiaAberto(false)
                                setFeedback(null)
                              }}
                              className={`w-full text-left px-3 py-1.5 ${diaSemana === d
                                  ? 'bg-orange-100 text-orange-700 font-semibold'
                                  : 'hover:bg-orange-50 text-gray-800'
                                }`}
                            >
                              {DIA_LABEL[d]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* HORÁRIO */}
                <div ref={horaRef}>
                  <p className="text-xs text-gray-500 mb-1">Escolha o horário:</p>

                  <div className="flex items-center gap-2">
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
                        onClick={() => setHoraAberto((v) => !v)}
                        className="flex items-center justify-between h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
                      >
                        <span className="text-sm text-gray-800">
                          {horario || 'Selecione um horário'}
                        </span>

                        <ChevronDown
                          className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${horaAberto ? 'rotate-180' : ''
                            }`}
                        />
                      </button>

                      {horaAberto && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm">
                          <button
                            id="hora-default"
                            type="button"
                            onClick={() => {
                              setHorario('')
                              setHoraAberto(false)
                              setFeedback(null)
                            }}
                            className={`w-full text-left px-3 py-1.5 ${horario === ''
                                ? 'bg-orange-100 text-orange-700 font-semibold'
                                : 'hover:bg-orange-50 text-gray-800'
                              }`}
                          >
                            Selecione um horário
                          </button>

                          {horas.map((h) => {
                            const selecionado = horario === h
                            return (
                              <button
                                key={h}
                                id={`hora-${h}`}
                                type="button"
                                onClick={() => {
                                  setHorario(h)
                                  setHoraAberto(false)
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

          {/* ESPORTE – igual comum (select dentro do card) */}
          <section className="mb-2">
            <p className="text-sm font-semibold text-orange-600 mb-2">Esporte:</p>

            <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-3">
              <p className="text-xs text-gray-500 mb-2">Escolha o esporte</p>

              <div className="flex items-center gap-2">
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
                    value={esporteId}
                    onChange={(e) => {
                      setEsporteId(e.target.value)
                      setFeedback(null)

                      // ✅ reset seleção ao trocar esporte
                      setQuadraId('')
                      setDataInicio('')
                      setDataUltimoConflito(null)
                      setProximasDatasDisponiveis([])
                    }}
                  >
                    <option value="">Selecione o esporte</option>
                    {esportes.map((e) => (
                      <option key={String(e.id)} value={String(e.id)}>
                        {e.nome}
                      </option>
                    ))}
                  </select>

                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                </div>
              </div>
            </div>
          </section>

          {/* DONO */}
          <section>
            <p className="text-sm font-semibold text-orange-600 mb-3">Dono do agendamento:</p>

            <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-5 space-y-5">
              {/* usuário cadastrado */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">
                  Adicionar atletas cadastrados
                </p>

                <div className="flex items-start gap-3">
                  <Image
                    src="/iconescards/icone-permanente.png"
                    alt="Atleta cadastrado"
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-80 hidden sm:block mt-2"
                  />

                  {/* coluna do input + resultados */}
                  <div className="flex-1">
                    <input
                      type="text"
                      value={busca}
                      onFocus={() => setListaAberta(true)}
                      onChange={(e) => {
                        setBusca(e.target.value)
                        setUsuarioId('')
                        setListaAberta(true)
                        setFeedback(null)

                        // ✅ qualquer edição remove confirmação do convidado
                        setConvidadoSelecionado(false)

                        // reset sessão
                        setSelectedOwnerIsProfessor(false)
                        setPermitidos([])
                        setTipoSessao('AULA')
                      }}
                      placeholder="Buscar usuário por nome"
                      className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                 focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />

                    {carregandoUsuarios && (
                      <div className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                        <Spinner size="w-4 h-4" />
                        <span>Buscando usuários…</span>
                      </div>
                    )}

                    {listaAberta && usuariosEncontrados.length > 0 && (
                      <ul className="mt-2 border border-gray-200 rounded-md bg-white max-h-60 overflow-y-auto divide-y text-sm">
                        {usuariosEncontrados.map((u) => (
                          <li
                            key={String(u.id)}
                            className="px-3 py-2 hover:bg-orange-50 cursor-pointer"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setUsuarioId(String(u.id))
                              setBusca(u.nome)
                              setUsuariosEncontrados([])
                              setListaAberta(false)

                              // ✅ limpa convidado e confirmação
                              setConvidadoDonoNome('')
                              setConvidadoDonoTelefone('')
                              setConvidadoSelecionado(false)

                              const isProf = norm(u.tipo) === 'ADMIN_PROFESSORES'
                              setSelectedOwnerIsProfessor(isProf)

                              setPermitidos([])
                              setTipoSessao('AULA')
                              setFeedback(null)
                            }}
                            title={u.celular || ''}
                          >
                            <div className="font-medium text-gray-800">{u.nome}</div>
                            {u.tipo && (
                              <div className="text-[11px] text-gray-500">{norm(u.tipo)}</div>
                            )}
                            {u.celular && (
                              <div className="text-[11px] text-gray-500">{u.celular}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {listaAberta &&
                      busca.trim().length >= 2 &&
                      !carregandoUsuarios &&
                      usuariosEncontrados.length === 0 && (
                        <div className="text-[11px] text-gray-500 mt-2">Nenhum usuário encontrado.</div>
                      )}
                  </div>
                </div>

                {usuarioId && (
                  <div className="mt-2 text-xs rounded-md px-3 py-2 border text-green-700 bg-green-50 border-green-200">
                    Usuário selecionado.
                    {selectedOwnerIsProfessor ? (
                      <span className="block text-[11px] text-gray-600 mt-1">
                        *Professor detectado — pode exigir Aula/Jogo conforme janelas.
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* convidado dono */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">Ou informar convidado dono</p>

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
                      value={convidadoDonoNome}
                      onChange={(e) => {
                        setConvidadoDonoNome(e.target.value)

                        // ✅ qualquer edição remove confirmação
                        setConvidadoSelecionado(false)

                        if (e.target.value.trim()) {
                          setUsuarioId('')
                          setBusca('')
                          setUsuariosEncontrados([])
                          setListaAberta(false)

                          setSelectedOwnerIsProfessor(false)
                          setPermitidos([])
                          setTipoSessao('AULA')
                        }
                        setFeedback(null)
                      }}
                      placeholder="Nome do convidado"
                      className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                                 focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
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
                      value={convidadoDonoTelefone}
                      onChange={(e) => {
                        setConvidadoDonoTelefone(e.target.value)

                        // ✅ qualquer edição remove confirmação
                        setConvidadoSelecionado(false)

                        setFeedback(null)
                      }}
                      placeholder="(00) 000000000"
                      className="flex-1 h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                                 focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />

                    {/* ✅ botão adicionar convidado */}
                    {!convidadoSelecionado ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!convidadoDonoNome.trim()) {
                            setFeedback({ kind: 'error', text: 'Informe o nome do convidado.' })
                            return
                          }
                          if (!convidadoDonoTelefone.trim()) {
                            setFeedback({ kind: 'error', text: 'Informe o telefone do convidado.' })
                            return
                          }

                          // ✅ confirma convidado
                          setConvidadoSelecionado(true)

                          // ✅ limpa usuário selecionado/busca
                          setUsuarioId('')
                          setBusca('')
                          setUsuariosEncontrados([])
                          setListaAberta(false)

                          // ✅ convidado nunca é professor
                          setSelectedOwnerIsProfessor(false)
                          setPermitidos([])
                          setTipoSessao('AULA')

                          setFeedback(null)
                        }}
                        className="h-10 px-4 rounded-md border text-sm font-semibold
                                   border-orange-500 text-orange-700 bg-orange-100 hover:bg-orange-200 transition"
                      >
                        Adicionar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          // ✅ permite editar novamente
                          setConvidadoSelecionado(false)
                        }}
                        className="h-10 px-4 rounded-md border text-sm font-semibold
                                   border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition"
                        title="Editar convidado"
                      >
                        Editar
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-gray-500 mt-2">
                  Preencha <strong>um</strong> dos dois: usuário cadastrado <em>ou</em> convidado dono.
                  Se usar convidado, informe também o telefone e clique em <b>Adicionar</b>.
                </p>

                {convidadoSelecionado && (
                  <div className="mt-2 text-xs rounded-md px-3 py-2 border text-green-700 bg-green-50 border-green-200">
                    Convidado selecionado como dono do agendamento.
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* TIPO DE SESSÃO (AULA / JOGO) – chips laranja (igual comum) */}
          {showTipoSessaoUI && (
            <section className="mb-2">
              <p className="text-sm font-semibold text-gray-800 mb-2">Tipo de agendamento:</p>

              {loadingPermitidos ? (
                <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs bg-gray-100 border border-gray-200 text-gray-700">
                  <Spinner size="w-4 h-4" />
                  <span>Verificando opções…</span>
                </div>
              ) : noneAllowed ? (
                <div className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700">
                  <span>Nenhuma sessão permitida neste horário para o esporte selecionado.</span>
                </div>
              ) : onlyOne ? (
                <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs bg-gray-100 border border-gray-200 text-gray-700">
                  <span className="font-semibold">{onlyOne === 'AULA' ? 'Aula' : 'Jogo'}</span>
                  <span className="text-[10px] text-gray-500">(definido pelas regras)</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
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
                As opções seguem as janelas configuradas para o esporte no dia/horário escolhido.
              </p>
            </section>
          )}

          {/* QUADRAS */}
          <section>
            <p className="text-sm font-semibold mb-3 text-orange-600">Quadras:</p>

            {!diaSemana || !esporteId || !horario ? (
              <p className="text-xs text-gray-500">
                Selecione <b>dia</b>, <b>horário</b> e <b>esporte</b> para ver as quadras disponíveis.
              </p>
            ) : quadras.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Spinner size="w-4 h-4" />
                <span>Carregando disponibilidade…</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {quadras
                    .filter((q) => q.disponivel || q.conflitoComum || q.conflitoPermanente)
                    .map((q) => {
                      const idStr = String(q.quadraId)
                      const selected = quadraId === idStr

                      const disabled = q.conflitoPermanente || (!q.disponivel && !q.conflitoComum)

                      const numeroFmt = String(q.numero).padStart(2, '0')
                      const src = q.logoUrl || quadraLogos[idStr] || '/quadra.png'

                      return (
                        <button
                          key={idStr}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setQuadraId(idStr)
                            setFeedback(null)
                          }}
                          className={`relative flex flex-col overflow-hidden rounded-xl border shadow-sm transition ${disabled
                              ? 'opacity-50 cursor-not-allowed border-gray-200'
                              : selected
                                ? 'border-orange-500 shadow-[0_0_0_2px_rgba(233,122,31,0.35)]'
                                : 'border-gray-200 hover:border-orange-400 hover:shadow-md'
                            }`}
                          title={
                            q.conflitoPermanente
                              ? 'Conflito com permanente'
                              : !q.disponivel && !q.conflitoComum
                                ? 'Indisponível'
                                : q.conflitoComum
                                  ? 'Conflito com comum (exige data de início)'
                                  : ''
                          }
                        >
                          <div className="relative w-full h-28 sm:h-40 flex items-center justify-center">
                            <AppImage
                              src={src}
                              alt={q.nome}
                              fill
                              className={`object-contain pointer-events-none select-none transition-opacity duration-150 ${imgLoaded[idStr] ? 'opacity-100' : 'opacity-0'
                                }`}
                              fallbackSrc="/quadra.png"
                              onLoadingComplete={() => marcarCarregada(idStr)}
                            />

                            {!imgLoaded[idStr] && (
                              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
                                <Spinner size="w-5 h-5" />
                              </div>
                            )}
                          </div>

                          <div className="px-3 py-3 bg-white text-center">
                            <p className="text-[11px] text-gray-500 mb-1">Quadra {numeroFmt}</p>
                            <p className="text-[12px] font-semibold text-gray-800 truncate">{q.nome}</p>

                            {q.conflitoComum && !q.conflitoPermanente && (
                              <p className="mt-1 text-[10px] text-yellow-700">Conflito com comum</p>
                            )}
                            {q.conflitoPermanente && (
                              <p className="mt-1 text-[10px] text-red-600">Conflito com permanente</p>
                            )}
                          </div>
                        </button>
                      )
                    })}
                </div>

                {/* conflito comum -> escolher data de início */}
                {dataUltimoConflito && proximasDatasDisponiveis.length > 0 && (
                  <div className="mt-6 rounded-xl bg-[#F6F6F6] border border-yellow-200 px-4 py-4 sm:px-5 sm:py-5">
                    <p className="text-sm font-semibold text-yellow-700">
                      Conflito com agendamento comum em{' '}
                      <span className="text-yellow-900">
                        {format(parseISO(dataUltimoConflito), 'dd/MM/yyyy')}
                      </span>
                    </p>

                    <p className="text-[11px] text-gray-600 mt-1">
                      Selecione uma data de início disponível para o permanente:
                    </p>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {proximasDatasDisponiveis.map((dataStr) => {
                        const dataFormatada = format(parseISO(dataStr), 'dd/MM/yyyy')
                        const selected = dataInicio === dataStr

                        return (
                          <button
                            key={dataStr}
                            type="button"
                            onClick={() => setDataInicio(dataStr)}
                            className={`h-10 rounded-md border text-xs font-semibold transition ${selected
                                ? 'border-orange-500 text-orange-700 bg-orange-100'
                                : 'border-gray-200 text-gray-700 bg-white hover:bg-orange-50'
                              }`}
                          >
                            {dataFormatada}
                          </button>
                        )
                      })}
                    </div>

                    {!dataInicio && (
                      <p className="mt-2 text-[11px] text-gray-500">
                        *obrigatório escolher a data de início quando houver conflito com comum.
                      </p>
                    )}
                  </div>
                )}

                {/* BOTÃO FINAL */}
                <div className="mt-8 flex justify-center">
                  <button
                    type="submit"
                    disabled={!podeCadastrar}
                    aria-busy={submitting}
                    className={`w-full max-w-[340px] sm:min-w-[340px] h-11 rounded-md border text-sm font-semibold ${!podeCadastrar
                        ? 'border-orange-200 text-orange-200 bg-white cursor-not-allowed'
                        : 'border-orange-500 text-orange-700 bg-orange-100 hover:bg-orange-200'
                      }`}
                    title={
                      !diaSemana
                        ? 'Selecione o dia.'
                        : !horario
                          ? 'Selecione o horário.'
                          : !esporteId
                            ? 'Selecione o esporte.'
                            : !quadraId
                              ? 'Selecione uma quadra.'
                              : !usuarioId && !convidadoSelecionado
                                ? 'Selecione um usuário ou informe convidado dono e clique em Adicionar.'
                                : convidadoSelecionado && !convidadoDonoTelefone.trim()
                                  ? 'Informe o telefone do convidado.'
                                  : exigeDataInicio && !dataInicio
                                    ? 'Selecione uma data de início disponível.'
                                    : undefined
                    }
                  >
                    {submitting ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner size="w-4 h-4" />
                        <span>Cadastrando…</span>
                      </span>
                    ) : (
                      'Confirmar Permanente'
                    )}
                  </button>
                </div>
              </>
            )}
          </section>
        </form>
      </div>
    </div>
  )
}
