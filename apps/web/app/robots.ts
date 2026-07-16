import type { MetadataRoute } from "next";
import { SITE } from "@/app/lib/seo";

// Permitimos a TODOS los crawlers (incluidos los de IA: GPTBot, ClaudeBot,
// PerplexityBot, Google-Extended, etc.) para maximizar la descubribilidad.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE.url}/sitemap.xml`,
    // Sin `host`: Google la ignora y la variante con protocolo es inválida para
    // los crawlers que sí la leen (Yandex espera solo el hostname). El canonical
    // ya fija el dominio; el host acá no aportaba nada.
  };
}
