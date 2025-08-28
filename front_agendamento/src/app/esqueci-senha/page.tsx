"use client";

import { useState } from "react";
import axios from "axios";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";

type MsgTipo = "ok" | "erro";

export default function RecuperarSenha() {
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");

  const [mensagem, setMensagem] = useState("");
  const [msgTipo, setMsgTipo] = useState<MsgTipo>("ok");
  const [carregando, setCarregando] = useState(false);

  const router = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const setMsg = (texto: string, tipo: MsgTipo = "ok") => {
    setMensagem(texto);
    setMsgTipo(tipo);
  };

  const handleEnviarEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    setMsg("");

    try {
      const { data } = await axios.post(
        `${API_URL}/recuperacao/esqueci-senha`,
        { email: email.trim() },
        { withCredentials: true }
      );

      // Mostra a mensagem vinda do back (ex.: “Se o e-mail existir, enviamos o código…” ou “Código enviado…”)
      setMsg((data?.message as string) || "Código enviado para seu e-mail.");
      setEtapa(2);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.message) {
        setMsg(String(err.response.data.message), "erro");
      } else {
        setMsg("Erro ao enviar e-mail. Tente novamente.", "erro");
      }
    } finally {
      setCarregando(false);
    }
  };

  const handleResetarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (novaSenha !== confirmarSenha) {
      setMsg("As senhas não coincidem.", "erro");
      return;
    }

    setCarregando(true);

    try {
      const { data } = await axios.post(
        `${API_URL}/recuperacao/redefinir-senha-codigo`,
        {
          email: email.trim(),
          codigo: codigo.trim(),
          novaSenha,
          confirmarSenha,
        },
        { withCredentials: true }
      );

      setMsg((data?.message as string) || "Senha redefinida com sucesso!");
      // pequeno delay pra usuário ler a mensagem
      setTimeout(() => router.push("/login"), 1800);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.message) {
        setMsg(String(err.response.data.message), "erro");
      } else {
        setMsg("Erro ao redefinir senha. Verifique os dados e tente novamente.", "erro");
      }
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <Image
            src="/logoelevenhor.png"
            alt="Logo"
            width={160}
            height={160}
            priority
            className="mx-auto h-40 w-auto"
          />
          <h2 className="text-2xl font-bold text-orange-600 mt-2">Recuperar senha</h2>
        </div>

        {etapa === 1 && (
          <form onSubmit={handleEnviarEmail} className="space-y-4">
            <p className="text-center text-sm text-gray-600">
              Insira o seu e-mail para enviarmos um código de verificação.
            </p>
            <input
              type="email"
              placeholder="Insira o e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 rounded-md shadow-sm bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              type="submit"
              disabled={carregando || !email.trim()}
              className="w-full bg-orange-600 flex justify-center items-center gap-2 text-white font-semibold py-2 rounded-md shadow hover:bg-orange-700 transition disabled:opacity-70"
            >
              {carregando ? (
                <>
                  <Spinner /> Enviando...
                </>
              ) : (
                "Enviar código"
              )}
            </button>
          </form>
        )}

        {etapa === 2 && (
          <form onSubmit={handleResetarSenha} className="space-y-4">
            <p className="text-center text-sm text-gray-600">
              Insira o código enviado no e-mail, a nova senha e confirme.
            </p>
            <input
              type="text"
              placeholder="Código de verificação"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              className="w-full px-4 py-2 rounded-md bg-gray-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="password"
              placeholder="Nova senha (mín. 8 caracteres)"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              required
              className="w-full px-4 py-2 rounded-md shadow-sm bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="password"
              placeholder="Confirmar nova senha"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              required
              className="w-full px-4 py-2 rounded-md shadow-sm bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              type="submit"
              disabled={carregando || !codigo.trim() || !novaSenha || !confirmarSenha}
              className="w-full bg-orange-600 flex justify-center items-center gap-2 text-white font-semibold py-2 rounded-md shadow hover:bg-orange-700 transition disabled:opacity-70"
            >
              {carregando ? (
                <>
                  <Spinner /> Redefinindo...
                </>
              ) : (
                "Avançar"
              )}
            </button>
          </form>
        )}

        {!!mensagem && (
          <p
            className={`text-center text-sm mt-4 ${
              msgTipo === "ok" ? "text-emerald-700" : "text-red-600"
            }`}
          >
            {mensagem}
          </p>
        )}
      </div>
    </div>
  );
}
