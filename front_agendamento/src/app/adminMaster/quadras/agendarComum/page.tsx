'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import { Router } from 'lucide-react'

interface Esporte {
    id: number
    nome: string
}

interface Quadra {
    quadraId: number
    nome: string
    numero: number
}

interface Usuario {
    id: number
    nome: string
}

export default function AgendamentoComum() {
    const [data, setData] = useState('')
    const [esportes, setEsportes] = useState<Esporte[]>([])
    const [esporteSelecionado, setEsporteSelecionado] = useState('')
    const [horario, setHorario] = useState('')
    const [quadrasDisponiveis, setQuadrasDisponiveis] = useState<Quadra[]>([])
    const [quadraSelecionada, setQuadraSelecionada] = useState('')
    const [mensagem, setMensagem] = useState('')

    const [buscaUsuario, setBuscaUsuario] = useState('')
    const [usuariosEncontrados, setUsuariosEncontrados] = useState<Usuario[]>([])
    const [jogadores, setJogadores] = useState<Usuario[]>([])
    

    useEffect(() => {
        axios.get('http://localhost:3001/esportes', {
            withCredentials: true,
        })
            .then(res => setEsportes(res.data))
            .catch(err => console.error(err))
    }, [])

    useEffect(() => {
        const buscarDisponibilidade = async () => {
            if (!data || !esporteSelecionado || !horario) {
                setQuadrasDisponiveis([])
                return
            }

            try {
                const diaSemanaMap = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO']
                const dia = new Date(data).getDay()
                const diaSemana = diaSemanaMap[dia]

                const res = await axios.get('http://localhost:3001/disponibilidade', {
                    params: {
                        data,
                        horario,
                        esporteId: esporteSelecionado
                    },
                    withCredentials: true,
                })

                setQuadrasDisponiveis(res.data.filter((q: any) => q.disponivel))
                setMensagem(res.data.length === 0 ? 'Nenhuma quadra disponível.' : '')
            } catch (err) {
                console.error(err)
                setMensagem('Erro ao verificar disponibilidade.')
            }
        }

        buscarDisponibilidade()
    }, [data, esporteSelecionado, horario])

    // Busca de usuários
    useEffect(() => {
        const buscar = async () => {
            if (buscaUsuario.length < 2) {
                setUsuariosEncontrados([])
                return
            }

            try {
                const res = await axios.get('http://localhost:3001/clientes', {
                    params: { nome: buscaUsuario },
                    withCredentials: true,
                })
                setUsuariosEncontrados(res.data)
            } catch (err) {
                console.error(err)
            }
        }

        const delay = setTimeout(buscar, 300)
        return () => clearTimeout(delay)
    }, [buscaUsuario])


    const adicionarJogador = (usuario: Usuario) => {
        if (!jogadores.find(j => j.id === usuario.id)) {
            setJogadores([...jogadores, usuario])
        }
        setBuscaUsuario('')
        setUsuariosEncontrados([])
    }

    const removerJogador = (id: number) => {
        setJogadores(jogadores.filter(j => j.id !== id))
    }

    const agendar = async () => {
        if (!quadraSelecionada || jogadores.length === 0) {
            setMensagem('Selecione uma quadra e pelo menos um jogador.');
            return;
        }

        // Por exemplo, o usuário "dono" do agendamento será o primeiro jogador da lista (ou outro critério seu)
        const usuarioId = jogadores[0].id; // Ou algum outro valor, depende da regra

        try {
            await axios.post('http://localhost:3001/agendamentos', {
                data,
                horario,
                esporteId: esporteSelecionado,  // já é string? se for número, passe para string correta (ex: uuid)
                quadraId: quadraSelecionada,    // deve ser string UUID
                usuarioId,                      // obrigatório enviar
                jogadoresIds: jogadores.map(j => j.id),
            }, {
                withCredentials: true,
            });

            setMensagem('✅ Agendamento realizado com sucesso!');
            setQuadraSelecionada('');
            setQuadrasDisponiveis([]);
            setJogadores([]);
        } catch (error) {
            console.error(error);
            setMensagem('Erro ao realizar agendamento.');
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
                    <option key={e.id} value={e.id}>{e.nome}</option>
                ))}
            </select>

            <label className="block mb-2">Horário</label>
            <select
                className="w-full p-2 border rounded mb-4"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
            >
                <option value="">Selecione um horário</option>
                {['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'].map((h) => (
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
                            {jogadores.map(j => (
                                <li
                                    key={j.id}
                                    className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center gap-2"
                                >
                                    {j.nome}
                                    <button onClick={() => removerJogador(j.id)} className="ml-1 text-red-500">×</button>
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
                                className={`p-2 rounded border ${quadraSelecionada === String(q.quadraId)
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
