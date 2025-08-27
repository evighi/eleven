import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: {
    unoptimized: true, // ⬅️ desliga o /_next/image
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.cloudflarestorage.com" },
      { protocol: "http", hostname: "localhost", port: "3001" },
    ],
  },
  async rewrites() {
    const base = (process.env.RENDER_API_URL || "").replace(/\/$/, "");
    const prefix = process.env.API_BASE_PATH || "";
    return [{ source: "/api/:path*", destination: `${base}${prefix}/:path*` }];
  },
};

export default nextConfig;
