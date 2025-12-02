// app/adminMaster/layout.tsx
import "@/app/globals.css";
import type { ReactNode } from "react";
import AdminHeader from "@/components/AdminHeader";
import AdminGuard from "@/components/AdminShell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <AdminHeader />
      <AdminGuard>
        <main className="p-4 max-w-6xl mx-auto">{children}</main>
      </AdminGuard>
    </div>
  );
}
