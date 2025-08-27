"use client";

import Image, { ImageLoaderProps } from "next/image";
import { useMemo, useState } from "react";

type AppImageProps = {
  src?: string | null;
  alt: string;
  /** Use width/height OU fill (nunca os dois) */
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  /** Para arquivos legados (nome do arquivo vindo da API) */
  legacyDir?: string; // ex.: "quadras" | "churrasqueiras"
  fallbackSrc?: string; // default: "/quadra.png"
  sizes?: string;
  priority?: boolean;
  /** Força não otimizar (útil enquanto ajustamos domains) */
  forceUnoptimized?: boolean;
};

export default function AppImage({
  src,
  alt,
  width,
  height,
  fill,
  className,
  legacyDir,
  fallbackSrc = "/quadra.png",
  sizes,
  priority,
  forceUnoptimized,
}: AppImageProps) {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const resolvedSrc = useMemo(() => {
    if (!src) return fallbackSrc;
    if (/^data:|^blob:/i.test(src)) return src;     // data/blob
    if (/^https?:\/\//i.test(src)) return src;      // URL absoluta (R2 etc.)
    if (src.startsWith("/")) return src;            // /public
    // legado: veio só o nome do arquivo
    const dir = legacyDir ? `/${legacyDir.replace(/^\/|\/$/g, "")}` : "";
    return `${API_URL}/uploads${dir}/${src}`;
  }, [src, API_URL, legacyDir, fallbackSrc]);

  const [broken, setBroken] = useState(false);

  // Se for http: ou um host fora dos que já configuramos, bypass da otimização
  const needsBypass = useMemo(() => {
    try {
      const u = new URL(resolvedSrc);
      const host = u.hostname.toLowerCase();
      const isR2 = /\.r2\.dev$/.test(host) || /cloudflarestorage\.com$/.test(host);
      return u.protocol === "http:" || !isR2;
    } catch {
      return false;
    }
  }, [resolvedSrc]);

  const passthroughLoader = ({ src }: ImageLoaderProps) => src;

  return (
    <Image
      src={broken ? fallbackSrc : resolvedSrc}
      alt={alt}
      {...(fill ? { fill: true } : { width: width ?? 160, height: height ?? 160 })}
      className={className}
      sizes={sizes}
      priority={priority}
      onError={() => setBroken(true)}
      {...((needsBypass || forceUnoptimized) ? { loader: passthroughLoader, unoptimized: true } : {})}
    />
  );
}
