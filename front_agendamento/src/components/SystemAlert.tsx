"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export type AlertVariant = "success" | "error" | "info";

export type SystemAlertProps = {
  open: boolean;
  message: string;
  variant?: AlertVariant;
  autoHideMs?: number; // tempo em ms para sumir automaticamente
  onClose?: () => void;
};

const VARIANT_STYLES: Record<
  AlertVariant,
  {
    container: string;
    chip: string;
  }
> = {
  success: {
    container:
      "bg-emerald-50 border-emerald-200 text-emerald-900 shadow-[0_10px_30px_rgba(16,185,129,0.18)]",
    chip: "bg-emerald-100 text-emerald-700",
  },
  error: {
    container:
      "bg-rose-50 border-rose-200 text-rose-900 shadow-[0_10px_30px_rgba(244,63,94,0.18)]",
    chip: "bg-rose-100 text-rose-700",
  },
  info: {
    container:
      "bg-sky-50 border-sky-200 text-sky-900 shadow-[0_10px_30px_rgba(56,189,248,0.18)]",
    chip: "bg-sky-100 text-sky-700",
  },
};

export default function SystemAlert({
  open,
  message,
  variant = "info",
  autoHideMs = 4000,
  onClose,
}: SystemAlertProps) {
  const isVisible = open && !!message;

  // 🕒 auto-hide baseado em props (sem state interno)
  useEffect(() => {
    if (!isVisible || !onClose || !autoHideMs) return;

    const id = window.setTimeout(() => {
      onClose();
    }, autoHideMs);

    return () => window.clearTimeout(id);
  }, [isVisible, onClose, autoHideMs]);

  // ⎋ ESC só funciona quando o alerta está visível
  useEffect(() => {
    if (!isVisible || !onClose) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.info;

  return (
    <div className="fixed inset-x-0 top-4 z-[120] flex justify-center pointer-events-none">
      <div className="w-full max-w-md px-4">
        <div
          className={[
            "pointer-events-auto relative flex items-start gap-3 rounded-2xl border px-4 py-3",
            "backdrop-blur-sm transition-all duration-200",
            styles.container,
          ].join(" ")}
          role={variant === "error" ? "alert" : "status"}
          aria-live={variant === "error" ? "assertive" : "polite"}
        >
          {/* Bolinha com chip de tipo */}
          <div
            className={[
              "mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              styles.chip,
            ].join(" ")}
          >
            {variant === "success"
              ? "Sucesso"
              : variant === "error"
              ? "Erro"
              : "Aviso"}
          </div>

          {/* Mensagem */}
          <div className="flex-1 text-sm leading-snug">{message}</div>

          {/* Botão fechar */}
          <button
            type="button"
            onClick={onClose}
            className="ml-1 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs hover:bg-black/5"
            aria-label="Fechar aviso"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
