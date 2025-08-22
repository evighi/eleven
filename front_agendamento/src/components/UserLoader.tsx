// app/UserLoader.tsx  (ou src/app/UserLoader.tsx)
"use client";

import { useLoadUser } from "@/hooks/useLoadUser";

export default function UserLoader() {
  useLoadUser();          // dispara /usuarios/me uma vez quando a app monta
  return null;            // não renderiza nada
}
