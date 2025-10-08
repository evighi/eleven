"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
import { UsuarioLogadoItf } from "@/utils/types/UsuarioLogadoItf";
import Spinner from "@/components/Spinner";

type Inputs = {
  email: string;
  senha: string;
};

type Passo = "login" | "codigo";

const OTP_LEN = 6;

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

  // Fluxo de verificação
  const [passo, setPasso] = useState<Passo>("login");
  const [emailParaVerificar, setEmailParaVerificar] = useState<string>("");
  const [carregando, setCarregando] = useState(false);
  const [codigo, setCodigo] = useState<string[]>(Array(OTP_LEN).fill(""));
  const [ultimaTentativa, setUltimaTentativa] = useState<Inputs | null>(null);

  // classe base dos inputs de código (estilo OTP)
  const inputCode =
    "w-12 h-12 text-center text-xl font-semibold tracking-widest rounded-md bg-gray-200 " +
    "focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60";

  // Prefill opcional do último e-mail usado
  useEffect(() => {
    const last = typeof window !== "undefined" ? localStorage.getItem("lastEmail") : null;
    if (last) setValue("email", last);
  }, [setValue]);

  // ========= Helpers OTP =========
  const focusInput = (idx: number) => {
    const el = document.getElementById(`codigo-${idx}`) as HTMLInputElement | null;
    if (el) el.focus();
  };

  const handleCodeChange = (index: number, raw: string) => {
    // aceita apenas dígito
    const v = raw.replace(/\D/g, "").slice(0, 1);
    const novo = [...codigo];
    novo[index] = v;
    setCodigo(novo);
    if (v && index < OTP_LEN - 1) focusInput(index + 1);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (codigo[index]) {
        const novo = [...codigo];
        novo[index] = "";
        setCodigo(novo);
        return;
      }
      if (index > 0) focusInput(index - 1);
    }
    if (e.key === "ArrowLeft" && index > 0) focusInput(index - 1);
    if (e.key === "ArrowRight" && index < OTP_LEN - 1) focusInput(index + 1);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const clip = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LEN);
    if (!clip) return;
    const arr = Array(OTP_LEN)
      .fill("")
      .map((_, i) => clip[i] ?? "");
    setCodigo(arr);
    // foca no próximo vazio ou no último
    const next = Math.min(OTP_LEN - 1, clip.length);
    focusInput(next);
  };

  const codigoStr = () => codigo.join("");

  // ========= Login =========
  async function verificaLogin(data: Inputs) {
    try {
      setUltimaTentativa(data); // guarda para re-login após verificação
      const response = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // necessário p/ cookie httpOnly
        body: JSON.stringify({
          email: data.email,
          senha: data.senha,
          manter: true,
        }),
      });

      const raw = await response.text();
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* ignore */
      }
      const serverMsg: string | undefined = body?.erro || body?.message;

      if (!response.ok) {
        switch (response.status) {
          case 404:
            toast.error("E-mail não cadastrado.");
            break;
          case 401:
            toast.error("Senha incorreta.");
            break;
          case 403: {
            // e-mail não confirmado — backend já reenviou o código (segundo seu fluxo)
            setEmailParaVerificar(data.email);
            setCodigo(Array(OTP_LEN).fill(""));
            setPasso("codigo");
            toast.message(serverMsg || "E-mail não confirmado. Enviamos um novo código.");
            // foca no primeiro campo
            setTimeout(() => focusInput(0), 50);
            break;
          }
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

      // Sempre lembrar o e-mail (não armazene senha)
      try {
        localStorage.setItem("lastEmail", data.email);
      } catch {
        /* ignore */
      }

      // Tenta salvar credencial (se suportado pelo browser)
      try {
        // @ts-ignore
        if ("credentials" in navigator && "PasswordCredential" in window) {
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
        /* ok */
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
          router.push("/");
          break;
        default:
          router.push("/");
      }
    } catch {
      toast.error("Não foi possível fazer login. Verifique sua conexão.");
    }
  }

  // ========= Verificar E-mail (OTP) =========
  async function verificarEmail(e: React.FormEvent) {
    e.preventDefault();
    const cod = codigoStr();
    if (cod.length !== OTP_LEN) {
      toast.error(`Digite os ${OTP_LEN} dígitos do código.`);
      return;
    }
    setCarregando(true);
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/clientes/validar-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: emailParaVerificar, codigo: cod }),
      });
      const raw = await resp.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        /* ignore */
      }
      if (!resp.ok) {
        toast.error(data?.erro || "Código inválido. Tente novamente.");
        return;
      }
      toast.success("E-mail verificado com sucesso! Entrando…");

      // se temos a última tentativa (email/senha), tenta logar diretamente
      if (ultimaTentativa) {
        await verificaLogin(ultimaTentativa);
      } else {
        // volta para o formulário de login com o e-mail preenchido
        setPasso("login");
        setValue("email", emailParaVerificar);
      }
    } catch {
      toast.error("Não foi possível verificar o e-mail.");
    } finally {
      setCarregando(false);
    }
  }

  // Reenviar código manualmente
  async function reenviarCodigo() {
    if (!emailParaVerificar) return;
    setCarregando(true);
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/clientes/reenviar-codigo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: emailParaVerificar }),
      });
      const raw = await resp.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        /* ignore */
      }
      if (!resp.ok) {
        toast.error(data?.erro || "Não foi possível reenviar o código.");
        return;
      }
      toast.success("Código reenviado. Confira seu e-mail.");
      setCodigo(Array(OTP_LEN).fill(""));
      setTimeout(() => focusInput(0), 50);
    } catch {
      toast.error("Falha ao reenviar código.");
    } finally {
      setCarregando(false);
    }
  }

  // ========= UI =========
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

        {passo === "login" && (
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
        )}

        {passo === "codigo" && (
          // Etapa de verificação do e-mail (OTP)
          <form onSubmit={verificarEmail} className="space-y-4">
            <p className="text-center text-sm text-gray-600">
              Insira o código enviado para <strong>{emailParaVerificar}</strong>
            </p>

            <div className="flex justify-between gap-2">
              {codigo.map((value, index) => (
                <input
                  key={index}
                  id={`codigo-${index}`}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={value}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  className={inputCode}
                  aria-label={`Dígito ${index + 1} do código`}
                  disabled={carregando}
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={carregando}
              className="w-full rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-400/60"
            >
              {carregando ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size="w-4 h-4" /> Verificando…
                </span>
              ) : (
                "Verificar E-mail"
              )}
            </button>

            <div className="text-sm text-gray-600 flex items-center justify-between">
              <button
                type="button"
                onClick={reenviarCodigo}
                disabled={carregando}
                className="text-orange-600 hover:underline disabled:opacity-60"
              >
                Reenviar código
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasso("login");
                  setCodigo(Array(OTP_LEN).fill(""));
                  setValue("email", emailParaVerificar || getValues("email"));
                }}
                className="text-gray-500 hover:underline"
                disabled={carregando}
              >
                Trocar e-mail
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
