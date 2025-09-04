"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { UsuarioLogadoItf } from "@/utils/types/UsuarioLogadoItf";

type Inputs = {
  email: string;
  senha: string;
  manter: boolean;
};

export default function Login() {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
    setValue,
    watch,
  } = useForm<Inputs>({ defaultValues: { email: "", senha: "", manter: true } });

  const { logaUsuario } = useAuthStore();
  const router = useRouter();

  // Prefill opcional do último e-mail usado
  useEffect(() => {
    const last = typeof window !== "undefined" ? localStorage.getItem("lastEmail") : null;
    if (last) setValue("email", last);
  }, [setValue]);

  async function verificaLogin(data: Inputs) {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // necessário p/ cookie httpOnly
        body: JSON.stringify({
          email: data.email,
          senha: data.senha,
          // manter: data.manter  // você usará isso quando implementar refresh token
        }),
      });

      // Lemos o corpo uma única vez (pode ser JSON ou texto)
      const raw = await response.text();
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* ignore */
      }
      const serverMsg: string | undefined = body?.erro || body?.message;

      if (!response.ok) {
        // Mapeia erros específicos
        switch (response.status) {
          case 404:
            toast.error("E-mail não cadastrado.");
            break;
          case 401:
            toast.error("Senha incorreta.");
            break;
          case 403:
            toast.error(serverMsg || "E-mail não confirmado. Verifique seu e-mail.");
            break;
          case 429:
            toast.error(serverMsg || "Muitas tentativas. Tente novamente em alguns minutos.");
            break;
          default:
            toast.error(serverMsg || "Não foi possível fazer login. Tente novamente.");
        }
        return;
      }

      // Sucesso
      const dados: Omit<UsuarioLogadoItf, "token"> = body ?? {};
      logaUsuario({ ...dados, token: "" });

      // Lembra e-mail (opcional) — nunca armazene senha em localStorage
      try {
        if (watch("manter")) {
          localStorage.setItem("lastEmail", data.email);
        } else {
          localStorage.removeItem("lastEmail");
        }
      } catch {
        /* ignore */
      }

      // Tentativa progressiva de salvar credencial (Chrome/Android)
      try {
        // @ts-ignore - tipos do Credential Management API podem não existir
        if ("credentials" in navigator && "PasswordCredential" in window && watch("manter")) {
          // @ts-ignore
          const cred = new window.PasswordCredential({
            id: data.email,
            password: data.senha,
            name: dados?.nome ?? data.email,
          });
          // @ts-ignore
          await navigator.credentials.store(cred);
        }
      } catch {
        /* se não suportar, tudo bem */
      }

      // Redireciona por tipo
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

  return (
    <main className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-sm p-6 rounded-md text-center">
        {/* Logo */}
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

        {/* Formulário com autofill habilitado */}
        <form
          onSubmit={handleSubmit(verificaLogin)}
          className="space-y-4 text-left"
          autoComplete="on"
        >
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

          {/* Manter conectado (por enquanto front-only) */}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              {...register("manter")}
              className="h-4 w-4"
              disabled={isSubmitting}
            />
            Manter conectado neste dispositivo
          </label>

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
      </div>
    </main>
  );
}
