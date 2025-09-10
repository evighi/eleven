"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { UsuarioLogadoItf } from "@/utils/types/UsuarioLogadoItf";

type Inputs = { email: string; senha: string };

export default function Login() {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
    setValue,
    getValues,
  } = useForm<Inputs>({ defaultValues: { email: "", senha: "" } });

  const { logaUsuario } = useAuthStore();
  const router = useRouter();

  // UI de verificação
  const [needsVerification, setNeedsVerification] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const last = typeof window !== "undefined" ? localStorage.getItem("lastEmail") : null;
    if (last) setValue("email", last);
  }, [setValue]);

  const API = process.env.NEXT_PUBLIC_URL_API;

  async function verificaLogin(data: Inputs) {
    try {
      const response = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: data.email, senha: data.senha, manter: true }),
      });

      const raw = await response.text();
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!response.ok) {
        // Trata cenários comuns
        if (response.status === 404) toast.error("E-mail não cadastrado.");
        else if (response.status === 401) toast.error("Senha incorreta.");
        else if (response.status === 403 && body?.code === "EMAIL_NAO_CONFIRMADO") {
          // 🚀 Backend já reenviou o código — mostramos tela de verificação
          setNeedsVerification(true);
          toast.message(body?.erro || "E-mail não confirmado. Enviamos um novo código.");
          // cooldown visual para evitar spam de reenvio
          setCooldown(30);
          const t = setInterval(() => {
            setCooldown((s) => {
              if (s <= 1) clearInterval(t);
              return s - 1;
            });
          }, 1000);
        } else {
          toast.error(body?.erro || "Não foi possível fazer login.");
        }
        return;
      }

      const dados: Omit<UsuarioLogadoItf, "token"> = body ?? {};
      logaUsuario({ ...dados, token: "" });

      try {
        localStorage.setItem("lastEmail", data.email);
      } catch {}

      // Redirect por perfil
      switch (dados.tipo) {
        case "CLIENTE":
          router.push("/");
          break;
        case "ADMIN_MASTER":
          router.push("/adminMaster");
          break;
        case "ADMIN_ATENDENTE":
          router.push("/admin/atendente");
          break;
        case "ADMIN_PROFESSORES":
          router.push("/admin/professor");
          break;
        default:
          router.push("/");
      }
    } catch {
      toast.error("Não foi possível fazer login. Verifique sua conexão.");
    }
  }

  async function confirmarCodigo() {
    const { email, senha } = getValues();
    if (!/^\d{6}$/.test(codigo)) {
      toast.error("Digite o código de 6 dígitos.");
      return;
    }
    try {
      setConfirmando(true);
      const resp = await fetch(`${API}/clientes/validar-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, codigo }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        toast.error(body?.erro || "Código inválido/expirado.");
        return;
      }
      toast.success("E-mail confirmado! Fazendo login...");
      setNeedsVerification(false);
      setCodigo("");
      // tenta login novamente automaticamente
      await verificaLogin({ email, senha });
    } catch {
      toast.error("Falha ao confirmar o código.");
    } finally {
      setConfirmando(false);
    }
  }

  async function reenviarCodigo() {
    const { email } = getValues();
    if (cooldown > 0) return;
    try {
      setReenviando(true);
      await fetch(`${API}/clientes/reenviar-codigo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      toast.message("Se existir conta, reenviamos o código. Verifique caixa de entrada/spam.");
      setCooldown(30);
      const t = setInterval(() => {
        setCooldown((s) => {
          if (s <= 1) clearInterval(t);
          return s - 1;
        });
      }, 1000);
    } catch {
      toast.error("Não foi possível reenviar o código agora.");
    } finally {
      setReenviando(false);
    }
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-sm p-6 rounded-md text-center">
        <div className="mb-6">
          <Image
            src="/logoelevenhor.png"
            alt="Eleven Sports"
            width={240}
            height={80}
            className="mx-auto"
            priority
          />
        </div>

        <form onSubmit={handleSubmit(verificaLogin)} className="space-y-4 text-left" autoComplete="on">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              E-mail
            </label>
            <input
              id="email"
              {...register("email")}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={isSubmitting}
              className="w-full px-4 py-2 rounded-md bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="Insira o seu e-mail"
              enterKeyHint="next"
            />
          </div>

          <div>
            <label htmlFor="senha" className="block text-sm font-medium text-gray-700">
              Senha
            </label>
            <input
              id="senha"
              {...register("senha")}
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              disabled={isSubmitting}
              className="w-full px-4 py-2 rounded-md bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="Insira a sua senha"
              enterKeyHint="done"
            />
          </div>

          <div className="text-sm text-gray-500">
            <p>
              Esqueceu a senha?{" "}
              <Link href="/esqueci-senha" className="font-medium text-orange-600 hover:underline">
                Aperte aqui
              </Link>
            </p>
            <p>
              Não tem cadastro?{" "}
              <Link href="/cadastro" className="font-medium text-orange-600 hover:underline">
                Aperte aqui
              </Link>
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white py-2 rounded-md font-semibold cursor-pointer transition duration-200 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>

        {/* 🔐 Bloco de VERIFICAÇÃO aparece quando backend retornou EMAIL_NAO_CONFIRMADO */}
        {needsVerification && (
          <div className="mt-6 p-4 border rounded bg-white text-left">
            <p className="text-sm text-gray-700 mb-3">
              Enviamos um novo código de verificação para o seu e-mail. Digite-o abaixo.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                placeholder="Código de 6 dígitos"
                className="flex-1 border rounded p-2"
              />
              <button
                onClick={confirmarCodigo}
                disabled={confirmando || codigo.length !== 6}
                className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {confirmando ? "Confirmando..." : "Confirmar"}
              </button>
            </div>

            <button
              onClick={reenviarCodigo}
              disabled={reenviando || cooldown > 0}
              className="mt-3 text-sm text-blue-600 hover:underline disabled:text-gray-400"
            >
              {reenviando ? "Reenviando..." : cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
