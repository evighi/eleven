'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import AppImage from '@/components/AppImage'
import { useRouter, useSearchParams } from 'next/navigation'
import Spinner from '@/components/Spinner'
import SystemAlert, { AlertVariant } from '@/components/SystemAlert'
import Image from 'next/image'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

/** ===== Tipos ===== */

interface ChurrasqueiraDisp {
  churrasqueiraId: string
  nome: string
  numero: number
  disponivel?: boolean
  imagem?: string | null
  imagemUrl?: string | null
  logoUrl?: string | null
}

interface ChurrasqueiraAPI {
  id: string
  nome: string
  numero: number
  imagem?: string | null
  logoUrl?: string | null
}

type UsuarioBusca = { id: string; nome: string; celular?: string | null }

/** ✅ Feedback padronizado */
type Feedback = { kind: 'success' | 'error' | 'info'; text: string }

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

export default function AgendamentoChurrasqueiraComum() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'
  const searchParams = useSearchParams()
  const router = useRouter()

  const [data, setData] = useState<string>('')
  const [turno, setTurno] = useState<string>('')

  const [churrasqueirasDisponiveis, setChurrasqueirasDisponiveis] = useState<
    ChurrasqueiraDisp[]
  >([])
  const [churrasqueiraSelecionada, setChurrasqueiraSelecionada] = useState<string>('')

  const [carregandoDisp, setCarregandoDisp] = useState<boolean>(false)
  const [carregandoAgendar, setCarregandoAgendar] = useState<boolean>(false)

  // ✅ FEEDBACK PADRONIZADO
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const closeFeedback = () => setFeedback(null)

  // 🔹 mapa de logos
  const [churrasqueiraLogos, setChurrasqueiraLogos] = useState<Record<string, string>>({})

  // Dono do agendamento
  const [buscaUsuario, setBuscaUsuario] = useState<string>('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<UsuarioBusca[]>([])
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<UsuarioBusca | null>(null)
  const [buscandoUsuarios, setBuscandoUsuarios] = useState<boolean>(false)
  const [convidadoDonoNome, setConvidadoDonoNome] = useState<string>('')

  // ✅ imagem carregada (spinner por card)
  const [imgLoaded, setImgLoaded] = useState<Record<string, boolean>>({})
  const marcarCarregada = (id: string) => {
    setImgLoaded((prev) => ({ ...prev, [id]: true }))
  }

  /** ============================
   *  UI: Calendário e Turno (padrão quadras)
   *  ============================ */

  const [dataPickerAberto, setDataPickerAberto] = useState(false)
  const [mesExibido, setMesExibido] = useState(() => {
    const base = data ? new Date(data + 'T00:00:00') : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const [turnoAberto, setTurnoAberto] = useState(false)
  const turnoWrapperRef = useRef<HTMLDivElement | null>(null)

  // minDate = hoje
  const minDate = useMemo(() => {
    const hoje = new Date()
    const adjusted = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000)
    return adjusted.toISOString().slice(0, 10)
  }, [])

  // manter mês em sincronia quando data mudar
  useEffect(() => {
    if (!data) return
    const base = new Date(data + 'T00:00:00')
    setMesExibido(new Date(base.getFullYear(), base.getMonth(), 1))
  }, [data])

  // fechar dropdown turno ao clicar fora
  useEffect(() => {
    if (!turnoAberto) return
    const handleClickOutside = (event: MouseEvent) => {
      if (turnoWrapperRef.current && !turnoWrapperRef.current.contains(event.target as Node)) {
        setTurnoAberto(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [turnoAberto])

  /** ===== 1) Carrega mapa de logos em /churrasqueiras ===== */
  useEffect(() => {
    const carregarChurrasqueiras = async () => {
      try {
        const { data } = await axios.get<ChurrasqueiraAPI[]>(`${API_URL}/churrasqueiras`, {
          withCredentials: true,
        })

        const map: Record<string, string> = {}
        ;(data || []).forEach((c) => {
          const id = String(c.id)
          const src = c.logoUrl || c.imagem || ''
          if (!id || !src) return
          map[id] = src
        })

        setChurrasqueiraLogos(map)
      } catch (e) {
        console.warn('Não foi possível carregar /churrasqueiras para montar os logos.', e)
      }
    }

    carregarChurrasqueiras()
  }, [API_URL])

  /** ===== 2) Lê query params ===== */
  useEffect(() => {
    const qData = searchParams.get('data')
    const qTurno = searchParams.get('turno')
    const qChurras = searchParams.get('churrasqueiraId')

    if (qData && /^\d{4}-\d{2}-\d{2}$/.test(qData)) setData(qData)
    if (qTurno && (qTurno === 'DIA' || qTurno === 'NOITE')) setTurno(qTurno)
    if (qChurras) setChurrasqueiraSelecionada(String(qChurras))
  }, [searchParams])

  /** ===== 3) Disponibilidade por data + turno ===== */
  useEffect(() => {
    const buscar = async () => {
      if (!data || !turno) {
        setChurrasqueirasDisponiveis([])
        setFeedback(null)
        return
      }

      setCarregandoDisp(true)
      setFeedback(null)

      try {
        const res = await axios.get<ChurrasqueiraDisp[]>(`${API_URL}/disponibilidadeChurrasqueiras`, {
          params: { data, turno },
          withCredentials: true,
        })

        const lista: ChurrasqueiraDisp[] = Array.isArray(res.data) ? res.data : []

        const disponiveis = lista
          .filter((c) => c.disponivel !== false)
          .map((c) => {
            const id = String(c.churrasqueiraId)
            const logoFromMap = churrasqueiraLogos[id]

            return {
              ...c,
              logoUrl: logoFromMap || c.logoUrl || c.imagemUrl || c.imagem || null,
            }
          })

        setChurrasqueirasDisponiveis(disponiveis)

        if (disponiveis.length === 0) {
          setFeedback({ kind: 'info', text: 'Nenhuma churrasqueira disponível.' })
        }
      } catch (err) {
        console.error(err)
        setFeedback({ kind: 'error', text: 'Erro ao verificar disponibilidade.' })
        setChurrasqueirasDisponiveis([])
      } finally {
        setCarregandoDisp(false)
      }
    }

    buscar()
  }, [data, turno, API_URL, churrasqueiraLogos])

  /** ===== 4) Busca usuários (dono) ===== */
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
        const { data: lista } = await axios.get<UsuarioBusca[]>(`${API_URL}/clientes`, {
          params: { nome: q },
          withCredentials: true,
          signal: ctrl.signal as any,
        })
        setUsuariosEncontrados(Array.isArray(lista) ? lista : [])
      } catch (err: any) {
        if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          console.error('Falha ao buscar usuários:', err)
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

  /** ===== 5) Agendar (✅ REDIRECIONA IGUAL QUADRAS) ===== */
  const agendar = async () => {
    if (!data || !turno || !churrasqueiraSelecionada || (!usuarioSelecionado && !convidadoDonoNome.trim())) {
      setFeedback({
        kind: 'error',
        text: 'Selecione data, turno, uma churrasqueira e um usuário OU preencha o convidado.',
      })
      return
    }

    const body: Record<string, any> = {
      data,
      turno,
      churrasqueiraId: churrasqueiraSelecionada,
      ...(usuarioSelecionado
        ? { usuarioId: usuarioSelecionado.id }
        : { convidadosNomes: [convidadoDonoNome.trim()] }),
    }

    setCarregandoAgendar(true)
    setFeedback(null)

    try {
      await axios.post(`${API_URL}/agendamentosChurrasqueiras`, body, {
        withCredentials: true,
      })

      // ✅ limpa campos
      setChurrasqueiraSelecionada('')
      setUsuarioSelecionado(null)
      setBuscaUsuario('')
      setUsuariosEncontrados([])
      setConvidadoDonoNome('')

      // ✅ redireciona igual ao de quadras
      const msgSucesso = 'Agendamento realizado com sucesso!'
      const params = new URLSearchParams({ data })
      params.set('alertSuccess', msgSucesso)

      router.push(`/adminMaster/todosHorariosChurrasqueiras?${params.toString()}`)
    } catch (err: any) {
      console.error(err)
      const msg =
        err?.response?.data?.erro ||
        err?.response?.data?.message ||
        'Erro ao realizar agendamento.'

      setFeedback({ kind: 'error', text: msg })
    } finally {
      setCarregandoAgendar(false)
    }
  }

  /** ===== 6) Helpers ===== */
  const botaoDesabilitado =
    !data ||
    !turno ||
    !churrasqueiraSelecionada ||
    (!usuarioSelecionado && !convidadoDonoNome.trim())

  const podeAgendar = !botaoDesabilitado && !carregandoAgendar

  /** ===== Render ===== */
  return (
    <div className="min-h-screen flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] px-5 sm:px-10 py-7 sm:py-9 relative">
        {/* ✅ ALERTA PADRÃO */}
        <SystemAlert
          open={!!feedback}
          variant={(feedback?.kind as AlertVariant) || 'info'}
          message={feedback?.text || ''}
          onClose={closeFeedback}
          autoHideMs={feedback?.kind === 'error' ? 4000 : 4000}
        />

        {/* BOTÃO X (fechar) */}
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
          <h1 className="text-xl sm:text-2xl font-bold text-orange-500">
            Agendar Churrasqueira Avulsa
          </h1>
        </header>

        {/* DIA E TURNO – card cinza padrão */}
        <section className="mb-6">
          <p className="text-sm font-semibold text-orange-600 mb-3">Dia e turno:</p>

          <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* DATA – calendário custom */}
              <div>
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
                      onClick={() => setDataPickerAberto((v) => !v)}
                      className="flex items-center justify-between h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-gray-900 hover:shadow-sm transition"
                    >
                      <span className="text-sm text-gray-800">{formatarDataBR(data)}</span>

                      <ChevronDown
                        className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${
                          dataPickerAberto ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {dataPickerAberto && (
                      <div className="absolute z-20 mt-1 right-0 w-full rounded-lg border border-gray-200 bg-white shadow-lg p-3 max-h-[70vh] overflow-auto">
                        <div className="flex items-center justify-between mb-2">
                          <button
                            type="button"
                            onClick={() =>
                              setMesExibido((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                            }
                            className="p-1 rounded hover:bg-gray-100"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>

                          <span className="font-semibold text-sm">
                            {mesExibido.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              setMesExibido((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                            }
                            className="p-1 rounded hover:bg-gray-100"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
                          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => (
                            <div key={d} className="text-center">
                              {d}
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1 text-sm">
                          {(() => {
                            const first = new Date(mesExibido.getFullYear(), mesExibido.getMonth(), 1)
                            const startWeekday = first.getDay()
                            const startDate = new Date(first)
                            startDate.setDate(first.getDate() - startWeekday)

                            const todayIso = isoFromDate(new Date())

                            return Array.from({ length: 42 }, (_, i) => {
                              const d = new Date(startDate)
                              d.setDate(startDate.getDate() + i)

                              const iso = isoFromDate(d)
                              const isCurrentMonth = d.getMonth() === mesExibido.getMonth()
                              const isSelected = data === iso
                              const isToday = todayIso === iso

                              const isDisabled = iso < minDate

                              return (
                                <button
                                  key={iso}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => {
                                    setData(iso)
                                    setDataPickerAberto(false)
                                    setFeedback(null)
                                  }}
                                  className={[
                                    'h-8 w-8 rounded-full flex items-center justify-center mx-auto transition',
                                    !isCurrentMonth ? 'text-gray-300' : 'text-gray-800',
                                    isToday && !isSelected ? 'border border-orange-400' : '',
                                    isSelected ? 'bg-orange-600 text-white font-semibold' : 'hover:bg-orange-50',
                                    isDisabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : '',
                                  ].join(' ')}
                                >
                                  {d.getDate()}
                                </button>
                              )
                            })
                          })()}
                        </div>

                        <p className="mt-2 text-[11px] text-gray-500">
                          *datas anteriores a hoje ficam desabilitadas.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* TURNO – dropdown igual horário */}
              <div>
                <p className="text-xs text-gray-500 mb-1">Escolha o turno:</p>
                <div ref={turnoWrapperRef} className="flex items-center gap-2 w-full">
                  <Image src="/icons/iconhoraio.png" alt="Turno" width={24} height={24} className="w-6 h-6" />

                  <div className="relative w-full">
                    <button
                      type="button"
                      onClick={() => setTurnoAberto((v) => !v)}
                      className="flex items-center justify-between h-9 border border-gray-300 rounded-md px-3 text-sm bg-white w-full hover:border-gray-900 hover:shadow-sm transition"
                    >
                      <span className="text-sm text-gray-800">
                        {turno ? (turno === 'DIA' ? 'Dia' : 'Noite') : 'Selecione o turno'}
                      </span>

                      <ChevronDown
                        className={`w-4 h-4 text-gray-600 ml-2 transition-transform ${
                          turnoAberto ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {turnoAberto && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border border-gray-200 bg-white shadow-lg text-sm overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            setTurno('')
                            setTurnoAberto(false)
                            setFeedback(null)
                          }}
                          className={`w-full text-left px-3 py-2 ${
                            turno === '' ? 'bg-orange-100 text-orange-700 font-semibold' : 'hover:bg-orange-50 text-gray-800'
                          }`}
                        >
                          Selecione o turno
                        </button>

                        {(['DIA', 'NOITE'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              setTurno(t)
                              setTurnoAberto(false)
                              setFeedback(null)
                            }}
                            className={`w-full text-left px-3 py-2 ${
                              turno === t ? 'bg-orange-100 text-orange-700 font-semibold' : 'hover:bg-orange-50 text-gray-800'
                            }`}
                          >
                            {t === 'DIA' ? 'Dia' : 'Noite'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* DONO DO AGENDAMENTO */}
        <section className="mb-8">
          <p className="text-sm font-semibold text-orange-600 mb-3">Dono do agendamento:</p>

          <div className="rounded-xl bg-[#F6F6F6] border-gray-200 px-4 py-4 sm:px-5 sm:py-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">Selecionar usuário cadastrado</p>

              <input
                type="text"
                className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                           focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                placeholder="Buscar usuário por nome"
                value={buscaUsuario}
                onChange={(e) => {
                  setBuscaUsuario(e.target.value)
                  setUsuarioSelecionado(null)
                  setFeedback(null)
                }}
              />

              {buscandoUsuarios && (
                <div className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                  <Spinner size="w-4 h-4" />
                  <span>Buscando usuários…</span>
                </div>
              )}

              {usuariosEncontrados.length > 0 && !usuarioSelecionado && (
                <ul className="mt-2 border border-gray-200 rounded-md bg-white max-h-60 overflow-y-auto divide-y text-sm">
                  {usuariosEncontrados.map((u) => (
                    <li
                      key={u.id}
                      className="px-3 py-2 hover:bg-orange-50 cursor-pointer"
                      onClick={() => {
                        setUsuarioSelecionado(u)
                        setBuscaUsuario('')
                        setUsuariosEncontrados([])
                        setConvidadoDonoNome('')
                        setFeedback(null)
                      }}
                      title={u.celular || ''}
                    >
                      <div className="font-medium text-gray-800">{u.nome}</div>
                      {u.celular && <div className="text-[11px] text-gray-500">{u.celular}</div>}
                    </li>
                  ))}
                </ul>
              )}

              {usuarioSelecionado && (
                <div className="mt-2 text-xs rounded-md px-3 py-2 border text-green-700 bg-green-50 border-green-200">
                  Usuário selecionado: <b>{usuarioSelecionado.nome}</b>
                  {usuarioSelecionado.celular ? (
                    <span className="block text-[11px] text-gray-600 mt-1">{usuarioSelecionado.celular}</span>
                  ) : null}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">Ou informar convidado dono</p>

              <input
                type="text"
                className="w-full h-10 rounded-md border border-gray-300 px-3 text-sm bg-white
                           focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                placeholder="Ex.: João — 53 99127-8304"
                value={convidadoDonoNome}
                onChange={(e) => {
                  setConvidadoDonoNome(e.target.value)
                  setFeedback(null)
                  if (e.target.value.trim()) {
                    setUsuarioSelecionado(null)
                    setBuscaUsuario('')
                    setUsuariosEncontrados([])
                  }
                }}
              />

              <p className="text-[11px] text-gray-500 mt-2">
                Preencha <strong>um</strong> dos dois: usuário cadastrado <em>ou</em> convidado dono.
              </p>
            </div>

            {!usuarioSelecionado && !convidadoDonoNome.trim() && (
              <p className="text-[11px] text-gray-500">
                *obrigatório definir o responsável antes de confirmar o agendamento.
              </p>
            )}
          </div>
        </section>

        {/* CHURRASQUEIRAS */}
        <section>
          <p className="text-sm font-semibold mb-3 text-orange-600">Churrasqueiras:</p>

          {carregandoDisp ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Spinner size="w-4 h-4" />
              <span>Carregando disponibilidade…</span>
            </div>
          ) : churrasqueirasDisponiveis.length === 0 ? (
            <p className="text-xs text-gray-500">
              Selecione data e turno para ver as churrasqueiras disponíveis.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {churrasqueirasDisponiveis.map((c) => {
                  const idStr = String(c.churrasqueiraId)
                  const selected = churrasqueiraSelecionada === idStr

                  const numeroFmt = String(c.numero).padStart(2, '0')
                  const imgSrc =
                    churrasqueiraLogos[idStr] ||
                    c.logoUrl ||
                    c.imagemUrl ||
                    c.imagem ||
                    undefined

                  return (
                    <button
                      key={idStr}
                      type="button"
                      onClick={() => {
                        setChurrasqueiraSelecionada(idStr)
                        setFeedback(null)
                      }}
                      className={`flex flex-col overflow-hidden rounded-xl border shadow-sm transition ${
                        selected
                          ? 'border-orange-500 shadow-[0_0_0_2px_rgba(233,122,31,0.35)]'
                          : 'border-gray-200 hover:border-orange-400 hover:shadow-md'
                      }`}
                    >
                      <div className="relative w-full h-28 sm:h-40 flex items-center justify-center">
                        <AppImage
                          src={imgSrc}
                          legacyDir="churrasqueiras"
                          alt={c.nome}
                          fill
                          className={`object-contain pointer-events-none select-none transition-opacity duration-150 ${
                            imgLoaded[idStr] ? 'opacity-100' : 'opacity-0'
                          }`}
                          fallbackSrc="/churrasqueira.png"
                          priority={false}
                          onLoadingComplete={() => marcarCarregada(idStr)}
                        />

                        {!imgLoaded[idStr] && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
                            <Spinner size="w-5 h-5" />
                          </div>
                        )}
                      </div>

                      <div className="px-3 py-3 bg-white text-center">
                        <p className="text-[11px] text-gray-500 mb-1">
                          Churrasqueira {numeroFmt}
                        </p>
                        <p className="text-[12px] font-semibold text-gray-800 truncate">
                          {c.nome}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={agendar}
                  disabled={!podeAgendar}
                  aria-busy={carregandoAgendar}
                  className={`w-full max-w-[340px] sm:min-w-[340px] h-11 rounded-md border text-sm font-semibold ${
                    !podeAgendar
                      ? 'border-orange-200 text-orange-200 bg-white cursor-not-allowed'
                      : 'border-orange-500 text-orange-700 bg-orange-100 hover:bg-orange-200'
                  }`}
                >
                  {carregandoAgendar ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner size="w-4 h-4" />
                      <span>Agendando…</span>
                    </span>
                  ) : (
                    'Confirmar Agendamento'
                  )}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
