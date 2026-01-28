'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Spinner from '@/components/Spinner'
import SystemAlert, { AlertVariant } from '@/components/SystemAlert'

type TipoUsuario =
  | 'CLIENTE'
  | 'ADMIN_MASTER'
  | 'ADMIN_ATENDENTE'
  | 'ADMIN_PROFESSORES'
  | 'CLIENTE_APOIADO'

type Usuario = {
  id: string
  nome: string
  email: string
  celular?: string | null
  cpf?: string | null
  nascimento?: string | null
  verificado: boolean
  tipo: TipoUsuario
}

type CriarUsuarioResponse = {
  mensagem: string
  usuario: Usuario
  senhaTemporaria?: string
}

type Feedback = { kind: 'success' | 'error' | 'info'; text: string }

function getApiErrorMessage(e: any, fallback: string) {
  return (
    e?.response?.data?.erro ||
    e?.response?.data?.message ||
    e?.response?.data?.msg ||
    e?.response?.data?.error ||
    e?.message ||
    fallback
  )
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function senhaEhValida(senha: string) {
  const s = senha.trim()
  if (s.length < 6) return false
  if (!/[A-Z]/.test(s)) return false
  return true
}

export default function CriarUsuarioAdminPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'
  const router = useRouter()

  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [tipo, setTipo] = useState<TipoUsuario>('CLIENTE')
  const [celular, setCelular] = useState('')
  const [cpf, setCpf] = useState('')
  const [nascimento, setNascimento] = useState('') // yyyy-mm-dd
  const [verificado, setVerificado] = useState(true)

  const [loading, setLoading] = useState(false)

  // ✅ Feedback padronizado
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const closeFeedback = () => setFeedback(null)

  const [senhaTemporaria, setSenhaTemporaria] = useState<string | null>(null)
  const [usuarioCriado, setUsuarioCriado] = useState<Usuario | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setFeedback(null)
    setSenhaTemporaria(null)
    setUsuarioCriado(null)

    const nomeTrim = nome.trim()
    const emailTrim = email.trim()
    const senhaTrim = senha.trim()
    const senhaInformada = !!senhaTrim

    // ✅ validações front (padronizadas)
    if (nomeTrim.length < 3) {
      setFeedback({ kind: 'error', text: 'Informe um nome com pelo menos 3 caracteres.' })
      return
    }

    if (!isValidEmail(emailTrim)) {
      setFeedback({ kind: 'error', text: 'Informe um e-mail válido.' })
      return
    }

    if (senhaInformada && !senhaEhValida(senhaTrim)) {
      setFeedback({
        kind: 'error',
        text: 'A senha precisa ter no mínimo 6 caracteres e 1 letra maiúscula.',
      })
      return
    }

    const payload: any = {
      nome: nomeTrim,
      email: emailTrim,
      tipo,
      verificado,
    }

    if (senhaInformada) payload.senha = senhaTrim
    if (celular.trim()) payload.celular = celular.trim()
    if (cpf.trim()) payload.cpf = cpf.trim()
    if (nascimento) payload.nascimento = nascimento

    setLoading(true)
    try {
      const res = await axios.post<CriarUsuarioResponse>(`${API_URL}/clientes/admin/criar`, payload, {
        withCredentials: true,
      })

      const msgSucesso = res.data.mensagem || 'Usuário criado com sucesso.'
      setFeedback({ kind: 'success', text: msgSucesso })

      setSenhaTemporaria(res.data.senhaTemporaria || null)
      setUsuarioCriado(res.data.usuario)

      // ✅ Se a senha foi digitada manualmente, pode redirecionar automático
      if (senhaInformada) {
        setTimeout(() => {
          router.push('/adminMaster/usuarios')
        }, 1200)
      }
    } catch (e: any) {
      console.error(e)
      const msg = getApiErrorMessage(e, 'Erro ao criar usuário.')
      setFeedback({ kind: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }

  const copiarSenhaTemporaria = async () => {
    if (!senhaTemporaria) return
    try {
      await navigator.clipboard.writeText(senhaTemporaria)
      setFeedback({ kind: 'success', text: 'Senha temporária copiada!' })
    } catch (e) {
      console.error(e)
      setFeedback({ kind: 'error', text: 'Não foi possível copiar. Copie manualmente.' })
    }
  }

  return (
    <div className="max-w-3xl mx-auto mt-6 sm:mt-10 p-4 sm:p-6 bg-white rounded-xl shadow-sm border border-gray-200">
      {/* ✅ ALERTA PADRONIZADO */}
      <SystemAlert
        open={!!feedback}
        variant={(feedback?.kind as AlertVariant) || 'info'}
        message={feedback?.text || ''}
        onClose={closeFeedback}
      />

      <div className="mb-4 flex flex-col gap-2">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight">
          Criar usuário manualmente
        </h1>
        <p className="text-sm text-gray-600">
          Use esta tela para cadastrar usuários manualmente (por exemplo, pessoas sem acesso ao
          e-mail). O usuário já pode entrar como <strong>verificado</strong>, pulando a etapa de
          código por e-mail.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Nome */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Nome completo <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => {
              setNome(e.target.value)
              setFeedback(null)
            }}
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            required
          />
          <p className="text-xs text-gray-500">Obrigatório. Mínimo de 3 caracteres.</p>
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            E-mail <span className="text-red-600">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setFeedback(null)
            }}
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            required
          />
          <p className="text-xs text-gray-500">
            Obrigatório. Precisa ser único no sistema (não pode repetir).
          </p>
        </div>

        {/* Senha */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Senha (opcional)</label>
          <input
            type="text"
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value)
              setFeedback(null)
            }}
            placeholder="Deixe em branco para gerar uma senha automática"
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <p className="text-xs text-gray-500">
            Opcional. Se informar, precisa ter pelo menos{' '}
            <span className="font-semibold">6 caracteres</span> e{' '}
            <span className="font-semibold">1 letra maiúscula</span>. Se deixar em branco, o
            sistema gera uma <span className="font-semibold">senha temporária forte</span> e mostra
            logo abaixo.
          </p>
        </div>

        {/* Tipo */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Tipo de usuário <span className="text-red-600">*</span>
          </label>
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as TipoUsuario)
              setFeedback(null)
            }}
            className="p-2 border rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <option value="CLIENTE">CLIENTE (padrão)</option>
            <option value="CLIENTE_APOIADO">CLIENTE_APOIADO</option>
            <option value="ADMIN_ATENDENTE">ADMIN_ATENDENTE</option>
            <option value="ADMIN_PROFESSORES">ADMIN_PROFESSORES</option>
            <option value="ADMIN_MASTER">ADMIN_MASTER</option>
          </select>
          <p className="text-xs text-gray-500">
            Obrigatório. Normalmente você vai usar{' '}
            <span className="font-semibold">CLIENTE</span> ou{' '}
            <span className="font-semibold">CLIENTE_APOIADO</span>. Os demais são perfis de
            administração.
          </p>
        </div>

        {/* Celular */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Celular (opcional)</label>
          <input
            type="tel"
            value={celular}
            onChange={(e) => {
              setCelular(e.target.value)
              setFeedback(null)
            }}
            placeholder="Ex: 11999998888"
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <p className="text-xs text-gray-500">Opcional. Pode deixar em branco se não tiver na hora.</p>
        </div>

        {/* CPF */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">CPF (opcional)</label>
          <input
            type="text"
            value={cpf}
            onChange={(e) => {
              setCpf(e.target.value)
              setFeedback(null)
            }}
            placeholder="Somente números"
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <p className="text-xs text-gray-500">
            Opcional. Se preencher, precisa ser único no sistema (não pode repetir).
          </p>
        </div>

        {/* Nascimento */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Data de nascimento (opcional)
          </label>
          <input
            type="date"
            value={nascimento}
            onChange={(e) => {
              setNascimento(e.target.value)
              setFeedback(null)
            }}
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <p className="text-xs text-gray-500">Opcional. Use o calendário para selecionar dia/mês/ano.</p>
        </div>

        {/* Verificado */}
        <div className="flex flex-col gap-1">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={verificado}
              onChange={(e) => {
                setVerificado(e.target.checked)
                setFeedback(null)
              }}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
            />
            Marcar usuário como verificado
          </label>
          <p className="text-xs text-gray-500">
            Se marcado (padrão), o usuário já entra como{' '}
            <span className="font-semibold">verificado</span> e não precisa confirmar o e-mail.
            Desmarque apenas se quiser que ele passe pela verificação depois.
          </p>
        </div>

        {/* senha temporária */}
        {senhaTemporaria && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
            <div className="font-semibold mb-1">Senha temporária gerada:</div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="px-2 py-1 bg-white border border-blue-200 rounded text-xs break-all">
                {senhaTemporaria}
              </code>

              <button
                type="button"
                onClick={copiarSenhaTemporaria}
                className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                Copiar
              </button>
            </div>

            <p className="mt-1 text-xs text-blue-900">
              Copie esta senha e entregue ao usuário. Ele pode trocá-la no primeiro acesso.
            </p>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => router.push('/adminMaster/usuarios')}
                className="inline-flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-300"
              >
                Ir para lista de usuários
              </button>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-300"
        >
          {loading && <Spinner />}
          {loading ? 'Criando usuário…' : 'Criar usuário'}
        </button>
      </form>

      {/* Resuminho do último usuário criado */}
      {usuarioCriado && (
        <div className="mt-6 border-t border-gray-200 pt-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Último usuário criado</h2>
          <div className="text-sm text-gray-700 space-y-1">
            <div>
              <span className="font-medium">Nome: </span>
              {usuarioCriado.nome}
            </div>
            <div>
              <span className="font-medium">E-mail: </span>
              {usuarioCriado.email}
            </div>
            <div>
              <span className="font-medium">Tipo: </span>
              {usuarioCriado.tipo}
            </div>
            <div>
              <span className="font-medium">Verificado: </span>
              {usuarioCriado.verificado ? 'Sim' : 'Não'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
