# Fase 5 — Más de una estrategia por juego · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un segundo estilo de juego (estrategia) distinto en 3 juegos —2048, Snake y Carrera— y un selector en el builder cuando un juego tiene más de una.

**Architecture:** Cada estrategia nueva es un archivo propio en `packages/strategies/src` que maneja el motor real tick a tick (así el replay verifica idéntico por construcción) y se suma al array `ALL` del registro. La suite de tests ya está parametrizada sobre `STRATEGIES`, así que cada nueva hereda los chequeos de verificación/determinismo/puntaje/tamaño; se agrega solo un test de distinción. En el builder, el paso 2 gana un selector de estilo que se muestra solo cuando `strategiesFor(game).length > 1`; los juegos de una sola estrategia quedan idénticos a hoy.

**Tech Stack:** TypeScript, Node test runner (`node --import tsx --test`), Next.js (App Router) + Tailwind v4, monorepo npm workspaces.

## Global Constraints

- **Verificación anti-trampa por construcción:** toda estrategia maneja el motor real de `@arcade1v1/game-sdk`; el replay que devuelve lo reproduce el verificador con el MISMO puntaje. No se toca ningún motor ni verificador.
- **Default-deny:** los parámetros nuevos se declaran como `ParamSpec` (slider/choice) y `validateParams` (ya existente) los sanea. Sin validación paralela.
- **4 idiomas de primera:** todo texto nuevo va en en/es/hi/fr en `apps/web/app/lib/i18n-dict.ts`. Sin "TODO traducir".
- **Agentes existentes intactos:** solo se SUMAN estrategias; los `strategyId` ya desplegados siguen válidos. No cambiar defaults del agent-sdk.
- **Jerarquía de CTAs:** el selector es una elección de radio (una activa), no botones de acciones distintas.
- **No pushear sin OK explícito del usuario** (push despliega a producción). El plan llega hasta verificación local + changelog; el push queda gateado aparte.
- **Commits atómicos** con mensajes convencionales en español (`feat(...)`, `test(...)`, `docs: ...`).

---

### Task 1: 2048 — estrategia "Esquinero" (`2048.corner`)

**Files:**
- Modify: `packages/strategies/src/types.ts` — agregar `descKey?` a `StrategyDef`
- Modify: `packages/strategies/src/g2048.ts` — exportar helper puro `applyDir`
- Create: `packages/strategies/src/g2048-corner.ts` — `strategy2048Corner`
- Modify: `packages/strategies/src/registry.ts` — registrar la nueva
- Test: `packages/strategies/test/strategies.test.ts` (suite parametrizada existente, se corre; no se edita en esta task)

**Interfaces:**
- Consumes: `Game2048`, `SIZE`, `Dir` de `@arcade1v1/game-sdk/g2048`; `num`, `choice` de `./params`; `slide` (privado) de `./g2048`.
- Produces:
  - `StrategyDef` gana campo opcional `descKey?: string`.
  - `g2048.ts` exporta `applyDir(board: number[][], dir: Dir): { board: number[][]; gained: number; changed: boolean }`.
  - `g2048-corner.ts` exporta `strategy2048Corner: StrategyDef` con `id: "2048.corner"`, `game: "2048"`, params `corner` (choice) y `patience` (slider). Replay con forma `{ seed, moves }` (idéntica al fusionador, la lee `verify2048`).

- [ ] **Step 1: Agregar `descKey?` al contrato `StrategyDef`**

En `packages/strategies/src/types.ts`, dentro de `interface StrategyDef`, después de `labelKey`:

```ts
  /** Clave i18n del nombre de la estrategia. */
  labelKey: string;
  /** Clave i18n de una descripción en una línea (para el selector del builder). */
  descKey?: string;
  params: ParamSpec[];
```

- [ ] **Step 2: Exportar `applyDir` puro en `g2048.ts`**

En `packages/strategies/src/g2048.ts`, dejar `slide` y `evalMove` como están (el fusionador no se toca) y agregar, después de la función `slide`, este helper exportado (reusa `slide`):

```ts
/** Aplica una dirección a una copia PURA del tablero (sin spawn, sin RNG) y
 *  devuelve el tablero resultante, el puntaje ganado y si algo cambió. Lo usa
 *  el esquinero para evaluar la calidad del tablero post-movimiento sin tocar
 *  el motor. */
export function applyDir(
  board: number[][],
  dir: Dir,
): { board: number[][]; gained: number; changed: boolean } {
  const out = board.map((r) => r.slice());
  let gained = 0;
  let changed = false;
  if (dir === "left" || dir === "right") {
    for (let r = 0; r < SIZE; r++) {
      const input = dir === "right" ? out[r].slice().reverse() : out[r];
      const res = slide(input);
      out[r] = dir === "right" ? res.row.slice().reverse() : res.row;
      gained += res.gained;
      if (res.changed) changed = true;
    }
  } else {
    for (let c = 0; c < SIZE; c++) {
      const col: number[] = [];
      for (let r = 0; r < SIZE; r++) col.push(out[r][c]);
      const input = dir === "down" ? col.reverse() : col;
      const res = slide(input);
      const newCol = dir === "down" ? res.row.slice().reverse() : res.row;
      for (let r = 0; r < SIZE; r++) out[r][c] = newCol[r];
      gained += res.gained;
      if (res.changed) changed = true;
    }
  }
  return { board: out, gained, changed };
}
```

- [ ] **Step 3: Crear la estrategia esquinera**

Crear `packages/strategies/src/g2048-corner.ts`:

```ts
// Estrategia de 2048 "Esquinero": ordena el tablero hacia una esquina en vez de
// fusionar apenas puede. Anticipa 1 jugada sobre una copia PURA del tablero
// (reusa applyDir de g2048) y puntúa la calidad resultante: celdas vacías +
// monotonía hacia la esquina, con un toque de fusión modulado por `patience`.
// Aplica la dirección elegida al motor real, así el replay verifica idéntico.

import { Game2048, SIZE, type Dir } from "@arcade1v1/game-sdk/g2048";
import type { StrategyDef, PlayResult } from "./types";
import { num, choice } from "./params";
import { applyDir } from "./g2048";

const DIRS: Dir[] = ["down", "left", "right", "up"];
const MAX_MOVES = 5000;

type Corner = "down-left" | "down-right" | "up-left" | "up-right";

function log2v(v: number): number {
  return v > 0 ? Math.log2(v) : 0;
}

/** Cantidad de celdas vacías (más = mejor: supervivencia). */
function empties(board: number[][]): number {
  let n = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] === 0) n++;
  return n;
}

/** Penalización por romper el gradiente hacia la esquina (0 = perfecto, <0 peor).
 *  Para "*-left" queremos las fichas grandes a la izquierda; para "down-*",
 *  abajo. Usa log2 de los valores para que la escala sea sana. */
function monotonicity(board: number[][], corner: Corner): number {
  const wantLeftBig = corner.endsWith("left");
  const wantBottomBig = corner.startsWith("down");
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c + 1 < SIZE; c++) {
      const a = log2v(board[r][c]);
      const b = log2v(board[r][c + 1]);
      score -= wantLeftBig ? Math.max(0, b - a) : Math.max(0, a - b);
    }
  }
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r + 1 < SIZE; r++) {
      const a = log2v(board[r][c]);
      const b = log2v(board[r + 1][c]);
      score -= wantBottomBig ? Math.max(0, a - b) : Math.max(0, b - a);
    }
  }
  return score;
}

const PARAMS = [
  {
    key: "corner",
    kind: "choice" as const,
    options: ["down-left", "down-right", "up-left", "up-right"],
    def: "down-left",
    labelKey: "strat.2048.corner.corner",
  },
  {
    key: "patience",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.7,
    labelKey: "strat.2048.corner.patience",
  },
];

export const strategy2048Corner: StrategyDef = {
  id: "2048.corner",
  game: "2048",
  labelKey: "strat.2048.corner.name",
  descKey: "strat.2048.corner.desc",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const corner = choice(params, PARAMS[0]) as Corner;
    const patience = num(params, PARAMS[1]);
    const g = new Game2048(seed);
    const moves: Dir[] = [];
    let guard = 0;
    while (!g.over && guard < MAX_MOVES) {
      let best: Dir | null = null;
      let bestValue = -Infinity;
      for (const d of DIRS) {
        const { board: nb, gained, changed } = applyDir(g.board, d);
        if (!changed) continue;
        // Orden (vacíos + monotonía) pesado por paciencia; fusión inmediata por
        // lo que reste. Paciente (0.7) => prioriza dejar el tablero ordenado.
        const order = empties(nb) + monotonicity(nb, corner);
        const value = patience * order + (1 - patience) * (gained * 0.25);
        if (value > bestValue) {
          bestValue = value;
          best = d;
        }
      }
      if (best === null) break;
      if (!g.move(best)) break;
      moves.push(best);
      guard++;
    }
    return { score: g.score, replay: { seed, moves } };
  },
};
```

- [ ] **Step 4: Registrar la estrategia**

En `packages/strategies/src/registry.ts`, agregar el import y sumarla al array `ALL` **justo después** de `strategy2048Priority`:

```ts
import { strategy2048Priority } from "./g2048";
import { strategy2048Corner } from "./g2048-corner";
import { strategySnakeGreedy } from "./snake";
```

```ts
const ALL: StrategyDef[] = [
  strategyInvadersHunter,
  strategyFlappyThreshold,
  strategy2048Priority,
  strategy2048Corner,
  strategySnakeGreedy,
  strategyTetrisHeuristic,
  strategyRacingDodger,
];
```

- [ ] **Step 5: Correr la suite (verifica anti-trampa, determinismo, puntaje, tamaño)**

Run: `node --import tsx --test packages/strategies/test/strategies.test.ts`
Expected: PASS. En particular estos (auto-generados para `2048.corner`):
- `2048.corner: el verificador reproduce el puntaje exacto (default y alternativo)`
- `2048.corner: determinista`
- `2048.corner: hace puntos con los params por defecto`
- `2048.corner: el replay entra en el límite de 256kb`

Si `hace puntos` fallara (score 0 en las 3 semillas), bajar `patience` def a 0.5 y volver a correr (más peso a fusiones ⇒ puntúa seguro). No debería hacer falta: el esquinero fusiona al ordenar.

- [ ] **Step 6: Commit**

```bash
git add packages/strategies/src/types.ts packages/strategies/src/g2048.ts packages/strategies/src/g2048-corner.ts packages/strategies/src/registry.ts
git commit -m "feat(strategies): estrategia Esquinero para 2048 (2048.corner)"
```

---

### Task 2: Snake — estrategia "Superviviente" (`snake.survivor`)

**Files:**
- Modify: `packages/strategies/src/snake.ts` — exportar helpers puros `ACTS`, `DELTA`, `wrapDist`, `freeSpace`
- Create: `packages/strategies/src/snake-survivor.ts` — `strategySnakeSurvivor`
- Modify: `packages/strategies/src/registry.ts` — registrar la nueva
- Test: `packages/strategies/test/strategies.test.ts` (suite, se corre)

**Interfaces:**
- Consumes: `SnakeEngine`, `GRID`, `SnakeAction` de `@arcade1v1/game-sdk/snake`; `num` de `./params`; `ACTS`, `DELTA`, `wrapDist`, `freeSpace` de `./snake`.
- Produces:
  - `snake.ts` exporta `ACTS: SnakeAction[]`, `DELTA: Record<SnakeAction,{x:number;y:number}>`, `wrapDist(ax,ay,bx,by): number`, `freeSpace(occupied: Set<number>, x: number, y: number, cap: number): number`.
  - `snake-survivor.ts` exporta `strategySnakeSurvivor: StrategyDef` con `id: "snake.survivor"`, `game: "snake"`, param `foodPull` (slider). Replay `{ seed, ticks, inputs }` (idéntico al cazador, lo lee `verifySnake`).

- [ ] **Step 1: Exportar los helpers puros de `snake.ts`**

En `packages/strategies/src/snake.ts`, agregar `export` a las cuatro declaraciones existentes (sin cambiar sus cuerpos):

```ts
export const ACTS: SnakeAction[] = ["u", "d", "l", "r"];
export const DELTA: Record<SnakeAction, { x: number; y: number }> = {
```

```ts
/** Distancia Manhattan con wrap (las paredes no existen: la víbora reaparece). */
export function wrapDist(ax: number, ay: number, bx: number, by: number): number {
```

```ts
/** Cuántas celdas libres se alcanzan desde (x,y), acotado a `cap` (barato). */
export function freeSpace(occupied: Set<number>, x: number, y: number, cap: number): number {
```

- [ ] **Step 2: Crear la estrategia superviviente**

Crear `packages/strategies/src/snake-survivor.ts`:

```ts
// Estrategia de Snake "Superviviente": el espacio libre alcanzable MANDA; solo
// se acerca a la comida cuando no sacrifica aire. Invierte los pesos del cazador
// (que deja mandar a la distancia), así serpentea y sobrevive más. Como el flood
// fill se satura (cap) en tablero abierto, ahí todos los movimientos empatan en
// espacio y la comida decide: come cuando es seguro, cuida el cuerpo cuando no.

import { SnakeEngine, GRID, type SnakeAction } from "@arcade1v1/game-sdk/snake";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";
import { ACTS, DELTA, wrapDist, freeSpace } from "./snake";

const MAX_TICKS = 36_000;
const SPACE_CAP = 80; // saturación del flood fill: en tablero abierto empatan

const PARAMS = [
  {
    key: "foodPull",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.05,
    def: 0.35,
    labelKey: "strat.snake.survivor.foodPull",
  },
];

export const strategySnakeSurvivor: StrategyDef = {
  id: "snake.survivor",
  game: "snake",
  labelKey: "strat.snake.survivor.name",
  descKey: "strat.snake.survivor.desc",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const foodPull = num(params, PARAMS[0]);
    const g = new SnakeEngine(seed);
    const inputs: { t: number; a: SnakeAction }[] = [];
    let lastApplied: SnakeAction | null = null;

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      const head = g.body[0];
      const occupied = new Set<number>();
      for (const s of g.body) occupied.add(s.y * GRID + s.x);

      let best: SnakeAction | null = null;
      let bestValue = -Infinity;
      for (const a of ACTS) {
        const d = DELTA[a];
        if (d.x === -g.dir.x && d.y === -g.dir.y) continue; // el motor ignora la reversa
        const nx = (head.x + d.x + GRID) % GRID;
        const ny = (head.y + d.y + GRID) % GRID;
        if (occupied.has(ny * GRID + nx)) continue;
        // El espacio DOMINA (0..cap); la comida entra con peso chico y solo
        // desempata cuando el espacio se satura (tablero abierto = seguro).
        const space = freeSpace(occupied, nx, ny, SPACE_CAP);
        const dist = wrapDist(nx, ny, g.food.x, g.food.y);
        const value = space + foodPull * -dist * 0.3;
        if (value > bestValue) {
          bestValue = value;
          best = a;
        }
      }
      if (best !== null && best !== lastApplied) {
        g.apply(best);
        inputs.push({ t, a: best });
        lastApplied = best;
      }
      g.tick();
    }

    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs } };
  },
};
```

- [ ] **Step 3: Registrar la estrategia**

En `packages/strategies/src/registry.ts`, agregar el import tras el de snake y sumarla al array `ALL` justo después de `strategySnakeGreedy`:

```ts
import { strategySnakeGreedy } from "./snake";
import { strategySnakeSurvivor } from "./snake-survivor";
```

```ts
const ALL: StrategyDef[] = [
  strategyInvadersHunter,
  strategyFlappyThreshold,
  strategy2048Priority,
  strategy2048Corner,
  strategySnakeGreedy,
  strategySnakeSurvivor,
  strategyTetrisHeuristic,
  strategyRacingDodger,
];
```

- [ ] **Step 4: Correr la suite**

Run: `node --import tsx --test packages/strategies/test/strategies.test.ts`
Expected: PASS, incluyendo los cuatro tests auto-generados para `snake.survivor` (verificación exacta, determinista, hace puntos, ≤256kb).

Si `hace puntos` fallara (demasiado cauto, no come en ninguna semilla), subir `foodPull` def a 0.6. No debería: en tablero abierto el flood fill satura y la comida desempata.

- [ ] **Step 5: Commit**

```bash
git add packages/strategies/src/snake.ts packages/strategies/src/snake-survivor.ts packages/strategies/src/registry.ts
git commit -m "feat(strategies): estrategia Superviviente para Snake (snake.survivor)"
```

---

### Task 3: Carrera — estrategia "Serpenteador" (`racing.weaver`)

**Files:**
- Create: `packages/strategies/src/racing-weaver.ts` — `strategyRacingWeaver`
- Modify: `packages/strategies/src/registry.ts` — registrar la nueva
- Test: `packages/strategies/test/strategies.test.ts` (suite, se corre)

**Interfaces:**
- Consumes: `RacingEngine`, `RACING_DT`, `RACING_CONST`, `LANES` de `@arcade1v1/game-sdk/racing`; `num` de `./params`.
- Produces: `racing-weaver.ts` exporta `strategyRacingWeaver: StrategyDef` con `id: "racing.weaver"`, `game: "racing"`, param `boldness` (slider). Replay `{ seed, ticks, inputs }` (idéntico al esquivador, lo lee `verifyRacing`).

- [ ] **Step 1: Crear la estrategia serpenteadora**

Crear `packages/strategies/src/racing-weaver.ts`:

```ts
// Estrategia de la Carrera "Serpenteador": en vez de esquivar reactivo, busca
// proactivamente el carril con más pista despejada por delante y fluye hacia él,
// un carril por vez. `boldness` = cuánta ventaja de holgura exige para cambiar:
// baja serpentea seguido, alta solo cambia cuando es claramente mejor. Maneja el
// motor real, así el replay verifica idéntico.

import { RacingEngine, RACING_DT, RACING_CONST, LANES } from "@arcade1v1/game-sdk/racing";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";

const MAX_TICKS = 36_000;
const CAR_Y = RACING_CONST.HEIGHT - 80; // igual que el motor (CAR_Y privado)
const CHANGE_COOLDOWN = 8; // ticks mínimos entre cambios de carril (anti-vibración)
const CLEAR_CAP = RACING_CONST.HEIGHT; // holgura si el carril está limpio por delante
const MARGIN_SCALE = 240; // px: boldness=0.3 => exige ~72px de ventaja para cambiar

const PARAMS = [
  {
    key: "boldness",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.05,
    def: 0.3,
    labelKey: "strat.racing.weaver.boldness",
  },
];

export const strategyRacingWeaver: StrategyDef = {
  id: "racing.weaver",
  game: "racing",
  labelKey: "strat.racing.weaver.name",
  descKey: "strat.racing.weaver.desc",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const boldness = num(params, PARAMS[0]);
    const g = new RacingEngine(seed);
    const inputs: { t: number; a: "l" | "r" }[] = [];
    let cooldown = 0;

    /** Distancia al obstáculo más cercano por delante (arriba del auto) en
     *  `lane`; CLEAR_CAP si no hay ninguno. Más holgura = más seguro. */
    const clearance = (lane: number): number => {
      let best = CLEAR_CAP;
      for (const o of g.obstacles) {
        if (o.lane !== lane || o.y >= CAR_Y) continue; // solo lo que viene por delante
        const d = CAR_Y - o.y;
        if (d < best) best = d;
      }
      return best;
    };

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0) {
        const here = clearance(g.carLane);
        let bestLane = g.carLane;
        let bestClear = here;
        for (const l of [g.carLane - 1, g.carLane + 1]) {
          if (l < 0 || l >= LANES) continue;
          const c = clearance(l);
          if (c > bestClear) {
            bestClear = c;
            bestLane = l;
          }
        }
        const margin = boldness * MARGIN_SCALE;
        if (bestLane !== g.carLane && bestClear - here > margin) {
          const a: "l" | "r" = bestLane < g.carLane ? "l" : "r";
          if (a === "l") g.moveLeft();
          else g.moveRight();
          inputs.push({ t, a });
          cooldown = CHANGE_COOLDOWN;
        }
      }
      g.update(RACING_DT);
    }

    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs } };
  },
};
```

- [ ] **Step 2: Registrar la estrategia**

En `packages/strategies/src/registry.ts`, agregar el import tras el de racing y sumarla al array `ALL` justo después de `strategyRacingDodger`:

```ts
import { strategyRacingDodger } from "./racing";
import { strategyRacingWeaver } from "./racing-weaver";
```

```ts
const ALL: StrategyDef[] = [
  strategyInvadersHunter,
  strategyFlappyThreshold,
  strategy2048Priority,
  strategy2048Corner,
  strategySnakeGreedy,
  strategySnakeSurvivor,
  strategyTetrisHeuristic,
  strategyRacingDodger,
  strategyRacingWeaver,
];
```

- [ ] **Step 3: Correr la suite**

Run: `node --import tsx --test packages/strategies/test/strategies.test.ts`
Expected: PASS, incluyendo los cuatro tests auto-generados para `racing.weaver`.

Si `hace puntos` fallara, bajar `MARGIN_SCALE` a 160 (cambia de carril más fácil ⇒ esquiva más ⇒ sobrevive más). No debería: sobrevivir acumula distancia = puntaje.

- [ ] **Step 4: Commit**

```bash
git add packages/strategies/src/racing-weaver.ts packages/strategies/src/registry.ts
git commit -m "feat(strategies): estrategia Serpenteador para Carrera (racing.weaver)"
```

---

### Task 4: Test de distinción (el criterio de la fase)

**Files:**
- Modify: `packages/strategies/test/strategies.test.ts` — agregar el test de distinción por juego

**Interfaces:**
- Consumes: `STRATEGIES`, `defaultParams`, `SEEDS` (ya en el archivo). Usa los tres pares `2048.priority/2048.corner`, `snake.greedy/snake.survivor`, `racing.dodger/racing.weaver`.
- Produces: 3 tests nuevos (uno por juego con dos estrategias) que afirman que juegan distinto.

- [ ] **Step 1: Escribir el test de distinción**

Al final de `packages/strategies/test/strategies.test.ts`, agregar:

```ts
// Fase 5: los juegos con dos estilos producen partidas VISIBLEMENTE distintas
// (el criterio "dos estrategias del mismo juego se juegan distinto"). Se compara
// con los params por defecto de cada una sobre las mismas semillas.
const DUAL_GAMES: Array<[string, string]> = [
  ["2048.priority", "2048.corner"],
  ["snake.greedy", "snake.survivor"],
  ["racing.dodger", "racing.weaver"],
];

for (const [idA, idB] of DUAL_GAMES) {
  test(`${idA} vs ${idB}: juegan distinto (replays y algún puntaje difieren)`, () => {
    const a = STRATEGIES[idA];
    const b = STRATEGIES[idB];
    assert.ok(a && b, `faltan estrategias: ${idA} / ${idB}`);
    assert.equal(a.game, b.game, "tienen que ser del mismo juego");
    let replaysDiffer = false;
    let scoreDiffers = false;
    for (const seed of SEEDS) {
      const ra = a.play(seed, defaultParams(a));
      const rb = b.play(seed, defaultParams(b));
      if (JSON.stringify(ra.replay) !== JSON.stringify(rb.replay)) replaysDiffer = true;
      if (ra.score !== rb.score) scoreDiffers = true;
    }
    assert.ok(replaysDiffer, `${idA}/${idB}: replays idénticos en todas las semillas`);
    assert.ok(scoreDiffers, `${idA}/${idB}: mismo puntaje en todas las semillas`);
  });
}
```

- [ ] **Step 2: Correr la suite completa**

Run: `node --import tsx --test packages/strategies/test/strategies.test.ts`
Expected: PASS, incluyendo los 3 tests `... juegan distinto ...`.

Si algún par NO difiere en puntaje en ninguna semilla (raro), revisar que la estrategia nueva no colapsó al mismo comportamiento; ajustar su default para diferenciarla (p. ej. `patience`/`foodPull`/`boldness`). No relajar el test.

- [ ] **Step 3: Commit**

```bash
git add packages/strategies/test/strategies.test.ts
git commit -m "test(strategies): las dos estrategias de cada juego juegan distinto"
```

---

### Task 5: Builder — selector de estilo + textos ×4

**Files:**
- Modify: `apps/web/app/build/page.tsx:196-231` — bloque del paso 2 (agregar selector arriba de las perillas)
- Modify: `apps/web/app/lib/i18n-dict.ts` — claves nuevas en los 4 bloques (en/es/hi/fr)

**Interfaces:**
- Consumes: `strategiesFor`, `getStrategy`, `defaultParams` (ya importados en la página); `def.labelKey`, `def.descKey`. Estrategias `2048.corner`, `snake.survivor`, `racing.weaver` de las Tasks 1-3.
- Produces: paso 2 con selector condicional; claves i18n `build.style`, nombres/descripciones/perillas nuevas y opciones `strat.opt.down-left|down-right|up-left|up-right`.

- [ ] **Step 1: Agregar el selector de estilo al paso 2**

En `apps/web/app/build/page.tsx`, reemplazar la apertura del bloque del paso 2. Buscar:

```tsx
          {/* Paso 2: perillas de la estrategia + score estimado en vivo */}
          {step === 2 && def && (
            <>
              <div className="win mt-4 p-4">
```

y reemplazar por (agrega `&& game` a la condición y el selector condicional antes de la caja de perillas):

```tsx
          {/* Paso 2: elegir estilo (si hay >1) + perillas + score estimado en vivo */}
          {step === 2 && def && game && (
            <>
              {strategiesFor(game).length > 1 && (
                <>
                  <p className="mt-4 text-sm text-(--color-muted-2)">{t("build.style")}</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {strategiesFor(game).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setStrategyId(s.id);
                          setParams(defaultParams(s));
                          setSandbox(null);
                        }}
                        className={`win p-3 text-left transition hover:-translate-y-0.5 ${
                          strategyId === s.id ? "!border-(--color-accent)" : ""
                        }`}
                      >
                        <p className="font-pixel text-px10 text-(--color-accent-2)">
                          {t(s.labelKey)}
                        </p>
                        {s.descKey && (
                          <p className="mt-1 text-sm leading-snug text-(--color-muted)">
                            {t(s.descKey)}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="win mt-4 p-4">
```

(El resto del bloque —el `.map` de perillas, la caja del score estimado y el cierre `</>`— queda igual.)

- [ ] **Step 2: Verificar tipos/lint del builder**

Run: `npm run -w @arcade1v1/web typecheck` (o `npm run check` acotado a la web si existe; ver package.json de la web)
Expected: PASS (sin error de `game` posiblemente null: la condición ya lo estrecha).

Si no hubiese script de typecheck por-workspace, saltar a la verificación global de la Task 6; esta comprobación se cubre ahí.

- [ ] **Step 3: Agregar las claves i18n — bloque `en` (`const en: Dict = {`)**

En `apps/web/app/lib/i18n-dict.ts`, en el bloque **en**, junto a las otras claves `strat.*` (después de `"strat.opt.down": "down",`), agregar:

```ts
  "build.style": "Play style",
  "strat.2048.corner.name": "Corner builder",
  "strat.2048.corner.corner": "Target corner",
  "strat.2048.corner.patience": "Patience (order over instant merges)",
  "strat.snake.survivor.name": "Survivor",
  "strat.snake.survivor.foodPull": "Food pull (risk for food vs space)",
  "strat.racing.weaver.name": "Lane weaver",
  "strat.racing.weaver.boldness": "Boldness (clearance edge to switch lanes)",
  "strat.2048.priority.desc": "Merges tiles the moment it can",
  "strat.2048.corner.desc": "Herds tiles neatly into one corner",
  "strat.snake.greedy.desc": "Heads straight for the food",
  "strat.snake.survivor.desc": "Avoids trapping itself; survives longer",
  "strat.racing.dodger.desc": "Holds its lane, dodges only when needed",
  "strat.racing.weaver.desc": "Always seeks the clearest lane",
  "strat.opt.down-left": "down-left",
  "strat.opt.down-right": "down-right",
  "strat.opt.up-left": "up-left",
  "strat.opt.up-right": "up-right",
```

- [ ] **Step 4: Agregar las claves i18n — bloque `es` (`const es: Dict = {`)**

En el bloque **es**, junto a las `strat.*` (después de `"strat.opt.down": "abajo",`), agregar:

```ts
  "build.style": "Estilo de juego",
  "strat.2048.corner.name": "Esquinero",
  "strat.2048.corner.corner": "Esquina objetivo",
  "strat.2048.corner.patience": "Paciencia (orden antes que fusionar ya)",
  "strat.snake.survivor.name": "Superviviente",
  "strat.snake.survivor.foodPull": "Tirón a la comida (riesgo vs espacio)",
  "strat.racing.weaver.name": "Serpenteador",
  "strat.racing.weaver.boldness": "Audacia (ventaja de pista para cambiar de carril)",
  "strat.2048.priority.desc": "Junta fichas apenas puede",
  "strat.2048.corner.desc": "Apila prolijo hacia una esquina",
  "strat.snake.greedy.desc": "Va derecho a la comida",
  "strat.snake.survivor.desc": "Evita encerrarse; sobrevive más",
  "strat.racing.dodger.desc": "Se queda en su carril, esquiva solo si hace falta",
  "strat.racing.weaver.desc": "Busca siempre el carril más despejado",
  "strat.opt.down-left": "abajo-izquierda",
  "strat.opt.down-right": "abajo-derecha",
  "strat.opt.up-left": "arriba-izquierda",
  "strat.opt.up-right": "arriba-derecha",
```

- [ ] **Step 5: Agregar las claves i18n — bloque `hi` (`const hi: Dict = {`)**

En el bloque **hi**, junto a las `strat.*`, agregar:

```ts
  "build.style": "खेल शैली",
  "strat.2048.corner.name": "कोना बनाने वाला",
  "strat.2048.corner.corner": "लक्ष्य कोना",
  "strat.2048.corner.patience": "धैर्य (तुरंत मर्ज से पहले क्रम)",
  "strat.snake.survivor.name": "उत्तरजीवी",
  "strat.snake.survivor.foodPull": "भोजन खिंचाव (भोजन बनाम जगह का जोखिम)",
  "strat.racing.weaver.name": "लेन बुनकर",
  "strat.racing.weaver.boldness": "साहस (लेन बदलने के लिए जगह की बढ़त)",
  "strat.2048.priority.desc": "जैसे ही संभव हो टाइलें मर्ज करता है",
  "strat.2048.corner.desc": "टाइलों को एक कोने में करीने से जमाता है",
  "strat.snake.greedy.desc": "सीधे भोजन की ओर जाता है",
  "strat.snake.survivor.desc": "खुद को फँसने से बचाता है; अधिक समय जीवित रहता है",
  "strat.racing.dodger.desc": "अपनी लेन में रहता है, ज़रूरत पड़ने पर ही चकमा देता है",
  "strat.racing.weaver.desc": "हमेशा सबसे साफ़ लेन खोजता है",
  "strat.opt.down-left": "नीचे-बाएँ",
  "strat.opt.down-right": "नीचे-दाएँ",
  "strat.opt.up-left": "ऊपर-बाएँ",
  "strat.opt.up-right": "ऊपर-दाएँ",
```

- [ ] **Step 6: Agregar las claves i18n — bloque `fr` (`const fr: Dict = {`)**

En el bloque **fr**, junto a las `strat.*`, agregar:

```ts
  "build.style": "Style de jeu",
  "strat.2048.corner.name": "Bâtisseur de coin",
  "strat.2048.corner.corner": "Coin cible",
  "strat.2048.corner.patience": "Patience (ordre avant les fusions immédiates)",
  "strat.snake.survivor.name": "Survivant",
  "strat.snake.survivor.foodPull": "Attrait de la nourriture (risque vs espace)",
  "strat.racing.weaver.name": "Slalomeur",
  "strat.racing.weaver.boldness": "Audace (avance de voie pour changer)",
  "strat.2048.priority.desc": "Fusionne les tuiles dès qu'il peut",
  "strat.2048.corner.desc": "Empile proprement vers un coin",
  "strat.snake.greedy.desc": "Fonce droit vers la nourriture",
  "strat.snake.survivor.desc": "Évite de se piéger ; survit plus longtemps",
  "strat.racing.dodger.desc": "Tient sa voie, esquive seulement au besoin",
  "strat.racing.weaver.desc": "Cherche toujours la voie la plus dégagée",
  "strat.opt.down-left": "bas-gauche",
  "strat.opt.down-right": "bas-droite",
  "strat.opt.up-left": "haut-gauche",
  "strat.opt.up-right": "haut-droite",
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/build/page.tsx apps/web/app/lib/i18n-dict.ts
git commit -m "feat(web): selector de estilo de juego en el builder (+ textos ×4)"
```

---

### Task 6: Chequeo completo, verificación real y registro

**Files:**
- Modify: `CHANGELOG.md` — entrada 2.6.0
- Modify: `package.json` (raíz) y donde se declare la versión — bump a 2.6.0
- Modify: `docs/superpowers/v3/PLAN.md` — marcar Fase 5 (se hace al cerrar, tras verificar en producción; ver nota)

**Interfaces:**
- Consumes: todo lo anterior integrado.
- Produces: repo en verde, changelog y versión listos para el gate de publicación.

- [ ] **Step 1: Chequeo completo del monorepo**

Run: `npm run check`
Expected: PASS — tipos de todos los workspaces + eslint + prettier + tests + selftest en verde. Si prettier marca formato en los archivos nuevos, correr `npm run format` (o el script equivalente del repo) y volver a `npm run check`.

- [ ] **Step 2: Verificación real en el builder (no solo tests)**

Levantar la web en local (el comando del repo, p. ej. `npm run -w @arcade1v1/web dev`) y recorrer `/build`:
- Elegir **2048** → aparece el selector con **Fusionador / Esquinero** con su línea de descripción. Cambiar de estilo mueve las perillas (aparece `Esquina objetivo` + `Paciencia`) y el score estimado recomputa.
- Paso 4 (sandbox): con **Esquinero** las fichas se apilan hacia una esquina; con **Fusionador**, no. Contraste visible.
- Repetir con **Snake** (Cazador se lanza / Superviviente serpentea) y **Carrera** (Prudente casi no se mueve / Serpenteador zigzaguea).
- Elegir **Tetris** (una sola estrategia) → **no** aparece selector; el paso 2 se ve igual que hoy.
- Confirmar los 4 idiomas: cambiar de idioma y ver nombres/descripciones/perillas traducidos (sin claves crudas tipo `strat.2048.corner.name`).

Anotar el resultado. Si algo no se ve distinto en el sandbox, revisar defaults de la estrategia (no relajar; ajustar el estilo).

- [ ] **Step 3: Changelog + bump de versión**

En `CHANGELOG.md`, agregar arriba (formato Keep a Changelog, en español):

```markdown
## [2.6.0] - 2026-07-11

### Añadido
- Segundo estilo de juego en 2048 (Esquinero), Snake (Superviviente) y Carrera
  (Serpenteador): cada juego con dos estrategias que juegan visiblemente
  distinto, ambas verificadas anti-trampa por construcción.
- Selector de estilo en el builder (`/build`): aparece cuando un juego tiene más
  de una estrategia, con una descripción en simple de cada una. Los juegos con
  una sola estrategia se ven igual que antes.

### Notas
- Los agentes ya desplegados no se ven afectados: solo se suman opciones.
```

Bump de versión a `2.6.0` donde el repo la declare (raíz `package.json` y los que sigan el patrón de releases anteriores — replicar lo hecho en 2.5.0).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "docs: changelog 2.6.0 (más de una estrategia por juego)"
```

- [ ] **Step 5: Gate de publicación (NO automático)**

Mostrar al usuario, en simple, qué se hizo y pedir OK explícito antes de `git push`. **No pushear sin ese OK** (push despliega a Vercel + Render). Tras verificar en producción, marcar la Fase 5 en `docs/superpowers/v3/PLAN.md` → Estado y actualizar la memoria si algo quedó no-obvio.

---

## Self-Review

**Cobertura del spec:**
- 3 estrategias nuevas (2048/snake/racing) → Tasks 1, 2, 3. ✓
- `descKey?` en `StrategyDef` → Task 1, Step 1. ✓
- `applyDir` reusable en g2048 → Task 1, Step 2. ✓
- Registro cada nueva tras su hermana → Tasks 1/2/3, steps de registro. ✓
- `strategiesFor/validateParams/getStrategy/runStrategy` sin cambios → no hay task que los toque (correcto). ✓
- Selector en el paso 2 solo si `>1`; `pickGame` intacto; juegos de 1 estrategia igual que hoy → Task 5, Step 1. ✓
- i18n ×4 (nombres, descripciones, perillas, opciones de esquina, `build.style`) → Task 5, Steps 3-6. ✓
- Test de distinción → Task 4. ✓
- Herencia de la suite parametrizada → Tasks 1-3, steps de correr la suite. ✓
- `npm run check` + verificación real + changelog/bump + gate de push → Task 6. ✓

**Placeholders:** ninguno; todo el código va completo. Los "si fallara X, ajustar Y" son fallbacks de tuning con valor concreto, no TODOs.

**Consistencia de tipos/nombres:** `applyDir` (Task 1) devuelve `{ board, gained, changed }`, consumido igual en g2048-corner. `ACTS/DELTA/wrapDist/freeSpace` (Task 2) exportados con las firmas usadas en snake-survivor. IDs `2048.corner`/`snake.survivor`/`racing.weaver` y sus `labelKey/descKey/param.labelKey` coinciden entre las estrategias (Tasks 1-3), el test de distinción (Task 4) y las claves i18n (Task 5). Replays con la forma que espera cada `verify*` (`{seed,moves}` para 2048; `{seed,ticks,inputs}` para snake/racing).
