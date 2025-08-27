'use client';

import { useEffect, useState, ChangeEvent, FormEvent } from "react";
import { useRouter, useParams } from "next/navigation";
import AppImage from "@/components/AppImage";

interface Esporte { id: string; nome: string; }
type TipoCamera = "COM_CAMERA" | "SEM_CAMERA";

interface Quadra {
  id?: string;
  nome: string;
  numero: number;
  tipoCamera: TipoCamera;
  imagem: string | null;   // backend já devolve URL pública (ou null)
  esportes: Esporte[];
}

export default function EditarQuadra() {
  const router = useRouter();
  const params = useParams();
  const quadraId = (Array.isArray(params?.id) ? params.id[0] : params?.id) as string;

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const [quadra, setQuadra] = useState<Quadra | null>(null);
  const [novaImagem, setNovaImagem] = useState<File | null>(null);
  const [esportes, setEsportes] = useState<Esporte[]>([]);
  const [esportesSelecionados, setEsportesSelecionados] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Quadra
        const resQuadra = await fetch(`${API_URL}/quadras/${quadraId}`, { credentials: "include" });
        if (resQuadra.status === 401) return router.push("/login");
        if (!resQuadra.ok) throw new Error("Falha ao carregar a quadra");
        const q: Quadra = await resQuadra.json();
        setQuadra(q);
        setEsportesSelecionados(q.esportes?.map((e) => e.id) || []);

        // Esportes
        const resEsportes = await fetch(`${API_URL}/esportes`, { credentials: "include" });
        if (resEsportes.status === 401) return router.push("/login");
        if (!resEsportes.ok) throw new Error("Falha ao carregar esportes");
        const lista: Esporte[] = await resEsportes.json();
        setEsportes(lista);
      } catch {
        alert("Erro ao carregar dados");
      } finally {
        setCarregando(false);
      }
    }
    if (quadraId) fetchData();
  }, [API_URL, quadraId, router]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setNovaImagem(e.target.files[0]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!quadra) return;

    if (esportesSelecionados.length === 0) {
      alert("Selecione ao menos um esporte.");
      return;
    }

    setLoading(true);
    try {
      // Envia tudo como multipart/form-data (o backend faz multer.single("imagem"))
      const formData = new FormData();
      formData.append("nome", quadra.nome);
      formData.append("numero", String(quadra.numero));
      formData.append("tipoCamera", quadra.tipoCamera);
      formData.append("esporteIds", JSON.stringify(esportesSelecionados));
      if (novaImagem) formData.append("imagem", novaImagem);

      const res = await fetch(`${API_URL}/quadras/${quadraId}`, {
        method: "PUT",
        body: formData,
        credentials: "include",
      });

      if (res.status === 401) return router.push("/login");
      if (!res.ok) {
        const erro = await res.json().catch(() => ({} as { erro?: string }));
        alert(`Erro: ${erro?.erro || "Falha ao atualizar quadra"}`);
        return;
      }

      alert("Quadra atualizada com sucesso!");
      router.push("/adminMaster/quadras");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro inesperado ao atualizar";
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  if (carregando || !quadra) return <p className="p-8">Carregando...</p>;

  return (
    <div className="p-8 max-w-lg mx-auto bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-6">Editar Quadra</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          value={quadra.nome}
          onChange={(e) => setQuadra({ ...quadra, nome: e.target.value })}
          required
          className="w-full border p-2 rounded"
          placeholder="Nome"
        />

        <input
          type="number"
          value={quadra.numero}
          onChange={(e) => setQuadra({ ...quadra, numero: Number(e.target.value) })}
          required
          className="w-full border p-2 rounded"
          placeholder="Número"
        />

        <select
          value={quadra.tipoCamera}
          onChange={(e) => setQuadra({ ...quadra, tipoCamera: e.target.value as TipoCamera })}
          className="w-full border p-2 rounded"
        >
          <option value="COM_CAMERA">Com Câmera</option>
          <option value="SEM_CAMERA">Sem Câmera</option>
        </select>

        <div>
          <label className="block mb-2 font-semibold">Esportes:</label>
          <div className="grid grid-cols-2 gap-3">
            {esportes.map((esporte) => (
              <label key={esporte.id} className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-100">
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

        <div className="flex items-center gap-3">
          <AppImage
            src={quadra.imagem || undefined}
            legacyDir="quadras"
            alt={quadra.nome}
            width={80}
            height={80}
            className="w-20 h-20 object-cover rounded"
            fallbackSrc="/quadra.png"
          />
          <span className="text-sm text-gray-500">Imagem atual</span>
        </div>

        <input type="file" accept="image/*" onChange={handleFileChange} />

        <button
          type="submit"
          disabled={loading}
          className={`bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {loading ? "Atualizando..." : "Atualizar Quadra"}
        </button>
      </form>
    </div>
  );
}
