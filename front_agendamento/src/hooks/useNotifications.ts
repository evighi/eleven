"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

type Actor = {
    id: string;
    nome: string;
    tipo: string;
};

type Notification = {
    id: string;
    type: string;
    title: string;
    message: string;
    data: any;
    createdAt: string;
    actorId: string | null;
    actor: Actor | null;
};

type RecipientRow = {
    recipientId: string;
    readAt: string | null;
    notification: Notification;
};

type ListResp = {
    items: RecipientRow[];
    nextCursor: string | null;
};

export type NotificacaoUI = {
    recipientId: string;
    notificationId: string;

    type: string;
    title: string;
    message: string;
    createdAt: string;

    readAt: string | null;
    lida: boolean;

    actorNome?: string | null;
    data?: any;
};

type SseNotificationEvent = {
    notificationId: string;
    type: string;
    title?: string;
    createdAt?: string;
    message?: string;
};

export function useNotifications() {
    const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

    const [loading, setLoading] = useState(false);
    const [countUnread, setCountUnread] = useState<number>(0);

    const [items, setItems] = useState<NotificacaoUI[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);

    const lastReqRef = useRef<number>(0);

    // --- refs para SSE / reconnect / debounce
    const esRef = useRef<EventSource | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const reconnectAttemptRef = useRef<number>(0);
    const refreshDebounceRef = useRef<number | null>(null);

    const fetchUnreadCount = useCallback(async () => {
        try {
            const res = await axios.get<{ count: number }>(`${API_URL}/notificacoes/unread-count`, {
                withCredentials: true,
            });
            setCountUnread(Number(res.data?.count ?? 0));
        } catch {
            // silencioso
        }
    }, [API_URL]);

    const mapToUI = useCallback((rows: RecipientRow[]): NotificacaoUI[] => {
        return (rows ?? []).map((r) => ({
            recipientId: r.recipientId,
            notificationId: r.notification.id,
            type: r.notification.type,
            title: r.notification.title,
            message: r.notification.message,
            createdAt: r.notification.createdAt,
            readAt: r.readAt,
            lida: !!r.readAt,
            actorNome: r.notification.actor?.nome ?? null,
            data: r.notification.data ?? null,
        }));
    }, []);

    const fetchNotifications = useCallback(
        async (opts?: { take?: number; unreadOnly?: boolean; reset?: boolean }) => {
            const take = opts?.take ?? 50;
            const unreadOnly = opts?.unreadOnly ?? true;
            const reset = opts?.reset ?? true;

            const reqId = Date.now();
            lastReqRef.current = reqId;
            setLoading(true);

            try {
                const cursorToUse = reset ? undefined : nextCursor ?? undefined;

                const res = await axios.get<ListResp>(`${API_URL}/notificacoes`, {
                    params: {
                        take,
                        cursor: cursorToUse,
                        unreadOnly,
                    },
                    withCredentials: true,
                });

                if (lastReqRef.current !== reqId) return;

                const mapped = mapToUI(res.data?.items ?? []);
                setNextCursor(res.data?.nextCursor ?? null);

                if (reset) {
                    setItems(mapped);
                } else {
                    setItems((prev) => {
                        const seen = new Set(prev.map((x) => x.recipientId));
                        const add = mapped.filter((x) => !seen.has(x.recipientId));
                        return [...prev, ...add];
                    });
                }

                fetchUnreadCount();
            } catch {
                if (lastReqRef.current !== reqId) return;
                if (opts?.reset ?? true) setItems([]);
                setNextCursor(null);
            } finally {
                if (lastReqRef.current === reqId) setLoading(false);
            }
        },
        [API_URL, fetchUnreadCount, mapToUI, nextCursor]
    );

    const hasMore = useMemo(() => !!nextCursor, [nextCursor]);

    const markAsRead = useCallback(
        async (notificationId: string) => {
            const willRead = items.filter((n) => !n.lida && n.notificationId === notificationId).length;

            setItems((prev) =>
                prev.map((n) =>
                    n.notificationId === notificationId ? { ...n, lida: true, readAt: new Date().toISOString() } : n
                )
            );

            setCountUnread((c) => Math.max(0, c - willRead));

            try {
                await axios.post(`${API_URL}/notificacoes/${notificationId}/read`, {}, { withCredentials: true });
            } catch {
                fetchUnreadCount();
                fetchNotifications({ reset: true, take: 50 });
            }
        },
        [API_URL, fetchNotifications, fetchUnreadCount, items]
    );

    /**
     * ✅ Marca como lidas todas as notificações carregadas (usado ao FECHAR o popover)
     */
    const markVisibleRead = useCallback(async () => {
        const unread = items.filter((n) => !n.lida);
        if (unread.length === 0) return;

        const nowIso = new Date().toISOString();

        // otimista: marca no front
        setItems((prev) => prev.map((n) => (n.lida ? n : { ...n, lida: true, readAt: nowIso })));
        setCountUnread((c) => Math.max(0, c - unread.length));

        try {
            await Promise.all(
                Array.from(new Set(unread.map((n) => n.notificationId))).map((notificationId) =>
                    axios.post(`${API_URL}/notificacoes/${notificationId}/read`, {}, { withCredentials: true })
                )
            );

            // ✅ resync
            await Promise.resolve(fetchNotifications({ reset: true, take: 50, unreadOnly: true }));
            await Promise.resolve(fetchUnreadCount());
        } catch {
            // ✅ volta a ficar consistente com o back
            await Promise.resolve(fetchNotifications({ reset: true, take: 50, unreadOnly: true }));
            await Promise.resolve(fetchUnreadCount());
        }
    }, [API_URL, fetchNotifications, fetchUnreadCount, items]);


    // polling leve do badge
    useEffect(() => {
        fetchUnreadCount();

        const id = window.setInterval(() => {
            fetchUnreadCount();
        }, 30_000);

        const onVis = () => {
            if (document.visibilityState === "visible") fetchUnreadCount();
        };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            window.clearInterval(id);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [fetchUnreadCount]);

    // =========================
    // SSE: tempo real
    // =========================
    const scheduleRefreshFromSse = useCallback(
        (reason: "notification" | "reconnected") => {
            if (refreshDebounceRef.current) return;

            refreshDebounceRef.current = window.setTimeout(async () => {
                refreshDebounceRef.current = null;

                fetchUnreadCount();

                if (items.length > 0 || reason === "reconnected") {
                    fetchNotifications({ reset: true, take: 50, unreadOnly: true });
                }
            }, 350);
        },
        [fetchNotifications, fetchUnreadCount, items.length]
    );

    const cleanupEventSource = useCallback(() => {
        if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (esRef.current) {
            try {
                esRef.current.close();
            } catch { }
            esRef.current = null;
        }
    }, []);

    const connectEventSource = useCallback(() => {
        cleanupEventSource();

        const url = `${API_URL}/notificacoes/stream`;
        const es = new EventSource(url, { withCredentials: true });

        esRef.current = es;

        es.onopen = () => {
            reconnectAttemptRef.current = 0;
            scheduleRefreshFromSse("reconnected");
        };

        es.addEventListener("notification", (ev) => {
            try {
                JSON.parse((ev as MessageEvent).data || "{}") as SseNotificationEvent;
                scheduleRefreshFromSse("notification");
            } catch {
                // ignore
            }
        });

        es.addEventListener("ping", () => { });

        es.onerror = () => {
            cleanupEventSource();

            const attempt = (reconnectAttemptRef.current = reconnectAttemptRef.current + 1);
            const backoffMs = Math.min(30_000, 800 * Math.pow(2, attempt));
            reconnectTimerRef.current = window.setTimeout(() => {
                connectEventSource();
            }, backoffMs);
        };
    }, [API_URL, cleanupEventSource, scheduleRefreshFromSse]);

    useEffect(() => {
        connectEventSource();

        return () => {
            if (refreshDebounceRef.current) {
                window.clearTimeout(refreshDebounceRef.current);
                refreshDebounceRef.current = null;
            }
            cleanupEventSource();
        };
    }, [connectEventSource, cleanupEventSource]);

    return {
        loading,
        countUnread,

        items,
        hasMore,
        nextCursor,

        fetchNotifications,
        fetchUnreadCount,

        markAsRead,
        markVisibleRead,
    };
}
