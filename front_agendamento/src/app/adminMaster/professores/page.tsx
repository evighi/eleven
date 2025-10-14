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

/** ===== helpers ===== */
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', ignorePunctuation: true })

const numberToBR = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatBRL = (n: number) => `R$ ${numberToBR(n)}`

const currentMonthSP = () => {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()) // YYYY-MM-DD
  return s.slice(0, 7) // YYYY-MM
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

  const carregarProfessores = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const res = await axios.get<AdminListResponse>(`${API_URL}/professores/admin`, {
        params: { mes },
        withCredentials: true,
      })
      const arr = Array.isArray(res.data?.professores) ? res.data.professores.slice() : []
      // ordena por nome pt-BR
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
    return lista.filter(p => collator.compare(p.nome, q) === 0 || p.nome.toLowerCase().includes(q.toLowerCase()))
  }, [lista, busca])

  // carregar quadro ao selecionar
  const abrirQuadro = async (prof: AdminProfessorRow) => {
    if (selecionado?.id === prof.id) {
      // toggle fechar
      setSelecionado(null)
      setQuadro(null)
      setErroQuadro(null)
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
    } catch (e: any) {
      console.error(e)
      setErroQuadro(e?.response?.data?.erro || 'Falha ao carregar o quadro deste professor')
    } finally {
      setLoadingQuadro(false)
    }
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

        <button
          onClick={() => void carregarProfessores()}
          className="bg-blue-600 text-white px-4 py-2 rounded h-[42px] md:mt-0"
        >
          Atualizar
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-600 mb-3">
          <Spinner /> <span>Carregando professores…</span>
        </div>
      )}
      {erro && (
        <div className="mb-3 text-red-600 text-sm">{erro}</div>
      )}

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

            {/* painel do quadro (toggle) */}
            {selecionado?.id === p.id && (
              <div className="p-4 border-t bg-gray-50">
                {loadingQuadro && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Spinner /> <span>Carregando quadro…</span>
                  </div>
                )}
                {erroQuadro && (
                  <div className="text-red-600 text-sm">{erroQuadro}</div>
                )}
                {!loadingQuadro && quadro && (
                  <div className="space-y-4">
                    {/* cabeçalho */}
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                      <div>
                        <h2 className="font-bold text-lg">{quadro.professor.nome}</h2>
                        <p className="text-sm text-gray-600">
                          Período: {quadro.intervalo.from} a {quadro.intervalo.to} · Duração padrão: {quadro.intervalo.duracaoMin} min
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">Total do mês</div>
                        <div className="font-semibold">
                          {quadro.totais.mes.aulas} aulas · {formatBRL(quadro.totais.mes.valor)}
                        </div>
                      </div>
                    </div>

                    {/* por faixa */}
                    <div>
                      <h3 className="font-medium mb-2">Resumo por faixa</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {quadro.totais.porFaixa.map((f) => (
                          <div key={f.faixa} className="rounded border bg-white p-3 shadow-sm">
                            <div className="text-xs text-gray-500">{f.faixa}</div>
                            <div className="text-sm"><strong>{f.aulas}</strong> aulas</div>
                            <div className="text-sm">{formatBRL(f.valor)}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* por dia (opcional: útil para conferência) */}
                    <div>
                      <h3 className="font-medium mb-2">Detalhe por dia</h3>
                      <div className="overflow-auto border rounded">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="bg-gray-100 text-left">
                              <th className="px-3 py-2">Data</th>
                              <th className="px-3 py-2">Aulas</th>
                              <th className="px-3 py-2">Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quadro.totais.porDia.map((d) => (
                              <tr key={d.data} className="border-t">
                                <td className="px-3 py-2">{d.data}</td>
                                <td className="px-3 py-2">{d.aulas}</td>
                                <td className="px-3 py-2">{formatBRL(d.valor)}</td>
                              </tr>
                            ))}
                            {quadro.totais.porDia.length === 0 && (
                              <tr>
                                <td className="px-3 py-2 text-gray-500" colSpan={3}>Sem aulas no período.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
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
