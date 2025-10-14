'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import Spinner from '@/components/Spinner'

type PorFaixa = { faixa: string; aulas: number; valor: number }
type PorDia = { data: string; aulas: number; valor: number }

type AdminProfessorRow = {
  id: string
  nome: string
  valorQuadra: number | string | null
  aulasMes: number
  valorMes: number
  porFaixa: PorFaixa[]
}

type AdminListResponse = {
  intervalo: { from: string; to: string; duracaoMin: number }
  professores: AdminProfessorRow[]
  totalGeral: { aulas: number; valor: number }
}

type ResumoProfessorResponse = {
  professor: { id: string; nome: string; valorQuadra: number }
  intervalo: { from: string; to: string; duracaoMin: number }
  totais: {
    porDia: PorDia[]
    porFaixa: PorFaixa[]
    mes: { aulas: number; valor: number }
  }
}

/** ===== helpers comuns ===== */
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true })

const numberToBR = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatBRL = (n: number) => `R$ ${numberToBR(n)}`

const currencyBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

const fmtBR = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
const fmtDDMM = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}`
}

const currentMonthSP = () => {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()) // YYYY-MM-DD
  return s.slice(0, 7) // YYYY-MM
}

// mesmas faixas usadas no quadro do professor
function buildFaixasLabels(toDateISO: string) {
  const lastDay = Number(toDateISO.split('-')[2])
  return [
    { id: '1-7', fromDay: 1, toDay: 7, label: '' },
    { id: '8-14', fromDay: 8, toDay: 14, label: '' },
    { id: '15-21', fromDay: 15, toDay: 21, label: '' },
    { id: `22-${lastDay}`, fromDay: 22, toDay: lastDay, label: '' },
  ] as Array<{ id: string; label: string; fromDay: number; toDay: number }>
}

export default function ProfessoresAdmin() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

  const [mes, setMes] = useState(currentMonthSP())
  const [busca, setBusca] = useState('')
  const [lista, setLista] = useState<AdminProfessorRow[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // seleção e quadro
  const [selecionado, setSelecionado] = useState<AdminProfessorRow | null>(null)
  const [quadro, setQuadro] = useState<ResumoProfessorResponse | null>(null)
  const [loadingQuadro, setLoadingQuadro] = useState(false)
  const [erroQuadro, setErroQuadro] = useState<string | null>(null)

  // estados do “quadro” (iguais aos da tela do professor)
  const [faixaSel, setFaixaSel] = useState<string>('') // '1-7', '8-14', ...
  const [diaSel, setDiaSel] = useState<string>('')     // 'YYYY-MM-DD'

  const carregarProfessores = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const res = await axios.get<AdminListResponse>(`${API_URL}/professores/admin`, {
        params: { mes },
        withCredentials: true,
      })
      const arr = Array.isArray(res.data?.professores) ? res.data.professores.slice() : []
      arr.sort((a, b) => collator.compare(a?.nome ?? '', b?.nome ?? ''))
      setLista(arr)
    } catch (e: any) {
      console.error(e)
      setErro(e?.response?.data?.erro || 'Falha ao carregar professores')
      setLista([])
    } finally {
      setLoading(false)
    }
  }, [API_URL, mes])

  useEffect(() => {
    void carregarProfessores()
  }, [carregarProfessores])

  // filtro client-side por nome
  const filtrados = useMemo(() => {
    const q = busca.trim()
    if (!q) return lista
    return lista.filter(p =>
      collator.compare(p.nome, q) === 0 || p.nome.toLowerCase().includes(q.toLowerCase())
    )
  }, [lista, busca])

  // carregar quadro ao selecionar
  const abrirQuadro = async (prof: AdminProfessorRow) => {
    if (selecionado?.id === prof.id) {
      // toggle fechar
      setSelecionado(null)
      setQuadro(null)
      setErroQuadro(null)
      setFaixaSel('')
      setDiaSel('')
      return
    }
    setSelecionado(prof)
    setQuadro(null)
    setErroQuadro(null)
    setLoadingQuadro(true)
    try {
      const res = await axios.get<ResumoProfessorResponse>(`${API_URL}/professores/${prof.id}/resumo`, {
        params: { mes },
        withCredentials: true,
      })
      setQuadro(res.data)

      // defaults do quadro replicando a tela do professor
      const faixas = buildFaixasLabels(res.data.intervalo.to)
      setFaixaSel(faixas[0]?.id || '')
      setDiaSel('')
    } catch (e: any) {
      console.error(e)
      setErroQuadro(e?.response?.data?.erro || 'Falha ao carregar o quadro deste professor')
    } finally {
      setLoadingQuadro(false)
    }
  }

  // mapeia faixas -> labels e limites (como na tela do professor)
  const faixasInfo = useMemo(() => {
    if (!quadro) return []
    const yearMonth = quadro.intervalo.to.slice(0, 7)
    return buildFaixasLabels(quadro.intervalo.to).map((f, idx) => {
      const fromISO = `${yearMonth}-${String(f.fromDay).padStart(2, '0')}`
      const toISO = `${yearMonth}-${String(f.toDay).padStart(2, '0')}`
      const semanaNum = String(idx + 1).padStart(2, '0')
      const label = `SEMANA ${semanaNum} — ${fmtDDMM(fromISO)} À ${fmtDDMM(toISO)}`
      return { ...f, label, fromISO, toISO }
    })
  }, [quadro])

  // dias da faixa selecionada
  const diasDaFaixa = useMemo(() => {
    if (!quadro || !faixaSel) return []
    const info = faixasInfo.find(f => f.id === faixaSel)
    if (!info) return []
    const inRange = (ymd: string) => {
      const day = Number(ymd.split('-')[2])
      return day >= info.fromDay && day <= info.toDay
    }
    return quadro.totais.porDia.filter(d => inRange(d.data))
  }, [quadro, faixaSel, faixasInfo])

  // default de dia quando muda a faixa
  useEffect(() => {
    if (diaSel) return
    if (diasDaFaixa.length) {
      setDiaSel(diasDaFaixa[0].data)
    }
  }, [diasDaFaixa, diaSel])

  // totais da semana selecionada
  const totaisSemanaSel = useMemo(() => {
    if (!quadro || !faixaSel) return { aulas: 0, valor: 0 }
    const f = quadro.totais.porFaixa.find(x => x.faixa === faixaSel)
    return f ? { aulas: f.aulas, valor: f.valor } : { aulas: 0, valor: 0 }
  }, [quadro, faixaSel])

  // dia selecionado
  const diaInfoSel = useMemo(() => {
    if (!diaSel || !diasDaFaixa.length) return null
    return diasDaFaixa.find(d => d.data === diaSel) || null
  }, [diaSel, diasDaFaixa])

  // navegação de mês
  const incMes = (delta: number) => {
    const [yStr, mStr] = mes.split('-')
    const y = Number(yStr)
    const m = Number(mStr) - 1
    const d = new Date(Date.UTC(y, m, 1))
    d.setUTCMonth(d.getUTCMonth() + delta)
    const yy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    setMes(`${yy}-${mm}`)
    // fechamos o painel aberto porque muda a referência do resumo
    setSelecionado(null)
    setQuadro(null)
    setFaixaSel('')
    setDiaSel('')
  }

  return (
    <div className="max-w-5xl mx-auto mt-10 p-6 bg-white rounded shadow">
      <h1 className="text-2xl font-medium mb-4">Professores — Quadro e Pagamentos do Mês</h1>

      <div className="flex flex-col md:flex-row gap-4 mb-4 md:items-end">
        <div className="flex-1 flex flex-col">
          <label className="font-medium mb-1">Buscar por nome</label>
          <input
            type="text"
            placeholder="Digite o nome do professor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="p-2 border rounded w-full"
          />
        </div>

        <div className="w-full md:w-56 flex flex-col">
          <label className="font-medium mb-1">Mês</label>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="p-2 border rounded cursor-pointer"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => incMes(-1)}
            className="bg-gray-100 text-gray-800 px-3 py-2 rounded h-[42px]"
            aria-label="Mês anterior"
          >
            ‹
          </button>
          <button
            onClick={() => incMes(1)}
            className="bg-gray-100 text-gray-800 px-3 py-2 rounded h-[42px]"
            aria-label="Próximo mês"
          >
            ›
          </button>
          <button
            onClick={() => void carregarProfessores()}
            className="bg-orange-600 text-white px-4 py-2 rounded h-[42px]"
          >
            Atualizar
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-600 mb-3">
          <Spinner /> <span>Carregando professores…</span>
        </div>
      )}
      {erro && <div className="mb-3 text-red-600 text-sm">{erro}</div>}

      <ul className="border rounded divide-y">
        {!loading && filtrados.length === 0 && (
          <li className="p-4 text-sm text-gray-600">Nenhum professor encontrado.</li>
        )}

        {filtrados.map((p) => (
          <li key={p.id}>
            {/* linha do professor */}
            <div
              className="p-3 hover:bg-gray-100 cursor-pointer flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
              onClick={() => void abrirQuadro(p)}
            >
              <div className="font-semibold">{p.nome}</div>
              <div className="text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
                <span><strong>Aulas no mês:</strong> {p.aulasMes}</span>
                <span><strong>Valor a pagar:</strong> {formatBRL(Number(p.valorMes || 0))}</span>
                {p.valorQuadra != null && (
                  <span className="text-gray-500">
                    (Valor/aula: {formatBRL(Number(p.valorQuadra) || 0)})
                  </span>
                )}
              </div>
            </div>

            {/* painel do quadro (replica a tela do professor) */}
            {selecionado?.id === p.id && (
              <div className="p-4 border-t bg-gray-50">
                {loadingQuadro && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Spinner /> <span>Carregando quadro…</span>
                  </div>
                )}
                {erroQuadro && <div className="text-red-600 text-sm">{erroQuadro}</div>}

                {!loadingQuadro && quadro && (
                  <div className="max-w-sm">
                    {/* header compacto */}
                    <div className="mb-3">
                      <h2 className="text-lg font-bold">{quadro.professor.nome}</h2>
                      <p className="text-xs text-gray-600">
                        Período: {quadro.intervalo.from} a {quadro.intervalo.to}
                        {' · '}
                        Duração: {quadro.intervalo.duracaoMin} min
                      </p>
                    </div>

                    {/* Semana (select) */}
                    <div className="mb-2">
                      <div className="text-[11px] text-gray-500 mb-1">Semana</div>
                      <select
                        value={faixaSel}
                        onChange={(e) => {
                          setFaixaSel(e.target.value)
                          setDiaSel('')
                        }}
                        className="w-full rounded-md bg-[#f3f3f3] px-3 py-2 text-[13px] font-semibold text-gray-700 cursor-pointer"
                      >
                        {faixasInfo.map((f, i) => (
                          <option key={f.id} value={f.id}>
                            {`SEMANA ${String(i + 1).padStart(2, '0')} — ${fmtDDMM(f.fromISO)} À ${fmtDDMM(f.toISO)}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Dia (select) */}
                    <div className="mb-2">
                      <div className="text-[11px] text-gray-500 mb-1">Dia</div>
                      <select
                        value={diaSel}
                        onChange={(e) => setDiaSel(e.target.value)}
                        className="w-full rounded-md bg-[#f3f3f3] px-3 py-2 text-[13px] font-semibold text-gray-700 cursor-pointer"
                      >
                        {diasDaFaixa.map((d) => (
                          <option key={d.data} value={d.data}>
                            {`Dia: ${fmtBR(d.data)}  |  Aulas: ${String(d.aulas).padStart(2, '0')}`}
                          </option>
                        ))}
                        {diasDaFaixa.length === 0 && <option value="">Sem aulas nesta semana</option>}
                      </select>
                    </div>

                    {/* Linha com dia selecionado */}
                    {diaInfoSel && (
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="rounded-md bg-gray-100 px-3 py-2 text-[13px] text-gray-600">
                          <span className="opacity-70 mr-1">Dia:</span>
                          <span className="font-semibold">{fmtBR(diaInfoSel.data)}</span>
                        </div>
                        <div className="rounded-md bg-gray-100 px-3 py-2 text-[13px] text-gray-600">
                          <span className="opacity-70 mr-1">Aulas:</span>
                          <span className="font-semibold text-orange-600">
                            {String(diaInfoSel.aulas).padStart(2, '0')}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Totais da semana */}
                    <div className="rounded-md bg-gray-200 px-3 py-2 text-[13px] text-gray-700 mb-2">
                      <div className="flex items-center justify-between">
                        <span>Total de Aulas:</span>
                        <span className="font-semibold">{totaisSemanaSel.aulas}</span>
                      </div>
                    </div>
                    <div className="rounded-md bg-gray-200 px-3 py-2 text-[13px] text-gray-700">
                      <div className="flex items-center justify-between">
                        <span>Total a pagar:</span>
                        <span className="font-semibold">{currencyBRL(totaisSemanaSel.valor)}</span>
                      </div>
                    </div>

                    {/* separador */}
                    <div className="my-3 border-t border-gray-200" />

                    {/* Totais do mês */}
                    <div className="rounded-md bg-gray-100 px-3 py-2 text-[13px] text-gray-700">
                      <div className="flex items-center justify-between">
                        <span>Total do mês — aulas:</span>
                        <span className="font-semibold">{quadro.totais.mes.aulas}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span>Total do mês — a pagar:</span>
                        <span className="font-semibold">{currencyBRL(quadro.totais.mes.valor)}</span>
                      </div>
                    </div>

                    {/* rodapé */}
                    <p className="mt-2 text-[11px] text-gray-500">
                      Duração considerada por aula: {quadro.intervalo.duracaoMin} min · Valor por aula:{' '}
                      {currencyBRL(quadro.professor.valorQuadra || 0)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
