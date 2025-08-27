"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo } from "react";
import { useAuthStore } from "@/context/AuthStore";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import Spinner from "@/components/Spinner";

export default function PerfilHome() {
  // 🔒 Exige usuário logado (qualquer tipo)
  const { isChecking } = useRequireAuth();

  const { usuario } = useAuthStore();

  const firstName = useMemo(() => {
    const n = (usuario?.nome || "").trim();
    return n ? n.split(" ")[0] : "Usuário";
  }, [usuario?.nome]);

  // ⏳ Enquanto verifica cookie/usuário, mostra spinner fullscreen
  if (isChecking) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#f5f5f5]">
        <div className="flex items-center gap-3 text-gray-600">
          <Spinner size="w-8 h-8" />
          <span>Carregando…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5]">
      {/* Header idêntico ao da Home */}
      <header className="bg-gradient-to-b from-orange-600 to-orange-600 text-white px-4 md:px-6 py-5 md:py-6">
        <div className="mx-auto max-w-md md:max-w-lg lg:max-w-xl text-center">
          <h1 className="text-2xl md:text-3xl font-bold tracking-wide drop-shadow-sm">
            Olá, {firstName}!
          </h1>
          <div>
            <span className="inline-block text-[10px] font-semibold px-3 rounded-full">
              Atleta
            </span>
          </div>
        </div>
      </header>

      {/* Conteúdo no mesmo padrão da Home */}
      <section className="px-4 md:px-6 py-3 md:py-4">
        <div className="mx-auto max-w-md md:max-w-lg lg:max-w-xl">
          {/* Cartão branco “flutuando” como na Home */}
          <div className="-mt-3 bg-white rounded-2xl shadow-md p-4 sm:p-5 md:p-6">
            {/* Bloco Perfil */}
            <Bloco titulo="Perfil">
              <Tile href="/meuPerfil" iconSrc="/icons/myperfil.png" iconAlt="Perfil">
                Editar informações
              </Tile>
            </Bloco>

            {/* Bloco Reservas */}
            <Bloco titulo="Reservas">
              <Tile
                href="/reservasAnteriores"
                iconSrc="/icons/verreser.png"
                iconAlt="Reservas"
              >
                Ver suas reservas anteriores
              </Tile>
            </Bloco>

            {/* Bloco Transferências */}
            <Bloco titulo="Transferências">
              <Tile
                href="/transferenciasAnteriores"
                iconSrc="/icons/versuas.png"
                iconAlt="Transferências"
              >
                Ver suas transferências anteriores
              </Tile>
            </Bloco>
          </div>
        </div>
      </section>

      {/* Safe-area quando houver footer fixo */}
      <div className="supports-[padding:env(safe-area-inset-bottom)]:pb-[env(safe-area-inset-bottom)]" />
    </main>
  );
}

/* ---------- Subcomponentes no mesmo “look” da Home ---------- */

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-[13px] sm:text-sm font-semibold text-gray-500 mb-2">
        {titulo}
      </h2>
      {children}
    </div>
  );
}

function Tile({
  href,
  children,
  iconSrc,
  iconAlt,
}: {
  href: string;
  children: React.ReactNode;
  iconSrc: string;
  iconAlt: string;
}) {
  // Mesmo layout dos botões da Home: cinza claro + divisória + texto laranja
  return (
    <Link
      href={href}
      className="block w-full rounded-xl bg-[#f3f3f3] px-3 sm:px-4 py-3 hover:bg-[#ececec] transition"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center">
          <Image
            src={iconSrc}
            alt={iconAlt}
            width={40}
            height={40}
            className="w-9 h-9 sm:w-10 sm:h-10 object-contain opacity-80"
            priority={false}
          />
        </div>
        <div className="w-px h-10 sm:h-12 bg-gray-300" />
        <span className="pl-3 text-[14px] sm:text-[15px] font-semibold text-orange-600">
          {children}
        </span>
      </div>
    </Link>
  );
}
