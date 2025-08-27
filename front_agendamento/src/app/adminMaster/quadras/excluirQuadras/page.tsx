'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppImage from "@/components/AppImage";

interface Esporte { nome: string; }

interface Quadra {
  id: string;
  nome: string;
  tipoCamera: "COM_CAMERA" | "SEM_CAMERA" | string;
  imagem?: string | null;              // pode ser URL (R2) ou nome de arquivo legado
  esportes: Esporte[];
}

export default function ExcluirQuadras() {
  const router = useRouter();

  const [quadras, setQuadras] = useState<Quadra[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmarId, setConfirmarId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string>("");

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const resolveImg = (img?: string | null) => {
    if (!img) return "/quadra.png";
    if (/^https?:\/\//i.test(img)) return img;           // nova URL absoluta (R2)
    return `${API_URL}/uploads/quadras/${img}`;          // legado
  };

  const prettyTipo = (t?: string) =>
    t === "COM_CAMERA" ? "Com câmera" :
    t === "SEM_CAMERA" ? "Sem câmera" :
    (t ? String(t).replace("_", " ") : "Tipo não informado");

  useEffect(() => {
    const carregar = async () => {
      try {
        const res = await fetch(`${API_URL}/quadras`, { credentials: "include" });
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) throw new Error("Falha ao carregar quadras");
        const data = await res.json();
        setQuadras(data);
      } catch {
        setErro("Erro ao carregar quadras");
      } finally {
        setCarregando(false);
      }
    };
    carregar();
  }, [API_URL, router]);

  const handleExcluir = async (id: string) => {
    setLoadingId(id);
    try {
      const res = await fetch(`${API_URL}/quadras/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      let dataJson: unknown = null;
      try { dataJson = await res.json(); } catch {}

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const errMsg = (dataJson as { erro?: string } | null)?.erro;
        alert(`Erro: ${errMsg || "Não foi possível excluir a quadra."}`);
      } else {
        setQuadras((prev) => prev.filter((q) => q.id !== id));
      }
    } catch {
      alert("Erro ao excluir a quadra.");
    } finally {
      setLoadingId(null);
      setConfirmarId(null);
    }
  };

  if (carregando) return <div className="p-8">Carregando...</div>;
  if (erro) return <div className="p-8 text-red-600">{erro}</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Excluir Quadra</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {quadras.map((quadra) => (
          <div
            key={quadra.id}
            className="border rounded-xl p-4 shadow hover:shadow-lg transition bg-white flex flex-col items-center relative"
          >
            <span className="text-lg font-semibold mb-1">{quadra.nome}</span>

            <div className="relative w-full h-40 rounded mb-2 overflow-hidden">
              <AppImage
                src={resolveImg(quadra.imagem)}
                alt={`Imagem da quadra ${quadra.nome}`}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            </div>

            <span className="text-sm text-gray-500 mb-2">{prettyTipo(quadra.tipoCamera)}</span>

            <span className="text-sm text-gray-700 mb-4 text-center">
              Esportes: {quadra.esportes.map((e) => e.nome).join(", ")}
            </span>

            <button
              onClick={() => setConfirmarId(quadra.id)}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
            >
              Excluir
            </button>

            {confirmarId === quadra.id && (
              <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center p-4 rounded-xl border shadow-lg z-10">
                <p className="text-center mb-4">Tem certeza que deseja excluir?</p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleExcluir(quadra.id)}
                    disabled={loadingId === quadra.id}
                    className="bg-red-600 text-white px-4 py-1 rounded hover:bg-red-700 transition"
                  >
                    {loadingId === quadra.id ? "Excluindo..." : "Sim"}
                  </button>
                  <button
                    onClick={() => setConfirmarId(null)}
                    className="bg-gray-300 text-black px-4 py-1 rounded hover:bg-gray-400 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {quadras.length === 0 && (
        <p className="text-center text-gray-600 mt-6">Nenhuma quadra encontrada.</p>
      )}
    </div>
  );
}
