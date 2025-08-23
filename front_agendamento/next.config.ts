import type { NextConfig } from "next";

const backend = process.env.BACKEND_ORIGIN
  ? new URL(process.env.BACKEND_ORIGIN)
  : undefined;

const r2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  ? new URL(process.env.NEXT_PUBLIC_R2_PUBLIC_URL)
  : undefined;

const uploadsPrefix = process.env.NEXT_PUBLIC_UPLOADS_PREFIX || "/uploads";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  images: {
    remotePatterns: [
      ...(r2
        ? [{
            protocol: r2.protocol.replace(":", "") as "http" | "https",
            hostname: r2.hostname,
            port: r2.port || "",
            pathname: "**",
          } as const] : []),
      ...(backend
        ? [{
            protocol: backend.protocol.replace(":", "") as "http" | "https",
            hostname: backend.hostname,
            port: backend.port || "",
            pathname: `${uploadsPrefix.replace(/\/+$/, "")}/**`,
          } as const] : []),
    ],
  },

  async rewrites() {
    if (!backend) return [];
    // tudo que o front chamar em /api/... será enviado para o backend
    return [{ source: "/api/:path*", destination: `${backend.origin}/:path*` }];
  },
};

export default nextConfig;
