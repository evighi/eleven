import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.cloudflarestorage.com" },
    ],
  },
  async rewrites() {
    const base = (process.env.RENDER_API_URL || "").replace(/\/$/, "");
    const prefix = process.env.API_BASE_PATH || ""; // defina '/api' OU '' nas variáveis da Vercel
    return [
      { source: "/api/:path*", destination: `${base}${prefix}/:path*` },
    ];
  },
};

export default nextConfig;
