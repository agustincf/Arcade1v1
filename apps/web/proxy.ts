import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Portero (Next 16 "proxy" = middleware). Dos responsabilidades, en orden:
//  1) Geobloqueo configurable (BLOCKED_COUNTRIES) — para cuando se opere con
//     dinero real; si está vacío, no bloquea nada.
//  2) Ruteo por idioma: español/francés viven en /es|/fr; inglés en /
//     (x-default). Los prefijos se reescriben a la ruta real seteando x-lang y
//     x-bare-path (los lee getLang y el <head> del layout); las rutas sin
//     prefijo redirigen al idioma preferido (cookie → Accept-Language) o sirven
//     inglés. /hi (el hindi se quitó el 2026-09-24) redirige para siempre
//     a la misma ruta en inglés, así no se rompen links viejos.
const BLOCKED = (process.env.BLOCKED_COUNTRIES || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const LOCALES = ["es", "fr"] as const; // inglés = sin prefijo
type Prefixed = (typeof LOCALES)[number];

/** Elige el idioma a servir. Pura (cookie + header) para poder testearla: acá
 *  vivía un bug que nadie tenía cómo agarrar. */
export function pickLang(
  cookie: string | undefined,
  acceptLanguage: string | null,
): "en" | Prefixed {
  // El inglés no lleva prefijo, así que NO está en LOCALES — y por eso la cookie
  // "en" no se reconocía: caía al Accept-Language del navegador y devolvía un
  // 307 a /es|/fr. Resultado: desde un navegador en español o francés
  // era IMPOSIBLE dejar la web en inglés; cada link volvía al idioma local.
  // La elección explícita del usuario siempre le gana al header del navegador.
  if (cookie === "en") return "en";
  if (cookie && (LOCALES as readonly string[]).includes(cookie)) return cookie as Prefixed;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (first && (LOCALES as readonly string[]).includes(first)) return first as Prefixed;
  return "en";
}

/** Idiomas que ya no existen: su prefijo redirige (301) a la misma ruta en
 *  inglés. Devuelve la ruta destino, o null si no es un prefijo retirado. */
const RETIRED = ["hi"] as const;
export function retiredLocaleTarget(pathname: string): string | null {
  const seg = pathname.split("/")[1];
  if (!(RETIRED as readonly string[]).includes(seg)) return null;
  return pathname.slice(seg.length + 1) || "/";
}

function detectLang(req: NextRequest): "en" | Prefixed {
  return pickLang(req.cookies.get("arcade.lang")?.value, req.headers.get("accept-language"));
}

/** Reescribe a la ruta real (sin prefijo) seteando los headers que ve el render. */
function serve(req: NextRequest, lang: string, barePath: string) {
  const headers = new Headers(req.headers);
  headers.set("x-lang", lang);
  headers.set("x-bare-path", barePath);
  const url = req.nextUrl.clone();
  url.pathname = barePath;
  return NextResponse.rewrite(url, { request: { headers } });
}

export function proxy(req: NextRequest) {
  // 1) Geobloqueo (prioridad sobre el idioma).
  if (BLOCKED.length > 0) {
    const country = (
      req.headers.get("x-vercel-ip-country") ||
      req.headers.get("cf-ipcountry") ||
      ""
    ).toUpperCase();
    if (country && BLOCKED.includes(country) && !req.nextUrl.pathname.startsWith("/unavailable")) {
      const url = req.nextUrl.clone();
      url.pathname = "/unavailable";
      return NextResponse.rewrite(url);
    }
  }

  // 2) Ruteo por idioma.
  const { pathname } = req.nextUrl;
  const retired = retiredLocaleTarget(pathname);
  if (retired !== null) {
    const url = req.nextUrl.clone();
    url.pathname = retired;
    return NextResponse.redirect(url, 301);
  }
  const seg = pathname.split("/")[1];
  if ((LOCALES as readonly string[]).includes(seg)) {
    const bare = pathname.slice(seg.length + 1) || "/"; // /es/build -> /build
    return serve(req, seg, bare);
  }

  const lang = detectLang(req);
  if (lang !== "en") {
    const url = req.nextUrl.clone();
    url.pathname = `/${lang}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url, 307);
  }
  return serve(req, "en", pathname);
}

// No corre sobre estáticos ni archivos de SEO (robots/sitemap/llms/opengraph/icon
// siempre accesibles y sin prefijo de idioma).
export const config = {
  matcher: [
    "/((?!_next/|favicon|robots.txt|sitemap.xml|llms.txt|manifest|opengraph-image|icon|apple-icon|.*\\.).*)",
  ],
};
