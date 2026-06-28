# Spec — Design system de color (UI consistente, estilo arcade)

Fecha: 2026-06-27 · Estado: diseño aprobado por el usuario (pendiente plan + ejecución)

## Contexto

Segundo frente de "mejorar la app": que la web "se vea más pro y dé confianza"
para los humanos que apuestan. **Dirección decidida:** PULIR EL RETRO (mantener la
identidad arcade-retro Y2K; hacerla ver intencional y de calidad). **Foco:**
CONSISTENCIA GENERAL (que se vea "de una sola pieza").

## Diagnóstico (hecho el 2026-06-27)

Lo que **ya es consistente** (no tocar):
- Componentes base se reutilizan: `.btn3d` en 18 archivos, **0 botones ad-hoc**;
  ventanas `.win`; `.chip`, `.marquee` definidos en `globals.css`.
- Espaciado mayormente OK: solo unos pocos tamaños sueltos (`text-[10px]` ×6,
  `text-[13px]`, `text-[11px]`).

El **problema real es el COLOR**: ~120 colores hex escritos a mano en los 33 `.tsx`,
con variantes casi-duplicadas. Conteos del diagnóstico:
- `#0a0518` ×27 (borde negro-azulado) + `#0a0510` ×5 (casi idéntico) → mismo color, dos escrituras.
- `#ffd23d` ×15, `#39ff7a` ×14, `#ff3df0` ×13, `#27e8ff` ×10, `#b6ff3d` ×3 → **ya son tokens** pero se escriben como hex.
- `#ffffff` ×7 vs `#fff` ×3; `#ff4d6d` (token lose) ×3 vs `#ff3b3b` ×3 (rojo casi igual).
- One-offs a evaluar: `#6d5efc` ×3 (violeta), `#1a0033` ×3 (texto oscuro sobre botón), `#ff9f1c`/`#ff7a00` ×2 (naranjas).

Esto hace que se vea "no del todo parejo" e impide ajustes globales de color.

## Objetivo

Una **única fuente de verdad para el color**: toda la UI usa tokens (vía Tailwind
`@theme` en `globals.css`), sin hex sueltos en los `.tsx`. La estética NO cambia
(los colores siguen siendo los mismos) — solo se nombran y unifican.

## Diseño

### 1. Cerrar la paleta de tokens (`globals.css`, bloque `@theme`)

Mantener los existentes y **agregar los faltantes**:
- `--color-ink: #0a0518;` (el borde oscuro repetido; `#0a0510` se unifica acá)
- `--color-text: #efeaff;` (texto base, hoy hardcodeado en `body`)
- `--color-text-strong: #ffffff;` (unifica `#fff`/`#ffffff`)
- Evaluar al ejecutar (agregar token si es semántico y se repite; si es un one-off
  realmente único, igual sacarlo del `.tsx` a un token nombrado): `--color-violet`
  (`#6d5efc`), `--color-ink-2`/texto-sobre-gold (`#1a0033`), naranjas. El rojo
  `#ff3b3b` se **unifica a `--color-lose`** salvo que haya una razón visual clara
  (en cuyo caso, token propio).
- Reemplazar los hex dentro de `globals.css` mismo (p. ej. `.win-title` usa
  `#ff3df0`/`#b41fa6` y `#0a0518` literales) por `var(--color-*)`.

### 2. Reemplazar hex → token en los 33 `.tsx`

Regla: **ningún color hex literal en JSX/clases**. Cada uno usa su token, vía la
utilidad de Tailwind correspondiente (`text-ink`, `bg-accent`, `border-ink`,
`text-[color:var(--color-...)]`, etc.) o `style={{ color: "var(--color-...)" }}`
donde no haya utilidad. Las variantes casi-duplicadas colapsan al token canónico.

### 3. Normalizar los tamaños sueltos

Los pocos `text-[10px]`/`[11px]`/`[13px]` → mapear a la tipografía del sistema
(`font-pixel`/`font-screen` + una escala chica de tamaños si hace falta un token).

## Alcance

- SÍ: tokens de color + reemplazo de hex + normalizar tamaños sueltos.
- NO: rediseñar pantallas, cambiar la estética, tocar componentes que ya son
  consistentes (`.btn3d`, `.win`), ni el layout. Es un refactor visual de bajo
  riesgo (mismo look, ahora parejo).

## Criterios de éxito

- `grep -rE "#[0-9a-fA-F]{3,8}" apps/web/app --include=*.tsx` → **0 resultados**
  (o solo casos justificados y documentados).
- La web **compila** (`typecheck:web` + `next build`) y se ve **igual** que antes
  (mismos colores, ahora desde tokens) — verificación visual de las pantallas clave.
- Cambiar un token de color en `globals.css` se refleja en toda la UI.

## Cómo se ejecuta (para la próxima sesión)

1. `writing-plans` sobre este spec → plan TDD-ish por grupos de archivos (p. ej.
   home + componentes; pantallas de juego; pago/recover; leaderboard/agents).
2. Ejecutar con `subagent-driven-development`: cada tarea reemplaza hex→token en su
   grupo, corre `typecheck:web`, y un review confirma que no quedó hex suelto y que
   no cambió el look. Branch `feat/ui-tokens`.

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
