"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";

type TipoCamera = "COM_CAMERA" | "SEM_CAMERA";

export default function FormularioCadastroQuadras() {
  const router = useRouter();

  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [imagem, setImagem] = useState<File | null>(null);
  const [esportes, setEsportes] = useState<{ id: string; nome: string }[]>([]);
  const [esportesSelecionados, setEsportesSelecionados] = useState<string[]>([]);
  const [tipoCamera, setTipoCamera] = useState<TipoCamera>("SEM_CAMERA");
  const [mensagem, setMensagem] = useState("");
  const [loading, setLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  useEffect(() => {
    const buscarEsportes = async () => {
      try {
        const res = await fetch(`${API_URL}/esportes`, { credentials: "include" });
        if (res.status === 401) return router.push("/login");
        if (!res.ok) throw new Error("Falha ao carregar esportes");
        const data = await res.json();
        setEsportes(data);
      } catch (error) {
        console.error("Erro ao buscar esportes:", error);
        setMensagem("Erro ao carregar esportes.");
      }
    };
    buscarEsportes();
  }, [API_URL, router]);

  // dentro do handleSubmit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    if (!nome || !numero || !imagem || esportesSelecionados.length === 0) {
      setMensagem("Preencha todos os campos.");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("nome", nome);
      formData.append("numero", numero);           // como string, o backend faz parseInt
      formData.append("tipoCamera", tipoCamera);
      formData.append("esporteIds", JSON.stringify(esportesSelecionados));
      formData.append("imagem", imagem);           // <- campo que o backend lê

      const res = await fetch(`${API_URL}/quadras`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = Array.isArray(data?.erro)
          ? data.erro.map((e: any) => e.message).join(", ")
          : data?.erro || "Erro ao cadastrar.";
        setMensagem(`Erro ao cadastrar: ${msg}`);
        return;
      }

      setMensagem("Quadra cadastrada com sucesso!");
      setNome("");
      setNumero("");
      setImagem(null);
      setEsportesSelecionados([]);
      setTipoCamera("SEM_CAMERA");
    } catch (err: any) {
      setMensagem(err?.message || "Erro ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto mt-8">
      <div>
        <label className="block mb-1 font-semibold">Nome da quadra:</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block mb-1 font-semibold">Número da quadra:</label>
        <input
          type="number"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block mb-1 font-semibold">Imagem:</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImagem(e.target.files?.[0] || null)}
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block mb-2 font-semibold">Esportes:</label>
        <div className="grid grid-cols-2 gap-3">
          {esportes.map((esporte) => (
            <label
              key={esporte.id}
              className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-100"
            >
              <input
                type="checkbox"
                value={esporte.id}
                checked={esportesSelecionados.includes(esporte.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setEsportesSelecionados((prev) => [...prev, esporte.id]);
                  } else {
                    setEsportesSelecionados((prev) => prev.filter((id) => id !== esporte.id));
                  }
                }}
                className="accent-green-600"
              />
              <span className="text-sm">{esporte.nome}</span>
            </label>
          ))}
        </div>
        {esportesSelecionados.length === 0 && (
          <p className="text-xs text-red-500 mt-1">Selecione ao menos um esporte</p>
        )}
      </div>

      <div>
        <label className="block mb-1 font-semibold">Câmera:</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              value="COM_CAMERA"
              checked={tipoCamera === "COM_CAMERA"}
              onChange={() => setTipoCamera("COM_CAMERA")}
            />
            Com câmera
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              value="SEM_CAMERA"
              checked={tipoCamera === "SEM_CAMERA"}
              onChange={() => setTipoCamera("SEM_CAMERA")}
            />
            Sem câmera
          </label>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className={`bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 ${loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
      >
        {loading ? "Cadastrando..." : "Cadastrar quadra"}
      </button>

      {mensagem && <p className="text-sm text-center text-gray-700">{mensagem}</p>}
    </form>
  );
}
