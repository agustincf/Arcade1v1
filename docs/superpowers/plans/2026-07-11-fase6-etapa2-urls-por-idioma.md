# Fase 6 · Etapa 2 — URLs por idioma (SEO real) · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que español/hindi/francés tengan URL propia (`/es/…`, `/hi/…`, `/fr/…`) que Google indexa por separado, con hreflang y sitemap correctos; inglés se queda en `/…`. La navegación interna respeta el idioma activo.

**Architecture:** Un **portero** (`middleware.ts`) mapea el prefijo de idioma: rutas `/es|/hi|/fr` se **reescriben** a la ruta sin prefijo seteando headers de request `x-lang` y `x-bare-path` (la URL visible no cambia, se reusan las páginas actuales); rutas sin prefijo se **redirigen** al idioma de la cookie/Accept-Language (o se sirven en inglés). `getLang()` lee `x-lang`. El `<head>` del layout arma canonical + hreflang desde `x-bare-path` (centraliza y corrige los canonical dispersos de hoy). Los links internos pasan por `<LocaleLink>`, que prefija con el idioma activo. El sitemap lista cada ruta × 4 idiomas.

**Tech Stack:** Next.js App Router + middleware (edge), TypeScript, `node --import tsx` para tests.

## Global Constraints

- **Inglés en `/…` (x-default), sin prefijo**: no rompe URLs ni links existentes.
- **Degradación segura**: si un link quedara sin prefijar, el portero lo redirige al idioma de la cookie — nunca "rompe", a lo sumo un salto extra.
- **No tocar el WIP del gas-monitor** (Fase 7 del usuario, sin commitear). `npm run check` sobre todo el árbol puede fallar solo por el formato de ESOS archivos; lo mío se verifica aparte.
- **Flujos on-chain intactos**: la URL del árbitro es absoluta; el prefijo no los afecta.
- **No pushear sin OK.** Commits atómicos convencionales en español.

---

### Task 1: Portero (`middleware.ts`) + `getLang()` header-aware

**Files:**

- Create: `apps/web/middleware.ts`
- Modify: `apps/web/app/lib/serverLang.ts`

**Interfaces:**

- Produces: rutas `/es|/hi|/fr/*` sirven ese idioma (rewrite + `x-lang`); rutas sin prefijo redirigen al idioma de cookie/Accept-Language o sirven inglés; el server ve `x-lang` y `x-bare-path`.

- [ ] **Step 1: Crear el portero**

Crear `apps/web/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

const LOCALES = ["es", "hi", "fr"] as const; // inglés = sin prefijo (x-default)
type Prefixed = (typeof LOCALES)[number];

// Rutas extensionless que NO llevan idioma (el matcher ya excluye las que tienen
// extensión: .js, .css, sitemap.xml, robots.txt, llms.txt, manifest.webmanifest…).
const SKIP = new Set(["/opengraph-image", "/icon"]);

function detect(req: NextRequest): "en" | Prefixed {
  const cookie = req.cookies.get("arcade.lang")?.value;
  if (cookie && (LOCALES as readonly string[]).includes(cookie)) return cookie as Prefixed;
  const first = (req.headers.get("accept-language") ?? "")
    .split(",")[0]
    ?.trim()
    .slice(0, 2)
    .toLowerCase();
  if (first && (LOCALES as readonly string[]).includes(first)) return first as Prefixed;
  return "en";
}

/** Headers de request que ve el render (getLang lee x-lang; el layout, x-bare-path). */
function pass(req: NextRequest, lang: string, barePath: string) {
  const headers = new Headers(req.headers);
  headers.set("x-lang", lang);
  headers.set("x-bare-path", barePath);
  const url = req.nextUrl.clone();
  url.pathname = barePath; // reescribe a la ruta real (sin prefijo)
  return NextResponse.rewrite(url, { request: { headers } });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (SKIP.has(pathname)) return NextResponse.next();

  const seg = pathname.split("/")[1];
  if ((LOCALES as readonly string[]).includes(seg)) {
    // /es/build -> reescribir a /build con x-lang=es
    const bare = pathname.slice(seg.length + 1) || "/";
    return pass(req, seg, bare);
  }

  // Sin prefijo: inglés por defecto, o redirigir al idioma preferido.
  const lang = detect(req);
  if (lang !== "en") {
    const url = req.nextUrl.clone();
    url.pathname = `/${lang}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url, 307);
  }
  return pass(req, "en", pathname);
}

export const config = {
  // Excluir _next, api y cualquier archivo con extensión (assets, sitemap.xml, etc.)
  matcher: ["/((?!_next/|api/|.*\\.[\\w]+$).*)"],
};
```

- [ ] **Step 2: `getLang()` lee `x-lang` primero**

En `apps/web/app/lib/serverLang.ts`, al principio de `getLang()`, antes del cookie:

```ts
export async function getLang(): Promise<Lang> {
  const h = await headers();
  const fromMiddleware = h.get("x-lang");
  if (isLang(fromMiddleware)) return fromMiddleware;

  const cookieLang = (await cookies()).get("arcade.lang")?.value;
  if (isLang(cookieLang)) return cookieLang;

  const accept = h.get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (isLang(first)) return first;

  return "en";
}
```

(Reusa el `headers()` ya importado; queda una sola llamada.)

- [ ] **Step 3: Verificar el ruteo (build + curl)**

Run: `cd apps/web && npm run build && npm run start -- -p 3520 &` (o `next dev`), esperar, y:

```bash
curl -s http://localhost:3520/build | grep -oE '<html[^>]*lang="[a-z]{2}"'          # en
curl -s http://localhost:3520/es/build | grep -oE '<html[^>]*lang="[a-z]{2}"'        # es
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "Accept-Language: es" http://localhost:3520/build  # 307 -> /es/build
curl -s http://localhost:3520/es/build | grep -oiE "Estilo de juego|Elegí" | head -1 # español
```

Expected: `/build` → `lang="en"`; `/es/build` → `lang="es"` + texto español; `/build` con Accept-Language es → 307 a `/es/build`. Matar el server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts apps/web/app/lib/serverLang.ts
git commit -m "feat(web): ruteo por idioma (portero /es,/hi,/fr; inglés en /)"
```

---

### Task 2: Navegación con idioma (`localePath` + `LocaleLink` + barrido de links)

**Files:**

- Create: `apps/web/app/lib/localePath.ts`
- Create: `apps/web/app/components/LocaleLink.tsx`
- Modify: `apps/web/app/lib/i18n.tsx` (`setLang` navega)
- Modify: los 15 archivos con `next/link` (swap del import) + los `router.push` internos

**Interfaces:**

- Produces: `localePath(lang, path)`; `<LocaleLink>` (drop-in de `next/link` que prefija); `useLocalePath()`.

- [ ] **Step 1: Helper `localePath`**

Crear `apps/web/app/lib/localePath.ts`:

```ts
import type { Lang } from "./i18n-dict";

const PREFIXED = new Set(["es", "hi", "fr"]);

/** Prefija un path interno con el idioma activo (inglés = sin prefijo). Deja
 *  intactos los externos, anclas y mailto. Idempotente si ya viene prefijado. */
export function localePath(lang: Lang, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path; // externo/protocolo
  if (!PREFIXED.has(lang)) return stripLocale(path); // inglés: sin prefijo
  const bare = stripLocale(path);
  return `/${lang}${bare === "/" ? "" : bare}`;
}

/** Quita el prefijo de idioma si lo tuviera (para re-prefijar al cambiar). */
export function stripLocale(path: string): string {
  const seg = path.split("/")[1];
  if (PREFIXED.has(seg)) return path.slice(seg.length + 1) || "/";
  return path;
}
```

- [ ] **Step 2: `<LocaleLink>` (drop-in) + `useLocalePath`**

Crear `apps/web/app/components/LocaleLink.tsx`:

```tsx
"use client";

import Link from "next/link";
import { type ComponentProps } from "react";
import { useT } from "@/app/lib/i18n";
import { localePath } from "@/app/lib/localePath";

/** Igual que next/link pero prefija los href internos con el idioma activo.
 *  Swap directo: `import { LocaleLink as Link } from "@/app/components/LocaleLink"`. */
export function LocaleLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const { lang } = useT();
  const h = typeof href === "string" ? localePath(lang, href) : href;
  return <Link href={h} {...rest} />;
}

/** Para router.push imperativo: `const lp = useLocalePath(); router.push(lp("/x"))`. */
export function useLocalePath() {
  const { lang } = useT();
  return (path: string) => localePath(lang, path);
}
```

- [ ] **Step 3: `setLang` navega a la URL del idioma**

En `apps/web/app/lib/i18n.tsx`, importar `usePathname` y `localePath`/`stripLocale`, y cambiar `setLang` para navegar en vez de solo refrescar:

```tsx
import { useRouter, usePathname } from "next/navigation";
import { localePath } from "./localePath";
```

```tsx
const router = useRouter();
const pathname = usePathname();
```

```tsx
function setLang(l: Lang) {
  localStorage.setItem("arcade.lang", l);
  document.cookie = `arcade.lang=${l}; path=/; max-age=31536000; samesite=lax`;
  router.push(localePath(l, pathname)); // navega a la versión del path en ese idioma
}
```

(El `router.refresh()` de la Etapa 1 se reemplaza por esta navegación. El `useEffect` que honra localStorage queda igual.)

- [ ] **Step 4: Barrido — swap del import en los 15 archivos con `next/link`**

En cada uno, cambiar `import Link from "next/link";` por
`import { LocaleLink as Link } from "@/app/components/LocaleLink";`
(el JSX `<Link …>` no cambia). Archivos:

`page.tsx`, `leaderboard/page.tsx`, `agents/page.tsx`, `agents/start/page.tsx`, `game/[gameId]/TableClient.tsx`, `game/[gameId]/match/page.tsx`, `components/SiteFooter.tsx`, `components/BetQuickPlay.tsx`, `components/Header.tsx`, `watch/page.tsx`, `faucet/FaucetClient.tsx`, `watch/[matchId]/page.tsx`, `build/page.tsx`, `my-agents/page.tsx`, `my-agents/[agentId]/page.tsx`.

Nota: los que sean Server Components (no-`"use client"`) NO pueden usar `LocaleLink` (usa contexto). Verificar: si alguno de esos 15 es server (p. ej. `agents/page.tsx`, `agents/start/page.tsx`), dejar su `next/link` y prefijar su href con el `lang` que ya resuelven por `getLang()` (`href={localePath(lang, "/x")}`). Los client (la mayoría) usan `LocaleLink`.

- [ ] **Step 5: Barrido — `router.push` internos con `useLocalePath`**

En los archivos con `router.push("/…")` interno, agregar `const lp = useLocalePath();` y envolver: `router.push(lp("/x"))`. (Los `router.push` con querystring como `` `/game/${id}/match?bet=…` `` también: `lp(\`/game/${id}/match?bet=…\`)`.)

- [ ] **Step 6: Typecheck + verificación de navegación**

Run: `npm run typecheck:web`
Expected: PASS.

Levantar dev y, en el navegador, entrar a `/es`, navegar por el Header/Footer y un par de páginas: la URL se mantiene en `/es/…` (sin saltos de redirect). Cambiar idioma con el selector: navega a la versión del path actual en el nuevo idioma.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/lib/localePath.ts apps/web/app/components/LocaleLink.tsx apps/web/app/lib/i18n.tsx apps/web/app/**/*.tsx
git commit -m "feat(web): navegación interna con prefijo de idioma (LocaleLink + selector navega)"
```

---

### Task 3: SEO — hreflang + canonical centralizados + sitemap por idioma

**Files:**

- Create: `apps/web/app/components/SeoAlternates.tsx`
- Modify: `apps/web/app/layout.tsx` (render en `<head>`; quitar `canonical` del metadata)
- Modify: `apps/web/app/terms/page.tsx`, `agents/page.tsx`, `agents/start/page.tsx`, `game/[gameId]/page.tsx`, `build/layout.tsx` (quitar sus `alternates.canonical`)
- Modify: `apps/web/app/sitemap.ts`

**Interfaces:**

- Produces: cada página emite `<link rel="canonical">` a SÍ misma (por idioma) y `<link rel="alternate" hreflang>` para en/es/hi/fr + x-default. El sitemap lista cada ruta × 4 idiomas.

- [ ] **Step 1: Componente server de canonical + hreflang**

Crear `apps/web/app/components/SeoAlternates.tsx`:

```tsx
import { headers } from "next/headers";
import { SITE } from "@/app/lib/seo";
import { LANGS } from "@/app/lib/i18n-dict";
import { localePath, stripLocale } from "@/app/lib/localePath";

/** Emite canonical (a la propia URL por idioma) + hreflang de los 4 idiomas y
 *  x-default (inglés). Centraliza lo que antes hacían canonicals dispersos. */
export async function SeoAlternates() {
  const h = await headers();
  const bare = stripLocale(h.get("x-bare-path") ?? "/");
  const abs = (p: string) => `${SITE.url}${p === "/" ? "" : p}`;
  const self = abs(localePath((h.get("x-lang") as (typeof LANGS)[number]) ?? "en", bare));
  return (
    <>
      <link rel="canonical" href={self} />
      <link rel="alternate" hrefLang="x-default" href={abs(bare)} />
      {LANGS.map((l) => (
        <link key={l} rel="alternate" hrefLang={l} href={abs(localePath(l, bare))} />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Render en el layout + quitar el canonical del metadata**

En `apps/web/app/layout.tsx`: importar y renderizar `<SeoAlternates />` dentro de `<head>` (junto a `<StructuredData />`), y **quitar** `alternates: { canonical: "/" }` del objeto `metadata`.

```tsx
import { SeoAlternates } from "@/app/components/SeoAlternates";
```

```tsx
        <StructuredData />
        <SeoAlternates />
```

- [ ] **Step 3: Quitar los canonical dispersos**

Borrar la línea `alternates: { canonical: … }` de: `terms/page.tsx`, `agents/page.tsx`, `agents/start/page.tsx`, `game/[gameId]/page.tsx` (dentro de su `generateMetadata`), y `build/layout.tsx`. (El canonical ahora sale de `SeoAlternates`, uno solo y correcto por idioma.)

- [ ] **Step 4: Sitemap por idioma**

Reescribir `apps/web/app/sitemap.ts` para emitir cada ruta en los 4 idiomas con `alternates.languages`:

```ts
import type { MetadataRoute } from "next";
import { SITE } from "@/app/lib/seo";
import { GAMES } from "@/app/lib/games";
import { LANGS } from "@/app/lib/i18n-dict";
import { localePath } from "@/app/lib/localePath";

const ROUTES: {
  path: string;
  priority: number;
  freq: MetadataRoute.Sitemap[number]["changeFrequency"];
}[] = [
  { path: "/", priority: 1, freq: "daily" },
  { path: "/build", priority: 0.9, freq: "weekly" },
  { path: "/agents", priority: 0.9, freq: "weekly" },
  { path: "/leaderboard", priority: 0.7, freq: "daily" },
  { path: "/agents/start", priority: 0.7, freq: "weekly" },
  { path: "/watch", priority: 0.6, freq: "daily" },
  { path: "/terms", priority: 0.3, freq: "monthly" },
  { path: "/recover", priority: 0.2, freq: "monthly" },
  ...GAMES.filter((g) => g.status === "live").map((g) => ({
    path: `/game/${g.id}`,
    priority: 0.8,
    freq: "weekly" as const,
  })),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const abs = (p: string) => `${SITE.url}${p === "/" ? "" : p}`;
  return ROUTES.map(({ path, priority, freq }) => ({
    url: abs(path), // inglés (x-default)
    lastModified: now,
    changeFrequency: freq,
    priority,
    alternates: {
      languages: Object.fromEntries(LANGS.map((l) => [l, abs(localePath(l, path))])),
    },
  }));
}
```

- [ ] **Step 5: Verificar SEO (build + curl)**

Run: `cd apps/web && npm run build && npm run start -- -p 3521 &`, esperar, y:

```bash
curl -s http://localhost:3521/build | grep -oE '<link rel="(canonical|alternate)"[^>]*>'
curl -s http://localhost:3521/es/build | grep -oE '<link rel="canonical" href="[^"]*"'   # -> /es/build
curl -s http://localhost:3521/leaderboard | grep -oE '<link rel="canonical" href="[^"]*"' # -> /leaderboard (bug viejo corregido)
curl -s http://localhost:3521/sitemap.xml | grep -c "xhtml:link\|/es/"
```

Expected: `/build` canonical `…/build` + 5 hreflang (x-default+4); `/es/build` canonical `…/es/build`; `/leaderboard` canonical `…/leaderboard`; el sitemap con las variantes por idioma. Matar el server.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/SeoAlternates.tsx apps/web/app/layout.tsx apps/web/app/sitemap.ts apps/web/app/terms/page.tsx apps/web/app/agents/page.tsx apps/web/app/agents/start/page.tsx "apps/web/app/game/[gameId]/page.tsx" apps/web/app/build/layout.tsx
git commit -m "feat(web): hreflang + canonical por idioma centralizados + sitemap ×4"
```

---

### Task 4: Chequeo, verificación real, changelog 3.0.0

**Files:**

- Modify: `CHANGELOG.md`; `docs/superpowers/v3/PLAN.md` (cerrar Fase 6)

- [ ] **Step 1: Chequeo de lo mío (el árbol tiene el WIP del gas-monitor)**

Run: `npm run typecheck && npm run lint && npm test` y `npm run format:check -- apps/web` (acotado a la web, para no chocar con el formato del gas-monitor ajeno).
Expected: verde en todo lo mío. (El `format:check` global fallará solo por `apps/server/src/gas-monitor.ts` del usuario — se anota, no se toca.)

- [ ] **Step 2: Verificación real de punta a punta**

Levantar dev y recorrer en el navegador: `/` inglés; cambiar a español → `/es/…`, navegar sin saltos; entrar directo a `/hi/build` → hindi; `curl` de `/build` y `/es/build` (idioma + canonical + hreflang); `curl /sitemap.xml` (variantes). Confirmar que un flujo on-chain (p. ej. abrir `/es/build`, armar, y que el deploy pegue al árbitro) sigue andando.

- [ ] **Step 3: Changelog 3.0.0 + cerrar Fase 6**

Como la Fase 6 completa el milestone v3, se publica como **3.0.0**. En `CHANGELOG.md`, arriba de `## [2.7.0]`:

```markdown
## [3.0.0] — 2026-07-11

Cierre de la v3 ("Solidez y puertas abiertas"), Fase 6 Etapa 2: cada idioma tiene
su propia dirección.

### Añadido

- **URLs por idioma**: español en `arcade1v1.com/es/…`, hindi en `/hi/…`, francés
  en `/fr/…` (inglés se queda en `/…`). Google puede indexar cada idioma por
  separado. Cada página declara sus versiones en otros idiomas (hreflang) y el
  sitemap las lista todas.

### Arreglado

- El `canonical` de varias páginas apuntaba a la home; ahora cada página (y cada
  idioma) apunta a sí misma.
```

Y marcar la Fase 6 en `docs/superpowers/v3/PLAN.md` → Estado: `[x] Fase 6 … (3.0.0, 2026-07-11)`.

- [ ] **Step 4: Commit + gate de publicación**

```bash
git add CHANGELOG.md docs/superpowers/v3/PLAN.md
git commit -m "docs: changelog 3.0.0 + cierre Fase 6 (URLs por idioma)"
```

Mostrar al usuario, en simple, qué cambió; pedir OK antes de `git push`. Tras verificar en producción, actualizar la memoria.

---

## Self-Review

**Cobertura del spec (Etapa 2):**

- Portero rewrite/redirect con `x-lang` → Task 1. ✓
- `getLang()` header-aware → Task 1. ✓
- Links con idioma (`localePath`/`LocaleLink`) + selector navega → Task 2. ✓
- hreflang + canonical por idioma → Task 3. ✓
- Sitemap × locales → Task 3. ✓
- Inglés en `/`, x-default → portero + SeoAlternates. ✓
- Medición por curl (idioma, canonical, hreflang, sitemap) → Tasks 1/3. ✓

**Placeholders:** ninguno. Los barridos (import swap ×15, `router.push` ×11) son mecánicos y enumerados; los server-components entre los 15 se detectan en Task 2 Step 4 (usan `localePath(lang, …)` en vez de `LocaleLink`).

**Consistencia:** `x-lang`/`x-bare-path` los setea el portero (Task 1) y los leen `getLang` (Task 1) y `SeoAlternates` (Task 3). `localePath(lang, path)` lo usan `LocaleLink`, `setLang`, `SeoAlternates` y el sitemap con la misma firma. `stripLocale` idempotente para no doble-prefijar.
