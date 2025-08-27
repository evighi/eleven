"use client";
import { useState } from "react";

export default function FormularioCadastroChurrasqueira() {
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [observacao, setObservacao] = useState("");
  const [imagem, setImagem] = useState<File | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    if (!nome || !numero || !imagem) {
      setMensagem("Preencha os campos obrigatórios.");
      return;
    }

    // (opcional) validações simples de arquivo
    if (imagem.size > 5 * 1024 * 1024) {
      setMensagem("Imagem muito grande (máx. 5MB).");
      return;
    }
    if (!/^image\//.test(imagem.type)) {
      setMensagem("Arquivo inválido. Selecione uma imagem.");
      return;
    }

    setEnviando(true);
    try {
      // ====== TENTA FLUXO R2 (URL assinada) ======
      const safeName = imagem.name.replace(/\s+/g, "_");
      const filename = `${Date.now()}-${safeName}`;
      const signed = await fetch(`${API_URL}/uploads/signed-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename,
          contentType: imagem.type,
          dir: "churrasqueiras",
        }),
      });

      if (signed.ok) {
        const { uploadUrl, publicUrl } = await signed.json();

        // sobe o arquivo direto pro R2
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": imagem.type },
          body: imagem,
        });
        if (!put.ok) {
          const t = await put.text();
          throw new Error(`Falha no upload (R2): ${t || put.status}`);
        }

        // cria churrasqueira mandando JSON (backend deve aceitar `imagemUrl`)
        const resp = await fetch(`${API_URL}/churrasqueiras`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome,
            numero: Number(numero),
            observacao: observacao || undefined,
            imagemUrl: publicUrl,
          }),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error((data as { erro?: string })?.erro || "Erro ao criar churrasqueira (R2).");
        }

        setMensagem("Churrasqueira cadastrada com sucesso!");
        setNome("");
        setNumero("");
        setObservacao("");
        setImagem(null);
        return;
      }

      // ====== FALLBACK LEGADO (multer local) ======
      const formData = new FormData();
      formData.append("nome", nome);
      formData.append("numero", numero);
      formData.append("observacao", observacao);
      formData.append("imagem", imagem);

      const legacy = await fetch(`${API_URL}/churrasqueiras`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await legacy.json().catch(() => ({}));
      if (!legacy.ok) {
        throw new Error((data as { erro?: string })?.erro || "Erro ao cadastrar (legado).");
      }

      setMensagem("Churrasqueira cadastrada com sucesso!");
      setNome("");
      setNumero("");
      setObservacao("");
      setImagem(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao conectar com o servidor.";
      setMensagem(msg);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto mt-8">
      <div>
        <label className="block mb-1 font-semibold">Nome:</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block mb-1 font-semibold">Número da churrasqueira:</label>
        <input
          type="number"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block mb-1 font-semibold">Observação (opcional):</label>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          className="w-full border rounded px-3 py-2 resize-none"
          rows={3}
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

      <button
        type="submit"
        disabled={enviando}
        className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 w-full disabled:opacity-60"
      >
        {enviando ? "Cadastrando..." : "Cadastrar churrasqueira"}
      </button>

      {mensagem && <p className="text-sm text-center text-gray-700">{mensagem}</p>}
    </form>
  );
}
