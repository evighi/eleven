// src/utils/urls.ts (crie este arquivo)
export const API_URL = (process.env.NEXT_PUBLIC_URL_API || "/api").replace(/\/+$/, "");
export const R2_PUBLIC = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "").replace(/\/+$/, "");

export const toAbsolute = (url?: string) => {
  if (!url) return "/icons/quadra.png";            // fallback que existe no /public/icons
  if (/^https?:\/\//i.test(url)) return url;       // já é absoluta

  const path = url.startsWith("/") ? url : `/${url}`;

  // qualquer coisa em /uploads/... vai direto ao R2 público (se configurado)
  if (path.startsWith("/uploads/") && R2_PUBLIC) {
    const key = path.replace(/^\/+/, "");          // mantém "uploads/quadras/..."
    // Se seus objetos no R2 NÃO têm o prefixo "uploads/", use:
    // const key = path.replace(/^\/+/, "").replace(/^uploads\//, ""); // "quadras/..."
    return `${R2_PUBLIC}/${key}`;
  }

  // senão, proxia via API (ex.: /api/…)
  return `${API_URL}${path}`;
};
