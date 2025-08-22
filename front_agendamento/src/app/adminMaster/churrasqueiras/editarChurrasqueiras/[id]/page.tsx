'use client';

import { useEffect, useState, ChangeEvent, FormEvent } from "react";
import { useRouter, useParams } from "next/navigation";

interface Churrasqueira {
  id: string;
  nome: string;
  imagem: string | null; // pode vir como nome de arquivo (legado) ou URL absoluta
  numero: number;
  observacao: string | null;
}

export default function EditarChurrasqueira() {
  const router = useRouter();
  const { id } = useParams();
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState<number>(0);
  const [observacao, setObservacao] = useState("");
  const [imagemAtual, setImagemAtual] = useState<string | null>(null);
  const [novaImagem, setNovaImagem] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const resolveImg = (v?: string | null) => {
    if (!v) return "/quadra.png";
    if (/^https?:\/\//i.test(v)) return v;
    return `${API_URL}/uploads/churrasqueiras/${v}`;
  };

  useEffect(() => {
    async function fetchChurrasqueira() {
      try {
        const res = await fetch(`${API_URL}/churrasqueiras/${id}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Erro ao buscar churrasqueira");

        const data: Churrasqueira = await res.json();
        setNome(data.nome);
        setNumero(data.numero);
        setObservacao(data.observacao ?? "");
        setImagemAtual(resolveImg(data.imagem));
      } catch (err) {
        console.error("Erro ao buscar churrasqueira:", err);
        alert("Falha ao carregar dados da churrasqueira");
      }
    }

    if (id) fetchChurrasqueira();
  }, [id, API_URL]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      setNovaImagem(e.target.files[0]);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      // Sem nova imagem → PUT JSON simples
      if (!novaImagem) {
        const resp = await fetch(`${API_URL}/churrasqueiras/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome,
            numero: Number(numero),
            observacao: observacao || null,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.erro || "Falha ao atualizar.");

        alert("Churrasqueira atualizada com sucesso!");
        router.push("/adminMaster/churrasqueiras/editarChurrasqueiras");
        return;
      }

      // Com nova imagem → tenta R2
      const safeName = novaImagem.name.replace(/\s+/g, "_");
      const filename = `${Date.now()}-${safeName}`;

      const signed = await fetch(`${API_URL}/uploads/signed-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename,
          contentType: novaImagem.type,
          dir: "churrasqueiras",
        }),
      });

      if (signed.ok) {
        const { uploadUrl, publicUrl } = await signed.json();

        // sobe a imagem pro R2
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": novaImagem.type },
          body: novaImagem,
        });
        if (!put.ok) {
          const t = await put.text();
          throw new Error(`Falha no upload (R2): ${t || put.status}`);
        }

        // atualiza dados + imagemUrl via JSON
        const resp = await fetch(`${API_URL}/churrasqueiras/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome,
            numero: Number(numero),
            observacao: observacao || null,
            imagemUrl: publicUrl,
          }),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.erro || "Falha ao atualizar.");

        alert("Churrasqueira atualizada com sucesso!");
        router.push("/adminMaster/churrasqueiras/editarChurrasqueiras");
        return;
      }

      // Fallback legado (multer)
      const formData = new FormData();
      formData.append("nome", nome);
      formData.append("numero", String(numero));
      formData.append("observacao", observacao);
      formData.append("imagem", novaImagem);

      const legacy = await fetch(`${API_URL}/churrasqueiras/${id}`, {
        method: "PUT",
        body: formData,
        credentials: "include",
      });

      const data = await legacy.json().catch(() => ({}));
      if (!legacy.ok) {
        throw new Error(data?.erro || "Falha ao atualizar (legado).");
      }

      alert("Churrasqueira atualizada com sucesso!");
      router.push("/adminMaster/churrasqueiras/editarChurrasqueiras");
    } catch (error: any) {
      alert(error?.message || "Erro ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-lg mx-auto bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-6">Editar Churrasqueira</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {imagemAtual && (
          <div className="flex justify-center">
            <img
              src={imagemAtual}
              alt={nome || "Churrasqueira"}
              className="w-40 h-40 object-cover rounded mb-2"
              onError={(ev) => ((ev.currentTarget as HTMLImageElement).src = "/quadra.png")}
            />
          </div>
        )}

        <div>
          <label htmlFor="nome" className="block font-medium mb-1">Nome</label>
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
          <label htmlFor="numero" className="block font-medium mb-1">Número</label>
          <input
            id="numero"
            type="number"
            value={numero}
            onChange={(e) => setNumero(Number(e.target.value))}
            required
            className="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label htmlFor="observacao" className="block font-medium mb-1">Observação</label>
          <textarea
            id="observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            className="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label htmlFor="imagem" className="block font-medium mb-1">Nova Imagem (opcional)</label>
          <input type="file" id="imagem" accept="image/*" onChange={handleFileChange} />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition ${
            loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </form>
    </div>
  );
}
