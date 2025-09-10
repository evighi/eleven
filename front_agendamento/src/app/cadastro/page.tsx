"use client";

import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import Spinner from "@/components/Spinner";

const inputBase =
  "w-full px-3 py-2 rounded-md bg-gray-100 text-sm border border-transparent focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500 placeholder:text-gray-400";

const inputCode =
  "w-12 h-12 text-center text-lg font-semibold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500";

type Inputs = {
  firstName: string;
  lastName: string;
  cpf: string;
  nascimento: string;
  email: string;
  celular: string;
  senha: string;
  confirmarSenha: string;
};

type BackendPayload = {
  nome: string;
  cpf: string;
  nascimento: string;
  email: string;
  celular: string;
  senha: string;
};

export default function Cadastro() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    watch,
  } = useForm<Inputs>({
    defaultValues: {
      firstName: "",
      lastName: "",
      cpf: "",
      nascimento: "",
      email: "",
      celular: "",
      senha: "",
      confirmarSenha: "",
    },
  });

  const senhaValue = watch("senha");
  const router = useRouter();

  const [emailParaVerificar, setEmailParaVerificar] = useState("");
  const [codigo, setCodigo] = useState<string[]>(Array(6).fill(""));
  const [carregando, setCarregando] = useState(false);

  // Reenvio de código
  const [reenviando, setReenviando] = useState(false);
  const [cooldown, setCooldown] = useState(0); // segundos

  const dadosClienteRef = useRef<BackendPayload | null>(null);

  // Termos
  const [showTerms, setShowTerms] = useState(false);
  const [termsCanBeAccepted, setTermsCanBeAccepted] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // ===== Helpers OTP =====
  const focusInput = (idx: number) => {
    const el = document.getElementById(`codigo-${idx}`) as HTMLInputElement | null;
    el?.focus();
    el?.select?.();
  };

  useEffect(() => {
    if (emailParaVerificar) {
      // entrou no passo OTP
      setCodigo(Array(6).fill(""));
      setCooldown(60); // trava 60s para novo reenvio
      // foca no primeiro campo
      setTimeout(() => focusInput(0), 50);
    }
  }, [emailParaVerificar]);

  // Countdown do botão "Reenviar"
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleCodeChange = (index: number, value: string) => {
    // apenas dígito
    if (!/^\d?$/.test(value)) return;

    const novo = [...codigo];
    novo[index] = value;
    setCodigo(novo);

    // vai para o próximo quando digita
    if (value && index < 5) focusInput(index + 1);
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key;
    if (key === "Backspace") {
      if (!codigo[index] && index > 0) {
        // se já está vazio, volta para o anterior
        e.preventDefault();
        const novo = [...codigo];
        novo[index - 1] = "";
        setCodigo(novo);
        focusInput(index - 1);
      }
      return;
    }
    if (key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusInput(index - 1);
    }
    if (key === "ArrowRight" && index < 5) {
      e.preventDefault();
      focusInput(index + 1);
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text") || "";
    const digits = (text.match(/\d/g) || []).slice(0, 6);
    if (digits.length === 0) return;
    e.preventDefault();
    const novo = Array(6)
      .fill("")
      .map((_, i) => digits[i] ?? "");
    setCodigo(novo);
    // foca no último preenchido
    const last = Math.min(5, Math.max(0, digits.length - 1));
    setTimeout(() => focusInput(last), 0);
  };

  // ===== Validações =====
  const validaSenhaFront = useCallback(() => {
    // mínimo 6 e pelo menos 1 maiúscula
    return /^(?=.*[A-Z]).{6,}$/.test(senhaValue || "");
  }, [senhaValue]);

  function juntarNomeCompleto(firstName: string, lastName: string) {
    return `${(firstName || "").trim()} ${(lastName || "").trim()}`
      .replace(/\s+/g, " ")
      .trim();
  }

  // ===== Reenvio (manual) =====
  const handleReenviarCodigo = async () => {
    if (!emailParaVerificar) return;
    if (cooldown > 0 || reenviando) return;
    setReenviando(true);
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/clientes/reenviar-codigo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailParaVerificar }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(body?.erro || "Falha ao reenviar código");
      } else {
        toast.success(body?.mensagem || "Código reenviado!");
        setCooldown(60);
      }
    } catch {
      toast.error("Falha de conexão ao reenviar");
    } finally {
      setReenviando(false);
    }
  };

  // ===== Submit cadastro =====
  async function cadastraCliente(data: Inputs) {
    if (!acceptedTerms) {
      toast.error("Você precisa ler e aceitar os Termos e Condições.");
      return;
    }
    if (data.senha !== data.confirmarSenha) {
      toast.error("As senhas não coincidem");
      return;
    }
    if (!validaSenhaFront()) {
      toast.error("A senha precisa ter ao menos 6 caracteres e 1 letra maiúscula.");
      return;
    }

    const nomeCompleto = juntarNomeCompleto(data.firstName, data.lastName);
    if (!nomeCompleto) {
      toast.error("Informe nome e sobrenome.");
      return;
    }

    const dadosParaEnvio: BackendPayload = {
      nome: nomeCompleto,
      cpf: data.cpf,
      nascimento: data.nascimento,
      email: data.email,
      celular: data.celular,
      senha: data.senha,
    };

    setCarregando(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/clientes/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dadosParaEnvio),
      });

      const raw = await res.text();
      let resposta: any = null;
      try {
        resposta = raw ? JSON.parse(raw) : null;
      } catch {
        /* ignore */
      }

      if (res.ok) {
        // 201 (criado) ou 202 (reenviado por já existir não verificado)
        if (res.status === 202) {
          toast.success(
            resposta?.mensagem ||
              "Este e-mail já existia sem verificação. Reenviamos um novo código."
          );
        } else {
          toast.success(resposta?.mensagem || "Código enviado para o e-mail!");
        }

        setEmailParaVerificar(dadosParaEnvio.email);
        dadosClienteRef.current = dadosParaEnvio;
        reset();
        setAcceptedTerms(false);
        setTermsCanBeAccepted(false);
        return;
      }

      // Tratamento de erros
      const errMsg: string = resposta?.erro || resposta?.message || "Erro ao cadastrar.";
      if (res.status === 409) {
        if (/cpf/i.test(errMsg)) {
          toast.error("CPF já cadastrado.");
        } else if (/e-?mail/i.test(errMsg) || /email/i.test(errMsg)) {
          toast.error("E-mail já cadastrado. Faça login para continuar.");
        } else {
          toast.error(errMsg);
        }
      } else if (res.status === 400) {
        toast.error(errMsg);
      } else {
        toast.error(errMsg || "Não foi possível concluir o cadastro.");
      }
    } catch {
      toast.error("Erro de conexão ao cadastrar");
    } finally {
      setCarregando(false);
    }
  }

  // ===== Submit verificação =====
  async function verificarEmail(e: React.FormEvent) {
    e.preventDefault();

    const code = codigo.join("");
    if (!/^\d{6}$/.test(code)) {
      toast.error("Informe os 6 dígitos do código.");
      focusInput(codigo.findIndex((c) => !c) || 0);
      return;
    }

    setCarregando(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/clientes/validar-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailParaVerificar, codigo: code }),
      });

      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        toast.success("E-mail verificado com sucesso!");
        router.push("/login");
      } else {
        const msg = body?.erro || "Erro ao verificar e-mail";
        toast.error(msg);
        // sugestão: se expirado, habilitar reenvio imediatamente
        if (/expirad/i.test(String(msg))) setCooldown(0);
      }
    } catch {
      toast.error("Erro de conexão ao verificar e-mail");
    } finally {
      setCarregando(false);
    }
  }

  const canSubmit = !carregando && acceptedTerms;

  return (
    <main className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto w-full max-w-sm">
        {/* Topo com logo + título */}
        <div className="text-center">
          <Image
            src="/logoEleven.png"
            alt="Eleven Sports"
            width={320}
            height={160}
            className="mx-auto h-40 w-auto object-contain"
            priority
          />
          <h1 className="mt-3 text-2xl font-bold text-orange-600">
            {emailParaVerificar ? "Validar e-mail" : "Criar cadastro"}
          </h1>
        </div>

        {/* Cartão branco */}
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          {!emailParaVerificar ? (
            <form onSubmit={handleSubmit(cadastraCliente)} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Nome">
                  <input
                    className={inputBase}
                    placeholder="Seu nome"
                    {...register("firstName", { required: true })}
                  />
                </Campo>
                <Campo label="Sobrenome">
                  <input
                    className={inputBase}
                    placeholder="Seu sobrenome"
                    {...register("lastName", { required: true })}
                  />
                </Campo>
              </div>

              <Campo label="Data de nascimento">
                <input type="date" className={inputBase} {...register("nascimento", { required: true })} />
              </Campo>

              <Campo label="CPF">
                <input
                  className={inputBase}
                  placeholder="Insira o seu CPF (apenas números)"
                  {...register("cpf", {
                    required: "CPF é obrigatório",
                    pattern: { value: /^\d{11}$/, message: "CPF deve conter exatamente 11 números" },
                  })}
                />
                {errors.cpf && (
                  <p className="mt-1 text-[12px] text-red-600">{errors.cpf.message as string}</p>
                )}
              </Campo>

              <Campo label="E-mail">
                <input
                  className={inputBase}
                  type="email"
                  placeholder="Insira o e-mail"
                  {...register("email", { required: true })}
                />
              </Campo>

              <Campo label="Celular">
                <input
                  className={inputBase}
                  placeholder="Insira o telefone (apenas números)"
                  {...register("celular", { required: true })}
                />
              </Campo>

              {/* Senhas */}
              <Campo label="Senha">
                <input
                  className={inputBase}
                  type="password"
                  placeholder="Crie uma senha"
                  {...register("senha", {
                    required: true,
                    pattern: {
                      value: /^(?=.*[A-Z]).{6,}$/,
                      message: "Mín. 6 caracteres e 1 letra maiúscula",
                    },
                  })}
                />
                {errors.senha?.message && (
                  <p className="mt-1 text-[12px] text-red-600">{String(errors.senha.message)}</p>
                )}
              </Campo>

              <Campo label="Confirmar senha">
                <input
                  className={inputBase}
                  type="password"
                  placeholder="Repita a senha"
                  {...register("confirmarSenha", { required: true })}
                />
              </Campo>

              {/* Termos & Condições */}
              <div className="space-y-2 rounded-md border border-gray-200 p-3">
                <button
                  type="button"
                  onClick={() => setShowTerms(true)}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-orange-600 hover:text-orange-700"
                >
                  <span className="underline">Ler Termos e Condições</span>
                </button>

                <label className="flex items-start gap-2 text-[13px] text-gray-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={!termsCanBeAccepted}
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                  />
                  <span>
                    Eu li e aceito os{" "}
                    <button
                      type="button"
                      onClick={() => setShowTerms(true)}
                      className="text-orange-600 underline hover:text-orange-700"
                    >
                      Termos e Condições
                    </button>
                    .
                  </span>
                </label>
                {!termsCanBeAccepted && (
                  <p className="text-[12px] text-gray-500">Leia os termos para habilitar o avanço.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={!(!carregando && acceptedTerms)}
                className="mt-1 w-full rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-400/60"
              >
                {carregando ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size="w-4 h-4" /> Avançando…
                  </span>
                ) : (
                  "Avançar"
                )}
              </button>
            </form>
          ) : (
            // ===== Etapa de verificação do e-mail (OTP) =====
            <form onSubmit={verificarEmail} className="space-y-4">
              <p className="text-center text-sm text-gray-600">
                Insira o código enviado para <strong>{emailParaVerificar}</strong>
              </p>

              <div
                className="flex justify-between gap-2"
                onPaste={handleCodePaste}
              >
                {codigo.map((value, index) => (
                  <input
                    key={index}
                    id={`codigo-${index}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={value}
                    onChange={(e) => handleCodeChange(index, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(index, e)}
                    className={inputCode}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    // trocar e-mail (voltar para o formulário)
                    setEmailParaVerificar("");
                    setCodigo(Array(6).fill(""));
                  }}
                  className="text-sm text-gray-600 hover:underline"
                >
                  Trocar e-mail
                </button>

                <button
                  type="button"
                  onClick={handleReenviarCodigo}
                  disabled={reenviando || cooldown > 0}
                  className="text-sm text-orange-600 hover:underline disabled:text-gray-400"
                >
                  {reenviando
                    ? "Reenviando…"
                    : cooldown > 0
                    ? `Reenviar código (${cooldown}s)`
                    : "Reenviar código"}
                </button>
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
            </form>
          )}
        </div>

        {/* Link para login */}
        <p className="mt-4 text-center text-sm text-gray-500">
          Já possui conta?{" "}
          <Link href="/login" className="font-medium text-orange-600 hover:underline">
            Aperte aqui
          </Link>
        </p>
      </div>

      {/* Modal de Termos */}
      {showTerms && (
        <TermsModal
          onClose={() => setShowTerms(false)}
          onAccept={() => {
            setTermsCanBeAccepted(true);
            setShowTerms(false);
          }}
        />
      )}
    </main>
  );
}

/* ---------- Subcomponentes ---------- */

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-semibold text-gray-700">{label}:</label>
      {children}
    </div>
  );
}

function TermsModal({
  onClose,
  onAccept,
}: {
  onClose: () => void;
  onAccept: () => void;
}) {
  const [text, setText] = useState<string>("Carregando termos…");
  const [atBottom, setAtBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/termos.txt", { cache: "no-store" });
        const t = await res.text();
        if (alive) setText(t || "Termos indisponíveis.");
      } catch {
        if (alive) setText("Não foi possível carregar os termos.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const reached = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    setAtBottom(reached);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">Termos e Condições</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-[60vh] overflow-y-auto px-4 py-3 text-[13px] leading-6 text-gray-700 whitespace-pre-wrap"
        >
          {text}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t bg-gray-50">
          <p className="text-[12px] text-gray-600">
            {atBottom ? "Você chegou ao fim dos termos." : "Leia até o final para aceitar."}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Fechar
            </button>
            <button
              onClick={onAccept}
              disabled={!atBottom}
              className={`rounded-md px-3 py-2 text-sm font-semibold text-white ${
                atBottom ? "bg-orange-600 hover:bg-orange-700" : "bg-orange-400/60 cursor-not-allowed"
              }`}
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
