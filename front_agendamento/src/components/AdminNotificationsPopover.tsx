"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { ChevronDown, X } from "lucide-react";
import Spinner from "@/components/Spinner";
import type { NotificacaoUI } from "@/hooks/useNotifications";

type Props = {
    open: boolean;
    onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>;

    loading: boolean;
    items: NotificacaoUI[];

    fetchNotifications: (opts?: { take?: number; unreadOnly?: boolean; reset?: boolean }) => Promise<void> | void;
    markVisibleRead: () => Promise<void> | void;
};

type Pos = { top: number; right: number; width: number };

function formatTimeBR(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function AdminNotificationsPopover({
    open,
    onClose,
    anchorRef,
    loading,
    items,
    fetchNotifications,
    markVisibleRead,
}: Props) {
    // ✅ roda apenas 1x por abertura
    const didInitOnOpenRef = useRef(false);

    useEffect(() => {
        if (!open) {
            didInitOnOpenRef.current = false;
            return;
        }
        if (didInitOnOpenRef.current) return;
        didInitOnOpenRef.current = true;

        (async () => {
            try {
                // ✅ últimas 50 (não lidas)
                await Promise.resolve(fetchNotifications({ take: 50, unreadOnly: true, reset: true }));
            } catch {
                // silencioso
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const closingRef = useRef(false);

    const handleClose = () => {
        if (closingRef.current) return;
        closingRef.current = true;

        onClose();
        void markVisibleRead();

        // libera logo depois (ou quando open virar false)
        setTimeout(() => (closingRef.current = false), 250);
    };

    // ESC fecha
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && handleClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);


    // posição
    const [pos, setPos] = useState<Pos>({ top: 72, right: 16, width: 380 });

    const recomputePos = () => {
        const el = anchorRef?.current;
        const vw = window.innerWidth;
        const isMobile = vw < 640;

        const width = isMobile ? Math.min(420, vw - 32) : 380;

        if (!el) {
            setPos({ top: 72, right: 16, width });
            return;
        }

        const r = el.getBoundingClientRect();
        const top = Math.round(r.bottom + 10);

        const container = el.closest("[data-admin-header-container]") as HTMLElement | null;
        const cr = container?.getBoundingClientRect();

        const PADDING = 16;
        let desiredRightEdge = r.right;
        if (cr) desiredRightEdge = cr.right - PADDING;

        let right = Math.max(12, Math.round(vw - desiredRightEdge));

        if (cr) {
            const left = vw - right - width;
            const minLeft = cr.left + PADDING;
            if (left < minLeft) right = Math.max(12, Math.round(vw - (minLeft + width)));
        }

        setPos({ top, right, width });
    };

    useLayoutEffect(() => {
        if (!open) return;
        recomputePos();

        const onResize = () => recomputePos();
        const onScroll = () => recomputePos();

        window.addEventListener("resize", onResize);
        window.addEventListener("scroll", onScroll, true);

        return () => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("scroll", onScroll, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const sorted = useMemo(() => {
        const copy = [...items];
        copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return copy;
    }, [items]);

    // ✅ controle de expansão (ver mensagem completa)
    const [expandedRecipientId, setExpandedRecipientId] = useState<string | null>(null);

    useEffect(() => {
        if (!open) setExpandedRecipientId(null);
    }, [open]);

    const toggleExpanded = (recipientId: string) => {
        setExpandedRecipientId((cur) => (cur === recipientId ? null : recipientId));
    };

    if (!open) return null;

    return (
        <>
            <button
                type="button"
                aria-label="Fechar notificações"
                onClick={handleClose}
                className="fixed inset-0 z-40 bg-black/20 sm:bg-transparent"
            />

            <aside
                className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-[0_12px_30px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden"
                style={{ top: pos.top, right: pos.right, width: pos.width, maxHeight: "calc(100dvh - 120px)" }}
                role="dialog"
                aria-modal="true"
                aria-label="Notificações"
            >
                {/* header */}
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="min-w-0">
                        <p className="text-sm font-extrabold text-gray-800 leading-none">Notificações</p>
                        <p className="text-[11px] text-gray-500 mt-1">Não lidas (até 50)</p>
                    </div>

                    <button
                        type="button"
                        onClick={handleClose}
                        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                        aria-label="Fechar"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 px-2 py-2 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
                    {loading && items.length === 0 ? (
                        <div className="flex items-center gap-2 px-3 py-3 text-gray-600">
                            <Spinner />
                            <span className="text-sm">Carregando…</span>
                        </div>
                    ) : sorted.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-gray-500">Nenhuma notificação no momento.</div>
                    ) : (
                        <div className="space-y-2">
                            {sorted.map((n) => (
                                <NotificationRow
                                    key={n.recipientId}
                                    n={n}
                                    expanded={expandedRecipientId === n.recipientId}
                                    onToggle={() => toggleExpanded(n.recipientId)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="pb-[env(safe-area-inset-bottom)]" />
            </aside>
        </>
    );
}

function NotificationRow({
    n,
    expanded,
    onToggle,
}: {
    n: NotificacaoUI;
    expanded: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={[
                "w-full text-left px-3 py-2 rounded-md border transition",
                "border-transparent hover:border-[#DDDDDD]",
                "bg-[#FFF7ED] hover:bg-[#FFEDD5] ring-1 ring-orange-300",
            ].join(" ")}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-extrabold text-gray-800 truncate">{n.title}</p>

                        <span
                            className={[
                                "shrink-0 mt-[1px] inline-flex items-center justify-center",
                                "w-6 h-6 rounded hover:bg-black/5",
                                expanded ? "rotate-180" : "rotate-0",
                                "transition-transform",
                            ].join(" ")}
                            aria-hidden="true"
                        >
                            <ChevronDown className="w-4 h-4 text-gray-600" />
                        </span>
                    </div>

                    {n.message ? (
                        expanded ? (
                            <p className="text-[12px] text-gray-700 mt-1 whitespace-pre-wrap break-words">
                                {n.message}
                            </p>
                        ) : (
                            <p className="text-[12px] text-gray-600 mt-0.5 line-clamp-2">{n.message}</p>
                        )
                    ) : null}

                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-[11px] text-gray-500">{formatTimeBR(n.createdAt)}</p>
                        {n.actorNome ? <span className="text-[11px] text-gray-400">• {n.actorNome}</span> : null}
                    </div>
                </div>
            </div>
        </button>
    );
}
