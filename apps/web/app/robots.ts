import type { MetadataRoute } from "next";
import { SITE } from "@/app/lib/seo";

// Permitimos a TODOS los crawlers (incluidos los de IA: GPTBot, ClaudeBot,
// PerplexityBot, Google-Extended, etc.) para maximizar la descubribilidad.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
