# Fase 6 · Etapa 1 — Aligerar (mandar solo el idioma activo) · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el bundle del cliente deje de incluir los 4 idiomas: el servidor resuelve el idioma activo (ya lo hace vía `getLang()`), carga solo ESE diccionario y lo pasa por prop al provider; el cliente renderiza con él, sin datos de idioma en su JS.

**Architecture:** Los datos de cada idioma se parten a `app/lib/i18n/{en,es,hi,fr}.ts`. Un módulo **solo-servidor** `dicts.server.ts` los junta y expone `getDict(lang)`. `i18n-dict.ts` queda con lo compartido y una `translate(dict, key, vars)` **pura** (sin importar datos). El `layout` (server) hace `getDict(getLang())` y pasa `dict` al provider cliente, que ya no importa el diccionario. Cambiar idioma setea la cookie y hace `router.refresh()` — el servidor re-renderiza con el nuevo idioma y manda su diccionario.

**Tech Stack:** Next.js App Router (RSC), TypeScript, Node test runner (`node --import tsx`), `server-only`.

## Global Constraints

- **La interfaz de `useT()` no cambia** (`{ t, lang, setLang }`): ningún consumidor cliente se toca.
- **`translate` sólo lo usa el provider cliente** (verificado); ningún Server Component usa el diccionario grande (usan sus mapas `*_CONTENT`).
- **Los 4 idiomas están completos hoy** (355 claves c/u); un test lo vuelve invariante.
- **Sin datos de idioma en el bundle del cliente**: `i18n-dict.ts` no debe importar los archivos de datos; `dicts.server.ts` es `import "server-only"`.
- **No pushear sin OK explícito del usuario.** Commits atómicos convencionales en español.

---

### Task 1: Partir los diccionarios y adelgazar `i18n-dict.ts` (refactor atómico)

**Files:**

- Create: `apps/web/app/lib/i18n/en.ts`, `es.ts`, `hi.ts`, `fr.ts`
- Create: `apps/web/app/lib/i18n/dicts.server.ts`
- Modify: `apps/web/app/lib/i18n-dict.ts` (quitar datos + `DICT`; `translate(dict, …)`)
- Modify: `apps/web/app/lib/i18n.tsx` (provider recibe `dict`; `setLang`→refresh)
- Modify: `apps/web/app/providers.tsx` (pasar `lang`+`dict`)
- Modify: `apps/web/app/layout.tsx` (`getDict(lang)` y pasar `dict`)

**Interfaces:**

- Consumes: `getLang()` (ya existe), `Lang`/`Dict` de `i18n-dict`.
- Produces:
  - `app/lib/i18n/<lang>.ts` exporta `export const <lang>: Dict`.
  - `dicts.server.ts` exporta `getDict(lang: Lang): Dict` (solo-servidor).
  - `i18n-dict.ts` exporta `translate(dict: Dict, key: string, vars?): string` (puro), `Lang`, `LANGS`, `LANG_LABELS`, `Dict`.
  - `I18nProvider` pasa a props `{ lang: Lang; dict: Dict; children }`.

- [ ] **Step 1: Medir el estado ANTES (baseline del bundle)**

Con el build ya presente (`apps/web/.next`), confirmar que hoy los diccionarios SÍ están en el JS del cliente (una cadena devanagari sólo puede venir del diccionario):

```bash
grep -rl $'खेल' apps/web/.next/static/chunks 2>/dev/null | head
```

Expected: al menos un chunk lo contiene (baseline "antes": los idiomas viajan al cliente). Anotar el resultado.

- [ ] **Step 2: Partir los datos con un script determinista**

Los bloques de datos son ~1400 líneas: se mueven con un script (menos error que a mano). Crear y correr `apps/web/_split-i18n.mjs`:

```js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const src = readFileSync("apps/web/app/lib/i18n-dict.ts", "utf8");
const lines = src.split("\n");
mkdirSync("apps/web/app/lib/i18n", { recursive: true });
for (const lang of ["en", "es", "hi", "fr"]) {
  const start = lines.findIndex((l) => l.startsWith(`const ${lang}: Dict = {`));
  if (start < 0) throw new Error(`no encontré el bloque ${lang}`);
  let end = start;
  while (!lines[end].startsWith("};")) end++;
  const body = lines.slice(start + 1, end).join("\n");
  const out = `import type { Dict } from "../i18n-dict";\n\nexport const ${lang}: Dict = {\n${body}\n};\n`;
  writeFileSync(`apps/web/app/lib/i18n/${lang}.ts`, out);
  console.log(`${lang}.ts: ${body.split("\n").length} líneas`);
}
```

Run: `node apps/web/_split-i18n.mjs && rm apps/web/_split-i18n.mjs`
Expected: crea `en.ts`/`es.ts`/`hi.ts`/`fr.ts`, ~420/425/415/430 líneas.

- [ ] **Step 3: Crear el loader solo-servidor**

Crear `apps/web/app/lib/i18n/dicts.server.ts`:

```ts
import "server-only";
import type { Dict, Lang } from "../i18n-dict";
import { en } from "./en";
import { es } from "./es";
import { hi } from "./hi";
import { fr } from "./fr";

// Los 4 diccionarios viven acá, SOLO en el servidor. El cliente recibe el del
// idioma activo por prop (no importa este módulo), así su bundle no los trae.
const DICTS: Record<Lang, Dict> = { en, es, hi, fr };

export function getDict(lang: Lang): Dict {
  return DICTS[lang];
}
```

- [ ] **Step 4: Adelgazar `i18n-dict.ts` (quitar datos + `DICT`, `translate` puro)**

Reemplazar TODO el contenido de `apps/web/app/lib/i18n-dict.ts` por:

```ts
// Contrato de idiomas + traducción pura. Los DATOS de cada idioma viven en
// ./i18n/<lang>.ts y los junta el servidor en dicts.server.ts. El cliente recibe
// solo el diccionario activo por prop, así su bundle no arrastra los 4 idiomas.

export const LANGS = ["en", "es", "hi", "fr"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
  en: "EN",
  es: "ES",
  hi: "हि",
  fr: "FR",
};

export type Dict = Record<string, string>;

/** Traducción pura: toma el diccionario del idioma activo y una clave. Devuelve
 *  la clave cruda si no existe (los 4 idiomas se mantienen completos por test).
 *  Interpola {vars}. */
export function translate(dict: Dict, key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
    }
  }
  return s;
}
```

- [ ] **Step 5: Rewire del provider cliente `i18n.tsx`**

Reemplazar TODO el contenido de `apps/web/app/lib/i18n.tsx` por:

```tsx
"use client";

// Provider de idioma. El diccionario del idioma ACTIVO llega por prop desde el
// servidor (layout → Providers); el cliente no importa datos de idioma. Cambiar
// idioma setea la cookie y refresca: el servidor re-renderiza con el nuevo
// idioma y manda su diccionario (sin traer los 4 al cliente).

import { createContext, useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LANGS, type Lang, LANG_LABELS, type Dict, translate } from "./i18n-dict";

export { LANGS, LANG_LABELS };
export type { Lang };

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({
  lang,
  dict,
  children,
}: {
  lang: Lang;
  dict: Dict;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    document.documentElement.lang = lang;
    // Honrar una elección previa si el servidor no la tomó (p. ej. cookie vencida
    // pero localStorage vivo): setear cookie y refrescar. Caso normal: no-op.
    const saved = localStorage.getItem("arcade.lang");
    if (saved && (LANGS as readonly string[]).includes(saved) && saved !== lang) {
      document.cookie = `arcade.lang=${saved}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [lang, router]);

  function setLang(l: Lang) {
    localStorage.setItem("arcade.lang", l);
    document.cookie = `arcade.lang=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    router.refresh(); // el servidor re-renderiza en el nuevo idioma y manda su diccionario
  }

  function t(key: string, vars?: Record<string, string | number>) {
    return translate(dict, key, vars);
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT debe usarse dentro de <I18nProvider>");
  return ctx;
}
```

- [ ] **Step 6: Rewire de `providers.tsx` (pasar `lang` + `dict`)**

En `apps/web/app/providers.tsx`, cambiar la firma y el uso:

```tsx
export function Providers({
  lang,
  dict,
  children,
}: {
  lang: import("@/app/lib/i18n").Lang;
  dict: import("@/app/lib/i18n-dict").Dict;
  children: React.ReactNode;
}) {
```

y la línea del provider:

```tsx
<I18nProvider lang={lang} dict={dict}>
  {children}
</I18nProvider>
```

- [ ] **Step 7: Rewire de `layout.tsx` (cargar y pasar el diccionario activo)**

En `apps/web/app/layout.tsx`, agregar el import:

```tsx
import { getDict } from "@/app/lib/i18n/dicts.server";
```

y en `RootLayout`, resolver el diccionario y pasarlo:

```tsx
const lang = await getLang();
const dict = getDict(lang);
```

```tsx
        <Providers lang={lang} dict={dict}>
```

- [ ] **Step 8: Typecheck + build**

Run: `npm run typecheck:web`
Expected: PASS.

Run: `cd apps/web && npm run build`
Expected: compila todas las rutas sin error.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/lib/i18n apps/web/app/lib/i18n-dict.ts apps/web/app/lib/i18n.tsx apps/web/app/providers.tsx apps/web/app/layout.tsx
git commit -m "refactor(web): servir solo el idioma activo (diccionario por prop, no en el bundle)"
```

---

### Task 2: Tests — completitud de idiomas y `translate` puro

**Files:**

- Create: `apps/web/test/i18n.test.ts`

**Interfaces:**

- Consumes: `en`/`es`/`hi`/`fr` de `../app/lib/i18n/<lang>.js`; `translate` de `../app/lib/i18n-dict.js`.

- [ ] **Step 1: Escribir los tests**

Crear `apps/web/test/i18n.test.ts`:

```ts
// Garantías de i18n: (1) los 4 idiomas exponen EXACTAMENTE las mismas claves
// (ningún idioma sale incompleto — habilita servir solo el activo sin mostrar
// claves crudas); (2) translate es puro (interpola vars; clave cruda si falta).

import { test } from "node:test";
import assert from "node:assert/strict";

import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { hi } from "../app/lib/i18n/hi.js";
import { fr } from "../app/lib/i18n/fr.js";
import { translate } from "../app/lib/i18n-dict.js";

const DICTS = { en, es, hi, fr };

test("los 4 idiomas tienen exactamente las mismas claves", () => {
  const keys = Object.fromEntries(
    Object.entries(DICTS).map(([l, d]) => [l, new Set(Object.keys(d))]),
  );
  const all = new Set(Object.values(keys).flatMap((s) => [...s]));
  for (const [lang, set] of Object.entries(keys)) {
    const missing = [...all].filter((k) => !set.has(k));
    assert.equal(missing.length, 0, `${lang} le faltan ${missing.length}: ${missing.slice(0, 5)}`);
  }
});

test("translate: interpola vars y cae a la clave cruda si no existe", () => {
  assert.equal(translate({ hi: "Hola {name}" }, "hi", { name: "Ada" }), "Hola Ada");
  assert.equal(translate({}, "no.existe"), "no.existe");
  assert.equal(translate({ a: "{n}+{n}" }, "a", { n: 2 }), "2+2");
});
```

- [ ] **Step 2: Correr los tests**

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: PASS (los 355 claves cuadran; translate cumple el contrato).

- [ ] **Step 3: Commit**

```bash
git add apps/web/test/i18n.test.ts
git commit -m "test(web): completitud de los 4 idiomas + translate puro"
```

---

### Task 3: Medir el bundle, verificación real, changelog

**Files:**

- Modify: `CHANGELOG.md` (entrada 2.7.0)

- [ ] **Step 1: Medir el bundle DESPUÉS**

Run: `cd apps/web && npm run build` (si no se corrió recién).
Luego, confirmar que los datos de idioma YA NO están en el JS del cliente:

```bash
grep -rl $'खेल' apps/web/.next/static/chunks 2>/dev/null | head
grep -rl "HOW GOOD IS YOUR AGENT" apps/web/.next/static/chunks 2>/dev/null | head
```

Expected: **sin resultados** en ambos (las cadenas de los diccionarios ya no viven en el JS del cliente; viajan en el payload del render sólo para el idioma activo). Contrastar con el baseline "antes" de la Task 1, Step 1. Anotar el delta de "First Load JS" que reporta el build.

- [ ] **Step 2: Verificación real (levantar la app)**

Levantar `next dev` y comprobar por HTTP:

```bash
# inglés por defecto
curl -s -H "Accept-Language: en" http://localhost:<port>/ | grep -oE '<html[^>]*lang="en"'
# español por Accept-Language
curl -s -H "Accept-Language: es" http://localhost:<port>/ | grep -oiE "PROBAR GRATIS|Elegí"
```

Expected: `/` con `en` en inglés; con `Accept-Language: es`, HTML en español (el primer render sigue traducido). En el navegador: cambiar idioma con el selector → la página queda en el nuevo idioma (vía `router.refresh()`), y la wallet/estado no se pierde. Recorrer 2-3 páginas (home, build, leaderboard) en un idioma no-inglés y confirmar que todo está traducido.

- [ ] **Step 3: Changelog 2.7.0**

En `CHANGELOG.md`, arriba de `## [2.6.0]`, agregar (formato Keep a Changelog, en español):

```markdown
## [2.7.0] — 2026-07-11

Sexta fase de la v3 ("Solidez y puertas abiertas"), Etapa 1: el sitio manda solo
tu idioma, no los cuatro.

### Cambiado

- El navegador ya **no descarga los 4 idiomas**: el servidor resuelve tu idioma y
  manda solo ese diccionario. Menos peso por visita, sin cambiar nada de lo que
  ves. (El primer render ya llegaba traducido; eso se mantiene.)

### Interno

- Diccionario partido en un archivo por idioma; `translate` puro; test que
  garantiza que los 4 idiomas quedan completos.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog 2.7.0 (i18n etapa 1 — aligerar)"
```

- [ ] **Step 5: `npm run check` completo + gate de publicación**

Run: `npm run check`
Expected: verde (tipos + lint + prettier + tests + selftest). Correr `npm run format` si prettier marca los archivos nuevos.

Mostrar al usuario, en simple, qué cambió y el delta de peso; pedir OK antes de `git push`. **No pushear sin OK.**

---

## Self-Review

**Cobertura del spec (Etapa 1):**

- Diccionario partido por idioma → Task 1, Steps 2-3. ✓
- `translate` puro que toma el dict → Task 1, Step 4. ✓
- Servir solo el idioma activo (server carga, pasa por prop) → Task 1, Steps 6-7. ✓
- Cliente sin datos de idioma en el bundle → medido en Task 3, Step 1. ✓
- `setLang` sin traer los 4 (cookie + refresh) → Task 1, Step 5. ✓
- Completitud (ningún idioma incompleto) → Task 2. ✓
- Primer render sigue traducido → verificado en Task 3, Step 2. ✓

**Placeholders:** ninguno; el `<port>` de dev se resuelve al levantar. El único código no-pegado son los ~1400 renglones de datos, movidos por script determinista (Task 1, Step 2) — no se re-escriben a mano.

**Consistencia de tipos/nombres:** `getDict(lang): Dict` (dicts.server) ↔ `layout` lo usa ↔ `Providers` recibe `dict: Dict` ↔ `I18nProvider({ lang, dict })` ↔ `translate(dict, key, vars)`. `Dict`/`Lang`/`LANGS`/`LANG_LABELS` siguen exportados desde `i18n-dict.ts`; `i18n.tsx` re-exporta `LANGS`/`LANG_LABELS`/`Lang` como hoy (LanguageSelector intacto).
