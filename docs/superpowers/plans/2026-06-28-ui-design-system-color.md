# UI — Design system de color (tokens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que toda la UI "chrome" de la web use tokens de color desde `globals.css` (una sola fuente de verdad), sin hex sueltos, sin cambiar el look.

**Architecture:** Refactor visual de bajo riesgo. Se agregan tokens estructurales al bloque `@theme` de `apps/web/app/globals.css` con los **mismos valores** que ya se usaban, y se reemplazan los hex literales por `var(--color-*)` (en CSS) o por la utilidad arbitraria `[--color-*]` de Tailwind (en JSX). El arte de los juegos en canvas y la generación de imágenes en runtime quedan como excepciones documentadas.

**Tech Stack:** Next.js (App Router), Tailwind CSS v4 (`@theme` en `globals.css`), TypeScript.

## Global Constraints

- **Branch:** `feat/ui-tokens` (crear desde `main`).
- **El look no cambia:** cada token se define con el **valor hex exacto** que reemplaza. Nada de "ajustar" colores.
- **Convención de utilidad de token en JSX:** forma arbitraria `[--color-X]` (es la que ya usa el repo, p. ej. `bg-[--color-surface-2]`, `text-[--color-accent-2]`). NO usar la forma generada `bg-accent`.
- **Convención en CSS (`globals.css`):** `var(--color-X)`.
- **Regla de tokenización:** se tokeniza la **duplicación** (un color/medida que se repite). Un valor verdaderamente único (one-off de un solo uso) se deja como hex y se **documenta** — no se crea token para algo que se usa una vez (YAGNI).
- **Fuera de alcance (excepciones documentadas, NO tocar):**
  - Canvas de los juegos (`apps/web/app/games/**`, `apps/web/app/components/GameIcon.tsx`): `ctx.fillStyle = "#..."` es arte del juego; canvas no lee variables CSS.
  - Generación de imágenes en runtime: `apps/web/app/opengraph-image.tsx`, `apps/web/app/icon.tsx` (usan `next/og`, sin pipeline de CSS).
  - `apps/web/app/providers.tsx` (`accentColor` se pasa a la lib de wallet; requiere hex literal).
  - Rampas de gradiente/sombra internas de cada variante `.btn3d` en `globals.css` (el spec dice no tocar `.btn3d`).
- **Verificación por tarea:** `npm run typecheck:web` pasa + el grep de la tarea baja a 0 en su alcance. Verificación visual: los colores son idénticos (mismos hex detrás del token).

---

### Task 0: Crear el branch

- [ ] **Step 1: Crear y posicionarse en el branch**

```bash
git checkout main
git checkout -b feat/ui-tokens
```

- [ ] **Step 2: Verificar punto de partida (cuántos hex hay en tsx)**

Run:

```bash
grep -rnE "#[0-9a-fA-F]{3,8}" apps/web/app --include=*.tsx | wc -l
```

Expected: un número > 0 (hoy ~125 contando juegos). Sirve como línea base.

---

### Task 1: Tokens nuevos en `@theme` + migrar hex internos de `globals.css`

**Files:**

- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Produces: tokens nuevos disponibles para CSS (`var(--color-ink)`, `var(--color-ink-2)`, `var(--color-text)`, `var(--color-text-strong)`) y para Tailwind en JSX (`[--color-ink]`, `[--color-ink-2]`, `[--color-text]`, `[--color-text-strong]`). También el token de tamaño `--text-px10` → utilidad `text-px10`. Las tareas 2 y 3 dependen de estos.

- [ ] **Step 1: "Test" — confirmar que los hex objetivo están presentes**

Run:

```bash
grep -nE "#0a0518|#efeaff|#1a0033|#fff([^0-9a-fA-F]|$)" apps/web/app/globals.css
```

Expected: varias líneas (24, 83, 126, 128, 150, 152, 179, 210, 212, 220, 221, 222). Esto prueba que hay algo que migrar.

- [ ] **Step 2: Agregar los tokens al bloque `@theme`**

En `apps/web/app/globals.css`, dentro de `@theme { ... }`, después del bloque "Estados", agregar:

```css
/* Estructurales */
--color-ink: #0a0518; /* borde/negro oficial repetido (unifica #0a0510) */
--color-ink-2: #1a0033; /* texto oscuro sobre fondos claros (gold) */
--color-text: #efeaff; /* texto base del body */
--color-text-strong: #ffffff; /* texto blanco (unifica #fff / #ffffff) */

/* Tipografía — tamaño pixel chico (antes text-[10px] suelto) */
--text-px10: 10px;
```

- [ ] **Step 3: Reemplazar los hex estructurales por `var(--color-*)`**

Aplicar estos reemplazos exactos en `apps/web/app/globals.css` (solo el valor de color; el resto de la declaración igual):

- Línea ~24 `color: #efeaff;` → `color: var(--color-text);`
- Línea ~83 `border: 2px solid #0a0518;` → `border: 2px solid var(--color-ink);`
- Línea ~126 `color: #fff;` → `color: var(--color-text-strong);`
- Línea ~127 `background: linear-gradient(180deg, #ff3df0, #b41fa6);` → `background: linear-gradient(180deg, var(--color-accent), #b41fa6);`
- Línea ~128 `border-bottom: 2px solid #0a0518;` → `border-bottom: 2px solid var(--color-ink);`
- Línea ~132 `background: linear-gradient(180deg, #27e8ff, #1597b8);` → `background: linear-gradient(180deg, var(--color-accent-2), #1597b8);`
- Línea ~150 `color: #1a0033;` → `color: var(--color-ink-2);`
- Línea ~152 `border: 2px solid #0a0518;` → `border: 2px solid var(--color-ink);`
- Línea ~179 `color: #fff;` → `color: var(--color-text-strong);`
- Línea ~180 `background: linear-gradient(180deg, #ff8df3, #ff3df0 60%, #c41fb0);` → `background: linear-gradient(180deg, #ff8df3, var(--color-accent) 60%, #c41fb0);`
- Línea ~192 `background: linear-gradient(180deg, #9af4ff, #27e8ff 60%, #12a7c7);` → `background: linear-gradient(180deg, #9af4ff, var(--color-accent-2) 60%, #12a7c7);`
- Línea ~210 `border: 2px solid #0a0518;` → `border: 2px solid var(--color-ink);`
- Línea ~212 `background: #0a0518;` → `background: var(--color-ink);`
- Línea ~220 `border-top: 2px solid #0a0518;` → `border-top: 2px solid var(--color-ink);`
- Línea ~221 `border-bottom: 2px solid #0a0518;` → `border-bottom: 2px solid var(--color-ink);`
- Línea ~222 `background: #0a0518;` → `background: var(--color-ink);`

**Dejar SIN tocar (excepciones documentadas — rampas de sombra/gradiente de `.btn3d` y stops derivados):** `#b41fa6`, `#1597b8`, `#ffe87a`, `#ffce2e`, `#f5b400`, `#9c6b00`, `#ff8df3`, `#c41fb0`, `#7a1270`, `#06262e`, `#9af4ff`, `#12a7c7`, `#0c6b80`.

- [ ] **Step 4: "Test" — confirmar que los estructurales ya no están como literal**

Run:

```bash
grep -nE "#0a0518|#efeaff|#1a0033" apps/web/app/globals.css
```

Expected: **0 resultados** (ya migrados a `var(--color-*)`).

- [ ] **Step 5: Typecheck**

Run:

```bash
npm run typecheck:web
```

Expected: PASS (sin errores).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(ui): tokens estructurales de color en @theme + migrar hex internos de globals.css"
```

---

### Task 2: Migrar hex → token en el chrome (5 `.tsx`)

**Files:**

- Modify: `apps/web/app/components/Header.tsx:13`
- Modify: `apps/web/app/leaderboard/page.tsx:70`
- Modify: `apps/web/app/game/[gameId]/match/page.tsx:635`
- Modify: `apps/web/app/game/[gameId]/TableClient.tsx:90,116`
- Modify: `apps/web/app/agents/page.tsx:46,49,58,85`

**Interfaces:**

- Consumes: tokens `[--color-ink]` y `[--color-ink-2]` definidos en Task 1.

- [ ] **Step 1: "Test" — confirmar hex presentes en los 5 archivos**

Run:

```bash
grep -rnE "#0a0518|#1a0033" apps/web/app/components/Header.tsx apps/web/app/leaderboard/page.tsx "apps/web/app/game/[gameId]/match/page.tsx" "apps/web/app/game/[gameId]/TableClient.tsx" apps/web/app/agents/page.tsx
```

Expected: ~10 líneas.

- [ ] **Step 2: Header.tsx** — reemplazar en la línea 13

De:

```
className="sticky top-0 z-40 border-b-2 border-[#0a0518] bg-[#0a0518]/95 backdrop-blur"
```

A:

```
className="sticky top-0 z-40 border-b-2 border-[--color-ink] bg-[--color-ink]/95 backdrop-blur"
```

- [ ] **Step 3: leaderboard/page.tsx** — reemplazar en la línea 70

De: `: "border-[#0a0518] bg-[--color-surface-2]"`
A: `: "border-[--color-ink] bg-[--color-surface-2]"`

- [ ] **Step 4: match/page.tsx** — reemplazar en la línea 635

De: `<div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-[#0a0518] bg-[--color-surface-2] text-xl">`
A: `<div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-[--color-ink] bg-[--color-surface-2] text-xl">`

- [ ] **Step 5: TableClient.tsx** — reemplazar en líneas 90 y 116

Línea 90, de:

```
<span className="absolute bottom-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-[#0a0518] bg-[--color-gold] text-xs font-extrabold text-[#1a0033]">
```

A:

```
<span className="absolute bottom-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-[--color-ink] bg-[--color-gold] text-xs font-extrabold text-[--color-ink-2]">
```

Línea 116, de:

```
<div className="mt-4 rounded border-2 border-[#0a0518] bg-[#0a0518] p-3 text-center">
```

A:

```
<div className="mt-4 rounded border-2 border-[--color-ink] bg-[--color-ink] p-3 text-center">
```

- [ ] **Step 6: agents/page.tsx** — reemplazar comentario + líneas 49, 58, 85

Línea 46 (comentario, para que no matchee el grep), de:
`/** Código legible sobre el negro oficial de la plataforma (#0a0518). */`
A:
`/** Código legible sobre el negro oficial de la plataforma (token ink). */`

Línea 49, de:

```
<pre className="overflow-x-auto rounded-md border-2 border-[#0a0518] bg-[#0a0518] p-4 font-mono text-[13px] leading-6 text-slate-200">
```

A:

```
<pre className="overflow-x-auto rounded-md border-2 border-[--color-ink] bg-[--color-ink] p-4 font-mono text-[13px] leading-6 text-slate-200">
```

(El `text-[13px]` se deja: es one-off de un solo uso, ver Task 4.)

Línea 58, de:

```
<span className="font-pixel mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-[#0a0518] bg-[--color-accent] text-xs text-[#0a0518]">
```

A:

```
<span className="font-pixel mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-[--color-ink] bg-[--color-accent] text-xs text-[--color-ink]">
```

Línea 85, de:

```
<code className="rounded border border-[#0a0518] bg-[#0a0518] px-1.5 py-0.5 font-mono text-sm text-slate-200">
```

A:

```
<code className="rounded border border-[--color-ink] bg-[--color-ink] px-1.5 py-0.5 font-mono text-sm text-slate-200">
```

- [ ] **Step 7: "Test" — confirmar 0 hex estructurales en esos 5 archivos**

Run:

```bash
grep -rnE "#0a0518|#1a0033" apps/web/app/components/Header.tsx apps/web/app/leaderboard/page.tsx "apps/web/app/game/[gameId]/match/page.tsx" "apps/web/app/game/[gameId]/TableClient.tsx" apps/web/app/agents/page.tsx
```

Expected: **0 resultados**.

- [ ] **Step 8: Typecheck**

Run:

```bash
npm run typecheck:web
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/components/Header.tsx apps/web/app/leaderboard/page.tsx "apps/web/app/game/[gameId]/match/page.tsx" "apps/web/app/game/[gameId]/TableClient.tsx" apps/web/app/agents/page.tsx
git commit -m "feat(ui): migrar hex de chrome a tokens (ink, ink-2) en 5 vistas"
```

---

### Task 3: Normalizar el tamaño suelto `text-[10px]`

**Files:**

- Modify: `apps/web/app/game/[gameId]/match/page.tsx:639`
- Modify: `apps/web/app/components/LanguageSelector.tsx:12`
- Modify: `apps/web/app/components/Header.tsx:23,42`
- Modify: `apps/web/app/games/tetris/TetrisGame.tsx:241,286`

**Interfaces:**

- Consumes: token `--text-px10` (→ utilidad `text-px10`) definido en Task 1.

Nota: solo se migra `text-[10px]` (se repite 6 veces → vale token). Se **dejan** `text-[11px]` (`page.tsx:95`, único) y `text-[13px]` (`agents/page.tsx:49`, único) como one-offs documentados (Task 4). En Tetris, el `text-[10px]` está en un `<div>` HTML (label), no en el canvas — es seguro migrarlo.

- [ ] **Step 1: "Test" — confirmar los 6 usos de `text-[10px]`**

Run:

```bash
grep -rnE "text-\[10px\]" apps/web/app --include=*.tsx
```

Expected: 6 líneas (match:639, LanguageSelector:12, Header:23, Header:42, Tetris:241, Tetris:286).

- [ ] **Step 2: Reemplazar `text-[10px]` → `text-px10` (preservando el `!` de override donde exista)**

- `match/page.tsx:639`: `text-[10px]` → `text-px10`
- `LanguageSelector.tsx:12`: `!text-[10px]` → `!text-px10`
- `Header.tsx:23`: `text-[10px]` → `text-px10`
- `Header.tsx:42`: `!text-[10px]` → `!text-px10`
- `TetrisGame.tsx:241`: `text-[10px]` → `text-px10`
- `TetrisGame.tsx:286`: `text-[10px]` → `text-px10`

- [ ] **Step 3: "Test" — confirmar 0 `text-[10px]`**

Run:

```bash
grep -rnE "text-\[10px\]" apps/web/app --include=*.tsx
```

Expected: **0 resultados**.

- [ ] **Step 4: Typecheck**

Run:

```bash
npm run typecheck:web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/game/[gameId]/match/page.tsx" apps/web/app/components/LanguageSelector.tsx apps/web/app/components/Header.tsx apps/web/app/games/tetris/TetrisGame.tsx
git commit -m "feat(ui): tamaño pixel chico como token text-px10 (reemplaza text-[10px])"
```

---

### Task 4: Documentar excepciones + verificación final (build + look)

**Files:**

- Modify: `docs/superpowers/specs/2026-06-27-ui-design-system-color-design.md` (agregar sección "Excepciones documentadas")

**Interfaces:**

- Consumes: el resultado de las Tasks 1–3.

- [ ] **Step 1: Agregar la sección de excepciones al spec**

Al final de `docs/superpowers/specs/2026-06-27-ui-design-system-color-design.md`, agregar:

```markdown
## Excepciones documentadas (hex que NO se tokeniza, y por qué)

- **Canvas de los juegos** (`apps/web/app/games/**`, `components/GameIcon.tsx`):
  `ctx.fillStyle = "#..."` es arte del juego; el canvas no lee variables CSS.
- **Imágenes en runtime** (`opengraph-image.tsx`, `icon.tsx`): usan `next/og`,
  sin pipeline de CSS; requieren color literal.
- **`providers.tsx`** (`accentColor: "#6d5efc"`): se pasa a la lib de wallet;
  requiere hex literal.
- **Rampas de gradiente/sombra de `.btn3d` en `globals.css`** (stops claros/oscuros
  y profundidades de `box-shadow`): son shades derivados de cada variante de botón,
  componente que está fuera de alcance.
- **One-offs de tamaño**: `text-[11px]` (`page.tsx`) y `text-[13px]` (`agents/page.tsx`),
  de un solo uso cada uno (YAGNI — no se crea token).
```

- [ ] **Step 2: "Test" — grep de color de éxito (excluyendo excepciones)**

Run:

```bash
grep -rnE "#[0-9a-fA-F]{3,8}" apps/web/app --include=*.tsx \
  | grep -vE "(/games/|GameIcon\.tsx|opengraph-image\.tsx|icon\.tsx|providers\.tsx)"
```

Expected: **0 resultados**.

- [ ] **Step 3: Build de producción**

Run:

```bash
cd apps/web && npx next build
```

Expected: build OK (compila sin errores).

- [ ] **Step 4: Verificación visual (manual)**

Run:

```bash
npm run dev
```

Revisar que **se ve igual** que antes en: Home, Header, Leaderboard, Agents, detalle de juego (TableClient) y pantalla de match. Mismos colores, mismos tamaños.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-27-ui-design-system-color-design.md
git commit -m "docs(ui): documentar excepciones de hex no tokenizable + verificación"
```

---

## Self-Review (cobertura del spec)

- **Spec §1 (cerrar paleta de tokens):** Task 1 agrega `ink`, `ink-2`, `text`, `text-strong` y migra los hex internos de `globals.css` (incluido `.win-title` con `#ff3df0`/`#0a0518`). ✅
- **Spec §2 (hex → token en `.tsx`):** Task 2 migra los 5 archivos de chrome migrables; opengraph/icon/providers/canvas quedan como excepción documentada (Task 4) por imposibilidad técnica. ✅
- **Spec §3 (normalizar tamaños sueltos):** Task 3 tokeniza `text-[10px]` (la única medida duplicada); `text-[11px]`/`text-[13px]` documentados como one-offs. ✅
- **Spec criterios de éxito:** grep de color a 0 con exclusiones (Task 4 step 2), `typecheck:web` (cada task) + `next build` (Task 4), verificación visual (Task 4). ✅
- **Desviación vs spec:** el spec asumía 33 archivos / ~120 hex; la realidad son 14 archivos y la mayoría del volumen está en canvas (fuera de alcance por decisión del usuario). El alcance real de migración son 6 archivos `.tsx` + `globals.css`. Documentado arriba.
