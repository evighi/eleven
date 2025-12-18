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
  onLoadingComplete?: (img: HTMLImageElement) => void;
};

function normalizeR2PublicUrl(u: string) {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    const isR2 =
      host.endsWith(".r2.dev") || host.endsWith(".cloudflarestorage.com");
    if (isR2) {
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
  onLoadingComplete,
}: AppImageProps) {
  const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

  const resolvedSrc = useMemo(() => {
    if (!src) return fallbackSrc;

    if (/^data:|^blob:/i.test(src)) return src;

    if (/^https?:\/\//i.test(src)) return normalizeR2PublicUrl(src);

    if (src.startsWith("/")) return src;

    const dir = legacyDir ? `/${legacyDir.replace(/^\/|\/$/g, "")}` : "";
    return `${API_URL}/uploads${dir}/${src}`;
  }, [src, API_URL, legacyDir, fallbackSrc]);

  const [broken, setBroken] = useState(false);

  const needsBypass = useMemo(() => {
    try {
      const u = new URL(resolvedSrc);
      const host = u.hostname.toLowerCase();
      const isR2 =
        host.endsWith(".r2.dev") || host.endsWith(".cloudflarestorage.com");
      return u.protocol === "http:" || !isR2;
    } catch {
      return false;
    }
  }, [resolvedSrc]);

  const passthroughLoader = ({ src }: ImageLoaderProps) => src;

  const handleLoadingComplete = (img: HTMLImageElement) => {
    const isFallbackNow = broken || resolvedSrc === fallbackSrc;

    // se ainda estamos no fallback "normal" (sem erro), não sinaliza como carregado
    if (!isFallbackNow && onLoadingComplete) {
      onLoadingComplete(img);
    }

    // se deu erro e caiu no fallback, a gente considera carregado
    if (isFallbackNow && broken && onLoadingComplete) {
      onLoadingComplete(img);
    }
  };

  return (
    <Image
      src={broken ? fallbackSrc : resolvedSrc}
      alt={alt}
      {...(fill
        ? { fill: true }
        : { width: width ?? 160, height: height ?? 160 })}
      className={className}
      sizes={sizes}
      priority={priority}
      onError={() => setBroken(true)}
      onLoadingComplete={handleLoadingComplete}
      {...((needsBypass || forceUnoptimized)
        ? { loader: passthroughLoader, unoptimized: true }
        : {})}
    />
  );
}
