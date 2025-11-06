'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import Spinner from '@/components/Spinner'

const toNumber = (v: unknown) => {
  const n = Number(
    typeof v === 'string'
      ? v.replace('.', '').replace(',', '.')
      : v,
  )
  return Number.isFinite(n) ? n : 0
}

const currencyBRL = (n: number | string) =>
  toNumber(n).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })

export default function ConfigValorMultaPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

  const [valorAtual, setValorAtual] = useState<string>('0')
  const [novoValor, setNovoValor] = useState<string>('0')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)

  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false)

  // carrega valor atual da multa
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setCarregando(true)
        setErro(null)

        const res = await axios.get<{ valorMultaPadrao: string }>(
          `${API_URL}/configuracoes/config/multa`,
          { withCredentials: true },
        )

        const valor = res.data?.valorMultaPadrao || '50'
        setValorAtual(valor)
        setNovoValor(valor.replace('.', ','))
      } catch (e: any) {
        console.error(e)
        setErro(
          e?.response?.data?.erro ||
            'Erro ao carregar configuração de multa.',
        )
      } finally {
        setCarregando(false)
      }
    }

    void fetchConfig()
  }, [API_URL])

  const handleSalvarClick = () => {
    setSucesso(null)
    setErro(null)

    const n = toNumber(novoValor)
    if (!Number.isFinite(n) || n < 0) {
      setErro('Informe um valor válido maior ou igual a zero.')
      return
    }

    // abre cardzinho de confirmação
    setMostrarConfirmacao(true)
  }

  const confirmarAlteracao = async () => {
    const valorNumber = toNumber(novoValor)

    try {
      setSalvando(true)
      setErro(null)

      const res = await axios.put(
        `${API_URL}/configuracoes/config/multa`,
        { valorMultaPadrao: valorNumber },
        { withCredentials: true },
      )

      const valorResp: string =
        res.data?.valorMultaPadrao ?? String(valorNumber)

      setValorAtual(valorResp)
      setNovoValor(valorResp.replace('.', ','))

      setSucesso('Valor da multa atualizado com sucesso.')
      setMostrarConfirmacao(false)
    } catch (e: any) {
      console.error(e)
      setErro(
        e?.response?.data?.erro ||
          'Erro ao atualizar o valor da multa.',
      )
    } finally {
      setSalvando(false)
    }
  }

  const cancelarAlteracao = () => {
    setMostrarConfirmacao(false)
  }

  const valorAtualNumber = toNumber(valorAtual)
  const novoValorNumber = toNumber(novoValor)

  return (
    <div className="max-w-xl mx-auto mt-6 sm:mt-10 p-4 sm:p-6 bg-white rounded-xl shadow-sm border border-gray-200">
      <h1 className="text-lg sm:text-xl font-semibold tracking-tight mb-2">
        Configuração — Valor padrão da multa
      </h1>

      <p className="text-[13px] text-gray-600 mb-4">
        Este valor é usado como padrão para novas multas aplicadas no
        sistema (automáticas ou manuais). Multas já registradas não são
        alteradas quando você muda este valor.
      </p>

      {carregando && (
        <div className="flex items-center gap-2 text-gray-600 mb-3">
          <Spinner /> <span>Carregando valor atual…</span>
        </div>
      )}

      {!carregando && (
        <>
          <div className="mb-4 space-y-2">
            <div className="rounded-md bg-gray-50 px-3 py-2 border border-gray-200 text-[13px] text-gray-700">
              <div className="flex items-center justify-between">
                <span>Valor atual da multa:</span>
                <span className="font-semibold">
                  {currencyBRL(valorAtualNumber)}
                </span>
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-sm text-gray-700 mb-1">
                Novo valor padrão (R$)
              </label>
              <input
                type="text"
                value={novoValor}
                onChange={(e) => {
                  setNovoValor(e.target.value)
                  setSucesso(null)
                  setErro(null)
                }}
                className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                placeholder="Ex.: 50,00"
              />
              <span className="text-[11px] text-gray-500 mt-1">
                Use vírgula ou ponto, por exemplo: <b>40</b>, <b>40.5</b>{' '}
                ou <b>40,50</b>.
              </span>
            </div>
          </div>

          {erro && (
            <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {erro}
            </div>
          )}

          {sucesso && (
            <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-100 rounded-md px-3 py-2">
              {sucesso}
            </div>
          )}

          <button
            type="button"
            onClick={handleSalvarClick}
            disabled={salvando}
            className="w-full sm:w-auto px-4 py-2 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            {salvando ? 'Salvando…' : 'Salvar novo valor'}
          </button>

          {/* Cardzinho de confirmação */}
          {mostrarConfirmacao && (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] text-gray-700 shadow-sm">
              <p className="mb-2">
                Confirmar alteração do valor da multa de{' '}
                <span className="font-semibold">
                  {currencyBRL(valorAtualNumber)}
                </span>{' '}
                para{' '}
                <span className="font-semibold text-orange-700">
                  {currencyBRL(novoValorNumber)}
                </span>
                ?
              </p>
              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                <button
                  type="button"
                  onClick={confirmarAlteracao}
                  disabled={salvando}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {salvando ? 'Confirmando…' : 'Confirmar'}
                </button>
                <button
                  type="button"
                  onClick={cancelarAlteracao}
                  disabled={salvando}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-100 text-sm font-medium text-gray-700 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
