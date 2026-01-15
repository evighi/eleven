"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/context/AuthStore";
// ✅ use o tipo do store
import type { UsuarioLogadoItf } from "@/context/AuthStore";
import Spinner from "@/components/Spinner";

type Inputs = {
  email: string;
  senha: string;
};

type Passo = "login" | "codigo" | "bloqueado";

const OTP_LEN = 6;

function fmtDataSP(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleString("pt-BR");
  }
}

export default function Login() {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
    setValue,
    getValues,
  } = useForm<Inputs>({ defaultValues: { email: "", senha: "" } });

  const { logaUsuario, setCarregandoUser } = useAuthStore();
  const router = useRouter();

  // Fluxo
  const [passo, setPasso] = useState<Passo>("login");
  const [emailParaVerificar, setEmailParaVerificar] = useState<string>("");
  const [carregando, setCarregando] = useState(false);
  const [codigo, setCodigo] = useState<string[]>(Array(OTP_LEN).fill(""));
  const [ultimaTentativa, setUltimaTentativa] = useState<Inputs | null>(null);

  // Estado para bloqueado
  const [bloqueadoInfo, setBloqueadoInfo] = useState<{
    motivo: "ACCOUNT_DISABLED" | "ACCOUNT_DELETED";
    eligibleAt?: string | null;
    status?: string | null;
  } | null>(null);

  const inputCode =
    "w-12 h-12 text-center text-xl font-semibold tracking-widest rounded-md bg-gray-200 " +
    "focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60";

  useEffect(() => {
    const last = typeof window !== "undefined" ? localStorage.getItem("lastEmail") : null;
    if (last) setValue("email", last);
  }, [setValue]);

  const focusInput = (idx: number) => {
    const el = document.getElementById(`codigo-${idx}`) as HTMLInputElement | null;
    if (el) el.focus();
  };

  const handleCodeChange = (index: number, raw: string) => {
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
    const next = Math.min(OTP_LEN - 1, clip.length);
    focusInput(next);
  };

  const codigoStr = () => codigo.join("");

  // ========= Login =========
  async function verificaLogin(data: Inputs) {
    try {
      setUltimaTentativa(data);
      const response = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: data.email, senha: data.senha, manter: true }),
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
            const code = body?.code as string | undefined;

            if (code === "ACCOUNT_DISABLED") {
              // Mostrar tela de bloqueio
              setBloqueadoInfo({
                motivo: "ACCOUNT_DISABLED",
                eligibleAt: body?.eligibleAt ?? null,
                status: body?.status ?? null,
              });
              setPasso("bloqueado");
              return;
            }

            if (code === "ACCOUNT_DELETED") {
              setBloqueadoInfo({ motivo: "ACCOUNT_DELETED" });
              setPasso("bloqueado");
              return;
            }

            if (code === "EMAIL_NAO_CONFIRMADO") {
              setEmailParaVerificar(data.email);
              setCodigo(Array(OTP_LEN).fill(""));
              setPasso("codigo");
              toast.message(body?.erro || "E-mail não confirmado. Enviamos um novo código.");
              setTimeout(() => focusInput(0), 50);
              return;
            }

            toast.error(serverMsg || "Acesso negado.");
            return;
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

      // ✅ GARANTE que não vai ficar preso em loading
      setCarregandoUser(false);


      try {
        localStorage.setItem("lastEmail", data.email);
      } catch { }

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
      } catch { }

      switch (dados.tipo) {
        case "CLIENTE":
        case "CLIENTE_APOIADO":
          router.push("/");
          break;
        case "ADMIN_MASTER":
          router.push("/adminMaster");
          break;
        case "ADMIN_ATENDENTE":
          router.push("/adminMaster");
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
      } catch { }
      if (!resp.ok) {
        toast.error(data?.erro || "Código inválido. Tente novamente.");
        return;
      }
      toast.success("E-mail verificado com sucesso! Entrando…");

      if (ultimaTentativa) {
        await verificaLogin(ultimaTentativa);
      } else {
        setPasso("login");
        setValue("email", emailParaVerificar);
      }
    } catch {
      toast.error("Não foi possível verificar o e-mail.");
    } finally {
      setCarregando(false);
    }
  }

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
      } catch { }
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

        {passo === "bloqueado" && (
          <div className="space-y-4 text-left">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h2 className="text-lg font-semibold text-red-800">
                {bloqueadoInfo?.motivo === "ACCOUNT_DELETED"
                  ? "Conta removida"
                  : "Conta bloqueada"}
              </h2>
              <p className="mt-2 text-sm text-red-900">
                {bloqueadoInfo?.motivo === "ACCOUNT_DELETED"
                  ? "Esta conta foi removida e não pode mais acessar o sistema."
                  : "Sua conta está bloqueada. O acesso não é possível no momento."}
              </p>

              <p className="mt-3 text-sm text-red-900">
                Em caso de dúvidas, por favor, entre em contato com os administradores.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setPasso("login");
                setBloqueadoInfo(null);
              }}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white py-2 rounded-md font-semibold cursor-pointer transition duration-200"
            >
              Voltar ao login
            </button>

            <div className="text-center text-xs text-gray-500">
              <p>
                Precisa de ajuda?{" "}
                <Link href="/contato" className="text-orange-600 hover:underline">
                  Fale conosco
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
