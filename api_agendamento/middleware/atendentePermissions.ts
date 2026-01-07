import { Request, Response, NextFunction } from "express";
import { PrismaClient, AtendenteFeature } from "@prisma/client";

const globalAny = global as any;
const prisma: PrismaClient =
    globalAny.__prismaPermAtd__ ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalAny.__prismaPermAtd__ = prisma;

// cache simples (evita bater no DB a cada request)
let cache: { features: Set<AtendenteFeature>; expiresAt: number } | null = null;

async function loadFeaturesFromDb(): Promise<Set<AtendenteFeature>> {
    const row = await prisma.permissoesAtendente.findUnique({
        where: { id: 1 },
        select: { features: true },
    });

    const features = (row?.features ?? []) as AtendenteFeature[];
    return new Set(features);
}

async function getCachedFeatures(): Promise<Set<AtendenteFeature>> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.features;

    const features = await loadFeaturesFromDb();
    cache = { features, expiresAt: now + 30_000 }; // 30s
    return features;
}

export function invalidateAtendenteFeaturesCache() {
    cache = null;
}

type Tipo =
    | "CLIENTE"
    | "CLIENTE_APOIADO"
    | "ADMIN_MASTER"
    | "ADMIN_ATENDENTE"
    | "ADMIN_PROFESSORES";

export function requireMaster(req: Request, res: Response, next: NextFunction) {
    if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });
    const tipo = req.usuario.usuarioLogadoTipo as Tipo;
    if (tipo !== "ADMIN_MASTER") {
        return res.status(403).json({ erro: "Apenas ADMIN_MASTER" });
    }
    return next();
}

/**
 * ✅ Só restringe ADMIN_ATENDENTE.
 * - ADMIN_MASTER sempre passa.
 * - ADMIN_PROFESSORES passa (não é o alvo desse controle).
 * - Cliente passa (a rota deve ter seus próprios checks, como já tem hoje).
 */
export function requireAtendenteFeature(...needed: AtendenteFeature[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.usuario) return res.status(401).json({ erro: "Não autenticado" });

        const tipo = req.usuario.usuarioLogadoTipo as Tipo;

        if (tipo === "ADMIN_MASTER") return next();
        if (tipo !== "ADMIN_ATENDENTE") return next();

        const allowed = await getCachedFeatures();
        const ok = needed.every((f) => allowed.has(f));

        if (!ok) {
            return res.status(403).json({
                erro: "Sem permissão (permissões do atendente)",
                needed,
                allowed: Array.from(allowed),
            });
        }

        return next();
    };
}
