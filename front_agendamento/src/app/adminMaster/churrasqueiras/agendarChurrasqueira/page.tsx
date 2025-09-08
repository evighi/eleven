'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import AppImage from "@/components/AppImage";

interface Churrasqueira {
  churrasqueiraId: string
  nome: string
  numero: number
  imagem?: string | null
  imagemUrl?: string | null
  logoUrl?: string | null
  disponivel?: boolean
}

interface Usuario {
  id: string
  nome: string
}

export default function AgendamentoChurrasqueiraComum() {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [data, setData] = useState<string>("")
  const [turno, setTurno] = useState<string>("")
  const [churrasqueirasDisponiveis, setChurrasqueirasDisponiveis] = useState<Churrasqueira[]>([])
  const [churrasqueiraSelecionada, setChurrasqueiraSelecionada] = useState<string>("")
  const [mensagem, setMensagem] = useState<string>("")
  const [carregandoDisp, setCarregandoDisp] = useState<boolean>(false)

  // Busca de usuário (id + nome) via /usuarios/buscar
  const [buscaUsuario, setBuscaUsuario] = useState<string>("")
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<Usuario[]>([])
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<Usuario | null>(null)
  const [buscandoUsuarios, setBuscandoUsuarios] = useState<boolean>(false)

  const toImgUrl = (c: Churrasqueira) => {
    const v = c.imagemUrl ?? c.logoUrl ?? c.imagem ?? ''
    if (!v) return '/churrasqueira.png'
    if (/^https?:\/\//i.test(v)) return v
    if (v.startsWith('/uploads/')) return `${API_URL}${v}`
    return `${API_URL}/uploads/churrasqueiras/${v}`
  }

  // Disponibilidade por data + turno
  useEffect(() => {
    const buscar = async () => {
      if (!data || !turno) {
        setChurrasqueirasDisponiveis([])
        setMensagem('')
        return
      }
      setCarregandoDisp(true)
      try {
        const res = await axios.get(`${API_URL}/disponibilidadeChurrasqueiras`, {
          params: { data, turno },
          withCredentials: true,
        })
        const lista: Churrasqueira[] = Array.isArray(res.data) ? res.data : []
        const disponiveis = lista.filter((c) => c.disponivel !== false)
        setChurrasqueirasDisponiveis(disponiveis)
        setMensagem(disponiveis.length === 0 ? 'Nenhuma churrasqueira disponível.' : '')
      } catch (err) {
        console.error(err)
        setMensagem('Erro ao verificar disponibilidade.')
        setChurrasqueirasDisponiveis([])
      } finally {
        setCarregandoDisp(false)
      }
    }
    buscar()
  }, [data, turno, API_URL])

  // Busca usuários (id+nome) — debounce + AbortController (axios)
  useEffect(() => {
    const q = buscaUsuario.trim();

    if (q.length < 2) {
      setUsuariosEncontrados([]);
      setBuscandoUsuarios(false); // evita spinner preso
      return;
    }

    const ctrl = new AbortController();
    setBuscandoUsuarios(true);

    const t = setTimeout(async () => {
      try {
        const { data: lista } = await axios.get<Usuario[]>(
          `${API_URL}/clientes`,
          { params: { nome: q }, withCredentials: true, signal: ctrl.signal as any }
        );
        setUsuariosEncontrados(Array.isArray(lista) ? lista : []);
      } catch (err: any) {
        // ignorar cancelamentos
        if (err?.name !== "CanceledError" && err?.code !== "ERR_CANCELED") {
          console.error("Falha ao buscar usuários:", err);
        }
        setUsuariosEncontrados([]);
      } finally {
        setBuscandoUsuarios(false);
      }
    }, 300);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [buscaUsuario, API_URL]);

  const agendar = async () => {
    if (!data || !turno || !churrasqueiraSelecionada || !usuarioSelecionado) {
      setMensagem('Selecione data, turno, uma churrasqueira e um usuário.')
      return
    }
    try {
      await axios.post(`${API_URL}/agendamentosChurrasqueiras`, {
        data,
        turno,
        churrasqueiraId: churrasqueiraSelecionada,
        usuarioId: usuarioSelecionado.id,
      }, { withCredentials: true })
      setMensagem('✅ Agendamento realizado com sucesso!')
      setChurrasqueiraSelecionada('')
      setUsuarioSelecionado(null)
    } catch (err) {
      console.error(err)
      setMensagem('Erro ao realizar agendamento.')
    }
  }

  // min da data = hoje
  const hoje = new Date()
  const minDate = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white shadow rounded-xl">
      <h1 className="text-2xl font-bold mb-4">Agendar Churrasqueira (Comum)</h1>

      <label className="block mb-2">Data</label>
      <input
        type="date"
        className="w-full p-2 border rounded mb-4"
        value={data}
        min={minDate}
        onChange={(e) => setData(e.target.value)}
      />

      <label className="block mb-2">Turno</label>
      <select
        className="w-full p-2 border rounded mb-4"
        value={turno}
        onChange={(e) => setTurno(e.target.value)}
      >
        <option value="">Selecione o turno</option>
        <option value="DIA">Dia</option>
        <option value="NOITE">Noite</option>
      </select>

      {/* Busca de usuário */}
      <label className="block mb-1 font-medium">Selecionar Usuário</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        placeholder="Buscar por nome"
        value={buscaUsuario}
        onChange={(e) => setBuscaUsuario(e.target.value)}
      />
      {buscandoUsuarios && (
        <div className="text-xs text-gray-500 mb-1">Buscando…</div>
      )}
      {usuariosEncontrados.length > 0 && (
        <ul className="border rounded mb-2 max-h-40 overflow-y-auto">
          {usuariosEncontrados.map((u) => (
            <li
              key={u.id}
              className="p-2 hover:bg-gray-100 cursor-pointer"
              onClick={() => { setUsuarioSelecionado(u); setBuscaUsuario(''); setUsuariosEncontrados([]) }}
            >
              {u.nome}
            </li>
          ))}
        </ul>
      )}

      {usuarioSelecionado && (
        <p className="mb-4">👤 Usuário selecionado: <strong>{usuarioSelecionado.nome}</strong></p>
      )}

      {/* Lista de churrasqueiras */}
      {carregandoDisp && (
        <p className="text-sm text-gray-500 mb-2">Carregando disponibilidade…</p>
      )}
      {churrasqueirasDisponiveis.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-semibold">Churrasqueiras Disponíveis</h2>

          <div className="grid grid-cols-2 gap-3">
            {churrasqueirasDisponiveis.map((c) => {
              const img = toImgUrl(c)
              const isActive = churrasqueiraSelecionada === String(c.churrasqueiraId)
              return (
                <button
                  key={c.churrasqueiraId}
                  type="button"
                  className={`p-2 rounded border text-left bg-gray-50 hover:bg-gray-100 transition ${isActive ? 'ring-2 ring-green-600 bg-green-50' : ''}`}
                  onClick={() => setChurrasqueiraSelecionada(String(c.churrasqueiraId))}
                >
                  <div className="relative w-full aspect-[4/3] rounded overflow-hidden bg-white border mb-2">
                    <AppImage
                      src={img}
                      alt={c.nome}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      fallbackSrc="/churrasqueira.png"
                      priority={false}
                    />
                  </div>
                  <div className="text-sm">
                    <p className="font-semibold">{c.nome}</p>
                    <p className="text-gray-600">Nº {c.numero}</p>
                  </div>
                </button>
              )
            })}
          </div>

          <button
            className="mt-4 bg-orange-600 text-white px-4 py-2 rounded disabled:opacity-60"
            onClick={agendar}
            disabled={!data || !turno || !churrasqueiraSelecionada || !usuarioSelecionado}
          >
            Confirmar Agendamento
          </button>
        </div>
      )}

      {mensagem && <p className="mt-4 text-center text-sm text-gray-700">{mensagem}</p>}
    </div>
  )
}
