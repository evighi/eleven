"use client";

import axios from "axios";
import { useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

export default function FormularioCadastroEsportes() {
  const [nome, setNome] = useState("");
  const [imagem, setImagem] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | null) => {
    setImagem(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    if (!nome || !imagem) {
      setMensagem("Preencha todos os campos.");
      return;
    }

    const formData = new FormData();
    formData.append("nome", nome);
    formData.append("imagem", imagem);

    try {
      setEnviando(true);
      const { status, data } = await axios.post(
        `${API_URL}/esportes`,
        formData,
        {
          withCredentials: true,
          headers: { "Content-Type": "multipart/form-data" },
        }
      );

      if (status === 201 || status === 200) {
        // data.imagem agora é uma URL ABSOLUTA do R2
        setMensagem("Esporte cadastrado com sucesso!");
        setNome("");
        handleFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        setMensagem(data?.erro || "Erro ao cadastrar.");
      }
    } catch (err: any) {
      setMensagem(err?.response?.data?.erro || "Erro ao conectar com o servidor.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto mt-8">
      <div>
        <label className="block mb-1 font-semibold">Nome do esporte:</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block mb-1 font-semibold">Imagem:</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0] || null)}
          className="w-full border rounded px-3 py-2"
          required
        />
        {preview && (
          <div className="mt-2">
            <img
              src={preview}
              alt="Pré-visualização"
              className="max-h-40 rounded border"
            />
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={enviando}
        className={`bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 ${
          enviando ? "opacity-70 cursor-not-allowed" : ""
        }`}
      >
        {enviando ? "Enviando..." : "Cadastrar esporte"}
      </button>

      {mensagem && (
        <p className="text-sm text-center text-gray-700 mt-2">{mensagem}</p>
      )}
    </form>
  );
}
