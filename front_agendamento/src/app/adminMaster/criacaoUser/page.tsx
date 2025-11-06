'use client'

import { useState } from 'react'
import axios from 'axios'
import Spinner from '@/components/Spinner'

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

export default function CriarUsuarioAdminPage() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [tipo, setTipo] = useState<TipoUsuario>('CLIENTE')
  const [celular, setCelular] = useState('')
  const [cpf, setCpf] = useState('')
  const [nascimento, setNascimento] = useState('') // yyyy-mm-dd
  const [verificado, setVerificado] = useState(true)

  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [senhaTemporaria, setSenhaTemporaria] = useState<string | null>(null)
  const [usuarioCriado, setUsuarioCriado] = useState<Usuario | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setSucesso(null)
    setSenhaTemporaria(null)
    setUsuarioCriado(null)

    const payload: any = {
      nome: nome.trim(),
      email: email.trim(),
      tipo,
      verificado,
    }

    if (senha.trim()) payload.senha = senha.trim()
    if (celular.trim()) payload.celular = celular.trim()
    if (cpf.trim()) payload.cpf = cpf.trim()
    if (nascimento) payload.nascimento = nascimento

    setLoading(true)
    try {
      const res = await axios.post<CriarUsuarioResponse>(
        `${API_URL}/clientes/admin/criar`,
        payload,
        { withCredentials: true },
      )

      setSucesso(res.data.mensagem || 'Usuário criado com sucesso.')
      setSenhaTemporaria(res.data.senhaTemporaria || null)
      setUsuarioCriado(res.data.usuario)
    } catch (e: any) {
      console.error(e)
      setErro(e?.response?.data?.erro || 'Erro ao criar usuário')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto mt-6 sm:mt-10 p-4 sm:p-6 bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="mb-4 flex flex-col gap-2">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight">
          Criar usuário manualmente
        </h1>
        <p className="text-sm text-gray-600">
          Use esta tela para cadastrar usuários manualmente (por exemplo, pessoas sem acesso
          ao e-mail). O usuário já pode entrar como <strong>verificado</strong>, pulando a etapa
          de código por e-mail.
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
            onChange={(e) => setNome(e.target.value)}
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            required
          />
          <p className="text-xs text-gray-500">
            Obrigatório. Mínimo de 3 caracteres.
          </p>
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            E-mail <span className="text-red-600">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Deixe em branco para gerar uma senha automática"
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <p className="text-xs text-gray-500">
            Opcional. Se informar, precisa ter pelo menos{' '}
            <span className="font-semibold">6 caracteres</span> e{' '}
            <span className="font-semibold">1 letra maiúscula</span>. Se deixar em branco, o
            sistema gera uma <span className="font-semibold">senha temporária forte</span> e
            mostra logo abaixo.
          </p>
        </div>

        {/* Tipo */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Tipo de usuário <span className="text-red-600">*</span>
          </label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoUsuario)}
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
            onChange={(e) => setCelular(e.target.value)}
            placeholder="Ex: 11999998888"
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <p className="text-xs text-gray-500">
            Opcional. Pode deixar em branco se não tiver na hora.
          </p>
        </div>

        {/* CPF */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">CPF (opcional)</label>
          <input
            type="text"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
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
            onChange={(e) => setNascimento(e.target.value)}
            className="p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <p className="text-xs text-gray-500">
            Opcional. Use o calendário para selecionar dia/mês/ano.
          </p>
        </div>

        {/* Verificado */}
        <div className="flex flex-col gap-1">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={verificado}
              onChange={(e) => setVerificado(e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
            />
            Marcar usuário como verificado
          </label>
          <p className="text-xs text-gray-500">
            Se marcado (padrão), o usuário já entra como{' '}
            <span className="font-semibold">verificado</span> e não precisa confirmar o
            e-mail. Desmarque apenas se quiser que ele passe pela verificação depois.
          </p>
        </div>

        {/* Erro / sucesso */}
        {erro && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {erro}
          </div>
        )}

        {sucesso && (
          <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
            {sucesso}
          </div>
        )}

        {senhaTemporaria && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
            <div className="font-semibold mb-1">Senha temporária gerada:</div>
            <div className="inline-flex items-center gap-2">
              <code className="px-2 py-1 bg-white border border-blue-200 rounded text-xs">
                {senhaTemporaria}
              </code>
            </div>
            <p className="mt-1 text-xs text-blue-900">
              Entregue essa senha ao usuário e oriente a trocar no primeiro acesso.
            </p>
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
          <h2 className="text-sm font-semibold text-gray-800 mb-2">
            Último usuário criado
          </h2>
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
