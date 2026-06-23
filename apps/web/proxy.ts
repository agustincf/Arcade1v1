import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Geobloqueo configurable: listar los países restringidos (ISO-3166 alpha-2,
// separados por coma) en BLOCKED_COUNTRIES. Si está vacío, NO bloquea nada.
// El país se lee del header del CDN (Vercel: x-vercel-ip-country / Cloudflare:
// cf-ipcountry). Pensado para activarse cuando se opere con dinero real.
const BLOCKED = (process.env.BLOCKED_COUNTRIES || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

export function proxy(req: NextRequest) {
  if (BLOCKED.length === 0) return NextResponse.next();

  const country = (
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cf-ipcountry") ||
    ""
  ).toUpperCase();

  if (
    country &&
    BLOCKED.includes(country) &&
    !req.nextUrl.pathname.startsWith("/unavailable")
  ) {
    const url = req.nextUrl.clone();
    url.pathname = "/unavailable";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

// No corre sobre estáticos ni archivos de SEO (robots/sitemap/llms siempre
// accesibles para los crawlers).
export const config = {
  matcher: [
    "/((?!_next/|favicon|robots.txt|sitemap.xml|llms.txt|manifest|opengraph-image|icon|apple-icon|.*\\.).*)",
  ],
};
