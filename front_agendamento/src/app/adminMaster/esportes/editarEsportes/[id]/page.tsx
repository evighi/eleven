"use client";

import { useEffect, useMemo, useState, ChangeEvent, FormEvent } from "react";
import { useRouter, useParams } from "next/navigation";
import AppImage from "@/components/AppImage";

interface Esporte {
  id: string;
  nome: string;
  imagem: string | null; // URL absoluta (ou null)
}

export default function EditarEsporte() {
  const router = useRouter();
  const { id } = useParams();

  const [nome, setNome] = useState("");
  const [imagemAtual, setImagemAtual] = useState<string | null>(null);
  const [novaImagem, setNovaImagem] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  useEffect(() => {
    async function fetchEsporte() {
      try {
        const res = await fetch(`${API_URL}/esportes/${id}`, { credentials: "include" });
        if (!res.ok) throw new Error("Erro ao carregar esporte");
        const data: Esporte = await res.json();
        setNome(data.nome);
        setImagemAtual(data.imagem ?? null); // já é URL R2
      } catch {
        alert("Falha ao carregar dados do esporte");
      }
    }
    if (id) fetchEsporte();
  }, [id, API_URL]);

  const preview = useMemo(
    () => (novaImagem ? URL.createObjectURL(novaImagem) : null),
    [novaImagem]
  );

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      setNovaImagem(e.target.files[0]);
    } else {
      setNovaImagem(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("nome", nome);
      if (novaImagem) formData.append("imagem", novaImagem);

      const res = await fetch(`${API_URL}/esportes/${id}`, {
        method: "PUT",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Erro: ${data.erro || "Falha ao atualizar"}`);
        setLoading(false);
        return;
      }

      alert("Esporte atualizado com sucesso!");
      router.push("/adminMaster/esportes/editarEsportes");
    } catch {
      alert("Erro inesperado ao atualizar esporte");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-lg mx-auto bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-6">Editar Esporte</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="nome" className="block font-medium mb-1">
            Nome do Esporte
          </label>
          <input
            id="nome"
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            className="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label className="block font-medium mb-1">Imagem atual</label>
          <AppImage
            src={imagemAtual || "/esporte.png"}
            alt="Imagem atual"
            width={128}
            height={128}
            className="w-32 h-32 object-cover rounded border"
            fallbackSrc="/esporte.png"
          />
        </div>

        <div>
          <label htmlFor="imagem" className="block font-medium mb-1">
            Nova Imagem (opcional)
          </label>
          <input type="file" id="imagem" accept="image/*" onChange={handleFileChange} />
          {preview && (
            <div className="mt-2">
              <span className="text-sm text-gray-600">Pré-visualização:</span>
              <AppImage
                src={preview}
                alt="Prévia"
                width={128}
                height={128}
                className="w-32 h-32 object-cover rounded border mt-1"
                // AppImage já lida com blob:/data: e faz bypass de otimização
              />
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition ${
            loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {loading ? "Atualizando..." : "Atualizar Esporte"}
        </button>
      </form>
    </div>
  );
}
