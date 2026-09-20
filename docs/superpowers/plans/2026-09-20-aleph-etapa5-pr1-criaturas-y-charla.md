# Aleph — Etapa 5, PR 1 de 2: las criaturas y la charla Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/aleph/[roomId]` le ponga cara a cada asiento —una criatura de pixel art de 16×16 que sale de la dirección de la wallet y no cambia nunca— con el oro del bolsillo dentro del cuerpo y el chip de estado al lado, y que la charla pública aparezca por primera vez como terminal, viva y también desclasificada cuando la sala liquida.

**Architecture:** Todo pasa en `apps/web`, sobre datos que el árbitro ya publica. El corazón es `nucleo/criatura.ts`: un módulo **puro y sin un solo import** que convierte una dirección en una lista de nodos `{x, y, w, h, fill}` sobre una grilla de 16×16. Encima van dos módulos puros más (`nucleo/estados.ts`, `nucleo/charla.ts`) y dos componentes que solo mapean esas listas a JSX (`Criatura.tsx`, `Charla.tsx`). Los puros viven un nivel más adentro, en `nucleo/`, porque en un filesystem que no distingue mayúsculas `criatura.ts` al lado de `Criatura.tsx` hace que el componente se importe a sí mismo (desvío 9). La página sigue siendo el único archivo con el sondeo, `useT`, `playerLabel` y el alias `@/`. **No hay escena todavía**: la lista de asientos de hoy sigue siendo una lista vertical y la grilla llega en PR2.

**Tech Stack:** TypeScript estricto, React 19 / Next 16 (App Router, `"use client"` solo en la página), SVG inline con `shapeRendering="crispEdges"`, Tailwind v4 + `globals.css`, i18n propia de la web (4 idiomas con paridad forzada por test), `node:test` + `assert/strict` sin DOM ni dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-19-aleph-etapa5-espectador-visual-design.md`, y dentro de él: "La criatura", "De qué dato sale cada estado", "La charla, como terminal", "Movimiento y accesibilidad", "Arquitectura", "Tests" y "Etapas de construcción → PR1 — el recorte". El plan argumenta desde el spec; **el ejecutor lee los dos**. Desvíos deliberados, con su razón:

1. **`criatura.ts` exporta dos funciones que el spec no nombra: `capaDeIdentidad(rasgos, opts)` y `capaDeCara(rasgos)`.** El spec nombra `rasgosDe`, `nodosDe`, `capaDeEstado` y `svgDeCriatura`, y dice "y las ocho tablas más `COLORES_DE_ESTADO`" — no prohíbe más. Hacen falta por dos tests que el spec pide y que sin ellas no se pueden escribir bien: el test 2 exige "ningún nodo de la **capa de identidad** tiene `y < 3`", que solo se puede comprobar si esa capa existe como valor; y el test 18 exige comparar dos criaturas selladas "quitándole la capa de identidad", y quitarla por valor (restar los nodos iguales) da un falso negativo cuando la boca de identidad de una dirección coincide píxel por píxel con la boca fija del estado — pasa de verdad, con `boca = 1` (línea). Con `capaDeIdentidad` se quita por longitud y el test es exacto. Se comprobó corriendo las dos versiones.
2. **`criatura.ts` exporta `filasDeOro(bolsillo, maxBolsillo)`.** Es la fórmula del spec ("El oro del bolsillo") en un solo lugar, para que ni la página ni `Criatura.tsx` la puedan escribir distinto. El test 9 la prueba directo.
3. **`capaDeEstado` recibe un tercer argumento, `filasDoradas: Set<number>`.** El spec pide que el píxel central del dorso se compare **fila a fila** contra el oro, y `capaDeEstado` es quien dibuja el dorso. El conjunto de filas doradas no identifica a nadie (sale del bolsillo, que ya es público y ya se ve dibujado), así que la promesa del test 18 —el sello no ve la dirección— se mantiene: `nodosDe` le pasa SIEMPRE el set real, pero `capaDeEstado` solo lo lee adentro de `dorsoDeAleph`, o sea únicamente en `votado` y `abandono`; los otros seis estados devuelven exactamente lo mismo con el set lleno o vacío. El test 18 lo pincha con un barrido de los seis estados × las nueve cantidades de filas.
4. **El centro del dorso es un rect de 2×2 y pasa a ink si CUALQUIERA de sus dos filas ya quedó dorada.** El spec dice que el caso "empieza a las cuatro o a las cinco filas de oro" según en cuál de las dos filas centrales caiga el píxel, dando por hecho que el desplazamiento del votado cambia la respuesta. No la cambia: el dorso baja una fila **junto con el cuerpo**, así que relativo al cuerpo cae siempre en los mismos índices (3 a 8) y el umbral es el mismo en las dos variantes. Lo que sí se implementa es exactamente lo que el spec ordena —comparar fila a fila, nunca un umbral escrito a mano—, y el test lo comprueba en `votado` **y** en `abandono` con 0 a 8 filas de oro. Medido: el centro se va a ink a partir de 4 filas, en las dos.
5. **`Criatura.tsx` suma la prop `respira?: boolean`.** El spec pide `aleph-respira` "siempre, solo en los vivos", y el componente no puede saber si un asiento está vivo: `base` también es el reposo de un `finished` en una sala liquidada y de un asiento en `lobby`. Derivarlo del estado se equivocaría en silencio; la página, que tiene `room.status` y `seat.status`, lo dice con todas las letras.
6. **`aleph.chat.caps` va como nota muted adentro del panel, no como chip en la barra de ventana.** El spec lo pone "a la derecha de la barra". Esa barra es `display: flex; justify-content: space-between` sin `flex-wrap` (`globals.css:184-196`) y `.win` tiene `overflow: hidden` (`:180`): un chip con una frase de 70 caracteres a 375 px no envuelve, se corta y se pierde el texto. Mismo texto, mismo lugar en el orden de lectura, un renglón más abajo. `body` ya lleva `overflow-x: clip` (`globals.css:71`), así que lo que se pierde es la información, no el scroll.
7. **La insignia `+{n}` del que se fue con plata NO entra en PR1.** El spec la nombra en la tabla de estados, pero PR1 solo pide "la criatura, el oro del bolsillo y el chip de estado (o dos, si hay marca de traidor)", su "Listo cuando" no la menciona, y el test que la cubre —la Oferta anulada del test 13— está asignado explícitamente a PR2. Su chip (`aleph.seat.left`) sí sale, por `chipDeAsiento`.
8. **`Criatura.tsx` y `Charla.tsx` no tienen test de render.** El repo no tiene harness de DOM: `apps/web/test/` es todo `node:test` sin React, y el spec lo dice con todas las letras ("Sin React, sin DOM, sin dependencias nuevas… Lo que los tests miran son los nodos, no el string que produce React"). Los dos componentes son mapeadores de una lista que ya está probada (`nodosDe`, `lineasDeCharla`). Su gate es `typecheck` + `lint` + `build` y la verificación visual de la Task 9.
9. **Los módulos puros van en `apps/web/app/components/aleph/nucleo/`, no sueltos al lado de los componentes.** El spec los lista todos en la misma carpeta (`criatura.ts` junto a `Criatura.tsx`, `charla.ts` junto a `Charla.tsx`), y eso **no compila en la máquina del dueño**: el filesystem de macOS no distingue mayúsculas (`ls apps/web/app/components/header.tsx` encuentra `Header.tsx`) y TypeScript prueba `.ts` antes que `.tsx`, así que `import { Criatura } from "@/app/components/aleph/Criatura"` resuelve a `criatura.ts`. Reproducido con el `tsc` del repo y el mismo `tsconfig.json` de `apps/web`: `TS2305: Module '"./aleph/Criatura"' has no exported member 'Criatura'` más `TS1261 … differs from file name … only in casing`, exit 2. Peor todavía, webpack compila el self-import sin quejarse (`nodosDe` queda `undefined` en runtime) y el typecheck recién revienta cuando `page.tsx` los importa desde otro directorio, o sea en la Task 8, con siete tareas ya commiteadas y un mensaje que no nombra la causa. La mudanza a `nucleo/` **conserva los dos nombres que el spec fija**, no toca una sola firma, y le sirve igual a PR2, que arrastra el mismo choque con `escena.ts`/`Escena.tsx`. Comprobado: con este layout `tsc` da exit 0.
10. **El presupuesto de identidad da 23, no 24, y el peor caso son 39 nodos, no los 40 de la tabla del spec.** La fila 14 no es un nodo aparte: es el índice 9 del cuerpo, pintado en la sombra de la familia (o en oro, cuando le toca). Sigue holgadamente dentro del tope duro de 40, y los dos peores casos medidos son `ganador + traidor` y `esperando + traidor`, los dos en 39.
11. **Con el bolsillo máximo queda UNA fila de identidad arriba del oro, no dos.** El spec promete, en "El oro del bolsillo", que «las dos filas de arriba siempre muestran el color de identidad», y a la vez que la regla D ponga «1 px de `--color-ink` encima» de la fila más alta de oro. En una grilla de 16 donde cada fila del cuerpo mide exactamente 1 px, ese borde **es** una fila del cuerpo: con `filas = 8` queda la fila 0 en color de identidad, la 1 en tinta y las ocho de abajo en oro. Se elige cumplir la regla D —que es la que tiene test y la que hace legible el bolsillo sobre `--color-surface-2`, donde los ocho cuerpos dan 2,84:1— y se documenta que arriba del oro queda una fila de identidad más el borde. La intención del spec (que la criatura nunca quede enteramente dorada al lado de un pozo dorado) se cumple igual, y mejor: hay una banda negra que la separa. Con 7 filas de oro quedan las dos. El test 9 lo dice en un comentario y la Task 9 Step 4 lo mira a ojo.
12. **El `>` de la terminal va en coral en TODAS las líneas, también en los susurros.** El spec se contradice a sí mismo: "La charla, como terminal" describe el renglón normal con «el `>` en coral», y "La liquidación" pide para el susurro «prefijo coral en vez de cyan», que da por hecho que el público es cyan. Gana la primera, que es la que describe la línea directamente; y además el cyan ya está tomado en la terminal por `.charla-etapa` (los separadores) y `.charla-sistema` (la línea del canal privado): pintar de cyan el prefijo de cada mensaje llenaría la ventana del acento que justamente marca lo que NO es un mensaje. Al susurro le quedan las otras tres señales del spec, que alcanzan y sobran: borde izquierdo coral, chip `SUSURRO` y `aleph.chat.whisperTo`. Y ese chip va `.chip` a secas, **no** `.chip--danger`: el spec reserva las dos únicas excepciones de color para la insignia `+{n}` (gold) y el chip del traidor (danger), y `chip--danger` es `--color-lose #f0716f`, rojo, no coral.
13. **`aleph-respira` va `steps(2, jump-none)` y no el `steps(2)` de la tabla del spec.** `steps(2)` es `steps(2, jump-end)`: dentro de cada tramo de la animación la salida toma los valores 0 y 0,5, o sea que el cuerpo se queda medio píxel arriba. Medio píxel en una grilla de 16 dibujada con `crispEdges` es exactamente el puré antialiaseado que el spec fue a evitar en el votado. Con `jump-none` los valores son 0 y 1, los dos cuadros quedan en 0 y -1px enteros, y es lo que el spec pide en palabras dos líneas más arriba de la tabla ("la criatura sube y baja 1 px").

## Global Constraints

- Rama: `feat/aleph-etapa5-espectador` (ya existe, y este worktree ya está parado ahí). **`main` no acepta push directo**: va por PR con los 2 checks de CI, y **el merge lo hace el dueño desde GitHub**.
- **Solo se toca `apps/web`.** No se toca `apps/server`, `packages/game-sdk`, `packages/agent-sdk` ni `packages/contracts` — hay otra sesión trabajando en el árbitro.
- Todo lo nuevo vive en `apps/web/app/components/aleph/`, con **imports relativos y sin el alias `@/`**, sin `wagmi`, sin el hook `useT` y sin `wallet.tsx`: así se importan desde `apps/web/test/*.test.ts` con `node --test`, sin DOM ni configuración nueva. Los textos entran por props (`t`) y las etiquetas de wallet llegan ya armadas. Los **módulos puros** (`criatura.ts`, `estados.ts`, `charla.ts`) van un nivel más adentro, en `apps/web/app/components/aleph/nucleo/`; los **componentes** (`Criatura.tsx`, `Charla.tsx`) quedan en `aleph/`.
- **En `apps/web` no puede haber dos archivos en el MISMO directorio cuyo nombre difiera solo en la caja.** El macOS del dueño no distingue mayúsculas y TypeScript/Next prueban `.ts` antes que `.tsx`: `criatura.ts` al lado de `Criatura.tsx` hace que el componente se importe a sí mismo. Es la razón de la carpeta `nucleo/` (desvío 9). Comprobación barata, en la Task 1 y de nuevo en la Task 8: `for d in apps/web/app/components/aleph apps/web/app/components/aleph/nucleo; do ls "$d" | tr 'A-Z' 'a-z' | sort | uniq -d; done` tiene que salir vacío.
- **`criatura.ts` es puro y sin un solo import.** Sus nodos llevan el `fill` ya resuelto como hex literal, nunca `var(...)`: los tests lo leen sin DOM.
- **Nada de texto dentro del SVG.** Ni `<text>`, ni `<title>`, ni `<clipPath>`, ni gradientes. Todo rótulo es HTML traducible (Press Start 2P no tiene glifos devanagari y el sitio se sirve en hindi).
- **Zonas de la grilla, regla dura con test**: ningún nodo de la capa de identidad puede tener `y < 3`, y ningún overlay de cabeza puede tener `y > 2`.
- **Siluetas**: diez medios anchos, máximo **6**, y **nunca menos de 4 entre los índices 3 y 8** del cuerpo.
- **Presupuesto de nodos**: identidad **≤ 24**, cara **≤ 9**, overlay de estado **≤ 9**, y **tope duro de 40 nodos** en cualquier combinación de estado y marca.
- **Paleta**: ningún valor de identidad puede ser `--color-gold #f2c14e`, `--color-lime #b8e08a`, `--color-win #5fd68a` ni `--color-lose #f0716f`; todo color de cuerpo cae en la **ventana de luminancia [0,136 – 0,158]**; los secundarios tienen **saturación HSL ≤ 0,18**. Tokens que sí se usan: `--color-ink #0e0b13`, `--color-text-strong #fffdf7`, `--color-accent #e8845e`, `--color-accent-2 #6cc9da`, `--color-muted-bright #ded8cb`, `--color-surface #1f1a29`, `--color-surface-2 #292236`, y `#a97f1e` para la sombra de la corona dorada.
- **Regla D**: la fila más alta de oro lleva 1 px de `--color-ink` encima, y la fila 14 y las patas se pintan en `#f2c14e` cuando les toca oro (nunca en `#a97f1e`, que contra los ocho cuerpos da 1,46:1).
- **Combinaciones: 8⁷ × 4 = 8.388.608.** Las ocho tablas son potencias de dos y se leen con `byte & 7` (o `& 3`), nunca con `%`.
- **Tamaños de criatura, múltiplos de 16**: mesa 48 px y charla 32 px en PR1 (el corte de contenedor de 560 px y los 64/96 px llegan en PR2).
- **i18n**: los 4 diccionarios (`es`, `en`, `fr`, `hi`) tienen **exactamente** las mismas claves, y lo fija `apps/web/test/i18n.test.ts`. Las traducciones se escriben de verdad en los cuatro; nada de placeholders.
- **`prefers-reduced-motion`**: la clase nueva se suma al bloque que ya existe (`globals.css:416-432`) con `animation: none`, y ninguna animación esconde su estado final.
- **En vivo no se insinúa un solo secreto**: solo se sabe quién actuó, nunca qué hizo, y de los susurros no se dice ni que existieron.
- **No escribir secuencias `\u` (backslash-u) en ningún archivo ni parámetro.** El hindi va en devanagari de verdad.
- Estilo del repo: **comentarios en español**, identificadores en inglés salvo los nombres que el spec fija en español (`rasgosDe`, `nodosDe`, `capaDeEstado`, `svgDeCriatura`, `estadoDeAsiento`, `chipDeAsiento`, `lineasDeCharla`, `COLORES_DE_ESTADO`, `FAMILIAS`, `SECUNDARIOS`, `SILUETAS`, `CORONAS`, `MARCAS`, `ACCESORIOS`, `OJOS`, `BOCAS`).
- **Este archivo ya está prettier-clean, y tiene que seguir estándolo.** `docs/` no está en `.prettierignore`, así que `npm run format:check` (que es `prettier --check .`) también lo mira: un plan sin formatear pinta de rojo la PRIMERA compuerta, la de la Task 1 Step 5, sin que el ejecutor haya tocado una línea de código. Lleva seis marcadores `<!-- prettier-ignore -->`, arriba de los seis bloques de CSS y de TSX de la Task 8, cuya indentación es informativa (el CSS va adentro de `@layer components` y el TSX adentro del cuerpo de la función) y que prettier desindentaría: **no sacarlos**. Si alguna vez hay que reformatear el plan, `npx prettier --write` sobre ese archivo y nada más.
- Cada tarea termina en verde: `npm run typecheck:web && npm run lint && npm run format:check` y el test del archivo tocado. El `typecheck` completo no hace falta por tarea: PR1 no toca `apps/server`, `apps/mcp` ni `packages/*`. Antes del último commit sí, `npm run check` completo —que corre el `typecheck` de todo— y `npm run build --workspace apps/web`. **Si `format:check` falla, `npx prettier --write` SOLO sobre los archivos de `apps/web` que tocó la tarea, nunca `npm run format`**: `prettier --write .` reescribe todo el repo, incluido este plan, y le come la indentación a los bloques de la Task 8.
- Commits chicos, mensajes en español con prefijo (`feat(web): …`, `test(web): …`) y el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, que es la atribución de la sesión que dirige esta etapa (la misma que firmó el spec, commit `883cccc`). Si otra sesión retoma el plan, manda la suya: se cambia el nombre, no el formato.

---

## File structure

| Archivo                                                    | Responsabilidad                                                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/components/aleph/nucleo/criatura.ts` (crear) | Puro, cero imports. Las ocho tablas, la paleta, `rasgosDe`, `filasDeOro`, `capaDeIdentidad`, `capaDeCara`, `capaDeEstado`, `nodosDe`, `svgDeCriatura` |
| `apps/web/app/components/aleph/Criatura.tsx` (crear)       | Mapea `nodosDe(...)` a `<rect>`. **No dibuja nada propio**: un píxel fuera de `criatura.ts` es un bug de revisión                                     |
| `apps/web/app/components/aleph/nucleo/estados.ts` (crear)  | Puro. `estadoDeAsiento(seat, room)` con la tabla de prioridades y la marca de traidor, y `chipDeAsiento(seat, room)` con la tabla del chip            |
| `apps/web/app/components/aleph/nucleo/charla.ts` (crear)   | Puro. `lineasDeCharla(room)`: las líneas de la terminal, ya filtradas, agrupadas por etapa y marcadas; `null` si no hay `messages`                    |
| `apps/web/app/components/aleph/Charla.tsx` (crear)         | La terminal, viva y desclasificada; dibuja lo que le da `lineasDeCharla`                                                                              |
| `apps/web/app/aleph/[roomId]/page.tsx` (modificar)         | `SeatRow` con criatura, oro y chips; el contador "ya actuaron k de n"; monta `<Charla destello={null} />`                                             |
| `apps/web/app/globals.css` (modificar)                     | `@keyframes aleph-respira` + su rama de `prefers-reduced-motion`, los tamaños de `.criatura--*` y las clases de la terminal                           |
| `apps/web/app/lib/i18n/{es,en,fr,hi}.ts` (modificar)       | Las 19 claves nuevas de PR1, en los 4 idiomas                                                                                                         |
| `apps/web/test/aleph-ayuda.ts` (crear)                     | PRNG con semilla fija y generador de direcciones de prueba, compartido por los dos archivos de test                                                   |
| `apps/web/test/aleph-criatura.test.ts` (crear)             | Tests 1 a 9 del spec: determinismo, grilla y zonas, tope de nodos, paleta, variedad, robustez, los ocho estados con su etiqueta y su chip, el oro     |
| `apps/web/test/aleph-secretos.test.ts` (crear)             | Tests 17 a 20 del spec: solo lo cerrado, el sello idéntico, sin susurros en vivo, la charla no inventa                                                |
| `apps/web/test/i18n.test.ts` (modificar)                   | Dos tests más: las 19 claves de la etapa 5 en los 4 idiomas (con sus variables), y los ocho textos de estado distintos entre sí                       |

---

### Task 1: `criatura.ts` — las ocho tablas, la paleta y la capa de identidad

**Files:**

- Create: `apps/web/app/components/aleph/nucleo/criatura.ts`
- Create: `apps/web/test/aleph-ayuda.ts`
- Test: `apps/web/test/aleph-criatura.test.ts` (crear)

**Interfaces:**

- Consumes: nada.
- Produces:
  - `interface Nodo { x: number; y: number; w: number; h: number; fill: string }`
  - `interface Rasgos { silueta: number; ojos: number; corona: number; boca: number; marca: number; accesorio: number; familia: number; secundario: number; desfase: number; desconocida: boolean }`
  - `interface Familia { nombre: string; cuerpo: string; sombra: string }`
  - `FAMILIAS: readonly Familia[]` (8), `SECUNDARIOS: readonly string[]` (4), `DESCONOCIDA: Familia`
  - `COLORES_DE_ESTADO: { tinta; ojo; cyan; coral; globo; oro; oroSombra }` (todos `string`)
  - `SILUETAS: readonly (readonly number[])[]` (8 × 10)
  - `CORONAS`, `MARCAS`, `ACCESORIOS`: `readonly ((hw: readonly number[], color: string) => Nodo[])[]` (8 cada una)
  - `OJOS`, `BOCAS`: `readonly (() => Nodo[])[]` (8 cada una)
  - `rasgosDe(address: string | null | undefined): Rasgos`
  - `filasDoradas(filas: number): Set<number>` (los `y` absolutos del cuerpo que el oro ya pintó)
  - `OPACIDAD_DE_ESTADO: Readonly<Record<string, number>>` (`se_fue` 0,8 y `abandono` 0,34; no es un nodo, es el atributo `opacity` del `<svg>`)
  - `capaDeIdentidad(rasgos: Rasgos, opts?: { filas?: number; conPatas?: boolean }): Nodo[]`
  - `capaDeCara(rasgos: Rasgos): Nodo[]`
  - De `apps/web/test/aleph-ayuda.ts`: `azarDePrueba(semilla: number): () => number` y `direcciones(n: number, semilla: number): string[]`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/test/aleph-ayuda.ts`:

```ts
// Ayudas de los tests de Aleph. El azar es DECORATIVO y con semilla fija: los
// números no bailan entre corridas. Nada de esto toca al azar del juego, que
// sale de SHA-256 del secreto (reglas v2) y vive en el game-sdk.

/** PRNG barato con semilla explícita. Solo para fabricar fixtures. */
export function azarDePrueba(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` direcciones hex válidas, siempre las mismas para la misma semilla. */
export function direcciones(n: number, semilla: number): string[] {
  const azar = azarDePrueba(semilla);
  const salida: string[] = [];
  for (let i = 0; i < n; i++) {
    let hex = "0x";
    for (let j = 0; j < 40; j++) hex += "0123456789abcdef"[Math.floor(azar() * 16)];
    salida.push(hex);
  }
  return salida;
}
```

Crear `apps/web/test/aleph-criatura.test.ts`:

```ts
// El GENERADOR de criaturas. Los tests miran los nodos, que son la única fuente
// de verdad: `Criatura.tsx` mapea esa lista a <rect> y `svgDeCriatura` la
// serializa, así que los dos consumen lo mismo y no pueden divergir.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAMILIAS,
  SECUNDARIOS,
  DESCONOCIDA,
  SILUETAS,
  CORONAS,
  MARCAS,
  ACCESORIOS,
  OJOS,
  BOCAS,
  rasgosDe,
  capaDeIdentidad,
  capaDeCara,
} from "../app/components/aleph/nucleo/criatura.js";
import { direcciones } from "./aleph-ayuda.js";

const SURFACE = "#1f1a29";
const COLORES_DE_ESTADO_DEL_SITIO = ["#f2c14e", "#b8e08a", "#5fd68a", "#f0716f"];

/** Luminancia relativa de WCAG, escrita acá para no depender de nada. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Contraste de WCAG entre dos hex. */
function contraste(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alto + 0.05) / (bajo + 0.05);
}

/** Saturación HSL. */
function saturacion(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...c);
  const min = Math.min(...c);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

test("las ocho tablas: largo, medios anchos y la franja de hw >= 4", () => {
  assert.equal(SILUETAS.length, 8);
  for (const tabla of [CORONAS, MARCAS, ACCESORIOS, OJOS, BOCAS]) assert.equal(tabla.length, 8);
  assert.equal(FAMILIAS.length, 8);
  assert.equal(SECUNDARIOS.length, 4);
  for (const [i, hw] of SILUETAS.entries()) {
    assert.equal(hw.length, 10, `silueta ${i}`);
    for (const [j, v] of hw.entries()) {
      assert.ok(v >= 2 && v <= 6, `silueta ${i} fila ${j}: hw=${v} fuera de [2, 6]`);
      if (j >= 3 && j <= 8)
        assert.ok(v >= 4, `silueta ${i} fila ${j}: hw=${v} < 4 en la franja 3-8`);
    }
  }
});

test("4. la paleta no toca los colores de estado y el oro se lee sobre los nueve cuerpos", () => {
  for (const cuerpo of [...FAMILIAS.map((f) => f.cuerpo), DESCONOCIDA.cuerpo]) {
    const l = luminancia(cuerpo);
    assert.ok(
      l >= 0.136 && l <= 0.158,
      `${cuerpo}: luminancia ${l.toFixed(4)} fuera de la ventana`,
    );
    const oro = contraste(cuerpo, "#f2c14e");
    assert.ok(oro >= 3, `${cuerpo}: el oro del bolsillo da ${oro.toFixed(2)}:1`);
    const fondo = contraste(cuerpo, SURFACE);
    assert.ok(fondo >= 3, `${cuerpo}: contra --color-surface da ${fondo.toFixed(2)}:1`);
  }
  const paleta = [
    ...FAMILIAS.map((f) => f.cuerpo),
    ...FAMILIAS.map((f) => f.sombra),
    ...SECUNDARIOS,
    DESCONOCIDA.cuerpo,
    DESCONOCIDA.sombra,
  ];
  for (const c of paleta)
    assert.ok(!COLORES_DE_ESTADO_DEL_SITIO.includes(c), `${c} es un color de estado (regla A)`);
  for (const s of SECUNDARIOS) {
    assert.ok(saturacion(s) <= 0.18, `secundario ${s}: saturación ${saturacion(s).toFixed(3)}`);
    assert.ok(contraste(s, SURFACE) >= 4, `secundario ${s}: ${contraste(s, SURFACE).toFixed(2)}:1`);
  }
  assert.equal(saturacion(DESCONOCIDA.cuerpo), 0, "el gris de la desconocida tiene que ser neutro");
});

test("5. variedad: 8.388.608 combinaciones y pocas colisiones sobre 20.000 direcciones", () => {
  const tablas = [SILUETAS, OJOS, CORONAS, BOCAS, MARCAS, ACCESORIOS, FAMILIAS, SECUNDARIOS];
  const combinaciones = tablas.reduce((n, t) => n * t.length, 1);
  assert.equal(combinaciones, 8388608);
  assert.ok(combinaciones >= 1000000);
  const vistos = new Set<string>();
  let colisiones = 0;
  for (const a of direcciones(20000, 99)) {
    const r = rasgosDe(a);
    const clave = [
      r.silueta,
      r.ojos,
      r.corona,
      r.boca,
      r.marca,
      r.accesorio,
      r.familia,
      r.secundario,
    ].join("-");
    if (vistos.has(clave)) colisiones++;
    vistos.add(clave);
  }
  assert.ok(
    colisiones <= 40,
    `colisiones exactas: ${colisiones} (con la semilla 99 son 16; el techo es 40)`,
  );
});

test("7. robustez: cualquier basura da la criatura desconocida y no tira", () => {
  const basuras = ["", "0x", "0x123", "0xZZ", "no soy una address", "0x" + "g".repeat(40)];
  for (const basura of basuras) {
    const r = rasgosDe(basura);
    assert.equal(r.desconocida, true, `rasgosDe(${JSON.stringify(basura)})`);
    assert.equal(r.silueta, 0);
    assert.doesNotThrow(() => capaDeIdentidad(r, { filas: 8 }));
  }
  assert.equal(rasgosDe(null).desconocida, true);
  assert.equal(rasgosDe(undefined).desconocida, true);
  // Sin corona ni accesorio: no hay un solo nodo arriba del cuerpo (y < 5).
  const nodos = capaDeIdentidad(rasgosDe("0x"), { filas: 0 });
  assert.equal(nodos.filter((n) => n.y < 5).length, 0);
  assert.ok(nodos.every((n) => n.fill === DESCONOCIDA.cuerpo || n.fill === DESCONOCIDA.sombra));
});

test("presupuesto: identidad <= 24 nodos y nunca y < 3; cara <= 9", () => {
  for (const a of direcciones(2000, 31415)) {
    const r = rasgosDe(a);
    for (const filas of [0, 1, 4, 8]) {
      for (const conPatas of [true, false]) {
        const identidad = capaDeIdentidad(r, { filas, conPatas });
        assert.ok(identidad.length <= 24, `capa de identidad: ${identidad.length} nodos`);
        for (const n of identidad) assert.ok(n.y >= 3, `identidad con y=${n.y} (zona de estado)`);
      }
    }
    assert.ok(capaDeCara(r).length <= 9);
  }
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts`
Expected: FAIL con `Cannot find module '.../app/components/aleph/nucleo/criatura.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `apps/web/app/components/aleph/nucleo/criatura.ts` (este es el archivo entero de la Task 1; la Task 2 le agrega `capaDeEstado`, `nodosDe` y `filasDeOro` al final, y la Task 3 le agrega `svgDeCriatura`):

```ts
// LA CRIATURA de un asiento de Aleph: pixel art de 16x16 que sale de la
// dirección de la wallet y no cambia nunca, en ninguna sala. Misma técnica y
// mismo vocabulario que `Logo.tsx` (un <rect> por píxel, `crispEdges`).
//
// Este módulo es PURO y NO IMPORTA NADA: los tests lo leen sin DOM, y por eso
// los nodos llevan el `fill` ya resuelto como hex literal, nunca `var(...)`.
//
// Dos capas que no se tocan nunca: IDENTIDAD (silueta, color, corona, marca,
// accesorio), que sale de la dirección, y ESTADO (ojos, boca, overlay), que
// sale del estado del asiento y NO ve la dirección. Zonas fijas de la grilla:
//
//   y 0-2   overlays de estado sobre la cabeza (corona dorada, globo, sello…)
//   y 3-4   corona de identidad: dos filas, nunca más
//   y 5-14  cuerpo: diez filas, un <rect> por fila
//   y 7-9   ojos        y 11-12  boca
//   y 14    última fila del cuerpo, en la sombra de la familia
//   y 15    patas: dos rects colgados del hw de la fila 14

/** Un píxel (o una tira de píxeles) de la grilla de 16x16. */
export interface Nodo {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/** Los ocho rasgos que salen de la dirección, más el desfase de la respiración. */
export interface Rasgos {
  silueta: number;
  ojos: number;
  corona: number;
  boca: number;
  marca: number;
  accesorio: number;
  familia: number;
  secundario: number;
  /** Byte 11: el primero que no usa ningún rasgo. Solo mueve la respiración. */
  desfase: number;
  /** La dirección no validó: criatura desconocida, gris y sin adornos. */
  desconocida: boolean;
}

export interface Familia {
  nombre: string;
  cuerpo: string;
  sombra: string;
}

// --- La paleta de identidad -------------------------------------------------
// Regla B: todo cuerpo cae en la ventana de luminancia [0,136 - 0,158]. El piso
// hace que el cuerpo dé 3:1 contra --color-surface; el techo hace que el oro
// del bolsillo dé 3:1 CONTRA el cuerpo. Regla A: ninguno es gold, lima, win ni
// lose. La marca del cuerpo usa la sombra de la propia familia, nunca el
// secundario, así se lee sea cual sea el cuerpo.

export const FAMILIAS: readonly Familia[] = [
  { nombre: "coral apagado", cuerpo: "#935d4c", sombra: "#5c3a2f" },
  { nombre: "cyan apagado", cuerpo: "#3f727c", sombra: "#294a51" },
  { nombre: "ciruela", cuerpo: "#736298", sombra: "#443a5a" },
  { nombre: "marfil apagado", cuerpo: "#706a60", sombra: "#4f4a43" },
  { nombre: "musgo", cuerpo: "#617048", sombra: "#3c452d" },
  { nombre: "óxido", cuerpo: "#935e3e", sombra: "#503322" },
  { nombre: "acero", cuerpo: "#5c6c81", sombra: "#333c48" },
  { nombre: "vino", cuerpo: "#9c5569", sombra: "#4f2b35" },
];

/** Regla C: neutros (saturación <= 0,18) para que la corona se lea contra el
 *  fondo sin competir con ningún color de estado. */
export const SECUNDARIOS: readonly string[] = ["#e4e1da", "#c2bdb3", "#9c97a3", "#7f8a86"];

/** La criatura desconocida. El gris cumple la regla B como cualquier familia
 *  (luminancia 0,147) y tiene saturación 0, así que no se confunde con
 *  ninguna de las ocho. NO se usa el #7a7368 de la maqueta, que está en 0,174:
 *  queda fuera de la ventana y el oro le da 2,79:1. */
export const DESCONOCIDA: Familia = {
  nombre: "desconocida",
  cuerpo: "#6b6b6b",
  sombra: "#3f3f3f",
};

/** Los colores que NO son de identidad: cara y overlays. Las reglas A a C no
 *  los gobiernan, justamente porque no son identidad. Son los mismos hex que
 *  el sitio ya usa en sus tokens. */
export const COLORES_DE_ESTADO = {
  /** --color-ink: contorno de ojos y boca, el borde de la regla D, el anillo del dorso */
  tinta: "#0e0b13",
  /** --color-text-strong: el blanco del ojo */
  ojo: "#fffdf7",
  /** --color-accent-2: los puntitos de `esperando` y el sello de `sellado` */
  cyan: "#6cc9da",
  /** --color-accent: la grieta del traidor y el segundo ojo que asoma */
  coral: "#e8845e",
  /** --color-muted-bright: el globo de `hablando` */
  globo: "#ded8cb",
  /** --color-gold: el oro del bolsillo, la moneda de `se_fue`, la corona de `ganador` */
  oro: "#f2c14e",
  /** La sombra de la corona dorada. Va sobre el fondo de la tarjeta, NUNCA
   *  sobre el cuerpo: contra los ocho cuerpos da entre 1,46:1 y 1,47:1. */
  oroSombra: "#a97f1e",
} as const;

/** La criatura se dibuja más apagada en dos estados. No es un nodo: es el
 *  atributo `opacity` del <svg>. */
export const OPACIDAD_DE_ESTADO: Readonly<Record<string, number>> = {
  se_fue: 0.8,
  abandono: 0.34,
};

// --- La grilla --------------------------------------------------------------

/** Primera fila del cuerpo. */
const Y0 = 5;

/** `y` absoluto de la fila `i` del cuerpo (0 a 9), sin el desplazamiento del votado. */
const fy = (i: number): number => Y0 + i;

const nodo = (x: number, y: number, w: number, h: number, fill: string): Nodo => ({
  x,
  y,
  w,
  h,
  fill,
});

const T = COLORES_DE_ESTADO.tinta;
const O = COLORES_DE_ESTADO.ojo;

/** Siluetas: medio ancho por fila, diez filas. La fila `i` va de `x = 8 - hw[i]`
 *  a `x = 8 + hw[i]`. Máximo 6 (el cuerpo nunca pasa de x=2 a x=13) y nunca
 *  menos de 4 entre los índices 3 y 8: es el piso que hace que el dorso de 8x6
 *  entre inscripto en cualquiera de las ocho. */
export const SILUETAS: readonly (readonly number[])[] = [
  [3, 4, 5, 5, 5, 5, 5, 5, 4, 4], // 0 gota
  [2, 3, 4, 4, 4, 4, 4, 4, 4, 3], // 1 alto
  [3, 4, 5, 5, 5, 5, 5, 4, 4, 3], // 2 redondo
  [4, 5, 6, 6, 6, 6, 6, 6, 5, 4], // 3 ancho
  [2, 3, 4, 4, 5, 6, 6, 6, 5, 4], // 4 pera
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 4], // 5 ladrillo
  [5, 6, 6, 5, 4, 4, 4, 4, 4, 3], // 6 hongo
  [3, 3, 4, 5, 5, 5, 5, 5, 5, 5], // 7 torre
];

/** Coronas de identidad: SOLO y = 3 y 4 (la fila 2 es de la zona de estado, y
 *  sin esa separación la corona dorada del ganador taparía justo el rasgo que
 *  lo hace reconocible). Se cuelgan del borde real del cuerpo (`hw[0]`), no de
 *  una posición fija: es lo que evita que floten afuera de una silueta angosta.
 *  Presupuesto: <= 4 nodos. */
export const CORONAS: readonly ((hw: readonly number[], color: string) => Nodo[])[] = [
  (hw, c) => [nodo(8, 4, 1, 1, c), nodo(7, 3, 2, 1, c)], // 0 antena
  (hw, c) => [
    // 1 cuernos
    nodo(8 - hw[0], 4, 1, 1, c),
    nodo(8 - hw[0] - 1, 3, 1, 1, c),
    nodo(8 + hw[0] - 1, 4, 1, 1, c),
    nodo(8 + hw[0], 3, 1, 1, c),
  ],
  (hw, c) => [nodo(8 - hw[0] - 1, 3, 1, 2, c), nodo(8 + hw[0], 3, 1, 2, c)], // 2 orejas
  (hw, c) => [nodo(7, 3, 2, 2, c), nodo(6, 4, 4, 1, c)], // 3 aleta
  (hw, c) => [nodo(7, 4, 1, 1, c), nodo(8, 3, 1, 1, c), nodo(9, 4, 1, 1, c)], // 4 penacho
  (hw, c) => {
    // 5 pinchos
    const e = Math.max(3, hw[0]);
    return [nodo(8 - e, 4, 1, 1, c), nodo(8, 3, 1, 1, c), nodo(8 + e - 1, 4, 1, 1, c)];
  },
  (hw, c) => [
    // 6 orejas caídas
    nodo(8 - hw[0] - 1, 3, 1, 1, c),
    nodo(8 - hw[0] - 2, 4, 1, 1, c),
    nodo(8 + hw[0], 3, 1, 1, c),
    nodo(8 + hw[0] + 1, 4, 1, 1, c),
  ],
  (hw, c) => [nodo(6, 3, 1, 2, c), nodo(9, 3, 1, 2, c), nodo(7, 4, 2, 1, c)], // 7 cresta doble
];

/** Marcas del cuerpo, en la SOMBRA de la propia familia. Se dibujan DESPUÉS del
 *  oro, así se leen igual sobre las filas doradas. Presupuesto: <= 3 nodos
 *  (bajó de 4: el nodo que pierde se lo lleva el borde de ink de la regla D,
 *  que es el que hace legible el bolsillo). */
export const MARCAS: readonly ((hw: readonly number[], color: string) => Nodo[])[] = [
  () => [], // 0 liso
  (hw, c) => {
    // 1 panza
    const m = Math.min(hw[7], hw[8]);
    return [nodo(8 - (m - 2), fy(7), 2 * (m - 2), 2, c)];
  },
  (hw, c) => [nodo(5, fy(5), 1, 1, c), nodo(10, fy(8), 1, 1, c), nodo(7, fy(1), 1, 1, c)], // 2 lunares
  (hw, c) => [
    // 3 rayas
    nodo(8 - hw[5], fy(5), 2 * hw[5], 1, c),
    nodo(8 - hw[8], fy(8), 2 * hw[8], 1, c),
  ],
  (hw, c) => [nodo(8 - (hw[2] - 1), fy(2), 2 * (hw[2] - 1), 1, c)], // 4 antifaz
  (hw, c) => [
    // 5 cinturón
    nodo(8 - hw[7], fy(7), 2 * hw[7], 1, c),
    nodo(6, fy(6), 4, 1, c),
  ],
  (hw, c) => [nodo(6, fy(5), 4, 1, c), nodo(5, fy(6), 6, 1, c)], // 6 pecho
  (hw, c) => [
    // 7 media cara
    nodo(8 - hw[2], fy(2), hw[2], 1, c),
    nodo(8 - hw[3], fy(3), hw[3], 1, c),
    nodo(8 - hw[4], fy(4), hw[4], 1, c),
  ],
];

/** Accesorios, en el color secundario. Presupuesto: <= 3 nodos. */
export const ACCESORIOS: readonly ((hw: readonly number[], color: string) => Nodo[])[] = [
  () => [], // 0 ninguno
  (hw, c) => [
    // 1 bufanda
    nodo(8 - hw[5], fy(5), 2 * hw[5], 1, c),
    nodo(8 + hw[5] - 3, fy(6), 2, 2, c),
  ],
  (hw, c) => [
    // 2 cola
    nodo(8 + hw[8], fy(8), 1, 1, c),
    nodo(8 + hw[8] + 1, fy(7), 1, 1, c),
    nodo(8 + hw[8] + 1, fy(6), 1, 1, c),
  ],
  (hw, c) => [nodo(8 + hw[3], fy(3), 1, 2, c)], // 3 aro
  (hw, c) => [
    // 4 parche
    nodo(8 - hw[6], fy(6), 2, 2, c),
    nodo(8 - hw[7], fy(8), 2, 1, c),
  ],
  (hw, c) => [
    // 5 mochila
    nodo(8 + hw[6], fy(6), 1, 3, c),
    nodo(8 + hw[6] - 1, fy(6), 2, 1, c),
  ],
  (hw, c) => [
    // 6 flequillo
    nodo(8 - hw[1], fy(1), 2 * hw[1], 1, c),
    nodo(8 - hw[1] + 1, fy(2), 1, 1, c),
    nodo(8 + hw[1] - 2, fy(2), 1, 1, c),
  ],
  (hw, c) => [nodo(6, fy(0), 1, 2, c), nodo(9, fy(0), 1, 2, c), nodo(7, fy(0), 2, 1, c)], // 7 moño
];

/** Ojos de identidad, en y 7-9. Presupuesto: <= 6 nodos. */
export const OJOS: readonly (() => Nodo[])[] = [
  () => [nodo(5, 7, 2, 2, O), nodo(6, 8, 1, 1, T), nodo(9, 7, 2, 2, O), nodo(10, 8, 1, 1, T)], // 0 dos puntos
  () => [nodo(6, 7, 4, 3, O), nodo(7, 8, 2, 2, T)], // 1 ciclope
  () => [
    // 2 tres ojos
    nodo(5, 8, 2, 2, O),
    nodo(5, 9, 1, 1, T),
    nodo(9, 8, 2, 2, O),
    nodo(10, 9, 1, 1, T),
    nodo(7, 7, 2, 1, O),
    nodo(7, 7, 1, 1, T),
  ],
  () => [nodo(5, 8, 3, 1, O), nodo(6, 8, 1, 1, T), nodo(8, 8, 3, 1, O), nodo(9, 8, 1, 1, T)], // 3 rendijas
  () => [
    // 4 cejudo
    nodo(4, 7, 8, 1, T),
    nodo(5, 8, 2, 2, O),
    nodo(6, 9, 1, 1, T),
    nodo(9, 8, 2, 2, O),
    nodo(10, 9, 1, 1, T),
  ],
  () => [nodo(6, 8, 2, 2, O), nodo(6, 9, 1, 1, T), nodo(8, 8, 2, 2, O), nodo(9, 9, 1, 1, T)], // 5 juntos
  () => [nodo(5, 7, 3, 3, O), nodo(6, 8, 1, 1, T), nodo(10, 8, 1, 2, O), nodo(10, 9, 1, 1, T)], // 6 desparejos
  () => [nodo(4, 7, 3, 3, O), nodo(5, 8, 1, 1, T), nodo(9, 7, 3, 3, O), nodo(10, 8, 1, 1, T)], // 7 saltones
];

/** Bocas de identidad, en y 11-12. Presupuesto: <= 3 nodos. */
export const BOCAS: readonly (() => Nodo[])[] = [
  () => [nodo(6, 11, 1, 1, T), nodo(7, 12, 2, 1, T), nodo(9, 11, 1, 1, T)], // 0 sonrisa
  () => [nodo(6, 12, 4, 1, T)], // 1 línea
  () => [nodo(6, 11, 4, 1, T), nodo(7, 12, 1, 1, O), nodo(9, 12, 1, 1, O)], // 2 colmillos
  () => [nodo(7, 11, 2, 2, T)], // 3 o
  () => [nodo(6, 12, 1, 1, T), nodo(7, 11, 2, 1, T), nodo(9, 12, 1, 1, T)], // 4 ondulada
  () => [nodo(6, 11, 4, 1, T), nodo(7, 12, 1, 1, O)], // 5 dientito
  () => [nodo(6, 11, 4, 2, T), nodo(7, 12, 2, 1, O)], // 6 abierta
  () => [nodo(7, 11, 2, 1, T), nodo(6, 12, 4, 1, T)], // 7 fruncida
];

// --- Qué byte decide qué rasgo ---------------------------------------------
// La dirección son 20 bytes ya uniformes (es el hash de una clave pública): no
// hace falta ningún hash extra. Se usan los OCHO ÚLTIMOS bytes y de cada uno
// solo sus bits bajos. Todas las tablas son potencias de dos, así que quedarse
// con los bits bajos no tiene sesgo de resto (con una tabla de 6, `byte % 6` le
// daría 2,4 % más de chance a las cuatro primeras). Los bytes 18 y 19 son los
// dos que se ven en `shortAddress`: los últimos cuatro caracteres que leés
// deciden la silueta y los ojos, que es lo más grande y lo que más se mira.

const DIRECCION = /^0x[0-9a-f]{40}$/;

export function rasgosDe(address: string | null | undefined): Rasgos {
  const s = String(address ?? "").toLowerCase();
  if (!DIRECCION.test(s)) {
    // La criatura desconocida: silueta 0, gris neutro, sin corona ni accesorio,
    // ojos de línea. Nunca tira: una vista rara del árbitro no puede llevarse
    // puesto el árbol de React.
    return {
      silueta: 0,
      ojos: 3,
      corona: 0,
      boca: 1,
      marca: 0,
      accesorio: 0,
      familia: 0,
      secundario: 0,
      desfase: 0,
      desconocida: true,
    };
  }
  const byte = (i: number) => parseInt(s.slice(2 + 2 * i, 4 + 2 * i), 16);
  return {
    silueta: byte(19) & 7,
    ojos: byte(18) & 7,
    corona: byte(17) & 7,
    boca: byte(16) & 7,
    marca: byte(15) & 7,
    accesorio: byte(14) & 7,
    familia: byte(13) & 7,
    secundario: byte(12) & 3,
    desfase: byte(11) & 7,
    desconocida: false,
  };
}

// --- Las dos capas de identidad --------------------------------------------

/** Las filas del cuerpo (en `y` absoluto, sin desplazar) que el oro ya pintó.
 *  El oro sube desde abajo: con las ocho filas llega hasta y = 7. */
export function filasDoradas(filas: number): Set<number> {
  const salida = new Set<number>();
  for (let i = 10 - filas; i < 10; i++) salida.add(fy(i));
  return salida;
}

/** La capa de IDENTIDAD: cuerpo con su oro, el borde de ink de la regla D,
 *  patas, marca, accesorio y corona. Sin cara y sin estado.
 *  Presupuesto: 10 + 1 + 2 + 3 + 3 + 4 = <= 24 nodos, y NUNCA con y < 3. */
export function capaDeIdentidad(
  rasgos: Rasgos,
  opts?: { filas?: number; conPatas?: boolean },
): Nodo[] {
  const filas = Math.max(0, Math.min(8, opts?.filas ?? 0));
  const conPatas = opts?.conPatas !== false;
  const hw = SILUETAS[rasgos.silueta];
  const familia = rasgos.desconocida ? DESCONOCIDA : FAMILIAS[rasgos.familia];
  const secundario = SECUNDARIOS[rasgos.secundario];
  const doradas = filasDoradas(filas);
  const salida: Nodo[] = [];

  // 1) El cuerpo, con el oro ya aplicado fila por fila. La fila 14 (índice 9)
  //    va en la sombra de la familia, salvo que le toque oro.
  for (let i = 0; i < 10; i++) {
    const fill = doradas.has(fy(i))
      ? COLORES_DE_ESTADO.oro
      : i === 9
        ? familia.sombra
        : familia.cuerpo;
    salida.push(nodo(8 - hw[i], fy(i), 2 * hw[i], 1, fill));
  }

  // 2) Regla D: 1 px de ink ENCIMA de la fila más alta de oro. Hace falta
  //    porque la tarjeta de asiento va sobre --color-surface-2 y ahí los ocho
  //    cuerpos dan 2,84:1, no 3:1: la ventana que cumpliría las dos cosas a la
  //    vez está vacía. Con `filas <= 8` el índice nunca baja de 1.
  if (filas > 0) {
    const borde = 10 - filas - 1;
    salida.push(nodo(8 - hw[borde], fy(borde), 2 * hw[borde], 1, T));
  }

  // 3) Las patas. El votado se cayó y no las lleva. Van en #f2c14e cuando les
  //    toca oro: con `filas === 1` la única fila dorada es la 14, y el dorado
  //    oscuro (#a97f1e) da 1,46:1 contra los ocho cuerpos, o sea que el primer
  //    escalón del bolsillo quedaría invisible.
  if (conPatas) {
    const patas = filas > 0 ? COLORES_DE_ESTADO.oro : familia.sombra;
    salida.push(nodo(8 - hw[9], 15, 2, 1, patas));
    salida.push(nodo(8 + hw[9] - 2, 15, 2, 1, patas));
  }

  // 4, 5, 6) Marca (después del oro, para que se lea sobre las filas doradas),
  //          accesorio y corona. La desconocida no lleva los dos últimos.
  salida.push(...MARCAS[rasgos.marca](hw, familia.sombra));
  if (!rasgos.desconocida) {
    salida.push(...ACCESORIOS[rasgos.accesorio](hw, secundario));
    salida.push(...CORONAS[rasgos.corona](hw, secundario));
  }
  return salida;
}

/** La cara de IDENTIDAD: ojos + boca. Presupuesto: <= 9 nodos. */
export function capaDeCara(rasgos: Rasgos): Nodo[] {
  return [...OJOS[rasgos.ojos](), ...BOCAS[rasgos.boca]()];
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts`
Expected: PASS, 5 tests.

Y comprobar, ahora que la carpeta existe, que no hay dos archivos que difieran
solo en la caja (la razón de `nucleo/`, desvío 9):

Run: `for d in apps/web/app/components/aleph apps/web/app/components/aleph/nucleo; do ls "$d" | tr 'A-Z' 'a-z' | sort | uniq -d; done`
Expected: salida vacía.

- [ ] **Step 5: Commit**

```bash
npm run typecheck:web && npm run lint && npm run format:check
git add apps/web/app/components/aleph/nucleo/criatura.ts apps/web/test/aleph-ayuda.ts apps/web/test/aleph-criatura.test.ts
git commit -m "feat(web): la criatura de Aleph, sus ocho tablas y la capa de identidad

Un módulo puro sin imports que convierte una dirección en nodos de una grilla
de 16x16: ocho rasgos, 8.388.608 combinaciones, paleta con la ventana de
luminancia del spec y la criatura desconocida para cualquier basura.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `capaDeEstado`, `nodosDe` y el oro del bolsillo

**Files:**

- Modify: `apps/web/app/components/aleph/nucleo/criatura.ts` (agregar al final)
- Test: `apps/web/test/aleph-criatura.test.ts` (agregar), `apps/web/test/aleph-secretos.test.ts` (crear)

**Interfaces:**

- Consumes: de la Task 1 — `Nodo`, `Rasgos`, `SILUETAS`, `OJOS`, `BOCAS`, `COLORES_DE_ESTADO`, `capaDeIdentidad(rasgos, { filas?, conPatas? })`, `capaDeCara(rasgos)`, `filasDoradas(filas)`, `rasgosDe(address)`.
- Produces:
  - `type Estado = "base" | "hablando" | "esperando" | "sellado" | "se_fue" | "votado" | "abandono" | "ganador"`
  - `const ESTADOS: readonly Estado[]` (los ocho, en ese orden)
  - `interface CapaDeEstado { ojos: Nodo[] | null; boca: Nodo[] | null; overlay: Nodo[] }` — `null` quiere decir "usá la de identidad"
  - `capaDeEstado(estado: Estado, hw: readonly number[], filasDoradas?: Set<number>): CapaDeEstado`
  - `filasDeOro(bolsillo: number, maxBolsillo: number): number`
  - `interface OpcionesDeCriatura { estado?: Estado; traidor?: boolean; filas?: number }`
  - `nodosDe(rasgos: Rasgos, opts?: OpcionesDeCriatura): Nodo[]`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/aleph-criatura.test.ts` (y ampliar el `import` de `criatura.js` con `ESTADOS`, `capaDeEstado`, `nodosDe`, `filasDeOro`, `COLORES_DE_ESTADO`):

```ts
test("2. todo adentro de la grilla, cada capa en su zona y el dorso inscripto en el cuerpo", () => {
  const DE_CABEZA: readonly string[] = ["hablando", "esperando", "sellado", "se_fue", "ganador"];
  for (const a of direcciones(2000, 20260920)) {
    const r = rasgosDe(a);
    const hw = SILUETAS[r.silueta];
    for (const estado of ESTADOS) {
      for (const traidor of [false, true]) {
        for (const filas of [0, 1, 4, 8]) {
          for (const n of nodosDe(r, { estado, traidor, filas })) {
            assert.ok(n.w > 0 && n.h > 0, `nodo vacío ${JSON.stringify(n)}`);
            assert.ok(
              n.x >= 0 && n.y >= 0 && n.x + n.w <= 16 && n.y + n.h <= 16,
              `fuera de grilla ${JSON.stringify(n)} · ${estado} traidor=${traidor} filas=${filas}`,
            );
          }
        }
      }
      const overlay = capaDeEstado(estado, hw).overlay;
      if (DE_CABEZA.includes(estado)) {
        // Ningún overlay de cabeza baja de y=2: es lo que impide que la corona
        // dorada del ganador tape la corona de identidad (y 3-4).
        for (const n of overlay)
          assert.ok(n.y + n.h <= 3, `overlay de cabeza de ${estado}: ${JSON.stringify(n)}`);
      }
      if (estado === "votado" || estado === "abandono") {
        // El dorso, inscripto en el rectángulo del cuerpo de ESA silueta.
        const dy = estado === "votado" ? 1 : 0;
        for (const n of overlay) {
          assert.ok(n.y >= 3, `el dorso de ${estado} entró en la zona de cabeza`);
          for (let y = n.y + dy; y < n.y + dy + n.h; y++) {
            const i = y - 5 - dy;
            assert.ok(i >= 0 && i <= 9, `dorso fuera del cuerpo (fila ${y}) en ${estado}`);
            assert.ok(
              n.x >= 8 - hw[i] && n.x + n.w <= 8 + hw[i],
              `dorso fuera del ancho del cuerpo: silueta ${r.silueta}, fila ${i}`,
            );
          }
        }
      }
    }
  }
});

test("3. tope de nodos: nunca más de 40, en cualquier combinación", () => {
  let maximo = 0;
  for (const a of direcciones(2000, 4242)) {
    const r = rasgosDe(a);
    for (const estado of ESTADOS) {
      // De las tres cotas por capa, identidad (<= 24) y cara (<= 9) las mira el
      // test "presupuesto"; esta es la del overlay de estado (<= 9). Hoy el
      // peor da 5, así que sobra margen: el assert está para que un overlay
      // nuevo no se coma el tope de 40 sin que nadie se entere.
      const overlay = capaDeEstado(estado, SILUETAS[r.silueta]).overlay;
      assert.ok(overlay.length <= 9, `overlay de ${estado}: ${overlay.length} nodos`);
    }
    for (const estado of ESTADOS)
      for (const traidor of [false, true])
        for (const filas of [0, 1, 4, 8]) {
          const largo = nodosDe(r, { estado, traidor, filas }).length;
          maximo = Math.max(maximo, largo);
          assert.ok(
            largo <= 40,
            `${largo} nodos · ${a} ${estado} traidor=${traidor} filas=${filas}`,
          );
        }
  }
  assert.ok(maximo >= 30, `el peor caso dio ${maximo}: si bajó tanto, algo dejó de dibujarse`);
});

test("9. el oro es proporcional en todo el rango y cuesta un solo nodo", () => {
  assert.equal(filasDeOro(0, 1000), 0);
  assert.equal(filasDeOro(1, 1000), 1); // cualquier bolsillo > 0 muestra al menos una
  assert.equal(filasDeOro(500, 1000), 4);
  assert.equal(filasDeOro(750, 1000), 6); // no 8: el cuarto superior se tiene que distinguir
  // Nunca 10: de las diez filas del cuerpo, las dos de arriba quedan sin oro.
  // Encima del oro va el borde de ink de la regla D, así que con el bolsillo
  // máximo queda UNA sola fila con el color de identidad, no dos (desvío 11).
  assert.equal(filasDeOro(1000, 1000), 8);
  assert.equal(filasDeOro(0, 0), 0);
  assert.equal(filasDeOro(100, 0), 0);

  const r = rasgosDe("0x" + "ab".repeat(20));
  const base = nodosDe(r, { estado: "base", filas: 0 }).length;
  for (let filas = 1; filas <= 8; filas++) {
    const nodos = nodosDe(r, { estado: "base", filas });
    assert.equal(nodos.length, base + 1, `filas=${filas}: el oro agregó más de un nodo`);
    const dorados = nodos.filter((n) => n.fill === COLORES_DE_ESTADO.oro);
    assert.equal(dorados.filter((n) => n.y === 14).length, 1, "la fila 14 tiene que ser oro");
    assert.equal(dorados.filter((n) => n.y === 15).length, 2, "las patas tienen que ser oro");
    // Regla D: el ÚNICO nodo de ink de la identidad es el borde, y cae justo
    // una fila arriba del oro. Se mira sobre `capaDeIdentidad` y no sobre
    // `nodosDe`, porque la cara del estado también pinta en ink.
    const borde = capaDeIdentidad(r, { filas, conPatas: true }).filter(
      (n) => n.fill === COLORES_DE_ESTADO.tinta,
    );
    assert.equal(borde.length, 1, `filas=${filas}: la regla D tiene que poner un solo borde`);
    assert.equal(borde[0].y, 14 - filas, `filas=${filas}: el borde no está pegado al oro`);
  }
  assert.equal(
    nodosDe(r, { estado: "base", filas: 0 }).filter((n) => n.fill === COLORES_DE_ESTADO.oro).length,
    0,
    "con bolsillo 0 no hay una sola fila dorada",
  );

  // El píxel central del dorso pasa a ink cuando su propia fila ya quedó
  // dorada: la comparación es fila a fila, no contra un umbral escrito a mano.
  for (const estado of ["votado", "abandono"] as const) {
    const dy = estado === "votado" ? 1 : 0;
    for (let filas = 0; filas <= 8; filas++) {
      const centro = nodosDe(r, { estado, filas }).find(
        (n) => n.w === 2 && n.h === 2 && n.x === 7 && n.y === 10 + dy,
      );
      assert.ok(centro, `${estado} filas=${filas}: falta el centro del dorso`);
      assert.equal(
        centro.fill,
        filas >= 4 ? COLORES_DE_ESTADO.tinta : COLORES_DE_ESTADO.oro,
        `${estado} filas=${filas}: un punto dorado sobre oro no dice nada`,
      );
    }
  }

  // El votado cae en escalones ortogonales: el cuerpo ENTERO baja una fila
  // (5-14 pasa a 6-15) y pierde las patas; el abandono no baja. Sin estos
  // cuatro asserts, un `nodosDe` que dejara de bajar la capa de identidad
  // dibujaría exactamente el abandono y nadie se enteraría: el test 2 mira el
  // dorso sobre `capaDeEstado`, que no ve el desplazamiento, y el dibujo sin
  // bajar entra igual en la grilla de 16, así que tampoco rompe la cota.
  const votado = nodosDe(r, { estado: "votado", filas: 0 });
  const abandono = nodosDe(r, { estado: "abandono", filas: 0 });
  assert.equal(Math.min(...votado.map((n) => n.y)), 4, "el votado no bajó una fila");
  assert.equal(Math.min(...abandono.map((n) => n.y)), 3, "el abandono no tiene que bajar");
  assert.equal(
    votado.filter((n) => n.y === 15).length,
    1,
    "en y=15 del votado va solo la última fila del cuerpo: no lleva patas",
  );
  assert.equal(abandono.filter((n) => n.y === 15).length, 2, "el abandono conserva sus dos patas");
});
```

Crear `apps/web/test/aleph-secretos.test.ts`:

```ts
// LO QUE PROTEGE AL JUEGO. En vivo la pantalla no puede insinuar un solo
// secreto: solo se sabe quién actuó, nunca qué hizo, y de los susurros no se
// dice ni que existieron.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SILUETAS,
  capaDeEstado,
  capaDeIdentidad,
  filasDoradas,
  nodosDe,
  rasgosDe,
} from "../app/components/aleph/nucleo/criatura.js";
import { direcciones } from "./aleph-ayuda.js";

test("18. el sello es idéntico para todos y no ve la dirección", () => {
  const referencia = capaDeEstado("sellado", SILUETAS[0]);
  for (const a of direcciones(200, 7)) {
    const hw = SILUETAS[rasgosDe(a).silueta];
    assert.deepEqual(capaDeEstado("sellado", hw), referencia);
  }
  // El tercer argumento de `capaDeEstado` (las filas doradas) no cambia NADA
  // fuera de `votado`/`abandono`: `nodosDe` se lo pasa siempre lleno, pero solo
  // `dorsoDeAleph` lo mira. Es la promesa del desvío 3, comprobada sobre los
  // otros seis estados y las nueve cantidades de filas.
  for (const estado of ["base", "hablando", "esperando", "sellado", "se_fue", "ganador"] as const)
    for (let filas = 0; filas <= 8; filas++)
      assert.deepEqual(
        capaDeEstado(estado, SILUETAS[0], filasDoradas(filas)),
        capaDeEstado(estado, SILUETAS[0]),
        `${estado} filas=${filas}: la capa de estado miró el bolsillo`,
      );
  // Y dos criaturas selladas difieren ÚNICAMENTE en la capa de identidad: se
  // comprueba quitándola (por longitud, que `nodosDe` la pone primero).
  const sinIdentidad = (address: string) => {
    const r = rasgosDe(address);
    const largo = capaDeIdentidad(r, { filas: 0 }).length;
    return nodosDe(r, { estado: "sellado", filas: 0 }).slice(largo);
  };
  const [a, b] = direcciones(2, 1234);
  assert.deepEqual(sinIdentidad(a), sinIdentidad(b));
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: FAIL — `ESTADOS`, `capaDeEstado`, `nodosDe` y `filasDeOro` todavía no existen. **El mensaje NO es un `SyntaxError` de ESM**: los tests de este repo corren en CJS (ni el `package.json` raíz ni el de `apps/web` declaran `"type": "module"`), el módulo ya existe desde la Task 1 y el símbolo que falta llega como `undefined`, así que el rojo es un `TypeError` — reproducido: `TypeError: import_criatura.ESTADOS is not iterable`.

- [ ] **Step 3: Escribir la implementación mínima**

Agregar al final de `apps/web/app/components/aleph/nucleo/criatura.ts`:

```ts
// --- La capa de estado ------------------------------------------------------
// El estado NUNCA toca la identidad: la silueta, el color, la corona, la marca
// y el accesorio son los mismos vivo, votado o ganador. Lo que cambia son ojos,
// boca y overlay, y esos tres NO ven la dirección: los elige una tabla que
// recibe el estado y los diez medios anchos (que ya se ven dibujados). Es eso,
// y no la cantidad de argumentos, lo que hace imposible filtrar un secreto por
// el dibujo.

export type Estado =
  | "base"
  | "hablando"
  | "esperando"
  | "sellado"
  | "se_fue"
  | "votado"
  | "abandono"
  | "ganador";

export const ESTADOS: readonly Estado[] = [
  "base",
  "hablando",
  "esperando",
  "sellado",
  "se_fue",
  "votado",
  "abandono",
  "ganador",
];

/** `ojos`/`boca` en `null` quieren decir "usá la cara de identidad". */
export interface CapaDeEstado {
  ojos: Nodo[] | null;
  boca: Nodo[] | null;
  overlay: Nodo[];
}

/** Caras fijas de estado. */
const CARA_CERRADOS = (): Nodo[] => [nodo(5, 8, 3, 1, T), nodo(9, 8, 3, 1, T)];
const CARA_FELICES = (): Nodo[] => [
  nodo(5, 8, 1, 1, T),
  nodo(6, 9, 2, 1, T),
  nodo(9, 9, 2, 1, T),
  nodo(11, 8, 1, 1, T),
];

/** El dorso de ALEPH, 8x6 en x = 4-11: la misma idea del ícono del juego (ocho
 *  asientos alrededor de un pozo dorado) redibujada en píxeles. Cuatro rects
 *  arman el anillo de tinta y uno dorado va al centro. `y0 = 8`; el
 *  desplazamiento del votado lo aplica `nodosDe`, así que relativo al cuerpo
 *  cae siempre en los índices 3 a 8, donde el piso de `hw >= 4` garantiza que
 *  entre inscripto en cualquiera de las ocho siluetas.
 *
 *  El anillo de tinta hace que el centro se lea sobre cualquier cuerpo; pero
 *  si alguna de sus dos filas ya quedó dorada por el bolsillo, el centro se
 *  pinta en ink: un punto dorado sobre oro no dice nada. La comparación es
 *  FILA A FILA, nunca contra un umbral escrito a mano. */
function dorsoDeAleph(y0: number, doradas: Set<number>): Nodo[] {
  const centro = y0 + 2;
  const sobreOro = doradas.has(centro) || doradas.has(centro + 1);
  return [
    nodo(4, y0, 8, 1, T),
    nodo(4, y0 + 5, 8, 1, T),
    nodo(4, y0 + 1, 1, 4, T),
    nodo(11, y0 + 1, 1, 4, T),
    nodo(7, centro, 2, 2, sobreOro ? T : COLORES_DE_ESTADO.oro),
  ];
}

/** SOLO ve el estado, los diez medios anchos y qué filas están doradas. Nunca
 *  la dirección, ni la fase, ni el bolsillo crudo. */
export function capaDeEstado(
  estado: Estado,
  hw: readonly number[],
  doradas?: Set<number>,
): CapaDeEstado {
  const oro = doradas ?? new Set<number>();
  switch (estado) {
    case "hablando":
      // Globo de 3x2 en marfil sobre la cabeza, con su cola de 1 px en y = 2.
      return {
        ojos: null,
        boca: BOCAS[6](),
        overlay: [
          nodo(10, 0, 3, 2, COLORES_DE_ESTADO.globo),
          nodo(11, 1, 1, 1, T),
          nodo(9, 2, 1, 1, COLORES_DE_ESTADO.globo),
        ],
      };
    case "esperando":
      // Tres puntitos cyan FIJOS: no se animan. La cara queda la de identidad:
      // es el único estado que trae objeto sin cambiar la cara.
      return {
        ojos: null,
        boca: null,
        overlay: [
          nodo(6, 1, 1, 1, COLORES_DE_ESTADO.cyan),
          nodo(8, 1, 1, 1, COLORES_DE_ESTADO.cyan),
          nodo(10, 1, 1, 1, COLORES_DE_ESTADO.cyan),
        ],
      };
    case "sellado":
      // Actuó y no sabemos qué. Idéntico para todos, a propósito.
      return {
        ojos: CARA_CERRADOS(),
        boca: BOCAS[1](),
        overlay: [nodo(5, 0, 6, 2, COLORES_DE_ESTADO.cyan), nodo(7, 0, 2, 1, T)],
      };
    case "se_fue":
      return {
        ojos: CARA_FELICES(),
        boca: BOCAS[0](),
        overlay: [nodo(13, 0, 3, 3, COLORES_DE_ESTADO.oro), nodo(14, 1, 1, 1, T)],
      };
    case "votado":
    case "abandono":
      // El dorso tapa la CARA, no la criatura: la silueta y el color siguen ahí.
      return { ojos: [], boca: [], overlay: dorsoDeAleph(8, oro) };
    case "ganador": {
      // Piso de ancho: sin él, sobre una silueta angosta (hw[0] = 2) la corona
      // mediría 4 px y el único asiento que todo el mundo va a mirar quedaría
      // con una corona que casi no se ve.
      const ch = Math.max(4, hw[0]);
      return {
        ojos: CARA_FELICES(),
        boca: BOCAS[0](),
        overlay: [
          nodo(8 - ch, 1, 2 * ch, 1, COLORES_DE_ESTADO.oro),
          nodo(8 - ch, 0, 1, 1, COLORES_DE_ESTADO.oro),
          nodo(7, 0, 2, 1, COLORES_DE_ESTADO.oro),
          nodo(8 + ch - 1, 0, 1, 1, COLORES_DE_ESTADO.oro),
          nodo(8 - ch, 2, 2 * ch, 1, COLORES_DE_ESTADO.oroSombra),
        ],
      };
    }
    default:
      // `base` es el REPOSO, no un estado vacío: se distingue justamente por no
      // tener nada encima, y es el más frecuente de la pantalla.
      return { ojos: null, boca: null, overlay: [] };
  }
}

/** La marca del traidor no es un estado: convive con cualquiera. Una columna
 *  coral de 1 px con dos escalones y un segundo ojo que asoma en (8,8). Se
 *  DIBUJA, no se parte: separar las dos mitades obligaría a dibujar el cuerpo
 *  dos veces (veinte rects en vez de diez) y a romper el tope de nodos. */
const GRIETA = (): Nodo[] => [
  nodo(8, 5, 1, 3, COLORES_DE_ESTADO.coral),
  nodo(9, 8, 1, 2, COLORES_DE_ESTADO.coral),
  nodo(8, 10, 1, 4, COLORES_DE_ESTADO.coral),
  nodo(8, 8, 1, 1, COLORES_DE_ESTADO.coral),
];

// --- El oro del bolsillo ----------------------------------------------------

/** Cuántas filas del cuerpo se pintan en oro. Las ocho se reparten sobre TODO
 *  el rango, no sobre el 75 % de abajo: con `round(p * 10)` recortado en 8,
 *  cualquiera entre el 75 % y el 100 % del máximo mostraba las mismas ocho
 *  filas, y el cuarto superior —justo donde se define quién va ganando— quedaba
 *  indistinguible. Y cualquier bolsillo mayor que cero muestra al menos una:
 *  un asiento que ya guardó plata no se puede dibujar igual que uno que no. */
export function filasDeOro(bolsillo: number, maxBolsillo: number): number {
  if (!(bolsillo > 0) || !(maxBolsillo > 0)) return 0;
  return Math.min(8, Math.max(1, Math.round((bolsillo / maxBolsillo) * 8)));
}

// --- El armado --------------------------------------------------------------

export interface OpcionesDeCriatura {
  estado?: Estado;
  traidor?: boolean;
  /** Filas de oro, 0 a 8. Sale de `filasDeOro`. */
  filas?: number;
}

/** La única función que ve las DOS capas, y por eso la única que puede aplicar
 *  el desplazamiento del votado. Orden de dibujo: cuerpo (con el oro ya
 *  aplicado) -> borde de ink -> patas -> marca -> accesorio -> corona -> ojos
 *  -> boca -> overlay de estado -> grieta.
 *
 *  El votado NO se inclina: rotar seis grados una grilla de píxeles la hace
 *  puré antialiaseado, que es justo lo que `crispEdges` fue a evitar. Cae en
 *  escalones ortogonales: el cuerpo entero baja una fila (de 5-14 a 6-15), la
 *  corona baja con él y las patas no se dibujan. Todo sigue adentro de la
 *  grilla y no hace falta un solo nodo de más. */
export function nodosDe(rasgos: Rasgos, opts?: OpcionesDeCriatura): Nodo[] {
  const estado: Estado = opts?.estado ?? "base";
  const filas = Math.max(0, Math.min(8, opts?.filas ?? 0));
  const hw = SILUETAS[rasgos.silueta];
  const dy = estado === "votado" ? 1 : 0;
  const doradas = filasDoradas(filas);

  const identidad = capaDeIdentidad(rasgos, { filas, conPatas: estado !== "votado" });
  const capa = capaDeEstado(estado, hw, doradas);
  const cara = [
    ...(capa.ojos === null ? OJOS[rasgos.ojos]() : capa.ojos),
    ...(capa.boca === null ? BOCAS[rasgos.boca]() : capa.boca),
  ];

  // El desplazamiento mueve la identidad, la cara y todo lo que se apoya en el
  // cuerpo (el dorso, la grieta). Nunca los overlays de cabeza, que son los
  // únicos que viven fuera del cuerpo y por eso no se caen con él.
  const enCuerpo = [...identidad, ...cara, ...capa.overlay.filter((n) => n.y > 2)];
  const enCabeza = capa.overlay.filter((n) => n.y <= 2);
  const grieta = opts?.traidor ? GRIETA() : [];
  const bajar = (n: Nodo): Nodo => (dy ? { ...n, y: n.y + dy } : n);

  return [...enCuerpo.map(bajar), ...grieta.map(bajar), ...enCabeza];
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: PASS, 9 tests. El peor caso de nodos es **39**, y sale en dos combinaciones: `ganador + traidor` (23 + 7 + 5 + 4) y `esperando + traidor` (23 + 9 + 3 + 4). `hablando + traidor` da 38, porque su boca fija cuesta 2 y la cara no llega a 9. Son 39 y no los 40 de la tabla del spec porque la identidad da 23: la fila 14 no es un nodo aparte (desvío 10).

- [ ] **Step 5: Commit**

```bash
npm run typecheck:web && npm run lint && npm run format:check
git add apps/web/app/components/aleph/nucleo/criatura.ts apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts
git commit -m "feat(web): los ocho estados de la criatura, el dorso y el oro del bolsillo

capaDeEstado no ve la dirección: recibe el estado y los diez medios anchos. El
oro sube desde abajo, proporcional a la mesa, y el votado cae en escalones
ortogonales en vez de inclinarse. Tope de 40 nodos comprobado en todas las
combinaciones (el peor caso da 39).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `svgDeCriatura` y el componente `Criatura.tsx`

**Files:**

- Modify: `apps/web/app/components/aleph/nucleo/criatura.ts` (agregar al final)
- Create: `apps/web/app/components/aleph/Criatura.tsx`
- Test: `apps/web/test/aleph-criatura.test.ts` (agregar)

**Interfaces:**

- Consumes: de las Tasks 1 y 2 — `Nodo`, `Rasgos`, `Estado`, `ESTADOS`, `OPACIDAD_DE_ESTADO`, `rasgosDe`, `nodosDe`, `filasDeOro`.
- Produces:
  - `svgDeCriatura(address: string | null | undefined, opts?: OpcionesDeCriatura & { etiquetaA11y?: string }): string`
  - `interface OroDeCriatura { bolsillo: number; maximo: number }`
  - `function Criatura(props: { address: string; estado?: Estado; traidor?: boolean; oro?: OroDeCriatura; clase: string; etiquetaA11y?: string; respira?: boolean })` — exportada con nombre desde `Criatura.tsx`, devuelve el `<svg>`. **Sin anotar el retorno**: los tipos de React 19 ya no declaran el namespace global `JSX`, en `apps/web` no hay un solo `JSX.Element` y escribirlo rompe el `typecheck`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/aleph-criatura.test.ts` (y sumar `svgDeCriatura` al `import`):

```ts
test("1. determinismo: dos llamadas dan el mismo string, y EIP-55 no cambia nada", () => {
  const a = "0x7a3f91c0d4e5b6a7889910aabbccddee0012c91d";
  assert.equal(svgDeCriatura(a), svgDeCriatura(a));
  assert.equal(svgDeCriatura(a.toUpperCase().replace("0X", "0x")), svgDeCriatura(a));
  assert.equal(svgDeCriatura("0x7A3F91C0D4E5B6A7889910AABBCCDDEE0012C91D"), svgDeCriatura(a));
});

test("6. seis direcciones distintas dan seis criaturas distintas", () => {
  // El caso de la casa. Las direcciones de los asientos de la casa NO existen
  // como constantes en el repo: `aleph-house-seats.ts` las genera la primera
  // vez y las guarda en el store del árbitro. Son estables, así que cada
  // asiento de la casa tiene su criatura fija para siempre, pero el test no las
  // puede conocer: comprueba la propiedad sobre seis direcciones cualquiera, y
  // la garantía de fondo la da el test de variedad.
  const seis = direcciones(6, 4242).map((a) => svgDeCriatura(a));
  assert.equal(new Set(seis).size, 6);
});

test("8a. los ocho estados salen con su etiqueta, y nunca hay texto adentro del SVG", () => {
  const a = direcciones(1, 5)[0];
  const etiquetas = ESTADOS.map((estado) => `Criatura de 0x7a3f…c91d, ${estado}`);
  // Lo que este módulo decide de las ocho etiquetas es el DIBUJO, y los ocho
  // tienen que ser distintos: dos estados que colapsen en la misma criatura
  // hacen que el `aria-label` diga una cosa y la pantalla muestre otra. Que los
  // ocho TEXTOS sean distintos sale de i18n y lo mira `i18n.test.ts`; que la
  // clave de chip de cada estado sea distinta lo mira el test 8b bis. Acá no se
  // puede comprobar ninguna de las dos sin fabricarlas, que es una tautología.
  assert.equal(
    new Set(ESTADOS.map((estado) => svgDeCriatura(a, { estado }))).size,
    8,
    "dos estados dibujan lo mismo",
  );
  for (const [i, estado] of ESTADOS.entries()) {
    const svg = svgDeCriatura(a, { estado, etiquetaA11y: etiquetas[i] });
    assert.ok(svg.includes(`aria-label="${etiquetas[i]}"`), `falta el aria-label de ${estado}`);
    assert.ok(svg.includes('role="img"'));
    assert.ok(!svg.includes("aria-hidden"));
    assert.ok(!svg.includes("<text"), "nada de <text> adentro del SVG");
    assert.ok(!svg.includes("<title"), "nada de <title> adentro del SVG");
    assert.ok(!svg.includes("<clipPath") && !svg.includes("Gradient"));
    assert.ok(!svg.includes("var("), "los nodos llevan el fill ya resuelto");
  }
  // Sin etiqueta va `aria-hidden`: es como se monta en la charla.
  const mudo = svgDeCriatura(a);
  assert.ok(mudo.includes('aria-hidden="true"') && !mudo.includes("role="));
  // Las dos opacidades del spec.
  assert.ok(svgDeCriatura(a, { estado: "se_fue" }).includes('opacity="0.8"'));
  assert.ok(svgDeCriatura(a, { estado: "abandono" }).includes('opacity="0.34"'));
  assert.ok(!svgDeCriatura(a, { estado: "base" }).includes("opacity="));
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts`
Expected: FAIL — `svgDeCriatura` todavía no existe. Como en la Task 2, el módulo ya está y los tests corren en CJS, así que el rojo llega como `TypeError: import_criatura.svgDeCriatura is not a function`, no como un `SyntaxError` de ESM. (En las Tasks 1, 5 y 6 sí es otro mensaje: ahí el archivo entero no existe todavía y el rojo es `Cannot find module`.)

- [ ] **Step 3: Escribir la implementación mínima**

Agregar al final de `apps/web/app/components/aleph/nucleo/criatura.ts`:

```ts
// --- El serializador --------------------------------------------------------

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** La criatura como string de SVG. Lo usan los tests y (en PR2) el probador.
 *  `Criatura.tsx` mapea la MISMA lista de `nodosDe` a <rect>, así que los dos
 *  consumen lo mismo y no pueden divergir. Sin <text>, sin <title>, sin
 *  <clipPath> y sin gradientes: todo rótulo es HTML traducible, porque Press
 *  Start 2P no tiene glifos devanagari y el sitio se sirve en hindi. */
export function svgDeCriatura(
  address: string | null | undefined,
  opts?: OpcionesDeCriatura & { etiquetaA11y?: string },
): string {
  const rasgos = rasgosDe(address);
  const nodos = nodosDe(rasgos, opts);
  const opacidad = opts?.estado ? OPACIDAD_DE_ESTADO[opts.estado] : undefined;
  const a11y = opts?.etiquetaA11y
    ? ` role="img" aria-label="${escapar(opts.etiquetaA11y)}"`
    : ' aria-hidden="true"';
  const rects = nodos
    .map((n) => `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${n.fill}"/>`)
    .join("");
  const op = opacidad === undefined ? "" : ` opacity="${opacidad}"`;
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges"${op}${a11y}>${rects}</svg>`;
}
```

Crear `apps/web/app/components/aleph/Criatura.tsx`:

```tsx
// La criatura, en React. NO DIBUJA NADA PROPIO: mapea la lista de `nodosDe` a
// <rect> y nada más. Un píxel escrito acá adentro es un bug de revisión.
//
// El tamaño llega como CLASE, no como número: los anchos cambian en el corte de
// contenedor de la escena (PR2) y un número de JS no puede alternar dos valores
// en una media query. El viewBox de 16 es siempre el mismo.

import { nodosDe, rasgosDe, filasDeOro, OPACIDAD_DE_ESTADO, type Estado } from "./nucleo/criatura";

/** El bolsillo de este asiento y el máximo de la mesa. La fórmula vive en
 *  `filasDeOro`, para que nadie la pueda escribir distinto. */
export interface OroDeCriatura {
  bolsillo: number;
  maximo: number;
}

export function Criatura({
  address,
  estado = "base",
  traidor = false,
  oro,
  clase,
  etiquetaA11y,
  respira = false,
}: {
  address: string;
  estado?: Estado;
  traidor?: boolean;
  oro?: OroDeCriatura;
  /** `criatura--mesa` o `criatura--charla`. */
  clase: string;
  /** Ausente en la charla, que va `aria-hidden`: cada línea de la terminal ya
   *  empieza con la wallet escrita en texto, y anunciar una criatura por
   *  mensaje hace ilegible una sala liquidada de decenas de líneas. */
  etiquetaA11y?: string;
  /** Solo los vivos respiran. No se puede derivar del estado: `base` también es
   *  el reposo de un asiento terminado y de uno en el lobby. */
  respira?: boolean;
}) {
  const rasgos = rasgosDe(address);
  const filas = oro ? filasDeOro(oro.bolsillo, oro.maximo) : 0;
  const nodos = nodosDe(rasgos, { estado, traidor, filas });
  const opacidad = OPACIDAD_DE_ESTADO[estado];
  // El desfase sale del byte 11, el primero que no usa ningún rasgo, y va en
  // negativo para que la animación arranque ya corrida y ocho criaturas no
  // latan en bloque. Es azar DECORATIVO: el del juego sale de SHA-256 del
  // secreto (reglas v2) y no toca ni al servidor ni al contrato.
  const estilo = respira ? { animationDelay: `-${rasgos.desfase * 0.4}s` } : undefined;
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`${clase}${respira ? " aleph-respira" : ""}`}
      style={estilo}
      opacity={opacidad}
      role={etiquetaA11y ? "img" : undefined}
      aria-label={etiquetaA11y}
      aria-hidden={etiquetaA11y ? undefined : true}
    >
      {nodos.map((n, i) => (
        <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} fill={n.fill} />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: PASS, 12 tests (11 en `aleph-criatura.test.ts` y el 18 en `aleph-secretos.test.ts`).

- [ ] **Step 5: Commit**

```bash
npm run typecheck:web && npm run lint && npm run format:check
git add apps/web/app/components/aleph/nucleo/criatura.ts apps/web/app/components/aleph/Criatura.tsx apps/web/test/aleph-criatura.test.ts
git commit -m "feat(web): svgDeCriatura y el componente que la dibuja

El serializador para los tests y Criatura.tsx, que mapea la misma lista de
nodosDe a <rect>. Sin texto adentro del SVG: todo rótulo es HTML traducible.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: las 19 claves de i18n, en los cuatro idiomas

**Files:**

- Modify: `apps/web/app/lib/i18n/es.ts`, `en.ts`, `fr.ts`, `hi.ts`
- Test: `apps/web/test/i18n.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: 19 claves que usan las Tasks 5 a 8 — `aleph.state.esperando`, `aleph.state.decidio`, `aleph.state.listo`, `aleph.state.hablando`, `aleph.state.traidor`, `aleph.state.ganador`, `aleph.seat.dissolved`, `aleph.chat.title`, `aleph.chat.empty`, `aleph.chat.private`, `aleph.chat.onlyThisStage`, `aleph.chat.caps`, `aleph.chat.declassified`, `aleph.chat.whisper`, `aleph.chat.whisperTo`, `aleph.chat.stageSep`, `aleph.a11y.criatura`, `aleph.scene.acted`, `aleph.scene.ready`.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/i18n.test.ts`:

```ts
test("las 19 claves de la etapa 5 (PR1) están en los 4 idiomas", () => {
  const nuevas = [
    // Estados que no existían (7)
    "aleph.state.esperando",
    "aleph.state.decidio",
    "aleph.state.listo",
    "aleph.state.hablando",
    "aleph.state.traidor",
    "aleph.state.ganador",
    "aleph.seat.dissolved",
    // Charla (9)
    "aleph.chat.title",
    "aleph.chat.empty",
    "aleph.chat.private",
    "aleph.chat.onlyThisStage",
    "aleph.chat.caps",
    "aleph.chat.declassified",
    "aleph.chat.whisper",
    "aleph.chat.whisperTo",
    "aleph.chat.stageSep",
    // Accesibilidad (1) y el contador (2)
    "aleph.a11y.criatura",
    "aleph.scene.acted",
    "aleph.scene.ready",
  ];
  assert.equal(nuevas.length, 19);
  for (const [lang, dict] of Object.entries(DICTS)) {
    for (const k of nuevas) {
      assert.ok(dict[k], `${lang} no tiene ${k}`);
      assert.ok(dict[k].trim().length > 0, `${lang} tiene ${k} vacía`);
    }
  }
  // Las que llevan variable tienen que llevarla en los 4 idiomas: si una
  // traducción se come el {k}, el número desaparece sin que nadie se entere.
  const conVariables: Record<string, string[]> = {
    "aleph.chat.whisperTo": ["{who}"],
    "aleph.chat.stageSep": ["{n}", "{kind}"],
    "aleph.a11y.criatura": ["{wallet}", "{estado}"],
    "aleph.scene.acted": ["{k}", "{n}"],
    "aleph.scene.ready": ["{k}", "{n}"],
  };
  for (const [lang, dict] of Object.entries(DICTS))
    for (const [k, vars] of Object.entries(conVariables))
      for (const v of vars) assert.ok(dict[k].includes(v), `${lang}: ${k} perdió ${v}`);
});

test("los ocho estados de la criatura se leen distinto en los 4 idiomas", () => {
  // Es la mitad de texto del test 8 del spec ("los ocho textos son distintos
  // entre sí"). Va acá y no en `aleph-criatura.test.ts` porque el que puede
  // romperla es el DICCIONARIO, no el generador: dos estados que compartan
  // texto dejan al lector de pantalla sin forma de distinguirlos, y el
  // `aria-label` de la criatura interpola justamente estos ocho. El orden es el
  // de `ESTADOS`: base, hablando, esperando, sellado, se_fue, votado, abandono,
  // ganador — cada uno con la clave que le da `chipDeAsiento`.
  const OCHO = [
    "aleph.seat.alive",
    "aleph.state.hablando",
    "aleph.state.esperando",
    "aleph.state.decidio",
    "aleph.seat.left",
    "aleph.seat.voted_out",
    "aleph.seat.abandoned",
    "aleph.state.ganador",
  ];
  for (const [lang, dict] of Object.entries(DICTS)) {
    const textos = OCHO.map((k) => dict[k]);
    assert.equal(new Set(textos).size, 8, `${lang}: dos estados dicen lo mismo · ${textos}`);
  }
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: FAIL los dos tests nuevos — el de las 19 claves con `en no tiene aleph.state.esperando`, y el de los ocho estados con `en: dos estados dicen lo mismo` (cuatro de las ocho claves todavía no existen y `dict[k]` llega `undefined`).

- [ ] **Step 3: Escribir la implementación mínima**

En **`apps/web/app/lib/i18n/es.ts`**, insertar las 7 de estado justo después de `"aleph.seat.pending"` (línea 596):

```ts
  "aleph.seat.dissolved": "la sala se disolvió",
  "aleph.state.esperando": "sin decidir",
  "aleph.state.decidio": "ya decidió",
  "aleph.state.listo": "listo",
  "aleph.state.hablando": "habla",
  "aleph.state.traidor": "abrió para sí",
  "aleph.state.ganador": "ganó la Final",
```

y las 12 restantes justo después de `"aleph.line.after"` (línea 619):

```ts
  "aleph.a11y.criatura": "Criatura de {wallet}, {estado}",
  "aleph.scene.acted": "Ya actuaron {k} de {n}.",
  "aleph.scene.ready": "Ya dijeron listo {k} de {n}.",
  "aleph.chat.title": "CHARLA_PUBLICA.TXT",
  "aleph.chat.empty": "Todavía no habló nadie en esta etapa.",
  "aleph.chat.private":
    ":: el canal privado no publica nada, ni que existió, hasta que la sala liquide.",
  "aleph.chat.onlyThisStage":
    "Acá va solo la charla de la etapa en curso. El historial completo se abre cuando la sala liquida.",
  "aleph.chat.caps": "Cada agente puede mandar 3 mensajes por fase, de hasta 280 caracteres.",
  "aleph.chat.declassified":
    "La sala liquidó y se abrió el canal privado. Acá está todo lo que se dijo, público y susurrado, en el orden en que pasó.",
  "aleph.chat.whisper": "SUSURRO",
  "aleph.chat.whisperTo": "a {who}",
  "aleph.chat.stageSep": ":: etapa {n} · {kind}",
```

En **`apps/web/app/lib/i18n/en.ts`**, después de `"aleph.seat.pending"` (línea 589):

```ts
  "aleph.seat.dissolved": "the room dissolved",
  "aleph.state.esperando": "undecided",
  "aleph.state.decidio": "decided",
  "aleph.state.listo": "ready",
  "aleph.state.hablando": "talking",
  "aleph.state.traidor": "opened it for themselves",
  "aleph.state.ganador": "won the Final",
```

y después de `"aleph.line.after"` (línea 611):

```ts
  "aleph.a11y.criatura": "Creature of {wallet}, {estado}",
  "aleph.scene.acted": "{k} of {n} have acted.",
  "aleph.scene.ready": "{k} of {n} said ready.",
  "aleph.chat.title": "PUBLIC_CHAT.TXT",
  "aleph.chat.empty": "Nobody has spoken in this stage yet.",
  "aleph.chat.private":
    ":: the private channel publishes nothing, not even that it existed, until the room settles.",
  "aleph.chat.onlyThisStage":
    "Only the current stage's talk shows up here. The full history opens when the room settles.",
  "aleph.chat.caps": "Each agent can send 3 messages per phase, up to 280 characters.",
  "aleph.chat.declassified":
    "The room settled and the private channel opened. Here is everything that was said, public and whispered, in the order it happened.",
  "aleph.chat.whisper": "WHISPER",
  "aleph.chat.whisperTo": "to {who}",
  "aleph.chat.stageSep": ":: stage {n} · {kind}",
```

En **`apps/web/app/lib/i18n/fr.ts`**, después de `"aleph.seat.pending"` (línea 603):

```ts
  "aleph.seat.dissolved": "la salle s'est dissoute",
  "aleph.state.esperando": "sans décision",
  "aleph.state.decidio": "a décidé",
  "aleph.state.listo": "prêt",
  "aleph.state.hablando": "parle",
  "aleph.state.traidor": "a ouvert pour lui seul",
  "aleph.state.ganador": "a gagné la Finale",
```

y después de `"aleph.line.after"` (línea 625):

```ts
  "aleph.a11y.criatura": "Créature de {wallet}, {estado}",
  "aleph.scene.acted": "{k} sur {n} ont agi.",
  "aleph.scene.ready": "{k} sur {n} ont dit prêt.",
  "aleph.chat.title": "CHAT_PUBLIC.TXT",
  "aleph.chat.empty": "Personne n'a encore parlé dans cette étape.",
  "aleph.chat.private":
    ":: le canal privé ne publie rien, pas même son existence, jusqu'à la liquidation de la salle.",
  "aleph.chat.onlyThisStage":
    "Ici, seulement la discussion de l'étape en cours. L'historique complet s'ouvre à la liquidation.",
  "aleph.chat.caps": "Chaque agent peut envoyer 3 messages par phase, de 280 caractères maximum.",
  "aleph.chat.declassified":
    "La salle a liquidé et le canal privé s'est ouvert. Voici tout ce qui a été dit, en public et en chuchotant, dans l'ordre où c'est arrivé.",
  "aleph.chat.whisper": "CHUCHOTEMENT",
  "aleph.chat.whisperTo": "à {who}",
  "aleph.chat.stageSep": ":: étape {n} · {kind}",
```

En **`apps/web/app/lib/i18n/hi.ts`**, después de `"aleph.seat.pending"` (línea 587):

```ts
  "aleph.seat.dissolved": "कमरा भंग हो गया",
  "aleph.state.esperando": "अभी फ़ैसला नहीं",
  "aleph.state.decidio": "फ़ैसला कर लिया",
  "aleph.state.listo": "तैयार",
  "aleph.state.hablando": "बोल रहा है",
  "aleph.state.traidor": "सिर्फ़ अपने लिए खोला",
  "aleph.state.ganador": "फ़ाइनल जीता",
```

y después de `"aleph.line.after"` (línea 609):

```ts
  "aleph.a11y.criatura": "{wallet} की क्रीचर, {estado}",
  "aleph.scene.acted": "{n} में से {k} ने कार्रवाई कर ली।",
  "aleph.scene.ready": "{n} में से {k} ने तैयार कहा।",
  "aleph.chat.title": "सार्वजनिक_बातचीत.TXT",
  "aleph.chat.empty": "इस चरण में अभी किसी ने कुछ नहीं कहा।",
  "aleph.chat.private":
    ":: निजी चैनल कुछ भी प्रकाशित नहीं करता, यह तक नहीं कि वह था — जब तक कमरा निपट न जाए।",
  "aleph.chat.onlyThisStage":
    "यहाँ सिर्फ़ मौजूदा चरण की बातचीत है। पूरा इतिहास कमरे के निपटने पर खुलता है।",
  "aleph.chat.caps": "हर एजेंट प्रति चरण 3 संदेश भेज सकता है, ज़्यादा से ज़्यादा 280 अक्षर के।",
  "aleph.chat.declassified":
    "कमरा निपट गया और निजी चैनल खुल गया। जो कुछ कहा गया — सार्वजनिक और फुसफुसाया — वह सब यहाँ है, उसी क्रम में जैसे हुआ।",
  "aleph.chat.whisper": "फुसफुसाहट",
  "aleph.chat.whisperTo": "{who} को",
  "aleph.chat.stageSep": ":: चरण {n} · {kind}",
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: PASS, 4 tests (paridad, `translate`, el de las 19 claves y el de los ocho estados distintos).

- [ ] **Step 5: Commit**

```bash
npm run typecheck:web && npm run lint && npm run format:check
git add apps/web/app/lib/i18n apps/web/test/i18n.test.ts
git commit -m "feat(web): las 19 claves de la etapa 5 de Aleph en los 4 idiomas

Los siete chips de estado que faltaban, las nueve de la charla, la etiqueta de
accesibilidad de la criatura y las dos del contador. Con test de paridad y de
variables: una traducción que se come el {k} deja de avisar el número.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `estados.ts` — de qué dato sale cada estado y cada chip

**Files:**

- Create: `apps/web/app/components/aleph/nucleo/estados.ts`
- Test: `apps/web/test/aleph-criatura.test.ts` (agregar el test 8b), `apps/web/test/aleph-secretos.test.ts` (agregar el test 17)

**Interfaces:**

- Consumes: de la Task 2 — `type Estado`. De la Task 4 — las claves `aleph.state.*` y `aleph.seat.dissolved`.
- Produces (tipos estructurales propios, SIN importar nada del SDK: así los tests arman fixtures mínimos y `AlephRoomView` sigue encajando por estructura):
  - `type EstadoDeSala = "lobby" | "funding" | "playing" | "settled" | "dissolved"`
  - `type EstadoDeAsiento = "alive" | "left" | "voted_out" | "abandoned" | "finished"`
  - `type EtapaKind = "share" | "offer" | "vote" | "lock" | "final"`
  - `type Fase = "talk" | "decide"`
  - `interface AsientoDeSala { address: string; status: EstadoDeAsiento; pocket: number }`
  - `interface ResultadoDeEtapa { index: number; kind: EtapaKind; accepted?: string[]; eachGot?: number; voided?: boolean; traitors?: string[]; choices?: Record<string, "split" | "steal"> }`
  - `interface MensajeDeSala { from: string; to?: string; text: string; stage: number; phase: Fase }`
  - `interface SalaDeAleph { status: EstadoDeSala; seats: AsientoDeSala[]; stage?: { index: number; kind: EtapaKind; phase: Fase; acted: string[] }; results?: ResultadoDeEtapa[]; messages?: MensajeDeSala[]; deposited?: string[]; payouts?: Record<string, number> }`
  - `estadoDeAsiento(seat: AsientoDeSala, room: SalaDeAleph): { estado: Estado; traidor: boolean }`
  - `chipDeAsiento(seat: AsientoDeSala, room: SalaDeAleph): string` (la clave de i18n)

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/aleph-criatura.test.ts` (con `import { chipDeAsiento, estadoDeAsiento, type SalaDeAleph } from "../app/components/aleph/nucleo/estados.js";`):

```ts
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Una sala mínima. Lo que no se pasa, no viene: es como la sirve el árbitro. */
function sala(parche: Partial<SalaDeAleph> = {}): SalaDeAleph {
  return {
    status: "playing",
    seats: [
      { address: A, status: "alive", pocket: 0 },
      { address: B, status: "alive", pocket: 0 },
    ],
    stage: { index: 0, kind: "vote", phase: "decide", acted: [] },
    results: [],
    messages: [],
    ...parche,
  };
}

test("8b. chipDeAsiento recorre sus siete filas en orden", () => {
  const asiento = (status: SalaDeAleph["seats"][number]["status"]) => ({
    address: A,
    status,
    pocket: 0,
  });

  // 0) `dissolved` gana sobre todo: ahí el árbitro manda `alive` para todos.
  assert.equal(
    chipDeAsiento(asiento("alive"), sala({ status: "dissolved", stage: undefined })),
    "aleph.seat.dissolved",
  );
  // 1) `funding`: depositó o no, aunque el asiento venga `alive`.
  assert.equal(
    chipDeAsiento(asiento("alive"), sala({ status: "funding", stage: undefined, deposited: [A] })),
    "aleph.seat.deposited",
  );
  assert.equal(
    chipDeAsiento(asiento("alive"), sala({ status: "funding", stage: undefined, deposited: [] })),
    "aleph.seat.pending",
  );
  // 2) ganador
  const conFinal = sala({
    status: "settled",
    seats: [
      { address: A, status: "finished", pocket: 9 },
      { address: B, status: "finished", pocket: 1 },
    ],
    results: [{ index: 0, kind: "final", choices: { [A]: "steal", [B]: "split" } }],
    stage: undefined,
  });
  assert.equal(chipDeAsiento(asiento("finished"), conFinal), "aleph.state.ganador");
  // 3) hablando
  assert.equal(
    chipDeAsiento(
      asiento("alive"),
      sala({ messages: [{ from: A, text: "hola", stage: 0, phase: "decide" }] }),
    ),
    "aleph.state.hablando",
  );
  // 4) esperando
  assert.equal(chipDeAsiento(asiento("alive"), sala()), "aleph.state.esperando");
  // 5) sellado, con sus dos textos según la fase
  assert.equal(
    chipDeAsiento(
      asiento("alive"),
      sala({ stage: { index: 0, kind: "vote", phase: "decide", acted: [A] } }),
    ),
    "aleph.state.decidio",
  );
  assert.equal(
    chipDeAsiento(
      asiento("alive"),
      sala({ stage: { index: 0, kind: "vote", phase: "talk", acted: [A] } }),
    ),
    "aleph.state.listo",
  );
  // 6) el resto: `aleph.seat.${seat.status}`, sobre los cinco SeatStatus.
  for (const status of ["alive", "left", "voted_out", "abandoned", "finished"] as const) {
    assert.equal(
      chipDeAsiento(
        asiento(status),
        sala({ stage: { index: 0, kind: "vote", phase: "talk", acted: [] } }),
      ),
      `aleph.seat.${status}`,
      `playing + ${status}`,
    );
  }
  // Un asiento `left` da "aceptó la oferta" también con la sala liquidada, y no
  // "terminó": el chip sale del asiento, no del estado de la sala.
  assert.equal(
    chipDeAsiento(asiento("left"), sala({ status: "settled", stage: undefined })),
    "aleph.seat.left",
  );
});

test("8b bis. la corona de la Final, con y sin Final, y el traidor suma un segundo chip", () => {
  const dos = (s: "finished" | "alive") => [
    { address: A, status: s, pocket: 5 },
    { address: B, status: s, pocket: 5 },
  ];
  const final = (choices: Record<string, "split" | "steal">): SalaDeAleph => ({
    status: "settled",
    seats: dos("finished"),
    results: [{ index: 0, kind: "final", choices }],
  });
  // Un solo steal: ese lleva corona.
  assert.equal(
    estadoDeAsiento(dos("finished")[0], final({ [A]: "steal", [B]: "split" })).estado,
    "ganador",
  );
  assert.equal(
    estadoDeAsiento(dos("finished")[1], final({ [A]: "steal", [B]: "split" })).estado,
    "base",
  );
  // Los dos split: los dos.
  for (const i of [0, 1])
    assert.equal(
      estadoDeAsiento(dos("finished")[i], final({ [A]: "split", [B]: "split" })).estado,
      "ganador",
    );
  // Los dos steal: ninguno (el pozo se quemó).
  for (const i of [0, 1])
    assert.equal(
      estadoDeAsiento(dos("finished")[i], final({ [A]: "steal", [B]: "steal" })).estado,
      "base",
    );
  // Sin Final, con un solo `finished`: ese lleva corona igual (se llevó el pozo).
  const sinFinal: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: A, status: "finished", pocket: 10 },
      { address: B, status: "voted_out", pocket: 0 },
    ],
    results: [{ index: 0, kind: "vote" }],
  };
  assert.equal(estadoDeAsiento(sinFinal.seats[0], sinFinal).estado, "ganador");
  assert.equal(estadoDeAsiento(sinFinal.seats[1], sinFinal).estado, "votado");
  // La marca de traidor NO es un estado: es una marca, y convive con LOS OCHO.
  // El barrido va sobre los ocho a propósito, y no sobre uno solo: los cuatro
  // que cambian cara y overlay (`se_fue`, `votado`, `abandono`, `ganador`) son
  // justo donde la marca se pierde si alguien la mete adentro de `capaDeEstado`
  // en vez de dejarla en `nodosDe`. Y de paso se fija el par (estado, chip) de
  // cada uno: son ocho claves distintas, y los chips nunca pasan de dos — el de
  // `chipDeAsiento` más el del traidor.
  const lock = { index: 0, kind: "lock" as const, traitors: [A] };
  const vivo = { address: A, status: "alive" as const, pocket: 0 };
  const casos: [string, string, SalaDeAleph, SalaDeAleph["seats"][number]][] = [
    [
      "base",
      "aleph.seat.alive",
      sala({ results: [lock], stage: { index: 1, kind: "vote", phase: "talk", acted: [] } }),
      vivo,
    ],
    [
      "hablando",
      "aleph.state.hablando",
      sala({
        results: [lock],
        messages: [{ from: A, text: "eh", stage: 1, phase: "decide" }],
        stage: { index: 1, kind: "vote", phase: "decide", acted: [] },
      }),
      vivo,
    ],
    [
      "esperando",
      "aleph.state.esperando",
      sala({ results: [lock], stage: { index: 1, kind: "vote", phase: "decide", acted: [] } }),
      vivo,
    ],
    [
      "sellado",
      "aleph.state.decidio",
      sala({ results: [lock], stage: { index: 1, kind: "vote", phase: "decide", acted: [A] } }),
      vivo,
    ],
    [
      "se_fue",
      "aleph.seat.left",
      sala({ results: [lock] }),
      { ...vivo, status: "left", pocket: 3 },
    ],
    [
      "votado",
      "aleph.seat.voted_out",
      sala({ results: [lock] }),
      { ...vivo, status: "voted_out", pocket: 1 },
    ],
    [
      "abandono",
      "aleph.seat.abandoned",
      sala({ results: [lock] }),
      { ...vivo, status: "abandoned" },
    ],
    [
      "ganador",
      "aleph.state.ganador",
      sala({
        status: "settled",
        stage: undefined,
        results: [lock, { index: 1, kind: "final", choices: { [A]: "steal", [B]: "split" } }],
        seats: [
          { address: A, status: "finished", pocket: 9 },
          { address: B, status: "finished", pocket: 1 },
        ],
      }),
      { ...vivo, status: "finished", pocket: 9 },
    ],
  ];
  const vistos = new Set<string>();
  const chipsVistos = new Set<string>();
  for (const [esperado, claveDeChip, room, asiento] of casos) {
    const caso = estadoDeAsiento(asiento, room);
    assert.equal(caso.estado, esperado, `caso ${esperado}`);
    assert.equal(caso.traidor, true, `${esperado}: la marca de traidor se perdió`);
    const chips = [chipDeAsiento(asiento, room), ...(caso.traidor ? ["aleph.state.traidor"] : [])];
    assert.equal(chips.length, 2, `${esperado}: tienen que ser exactamente dos chips`);
    assert.equal(chips[0], claveDeChip, `${esperado}: el chip de estado`);
    assert.notEqual(chips[0], chips[1], `${esperado}: el chip del traidor repite al de estado`);
    vistos.add(esperado);
    chipsVistos.add(chips[0]);
  }
  assert.deepEqual([...vistos].sort(), [...ESTADOS].sort(), "faltó un estado en el barrido");
  assert.equal(chipsVistos.size, 8, "dos estados comparten la clave de chip");

  // Y la marca es de quien la tiene: B no la hereda por estar en la misma sala.
  assert.equal(estadoDeAsiento({ ...vivo, address: B }, casos[3][2]).traidor, false);
});
```

Agregar al final de `apps/web/test/aleph-secretos.test.ts` (con el mismo `import` de `estados.js` y una copia local del helper `sala`, porque cada archivo de test se lee solo):

```ts
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";

function sala(parche: Partial<SalaDeAleph> = {}): SalaDeAleph {
  return {
    status: "playing",
    seats: [
      { address: A, status: "alive", pocket: 0 },
      { address: B, status: "alive", pocket: 0 },
      { address: C, status: "alive", pocket: 0 },
    ],
    stage: { index: 0, kind: "vote", phase: "decide", acted: [] },
    results: [],
    messages: [],
    ...parche,
  };
}

test("17. solo lo cerrado: en fase de decisión no se filtra nada, y hablando pide la fase en curso", () => {
  const enJuego = sala({ stage: { index: 0, kind: "vote", phase: "decide", acted: [A, B] } });
  for (const asiento of enJuego.seats) {
    const { estado, traidor } = estadoDeAsiento(asiento, enJuego);
    assert.equal(traidor, false, `${asiento.address} salió traidor sin Cerradura cerrada`);
    assert.ok(
      !["ganador", "se_fue", "votado"].includes(estado),
      `${asiento.address} salió ${estado} con results vacío`,
    );
  }
  assert.equal(estadoDeAsiento(enJuego.seats[0], enJuego).estado, "sellado");
  assert.equal(estadoDeAsiento(enJuego.seats[1], enJuego).estado, "sellado");
  assert.equal(estadoDeAsiento(enJuego.seats[2], enJuego).estado, "esperando");

  // El candado de fase: `messages` viene filtrado por ETAPA, no por fase, y al
  // pasar de `talk` a `decide` el motor no lo toca. Sin el recorte, el último
  // que habló se quedaría con el chip "habla" toda la fase de decisión —
  // minutos, con un sondeo de 10 s— tapándole su "sin decidir".
  const viejo = sala({
    stage: { index: 0, kind: "vote", phase: "decide", acted: [] },
    messages: [{ from: A, text: "confíen", stage: 0, phase: "talk" }],
  });
  for (const asiento of viejo.seats)
    assert.notEqual(estadoDeAsiento(asiento, viejo).estado, "hablando");
  assert.equal(estadoDeAsiento(viejo.seats[0], viejo).estado, "esperando");
  // Y alguien que habla DURANTE `decide` sí está hablando de verdad: `say` no
  // está limitado a la fase de charla.
  const ahora = sala({ messages: [{ from: A, text: "ojo", stage: 0, phase: "decide" }] });
  assert.equal(estadoDeAsiento(ahora.seats[0], ahora).estado, "hablando");
});

test("17 bis. dissolved sale del estado de la SALA, no del asiento", () => {
  // En lobby, funding y dissolved el árbitro devuelve TODOS los asientos con
  // `status: "alive"` y `pocket: 0`: no hay ningún `abandoned` del que salir.
  const rota = sala({
    status: "dissolved",
    stage: undefined,
    results: undefined,
    messages: undefined,
  });
  for (const asiento of rota.seats) {
    assert.equal(estadoDeAsiento(asiento, rota).estado, "abandono");
    assert.equal(chipDeAsiento(asiento, rota), "aleph.seat.dissolved");
  }
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: FAIL con `Cannot find module '.../app/components/aleph/nucleo/estados.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `apps/web/app/components/aleph/nucleo/estados.ts`:

```ts
// DE QUÉ DATO SALE CADA ESTADO. Este archivo es puro y no importa nada del SDK:
// declara la forma mínima de la vista que necesita, y `AlephRoomView` encaja
// por estructura. Así los tests arman fixtures de tres líneas y el módulo se
// lee con `node --test` sin DOM ni configuración nueva.

import type { Estado } from "./criatura";

export type EstadoDeSala = "lobby" | "funding" | "playing" | "settled" | "dissolved";
export type EstadoDeAsiento = "alive" | "left" | "voted_out" | "abandoned" | "finished";
export type EtapaKind = "share" | "offer" | "vote" | "lock" | "final";
export type Fase = "talk" | "decide";

export interface AsientoDeSala {
  address: string;
  status: EstadoDeAsiento;
  pocket: number;
}

export interface ResultadoDeEtapa {
  index: number;
  kind: EtapaKind;
  accepted?: string[];
  eachGot?: number;
  voided?: boolean;
  traitors?: string[];
  choices?: Record<string, "split" | "steal">;
}

export interface MensajeDeSala {
  from: string;
  /** Sin `to` = público. En vivo el árbitro nunca lo manda. */
  to?: string;
  text: string;
  stage: number;
  phase: Fase;
}

export interface SalaDeAleph {
  status: EstadoDeSala;
  seats: AsientoDeSala[];
  /** No viene en `lobby`, `funding` ni `dissolved`. */
  stage?: { index: number; kind: EtapaKind; phase: Fase; acted: string[] };
  results?: ResultadoDeEtapa[];
  messages?: MensajeDeSala[];
  deposited?: string[];
  payouts?: Record<string, number>;
}

const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const incluye = (xs: string[] | undefined, a: string) => (xs ?? []).some((x) => igual(x, a));

/** Quiénes llevan corona. Con Final: un solo `steal` la lleva él (se llevó el
 *  pozo); los dos `split`, los dos; los dos `steal`, ninguno (el pozo se
 *  quemó). SIN Final —y es el caso común: la Final solo se abre cuando quedan
 *  exactamente dos vivos— la lleva el que quedó `finished` con la sala
 *  liquidada, que es lo que la corona significa. Con cero vivos, nadie. */
function coronados(room: SalaDeAleph): string[] {
  const final = (room.results ?? []).find((r) => r.kind === "final");
  if (final) {
    const elecciones = Object.entries(final.choices ?? {});
    const ladrones = elecciones.filter(([, c]) => c === "steal").map(([a]) => a);
    if (ladrones.length === 1) return ladrones;
    if (ladrones.length === 0) return elecciones.map(([a]) => a);
    return [];
  }
  if (room.status !== "settled") return [];
  return room.seats.filter((s) => s.status === "finished").map((s) => s.address);
}

/** El estado se calcula con esta prioridad, y la primera que aplica gana. Las
 *  tres condiciones del medio piden `room.status === "playing"` a propósito:
 *  con la sala liquidada nadie está sellado ni hablando, y en `lobby` o
 *  `funding` no hay etapa que sellar — el árbitro ni siquiera manda `stage`. */
export function estadoDeAsiento(
  seat: AsientoDeSala,
  room: SalaDeAleph,
): { estado: Estado; traidor: boolean } {
  const a = seat.address;
  const resultados = room.results ?? [];
  // Es permanente una vez revelada: es dato cerrado, y hay como mucho una
  // Cerradura por mazo.
  const traidor = incluye(resultados.find((r) => r.kind === "lock")?.traitors, a);
  const estado = ((): Estado => {
    // 0) Sale del estado de la SALA, no del asiento: en `dissolved` el árbitro
    //    manda todos los asientos `alive`, así que sin esta fila una sala
    //    disuelta se dibujaría con ocho criaturas de reposo, como si jugaran.
    if (room.status === "dissolved") return "abandono";
    if (seat.status === "left") return "se_fue";
    if (seat.status === "voted_out") return "votado";
    if (seat.status === "abandoned") return "abandono";
    if (incluye(coronados(room), a)) return "ganador";
    const stage = room.stage;
    if (room.status === "playing" && stage) {
      if (incluye(stage.acted, a)) return "sellado";
      // `messages` viene filtrado por ETAPA y no por fase, y al pasar de `talk`
      // a `decide` el motor no lo toca: sin este recorte el último que habló se
      // quedaría con el chip "habla" durante toda la fase de decisión.
      const deLaFase = (room.messages ?? []).filter((m) => m.phase === stage.phase);
      const ultimo = deLaFase[deLaFase.length - 1];
      if (ultimo && igual(ultimo.from, a)) return "hablando";
      if (stage.phase === "decide" && seat.status === "alive") return "esperando";
    }
    // `base` incluye a los `finished` sin corona y a todos los asientos en
    // `lobby`, `funding` y `settled` sin corona.
    return "base";
  })();
  return { estado, traidor };
}

/** El ÚNICO lugar donde vive la tabla de chips: con esta función en un solo
 *  lado, el ternario no se repite en cada forma de tarjeta. Las filas 0 y 1 van
 *  arriba de todo porque en esos dos estados de sala el `seat.status` no dice
 *  nada: el árbitro manda `alive` para todos. */
export function chipDeAsiento(seat: AsientoDeSala, room: SalaDeAleph): string {
  if (room.status === "dissolved") return "aleph.seat.dissolved";
  if (room.status === "funding")
    return incluye(room.deposited, seat.address) ? "aleph.seat.deposited" : "aleph.seat.pending";
  const { estado } = estadoDeAsiento(seat, room);
  if (estado === "ganador") return "aleph.state.ganador";
  if (estado === "hablando") return "aleph.state.hablando";
  if (estado === "esperando") return "aleph.state.esperando";
  if (estado === "sellado")
    // `stage.acted` es `[...decisions, ...ready]`: en `decide` son los que
    // decidieron, en `talk` los que mandaron `ready`. El dibujo es el mismo
    // sello —en las dos significa "actuó y no sabemos qué"—, cambia el chip.
    return room.stage?.phase === "decide" ? "aleph.state.decidio" : "aleph.state.listo";
  return `aleph.seat.${seat.status}`;
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck:web && npm run lint && npm run format:check
git add apps/web/app/components/aleph/nucleo/estados.ts apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts
git commit -m "feat(web): de qué dato sale el estado y el chip de cada asiento

La tabla de prioridades del spec en un solo lugar, con dissolved arriba de todo
(ahí el árbitro manda alive para todos) y el candado de fase de 'hablando'.
Tipos estructurales propios: cero imports del SDK, fixtures de tres líneas.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `charla.ts` — el modelo de la terminal

**Files:**

- Create: `apps/web/app/components/aleph/nucleo/charla.ts`
- Test: `apps/web/test/aleph-secretos.test.ts` (agregar los tests 19 y 20), `apps/web/test/aleph-criatura.test.ts` (agregar la mitad de charla del test 13)

**Interfaces:**

- Consumes: de la Task 5 — `SalaDeAleph`, `EtapaKind`.
- Produces:
  - `type LineaDeCharla = { tipo: "etapa"; n: number; kind?: EtapaKind } | { tipo: "mensaje"; from: string; to?: string; texto: string; susurro: boolean }`
  - `interface ModeloDeCharla { desclasificada: boolean; lineas: LineaDeCharla[] }`
  - `lineasDeCharla(room: SalaDeAleph): ModeloDeCharla | null` — `null` cuando `room.messages === undefined`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/aleph-secretos.test.ts` (con `import { lineasDeCharla } from "../app/components/aleph/nucleo/charla.js";`):

```ts
test("19. en vivo no hay susurros, aunque el árbitro cambie", () => {
  // Hoy es imposible: `viewFor` los filtra. Es defensa en profundidad contra
  // un cambio futuro del árbitro.
  const viva = sala({
    messages: [
      { from: A, text: "público", stage: 0, phase: "talk" },
      { from: B, to: C, text: "esto no se ve", stage: 0, phase: "talk" },
    ],
  });
  const modelo = lineasDeCharla(viva);
  assert.ok(modelo);
  assert.equal(modelo.desclasificada, false);
  assert.equal(modelo.lineas.length, 1);
  assert.deepEqual(modelo.lineas[0], {
    tipo: "mensaje",
    from: A,
    to: undefined,
    texto: "público",
    susurro: false,
  });
  assert.ok(!JSON.stringify(modelo).includes("esto no se ve"));
});

test("20. la charla no inventa: sin mensajes no hay contador de susurros ni marca de canal privado", () => {
  const modelo = lineasDeCharla(sala({ messages: [] }));
  assert.ok(modelo);
  assert.deepEqual(modelo, { desclasificada: false, lineas: [] });
  // Y sin `messages` no se monta nada: en lobby, funding y dissolved el árbitro
  // no manda el campo, y una ventana entera prometería un canal que no se abrió.
  assert.equal(
    lineasDeCharla(sala({ status: "lobby", stage: undefined, messages: undefined })),
    null,
  );
});
```

Agregar al final de `apps/web/test/aleph-criatura.test.ts` (con el mismo `import` de `charla.js`):

```ts
test("13 (mitad de charla). liquidada: los susurros salen marcados, con su to y sus separadores", () => {
  const liquidada: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: A, status: "finished", pocket: 6 },
      { address: B, status: "voted_out", pocket: 2 },
    ],
    results: [
      { index: 0, kind: "share" },
      { index: 1, kind: "vote" },
    ],
    messages: [
      { from: A, text: "aportemos todos", stage: 0, phase: "talk" },
      { from: B, to: A, text: "vos y yo, a los demás no", stage: 0, phase: "talk" },
      { from: A, text: "votemos al que guardó", stage: 1, phase: "talk" },
    ],
  };
  const modelo = lineasDeCharla(liquidada);
  assert.ok(modelo);
  assert.equal(modelo.desclasificada, true);
  // Separador, mensaje, susurro, separador, mensaje: en el orden en que vinieron.
  assert.deepEqual(
    modelo.lineas.map((l) => l.tipo),
    ["etapa", "mensaje", "mensaje", "etapa", "mensaje"],
  );
  assert.deepEqual(modelo.lineas[0], { tipo: "etapa", n: 1, kind: "share" });
  assert.deepEqual(modelo.lineas[3], { tipo: "etapa", n: 2, kind: "vote" });

  // `assert.fail` devuelve `never`, así que TypeScript angosta la unión después
  // de la guarda y el assert no puede pasar de casualidad por el lado que no es.
  const susurro = modelo.lineas[2];
  if (susurro.tipo !== "mensaje") assert.fail("la línea 2 tenía que ser un mensaje");
  assert.equal(susurro.susurro, true);
  assert.equal(susurro.to, A);
  assert.equal(susurro.texto, "vos y yo, a los demás no");

  const publico = modelo.lineas[1];
  if (publico.tipo !== "mensaje") assert.fail("la línea 1 tenía que ser un mensaje");
  assert.equal(publico.susurro, false);
  assert.equal(publico.to, undefined);

  // Una etapa sin resultado no rompe: el separador sale igual, sin `kind`.
  const huerfano = lineasDeCharla({ ...liquidada, results: [] });
  assert.ok(huerfano);
  const separador = huerfano.lineas[0];
  if (separador.tipo !== "etapa") assert.fail("la primera línea tenía que ser un separador");
  assert.equal(separador.kind, undefined);
  assert.equal(separador.n, 1);
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: FAIL con `Cannot find module '.../app/components/aleph/nucleo/charla.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `apps/web/app/components/aleph/nucleo/charla.ts`:

```ts
// LA CHARLA, COMO TERMINAL. Es el dato más vivo que publica el árbitro y hasta
// hoy llegaba al navegador en cada sondeo sin que nadie lo dibujara.
//
// Mientras la sala juega, `viewFor` manda únicamente los mensajes PÚBLICOS de
// la etapa en curso. Al liquidar deja de filtrar y manda todo, también los
// privados: por eso la terminal tiene que saber marcarlos desde el día uno.

import type { EtapaKind, SalaDeAleph } from "./estados";

export type LineaDeCharla =
  | { tipo: "etapa"; n: number; kind?: EtapaKind }
  | { tipo: "mensaje"; from: string; to?: string; texto: string; susurro: boolean };

export interface ModeloDeCharla {
  /** La sala liquidó y el canal privado se abrió. */
  desclasificada: boolean;
  lineas: LineaDeCharla[];
}

/** `null` cuando el árbitro no manda `messages`: en `lobby`, `funding` y
 *  `dissolved` la rama de la vista devuelve los asientos, las cuentas
 *  regresivas y el reembolso, y nada más. Ahí no hay etapa en curso, así que
 *  el vacío y la nota de "solo esta etapa" nombrarían una etapa que todavía no
 *  existe. `Charla.tsx` con `null` no renderiza nada. */
export function lineasDeCharla(room: SalaDeAleph): ModeloDeCharla | null {
  if (room.messages === undefined) return null;
  const desclasificada = room.status === "settled";
  // `AlephEvent` y los mensajes traen el número de etapa, no su nombre: el
  // `kind` para el separador sale de `results`.
  const kinds = new Map((room.results ?? []).map((r) => [r.index, r.kind]));
  const lineas: LineaDeCharla[] = [];
  let etapaActual: number | null = null;

  for (const m of room.messages) {
    // En vivo, un mensaje con `to` no se muestra ni se cuenta. Hoy es
    // imposible; mañana el árbitro puede cambiar.
    if (!desclasificada && m.to) continue;
    if (desclasificada && m.stage !== etapaActual) {
      etapaActual = m.stage;
      lineas.push({ tipo: "etapa", n: m.stage + 1, kind: kinds.get(m.stage) });
    }
    lineas.push({
      tipo: "mensaje",
      from: m.from,
      to: m.to,
      texto: m.text,
      susurro: Boolean(m.to),
    });
  }
  // No se reordena: el orden en que vienen ES el orden cronológico de inserción
  // del motor.
  return { desclasificada, lineas };
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck:web && npm run lint && npm run format:check
git add apps/web/app/components/aleph/nucleo/charla.ts apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts
git commit -m "feat(web): el modelo de la charla, viva y desclasificada

lineasDeCharla filtra, agrupa por etapa y marca los susurros. En vivo descarta
cualquier mensaje con 'to' aunque el árbitro lo mandara, y devuelve null cuando
no hay campo messages: en lobby y funding la ventana no se monta.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `Charla.tsx` — la terminal

**Files:**

- Create: `apps/web/app/components/aleph/Charla.tsx`

**Interfaces:**

- Consumes: de la Task 3 — `Criatura`. De la Task 6 — `lineasDeCharla`. De la Task 5 — `SalaDeAleph`. De la Task 4 — las nueve claves `aleph.chat.*`.
- Produces:
  - `type Destello = { tipo: "grieta" | "revela" | "desclasifica"; asientos?: string[] }`
  - `function Charla(props: { room: SalaDeAleph; t: (key: string, vars?: Record<string, string | number>) => string; etiquetaDePorDireccion: (address: string) => string; destello: Destello | null })` — devuelve la `<section>`, o `null` cuando `lineasDeCharla` da `null`. **Sin anotar el retorno**, por lo mismo que `Criatura` (Task 3): `JSX.Element` ya no existe con los tipos de React 19

**Nota sobre el test:** esta tarea no lleva test propio. El repo no tiene harness de DOM —`apps/web/test/` es todo `node:test` sin React— y el spec lo pide así con todas las letras: la terminal se prueba por `lineasDeCharla`, que quedó cubierta entera en la Task 6, y las claves de i18n, cubiertas en la Task 4. El gate de esta tarea es `typecheck` + `lint` + `build`, y la verificación visual es la Task 9.

- [ ] **Step 1: Escribir el componente**

Crear `apps/web/app/components/aleph/Charla.tsx`:

```tsx
// La terminal de la charla pública. Dibuja lo que le da `lineasDeCharla` y no
// decide nada por su cuenta.
//
// Nada de globos de papel: el sitio ya reserva el registro monoespaciado para
// los datos técnicos, y una terminal aguanta mejor que un globito el hecho de
// que el mensaje pueda llegar nueve segundos tarde (el sondeo es de 10 s).

import { Criatura } from "./Criatura";
import { lineasDeCharla } from "./nucleo/charla";
import type { SalaDeAleph } from "./nucleo/estados";

/** Lo que la página calcula comparando la vista nueva con la anterior. En PR1
 *  siempre llega `null`: el `useRef` con la vista anterior y las tres
 *  animaciones llegan en PR2. La prop existe desde el día uno para no tocar la
 *  firma dos veces. */
export type Destello = { tipo: "grieta" | "revela" | "desclasifica"; asientos?: string[] };

export function Charla({
  room,
  t,
  etiquetaDePorDireccion,
  destello,
}: {
  room: SalaDeAleph;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** El `from` y el `to` son direcciones sueltas, no asientos. */
  etiquetaDePorDireccion: (address: string) => string;
  destello: Destello | null;
}) {
  const modelo = lineasDeCharla(room);
  if (!modelo) return null;
  // La clase existe desde PR1 y su CSS llega en PR2: mientras tanto las líneas
  // desclasificadas aparecen sin fundido, y no le falta un dato a nadie.
  const entrando = destello?.tipo === "desclasifica" ? " aleph-desclasifica" : "";

  return (
    <section className="win mt-6">
      <div className="win-title win-title--cyan">
        <span>{t("aleph.chat.title")}</span>
      </div>
      <div className="charla p-4 font-mono">
        {/* Por qué hay tan pocas líneas. Va acá y no como chip en la barra: la
            barra no envuelve y .win recorta, así que a 375 px una frase de 70
            caracteres se perdería entera. */}
        <p className="charla-nota">{t("aleph.chat.caps")}</p>
        {modelo.desclasificada && <p className="charla-aviso">{t("aleph.chat.declassified")}</p>}
        {modelo.lineas.length === 0 ? (
          <p className="charla-nota mt-3">{t("aleph.chat.empty")}</p>
        ) : (
          <ol className={`mt-3 flex flex-col gap-1${entrando}`}>
            {modelo.lineas.map((linea, i) =>
              linea.tipo === "etapa" ? (
                <li key={i} className="charla-etapa">
                  {/* El `.replace` solo dispara cuando la etapa no tiene
                      resultado y `kind` queda vacío: sin él, el separador
                      termina en un "·" colgando. Las cuatro traducciones de
                      `aleph.chat.stageSep` terminan en `{kind}` y usan el mismo
                      "·", así que con `kind` lleno no hay nada que recortar. */}
                  {t("aleph.chat.stageSep", {
                    n: linea.n,
                    kind: linea.kind ? t(`aleph.stage.${linea.kind}`) : "",
                  }).replace(/\s*·\s*$/, "")}
                </li>
              ) : (
                <li
                  key={i}
                  className={`charla-linea${linea.susurro ? " charla-linea--susurro" : ""}`}
                >
                  {/* Siempre en estado base, sin marca de traidor y sin oro: el
                      renglón cuenta lo que ese asiento dijo en ese momento, no
                      en qué terminó. Y va `aria-hidden` (sin etiqueta), porque
                      la línea ya empieza con la wallet escrita en texto. */}
                  <Criatura address={linea.from} clase="criatura--charla shrink-0" />
                  <span className="charla-quien">{etiquetaDePorDireccion(linea.from)}</span>
                  {/* `.chip` a secas, NO `chip--danger`: el spec reserva las
                      dos únicas excepciones de color para la insignia `+{n}`
                      (gold) y el chip del traidor (danger), y `chip--danger` es
                      `--color-lose`, rojo, no coral. Lo que marca al susurro es
                      el borde izquierdo coral y el "a {who}". */}
                  {linea.susurro && (
                    <span className="chip shrink-0">{t("aleph.chat.whisper")}</span>
                  )}
                  {linea.susurro && linea.to && (
                    <span className="charla-a">
                      {t("aleph.chat.whisperTo", { who: etiquetaDePorDireccion(linea.to) })}
                    </span>
                  )}
                  <span className="charla-prompt">&gt;</span>
                  <span className="charla-texto">{linea.texto}</span>
                </li>
              ),
            )}
          </ol>
        )}
        {/* Fija, siempre, haya habido susurros o no: es lo único honesto, el
            navegador no sabe si hubo. */}
        <p className="charla-sistema mt-4">{t("aleph.chat.private")}</p>
        {!modelo.desclasificada && (
          <p className="charla-nota mt-1">{t("aleph.chat.onlyThisStage")}</p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Comprobar que compila y pasa el lint**

Run: `npm run typecheck:web && npm run lint`
Expected: PASS, sin errores ni warnings nuevos.

- [ ] **Step 3: Formatear**

Run: `npx prettier --write apps/web/app/components/aleph/Charla.tsx && npm run format:check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/aleph/Charla.tsx
git commit -m "feat(web): la terminal de la charla pública de Aleph

Una línea por mensaje, con la criatura al lado, los susurros marcados cuando la
sala liquidó y la línea fija del canal privado. La prop destello llega desde el
día uno aunque PR1 la mande siempre en null.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: la página y el CSS

**Files:**

- Modify: `apps/web/app/aleph/[roomId]/page.tsx:15` y `:12-22` (imports), `:118-124` (`label` → `etiquetaDePorDireccion`, con sus dos usos en `:284` y `:319`), `:216-232` (el contador), `:242-261` (la ventana de asientos y el montaje de la charla), `:440-468` (`SeatRow`)
- Modify: `apps/web/app/globals.css`, en **dos** lugares y ninguno más: el bloque nuevo entero (tamaños de criatura, `aleph-respira` y las clases de la terminal) en la línea 412, justo después del cierre de `@keyframes rise-fade` (`:411`); y la regla de `aleph-respira` dentro del `@media (prefers-reduced-motion: reduce)` que ya existe (`:416-432`). Los dos caen adentro del `@layer components` que abre en `:157` y cierra en `:480`, así que la indentación del bloque es de dos espacios y la de la regla del media query, de cuatro

**Interfaces:**

- Consumes: `Criatura` (Task 3), `Charla` (Task 7), `chipDeAsiento`, `estadoDeAsiento` (Task 5), las 19 claves (Task 4).
- Produces: nada que consuman otras tareas de PR1.

**Nota sobre el test:** como la Task 7, esta no lleva test propio (no hay harness de DOM). El gate es `npm run check` completo, `npm run build --workspace apps/web` y la verificación visual de la Task 9.

- [ ] **Step 1: El CSS**

En `apps/web/app/globals.css`, insertar en la **línea 412**: justo después del cierre del bloque `@keyframes rise-fade` (`:411`) y **antes** del comentario que introduce el `@media (prefers-reduced-motion: reduce)` (`:413-415`). Cuidado con ese comentario: son tres renglones, y pegar el CSS nuevo adentro lo comenta entero.

<!-- prettier-ignore -->
```css
  /* --- Aleph, etapa 5: la criatura y la terminal --- */

  /* Los tamaños son múltiplos de 16: la grilla es de 16x16 y a 1,5x los píxeles
     se reparten desparejos, con lo que `crispEdges` deja de servir. En PR2 la
     escena declara `container-type: inline-size` y `criatura--mesa` pasa a
     64px adentro del corte de 560px. */
  .criatura--mesa {
    width: 48px;
    height: 48px;
  }
  .criatura--charla {
    width: 32px;
    height: 32px;
  }

  /* Respira en dos cuadros. El desfase lo pone cada criatura desde el byte 11
     de su dirección, en negativo, para que ocho no latan en bloque.
     `jump-none` y no el `steps(2)` pelado del spec: `steps(2)` es `jump-end` y
     deja el cuerpo en -0,5px, medio píxel, que es exactamente el puré
     antialiaseado que `crispEdges` fue a evitar. Con `jump-none` los dos
     cuadros son 0 y -1px enteros, que es lo que el spec pide en palabras. */
  .aleph-respira {
    animation: aleph-respira 3.2s steps(2, jump-none) infinite;
  }
  @keyframes aleph-respira {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-1px);
    }
  }

  /* La terminal: fondo de tinta, mono chico y `anywhere` para que una wallet
     larga no rompa la caja. El mono NO se declara acá: no existe ninguna
     `--font-mono` en el repo (las variables de fuente son `--font-inter`,
     `--font-pixel` y `--font-devanagari`), y el resto de la página ya usa la
     utilidad `font-mono` de Tailwind en el markup. `Charla.tsx` hace lo mismo:
     así no hay un `var()` que caiga en vacío sin que nadie se entere. */
  .charla {
    background: var(--color-ink);
    font-size: 12.5px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .charla-linea {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .charla-linea--susurro {
    border-left: 2px solid var(--color-accent);
    padding-left: 8px;
  }
  .charla-quien {
    color: var(--color-muted-3);
  }
  .charla-a {
    color: var(--color-accent);
  }
  /* El `>` va coral en TODAS las líneas, también en los susurros (desvío 12):
     el spec lo pide coral al describir el renglón normal, y el cyan ya está
     tomado acá adentro por `.charla-etapa` y `.charla-sistema`, que son
     justamente lo que NO es un mensaje. */
  .charla-prompt {
    color: var(--color-accent);
  }
  .charla-texto {
    color: var(--color-muted-bright);
  }
  .charla-etapa {
    margin-top: 10px;
    color: var(--color-accent-2);
  }
  .charla-sistema {
    color: var(--color-accent-2);
  }
  .charla-aviso {
    margin-top: 10px;
    color: var(--color-muted-bright);
  }
  .charla-nota {
    color: var(--color-muted-3);
  }
```

Y **dentro** del `@media (prefers-reduced-motion: reduce)` que ya existe (`:416-432`), junto a `.tile-pop`:

<!-- prettier-ignore -->
```css
    .aleph-respira {
      animation: none;
    }
```

Comprobar que no quedó ningún `var()` inventado. El chequeo compara las variables **usadas** contra las **declaradas** en el mismo archivo, así que caza una `--font-mono` (que no existe en ningún lado del repo) aunque esté en un renglón distinto al del selector:

Run: `comm -23 <(grep -o 'var(--[a-z0-9-]*' apps/web/app/globals.css | sed 's/var(//' | sort -u) <(grep -oE '^[[:space:]]*--[a-z0-9-]*' apps/web/app/globals.css | tr -d ' ' | sort -u)`
Expected: exactamente tres líneas y ninguna más — `--font-devanagari`, `--font-inter` y `--font-pixel`, que las declara `layout.tsx` y no `globals.css`. Cualquier cuarta línea es una variable inventada. Si es de fuente, sacarla: el mono va como utilidad `font-mono` en el markup.

- [ ] **Step 2: El `SeatRow` con criatura**

En `apps/web/app/aleph/[roomId]/page.tsx`, reemplazar `SeatRow` entero (`:440-468`) por el bloque de abajo.

**La etiqueta va en DOS renglones desde PR1, no desde PR2.** El `SeatRow` de hoy pone `playerLabel(...)` en una sola línea con `truncate`, y eso funcionaba porque la etiqueta ocupaba todo el ancho. Con la criatura de 48 px y el monto adentro de la misma fila, a 375 px quedan ~163 px para el texto: a `text-sm` en mono entran unos 19 caracteres, y `🤖 Asterión · 0x1234...abcd · CASA` tiene 33. Como `truncate` corta por el final, lo primero que se pierde es el `· CASA` y después la wallet — y no es un caso raro: **los asientos de la casa, que rellenan toda sala de Aleph, siempre traen nombre y avatar** (`apps/server/src/aleph-house-seats.ts:34-40`, el roster `{ name: "Asterión", avatar: "🤖" }`). El spec lo declara regla dura y no preferencia de layout: «La wallet abreviada no se corta en ningún ancho: es la regla anti-suplantación de `apps/web/app/lib/wallet.tsx:41-50`» («Los asientos»), y el "Listo cuando" de PR1 pide "ocho criaturas distintas con su wallet abreviada al lado". Así que se arma la misma tarjeta angosta que el spec describe: arriba el perfil `{avatar} {nombre}` con `truncate` (nada si no hay nombre), abajo `shortAddress(seat.address)` en mono chico **sin `truncate` nunca**, y el CASA/WEBHOOK como chip aparte. El tope de "nunca más de dos chips" del spec es sobre los de **estado** (estado + traidor); el de identidad es de la etiqueta y no cuenta ahí.

```tsx
function SeatRow({
  seat,
  room,
  maxBolsillo,
  t,
}: {
  seat: AlephSeatView;
  room: AlephRoomView;
  maxBolsillo: number;
  t: T;
}) {
  const { estado, traidor } = estadoDeAsiento(seat, room);
  const bolsillo = room.payouts?.[seat.address] ?? seat.pocket;
  const chip = t(chipDeAsiento(seat, room));
  const agente = agentTag(seat, t);
  return (
    <li
      // El marco punteado del `abandono` lo pide la tabla de estados del spec,
      // y es el mismo que en PR2 usan las sillas vacías.
      className={`flex items-center gap-3 rounded-lg bg-(--color-surface-2) px-3 py-2.5${
        estado === "abandono" ? " border border-dashed border-(--color-border)" : ""
      }`}
    >
      <Criatura
        address={seat.address}
        estado={estado}
        traidor={traidor}
        oro={{ bolsillo, maximo: maxBolsillo }}
        clase="criatura--mesa shrink-0"
        // El aria-label NO usa playerLabel: el nombre, el avatar y el chip
        // CASA/WEBHOOK ya están en la etiqueta HTML de al lado, y meterlos
        // también adentro del SVG los hace sonar dos veces.
        etiquetaA11y={t("aleph.a11y.criatura", {
          wallet: shortAddress(seat.address),
          estado: chip,
        })}
        respira={room.status === "playing" && seat.status === "alive"}
      />
      <div className="min-w-0 flex-1">
        {seat.name && (
          <div className="truncate text-sm text-(--color-muted-bright)">
            {`${seat.avatar ?? ""} ${seat.name}`.trim()}
          </div>
        )}
        {/* La wallet abreviada NUNCA se trunca: es la regla anti-suplantación de
            wallet.tsx, no una preferencia de layout. Por eso va en su propio
            renglón y en mono con el token `text-px10`, que entra en ~78px. El
            token existe justamente para que no vuelva el `text-[10px]` suelto
            (`globals.css:61-62`), y hoy no queda ninguno en `apps/web`. */}
        <div className="font-mono text-px10 text-(--color-muted-3)">
          {shortAddress(seat.address)}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* CASA/WEBHOOK es chip de IDENTIDAD: no cuenta para el tope de dos,
              que es sobre los de estado. */}
          {agente && <span className="chip">{agente}</span>}
          <span className="chip">{chip}</span>
          {/* Nunca más de dos chips de estado. El del traidor va en danger
              porque es raro y es grave. */}
          {traidor && <span className="chip chip--danger">{t("aleph.state.traidor")}</span>}
        </div>
      </div>
      <span className="font-pixel shrink-0 text-sm text-(--color-gold)">{bolsillo}</span>
    </li>
  );
}
```

- [ ] **Step 3: Los imports, el contador, el máximo de la mesa y el montaje de la charla**

En `apps/web/app/aleph/[roomId]/page.tsx`:

**(a)** Dos cosas distintas, en este orden.

Primero, en `:15`, **ampliar** el import de wallet que ya existe — no agregar una línea nueva:

```diff
-import { playerLabel, agentTag } from "@/app/lib/wallet";
+import { playerLabel, agentTag, shortAddress } from "@/app/lib/wallet";
```

Y después de `:22` (la línea de `explorer`), sumar los tres imports nuevos:

```tsx
import { Criatura } from "@/app/components/aleph/Criatura";
import { Charla } from "@/app/components/aleph/Charla";
import { chipDeAsiento, estadoDeAsiento } from "@/app/components/aleph/nucleo/estados";
```

**(a bis)** Renombrar `label` a `etiquetaDePorDireccion` y arreglarle el fallback (`:118-124`). Lo pide el spec en "Lo que se reusa del sitio", y PR1 es el que estrena al consumidor: `Charla.tsx` recibe la prop con ese nombre. El fallback pasa de `address.slice(0, 10) + "…"` a `shortAddress(address)` para que no queden dos helpers casi iguales abreviando la misma dirección desconocida de dos formas distintas en la misma pantalla:

```diff
-  const label = (address: string) => {
+  const etiquetaDePorDireccion = (address: string) => {
     const s = room.seats.find((x) => x.address.toLowerCase() === address.toLowerCase());
-    return s
-      ? playerLabel(s.address, s.name, s.avatar, agentTag(s, t))
-      : address.slice(0, 10) + "…";
+    return s ? playerLabel(s.address, s.name, s.avatar, agentTag(s, t)) : shortAddress(address);
   };
```

El lado `+` va en un solo renglón a propósito: con `shortAddress(address)` el ternario entra en 96 caracteres y el prettier del repo (printWidth 100) lo colapsa. Escrito en tres renglones, el `format:check` del Step 4 lo reescribiría y el archivo no diría lo que dice este diff.

Y actualizar sus **dos usos dentro del componente**, que siguen siendo los mismos de hoy: `:284` (`stageLines(r, label, t)` → `stageLines(r, etiquetaDePorDireccion, t)`) y `:319` (`{label(address)}`, la tabla de pagos → `{etiquetaDePorDireccion(address)}`). **Nada más se toca**: el parámetro `label` de `stageLines` (`:475`) es local de esa función y sigue llamándose igual, y el `label` de `<Money>` —su prop, en `:212-214`, y el `{label}` que la dibuja adentro del componente, en `:417` y `:424`— es otra cosa. Comprobación: después del cambio, `grep -n "\blabel(" apps/web/app/aleph/\[roomId\]/page.tsx` solo devuelve los de adentro de `stageLines`.

**(b)** Después de `const results = room.results ?? [];` (`:126`), agregar:

<!-- prettier-ignore -->
```tsx
  // El máximo de la mesa, contando TODOS los asientos, vivos y salidos: es
  // contra él que se mide el oro de cada cuerpo. Con la sala liquidada se lee
  // `payouts` —con lo que se fue de verdad— y no `pocket`.
  const maxBolsillo = room.seats.reduce(
    (m, s) => Math.max(m, room.payouts?.[s.address] ?? s.pocket),
    0,
  );
  // `n` son los vivos y `k` los de `stage.acted` que siguen vivos.
  const vivos = room.seats.filter((s) => s.status === "alive");
  const actuaron = (room.stage?.acted ?? []).filter((a) =>
    vivos.some((s) => s.address.toLowerCase() === a.toLowerCase()),
  ).length;
```

**(c)** Dentro del bloque de la línea de etapa (`:216-232`), justo **después** del `</p>` que cierra `aleph.room.nowPlaying` y antes del `)}` del `live && room.stage &&`, agregar el contador. El bloque queda así:

<!-- prettier-ignore -->
```tsx
              {live && room.stage && (
                <>
                  <p className="mt-4 text-base leading-relaxed text-(--color-muted)">
                    {t("aleph.room.nowPlaying", {
                      stage: room.stage.index + 1,
                      kind: t(`aleph.stage.${room.stage.kind}`),
                      phase: t(`aleph.phase.${room.stage.phase}`),
                    })}
                    {room.deadline ? (
                      <>
                        {" "}
                        <span className="font-mono text-(--color-muted-bright)">
                          {t("aleph.room.deadline", { time: mmss(room.deadline - now) })}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {/* Provisorio: en PR2 se muda, junto con la línea de arriba,
                      adentro de la carta de etapa. */}
                  <p className="mt-1 text-sm text-(--color-muted-3)">
                    {t(room.stage.phase === "decide" ? "aleph.scene.acted" : "aleph.scene.ready", {
                      k: actuaron,
                      n: vivos.length,
                    })}
                  </p>
                </>
              )}
```

**(d)** En la ventana de asientos (`:242-261`), cambiar las props del `SeatRow`:

<!-- prettier-ignore -->
```tsx
            {room.seats.map((s) => (
              <SeatRow key={s.address} seat={s} room={room} maxBolsillo={maxBolsillo} t={t} />
            ))}
```

**(e)** Justo **después** de `</section>` de la ventana de asientos (`:261`) y **antes** del comentario `{/* El registro contado */}` (`:263`), montar la charla:

<!-- prettier-ignore -->
```tsx
      {/* La charla pública, por primera vez. `destello` llega en PR2. */}
      <Charla room={room} t={t} etiquetaDePorDireccion={etiquetaDePorDireccion} destello={null} />
```

- [ ] **Step 4: Comprobar que compila, pasa el lint y construye**

Run: `npm run typecheck:web && npm run lint && npx prettier --write "apps/web/app/**/*.{ts,tsx,css}" && npm run format:check && npm run build --workspace apps/web`
Expected: PASS las cuatro cosas, y la build de Next sin errores.

Si el typecheck se queja de que `AlephRoomView` no encaja en `SalaDeAleph`, **no castear**: el desajuste es real y está en los tipos estructurales de `estados.ts`. Comparar contra `packages/agent-sdk/src/client.ts:69-140` y `packages/game-sdk/src/aleph.ts:657-690`, y arreglar el tipo local.

Y volver a comprobar que no se coló un choque de mayúsculas ahora que están los cinco archivos (desvío 9):

Run: `for d in apps/web/app/components/aleph apps/web/app/components/aleph/nucleo; do ls "$d" | tr 'A-Z' 'a-z' | sort | uniq -d; done`
Expected: salida vacía. Si sale algo, el typecheck de arriba habría fallado con `TS1261`/`TS2305` sin nombrar la causa.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/aleph apps/web/app/globals.css
git commit -m "feat(web): los asientos de Aleph con su criatura, su oro y sus chips

La lista de hoy pasa a llevar la criatura de 48px, el oro del bolsillo dentro
del cuerpo y el chip que decide chipDeAsiento (dos si hay traidor). Se suma el
contador 'ya actuaron k de n' al lado de la línea de etapa —provisorio hasta la
carta de etapa de PR2— y se monta la terminal de la charla. aleph-respira con
su rama de prefers-reduced-motion.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: cierre — `npm run check` y la verificación visual contra producción

**Files:** ninguno (salvo los arreglos que salgan de mirar).

**Interfaces:**

- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: La suite entera**

Run: `npm run check`
Expected: PASS — `typecheck`, `lint`, `format:check`, `test` (con `aleph-criatura.test.ts`, `aleph-secretos.test.ts` e `i18n.test.ts` en verde) y `selftest`.

- [ ] **Step 2: La build de la web**

Run: `npm run build --workspace apps/web`
Expected: PASS, sin warnings nuevos.

- [ ] **Step 3: Levantar el dev server contra el árbitro de producción**

La variable es `NEXT_PUBLIC_ARBITER_URL`, con default `http://localhost:4000` (`apps/web/app/lib/arbiter.ts:15` y `apps/web/app/aleph/[roomId]/page.tsx:32`). **No hace falta abrir `apps/web/.env.example`, y probablemente no se pueda**: el dueño tiene una regla de permisos que bloquea los `.env*`. Se pasa por línea de comandos y listo.

**Van en DOS terminales**: `npm run dev` bloquea la suya hasta que se la corta.

Terminal 1, la web apuntando a Render (el árbitro duerme: el primer pedido puede tardar ~40 s):

```bash
NEXT_PUBLIC_ARBITER_URL=https://arcade1v1.onrender.com npm run dev --workspace apps/web
```

Expected: `Ready in …` y la web en `http://localhost:3000`.

Terminal 2, para sacar el `roomId` de una sala reciente ya liquidada:

Run: `curl -s https://arcade1v1.onrender.com/aleph/recent?limit=5`
Expected: un JSON `{"rooms":[{"roomId":"…","status":"settled",…}, …]}` con **al menos una** sala (el handler es `apps/server/src/aleph-routes.ts:60-67`, `res.json({ rooms: recentAlephRooms(limit) })`). Tomar el `roomId` de la primera y abrir `http://localhost:3000/aleph/<roomId>`.

**Si vuelve `{"rooms":[]}`** —o ninguna de las salas trae mensajes con `to`, que es lo que hace falta para mirar los susurros del Step 4— **no improvisar**: levantar el árbitro local, que rellena las mesas gratis con los asientos de la casa y las juega solo (`apps/server/src/aleph-house-seats.ts`; `AGENTS_ENABLED` viene prendido por defecto, `apps/server/src/agent-runner.ts:34`), y apuntar la web ahí:

```bash
npm run server
NEXT_PUBLIC_ARBITER_URL=http://localhost:4000 npm run dev --workspace apps/web
```

(el primero en una terminal, el segundo en otra), y esperar a que una mesa liquide, mirando `curl -s http://localhost:4000/aleph/recent?limit=5` hasta que devuelva una sala `settled`.

Si ni así se consigue una sala con susurros, **anotarlo explícitamente en el cuerpo del PR** —"no verificado a ojo: la terminal desclasificada queda cubierta solo por los tests 13 y 19"— en vez de dar el Step por hecho.

- [ ] **Step 4: Mirar, a 375 px y en desktop**

Abrir `http://localhost:3000/aleph` y desde ahí una sala reciente liquidada. La lista, con el navegador a **375 px de ancho** y después en desktop:

- **Ocho criaturas distintas.** Ninguna repetida, ninguna gris (el gris es la criatura desconocida y solo sale con una dirección inválida). Coronas, ojos y colores distintos entre sí.
- **La wallet abreviada visible al lado de cada una**, siempre, sin cortarse. Es la regla anti-suplantación, no una preferencia de layout. **El caso que hay que mirar a propósito es una sala de la casa a 375 px**: sus asientos siempre traen nombre y avatar (`🤖 Asterión`), que es justo lo que hacía desaparecer la wallet cuando la etiqueta iba en un solo renglón. Tiene que verse el perfil arriba (truncado si hace falta) y `0x1234...abcd` entero abajo, con el chip CASA al lado del de estado.
- **El oro proporcional**: el que más plata se llevó tiene el cuerpo casi lleno pero **nunca del todo** — arriba del oro se ve la línea de ink de 1 px de la regla D y, encima de ella, **una** última fila con el color de identidad de la criatura (con el bolsillo máximo queda esa sola; con 7 filas quedan dos). El que no se llevó nada no tiene una sola fila dorada ni línea de ink.
- **Los chips**: el de estado, más el de traidor si corresponde; nunca tres de estado. El chip CASA/WEBHOOK es de identidad y va aparte. El texto coincide con lo que dibuja la criatura.
- **El `abandono` lleva marco punteado** en la tarjeta, además de la criatura al 34 % y el dorso.
- **La charla se ve**, con la criatura de 32 px al lado de cada línea, el `>` en coral y la wallet en mono.
- **Los susurros marcados**: borde izquierdo coral, chip SUSURRO y el "a {who}"; los separadores `:: etapa n · kind` entre grupos; el cartel de desclasificación arriba de todo; y al pie la línea fija del canal privado.
- **Sin scroll lateral a 375 px.** Deslizar horizontalmente: no se mueve nada.
- Abrir también una sala **en juego** si hay alguna en `/aleph/lobbies`: las criaturas de los vivos respiran (dos cuadros, desfasadas entre sí), aparecen los puntitos cyan de "sin decidir" y el sello de los que ya actuaron, y el contador "ya actuaron k de n" sube.
- Con el sistema en "reducir movimiento" (macOS: Accesibilidad → Pantalla → Reducir movimiento), **nadie respira** y no se pierde ningún dato.

- [ ] **Step 5: Arreglar lo que aparezca y cerrar**

Cualquier arreglo va con su propio commit (`fix(web): …`) y vuelve a pasar `npm run check`. Cuando esté todo, abrir el PR:

```bash
git push -u origin feat/aleph-etapa5-espectador
gh pr create --title "Aleph, etapa 5 — PR 1 de 2: las criaturas y la charla" --body "$(cat <<'EOF'
Primera entrega de la etapa 5 (el espectador visual). Sobre la página que ya
existe, sin escena: la escena completa va en el PR 2.

- `criatura.ts`: puro, cero imports. Ocho rasgos que salen de los ocho últimos
  bytes de la dirección, 8.388.608 combinaciones, paleta con la ventana de
  luminancia del spec y criatura desconocida para cualquier basura.
- Los ocho estados, con el dorso de ALEPH, la corona dorada, la grieta del
  traidor y el oro del bolsillo proporcional a la mesa.
- La lista de asientos pasa a llevar la criatura, el oro y el chip (o dos).
- La charla pública, viva y desclasificada, con los susurros marcados.
- 19 claves de i18n en los cuatro idiomas.
- 21 tests nuevos —19 entre `aleph-criatura.test.ts` y `aleph-secretos.test.ts`,
  más 2 en `i18n.test.ts`—: grilla, zonas, tope de 40 nodos, contraste WCAG,
  variedad, determinismo, robustez, los ocho chips y lo que protege al juego.

Spec: `docs/superpowers/specs/2026-09-19-aleph-etapa5-espectador-visual-design.md`
Plan: `docs/superpowers/plans/2026-09-20-aleph-etapa5-pr1-criaturas-y-charla.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**El merge a `main` lo hace el dueño desde GitHub**: en modo auto, `gh pr merge` queda bloqueado como "Production Deploy".

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec (PR1 — el recorte).** Los ocho ítems de "Etapas de construcción → PR1" apuntan a una tarea: `criatura.ts` con las ocho tablas, la paleta y el serializador → Tasks 1, 2 y 3; `Criatura.tsx` y `estados.ts` con los ocho estados → Tasks 3 y 5; `charla.ts` con `lineasDeCharla` → Task 6; la lista de asientos con criatura, oro y chips, siguiendo vertical → Task 8; `Charla.tsx` completa, viva **y** desclasificada, con la criatura de 32 px, los separadores por etapa, el cartel de desclasificación, la línea fija del canal privado y las notas al pie → Task 7; el contador "ya actuaron k de n" en el encabezado → Task 8 Step 3(c); `aleph-respira` con su rama de reduced-motion → Task 8 Step 1; las 19 claves en los cuatro idiomas → Task 4. Los tests que PR1 se lleva: `aleph-criatura.test.ts` entero (1 a 9) → Tasks 1, 2, 3 y 5; los cuatro de secretos (17 a 20) → Tasks 2, 5 y 6; la mitad de charla del test 13 → Task 6. Las **dos** mitades del test 8 del spec están: la de `chipDeAsiento` fila por fila en el test 8b, y la de «con `traidor: true` sobre cada uno de los ocho se muestran los dos chips y nunca más de dos» en el barrido del 8b bis, que recorre los ocho estados con una Cerradura cerrada y fija el par (estado, clave de chip) de cada uno. La otra promesa del test 8 —«los ocho textos son distintos entre sí»— se comprueba donde se puede romper, que es el diccionario: el segundo test de la Task 4 la mira en los cuatro idiomas. En `aleph-criatura.test.ts` quedó lo que este módulo sí decide: que los ocho estados den ocho **dibujos** distintos (test 8a). El "Listo cuando" está en la Task 9 punto por punto. Lo que el spec pide y **no** es de la criatura también tiene tarea: la etiqueta de dos renglones con la wallet que nunca se trunca → Task 8 Step 2 (y se mira a 375 px en la Task 9 Step 4); el marco punteado del `abandono` → Task 8 Step 2; el renombre de `label()` a `etiquetaDePorDireccion` con el fallback en `shortAddress` → Task 8 Step 3(a bis), que es donde se estrena el consumidor. **Huecos conocidos, a propósito**: (a) la insignia `+{n}` del que se fue con plata no entra en PR1 (desvío 7, con su razón); (b) `aleph.chat.caps` cambia de lugar dentro de la misma ventana (desvío 6); (c) `Criatura.tsx` y `Charla.tsx` no llevan test unitario, porque el repo no tiene harness de DOM y el spec lo pide así (desvío 8); (d) `mmss()` no se muda a `app/lib/tiempo.ts` todavía: el otro consumidor (`CartaEtapa.tsx`) es de PR2 y la página la sigue usando donde está; (e) con el bolsillo máximo queda **una** fila de identidad arriba del oro y no dos, porque el borde de la regla D ocupa una fila del cuerpo (desvío 11); (f) el `>` de los susurros queda coral como el de los públicos, y su chip va `.chip` a secas en vez de `chip--danger`, que el spec reserva para el traidor (desvío 12). Todo lo demás de PR1 está cubierto. Nada de PR2 se coló: no hay escena, ni Mesa, ni CartaEtapa, ni Friso, ni Asientos, ni Liquidacion, ni probador, ni `movimiento.ts`, ni el botón de pausa, ni el borrado de las cuatro claves huérfanas, ni la mudanza de `mmss()`, ni la rama de `lobby` en `counting` — y la prop `destello` existe desde el día uno, pero la página monta `<Charla destello={null} />`.
- **Scan de placeholders.** Ningún "TBD", "TODO", "implementar después" ni "similar a la tarea N": las ocho tablas van con sus píxeles exactos, las 19 claves con sus cuatro traducciones escritas de verdad (el hindi en devanagari, sin una sola secuencia backslash-u), y cada Step de código lleva su bloque completo. Los únicos comandos que devuelven un valor que solo existe al ejecutar son el `roomId` de la Task 9 Step 3 (sale del `curl`, que ahora lleva su `Expected:` con la forma del JSON y un plan B con el árbitro local si vuelve `{"rooms":[]}`) y el número de PR.
- **Consistencia de tipos y nombres entre tareas.** `Nodo {x, y, w, h, fill}` es el mismo en las cinco tareas que lo tocan. `Estado` se declara en la Task 2 y lo consumen `estados.ts` (Task 5), `Criatura.tsx` (Task 3) y la página (Task 8), siempre con los ocho mismos identificadores. `Rasgos` lleva `desfase` desde la Task 1 aunque recién lo use `Criatura.tsx` en la Task 3. `capaDeIdentidad(rasgos, { filas?, conPatas? })` tiene la misma firma en la Task 1 (donde se define), en la Task 2 (donde `nodosDe` la llama con `conPatas: estado !== "votado"`) y en el test 18 de la Task 2 (donde se la llama con `{ filas: 0 }`). `filasDeOro(bolsillo, maxBolsillo)` se define en la Task 2, la llama `Criatura.tsx` en la Task 3 a través de la prop `oro: { bolsillo, maximo }` y la página arma ese objeto en la Task 8. `SalaDeAleph` se declara una sola vez, en `estados.ts` (Task 5), y lo importan `charla.ts` (Task 6), `Charla.tsx` (Task 7) y los dos archivos de test; `AlephRoomView` encaja por estructura y la Task 8 Step 4 dice qué hacer si no. `chipDeAsiento` devuelve **la clave**, nunca el texto: la página es la única que llama a `t`. Las 19 claves de la Task 4 son exactamente las que usan las Tasks 5, 7 y 8, y el test de la Task 4 las enumera con el mismo nombre. `direcciones(n, semilla)` vive en `apps/web/test/aleph-ayuda.ts` y la usan los dos archivos de test con la misma firma.

## Segunda pasada, con ojos frescos (2026-09-20)

Un control aparte volvió a recorrer el plan contra el spec y contra el repo. **Los números del plan se corrieron de verdad**, con un puerto del `criatura.ts` de las Tasks 1 a 3 a JS pelado, fuera del repo: los nueve cuerpos caen en la ventana de luminancia (0,1455 a 0,1470), el oro da entre 3,18:1 y 3,20:1 contra cada uno y 2,84:1 contra `--color-surface-2`, el `#a97f1e` da 1,46–1,47:1 (de ahí la regla D), el `#7a7368` de la maqueta da 0,1740 y 2,79:1, los cuatro secundarios quedan en saturación 0,045 a 0,156 y 4,75:1 o más contra `--color-surface`, las combinaciones son 8.388.608, la semilla 99 da 16 colisiones sobre 20.000 direcciones, la identidad topea en 23 nodos y la cara en 9, el peor caso total es 39 y sale en `esperando + traidor` y `ganador + traidor` (con `hablando + traidor` en 38), el centro del dorso pasa a tinta a partir de 4 filas en `votado` **y** en `abandono`, y los ocho estados dan ocho dibujos distintos en las 500 direcciones probadas. También se comprobaron contra el repo los números de línea de `page.tsx`, `globals.css` y los cuatro diccionarios, que `aleph.stage.*` ya existe, que ninguna de las 19 claves nuevas pisa una que esté, que los tipos locales de `estados.ts` coinciden uno a uno con `StageKind`, `Phase`, `SeatStatus`, `AlephRoomStatus`, `StageResult` y `AlephMessage`, y que el comando de `var()` de la Task 8 devuelve hoy exactamente las tres líneas que el plan espera.

Lo que esa pasada **cambió** en el plan, y nada más que eso:

- El trailer de los commits: queda fijado en la atribución de la sesión que dirige la etapa (`Claude Fable 5.1`, la misma del spec); si otra sesión retoma el plan, pone la suya.
- La fila de `i18n.test.ts` de "File structure" decía "un test más" y la Task 4 agrega **dos**.
- La línea de archivos de la Task 8 nombraba **tres** lugares de `globals.css` —el tercero, "un bloque nuevo al final de la capa de componentes", no existe en ningún Step—. Ahora dice los dos reales, con el `@layer components` (`:157-480`) que fija la indentación.
- El aviso de no tocar el `label` de `<Money>` apuntaba a `:424` como si ahí hubiera un `label={...}`: es el `{label}` de adentro del componente. Queda `:212-214` para la prop y `:417`/`:424` para su uso.
- Las dos firmas de componente de "Interfaces" (`Criatura`, `Charla`) terminaban en `JSX.Element`. Con los tipos de React 19 no existe el namespace global `JSX` y en `apps/web` no hay un solo uso: anotarlo rompe el `typecheck`. Ahora dicen qué devuelven y que el retorno no se anota.
- `Charla.tsx` recorta el separador cuando la etapa no trae `kind` —el caso que el propio test 13 fabrica—: sin eso quedaba un "·" colgando. Las cuatro traducciones terminan en `{kind}` y usan el mismo "·", así que con `kind` lleno no recorta nada.
- `aleph-respira` pasa a ser el desvío 13: `steps(2)` a secas deja el cuerpo en medio píxel.

**Lo que se miró y quedó como estaba**, para que no se vuelva a revisar: la cobertura de los ocho ítems de "PR1 — el recorte" y de los tests 1 a 9, 13 (mitad), 17 a 20; las 19 claves con su texto castellano igual al del spec y sus variables en los cuatro idiomas; los conteos de tests de cada Step (5, 9, 12, 4, 16, 19) y los 21 del cuerpo del PR; las siete filas de `chipDeAsiento` y las nueve de `estadoDeAsiento` contra las tablas del spec; y que ningún patrón de relleno (TODO, TBD, "igual que la Task N", "etc.") aparezca en el archivo.
