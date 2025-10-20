'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import axios from 'axios'
import Link from 'next/link'
import Spinner from '@/components/Spinner'

type DeletionStatus = 'PENDING' | 'DONE' | 'CANCELLED'

type QueueUser = {
  id: string
  nome: string
  email: string
  tipo: string
  disabledAt?: string | null
  deletedAt?: string | null
}

type RequestedBy = {
  id: string
  nome: string
  email: string
} | null

type QueueLastInteraction =
  | {
      type: 'AG_COMUM'
      id: string
      resumo: {
        data: string
        horario: string
        status: string
        quadra?: { id: string; nome: string | null; numero: number | null } | null
        esporte?: { id: string; nome: string | null } | null
      }
    }
  | {
      type: 'AG_PERM'
      id: string
      resumo: {
        diaSemana: string
        horario: string
        status: string
        updatedAt: string
        quadra?: { id: string; nome: string | null; numero: number | null } | null
        esporte?: { id: string; nome: string | null } | null
      }
    }
  | {
      type: 'CHURRAS'
      id: string
      resumo: {
        data: string
        turno: 'DIA' | 'NOITE'
        status: string
        churrasqueira?: { id: string; nome: string | null; numero: number | null } | null
      }
    }

interface QueueItem {
  id: string
  usuario: QueueUser
  requestedBy: RequestedBy
  requestedAt: string
  eligibleAt: string
  status: DeletionStatus
  attempts: number
  reason?: string | null
  lastInteractionDate?: string | null
  lastInteraction?: QueueLastInteraction | null
}

/* =================== Helpers =================== */
const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

const tipoInteracaoLabel = (t?: string) => {
  if (t === 'AG_COMUM') return 'Agendamento comum (quadra)'
  if (t === 'AG_PERM') return 'Agendamento permanente (quadra)'
  if (t === 'CHURRAS') return 'Churrasqueira'
  return 'Interação'
}

const fmtDateTimeBR = (iso?: string | null) => {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    const dd = d.toLocaleDateString('pt-BR')
    const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return `${dd} ${hh}`
  } catch {
    return String(iso)
  }
}

const diffDaysFromNow = (iso: string) => {
  const now = new Date()
  const target = new Date(iso)
  const ms = target.getTime() - now.getTime()
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
  return days
}

export default function PendenciasExclusao() {
  const [lista, setLista] = useState<QueueItem[]>([])
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [confirmandoUndo, setConfirmandoUndo] = useState<QueueItem | null>(null)
  const [desfazendo, setDesfazendo] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await axios.get<QueueItem[]>(`${API_URL}/delecoes/pendentes`, {
        withCredentials: true,
      })
      setLista(res.data || [])
    } catch (e: any) {
      console.error(e)
      const msg = e?.response?.data?.erro || 'Erro ao carregar pendências'
      setErro(msg)
      setLista([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((i) => {
      const { usuario, requestedBy } = i
      return (
        usuario?.nome?.toLowerCase().includes(q) ||
        usuario?.email?.toLowerCase().includes(q) ||
        requestedBy?.nome?.toLowerCase().includes(q) ||
        requestedBy?.email?.toLowerCase().includes(q)
      )
    })
  }, [lista, busca])

  const desfazer = async (usuarioId: string) => {
    setDesfazendo(true)
    try {
      const res = await axios.post(
        `${API_URL}/delecoes/${usuarioId}/desfazer`,
        {},
        { withCredentials: true, validateStatus: () => true }
      )
      if (res.status >= 200 && res.status < 300) {
        setConfirmandoUndo(null)
        await carregar()
        alert('Exclusão cancelada e acesso reabilitado.')
      } else {
        const msg = res?.data?.erro || res?.data?.message || `Falha (HTTP ${res.status})`
        alert(msg)
      }
    } catch (e) {
      console.error(e)
      alert('Erro ao desfazer exclusão.')
    } finally {
      setDesfazendo(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto mt-10 p-6 bg-white rounded shadow">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-medium">Pendências de Exclusão</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={carregar}
            className="px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
          >
            Atualizar
          </button>
          <Link
            href="/adminMaster"
            className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400 text-black"
          >
            Voltar
          </Link>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Nesta página você encontra usuários com exclusão pendente (janela de 90 dias desde a última
        interação). Você pode <b>desfazer</b> a exclusão para reabilitar o acesso.
      </p>

      <div className="flex gap-3 items-end mb-4">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Buscar (nome / e-mail)</label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Ex.: Maria, joao@dominio.com"
            className="w-full p-2 border rounded"
          />
        </div>
      </div>

      {carregando && (
        <div className="flex items-center gap-2 text-gray-600">
          <Spinner /> <span>Carregando pendências…</span>
        </div>
      )}

      {!carregando && erro && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700">{erro}</div>
      )}

      {!carregando && !erro && filtrados.length === 0 && (
        <div className="p-3 rounded border bg-gray-50 text-gray-700">
          Nenhuma pendência de exclusão encontrada.
        </div>
      )}

      {/* Lista */}
      <ul className="space-y-4">
        {filtrados.map((item) => {
          const diasRest = diffDaysFromNow(item.eligibleAt)
          const atrasado = diasRest <= 0
          const chip =
            atrasado ? (
              <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800">
                Elegível para exclusão
              </span>
            ) : (
              <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">
                Faltam {diasRest} {diasRest === 1 ? 'dia' : 'dias'}
              </span>
            )

          return (
            <li key={item.id} className="border rounded-lg overflow-hidden">
              <div className="p-3 bg-gray-50 flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-semibold">
                    {item.usuario?.nome}{' '}
                    <span className="text-gray-500 font-normal">({item.usuario?.email})</span>
                  </div>
                  <div className="text-xs text-gray-600">
                    Tipo: {item.usuario?.tipo} · Solic. em {fmtDateTimeBR(item.requestedAt)}{' '}
                    {item.requestedBy && (
                      <>
                        · por <b>{item.requestedBy.nome}</b>
                        <span className="text-gray-500"> ({item.requestedBy.email})</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm">{chip}</div>
                  <div className="text-[11px] text-gray-600">
                    Elegível em: {fmtDateTimeBR(item.eligibleAt)}
                  </div>
                </div>
              </div>

              {/* corpo */}
              <div className="p-4 grid gap-4 md:grid-cols-3">
                {/* bloco: status/flags */}
                <div className="md:col-span-1">
                  <div className="text-sm text-gray-700">
                    <div className="mb-1">
                      <span className="font-semibold">Status:</span>{' '}
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                        {item.status}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold">Tentativas:</span> {item.attempts}
                    </div>
                    {item.reason && (
                      <div className="mt-1">
                        <span className="font-semibold">Motivo:</span> {item.reason}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-gray-600">
                      {item.usuario?.disabledAt ? (
                        <>Acesso bloqueado desde {fmtDateTimeBR(item.usuario.disabledAt)}</>
                      ) : (
                        <>Acesso ainda habilitado</>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      onClick={() => setConfirmandoUndo(item)}
                      className="w-full px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      Desfazer exclusão
                    </button>
                  </div>
                </div>

                {/* bloco: última interação */}
                <div className="md:col-span-2">
                  <div className="text-sm font-semibold mb-2">Última interação</div>

                  {!item.lastInteraction ? (
                    <div className="p-3 border rounded bg-white text-sm text-gray-600">
                      Não informada (ou não encontrada).
                      {item.lastInteractionDate && (
                        <>
                          {' '}
                          Data de referência: <b>{fmtDateTimeBR(item.lastInteractionDate)}</b>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 border rounded bg-white">
                      <div className="text-sm font-semibold">
                        {tipoInteracaoLabel(item.lastInteraction.type)}
                      </div>

                      {/* AG_COMUM */}
                      {item.lastInteraction.type === 'AG_COMUM' && (
                        <ul className="text-xs text-gray-700 mt-1 space-y-1">
                          <li>
                            <b>ID:</b> {item.lastInteraction.id}
                          </li>
                          <li>
                            <b>Data/Horário:</b> {fmtDateTimeBR(item.lastInteraction.resumo.data)}{' '}
                            {item.lastInteraction.resumo.horario}
                          </li>
                          <li>
                            <b>Status:</b> {item.lastInteraction.resumo.status}
                          </li>
                          {!!item.lastInteraction.resumo.quadra && (
                            <li>
                              <b>Quadra:</b> {item.lastInteraction.resumo.quadra?.nome} Nº{' '}
                              {item.lastInteraction.resumo.quadra?.numero}
                            </li>
                          )}
                          {!!item.lastInteraction.resumo.esporte && (
                            <li>
                              <b>Esporte:</b> {item.lastInteraction.resumo.esporte?.nome}
                            </li>
                          )}
                        </ul>
                      )}

                      {/* AG_PERM */}
                      {item.lastInteraction.type === 'AG_PERM' && (
                        <ul className="text-xs text-gray-700 mt-1 space-y-1">
                          <li>
                            <b>ID:</b> {item.lastInteraction.id}
                          </li>
                          <li>
                            <b>Dia/Horário:</b> {item.lastInteraction.resumo.diaSemana}{' '}
                            {item.lastInteraction.resumo.horario}
                          </li>
                          <li>
                            <b>Status:</b> {item.lastInteraction.resumo.status}
                          </li>
                          <li>
                            <b>Atualizado em:</b> {fmtDateTimeBR(item.lastInteraction.resumo.updatedAt)}
                          </li>
                          {!!item.lastInteraction.resumo.quadra && (
                            <li>
                              <b>Quadra:</b> {item.lastInteraction.resumo.quadra?.nome} Nº{' '}
                              {item.lastInteraction.resumo.quadra?.numero}
                            </li>
                          )}
                          {!!item.lastInteraction.resumo.esporte && (
                            <li>
                              <b>Esporte:</b> {item.lastInteraction.resumo.esporte?.nome}
                            </li>
                          )}
                        </ul>
                      )}

                      {/* CHURRAS */}
                      {item.lastInteraction.type === 'CHURRAS' && (
                        <ul className="text-xs text-gray-700 mt-1 space-y-1">
                          <li>
                            <b>ID:</b> {item.lastInteraction.id}
                          </li>
                          <li>
                            <b>Data/Turno:</b> {fmtDateTimeBR(item.lastInteraction.resumo.data)} (
                            {item.lastInteraction.resumo.turno})
                          </li>
                          <li>
                            <b>Status:</b> {item.lastInteraction.resumo.status}
                          </li>
                          {!!item.lastInteraction.resumo.churrasqueira && (
                            <li>
                              <b>Churrasqueira:</b> {item.lastInteraction.resumo.churrasqueira?.nome} Nº{' '}
                              {item.lastInteraction.resumo.churrasqueira?.numero}
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {/* Modal confirmar desfazer */}
      {confirmandoUndo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
          <div className="bg-white p-5 rounded-lg shadow-lg w-[380px]">
            <h3 className="text-lg font-semibold mb-3">Desfazer exclusão?</h3>
            <p className="text-sm text-gray-700 mb-4">
              Reabilitar o acesso de <b>{confirmandoUndo.usuario?.nome}</b> ({confirmandoUndo.usuario?.email})?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmandoUndo(null)}
                disabled={desfazendo}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Não
              </button>
              <button
                onClick={() => desfazer(confirmandoUndo.usuario.id)}
                disabled={desfazendo}
                className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {desfazendo ? 'Processando…' : 'Sim, desfazer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
