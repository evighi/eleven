import { useAuthStore } from "@/context/AuthStore";
import { useRouter } from "next/navigation";

export function useLogout() {
  const deslogaUsuario = useAuthStore((state) => state.deslogaUsuario);
  const router = useRouter();

  const logout = async () => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_URL_API}/login/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Erro no logout:", error);
    }
    deslogaUsuario();
    router.push("/login");
  };

  return logout;
}
