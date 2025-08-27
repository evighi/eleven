'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'

type Esporte = { id: number; nome: string }
type Usuario = { id: number; nome: string }
type Quadra = { quadraId: number; nome: string; numero: number }
type DisponibilidadeQuadra = Quadra & { disponivel: boolean }

export default function AgendamentoComum() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001'

  const [data, setData] = useState<string>('')
  const [esportes, setEsportes] = useState<Esporte[]>([])
  const [esporteSelecionado, setEsporteSelecionado] = useState<string>('')
  const [horario, setHorario] = useState<string>('')

  const [quadrasDisponiveis, setQuadrasDisponiveis] = useState<Quadra[]>([])
  const [quadraSelecionada, setQuadraSelecionada] = useState<string>('')

  const [mensagem, setMensagem] = useState<string>('')

  const [buscaUsuario, setBuscaUsuario] = useState<string>('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<Usuario[]>([])
  const [jogadores, setJogadores] = useState<Usuario[]>([])

  // Esportes
  useEffect(() => {
    axios
      .get<Esporte[]>(`${API_URL}/esportes`, { withCredentials: true })
      .then((res) => setEsportes(res.data))
      .catch((err) => console.error(err))
  }, [API_URL])

  // Disponibilidade
  useEffect(() => {
    const buscarDisponibilidade = async () => {
      if (!data || !esporteSelecionado || !horario) {
        setQuadrasDisponiveis([])
        return
      }

      try {
        const { data: disp } = await axios.get<DisponibilidadeQuadra[]>(
          `${API_URL}/disponibilidade`,
          {
            params: { data, horario, esporteId: esporteSelecionado },
            withCredentials: true,
          }
        )

        // mantém só as disponíveis e remove o campo 'disponivel' na UI
        setQuadrasDisponiveis(
          disp
            .filter((q) => q.disponivel)
            .map(({ quadraId, nome, numero }) => ({ quadraId, nome, numero }))
        )
        setMensagem(disp.length === 0 ? 'Nenhuma quadra disponível.' : '')
      } catch (err) {
        console.error(err)
        setMensagem('Erro ao verificar disponibilidade.')
      }
    }

    buscarDisponibilidade()
  }, [API_URL, data, esporteSelecionado, horario])

  // Busca de usuários
  useEffect(() => {
    const buscar = async () => {
      if (buscaUsuario.trim().length < 2) {
        setUsuariosEncontrados([])
        return
      }

      try {
        const { data } = await axios.get<Usuario[]>(
          `${API_URL}/clientes`,
          {
            params: { nome: buscaUsuario },
            withCredentials: true,
          }
        )
        setUsuariosEncontrados(data)
      } catch (err) {
        console.error(err)
      }
    }

    const delay = setTimeout(buscar, 300)
    return () => clearTimeout(delay)
  }, [API_URL, buscaUsuario])

  const adicionarJogador = (usuario: Usuario) => {
    setJogadores((prev) =>
      prev.find((j) => j.id === usuario.id) ? prev : [...prev, usuario]
    )
    setBuscaUsuario('')
    setUsuariosEncontrados([])
  }

  const removerJogador = (id: number) => {
    setJogadores((prev) => prev.filter((j) => j.id !== id))
  }

  const agendar = async () => {
    if (!quadraSelecionada || jogadores.length === 0) {
      setMensagem('Selecione uma quadra e pelo menos um jogador.')
      return
    }

    const usuarioId = jogadores[0].id

    try {
      await axios.post(
        `${API_URL}/agendamentos`,
        {
          data,
          horario,
          esporteId: esporteSelecionado, // ajuste se backend espera número/UUID
          quadraId: quadraSelecionada,   // idem
          usuarioId,
          jogadoresIds: jogadores.map((j) => j.id),
        },
        { withCredentials: true }
      )

      setMensagem('✅ Agendamento realizado com sucesso!')
      setQuadraSelecionada('')
      setQuadrasDisponiveis([])
      setJogadores([])
    } catch (error) {
      console.error(error)
      setMensagem('Erro ao realizar agendamento.')
    }
  }

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white shadow rounded-xl">
      <h1 className="text-2xl font-bold mb-4">Agendar Quadra Comum</h1>

      <label className="block mb-2">Data</label>
      <input
        type="date"
        className="w-full p-2 border rounded mb-4"
        value={data}
        onChange={(e) => setData(e.target.value)}
      />

      <label className="block mb-2">Esporte</label>
      <select
        className="w-full p-2 border rounded mb-4"
        value={esporteSelecionado}
        onChange={(e) => setEsporteSelecionado(e.target.value)}
      >
        <option value="">Selecione um esporte</option>
        {esportes.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome}
          </option>
        ))}
      </select>

      <label className="block mb-2">Horário</label>
      <select
        className="w-full p-2 border rounded mb-4"
        value={horario}
        onChange={(e) => setHorario(e.target.value)}
      >
        <option value="">Selecione um horário</option>
        {['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'].map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>

      {/* Busca e seleção de jogadores */}
      <div className="mb-4">
        <label className="block mb-1 font-medium">Adicionar Jogadores</label>
        <input
          type="text"
          className="w-full p-2 border rounded mb-2"
          placeholder="Buscar por nome do usuário"
          value={buscaUsuario}
          onChange={(e) => setBuscaUsuario(e.target.value)}
        />

        {usuariosEncontrados.length > 0 && (
          <ul className="border rounded mb-2 max-h-40 overflow-y-auto">
            {usuariosEncontrados.map((u) => (
              <li
                key={u.id}
                className="p-2 hover:bg-gray-100 cursor-pointer"
                onClick={() => adicionarJogador(u)}
              >
                {u.nome}
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
                  key={j.id}
                  className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center gap-2"
                >
                  {j.nome}
                  <button
                    onClick={() => removerJogador(j.id)}
                    className="ml-1 text-red-500"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {quadrasDisponiveis.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-semibold">Quadras Disponíveis</h2>
          <div className="grid grid-cols-2 gap-2">
            {quadrasDisponiveis.map((q) => (
              <button
                key={q.quadraId}
                className={`p-2 rounded border ${
                  quadraSelecionada === String(q.quadraId)
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100'
                }`}
                onClick={() => setQuadraSelecionada(String(q.quadraId))}
              >
                {q.nome} - {q.numero}
              </button>
            ))}
          </div>

          <button
            className="mt-4 bg-orange-600 text-white px-4 py-2 rounded"
            onClick={agendar}
          >
            Confirmar Agendamento
          </button>
        </div>
      )}

      {mensagem && (
        <p className="mt-4 text-center text-sm text-red-600">{mensagem}</p>
      )}
    </div>
  )
}
