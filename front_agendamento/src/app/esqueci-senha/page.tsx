"use client";

import { useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";

export default function RecuperarSenha() {
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(false); // Estado de carregamento

  const router = useRouter();

  // Spinner igual do Cadastro.tsx
  const Spinner = () => (
    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );

  const handleEnviarEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    setMensagem("");

    try {
      await axios.post("http://localhost:3001/recuperacao/esqueci-senha", { email });
      setMensagem("Código enviado para seu e-mail.");
      setEtapa(2);
    } catch (error) {
      setMensagem("Erro ao enviar e-mail. Verifique o endereço.");
    } finally {
      setCarregando(false);
    }
  };

  const handleResetarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    if (novaSenha !== confirmarSenha) {
      setMensagem("As senhas não coincidem.");
      return;
    }

    setCarregando(true);

    try {
      await axios.post("http://localhost:3001/recuperacao/redefinir-senha-codigo", {
        email,
        codigo,
        novaSenha,
        confirmarSenha,
      });
      setMensagem("Senha redefinida com sucesso!");
      // Redireciona para login após 2 segundos
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (error: any) {
      if (error.response?.data?.message) {
        setMensagem(error.response.data.message);
      } else {
        setMensagem("Erro ao redefinir senha. Verifique os dados.");
      }
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/logoeleven.png" alt="Logo" className="h-50 mx-auto" />
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
              className="w-full px-4 py-2 rounded-md shadow-sm bg-gray-200  focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-orange-600 flex justify-center items-center gap-2 text-white font-semibold py-2 rounded-md shadow hover:bg-orange-700 transition"
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
              placeholder="Nova senha"
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
              disabled={carregando}
              className="w-full bg-orange-600 flex justify-center items-center gap-2 text-white font-semibold py-2 rounded-md shadow hover:bg-orange-700 transition"
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

        {mensagem && (
          <p className="text-center text-sm text-red-600 mt-4">{mensagem}</p>
        )}
      </div>
    </div>
  );
}
