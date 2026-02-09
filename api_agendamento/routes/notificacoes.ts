import { Router } from "express";
import { PrismaClient, TipoUsuario } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";
import { notificationHub } from "../utils/notificationHub";

const prisma = new PrismaClient();
const router = Router();

/** =========================
 * Helpers
========================= */
function isAdminRole(t?: string) {
    return ["ADMIN_MASTER"].includes(t || "");
}

function getAuth(req: any) {
    // mesmo padrão do teu agendamentos.ts
    const u = req?.usuario;
    return {
        userId: u?.usuarioLogadoId as string | undefined,
        tipo: u?.usuarioLogadoTipo as TipoUsuario | string | undefined,
    };
}

/** =========================
 * Middlewares
========================= */
router.use(verificarToken);
router.use((req, res, next) => {
    const { userId, tipo } = getAuth(req);
    if (!userId) return res.status(401).json({ erro: "Não autenticado" });
    if (!isAdminRole(tipo)) return res.status(403).json({ erro: "Acesso negado" });
    next();
});

/** =========================
 * Schemas
========================= */
const listQuerySchema = z.object({
    take: z.coerce.number().min(1).max(50).optional().default(20),
    cursor: z.string().uuid().optional(), // cursor = NotificationRecipient.id
    unreadOnly: z.coerce.boolean().optional().default(false),
});

/** =========================
 * GET /notificacoes
 * Lista notificações do usuário logado
 * Suporta cursor pagination:
 *   /notificacoes?take=20&cursor=<recipientId>
========================= */
router.get("/", async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });

    const { userId } = getAuth(req);
    const { take, cursor, unreadOnly } = parsed.data;

    try {
        const where: any = {
            userId,
            ...(unreadOnly ? { readAt: null } : {}),
        };

        const rows = await prisma.notificationRecipient.findMany({
            where,
            take: take + 1, // pega 1 a mais pra saber se tem próxima página
            ...(cursor
                ? {
                    cursor: { id: cursor },
                    skip: 1,
                }
                : {}),
            orderBy: { id: "desc" }, // cursor por recipient.id (estável e barato)
            include: {
                notification: {
                    select: {
                        id: true,
                        type: true,
                        title: true,
                        message: true,
                        data: true,
                        createdAt: true,
                        actorId: true,
                        actor: { select: { id: true, nome: true, tipo: true } },
                    },
                },
            },
        });

        const hasMore = rows.length > take;
        const items = hasMore ? rows.slice(0, take) : rows;

        const nextCursor = hasMore ? items[items.length - 1]?.id : null;

        // formato “bonito” pro front: traz readAt e notification junto
        const mapped = items.map((r) => ({
            recipientId: r.id,
            readAt: r.readAt,
            notification: r.notification,
        }));

        return res.json({ items: mapped, nextCursor });
    } catch (e) {
        console.error("GET /notificacoes erro:", e);
        return res.status(500).json({ erro: "Falha ao listar notificações" });
    }
});

/** =========================
 * GET /notificacoes/unread-count
 * Badge do sininho
========================= */
router.get("/unread-count", async (req, res) => {
    const { userId } = getAuth(req);

    try {
        const count = await prisma.notificationRecipient.count({
            where: { userId, readAt: null },
        });
        return res.json({ count });
    } catch (e) {
        console.error("GET /notificacoes/unread-count erro:", e);
        return res.status(500).json({ erro: "Falha ao contar notificações" });
    }
});

/** =========================
 * POST /notificacoes/:notificationId/read
 * Marca 1 notificação como lida (por notificationId)
========================= */
router.post("/:notificationId/read", async (req, res) => {
    const paramsSchema = z.object({ notificationId: z.string().uuid() });
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ erro: parsed.error.format() });

    const { userId } = getAuth(req);
    const { notificationId } = parsed.data;

    try {
        const now = new Date();

        const r = await prisma.notificationRecipient.updateMany({
            where: {
                userId,
                notificationId,
                readAt: null,
            },
            data: { readAt: now },
        });

        // updateMany retorna {count}, isso é OK pro front
        return res.json({ ok: true, updated: r.count });
    } catch (e) {
        console.error("POST /notificacoes/:id/read erro:", e);
        return res.status(500).json({ erro: "Falha ao marcar como lida" });
    }
});

/** =========================
 * POST /notificacoes/read-all
 * Marca todas como lidas
========================= */
router.post("/read-all", async (req, res) => {
    const { userId } = getAuth(req);

    try {
        const now = new Date();
        const r = await prisma.notificationRecipient.updateMany({
            where: { userId, readAt: null },
            data: { readAt: now },
        });

        return res.json({ ok: true, updated: r.count });
    } catch (e) {
        console.error("POST /notificacoes/read-all erro:", e);
        return res.status(500).json({ erro: "Falha ao marcar todas como lidas" });
    }
});

/** =========================
 * GET /notificacoes/stream
 * SSE: envia eventos em tempo real para o admin logado
 * - não consulta DB
 * - depende do cookie (verificarToken) já validar
========================= */
router.get("/stream", async (req, res) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ erro: "Não autenticado" });

    // Headers SSE
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Evita buffering em alguns proxies (nginx)
    res.setHeader("X-Accel-Buffering", "no");

    // Se você usa compressão global, isso ajuda a não quebrar SSE:
    // (e também não deixa a resposta bufferizar)
    // @ts-ignore
    if (res.flushHeaders) res.flushHeaders();

    // registra o client no hub
    const remove = notificationHub.addClient(userId, res);

    // keep-alive (pra não cair em proxy / idle timeout)
    const pingId = setInterval(() => {
        try {
            res.write(`event: ping\n`);
            res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
        } catch {
            // se falhar, o close vai limpar
        }
    }, 25_000);

    // cleanup quando fechar
    req.on("close", () => {
        clearInterval(pingId);
        remove();
        try {
            res.end();
        } catch { }
    });
});


export default router;
