"use client";

import Image from "next/image";
import Link from "next/link";
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
  const { register, handleSubmit } = useForm<Inputs>();
  const { logaUsuario } = useAuthStore();
  const router = useRouter();

  async function verificaLogin(data: Inputs) {
    const response = await fetch(`${process.env.NEXT_PUBLIC_URL_API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: data.email,
        senha: data.senha,
      }),
    });

    if (response.ok) {
      const dados: Omit<UsuarioLogadoItf, "token"> = await response.json();

      logaUsuario({
        ...dados,
        token: "",
      });

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
    } else {
      toast.error("Erro... Login ou senha incorretos");
    }
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-sm p-6 rounded-md text-center">
        {/* Logo */}
        <div className="mb-6">
          <Image
            src="/logoEleven(2).png"
            alt="Eleven Sports"
            width={240}
            height={80}
            className="mx-auto"
            priority
          />
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit(verificaLogin)} className="space-y-4 text-left">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              E-mail
            </label>
            <input
              type="email"
              id="email"
              {...register("email")}
              required
              className="w-full px-4 py-2 rounded-md bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="Insira o seu e-mail"
            />
          </div>

          <div>
            <label htmlFor="senha" className="block text-sm font-medium text-gray-700">
              Senha
            </label>
            <input
              type="password"
              id="senha"
              {...register("senha")}
              required
              className="w-full px-4 py-2 rounded-md bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="Insira a sua senha"
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
            className="w-full bg-orange-600 hover:bg-orange-700 text-white py-2 rounded-md font-semibold cursor-pointer transition duration-200"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
