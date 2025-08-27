// src/components/AppImage.tsx
"use client";

import Image, { ImageLoaderProps } from "next/image";
import { useMemo, useState } from "react";

type AppImageProps = {
  src?: string | null;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  legacyDir?: string;
  fallbackSrc?: string;
  sizes?: string;
  priority?: boolean;
  forceUnoptimized?: boolean;
};

function normalizeR2PublicUrl(u: string) {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    const isR2 =
      host.endsWith(".r2.dev") || host.endsWith(".cloudflarestorage.com");
    if (isR2) {
      // remove o nome do bucket no início do path, se vier
      url.pathname = url.pathname.replace(/^\/eleven-uploads\/?/, "/");
    }
    return url.toString();
  } catch {
    return u;
  }
}

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

    // data/blob → usa como veio
    if (/^data:|^blob:/i.test(src)) return src;

    // absoluta → normaliza R2
    if (/^https?:\/\//i.test(src)) return normalizeR2PublicUrl(src);

    // /public
    if (src.startsWith("/")) return src;

    // legado: só o nome do arquivo → monta URL do backend
    const dir = legacyDir ? `/${legacyDir.replace(/^\/|\/$/g, "")}` : "";
    return `${API_URL}/uploads${dir}/${src}`;
  }, [src, API_URL, legacyDir, fallbackSrc]);

  const [broken, setBroken] = useState(false);

  const needsBypass = useMemo(() => {
    try {
      const u = new URL(resolvedSrc);
      const host = u.hostname.toLowerCase();
      const isR2 = host.endsWith(".r2.dev") || host.endsWith("cloudflarestorage.com");
      return u.protocol === "http:" || !isR2; // força unoptimized para hosts não-R2 ou http
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
