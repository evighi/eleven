import { Router } from "express";
import { PrismaClient, AtendenteFeature } from "@prisma/client";
import { z } from "zod";
import verificarToken from "../middleware/authMiddleware";
import { requireMaster, invalidateAtendenteFeaturesCache } from "../middleware/atendentePermissions";

const globalAny = global as any;
const prisma: PrismaClient =
    globalAny.__prismaPermAtdRoute__ ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalAny.__prismaPermAtdRoute__ = prisma;

const router = Router();

/**
 * ✅ GET /permissoes-atendente
 * Pode ser usado pelo front pra montar o menu.
 * (Qualquer logado lê; mas se quiser, restringe pra admin.)
 */
router.get("/", verificarToken, async (req, res) => {
    const row = await prisma.permissoesAtendente.findUnique({
        where: { id: 1 },
        select: { features: true, updatedAt: true, updatedById: true },
    });

    return res.json({
        id: 1,
        features: row?.features ?? [],
        updatedAt: row?.updatedAt ?? null,
        updatedById: row?.updatedById ?? null,
    });
});

/**
 * ✅ PUT /permissoes-atendente
 * Só ADMIN_MASTER altera.
 */
const putSchema = z.object({
    features: z.array(
        z.enum([
            "ATD_AGENDAMENTOS",
            "ATD_PERMANENTES",
            "ATD_CHURRAS",
            "ATD_BLOQUEIOS",
            "ATD_USUARIOS_LEITURA",
            "ATD_USUARIOS_EDICAO",
            "ATD_RELATORIOS",
        ])
    ),
});

router.put("/", verificarToken, requireMaster, async (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ erro: parsed.error.format() });
    }

    const features = parsed.data.features as AtendenteFeature[];

    const actorId = (req as any).usuario?.usuarioLogadoId ?? null;

    const updated = await prisma.permissoesAtendente.upsert({
        where: { id: 1 },
        create: {
            id: 1,
            features,
            updatedById: actorId,
        },
        update: {
            features,
            updatedById: actorId,
        },
        select: { id: true, features: true, updatedAt: true, updatedById: true },
    });

    invalidateAtendenteFeaturesCache();

    return res.json(updated);
});

export default router;
