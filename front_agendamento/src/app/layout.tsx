// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import ClientShell from "../components/ClientShell";
import UserLoader from "../components/UserLoader";

// 🔤 Fonte Inter global
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"], // ajusta se quiser
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      {/* 👇 aqui aplicamos a fonte no body inteiro */}
      <body className={inter.className}>
        <UserLoader />
        <ClientShell>{children}</ClientShell>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
