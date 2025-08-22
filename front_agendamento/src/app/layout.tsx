import "./globals.css";
import { Toaster } from "sonner";
import ClientShell from "../components/ClientShell";
import UserLoader from "../components/UserLoader";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <body>
        <ClientShell>{children}</ClientShell>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
