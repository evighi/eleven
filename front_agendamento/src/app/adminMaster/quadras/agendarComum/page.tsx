'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'

type Esporte = { id: number | string; nome: string }
type Usuario = { id: number | string; nome: string }
type Quadra = { quadraId: number | string; nome: string; numero: number }
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

  // busca/seleção de jogadores cadastrados
  const [buscaUsuario, setBuscaUsuario] = useState<string>('')
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<Usuario[]>([])
  const [jogadores, setJogadores] = useState<Usuario[]>([])

  // 👇 novo: convidado como DONO (opcional, só nome)
  const [ownerGuestNome, setOwnerGuestNome] = useState<string>('')

  // Esportes
  useEffect(() => {
    axios
      .get<Esporte[]>(`${API_URL}/esportes`, { withCredentials: true })
      .then((res) => setEsportes(res.data || []))
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

        setQuadrasDisponiveis(
          (disp || [])
            .filter((q) => q.disponivel)
            .map(({ quadraId, nome, numero }) => ({ quadraId, nome, numero }))
        )
        setMensagem((disp || []).length === 0 ? 'Nenhuma quadra disponível.' : '')
      } catch (err) {
        console.error(err)
        setMensagem('Erro ao verificar disponibilidade.')
      }
    }

    buscarDisponibilidade()
  }, [API_URL, data, esporteSelecionado, horario])

  // Busca de usuários cadastrados
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
        setUsuariosEncontrados(data || [])
      } catch (err) {
        console.error(err)
      }
    }

    const delay = setTimeout(buscar, 300)
    return () => clearTimeout(delay)
  }, [API_URL, buscaUsuario])

  const adicionarJogador = (usuario: Usuario) => {
    setJogadores((prev) =>
      prev.find((j) => String(j.id) === String(usuario.id)) ? prev : [...prev, usuario]
    )
    setBuscaUsuario('')
    setUsuariosEncontrados([])
  }

  const removerJogador = (id: number | string) => {
    setJogadores((prev) => prev.filter((j) => String(j.id) !== String(id)))
  }

  const agendar = async () => {
    setMensagem('')

    // precisa de quadra e OU pelo menos 1 jogador cadastrado OU um convidado dono
    if (!quadraSelecionada || (jogadores.length === 0 && ownerGuestNome.trim() === '')) {
      setMensagem('Selecione uma quadra e pelo menos um jogador, ou informe um convidado como dono.')
      return
    }

    // Dono inicial (temporário): se houver jogador cadastrado, usa o primeiro;
    // senão, o próprio admin logado (deixe sem usuarioId que o back usa o token)
    const usuarioIdTemp = jogadores[0]?.id

    // Monta payload do POST
    const payload: any = {
      data,
      horario,
      esporteId: String(esporteSelecionado),
      quadraId: String(quadraSelecionada),
      jogadoresIds: jogadores.map((j) => String(j.id)),
      // se for convidado dono, manda no convidadosNomes para o back CRIAR o usuário
      convidadosNomes: ownerGuestNome.trim() ? [ownerGuestNome.trim()] : undefined,
    }
    if (usuarioIdTemp) payload.usuarioId = String(usuarioIdTemp)

    try {
      // 1) cria o agendamento (convidado entra como jogador e tem um usuário criado)
      const { data: novo } = await axios.post(
        `${API_URL}/agendamentos`,
        payload,
        { withCredentials: true }
      )

      // 2) se tiver "convidado dono", transfere a titularidade para ele
      if (ownerGuestNome.trim()) {
        // tenta localizar o convidado recém-criado pelos jogadores retornados
        const convidado = Array.isArray(novo?.jogadores)
          ? novo.jogadores.find((j: any) =>
              String(j?.nome || '').trim().toLowerCase() === ownerGuestNome.trim().toLowerCase()
            )
          : null

        if (convidado?.id) {
          await axios.patch(
            `${API_URL}/agendamentos/${novo.id}/transferir`,
            {
              novoUsuarioId: String(convidado.id),
              // opcional: quem executou a transferência (se quiser: admin logado)
              // transferidoPorId: String(convidado.id),
            },
            { withCredentials: true }
          )
        }
      }

      setMensagem('✅ Agendamento realizado com sucesso!')
      setQuadraSelecionada('')
      setQuadrasDisponiveis([])
      setJogadores([])
      setOwnerGuestNome('')
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
          <option key={String(e.id)} value={String(e.id)}>
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

      {/* Dono convidado (opcional) */}
      <div className="mb-4">
        <label className="block mb-1 font-medium">Convidado dono (nome e telefone)</label>
        <input
          type="text"
          className="w-full p-2 border rounded"
          placeholder="Ex.: João 53 99127-8304"
          value={ownerGuestNome}
          onChange={(e) => setOwnerGuestNome(e.target.value)}
        />
      </div>

      {/* Busca e seleção de jogadores cadastrados */}
      <div className="mb-4">
        <label className="block mb-1 font-medium">Adicionar Jogadores (cadastrados)</label>
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
                key={String(u.id)}
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
                  key={String(j.id)}
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
            <p className="text-[11px] text-gray-500 mt-1">
              Obs.: se não informar “Convidado dono”, o primeiro jogador cadastrado será o dono inicial.
            </p>
          </div>
        )}
      </div>

      {quadrasDisponiveis.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-semibold">Quadras Disponíveis</h2>
          <div className="grid grid-cols-2 gap-2">
            {quadrasDisponiveis.map((q) => (
              <button
                key={String(q.quadraId)}
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
