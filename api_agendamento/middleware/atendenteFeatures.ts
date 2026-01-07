import { Request, Response, NextFunction } from "express";
import { PrismaClient, AtendenteFeature } from "@prisma/client";

/**
 * ✅ Prisma singleton (evita abrir várias conexões em dev/hot-reload)
 */
const globalAny = global as any;
const prisma: PrismaClient = globalAny.__prismaAtdFeatures__ ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalAny.__prismaAtdFeatures__ = prisma;

/**
 * ✅ Cache TTL (process-wide) + cache por request (per-request)
 */
let cache: { features: AtendenteFeature[]; fetchedAt: number } | null = null;
let inflight: Promise<AtendenteFeature[]> | null = null;
const TTL_MS = 30_000;

// chave do cache no req (evita bater 20x no mesmo request)
const REQ_CACHE_KEY = "__atendenteFeaturesCache";

async function fetchFeaturesFromDB(): Promise<AtendenteFeature[]> {
  const row = await prisma.permissoesAtendente.findUnique({
    where: { id: 1 },
    select: { features: true },
  });
  return (row?.features ?? []) as AtendenteFeature[];
}

async function getPermissoesAtendente(req?: Request): Promise<AtendenteFeature[]> {
  // 1) cache por request (mais importante quando tu chamar em várias rotas no mesmo request)
  if (req) {
    const cached = (req as any)[REQ_CACHE_KEY] as AtendenteFeature[] | undefined;
    if (cached) return cached;
  }

  const now = Date.now();

  // 2) cache TTL (process-wide)
  if (cache && now - cache.fetchedAt < TTL_MS) {
    if (req) (req as any)[REQ_CACHE_KEY] = cache.features;
    return cache.features;
  }

  // 3) dedupe de chamadas simultâneas (se várias requests estourarem o TTL ao mesmo tempo)
  if (!inflight) {
    inflight = (async () => {
      const features = await fetchFeaturesFromDB();
      cache = { features, fetchedAt: Date.now() };
      inflight = null;
      return features;
    })().catch((err) => {
      inflight = null;
      throw err;
    });
  }

  const features = await inflight;
  if (req) (req as any)[REQ_CACHE_KEY] = features;
  return features;
}

export function clearAtendentePermissionsCache() {
  cache = null;
  inflight = null;
}

/**
 * ✅ Bloqueia SOMENTE se o usuário for ADMIN_ATENDENTE.
 * - ADMIN_MASTER passa sempre
 * - CLIENTE / PROFESSORES seguem o fluxo normal da tua rota (não interfere)
 */
export function requireAtendenteFeature(feature: AtendenteFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).usuario as { usuarioLogadoTipo?: string } | undefined;
    if (!u) return res.status(401).json({ erro: "Não autenticado" });

    const tipo = u.usuarioLogadoTipo;

    if (tipo === "ADMIN_MASTER") return next();
    if (tipo !== "ADMIN_ATENDENTE") return next();

    try {
      const feats = await getPermissoesAtendente(req);
      if (feats.includes(feature)) return next();

      return res.status(403).json({
        erro: "Sem permissão (feature do atendente)",
        feature,
      });
    } catch (e) {
      return res.status(500).json({ erro: "Falha ao validar permissões do atendente" });
    }
  };
}

/**
 * ⛔ Rotas que NUNCA o atendente pode acessar (independente de features)
 */
export function denyAtendente() {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).usuario as { usuarioLogadoTipo?: string } | undefined;
    if (!u) return res.status(401).json({ erro: "Não autenticado" });

    if (u.usuarioLogadoTipo === "ADMIN_ATENDENTE") {
      return res.status(403).json({ erro: "Acesso restrito (somente ADMIN_MASTER)" });
    }
    return next();
  };
}
