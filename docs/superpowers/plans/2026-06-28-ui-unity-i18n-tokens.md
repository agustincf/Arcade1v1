# UI Unity — i18n SSR, traducción de pantallas, tokens de texto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la web se sienta "de una sola pieza": las 3 pantallas hoy en inglés (agents, terms, unavailable) siguen el idioma del sitio SIN perder el SEO de `/agents`, se elimina el parpadeo de idioma, se unifica "wallet", y el texto secundario usa tokens de marca en vez de grises `slate-*`.

**Architecture:** El idioma se detecta del lado del **servidor** (cookie `arcade.lang` + cabecera `Accept-Language`, default `en`) mediante un helper en `next/headers`. Las pantallas agents/terms/unavailable **siguen siendo componentes de servidor** (HTML crawleable → SEO intacto; inglés por defecto para bots) y se traducen leyendo ese idioma. El diccionario se extrae a un módulo no-cliente para que servidor y cliente lo compartan. El layout pasa el idioma inicial al provider de cliente → sin parpadeo. Texto secundario pasa de `text-slate-*` a tokens `--color-muted*`.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind CSS v4 (`@theme` en `globals.css`), TypeScript. `cookies()`/`headers()` son **async** en Next 16 → usar `await`.

## Global Constraints

- **Branch:** `feat/ui-unity` (crear desde `main`).
- **SEO de `/agents` es prioridad innegociable:** la página sigue siendo Server Component, sigue exportando su `metadata` en inglés (título/description/keywords actuales, sin cambios), y por defecto (sin cookie / `Accept-Language: en` / bots) renderiza en **inglés**. La traducción NO debe degradar el HTML server-rendered ni la metadata.
- **Idioma soportado:** `en | es | hi | fr` (constante `LANGS`). Default global: `en`.
- **Tono del copy (ya establecido en el diccionario):** español con **voseo argentino** ("jugá", "elegí", "depositá"); mantener el motivo retro de títulos con extensiones de archivo (`.TXT`, `.EXE`, `.LOG`) donde aplique. Mirar `apps/web/app/lib/i18n.tsx` como referencia de voz por idioma.
- **Término unificado:** en ES y FR usar **"wallet"** (no "billetera"/"portefeuille"). HI ya usa "वॉलेट" de forma consistente — no tocar.
- **Tokens de texto (valores exactos, agregar a `@theme`):**
  - `--color-muted-bright: #ddd7f0;`
  - `--color-muted: #bcb4dd;`
  - `--color-muted-2: #9890bb;`
  - `--color-muted-3: #756e98;`
- **Mapeo slate → token (exacto):** `text-slate-100`→`text-[--color-text]`, `text-slate-200`→`text-[--color-muted-bright]`, `text-slate-300`→`text-[--color-muted]`, `text-slate-400`→`text-[--color-muted-2]`, `text-slate-500`→`text-[--color-muted-3]`.
- **Convención token en JSX:** forma arbitraria `[--color-X]` (la que usa el repo).
- **Verificación por tarea:** `npm run typecheck:web` pasa; donde aplique, `cd apps/web && npx next build` compila. No hay tests unitarios para UI/i18n salvo los que se indiquen explícitamente.

---

### Task 0: Crear el branch

- [ ] **Step 1: Branch desde main**

```bash
git checkout main
git checkout -b feat/ui-unity
```

- [ ] **Step 2: Confirmar línea base de grises**

Run: `grep -roE "text-slate-[0-9]+" apps/web/app --include=*.tsx | wc -l`
Expected: `88` (línea base; bajará a 0 en Task 5).

---

### Task 1: Extraer el diccionario a un módulo compartido (no-cliente)

**Files:**
- Create: `apps/web/app/lib/i18n-dict.ts`
- Modify: `apps/web/app/lib/i18n.tsx`

**Interfaces:**
- Produces: `LANGS`, `Lang`, `LANG_LABELS`, `DICT: Record<Lang, Dict>`, `translate(lang: Lang, key: string, vars?: Record<string,string|number>): string` — todos importables tanto desde Server Components como desde Client Components.

Razón: hoy el diccionario vive dentro de `i18n.tsx` que es `"use client"`. Para traducir en el servidor (Tasks 6–8) sin romper el SEO, los datos deben estar en un módulo sin `"use client"`.

- [ ] **Step 1: Crear `i18n-dict.ts` moviendo datos + lógica pura**

Crear `apps/web/app/lib/i18n-dict.ts` (SIN `"use client"`). Mover desde `i18n.tsx`: la constante `LANGS`, el `type Lang`, `LANG_LABELS`, `type Dict`, los cuatro diccionarios `en`, `es`, `hi`, `fr`, y `const DICT`. Agregar la función pura de traducción:

```ts
export function translate(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
    }
  }
  return s;
}
```

Exportar: `export const LANGS`, `export type Lang`, `export const LANG_LABELS`, `export const DICT`, `export function translate`.

- [ ] **Step 2: Adaptar `i18n.tsx` para importar del módulo compartido**

En `apps/web/app/lib/i18n.tsx` (sigue siendo `"use client"`), borrar las definiciones movidas y reemplazar por:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { LANGS, type Lang, LANG_LABELS, translate } from "./i18n-dict";

export { LANGS, LANG_LABELS };
export type { Lang };
```

La función `t` interna del provider ahora delega: `function t(key, vars) { return translate(lang, key, vars); }`. Mantener `detect()`, `I18nContext`, `useT` igual. (El provider se modifica en Task 3; por ahora dejar `useState<Lang>("en")` como está.)

- [ ] **Step 3: Verificar typecheck (sin cambios de comportamiento)**

Run: `npm run typecheck:web`
Expected: PASS (re-export mantiene los imports existentes `import { ..., LANGS, LANG_LABELS } from "@/app/lib/i18n"` funcionando).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/i18n-dict.ts apps/web/app/lib/i18n.tsx
git commit -m "refactor(i18n): extraer diccionario y translate() a módulo compartido no-cliente"
```

---

### Task 2: Detección de idioma del lado del servidor

**Files:**
- Create: `apps/web/app/lib/serverLang.ts`

**Interfaces:**
- Consumes: `LANGS`, `Lang` de `./i18n-dict`.
- Produces: `getLang(): Promise<Lang>` — lee la cookie `arcade.lang`; si no es válida, parsea `Accept-Language`; default `en`.

- [ ] **Step 1: Crear el helper de servidor**

Crear `apps/web/app/lib/serverLang.ts` (server-only; NO `"use client"`):

```ts
import { cookies, headers } from "next/headers";
import { LANGS, type Lang } from "./i18n-dict";

const isLang = (v: string | undefined | null): v is Lang =>
  !!v && (LANGS as readonly string[]).includes(v);

/** Idioma para render de servidor: cookie → Accept-Language → "en". */
export async function getLang(): Promise<Lang> {
  const cookieLang = (await cookies()).get("arcade.lang")?.value;
  if (isLang(cookieLang)) return cookieLang;

  const accept = (await headers()).get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (isLang(first)) return first;

  return "en";
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/lib/serverLang.ts
git commit -m "feat(i18n): getLang() de servidor (cookie + Accept-Language, default en)"
```

---

### Task 3: Pasar idioma inicial al cliente + eliminar el parpadeo

**Files:**
- Modify: `apps/web/app/lib/i18n.tsx` (provider acepta `initialLang`; `setLang` escribe cookie)
- Modify: `apps/web/app/providers.tsx` (acepta y propaga `initialLang`)
- Modify: `apps/web/app/layout.tsx` (async; `getLang()` → `<html lang>` + `<Providers initialLang>`)

**Interfaces:**
- Consumes: `getLang()` (Task 2), `Lang` (Task 1).
- Produces: `I18nProvider` con prop opcional `initialLang?: Lang`; `Providers` con prop `initialLang?: Lang`.

- [ ] **Step 1: `I18nProvider` arranca en `initialLang` y `setLang` persiste cookie**

En `apps/web/app/lib/i18n.tsx`:

```tsx
export function I18nProvider({
  initialLang = "en",
  children,
}: {
  initialLang?: Lang;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    // Si el servidor ya fijó un idioma válido distinto del default, respetarlo.
    // Solo autodetectar cuando no hubo elección previa (sin cookie/localStorage).
    if (initialLang !== "en") {
      document.documentElement.lang = initialLang;
      return;
    }
    const d = detect();
    setLangState(d);
    document.documentElement.lang = d;
  }, [initialLang]);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("arcade.lang", l);
    document.cookie = `arcade.lang=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }

  function t(key: string, vars?: Record<string, string | number>) {
    return translate(lang, key, vars);
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}
```

(Mantener `detect()` tal cual para el caso de primera visita sin cookie en cliente.)

- [ ] **Step 2: `Providers` propaga `initialLang`**

En `apps/web/app/providers.tsx`, cambiar la firma y el uso:

```tsx
export function Providers({
  initialLang,
  children,
}: {
  initialLang?: import("@/app/lib/i18n").Lang;
  children: React.ReactNode;
}) {
```

y reemplazar `<I18nProvider>{children}</I18nProvider>` por `<I18nProvider initialLang={initialLang}>{children}</I18nProvider>`.

- [ ] **Step 3: `layout.tsx` async con idioma de servidor**

En `apps/web/app/layout.tsx`: importar `getLang` (`import { getLang } from "@/app/lib/serverLang";`), volver el componente `async`, y usar el idioma:

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      {/* ...resto igual... */}
        <Providers initialLang={lang}>{children}</Providers>
      {/* ... */}
    </html>
  );
}
```

(Conservar todo el resto del `<head>`/`<body>` y clases tal como están. Solo cambia `lang="en"` → `lang={lang}` y `<Providers>` → `<Providers initialLang={lang}>`, más volver la función `async`.)

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck:web` → PASS
Run: `cd apps/web && npx next build` → compila OK (el uso de `cookies()/headers()` vuelve el render dinámico; es esperado).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/i18n.tsx apps/web/app/providers.tsx apps/web/app/layout.tsx
git commit -m "feat(i18n): idioma inicial desde el servidor (cookie) — elimina el parpadeo + <html lang> correcto"
```

---

### Task 4: Unificar "wallet" en ES y FR

**Files:**
- Modify: `apps/web/app/lib/i18n-dict.ts`

**Interfaces:**
- Consumes: nada nuevo. Cambios de texto en el diccionario.

- [ ] **Step 1: Confirmar ocurrencias**

Run: `grep -niE "billetera|portefeuille" apps/web/app/lib/i18n-dict.ts`
Expected: ES `recover.connectPrompt` ("billetera"), `recover.connect` ("BILLETERA"); FR `recover.connect` ("PORTEFEUILLE"), y cualquier "portefeuille" en FR recover.

- [ ] **Step 2: Reemplazar en ES**

- `recover.connectPrompt`: "Conectá tu billetera para ver tus partidas abiertas." → "Conectá tu wallet para ver tus partidas abiertas."
- `recover.connect`: "CONECTAR BILLETERA ▶" → "CONECTAR WALLET ▶"

- [ ] **Step 3: Reemplazar en FR**

- `recover.connect`: "CONNECTER LE PORTEFEUILLE ▶" → "CONNECTER WALLET ▶"
- `recover.connectPrompt` (FR): "Connectez votre portefeuille pour voir vos parties ouvertes." → "Connecte ton wallet pour voir tes parties ouvertes." (alinear también al tuteo informal usado en el resto del FR).

- [ ] **Step 4: Verificar que no quedan términos divergentes**

Run: `grep -niE "billetera|portefeuille" apps/web/app/lib/i18n-dict.ts`
Expected: **0 resultados**.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck:web` → PASS
```bash
git add apps/web/app/lib/i18n-dict.ts
git commit -m "fix(copy): unificar 'wallet' en ES y FR (elimina billetera/portefeuille)"
```

---

### Task 5: Tokens de texto apagado (reemplazar `slate-*`)

**Files:**
- Modify: `apps/web/app/globals.css` (agregar tokens)
- Modify: todos los `.tsx` bajo `apps/web/app` que usen `text-slate-[0-9]` (≈19 archivos, 88 ocurrencias)

**Interfaces:**
- Consumes: convención `[--color-X]`.
- Produces: tokens `--color-muted-bright`, `--color-muted`, `--color-muted-2`, `--color-muted-3`.

- [ ] **Step 1: Agregar tokens al bloque `@theme`**

En `apps/web/app/globals.css`, dentro de `@theme`, después del bloque "Estructurales", agregar:

```css
  /* Texto apagado (reemplaza los grises slate-*, ahora con tinte de marca) */
  --color-muted-bright: #ddd7f0;
  --color-muted: #bcb4dd;
  --color-muted-2: #9890bb;
  --color-muted-3: #756e98;
```

- [ ] **Step 2: Reemplazo sistemático slate → token (todo `apps/web/app`)**

Aplicar EXACTAMENTE este mapeo en todos los `.tsx` (solo clases de texto `text-slate-N`; preservar prefijos como `!` y `hover:` si existen):

- `text-slate-100` → `text-[--color-text]`
- `text-slate-200` → `text-[--color-muted-bright]`
- `text-slate-300` → `text-[--color-muted]`
- `text-slate-400` → `text-[--color-muted-2]`
- `text-slate-500` → `text-[--color-muted-3]`

Sugerencia de ejecución (revisar cada diff): por cada nivel,
```bash
grep -rl "text-slate-300" apps/web/app --include=*.tsx
```
y editar. Repetir por cada nivel.

- [ ] **Step 3: Verificar 0 grises de texto restantes**

Run: `grep -rnE "text-slate-[0-9]" apps/web/app --include=*.tsx`
Expected: **0 resultados**.

(Si aparece algún `bg-slate-*`/`border-slate-*` —no contemplado en la línea base— reportarlo como DONE_WITH_CONCERNS en vez de inventar un token.)

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck:web` → PASS
Run: `cd apps/web && npx next build` → compila OK (valida que las utilidades `text-[--color-muted*]` resuelven).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app
git commit -m "feat(ui): tokens de texto apagado (--color-muted*) en lugar de grises slate-*"
```

---

### Task 6: Traducir `/unavailable` (server, multi-idioma)

**Files:**
- Modify: `apps/web/app/unavailable/page.tsx`

**Interfaces:**
- Consumes: `getLang()` (Task 2). Tokens de texto (Task 5).

Patrón: el componente sigue siendo Server Component (mantiene `metadata`), se vuelve `async`, lee `getLang()` y elige el texto de un mapa local por idioma (en/es/hi/fr). Default `en`.

- [ ] **Step 1: Reescribir la página con contenido por idioma**

Reemplazar el cuerpo de `apps/web/app/unavailable/page.tsx` por:

```tsx
import type { Metadata } from "next";
import { getLang } from "@/app/lib/serverLang";
import type { Lang } from "@/app/lib/i18n-dict";

export const metadata: Metadata = {
  title: "Not available in your region | Arcade1v1",
  robots: { index: false, follow: false },
};

const COPY: Record<Lang, { h1: string; body: string; help: string }> = {
  en: {
    h1: "Not available here",
    body: "Arcade1v1 is not available in your region. Access to skill-gaming for value is restricted in your jurisdiction.",
    help: "If you believe this is a mistake, please get in touch.",
  },
  es: {
    h1: "No disponible acá",
    body: "Arcade1v1 no está disponible en tu región. El acceso al skill-gaming por valor está restringido en tu jurisdicción.",
    help: "Si creés que es un error, escribinos.",
  },
  hi: {
    h1: "यहाँ उपलब्ध नहीं",
    body: "Arcade1v1 आपके क्षेत्र में उपलब्ध नहीं है। आपके अधिकार-क्षेत्र में मूल्य के लिए स्किल-गेमिंग पर पाबंदी है।",
    help: "अगर आपको लगता है कि यह ग़लती है, तो हमसे संपर्क करें।",
  },
  fr: {
    h1: "Indisponible ici",
    body: "Arcade1v1 n'est pas disponible dans ta région. L'accès au skill-gaming pour de l'argent est restreint dans ta juridiction.",
    help: "Si tu penses que c'est une erreur, contacte-nous.",
  },
};

export default async function UnavailablePage() {
  const lang = await getLang();
  const c = COPY[lang];
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="text-6xl">🌍</div>
      <h1 className="font-pixel mt-4 text-lg text-[--color-gold]">{c.h1}</h1>
      <p className="mt-4 text-lg leading-relaxed text-[--color-muted]">{c.body}</p>
      <p className="mt-3 text-base leading-relaxed text-[--color-muted-3]">{c.help}</p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck:web` → PASS
```bash
git add apps/web/app/unavailable/page.tsx
git commit -m "feat(i18n): traducir /unavailable por idioma de servidor (en/es/hi/fr)"
```

---

### Task 7: Traducir `/terms` (server, multi-idioma)

**Files:**
- Create: `apps/web/app/terms/content.ts` (mapa de copy por idioma)
- Modify: `apps/web/app/terms/page.tsx` (async; `getLang()`; renderiza desde el mapa)

**Interfaces:**
- Consumes: `getLang()` (Task 2), `Lang` de `i18n-dict`. Tokens de texto (Task 5).

- [ ] **Step 1: Leer el contenido actual**

Leer `apps/web/app/terms/page.tsx` completo para inventariar cada string visible (título, secciones, párrafos, "Last updated…", links).

- [ ] **Step 2: Crear `terms/content.ts` con el copy por idioma**

Crear `apps/web/app/terms/content.ts` exportando una estructura tipada `Record<Lang, TermsCopy>` donde `TermsCopy` modela exactamente los campos de la página (p. ej. `title`, `updated`, y un arreglo `sections: { heading: string; body: string }[]`). El contenido `en` = el texto actual **verbatim** (para preservar SEO/legal). Traducir `es`, `hi`, `fr` espejando el tono del diccionario (voseo en ES, tuteo informal FR, registro de HI del resto del sitio). Mantener nombres propios y términos legales según corresponda; "wallet" unificado.

- [ ] **Step 3: Reescribir `terms/page.tsx` como server async que consume el mapa**

`page.tsx` mantiene su `export const metadata` (en inglés, sin cambios), se vuelve `async`, hace `const lang = await getLang();` y renderiza la estructura de `content.ts[lang]` con el mismo markup/clases actuales (cambiando los `text-slate-*` ya migrados por los tokens de Task 5). El layout visual NO cambia, solo el origen del texto.

- [ ] **Step 4: Verificar cobertura (sin texto inglés hardcodeado en el JSX)**

Run: `npm run typecheck:web` → PASS
Run: `grep -nE "Last updated|Terms of" apps/web/app/terms/page.tsx`
Expected: **0** (el texto vive ahora en `content.ts`, no incrustado en el JSX).

- [ ] **Step 5: Build + commit**

Run: `cd apps/web && npx next build` → compila OK
```bash
git add apps/web/app/terms/content.ts apps/web/app/terms/page.tsx
git commit -m "feat(i18n): traducir /terms por idioma de servidor (en/es/hi/fr), en verbatim para SEO/legal"
```

---

### Task 8: Traducir `/agents` preservando SEO (server, multi-idioma)

**Files:**
- Create: `apps/web/app/agents/content.ts` (mapa de copy por idioma)
- Modify: `apps/web/app/agents/page.tsx` (async; `getLang()`; renderiza desde el mapa; metadata EN intacta)

**Interfaces:**
- Consumes: `getLang()` (Task 2), `Lang` de `i18n-dict`. Tokens de texto (Task 5).

**SEO — restricciones duras de esta tarea:**
- `export const metadata` queda EXACTAMENTE como está hoy (inglés, con `keywords` y `alternates.canonical`). No tocar.
- La página sigue siendo Server Component (sin `"use client"`). Renderiza HTML completo en el servidor.
- El contenido `en` del mapa debe ser **verbatim** el texto inglés actual (mismo wording orientado a SEO/agentes).
- Default `en` cuando no hay cookie / `Accept-Language: en` / bots → los crawlers ven el inglés actual.

- [ ] **Step 1: Inventariar el copy actual**

Leer `apps/web/app/agents/page.tsx`. Identificar cada string visible: chip "🤖 AGENT-NATIVE", h1 ("Build an agent. / Compete. Earn USDC."), intro, títulos de `Win` ("WHY COMPETE HERE", "QUICKSTART", "AGENT.TS", "ARBITER API", "GOOD TO KNOW"), los bullets de "why", los 4 `Step` (título + cuerpo), las notas, los `Endpoint.desc`, y los textos de los botones finales. El bloque de código `exampleTs` y los `path`/`method` de la API NO se traducen (son código/identificadores).

- [ ] **Step 2: Crear `agents/content.ts`**

Crear `apps/web/app/agents/content.ts` con `Record<Lang, AgentsCopy>` tipado, modelando los campos anteriores (incluyendo arreglos para bullets, steps y endpoints — los `desc` de endpoints se pueden traducir; `method`/`path` quedan literales en el JSX). `en` = verbatim actual. `es`/`hi`/`fr` traducidos espejando el tono del diccionario. Términos técnicos (matchmake, replay, seed, ELO, PnL, USDC, API) se mantienen.

- [ ] **Step 3: Reescribir `agents/page.tsx` para consumir el mapa**

Mantener `metadata` intacta. Volver `AgentsPage` `async`, `const lang = await getLang();`, `const c = CONTENT[lang];`, y sustituir cada string hardcodeado por el campo correspondiente de `c`. Mismos componentes (`Win`, `Step`, `Endpoint`, `Code`, `Inline`) y clases; los `text-slate-*` ya migrados quedan como tokens (Task 5). El `exampleTs` y los `path` quedan como están.

- [ ] **Step 4: Verificar SEO/idioma**

Run: `npm run typecheck:web` → PASS
Run: `grep -nE "Build an agent|WHY COMPETE HERE|metadata" apps/web/app/agents/page.tsx`
Expected: `metadata` sigue presente (inglés); los textos visibles ya NO están hardcodeados en el JSX (viven en `content.ts`).
Run: `cd apps/web && npx next build` → compila OK.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/agents/content.ts apps/web/app/agents/page.tsx
git commit -m "feat(i18n): /agents multi-idioma por servidor manteniendo SEO (metadata + en verbatim)"
```

---

### Task 9: Verificación de extremo a extremo

**Files:** ninguno (solo verificación; documentar hallazgos).

- [ ] **Step 1: Sin texto de pantalla hardcodeado en inglés fuera de mapas/metadata**

Run:
```bash
grep -rnE "text-slate-[0-9]" apps/web/app --include=*.tsx
```
Expected: **0**.

- [ ] **Step 2: Diccionario sin términos divergentes**

Run: `grep -niE "billetera|portefeuille" apps/web/app/lib/i18n-dict.ts`
Expected: **0**.

- [ ] **Step 3: Build completo**

Run: `cd apps/web && npx next build`
Expected: compila OK, sin errores de tipos ni de Tailwind.

- [ ] **Step 4: Suite del repo (no-regresión)**

Run: `npm test`
Expected: misma cantidad de tests pasando que antes (este cambio no toca lógica de juego/servidor).

- [ ] **Step 5: Verificación manual (humano)**

`npm run dev`. Con el sitio en español: navegar a `/agents`, `/terms`, `/unavailable` y confirmar que están en español; cambiar a EN con el selector y recargar → quedan en inglés sin parpadeo. Confirmar que `/agents` con DevTools en modo "sin cookies / Accept-Language: en" se ve en inglés (SEO).

---

## Self-Review (cobertura)

- **Bug `/agents` → inglés:** Task 8 lo traduce manteniendo SEO (server + metadata EN + en verbatim + default en). ✅
- **terms/unavailable en inglés:** Tasks 6–7. ✅
- **Parpadeo + `<html lang>`:** Tasks 2–3 (idioma de servidor → estado inicial del provider). ✅
- **wallet/billetera:** Task 4. ✅
- **grises slate → tokens:** Task 5. ✅
- **SEO de agents:** restricciones duras en Task 8 + verificación Step 4. ✅
- **Riesgo de calidad de traducción HI/FR:** mitigado pidiendo espejar el tono del diccionario existente; el usuario no puede verificar HI/FR — el review de cada tarea debe chequear cobertura de claves y que `en` quede verbatim, no la fidelidad fina de HI/FR.
- **Trade-off:** leer `cookies()/headers()` vuelve dinámico el render (antes algunas páginas eran estáticas). Aceptado: el HTML sigue siendo server-rendered y crawleable (SEO intacto); el default `en` cubre a los bots.
