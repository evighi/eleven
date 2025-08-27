import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      // R2/Cloudflare (já estavam)
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.cloudflarestorage.com" },
      // DEV: uploads servidos pelo backend local
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
