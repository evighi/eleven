"use client";

import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Spinner from "@/components/Spinner";

const inputBase =
  "w-full px-3 py-2 rounded-md bg-gray-100 text-sm border border-transparent focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500 placeholder:text-gray-400";

const inputCode =
  "w-12 h-12 text-center text-lg font-semibold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500";

type Inputs = {
  nome: string;
  cpf: string;
  nascimento: string;
  email: string;
  celular: string;
  senha: string;
  confirmarSenha: string;
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
      nome: "",
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
  const dadosClienteRef = useRef<Omit<Inputs, "confirmarSenha"> | null>(null);

  // Termos
  const [showTerms, setShowTerms] = useState(false);
  const [termsCanBeAccepted, setTermsCanBeAccepted] = useState(false); // vira true só após rolar até o fim no modal
  const [acceptedTerms, setAcceptedTerms] = useState(false);           // checkbox marcado

  const handleCodeChange = (index: number, value: string) => {
    if (!/^[0-9]?$/.test(value)) return;
    const novo = [...codigo];
    novo[index] = value;
    setCodigo(novo);
    const next = document.getElementById(`codigo-${index + 1}`) as HTMLInputElement | null;
    if (value && next) next.focus();
  };

  const validaSenhaFront = useCallback(() => {
    // regra nova: mínimo 6 e pelo menos 1 maiúscula
    return /^(?=.*[A-Z]).{6,}$/.test(senhaValue || "");
  }, [senhaValue]);

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

    setCarregando(true);
    try {
      const { confirmarSenha, ...dadosParaEnvio } = data;

      const res = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/clientes/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dadosParaEnvio),
      });

      const resposta = await res.json();

      if (res.ok) {
        toast.success(resposta.mensagem || "Código enviado para o e-mail!");
        setEmailParaVerificar(data.email);
        dadosClienteRef.current = dadosParaEnvio;
        reset();
        setAcceptedTerms(false);
        setTermsCanBeAccepted(false);
      } else {
        toast.error(resposta.erro || "Erro ao cadastrar.");
      }
    } catch {
      toast.error("Erro de conexão ao cadastrar");
    } finally {
      setCarregando(false);
    }
  }

  async function verificarEmail(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/clientes/validar-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailParaVerificar, codigo: codigo.join("") }),
      });

      if (res.ok) {
        toast.success("E-mail verificado com sucesso!");
        router.push("/login");
      } else {
        const erro = await res.json();
        toast.error(erro?.erro ?? "Erro ao verificar e-mail");
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
          <img src="/logoEleven.png" alt="Eleven Sports" className="mx-auto h-40 object-contain" />
          <h1 className="mt-3 text-2xl font-bold text-orange-600">
            {emailParaVerificar ? "Validar e-mail" : "Criar cadastro"}
          </h1>
        </div>

        {/* Cartão branco */}
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          {!emailParaVerificar ? (
            <form onSubmit={handleSubmit(cadastraCliente)} className="space-y-3">
              <Campo label="Nome completo">
                <input
                  className={inputBase}
                  placeholder="Insira o nome do usuário"
                  {...register("nome", { required: true })}
                />
              </Campo>

              <Campo label="Data de nascimento">
                <input
                  type="date"
                  className={inputBase}
                  {...register("nascimento", { required: true })}
                />
              </Campo>

              <Campo label="CPF">
                <input
                  className={inputBase}
                  placeholder="Insira o seu CPF"
                  {...register("cpf", {
                    required: "CPF é obrigatório",
                    pattern: {
                      value: /^\d{11}$/,
                      message: "CPF deve conter exatamente 11 números",
                    },
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
                  placeholder="Insira o telefone"
                  {...register("celular", { required: true })}
                />
              </Campo>

              {/* Campos extras (senha) */}
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
                  <p className="text-[12px] text-gray-500">
                    Leia os termos para habilitar o avanço.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
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
            // Etapa de verificação do e-mail
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
                    maxLength={1}
                    value={value}
                    onChange={(e) => handleCodeChange(index, e.target.value)}
                    className={inputCode}
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
            setTermsCanBeAccepted(true);   // só habilita o checkbox quando o usuário rolou até o fim
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
    const reached = el.scrollTop + el.clientHeight >= el.scrollHeight - 8; // tolerância
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
