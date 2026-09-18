# Benchmark en vivo, PR 1: la base apagada — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el motor de Flappy y el árbitro sepan jugar partidas en vivo (semilla oculta, azar revelado de a poco a cambio de comprometer las jugadas), con todo apagado en producción porque `RULES_V.flappy` sigue en 1.

**Architecture:** el motor toma su azar de una semilla o de una fuente inyectada, y `drawsWithin` calcula cuánto azar va a pedir sin tocar el estado. Un subpath nuevo, `@arcade1v1/game-sdk/live`, trae el interruptor por versión de reglas y las dos fuentes (`BufferedRandom` del jugador, `SeededSource` del árbitro). `flappy-live` trae el driver `playFlappyLive`. En el árbitro, `live.ts` implementa abrir y comprometer sobre el `Match`, `live-routes.ts` lo expone por HTTP, y `agents-routes.ts` suma las rutas para agentes BYO.

**Tech Stack:** TypeScript (ESM, `tsx`), `node:test`, Express 5, viem 2.55.

**Spec:** [`docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md`](../specs/2026-09-16-benchmark-en-vivo-design.md). Este plan cubre el **PR 1** de la sección "Despliegue". Los planes del PR 2 (clientes) y del PR 3 (interruptor) se escriben cuando este esté hecho, porque dependen de las firmas exactas que salgan de acá.

## Global Constraints

- `LIVE_LEAD_TICKS = 15`, `MAX_COMMIT_TICKS = 3_600`, `LIVE_SINCE_RULES_V = { flappy: 2 }`.
- `MAX_REPLAY_TICKS = 200_000` (ya existe en `apps/server/src/matchmaking.ts`).
- Limitador de las rutas en vivo: `RL_MAX_LIVE`, 60 pedidos cada 10 s por IP.
- `RULES_V.flappy` **sigue en 1** en todo este PR. Los tests activan el modo en vivo mutando `RULES_V.flappy = 2` dentro del propio archivo de test (cada archivo corre en su propio proceso).
- La física de Flappy no cambia: el test de caracterización de la Tarea 1 lo fija con una huella calculada sobre `main` en `a22e748`.
- Comentarios en español e identificadores en inglés. Los mensajes de error van en inglés, como el resto del árbitro.
- Los errores esperables de `live.ts` son `LiveError` (400 en las rutas); el resto es 500 y se loguea. Los mensajes nuevos que salgan por `index.ts` (`submitScore`) tienen que coincidir con `ERRORES_ESPERABLES` (`not allowed`, `mismatch`, etc.) para ser 400.
- Commits en español con prefijo (`feat(game-sdk): …`, `feat(server): …`) y el trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- No leer ni escribir `.env`. No correr nada contra producción. `main` no acepta push directo: rama propia y PR.
- Antes de abrir el PR: `npm run check` en verde.

---

## Estructura de archivos

| Archivo                                                            | Qué                                                                                    | Tarea |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----- |
| `packages/game-sdk/src/replay.ts`                                  | + interfaz `RandomSource`                                                              | 1     |
| `packages/game-sdk/src/flappy.ts`                                  | el motor acepta `seed \| RandomSource`; `stepPipes`, `drawsWithin`                     | 1     |
| `packages/game-sdk/test/flappy-live.test.ts`                       | caracterización, equivalencia y predicción                                             | 1     |
| `packages/game-sdk/src/live.ts` (nuevo)                            | interruptor, constantes, `BufferedRandom`, `SeededSource`, `NeedsReveal`               | 2     |
| `packages/game-sdk/package.json`                                   | subpaths `./live` y `./flappy-live`                                                    | 2 y 4 |
| `packages/game-sdk/test/live.test.ts` (nuevo)                      | tests de `live.ts`                                                                     | 2     |
| `packages/game-sdk/src/auth.ts`                                    | + `liveStartAuthMessage`                                                               | 3     |
| `packages/game-sdk/test/auth.test.ts`                              | + test del mensaje                                                                     | 3     |
| `packages/game-sdk/src/flappy-live.ts` (nuevo)                     | `playFlappyLive` y tipos del protocolo                                                 | 4     |
| `packages/game-sdk/test/flappy-live-driver.test.ts` (nuevo)        | driver contra un árbitro de referencia                                                 | 4     |
| `apps/server/src/matchmaking.ts`                                   | `LiveAttempt`, semilla opcional en la vista, rendición en vivo, helpers para `live.ts` | 5     |
| `apps/server/src/agent-runner.ts`, `selftest.ts`, `onchain-e2e.ts` | semilla opcional (sin cambio de comportamiento)                                        | 5     |
| `apps/server/test/live-views.test.ts` (nuevo)                      | vistas y rendición en vivo                                                             | 5     |
| `apps/server/src/live.ts` (nuevo)                                  | `liveStart`, `liveCommit`, `LiveError`                                                 | 6     |
| `apps/server/test/live-flappy.test.ts` (nuevo)                     | protocolo completo                                                                     | 6     |
| `apps/server/src/live-routes.ts` (nuevo)                           | rutas HTTP                                                                             | 7     |
| `apps/server/src/index.ts`                                         | monta las rutas, limitador, índice de la API                                           | 7     |
| `apps/server/test/live-routes.test.ts` (nuevo)                     | 200, 400 y 409 por HTTP                                                                | 7     |
| `apps/server/src/agents-routes.ts`                                 | guardias compartidas + rutas BYO en vivo                                               | 8     |
| `apps/server/test/live-webhook-routes.test.ts` (nuevo)             | rutas BYO en vivo                                                                      | 8     |

---

### Task 1: El motor de Flappy con fuente de azar inyectable y `drawsWithin`

**Files:**

- Modify: `packages/game-sdk/src/replay.ts` (agregar al final)
- Modify: `packages/game-sdk/src/flappy.ts` (archivo completo abajo)
- Test: `packages/game-sdk/test/flappy-live.test.ts` (nuevo)

**Interfaces:**

- Produces: `interface RandomSource { next(): number }` en `packages/game-sdk/src/replay.ts`; `new FlappyEngine(source: number | RandomSource)`; `FlappyEngine.drawsWithin(ticks: number): number`.

- [ ] **Step 1: Escribir el test de caracterización (tiene que pasar ANTES del cambio)**

Crear `packages/game-sdk/test/flappy-live.test.ts`:

```ts
// La base del Flappy EN VIVO en el motor: el azar puede venir de una fuente
// inyectada (el árbitro lo revela de a poco) sin cambiar ni un resultado, y
// `drawsWithin` dice cuánto azar va a pedir el juego antes de que lo pida.
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md
//
// Correr: node --import tsx --test packages/game-sdk/test/flappy-live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FlappyEngine, FLAPPY_DT, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";

/** Aletea como la estrategia oficial: cayendo y por debajo del próximo hueco. */
function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

/** Juega con `flapPolicy` hasta morir o `max` ticks. */
function run(g: FlappyEngine, max = 6_000): { ticks: number; flaps: number[] } {
  const flaps: number[] = [];
  let t = 0;
  for (; t < max && !g.over; t++) {
    if (flapPolicy(g, t)) {
      g.flap();
      flaps.push(t);
    }
    g.update(FLAPPY_DT);
  }
  return { ticks: t, flaps };
}

test("caracterización: 50 semillas dan exactamente lo mismo que el motor antes del cambio", () => {
  // Huella calculada con el motor de main en a22e748 (puntajes de 14 a 60).
  // Si cambia, cambió la física: eso rompería los replays ya jugados.
  const lines: string[] = [];
  for (let seed = 1; seed <= 50; seed++) {
    const g = new FlappyEngine(seed);
    const { ticks } = run(g);
    lines.push(`${seed}:${g.score}:${ticks}:${g.pipes.map((p) => p.gapY.toFixed(6)).join("|")}`);
  }
  const fingerprint = createHash("sha256").update(lines.join("\n")).digest("hex");
  assert.equal(fingerprint, "2f854a9dc1d18b4e30e2c3692f6437dab4250f2c1f98db38c41c45edece17630");
});
```

- [ ] **Step 2: Correrlo: tiene que PASAR con el motor actual**

Run: `node --import tsx --test packages/game-sdk/test/flappy-live.test.ts`
Expected: PASS (1 test). Si falla, la huella no corresponde a este `main`: parar y avisar.

- [ ] **Step 3: Agregar los tests del comportamiento nuevo**

Agregar el import de `mulberry32` debajo de los otros imports y los tres tests al final del mismo archivo:

```ts
import { mulberry32 } from "../src/replay";
```

```ts
test("con una fuente de azar el motor juega exactamente igual que con la semilla", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const a = new FlappyEngine(seed);
    const b = new FlappyEngine({ next: mulberry32(seed) });
    const ra = run(a);
    const rb = run(b);
    assert.deepEqual(
      [b.score, rb.ticks, rb.flaps, b.pipes],
      [a.score, ra.ticks, ra.flaps, a.pipes],
      `seed ${seed}`,
    );
  }
});

test("drawsWithin predice exacto cuánto azar consume el juego en los próximos ticks mientras el pájaro vive", () => {
  const LEAD = 15;
  let checked = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const rng = mulberry32(seed);
    let used = 0;
    const g = new FlappyEngine({
      next: () => {
        used += 1;
        return rng();
      },
    });
    // Predicción hecha ANTES de aplicar el tick `at`: cubre los ticks [at, at + LEAD).
    const pending: { at: number; used: number; draws: number }[] = [];
    for (let t = 0; t < 6_000 && !g.over; t++) {
      while (pending.length && pending[0].at + LEAD <= t) {
        const p = pending.shift()!;
        assert.equal(used - p.used, p.draws, `seed ${seed}, tick ${p.at}`);
        checked += 1;
      }
      if (g.started) pending.push({ at: t, used, draws: g.drawsWithin(LEAD) });
      if (flapPolicy(g, t)) g.flap();
      g.update(FLAPPY_DT);
    }
  }
  assert.ok(checked > 100_000, `se chequearon ${checked} predicciones`);
});

test("drawsWithin no toca el motor, y da 0 sin arrancar o con la partida terminada", () => {
  const g = new FlappyEngine(7);
  assert.equal(g.drawsWithin(10_000), 0, "sin el primer aleteo los tubos no se mueven");
  // Un aleteo cada 36 ticks mantiene el vuelo estable: con uno solo, el pájaro
  // cae al piso en el tick 54 y a los 100 la partida ya terminó.
  for (let t = 0; t < 100; t++) {
    if (t % 36 === 0) g.flap();
    g.update(FLAPPY_DT);
  }
  assert.equal(g.over, false, "sigue vivo");
  const before = JSON.stringify(g);
  assert.ok(g.drawsWithin(600) > 0);
  assert.equal(JSON.stringify(g), before, "el motor quedó igual");
  while (!g.over) g.update(FLAPPY_DT);
  assert.equal(g.drawsWithin(10_000), 0, "terminada no consume");
});
```

- [ ] **Step 4: Correr y ver fallar los tests nuevos**

Run: `node --import tsx --test packages/game-sdk/test/flappy-live.test.ts`
Expected: la caracterización PASA. Los otros tres FALLAN: con un objeto en vez de una semilla el motor usa `mulberry32(NaN)` (resultados distintos), y `drawsWithin` no existe (`g.drawsWithin is not a function`).

- [ ] **Step 5: Implementar**

Agregar al final de `packages/game-sdk/src/replay.ts`:

```ts
/** De dónde saca un motor su azar: cada llamada devuelve un número en [0, 1).
 *  Con una semilla es `mulberry32(seed)`, como siempre. En una partida en vivo
 *  son los valores que el árbitro va revelando (ver `./live`). */
export interface RandomSource {
  next(): number;
}
```

Reemplazar **todo** `packages/game-sdk/src/flappy.ts` por:

```ts
// Motor del Flappy COMPARTIDO entre web y servidor. Determinístico con dt fijo:
// dadas la misma semilla + los mismos aleteos en los mismos ticks, el resultado
// es idéntico, así el servidor re-simula el replay y verifica el puntaje.
//
// El azar sale de una semilla o de una FUENTE inyectada: en una partida en vivo
// el árbitro guarda la semilla y revela los valores de a poco (ver ./live).

import { mulberry32, type RandomSource } from "./replay";

export const WIDTH = 320;
export const HEIGHT = 480;
export const FLAPPY_DT = 1 / 60; // paso fijo de fisica (segundos por tick)

const BIRD_X = 70;
const BIRD_R = 12;
const GRAVITY = 1350;
const FLAP_VY = -400;
const PIPE_W = 58;
const GAP = 158;
const PIPE_SPACING = 215;
const MARGIN = 72;
const GROUND_H = 36;

export interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

/** Velocidad de los tubos (px/s) para un puntaje. */
function pipeSpeedFor(score: number): number {
  return 120 + score * 3;
}

/** Un paso del horario de tubos: moverlos, sacar el que salió de pantalla,
 *  agregar uno nuevo cuando hace falta y marcar los que el pájaro pasó.
 *  Devuelve cuántos puntos sumó. No mira al pájaro: por eso el horario de tubos
 *  no depende de los aleteos, y el árbitro sabe cuándo va a nacer cada tubo sin
 *  conocer las jugadas futuras. `spawn` agrega el tubo nuevo en `x` (el motor
 *  lo hace consumiendo azar; `drawsWithin` solo lo cuenta). */
function stepPipes(
  pipes: { x: number; passed: boolean }[],
  score: number,
  dt: number,
  spawn: (x: number) => void,
): number {
  const speed = pipeSpeedFor(score);
  for (const p of pipes) p.x -= speed * dt;

  if (pipes.length && pipes[0].x < -PIPE_W) pipes.shift();
  const last = pipes[pipes.length - 1];
  if (last && last.x < WIDTH - PIPE_SPACING) spawn(last.x + PIPE_SPACING);

  let gained = 0;
  for (const p of pipes) {
    if (!p.passed && p.x + PIPE_W < BIRD_X) {
      p.passed = true;
      gained += 1;
    }
  }
  return gained;
}

export class FlappyEngine {
  birdY = HEIGHT / 2;
  birdVy = 0;
  pipes: Pipe[] = [];
  score = 0;
  over = false;
  started = false;

  private rng: () => number;

  constructor(source: number | RandomSource) {
    if (typeof source === "number") {
      this.rng = mulberry32(source);
    } else {
      this.rng = () => source.next();
    }
    this.addPipe(WIDTH + 80);
  }

  private randomGapY(): number {
    const usable = HEIGHT - GROUND_H - 2 * MARGIN;
    return MARGIN + this.rng() * usable;
  }

  private addPipe(x: number) {
    this.pipes.push({ x, gapY: this.randomGapY(), passed: false });
  }

  flap() {
    if (this.over) return;
    this.started = true;
    this.birdVy = FLAP_VY;
  }

  pipeSpeed(): number {
    return pipeSpeedFor(this.score);
  }

  /** Cuántos valores al azar consumirían los próximos `ticks` pasos de
   *  FLAPPY_DT sin aleteos. Simula solo el horario de tubos sobre una copia: el
   *  motor no cambia. Sin el primer aleteo los tubos no se mueven (da 0), y con
   *  la partida terminada no se consume nada. Mientras el pájaro viva es exacto,
   *  porque el horario de tubos no depende de los aleteos. Lo usan el árbitro
   *  para revelar y el cliente para saber cuándo comprometer. */
  drawsWithin(ticks: number): number {
    if (this.over || !this.started) return 0;
    const pipes = this.pipes.map((p) => ({ x: p.x, passed: p.passed }));
    let score = this.score;
    let draws = 0;
    for (let i = 0; i < ticks; i++) {
      score += stepPipes(pipes, score, FLAPPY_DT, (x) => {
        pipes.push({ x, passed: false });
        draws += 1;
      });
    }
    return draws;
  }

  update(dt: number) {
    if (this.over || !this.started) return;

    this.birdVy += GRAVITY * dt;
    this.birdY += this.birdVy * dt;

    this.score += stepPipes(this.pipes, this.score, dt, (x) => this.addPipe(x));

    if (this.birdY - BIRD_R < 0 || this.birdY + BIRD_R > HEIGHT - GROUND_H) {
      this.over = true;
      return;
    }

    for (const p of this.pipes) {
      const inX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
      if (!inX) continue;
      const topGap = p.gapY - GAP / 2;
      const bottomGap = p.gapY + GAP / 2;
      if (this.birdY - BIRD_R < topGap || this.birdY + BIRD_R > bottomGap) {
        this.over = true;
        return;
      }
    }
  }
}

export const FLAPPY_CONST = { WIDTH, HEIGHT, BIRD_X, BIRD_R, PIPE_W, GAP, GROUND_H };

/** Replay: semilla + ticks totales + los ticks en los que se aleteo. */
export interface ReplayFlappy {
  seed: number;
  ticks: number;
  flaps: number[];
}

/** ANTI-TRAMPA: re-simula el replay con dt fijo y devuelve el puntaje real. */
export function verifyFlappy(r: ReplayFlappy): number {
  const g = new FlappyEngine(r.seed);
  const flapSet = new Set(r.flaps);
  for (let t = 0; t < r.ticks; t++) {
    if (flapSet.has(t)) g.flap();
    g.update(FLAPPY_DT);
    if (g.over) break;
  }
  return g.score;
}
```

- [ ] **Step 6: Correr los tests nuevos y los de siempre**

Run: `node --import tsx --test packages/game-sdk/test/flappy-live.test.ts packages/game-sdk/test/engines.test.ts`
Expected: PASS todos. La caracterización sigue pasando, así que la física no cambió.

Run: `npx tsc --noEmit -p packages/game-sdk/tsconfig.json`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add packages/game-sdk/src/replay.ts packages/game-sdk/src/flappy.ts packages/game-sdk/test/flappy-live.test.ts
git commit -m "feat(game-sdk): el motor de Flappy acepta una fuente de azar y predice cuánto azar va a pedir

Base de las partidas en vivo: el árbitro va a revelar el azar de a poco, así que el
motor tiene que poder tomarlo de afuera (RandomSource) y el árbitro tiene que
saber cuánto va a pedir el juego (drawsWithin). El horario de tubos pasa a
stepPipes, que usan update y drawsWithin; la física no cambia (huella de 50
semillas fijada en el test).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `@arcade1v1/game-sdk/live`: interruptor, constantes y fuentes de azar

**Files:**

- Create: `packages/game-sdk/src/live.ts`
- Modify: `packages/game-sdk/package.json` (exports)
- Test: `packages/game-sdk/test/live.test.ts` (nuevo)

**Interfaces:**

- Consumes: `RandomSource` y `mulberry32` de `packages/game-sdk/src/replay.ts` (Tarea 1).
- Produces, desde `@arcade1v1/game-sdk/live`:
  - `type RandomSource`;
  - `LIVE_LEAD_TICKS: number` (15), `MAX_COMMIT_TICKS: number` (3600), `LIVE_SINCE_RULES_V: Record<string, number>`;
  - `isLiveMatch(game: string, rulesV: number | undefined): boolean`;
  - `class NeedsReveal extends Error { readonly index: number }`;
  - `class BufferedRandom { push(values: readonly number[]): void; readonly received: number; readonly available: number; next(): number }`;
  - `class SeededSource { constructor(seed: number); readonly consumed: number; next(): number; slice(from: number, to: number): number[] }`.

- [ ] **Step 1: Escribir el test**

Crear `packages/game-sdk/test/live.test.ts`:

```ts
// Las piezas compartidas de las partidas en vivo: el interruptor por versión de
// reglas y las dos fuentes de azar, la del jugador y la del árbitro.
//
// Correr: node --import tsx --test packages/game-sdk/test/live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BufferedRandom,
  SeededSource,
  NeedsReveal,
  isLiveMatch,
  LIVE_LEAD_TICKS,
  MAX_COMMIT_TICKS,
  LIVE_SINCE_RULES_V,
} from "@arcade1v1/game-sdk/live";
import { mulberry32 } from "../src/replay";

test("el interruptor: Flappy se juega en vivo desde las reglas v2, y nada más", () => {
  assert.equal(isLiveMatch("flappy", 1), false);
  assert.equal(isLiveMatch("flappy", undefined), false, "sin versión es v1");
  assert.equal(isLiveMatch("flappy", 2), true);
  assert.equal(isLiveMatch("flappy", 3), true);
  assert.equal(isLiveMatch("2048", 9), false);
  assert.deepEqual(LIVE_SINCE_RULES_V, { flappy: 2 });
});

test("constantes del protocolo", () => {
  assert.equal(LIVE_LEAD_TICKS, 15);
  assert.equal(MAX_COMMIT_TICKS, 3_600);
});

test("SeededSource: la misma secuencia que la semilla, y adelantar valores no los consume", () => {
  const src = new SeededSource(42);
  const rng = mulberry32(42);
  const expected = Array.from({ length: 10 }, () => rng());
  assert.deepEqual(src.slice(0, 10), expected, "adelanta sin consumir");
  assert.equal(src.consumed, 0);
  assert.equal(src.next(), expected[0]);
  assert.equal(src.next(), expected[1]);
  assert.equal(src.consumed, 2);
  assert.deepEqual(src.slice(2, 4), expected.slice(2, 4));
});

test("BufferedRandom: entrega en orden y avisa qué valor falta", () => {
  const b = new BufferedRandom();
  assert.throws(
    () => b.next(),
    (e: unknown) => e instanceof NeedsReveal && e.index === 0,
  );
  b.push([0.25, 0.5]);
  assert.equal(b.received, 2);
  assert.equal(b.available, 2);
  assert.equal(b.next(), 0.25);
  assert.equal(b.available, 1);
  b.push([0.75]);
  assert.equal(b.next(), 0.5);
  assert.equal(b.next(), 0.75);
  assert.equal(b.received, 3);
  assert.equal(b.available, 0);
  assert.throws(
    () => b.next(),
    (e: unknown) => e instanceof NeedsReveal && e.index === 3,
  );
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `node --import tsx --test packages/game-sdk/test/live.test.ts`
Expected: FAIL al importar: `@arcade1v1/game-sdk/live` no es un subpath exportado (`ERR_PACKAGE_PATH_NOT_EXPORTED`).

- [ ] **Step 3: Implementar**

En `packages/game-sdk/package.json`, dentro de `"exports"`, agregar después de `"./flappy": "./src/flappy.ts",`:

```json
    "./live": "./src/live.ts",
```

Crear `packages/game-sdk/src/live.ts`:

```ts
// PARTIDAS EN VIVO: lo que comparten el árbitro, el SDK y la web para que nadie
// vea más adelante de lo que vería un humano mirando la pantalla. El árbitro
// guarda la semilla. El jugador compromete sus jugadas hasta un tick y recibe
// los valores al azar que el juego va a consumir en los próximos
// LIVE_LEAD_TICKS; con esos valores el motor corre igual que siempre.
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { mulberry32, type RandomSource } from "./replay";

export type { RandomSource };

/** Cuántos ticks antes de usarse se revela cada valor al azar (0,25 s a 60
 *  ticks por segundo): lo justo para que la red no trabe el juego. */
export const LIVE_LEAD_TICKS = 15;

/** Tope de ticks por compromiso (un minuto de juego): acota el trabajo de cada pedido. */
export const MAX_COMMIT_TICKS = 3_600;

/** Desde qué versión de reglas se juega en vivo cada juego. El interruptor de
 *  Flappy es `RULES_V.flappy = 2` (rules.ts). */
export const LIVE_SINCE_RULES_V: Record<string, number> = { flappy: 2 };

/** ¿Una partida de `game` nacida con las reglas `rulesV` se juega en vivo? */
export function isLiveMatch(game: string, rulesV: number | undefined): boolean {
  const since = LIVE_SINCE_RULES_V[game];
  return since !== undefined && (rulesV ?? 1) >= since;
}

/** Se pidió un valor al azar que todavía no se reveló. Jugando bien no pasa:
 *  antes de cada tick se chequea que `drawsWithin(1)` no supere `available`. */
export class NeedsReveal extends Error {
  readonly index: number;
  constructor(index: number) {
    super(`live: random value #${index} was not revealed yet`);
    this.index = index;
  }
}

/** Fuente de azar del JUGADOR: los valores que reveló el árbitro, en orden. */
export class BufferedRandom implements RandomSource {
  private readonly values: number[] = [];
  private used = 0;

  push(values: readonly number[]): void {
    for (const v of values) this.values.push(v);
  }

  /** Valores recibidos en total: es el `have` del próximo compromiso. */
  get received(): number {
    return this.values.length;
  }

  /** Valores recibidos que el motor todavía no usó. */
  get available(): number {
    return this.values.length - this.used;
  }

  next(): number {
    if (this.used >= this.values.length) throw new NeedsReveal(this.used);
    return this.values[this.used++];
  }
}

/** Fuente de azar del ÁRBITRO: la secuencia de la semilla. Puede adelantar
 *  valores para revelarlos sin consumirlos. */
export class SeededSource implements RandomSource {
  private readonly rng: () => number;
  private readonly values: number[] = [];
  private used = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  /** Cuántos valores consumió el motor. */
  get consumed(): number {
    return this.used;
  }

  next(): number {
    this.fill(this.used + 1);
    return this.values[this.used++];
  }

  /** Los valores `[from, to)` de la secuencia, generándolos si hace falta. */
  slice(from: number, to: number): number[] {
    this.fill(to);
    return this.values.slice(from, to);
  }

  private fill(n: number): void {
    while (this.values.length < n) this.values.push(this.rng());
  }
}
```

- [ ] **Step 4: Correr los tests y el typecheck**

Run: `node --import tsx --test packages/game-sdk/test/live.test.ts`
Expected: PASS (4 tests).

Run: `npx tsc --noEmit -p packages/game-sdk/tsconfig.json`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/live.ts packages/game-sdk/package.json packages/game-sdk/test/live.test.ts
git commit -m "feat(game-sdk): subpath live con el interruptor por reglas y las fuentes de azar del jugador y del árbitro

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: El mensaje firmado para abrir un intento en vivo

**Files:**

- Modify: `packages/game-sdk/src/auth.ts` (agregar al final)
- Test: `packages/game-sdk/test/auth.test.ts` (agregar un test)

**Interfaces:**

- Produces: `liveStartAuthMessage(matchId: string, address: string, ts: number): string` en `@arcade1v1/game-sdk/auth`. Vale por `MATCHMAKE_AUTH_TTL_MS`.

- [ ] **Step 1: Escribir el test**

En `packages/game-sdk/test/auth.test.ts`, sumar `liveStartAuthMessage` al import de `@arcade1v1/game-sdk/auth` y agregar al final:

```ts
test("liveStartAuthMessage: formato estable y address en minúsculas", () => {
  const msg = liveStartAuthMessage(
    "0x" + "ab".repeat(32),
    "0xABCDef0000000000000000000000000000000001",
    1730000000000,
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: empiezo mi partida en vivo",
      `match: 0x${"ab".repeat(32)}`,
      "player: 0xabcdef0000000000000000000000000000000001",
      "ts: 1730000000000",
    ].join("\n"),
  );
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `node --import tsx --test packages/game-sdk/test/auth.test.ts`
Expected: FAIL: `liveStartAuthMessage` no se exporta (`does not provide an export named 'liveStartAuthMessage'`).

- [ ] **Step 3: Implementar**

Agregar al final de `packages/game-sdk/src/auth.ts`:

```ts
/** Mensaje a firmar para ABRIR (o retomar) el intento en vivo de una partida.
 *  Ata: partida + jugador + momento (ts, válido MATCHMAKE_AUTH_TTL_MS). Sin
 *  esto, cualquiera abriría el intento de otro, y el intento es único. */
export function liveStartAuthMessage(matchId: string, address: string, ts: number): string {
  return [
    "Arcade1v1: empiezo mi partida en vivo",
    `match: ${matchId}`,
    `player: ${address.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}
```

- [ ] **Step 4: Correr el test**

Run: `node --import tsx --test packages/game-sdk/test/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/auth.ts packages/game-sdk/test/auth.test.ts
git commit -m "feat(game-sdk): mensaje firmado para abrir un intento en vivo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: El driver `playFlappyLive`

**Files:**

- Create: `packages/game-sdk/src/flappy-live.ts`
- Modify: `packages/game-sdk/package.json` (exports)
- Test: `packages/game-sdk/test/flappy-live-driver.test.ts` (nuevo)

**Nota sobre el nombre:** el spec lo llama `runLive`, un driver genérico. Con un
solo juego en vivo, un driver genérico sería especular sobre cómo van a ser las
jugadas de los otros cinco juegos, así que acá es `playFlappyLive`, en su propio
subpath. Cuando migre el segundo juego se extrae lo común.

**Interfaces:**

- Consumes: `FlappyEngine`, `FLAPPY_DT` (Tarea 1); `BufferedRandom`, `LIVE_LEAD_TICKS` (Tarea 2).
- Produces, desde `@arcade1v1/game-sdk/flappy-live`:

```ts
export interface FlappyLiveStart {
  tick: number;
  flaps: number[];
  reveal: number[];
}
export interface FlappyLiveCommit {
  from: number;
  to: number;
  flaps: number[];
  have: number;
  final?: boolean;
}
export type FlappyLiveReply =
  | {
      conflict?: undefined;
      tick: number;
      over: boolean;
      score?: number;
      reveal: number[];
      revealed: number;
    }
  | { conflict: true; tick: number; reveal: number[]; revealed: number };
export interface PlayFlappyLiveOptions {
  start: FlappyLiveStart;
  decide: (engine: FlappyEngine, tick: number) => boolean;
  commit: (c: FlappyLiveCommit) => Promise<FlappyLiveReply>;
  maxTicks: number;
}
export function playFlappyLive(
  opts: PlayFlappyLiveOptions,
): Promise<{ score: number; ticks: number }>;
```

- [ ] **Step 1: Escribir el test (con un árbitro de referencia en memoria)**

Crear `packages/game-sdk/test/flappy-live-driver.test.ts`:

```ts
// El driver de Flappy en vivo contra un árbitro de referencia en memoria (las
// mismas reglas que apps/server/src/live.ts, sin HTTP ni firmas). Prueba que
// jugar en vivo da exactamente lo mismo que jugar con la semilla, que se
// recupera si el árbitro pierde compromisos, y la propiedad central: nunca se
// revela un valor que el juego vaya a usar más de LIVE_LEAD_TICKS después de lo
// comprometido.
//
// Correr: node --import tsx --test packages/game-sdk/test/flappy-live-driver.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { FlappyEngine, FLAPPY_DT, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";
import { SeededSource, LIVE_LEAD_TICKS } from "@arcade1v1/game-sdk/live";
import {
  playFlappyLive,
  type FlappyLiveCommit,
  type FlappyLiveReply,
} from "@arcade1v1/game-sdk/flappy-live";
import { mulberry32 } from "../src/replay";

function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

/** Árbitro de referencia. `rollbackOnCommit`: en ese compromiso "se cae" y
 *  pierde los últimos 40 ticks comprometidos, como una caída dura. */
function referenceArbiter(seed: number, rollbackOnCommit?: number) {
  let src = new SeededSource(seed);
  let eng = new FlappyEngine(src);
  let tick = 0;
  let revealed = 0;
  let over = false;
  let seen = 0;
  let flaps: number[] = [];
  const log: { to: number; revealed: number }[] = [];
  const reveal = (have: number) => {
    revealed = Math.max(revealed, src.consumed + eng.drawsWithin(LIVE_LEAD_TICKS));
    return { reveal: src.slice(Math.min(Math.max(0, have), revealed), revealed), revealed };
  };
  const start = { tick: 0, flaps: [] as number[], ...reveal(0) };
  log.push({ to: 0, revealed });
  const commit = async (c: FlappyLiveCommit): Promise<FlappyLiveReply> => {
    seen += 1;
    if (seen === rollbackOnCommit && tick > 0) {
      const back = Math.max(0, tick - 40);
      flaps = flaps.filter((f) => f < back);
      src = new SeededSource(seed);
      eng = new FlappyEngine(src);
      const set = new Set(flaps);
      for (let t = 0; t < back; t++) {
        if (set.has(t)) eng.flap();
        eng.update(FLAPPY_DT);
      }
      tick = back;
    }
    if (over) return { tick, over: true, score: eng.score, reveal: [], revealed };
    if (c.from !== tick) return { conflict: true, tick, ...reveal(c.have) };
    const set = new Set(c.flaps);
    let t = c.from;
    for (; t < c.to && !eng.over; t++) {
      if (set.has(t)) eng.flap();
      eng.update(FLAPPY_DT);
    }
    for (const f of c.flaps) if (f < t) flaps.push(f);
    tick = t;
    const r = reveal(c.have);
    log.push({ to: tick, revealed });
    if (eng.over || c.final) {
      over = true;
      return { tick, over: true, score: eng.score, ...r };
    }
    return { tick, over: false, ...r };
  };
  return { start, commit, log, flaps: () => flaps };
}

/** La misma partida jugada con la semilla, de corrido. */
function batch(seed: number, maxTicks: number) {
  const g = new FlappyEngine(seed);
  let t = 0;
  for (; t < maxTicks && !g.over; t++) {
    if (flapPolicy(g, t)) g.flap();
    g.update(FLAPPY_DT);
  }
  return { score: g.score, ticks: t };
}

test("jugar en vivo da el mismo puntaje y los mismos ticks que jugar con la semilla", async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const arb = referenceArbiter(seed);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    assert.deepEqual(live, batch(seed, 3_000), `seed ${seed}`);
  }
});

test("si el árbitro pierde compromisos, el driver reenvía desde donde quedó y termina igual", async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const arb = referenceArbiter(seed, 4);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    assert.deepEqual(live, batch(seed, 3_000), `seed ${seed}`);
  }
});

test("si se pierde una respuesta ya aplicada, el reintento se resuelve con el conflicto", async () => {
  const arb = referenceArbiter(5);
  let dropped = false;
  const live = await playFlappyLive({
    start: arb.start,
    decide: flapPolicy,
    maxTicks: 3_000,
    // Transporte que reintenta: la primera respuesta "se pierde" después de
    // aplicarse en el árbitro, y el reintento llega con el `from` viejo.
    commit: async (c) => {
      const reply = await arb.commit(c);
      if (!dropped && !reply.conflict && !reply.over) {
        dropped = true;
        return arb.commit(c);
      }
      return reply;
    },
  });
  assert.equal(dropped, true);
  assert.deepEqual(live, batch(5, 3_000));
});

test("propiedad central: ningún valor revelado se usa más de LIVE_LEAD_TICKS después de lo comprometido", async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const arb = referenceArbiter(seed, seed % 3 === 0 ? 4 : undefined);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    // En qué tick se consume cada valor en la partida real (-1: al construir el motor).
    const rng = mulberry32(seed);
    const consumedAt: number[] = [];
    let now = -1;
    const g = new FlappyEngine({
      next: () => {
        consumedAt.push(now);
        return rng();
      },
    });
    const set = new Set(arb.flaps());
    for (now = 0; now < live.ticks && !g.over; now++) {
      if (set.has(now)) g.flap();
      g.update(FLAPPY_DT);
    }
    for (const entry of arb.log) {
      for (let i = 0; i < entry.revealed && i < consumedAt.length; i++) {
        assert.ok(
          consumedAt[i] <= entry.to + LIVE_LEAD_TICKS,
          `seed ${seed}: valor ${i} usado en el tick ${consumedAt[i]} y revelado con to=${entry.to}`,
        );
      }
    }
  }
});

test("al llegar a maxTicks vivo, cierra con final y el puntaje alcanzado", async () => {
  const arb = referenceArbiter(39);
  const live = await playFlappyLive({
    start: arb.start,
    decide: flapPolicy,
    commit: arb.commit,
    maxTicks: 400,
  });
  assert.deepEqual(live, batch(39, 400));
  assert.equal(live.ticks, 400, "llegó vivo al tope: cerró con final");
});

test("si el árbitro no revela lo que el motor necesita, corta con un error claro en vez de colgarse", async () => {
  const arb = referenceArbiter(2);
  await assert.rejects(
    playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      maxTicks: 3_000,
      commit: async (c) => ({ ...(await arb.commit(c)), reveal: [] }),
    }),
    /live desync/,
  );
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `node --import tsx --test packages/game-sdk/test/flappy-live-driver.test.ts`
Expected: FAIL al importar `@arcade1v1/game-sdk/flappy-live` (`ERR_PACKAGE_PATH_NOT_EXPORTED`).

- [ ] **Step 3: Implementar**

En `packages/game-sdk/package.json`, dentro de `"exports"`, agregar después de `"./live": "./src/live.ts",`:

```json
    "./flappy-live": "./src/flappy-live.ts",
```

Crear `packages/game-sdk/src/flappy-live.ts`:

```ts
// Driver de una partida de Flappy EN VIVO para quien juega sin bucle de tiempo
// real: el SDK y los agentes de la casa. La web tiene su propio bucle
// (requestAnimationFrame) y usa las mismas piezas: BufferedRandom y drawsWithin.
// Protocolo: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { FlappyEngine, FLAPPY_DT } from "./flappy";
import { BufferedRandom, LIVE_LEAD_TICKS } from "./live";

/** Lo que devolvió abrir el intento (sin el token, que es del transporte). */
export interface FlappyLiveStart {
  tick: number;
  flaps: number[];
  reveal: number[];
}

/** Un compromiso: los aleteos en `[from, to)` y cuántos valores tengo (`have`). */
export interface FlappyLiveCommit {
  from: number;
  to: number;
  flaps: number[];
  have: number;
  final?: boolean;
}

/** Respuesta a un compromiso. `conflict`: el árbitro está en otro tick (perdió
 *  compromisos, o se perdió una respuesta ya aplicada); hay que seguir desde
 *  `tick`. En los dos casos `reveal` trae los valores desde `have`. */
export type FlappyLiveReply =
  | {
      conflict?: undefined;
      tick: number;
      over: boolean;
      score?: number;
      reveal: number[];
      revealed: number;
    }
  | { conflict: true; tick: number; reveal: number[]; revealed: number };

export interface PlayFlappyLiveOptions {
  start: FlappyLiveStart;
  /** ¿Aletear en este tick? Recibe el motor ANTES de aplicar el tick. */
  decide: (engine: FlappyEngine, tick: number) => boolean;
  commit: (c: FlappyLiveCommit) => Promise<FlappyLiveReply>;
  /** Si el pájaro llega vivo a este tick, se cierra con `final`. */
  maxTicks: number;
}

/** Cuántas veces seguidas se acepta un conflicto antes de rendirse. */
const MAX_CONFLICTS = 5;

/** Juega una partida en vivo de punta a punta. Devuelve lo que confirmó el árbitro. */
export async function playFlappyLive(
  opts: PlayFlappyLiveOptions,
): Promise<{ score: number; ticks: number }> {
  const buffer = new BufferedRandom();
  buffer.push(opts.start.reveal);
  const engine = new FlappyEngine(buffer);
  const flaps = [...opts.start.flaps];

  // Retomar: rehacer lo ya comprometido con los valores que ya llegaron.
  const done = new Set(flaps);
  let tick = 0;
  for (; tick < opts.start.tick && !engine.over; tick++) {
    if (done.has(tick)) engine.flap();
    engine.update(FLAPPY_DT);
  }
  let committed = opts.start.tick;

  const send = async (to: number, final: boolean) => {
    for (let i = 0; i < MAX_CONFLICTS; i++) {
      const reply = await opts.commit({
        from: committed,
        to,
        flaps: flaps.filter((f) => f >= committed && f < to),
        have: buffer.received,
        ...(final ? { final: true } : {}),
      });
      buffer.push(reply.reveal);
      if (!reply.conflict) {
        committed = reply.tick;
        return reply;
      }
      if (reply.tick > to) {
        throw new Error(`live desync: arbiter at tick ${reply.tick}, player at ${to}`);
      }
      committed = reply.tick;
      // El árbitro ya tenía todo hasta `to` (se perdió la respuesta): listo.
      if (committed === to && !final) {
        return { tick: to, over: false, reveal: [], revealed: reply.revealed };
      }
    }
    throw new Error("live: too many commit conflicts");
  };

  while (!engine.over && tick < opts.maxTicks) {
    if (engine.drawsWithin(LIVE_LEAD_TICKS) > buffer.available) {
      if (tick === committed) {
        // Ya está todo comprometido y aun así falta azar: seguir sería inventarlo.
        throw new Error(
          `live desync at tick ${tick}: the arbiter revealed only ${buffer.received} values`,
        );
      }
      const reply = await send(tick, false);
      if (reply.over) return { score: reply.score ?? 0, ticks: reply.tick };
      continue;
    }
    if (opts.decide(engine, tick)) {
      engine.flap();
      flaps.push(tick);
    }
    engine.update(FLAPPY_DT);
    tick += 1;
  }

  const last = await send(tick, !engine.over);
  if (!last.over) throw new Error("live: the arbiter did not close the attempt");
  return { score: last.score ?? 0, ticks: last.tick };
}
```

- [ ] **Step 4: Correr los tests y el typecheck**

Run: `node --import tsx --test packages/game-sdk/test/flappy-live-driver.test.ts`
Expected: PASS (6 tests).

Run: `npx tsc --noEmit -p packages/game-sdk/tsconfig.json`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/flappy-live.ts packages/game-sdk/package.json packages/game-sdk/test/flappy-live-driver.test.ts
git commit -m "feat(game-sdk): driver playFlappyLive para jugar Flappy en vivo sin bucle de tiempo real

Contra un árbitro de referencia en memoria: mismo puntaje que con la semilla,
recuperación de compromisos perdidos y de respuestas perdidas, y la propiedad
central (nada revelado se usa más de 15 ticks después de lo comprometido).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Árbitro: semilla opcional en la vista, intento en vivo en la partida y rendición

**Files:**

- Modify: `apps/server/src/matchmaking.ts`
- Modify: `apps/server/src/agent-runner.ts`, `apps/server/src/selftest.ts`, `apps/server/src/onchain-e2e.ts` (solo tipos: sin cambio de comportamiento)
- Test: `apps/server/test/live-views.test.ts` (nuevo)

**Interfaces:**

- Consumes: `isLiveMatch` (Tarea 2).
- Produces, desde `apps/server/src/matchmaking.ts`:
  - `export interface Match` (ya existía, sin exportar) con `live?: Record<string, LiveAttempt>`;
  - `export interface LiveAttempt { tokenHash: string; startedAt: number; tick: number; flaps: number[]; revealed: number; over?: boolean; score?: number }`;
  - en `MatchView`: `seed?: number` y `live?: boolean`;
  - `export async function assertDepositOnchain(m: { id: string; stake: number }, address: string): Promise<void>`;
  - `export function matchRecord(id: string): Match | undefined`;
  - `export function persistMatches(): void`;
  - `export async function finishLiveAttempt(m: Match, address: string, score: number, replay: unknown): Promise<void>`.

- [ ] **Step 1: Escribir el test**

Crear `apps/server/test/live-views.test.ts`:

```ts
// Vistas y rendición de las partidas EN VIVO. Mientras la partida no se decide,
// la semilla no sale en ninguna vista (con ella se simula la partida entera). Un
// juego en vivo no acepta replays armados afuera: solo la rendición.
//
// Correr: node --import tsx --test apps/server/test/live-views.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { matchmake, submitScore, getMatch } from "../src/matchmaking.js";

// Flappy en vivo SOLO en este proceso: en producción RULES_V.flappy sigue en 1.
RULES_V.flappy = 2;

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

const forfeit = { ticks: 0, flaps: [], v: 2 };

async function livePair() {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake("flappy", 0, p1);
  const m2 = await matchmake("flappy", 0, p2);
  assert.equal(m1.matchId, m2.matchId);
  return { id: m1.matchId, p1, p2, m1, m2 };
}

test("en un juego en vivo la vista no trae la semilla y avisa que es en vivo", async () => {
  const { id, p1, m1, m2 } = await livePair();
  for (const v of [m1, m2, getMatch(id, p1)!, getMatch(id)!]) {
    assert.equal(v.seed, undefined, "sin semilla antes de decidir");
    assert.equal(v.live, true);
  }
});

test("un juego que no es en vivo sigue trayendo la semilla", async () => {
  const m = await matchmake("2048", 0, addr());
  assert.equal(typeof m.seed, "number");
  assert.equal(m.live, undefined);
});

test("un juego en vivo rechaza un replay armado afuera, con motivo y sin gastar el intento", async () => {
  const { id, p1 } = await livePair();
  await assert.rejects(
    submitScore(id, p1, 3, { seed: 123, ticks: 600, flaps: [0, 20] }),
    /replay not allowed: flappy is live/,
  );
  // Tampoco sirve una "rendición" con puntaje o con semilla.
  await assert.rejects(submitScore(id, p1, 1, forfeit), /replay not allowed/);
  await assert.rejects(submitScore(id, p1, 0, { ...forfeit, seed: 1 }), /replay not allowed/);
  // El intento sigue disponible: la rendición de verdad entra.
  const v = await submitScore(id, p1, 0, forfeit);
  assert.deepEqual(v.scores, { [p1.toLowerCase()]: 0 });
});

test("rendirse cierra el intento con 0; con los dos rendidos es empate y recién ahí aparece la semilla", async () => {
  const { id, p1, p2 } = await livePair();
  await submitScore(id, p1, 0, forfeit);
  await assert.rejects(submitScore(id, p1, 0, forfeit), /already submitted/);
  const v = await submitScore(id, p2, 0, forfeit);
  assert.equal(v.status, "draw");
  assert.equal(typeof v.seed, "number", "decidida: la semilla ya se puede ver");
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `node --import tsx --test apps/server/test/live-views.test.ts`
Expected: FAIL. La vista trae `seed` y no trae `live`; `submitScore` en Flappy con reglas v2 intenta verificar el replay y tira `seed mismatch` o `replay required` en vez de `replay not allowed`.

- [ ] **Step 3: Implementar en `matchmaking.ts`**

3a. Agregar el import, debajo del import de `@arcade1v1/game-sdk/rules`:

```ts
import { isLiveMatch } from "@arcade1v1/game-sdk/live";
```

3b. Reemplazar `interface Match {` por `export interface Match {`. Dentro de la interfaz, después de la línea `eloUpdate?: { p1: RatingUpdate; p2: RatingUpdate }; // cambio de rating al liquidar`, agregar:

```ts
  /** Intentos EN VIVO por jugador (juegos en vivo; ver live.ts). */
  live?: Record<string, LiveAttempt>;
```

3c. Justo antes de `export interface Match {`, agregar:

```ts
/** El intento en vivo de un jugador, tal como se persiste con la partida. */
export interface LiveAttempt {
  /** sha256 (hex) del token vigente. El token en claro solo lo tiene el jugador. */
  tokenHash: string;
  startedAt: number;
  /** Ticks comprometidos: el motor del árbitro va por acá. */
  tick: number;
  /** Aleteos comprometidos, en ticks absolutos. */
  flaps: number[];
  /** Cuántos valores al azar se revelaron. */
  revealed: number;
  over?: boolean;
  score?: number;
}
```

3d. En `export interface MatchView {`, reemplazar la línea `  seed: number;` por:

```ts
  /** Ausente en juegos EN VIVO hasta que la partida se decide: con la semilla
   *  se simula la partida entera antes de jugarla. */
  seed?: number;
  /** La partida se juega en vivo: /match/:id/live/start y /live/commit. */
  live?: boolean;
```

3e. En `function view(`, después de la línea `const rival = address === m.p1 ? m.p2 : address === m.p2 ? m.p1 : undefined;`, agregar:

```ts
const live = isLiveMatch(m.game, m.rulesV);
```

y en el literal `const v: MatchView = {`, reemplazar `    seed: m.seed,` por:

```ts
    seed: live && !decided ? undefined : m.seed,
    live: live || undefined,
```

3f. Reemplazar el bloque de depósito de `submitScore`, desde `  if (m.stake > 0 && onchainEnabled()) {` hasta su llave de cierre (inclusive; el bloque que llama a `readMatchOnchain` y `razonRechazoDeposito`), por:

```ts
await assertDepositOnchain(m, address);
```

Dejar intacto el comentario largo que lo precede ("¿DEPOSITÓ DE VERDAD? …").

3g. En `submitScore`, justo antes de `  let finalScore = Math.max(0, Math.floor(score));`, agregar:

```ts
// PARTIDA EN VIVO: el puntaje lo pone el árbitro al terminar el intento
// (live.ts), nunca un replay armado afuera: con la semilla oculta no hay
// replay honesto que mandar. Solo queda la RENDICIÓN (puntaje 0, sin jugadas y
// sin semilla), que ya usan la web y el runner, y cierra el intento con 0.
// `flaps` es de Flappy, el único juego en vivo del piloto.
if (isLiveMatch(m.game, m.rulesV)) {
  const currentV = RULES_V[m.game] ?? 1;
  if ((m.rulesV ?? 1) !== currentV) {
    throw new Error(
      `rules version mismatch (match v${m.rulesV ?? 1}, arbiter v${currentV}) — update @arcade1v1/mcp`,
    );
  }
  const r = (replay ?? {}) as { seed?: unknown; ticks?: unknown; flaps?: unknown; v?: unknown };
  const isForfeit =
    score === 0 &&
    r.seed === undefined &&
    r.ticks === 0 &&
    Array.isArray(r.flaps) &&
    r.flaps.length === 0 &&
    r.v === currentV;
  if (!isForfeit) {
    throw new Error(
      `replay not allowed: ${m.game} is live — play through /match/:id/live/start and /live/commit`,
    );
  }
  m.live ??= {};
  const prev = m.live[address];
  m.live[address] = {
    tokenHash: prev?.tokenHash ?? "",
    startedAt: prev?.startedAt ?? Date.now(),
    tick: prev?.tick ?? 0,
    flaps: prev?.flaps ?? [],
    revealed: prev?.revealed ?? 0,
    over: true,
    score: 0,
  };
  await finishLiveAttempt(m, address, 0, { ticks: 0, flaps: [], v: currentV });
  return view(m, address, { revealOwnScore: true });
}
```

3h. Agregar después de la función `submitScore` (antes de `/** Si ya estan los dos puntajes, decide y firma (o marca empate). */`):

```ts
/** ¿Depositó de verdad? Solo mesas de plata con escrow activo. Lo usan el envío
 *  de puntaje y la apertura de un intento en vivo. Tira el motivo si no. */
export async function assertDepositOnchain(
  m: { id: string; stake: number },
  address: string,
): Promise<void> {
  if (m.stake <= 0 || !onchainEnabled()) return;
  let enCadena;
  try {
    enCadena = await readMatchOnchain(m.id as Hex);
  } catch (e) {
    // El nodo no respondió. No aceptamos a ciegas con plata en juego: se pide
    // reintentar, que es recuperable, en vez de seguir sin poder verificar.
    console.error("[onchain] no se pudo leer la partida:", (e as Error).message);
    throw new Error("could not verify your deposit on-chain — retry in a moment", { cause: e });
  }
  const motivo = razonRechazoDeposito(enCadena, address);
  if (motivo) throw new Error(motivo);
}

// ---- Para live.ts (partidas en vivo) ----------------------------------------

/** La partida en memoria, no una vista: live.ts trabaja sobre su intento. */
export function matchRecord(id: string): Match | undefined {
  return matches.get(id);
}

/** Guarda las partidas (con el debounce de siempre). */
export function persistMatches(): void {
  persist();
}

/** Cierra el intento en vivo de `address` con su puntaje y su replay, y liquida
 *  si ya están los dos. */
export async function finishLiveAttempt(
  m: Match,
  address: string,
  score: number,
  replay: unknown,
): Promise<void> {
  m.scores[address] = score;
  m.replays[address] = replay;
  await settleIfReady(m);
  persist();
}
```

- [ ] **Step 4: Arreglar los usos de `seed`, que ahora es opcional (sin cambio de comportamiento)**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: errores `number | undefined` en `agent-runner.ts` (154, 175), `onchain-e2e.ts` (129, 131, 195, 197, 229, 258) y `selftest.ts` (127, 128, 159, 160, 167, 187, 191, 216, 253, 267, 271, 300, 307, 352).

**`apps/server/src/agent-runner.ts`**, en la rama `if (m.status === "ready" && m.scores[address] === undefined) {`: después de `if (m.challengeTarget && !m.rivalSubmitted) return false;`, agregar

```ts
// PARTIDA EN VIVO: el runner todavía no sabe jugarlas (llega en el PR 2 del
// benchmark en vivo). Mientras RULES_V no active ningún juego, en producción
// no pasa. Sin semilla tampoco hay replay de rendición de los de hoy.
const seed = m.seed;
if (m.live || seed === undefined) return false;
```

y reemplazar las tres apariciones de `m.seed` que siguen en esa rama (`seed: m.seed,` del aviso por webhook, `emptyReplay(m.game, m.seed),` y el argumento `m.seed,` de `runStrategy`) por `seed`.

**`apps/server/src/onchain-e2e.ts`**: reemplazar

```ts
function play2048(seed: number, maxMoves: number) {
  const g = new Game2048(seed);
```

por

```ts
function play2048(seed: number | undefined, maxMoves: number) {
  // 2048 no es un juego en vivo: la vista siempre trae la semilla.
  if (seed === undefined) throw new Error("2048 match without seed");
  const g = new Game2048(seed);
```

**`apps/server/src/selftest.ts`**: agregar debajo de los imports

```ts
/** Estas pruebas juegan juegos que NO son en vivo: la vista trae la semilla. */
function need(seed: number | undefined): number {
  if (seed === undefined) throw new Error("selftest: match without seed (live game?)");
  return seed;
}
```

En cada uno de los seis helpers (`play2048`, `playTetris`, `playFlappy`, `playRacing`, `playSnake`, `playInvaders`):

- cambiar el parámetro `seed: number` por `seedOrUndefined: number | undefined`;
- agregar como primera línea `const seed = need(seedOrUndefined);`.

En la línea 253, reemplazar `play2048(sm.seed + 1, 200)` por `play2048(need(sm.seed) + 1, 200)`.

En la tabla `games` (cerca de la línea 214), el tipo explícito del parámetro también cambia; si no, tsc marca la línea 228:

```ts
const games: {
  name: "tetris" | "flappy" | "racing" | "snake" | "invaders";
  play: (s: number | undefined) => { score: number; replay: unknown };
}[] = [
```

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: sin errores.

- [ ] **Step 5: Correr los tests nuevos, los del árbitro y el selftest**

Run: `node --import tsx --test apps/server/test/live-views.test.ts`
Expected: PASS (4 tests).

Run: `node --import tsx --test "apps/server/test/*.test.ts"`
Expected: PASS todo (sin regresiones).

Run: `npm run selftest`
Expected: `TODO OK ✅`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/matchmaking.ts apps/server/src/agent-runner.ts apps/server/src/selftest.ts apps/server/src/onchain-e2e.ts apps/server/test/live-views.test.ts
git commit -m "feat(server): partidas en vivo sin semilla en la vista, intento en la partida y rendición

La semilla no sale en ninguna vista de un juego en vivo hasta decidir. Un juego
en vivo no acepta replays armados afuera, solo la rendición, que cierra el
intento con 0. El control de depósito on-chain pasa a assertDepositOnchain para
reusarlo al abrir un intento. Sin juegos en vivo activos (RULES_V), producción no
cambia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Árbitro: `live.ts` (abrir y comprometer)

**Files:**

- Create: `apps/server/src/live.ts`
- Test: `apps/server/test/live-flappy.test.ts` (nuevo)
- Test: `apps/server/test/live-deposit.test.ts` (nuevo: mesa de plata, en su propio proceso porque necesita el escrow "activo")

**Interfaces:**

- Consumes: de Tarea 5, `matchRecord`, `persistMatches`, `finishLiveAttempt`, `assertDepositOnchain`, `AUTH_REQUIRED`, `MAX_REPLAY_TICKS`, `SUBMIT_WINDOW_MS`, `type Match`, `type LiveAttempt`. De Tareas 1 a 4, `FlappyEngine`, `FLAPPY_DT`, `SeededSource`, `isLiveMatch`, `LIVE_LEAD_TICKS`, `MAX_COMMIT_TICKS`, `liveStartAuthMessage`, `MATCHMAKE_AUTH_TTL_MS`, y en el test `playFlappyLive` con sus tipos.
- Produces, desde `apps/server/src/live.ts`:

```ts
export class LiveError extends Error {}
export type LiveStartView =
  | {
      over: false;
      token: string;
      tick: number;
      flaps: number[];
      reveal: number[];
      revealed: number;
    }
  | { over: true; score: number; tick: number };
export type LiveCommitView =
  | {
      conflict?: undefined;
      over: boolean;
      score?: number;
      tick: number;
      reveal: number[];
      revealed: number;
    }
  | { conflict: true; tick: number; reveal: number[]; revealed: number };
export interface LiveCommitBody {
  token: string;
  from: number;
  to: number;
  flaps: number[];
  have: number;
  final?: boolean;
}
export function liveStart(
  id: string,
  address: string,
  auth?: { signature: string; ts: number },
): Promise<LiveStartView>;
export function liveCommit(
  id: string,
  address: string,
  body: LiveCommitBody,
): Promise<LiveCommitView>;
export function __clearLiveEnginesForTest(): void;
```

- [ ] **Step 1: Escribir el test**

Crear `apps/server/test/live-flappy.test.ts`:

```ts
// El protocolo EN VIVO del árbitro (Flappy): abrir un intento único, comprometer
// jugadas y recibir el azar justo, resincronizar, cerrar y liquidar. La
// propiedad central se prueba jugando con el driver real contra el árbitro real:
// nada revelado se usa más de LIVE_LEAD_TICKS después de lo comprometido.
//
// Correr: node --import tsx --test apps/server/test/live-flappy.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_DT, FLAPPY_CONST, verifyFlappy } from "@arcade1v1/game-sdk/flappy";
import { LIVE_LEAD_TICKS, MAX_COMMIT_TICKS, SeededSource } from "@arcade1v1/game-sdk/live";
import { playFlappyLive, type FlappyLiveReply } from "@arcade1v1/game-sdk/flappy-live";
import { liveStartAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  matchmake,
  submitScore,
  getMatch,
  matchRecord,
  sweepMatches,
  MAX_REPLAY_TICKS,
  SUBMIT_WINDOW_MS,
} from "../src/matchmaking.js";
import {
  liveStart,
  liveCommit,
  __clearLiveEnginesForTest,
  type LiveStartView,
} from "../src/live.js";

RULES_V.flappy = 2;

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

async function livePair(game = "flappy") {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake(game, 0, p1);
  await matchmake(game, 0, p2);
  return { id: m1.matchId, p1, p2 };
}

function opened(s: LiveStartView) {
  assert.equal(s.over, false);
  return s as Extract<LiveStartView, { over: false }>;
}

/** Juega el intento entero con el driver real; registra (to, revealed) de cada compromiso. */
async function playLive(id: string, address: string, maxTicks = 3_000) {
  const s = opened(await liveStart(id, address));
  const log: { to: number; revealed: number }[] = [{ to: s.tick, revealed: s.revealed }];
  const result = await playFlappyLive({
    start: s,
    decide: flapPolicy,
    maxTicks,
    commit: async (c) => {
      const reply = (await liveCommit(id, address, { token: s.token, ...c })) as FlappyLiveReply;
      if (!reply.conflict) log.push({ to: reply.tick, revealed: reply.revealed });
      return reply;
    },
  });
  return { ...result, log, token: s.token };
}

test("abrir: el jugador recibe token y el primer valor; un tercero y un juego que no es en vivo no pueden", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  assert.match(s.token, /^[0-9a-f]{64}$/);
  assert.deepEqual([s.tick, s.flaps, s.revealed, s.reveal.length], [0, [], 1, 1]);
  await assert.rejects(liveStart(id, addr()), /not a player/);
  const other = await livePair("2048");
  await assert.rejects(liveStart(other.id, other.p1), /is not a live game/);
});

test("la firma, si viene, tiene que ser del jugador y reciente", async () => {
  const player = privateKeyToAccount(generatePrivateKey());
  const id = (await matchmake("flappy", 0, player.address)).matchId;
  await matchmake("flappy", 0, addr());
  const ts = Date.now();
  const good = await player.signMessage({ message: liveStartAuthMessage(id, player.address, ts) });
  assert.equal((await liveStart(id, player.address, { signature: good, ts })).over, false);
  const intruder = privateKeyToAccount(generatePrivateKey());
  const bad = await intruder.signMessage({ message: liveStartAuthMessage(id, player.address, ts) });
  await assert.rejects(liveStart(id, player.address, { signature: bad, ts }), /bad signature/);
  const old = Date.now() - 11 * 60_000;
  const stale = await player.signMessage({
    message: liveStartAuthMessage(id, player.address, old),
  });
  await assert.rejects(
    liveStart(id, player.address, { signature: stale, ts: old }),
    /auth expired/,
  );
});

test("la semilla no aparece en ninguna respuesta antes de decidir", async () => {
  const { id, p1 } = await livePair();
  const seed = String(matchRecord(id)!.seed);
  const s = opened(await liveStart(id, p1));
  const c = await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: 30,
    flaps: [0],
    have: s.revealed,
  });
  for (const out of [s, c, getMatch(id, p1), getMatch(id)]) {
    assert.ok(!JSON.stringify(out).includes(seed), "la semilla se filtró");
  }
});

test("un segundo abrir no reinicia: devuelve el mismo progreso, rota el token y el viejo deja de servir", async () => {
  const { id, p1 } = await livePair();
  const s1 = opened(await liveStart(id, p1));
  await liveCommit(id, p1, {
    token: s1.token,
    from: 0,
    to: 60,
    flaps: [0, 20, 40],
    have: s1.revealed,
  });
  const s2 = opened(await liveStart(id, p1));
  assert.deepEqual([s2.tick, s2.flaps], [60, [0, 20, 40]], "retoma, no reinicia");
  assert.notEqual(s2.token, s1.token);
  await assert.rejects(
    liveCommit(id, p1, { token: s1.token, from: 60, to: 70, flaps: [], have: s2.revealed }),
    /bad token/,
  );
  const ok = await liveCommit(id, p1, {
    token: s2.token,
    from: 60,
    to: 70,
    flaps: [],
    have: s2.revealed,
  });
  assert.equal(ok.tick, 70);
});

test("from desfasado: conflicto con el tick del árbitro y los valores desde have", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  const out = await liveCommit(id, p1, { token: s.token, from: 50, to: 80, flaps: [], have: 0 });
  assert.equal(out.conflict, true);
  assert.equal(out.tick, 0);
  assert.deepEqual(out.reveal, s.reveal, "reenvía todo lo revelado desde have=0");
});

test("topes: rangos y aleteos inválidos se rechazan sin avanzar el intento", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  const bad = (body: Partial<{ from: number; to: number; flaps: number[] }>) =>
    liveCommit(id, p1, { token: s.token, from: 0, to: 10, flaps: [], have: 1, ...body });
  await assert.rejects(bad({ to: 0 }), /invalid commit range/);
  await assert.rejects(bad({ to: MAX_COMMIT_TICKS + 1 }), /invalid commit range/);
  await assert.rejects(bad({ flaps: [10] }), /invalid flaps/);
  await assert.rejects(bad({ flaps: [5, 5] }), /invalid flaps/);
  await assert.rejects(bad({ flaps: [7, 3] }), /invalid flaps/);
  await assert.rejects(bad({ flaps: [1.5] }), /invalid flaps/);
  const ok = await bad({});
  assert.equal(ok.tick, 10, "después de los rechazos el intento sigue en 0 y avanza bien");
});

test("jugar en vivo contra el árbitro da el puntaje que verifica la semilla, y liquida al terminar los dos", async () => {
  const { id, p1, p2 } = await livePair();
  const a = await playLive(id, p1);
  const b = await playLive(id, p2);
  const m = matchRecord(id)!;
  for (const [player, run] of [
    [p1, a],
    [p2, b],
  ] as const) {
    const replay = m.replays[player.toLowerCase()] as { ticks: number; flaps: number[] };
    assert.equal(
      run.score,
      verifyFlappy({ seed: m.seed, ...replay }),
      "el puntaje re-verifica con la semilla",
    );
  }
  const view = getMatch(id, p1)!;
  assert.ok(view.status === "settled" || view.status === "draw");
  assert.equal(view.seed, m.seed, "decidida: ya se puede ver la semilla");
});

test("propiedad central: nada revelado se usa más de LIVE_LEAD_TICKS después de lo comprometido", async () => {
  for (let i = 0; i < 6; i++) {
    const { id, p1 } = await livePair();
    const run = await playLive(id, p1);
    const m = matchRecord(id)!;
    const replay = m.replays[p1.toLowerCase()] as { ticks: number; flaps: number[] };
    // En qué tick se usa cada valor en la partida real (-1: al construir el motor).
    const consumedAt: number[] = [];
    let now = -1;
    const src = new SeededSource(m.seed);
    const g = new FlappyEngine({
      next: () => {
        consumedAt.push(now);
        return src.next();
      },
    });
    const set = new Set(replay.flaps);
    for (now = 0; now < replay.ticks && !g.over; now++) {
      if (set.has(now)) g.flap();
      g.update(FLAPPY_DT);
    }
    assert.equal(g.score, run.score);
    for (const entry of run.log) {
      for (let k = 0; k < entry.revealed && k < consumedAt.length; k++) {
        assert.ok(
          consumedAt[k] <= entry.to + LIVE_LEAD_TICKS,
          `valor ${k} usado en el tick ${consumedAt[k]} y revelado con to=${entry.to}`,
        );
      }
    }
  }
});

test("final cierra con el puntaje alcanzado; después todo compromiso devuelve el cierre", async () => {
  const { id, p1 } = await livePair();
  // 120 ticks: el primer tubo recién alcanza al pájaro cerca del 159, así que
  // llega vivo sea cual sea la semilla, y el cierre es por `final`.
  const run = await playLive(id, p1, 120);
  assert.equal(run.ticks, 120, "llegó vivo al tope y cerró con final");
  const again = await liveCommit(id, p1, {
    token: run.token,
    from: 120,
    to: 130,
    flaps: [],
    have: 0,
  });
  assert.equal(again.conflict, undefined);
  assert.equal(again.over, true);
  assert.equal(again.score, run.score);
  const reopened = await liveStart(id, p1);
  assert.deepEqual(reopened, { over: true, score: run.score, tick: 120 });
});

test("rendirse con un intento abierto lo cierra con 0", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  await liveCommit(id, p1, { token: s.token, from: 0, to: 40, flaps: [0], have: s.revealed });
  await submitScore(id, p1, 0, { ticks: 0, flaps: [], v: 2 });
  const after = await liveCommit(id, p1, { token: s.token, from: 40, to: 50, flaps: [], have: 0 });
  assert.deepEqual([after.over, after.score], [true, 0]);
});

test("sin el caché de motores (un reinicio) el intento sigue exactamente igual", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  // Hasta el tick 140: el primer tubo todavía no llega al pájaro, y en los 15
  // ticks siguientes nace el segundo, así que ya hay dos valores revelados. Un
  // aleteo cada 36 ticks mantiene el vuelo casi estable (cada 18 lo estrella
  // contra el techo cerca del tick 75).
  const first = await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: 140,
    flaps: [0, 36, 72, 108],
    have: s.revealed,
  });
  assert.deepEqual([first.over, first.tick, first.revealed], [false, 140, 2]);
  __clearLiveEnginesForTest();
  const second = await liveCommit(id, p1, {
    token: s.token,
    from: 140,
    to: 141,
    flaps: [],
    have: 0,
  });
  assert.equal(second.conflict, undefined);
  assert.equal(second.tick, 141);
  assert.deepEqual(
    second.reveal.slice(0, 2),
    [...s.reveal, ...first.reveal],
    "el motor reconstruido revela exactamente los mismos valores",
  );
});

test("llegar a MAX_REPLAY_TICKS cierra el intento", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  // Sin aletear el juego no arranca: nada muere, y el tope es lo único que cierra.
  let from = 0;
  let last;
  while (from < MAX_REPLAY_TICKS) {
    const to = Math.min(from + MAX_COMMIT_TICKS, MAX_REPLAY_TICKS);
    last = await liveCommit(id, p1, { token: s.token, from, to, flaps: [], have: 0 });
    from = last.tick;
  }
  assert.deepEqual([last!.over, last!.tick, last!.score], [true, MAX_REPLAY_TICKS, 0]);
});

// Va ÚLTIMO: el barrendero vence todas las partidas de este proceso.
test("un intento abandonado vence con la partida y ya no acepta compromisos", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  await liveCommit(id, p1, { token: s.token, from: 0, to: 30, flaps: [0], have: s.revealed });
  sweepMatches(Date.now() + SUBMIT_WINDOW_MS + 16 * 60_000);
  assert.equal(getMatch(id, p1)!.status, "draw");
  await assert.rejects(
    liveCommit(id, p1, { token: s.token, from: 30, to: 40, flaps: [], have: 0 }),
    /match already decided/,
  );
});
```

Crear también `apps/server/test/live-deposit.test.ts`:

```ts
// Abrir un intento en vivo en una mesa de plata exige el depósito on-chain, como
// el envío de puntaje. Si el nodo no contesta, se rechaza (falla cerrado) en vez
// de dejar jugar sin saber si hay plata adentro.
//
// Correr: node --import tsx --test apps/server/test/live-deposit.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

// Escrow "activo" apuntando a un RPC que no contesta. Todo ANTES de importar:
// onchain.ts y sign.ts leen estas variables al cargarse. La clave es la cuenta
// #1 de anvil, pública y sin valor (la misma de offline-env.ts).
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "31337";
process.env.RPC_URL = "http://127.0.0.1:9";
process.env.ARBITER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const { RULES_V } = await import("@arcade1v1/game-sdk/rules");
RULES_V.flappy = 2;
const { matchmake } = await import("../src/matchmaking.js");
const { liveStart } = await import("../src/live.js");

test("mesa de plata: sin poder leer el depósito on-chain no se abre el intento", async () => {
  const p1 = "0x" + "1".repeat(40);
  const m = await matchmake("flappy", 1, p1);
  await matchmake("flappy", 1, "0x" + "2".repeat(40));
  await assert.rejects(liveStart(m.matchId, p1), /could not verify your deposit on-chain/);
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `node --import tsx --test apps/server/test/live-flappy.test.ts apps/server/test/live-deposit.test.ts`
Expected: FAIL al importar `../src/live.js` (`Cannot find module`).

- [ ] **Step 3: Implementar**

Crear `apps/server/src/live.ts`:

```ts
// PARTIDAS EN VIVO del 1v1 (piloto: Flappy). El jugador abre un intento con su
// firma, compromete sus jugadas por tramos y recibe el azar que el juego va a
// consumir en los próximos LIVE_LEAD_TICKS. La semilla nunca sale de acá hasta
// que la partida se decide.
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import {
  isLiveMatch,
  SeededSource,
  LIVE_LEAD_TICKS,
  MAX_COMMIT_TICKS,
} from "@arcade1v1/game-sdk/live";
import { liveStartAuthMessage, MATCHMAKE_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import {
  AUTH_REQUIRED,
  MAX_REPLAY_TICKS,
  SUBMIT_WINDOW_MS,
  assertDepositOnchain,
  finishLiveAttempt,
  matchRecord,
  persistMatches,
  type LiveAttempt,
  type Match,
} from "./matchmaking.js";

/** Un error esperable del protocolo: las rutas lo devuelven como 400. */
export class LiveError extends Error {}

export type LiveStartView =
  | {
      over: false;
      token: string;
      tick: number;
      flaps: number[];
      reveal: number[];
      revealed: number;
    }
  | { over: true; score: number; tick: number };

export type LiveCommitView =
  | {
      conflict?: undefined;
      over: boolean;
      score?: number;
      tick: number;
      reveal: number[];
      revealed: number;
    }
  | { conflict: true; tick: number; reveal: number[]; revealed: number };

export interface LiveCommitBody {
  token: string;
  from: number;
  to: number;
  flaps: number[];
  have: number;
  final?: boolean;
}

// Motores del árbitro por intento, en memoria. Se reconstruyen repitiendo el
// registro (después de un reinicio, o si quedaron desfasados). El tope evita que
// los intentos abandonados acumulen memoria.
const MAX_CACHED_ENGINES = 500;
const engines = new Map<string, { eng: FlappyEngine; src: SeededSource; tick: number }>();

/** Tests: simula un reinicio del árbitro (se pierde el caché, no el intento). */
export function __clearLiveEnginesForTest(): void {
  engines.clear();
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function engineFor(m: Match, address: string, a: LiveAttempt) {
  const key = `${m.id}:${address}`;
  const cached = engines.get(key);
  if (cached && cached.tick === a.tick) return cached;
  const src = new SeededSource(m.seed);
  const eng = new FlappyEngine(src);
  const flapSet = new Set(a.flaps);
  for (let t = 0; t < a.tick && !eng.over; t++) {
    if (flapSet.has(t)) eng.flap();
    eng.update(FLAPPY_DT);
  }
  const entry = { eng, src, tick: a.tick };
  engines.delete(key);
  engines.set(key, entry);
  if (engines.size > MAX_CACHED_ENGINES) {
    const oldest = engines.keys().next().value;
    if (oldest !== undefined) engines.delete(oldest);
  }
  return entry;
}

/** La partida, si `address` puede jugarla en vivo. */
function liveMatchFor(id: string, address: string): Match {
  const m = matchRecord(id);
  if (!m) throw new LiveError("match not found");
  if (address !== m.p1 && address !== m.p2) {
    throw new LiveError("not allowed: not a player in this match");
  }
  if (!isLiveMatch(m.game, m.rulesV)) {
    throw new LiveError(`live play not allowed: ${m.game} is not a live game`);
  }
  const currentV = RULES_V[m.game] ?? 1;
  if ((m.rulesV ?? 1) !== currentV) {
    throw new LiveError(
      `rules version mismatch (match v${m.rulesV ?? 1}, arbiter v${currentV}) — update @arcade1v1/mcp`,
    );
  }
  return m;
}

function assertOpen(m: Match): void {
  if (m.status === "settled" || m.status === "draw") throw new LiveError("match already decided");
  if (Date.now() - m.createdAt > SUBMIT_WINDOW_MS) throw new LiveError("match expired");
}

/** Revela lo que el motor va a consumir en los próximos LIVE_LEAD_TICKS y
 *  devuelve los valores desde `have`. */
function reveal(a: LiveAttempt, e: { eng: FlappyEngine; src: SeededSource }, have: number) {
  a.revealed = Math.max(a.revealed, e.src.consumed + e.eng.drawsWithin(LIVE_LEAD_TICKS));
  const from = Math.min(Math.max(0, have), a.revealed);
  return { reveal: e.src.slice(from, a.revealed), revealed: a.revealed };
}

/** Abre (o retoma) el intento en vivo de `address`. Nunca lo reinicia: si ya
 *  existe devuelve su progreso y un token nuevo que invalida el anterior. */
export async function liveStart(
  id: string,
  address: string,
  auth?: { signature: string; ts: number },
): Promise<LiveStartView> {
  address = address.toLowerCase();
  const m = liveMatchFor(id, address);
  if (auth?.signature) {
    const ts = Number(auth.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MATCHMAKE_AUTH_TTL_MS) {
      throw new LiveError("auth expired");
    }
    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: liveStartAuthMessage(m.id, address, ts),
        signature: auth.signature as Hex,
      });
    } catch {
      throw new LiveError("bad signature");
    }
    if (signer.toLowerCase() !== address) throw new LiveError("bad signature");
  } else if (AUTH_REQUIRED) {
    throw new LiveError("signature required");
  }
  const earlier = m.live?.[address];
  if (earlier?.over) return { over: true, score: earlier.score ?? 0, tick: earlier.tick };
  assertOpen(m);
  try {
    await assertDepositOnchain(m, address);
  } catch (e) {
    throw new LiveError((e as Error).message);
  }

  // Desde acá, sin awaits: dos aperturas a la vez no pueden pisarse el intento.
  const now = m.live?.[address];
  if (now?.over) return { over: true, score: now.score ?? 0, tick: now.tick };
  assertOpen(m);
  m.live ??= {};
  const a: LiveAttempt = now ?? {
    tokenHash: "",
    startedAt: Date.now(),
    tick: 0,
    flaps: [],
    revealed: 0,
  };
  m.live[address] = a;
  const token = randomBytes(32).toString("hex");
  a.tokenHash = sha256(token);
  const r = reveal(a, engineFor(m, address, a), 0);
  persistMatches();
  return { over: false, token, tick: a.tick, flaps: [...a.flaps], ...r };
}

/** Compromete los aleteos en `[from, to)` y devuelve el azar de los próximos
 *  LIVE_LEAD_TICKS. Con `final`, al morir o al tope, cierra el intento. */
export async function liveCommit(
  id: string,
  address: string,
  body: LiveCommitBody,
): Promise<LiveCommitView> {
  address = address.toLowerCase();
  const m = liveMatchFor(id, address);
  const a = m.live?.[address];
  if (!a) throw new LiveError("missing live attempt: call /match/:id/live/start first");
  const given = Buffer.from(sha256(String(body.token ?? "")), "hex");
  const stored = Buffer.from(a.tokenHash, "hex");
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
    throw new LiveError("bad token");
  }
  if (a.over)
    return { over: true, score: a.score ?? 0, tick: a.tick, reveal: [], revealed: a.revealed };
  assertOpen(m);

  const { from, to, have, flaps } = body;
  const final = body.final === true;
  if (![from, to, have].every(Number.isInteger)) {
    throw new LiveError("invalid commit range: from, to and have must be integers");
  }
  if (from !== a.tick) {
    return { conflict: true, tick: a.tick, ...reveal(a, engineFor(m, address, a), have) };
  }
  if (
    to < from ||
    (to === from && !final) ||
    to - from > MAX_COMMIT_TICKS ||
    to > MAX_REPLAY_TICKS
  ) {
    throw new LiveError(`invalid commit range [${from}, ${to})`);
  }
  if (
    !Array.isArray(flaps) ||
    flaps.some(
      (f, i) => !Number.isInteger(f) || f < from || f >= to || (i > 0 && f <= flaps[i - 1]),
    )
  ) {
    throw new LiveError("invalid flaps: integer ticks, strictly increasing, inside [from, to)");
  }

  const e = engineFor(m, address, a);
  const flapSet = new Set(flaps);
  let t = from;
  for (; t < to && !e.eng.over; t++) {
    if (flapSet.has(t)) e.eng.flap();
    e.eng.update(FLAPPY_DT);
  }
  // Los aleteos después de morir no se aplicaron: no entran al registro.
  for (const f of flaps) if (f < t) a.flaps.push(f);
  a.tick = t;
  e.tick = t;

  const r = reveal(a, e, have);
  if (e.eng.over || final || a.tick >= MAX_REPLAY_TICKS) {
    a.over = true;
    a.score = e.eng.score;
    engines.delete(`${m.id}:${address}`);
    await finishLiveAttempt(m, address, a.score, {
      ticks: a.tick,
      flaps: [...a.flaps],
      v: RULES_V[m.game] ?? 1,
    });
    return { over: true, score: a.score, tick: a.tick, ...r };
  }
  persistMatches();
  return { over: false, tick: a.tick, ...r };
}
```

- [ ] **Step 4: Correr los tests y el typecheck**

Run: `node --import tsx --test apps/server/test/live-flappy.test.ts apps/server/test/live-deposit.test.ts`
Expected: PASS (13 tests en `live-flappy` y 1 en `live-deposit`).

Run: `npx tsc --noEmit -p apps/server/tsconfig.json && npx eslint apps/server/src/live.ts apps/server/test/live-flappy.test.ts apps/server/test/live-deposit.test.ts`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/live.ts apps/server/test/live-flappy.test.ts apps/server/test/live-deposit.test.ts
git commit -m "feat(server): live.ts abre y compromete intentos en vivo de Flappy

Intento único (abrir de nuevo retoma y rota el token), compromisos por tramos
con resincronización por conflicto y valores desde have, cierre al morir, con
final o al tope, y liquidación. La propiedad central se prueba con el driver
real contra el árbitro real.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rutas HTTP en vivo, limitador e índice de la API

**Files:**

- Create: `apps/server/src/live-routes.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/live-routes.test.ts` (nuevo)

**Interfaces:**

- Consumes: `liveStart`, `liveCommit`, `LiveError` (Tarea 6).
- Produces: `export function liveRouter(limit: RequestHandler): Router` con `POST /match/:id/live/start` y `POST /match/:id/live/commit`.

- [ ] **Step 1: Escribir el test**

Crear `apps/server/test/live-routes.test.ts`:

```ts
// Rutas HTTP de las partidas en vivo: la capa fina sobre live.ts traduce los
// errores del protocolo a 400 y el conflicto de tick a 409.
//
// Correr: node --import tsx --test apps/server/test/live-routes.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { matchmake } from "../src/matchmaking.js";
import { liveRouter } from "../src/live-routes.js";

RULES_V.flappy = 2;

const app = express();
app.use(express.json());
app.use(liveRouter((_req, _res, next) => next()));
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

test("abrir 200, comprometer 200, from desfasado 409 y errores del protocolo 400", async () => {
  const p1 = addr();
  const { matchId } = await matchmake("flappy", 0, p1);
  await matchmake("flappy", 0, addr());

  const start = await post(`/match/${matchId}/live/start`, { address: p1 });
  assert.equal(start.status, 200);
  const token = String(start.body.token);

  const ok = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token,
    from: 0,
    to: 20,
    flaps: [0],
    have: 1,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tick, 20);

  const conflict = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token,
    from: 0,
    to: 30,
    flaps: [],
    have: 1,
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.tick, 20);

  const badToken = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token: "nope",
    from: 20,
    to: 30,
    flaps: [],
    have: 1,
  });
  assert.equal(badToken.status, 400);
  assert.match(String(badToken.body.error), /bad token/);

  const missing = await post(`/match/${matchId}/live/start`, {});
  assert.equal(missing.status, 400);

  const notArray = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token,
    from: 20,
    to: 30,
    flaps: "0",
    have: 1,
  });
  assert.equal(notArray.status, 400);
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `node --import tsx --test apps/server/test/live-routes.test.ts`
Expected: FAIL al importar `../src/live-routes.js` (`Cannot find module`).

- [ ] **Step 3: Implementar**

Crear `apps/server/src/live-routes.ts`:

```ts
// Rutas HTTP de las partidas en vivo (1v1). Capa fina sobre live.ts: valida
// presencia de campos, traduce LiveError a 400 y un conflicto de tick a 409.

import { Router, type RequestHandler, type Response } from "express";
import { liveStart, liveCommit, LiveError } from "./live.js";

function fail(res: Response, e: unknown): void {
  if (e instanceof LiveError) {
    res.status(400).json({ error: e.message });
    return;
  }
  console.error("[live]", (e as Error)?.stack ?? e);
  res.status(500).json({ error: "internal error" });
}

/** `limit`: el limitador de pedidos que pone index.ts (los tests pasan uno vacío). */
export function liveRouter(limit: RequestHandler): Router {
  const router = Router();

  // Abrir o retomar el intento. En producción, firmado: liveStartAuthMessage.
  router.post("/match/:id/live/start", limit, async (req, res) => {
    const { address, signature, ts } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "missing address" });
    try {
      const auth = signature ? { signature: String(signature), ts: Number(ts) } : undefined;
      res.json(await liveStart(String(req.params.id), String(address), auth));
    } catch (e) {
      fail(res, e);
    }
  });

  // Comprometer aleteos en [from, to) y recibir el azar de los próximos 15 ticks.
  router.post("/match/:id/live/commit", limit, async (req, res) => {
    const { address, token, from, to, flaps, have, final } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "missing address" });
    if (!Array.isArray(flaps)) return res.status(400).json({ error: "invalid flaps" });
    try {
      const out = await liveCommit(String(req.params.id), String(address), {
        token: String(token ?? ""),
        from: Number(from),
        to: Number(to),
        flaps: flaps.map(Number),
        have: Number(have ?? 0),
        final: final === true,
      });
      res.status(out.conflict ? 409 : 200).json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  return router;
}
```

En `apps/server/src/index.ts`:

1. Agregar el import junto al de `alephRouter`:

```ts
import { liveRouter } from "./live-routes.js";
```

2. Después de la línea `const strictLimit = rateLimiter(Number(process.env.RL_MAX_EXPENSIVE ?? 12));`, agregar:

```ts
// Partidas EN VIVO: una partida compromete una vez por tubo, y el estricto (12
// cada 10 s) se queda corto con varios jugadores detrás de la misma IP.
const liveLimit = rateLimiter(Number(process.env.RL_MAX_LIVE ?? 60));
```

3. Después del handler de `app.post("/match/:id/score", …)` y ANTES del comentario `// Completar la partida contra un bot (SOLO pruebas en solitario).` (ese comentario es de la ruta `/match/:id/bot` y tiene que quedar pegado a ella), agregar:

```ts
// PARTIDAS EN VIVO: abrir el intento y comprometer jugadas (ver live.ts).
app.use(liveRouter(liveLimit));
```

4. En el índice de la API, después de la entrada `"POST /match/:id/score": …`, agregar:

```ts
      "POST /match/:id/live/start":
        "{ address, signature, ts } -> open or resume your live attempt (live games only; matchmake says live: true). Sign liveStartAuthMessage(matchId, address, ts). Returns { token, tick, flaps, reveal, revealed }",
      "POST /match/:id/live/commit":
        "{ address, token, from, to, flaps, have, final? } -> commit your flaps in [from, to) and get the random values the game uses in the next 15 ticks. 409 { tick, reveal } = resend from tick",
```

- [ ] **Step 4: Correr los tests y el typecheck**

Run: `node --import tsx --test apps/server/test/live-routes.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p apps/server/tsconfig.json && npx eslint apps/server/src/live-routes.ts apps/server/src/index.ts apps/server/test/live-routes.test.ts`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/live-routes.ts apps/server/src/index.ts apps/server/test/live-routes.test.ts
git commit -m "feat(server): rutas HTTP de las partidas en vivo con limitador propio

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Rutas en vivo para agentes BYO por webhook

**Files:**

- Modify: `apps/server/src/agents-routes.ts`
- Test: `apps/server/test/live-webhook-routes.test.ts` (nuevo)

**Interfaces:**

- Consumes: `liveStart`, `liveCommit`, `LiveError` (Tarea 6); `liveStartAuthMessage` (Tarea 3).
- Produces: `POST /agents/:id/live/start` y `POST /agents/:id/live/commit`, autenticadas con el secreto del webhook. `/agents/:id/play` sigue igual.

- [ ] **Step 1: Escribir el test**

Crear `apps/server/test/live-webhook-routes.test.ts`:

```ts
// Rutas EN VIVO de los agentes BYO por webhook: el dev juega con el secreto de
// su agente (sin firmas de wallet), sobre la partida pendiente que le avisó el
// runner. Mismas guardias que /play.
//
// Correr: node --import tsx --test apps/server/test/live-webhook-routes.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentAuthMessage, matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";

process.env.REQUIRE_AUTH = "true";
process.env.MAX_AGENTS_PER_OWNER = "100";
RULES_V.flappy = 2;
const { agentsRouter } = await import("../src/agents-routes.js");
const { getAgent, setAgentPending } = await import("../src/agents.js");
const { matchmake } = await import("../src/matchmaking.js");

const app = express();
app.use(express.json());
app.use(agentsRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const owner = privateKeyToAccount(generatePrivateKey());
const OWNER = owner.address.toLowerCase();

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

async function flappyWebhookAgentInMatch(name: string) {
  const ts = Date.now();
  const signature = await owner.signMessage({
    message: agentAuthMessage("create", `flappy:webhook:${name}`, OWNER, ts),
  });
  const created = await post("/agents", {
    owner: OWNER,
    name,
    avatar: "🤖",
    game: "flappy",
    strategyId: "webhook",
    webhookUrl: "https://example.com/hook",
    signature,
    ts,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = String(created.body.id);
  const secret = String(created.body.webhookSecret);
  const a = getAgent(id)!;
  const agentAddr = a.address.toLowerCase();
  let t = Date.now();
  const s1 = await privateKeyToAccount(a.privateKey).signMessage({
    message: matchmakeAuthMessage("flappy", 0, agentAddr, t),
  });
  const m = await matchmake("flappy", 0, agentAddr, { signature: s1, ts: t });
  setAgentPending(a, m.matchId);
  const rival = privateKeyToAccount(generatePrivateKey());
  t = Date.now();
  const s2 = await rival.signMessage({
    message: matchmakeAuthMessage("flappy", 0, rival.address.toLowerCase(), t),
  });
  await matchmake("flappy", 0, rival.address.toLowerCase(), { signature: s2, ts: t });
  return { id, secret, matchId: m.matchId };
}

test("BYO en vivo: abre y compromete con el secreto; secreto malo 401 y partida ajena 409", async () => {
  const { id, secret, matchId } = await flappyWebhookAgentInMatch("EnVivo");
  const auth = { Authorization: `Bearer ${secret}` };

  const start = await post(`/agents/${id}/live/start`, { matchId }, auth);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.over, false);
  const token = String(start.body.token);

  const commit = await post(
    `/agents/${id}/live/commit`,
    { matchId, token, from: 0, to: 30, flaps: [0], have: 1 },
    auth,
  );
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.tick, 30);

  const conflict = await post(
    `/agents/${id}/live/commit`,
    { matchId, token, from: 0, to: 40, flaps: [], have: 1 },
    auth,
  );
  assert.equal(conflict.status, 409);

  const badSecret = await post(
    `/agents/${id}/live/start`,
    { matchId },
    { Authorization: "Bearer nope" },
  );
  assert.equal(badSecret.status, 401);

  const otherMatch = await post(
    `/agents/${id}/live/start`,
    { matchId: "0x" + "0".repeat(64) },
    auth,
  );
  assert.equal(otherMatch.status, 409);
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `node --import tsx --test apps/server/test/live-webhook-routes.test.ts`
Expected: FAIL: `POST /agents/:id/live/start` no existe (404, o un cuerpo HTML que no es JSON).

- [ ] **Step 3: Implementar**

En `apps/server/src/agents-routes.ts`:

1. Imports. Cambiar `import { Router } from "express";` por:

```ts
import { Router, type Request, type Response } from "express";
```

Cambiar el import de `@arcade1v1/game-sdk/auth` por:

```ts
import {
  agentAuthMessage,
  AGENT_AUTH_TTL_MS,
  liveStartAuthMessage,
  scoreAuthMessage,
} from "@arcade1v1/game-sdk/auth";
```

Sumar `type HostedAgent` al import de `./agents.js`, y agregar:

```ts
import { liveStart, liveCommit, LiveError } from "./live.js";
```

2. Reemplazar el handler `agentsRouter.post("/agents/:id/play", async (req, res) => { … });` **completo** por las guardias compartidas, el `/play` que las usa (mismo orden de respuestas que antes) y las dos rutas en vivo:

```ts
/** Guardia 1 de una jugada BYO: el agente existe y es webhook, los webhooks
 *  están habilitados, el secreto es el suyo y `matchId` es su partida pendiente.
 *  Si algo falla, contesta y devuelve null. */
function webhookAgent(
  req: Request,
  res: Response,
): { a: HostedAgent; matchId: string; address: string } | null {
  const a = getAgent(String(req.params.id));
  // Mismo 404 para "no existe" y "no es webhook": no revelar cuál es cuál.
  if (!a || !a.webhook) {
    res.status(404).json({ error: "agent not found" });
    return null;
  }
  if (!webhookAgentsEnabled()) {
    res.status(403).json({ error: "webhook agents disabled" });
    return null;
  }
  const auth = String(req.headers.authorization ?? "");
  // El esquema Authorization es case-insensitive (RFC 7235): aceptamos
  // "Bearer" y "bearer" para no rebotar a un cliente con el secreto correcto.
  const given = /^bearer /i.test(auth)
    ? auth.slice(7)
    : String(req.headers["x-agent-secret"] ?? "");
  if (!given || !secretMatches(given, a.webhook.secret)) {
    res.status(401).json({ error: "bad secret" });
    return null;
  }
  const matchId = String(req.body?.matchId ?? "");
  // Nota: se acepta aunque active===false — pausar no mata una partida viva.
  if (!matchId || matchId !== a.pendingMatchId) {
    res.status(409).json({ error: "no pending match with that id" });
    return null;
  }
  return { a, matchId, address: a.address.toLowerCase() };
}

/** Guardia 2: la partida sigue viva, emparejada y le toca jugar. */
function webhookReadyMatch(
  res: Response,
  a: HostedAgent,
  matchId: string,
  address: string,
): boolean {
  const m = getMatch(matchId, address);
  if (!m) {
    // La partida fue purgada/expirada: soltar el pending para que el runner
    // vuelva a encolar en el próximo tick.
    setAgentPending(a, undefined);
    res.status(410).json({ error: "match gone" });
    return false;
  }
  if (m.status !== "ready") {
    res.status(409).json({ error: `match is ${m.status}` });
    return false;
  }
  // Defensa en profundidad: en un desafío no se juega hasta que el retador
  // jugó (normalmente ni se notificó; ver agent-runner).
  if (m.challengeTarget && !m.rivalSubmitted) {
    res.status(409).json({ error: "challenger has not played yet" });
    return false;
  }
  return true;
}

agentsRouter.post("/agents/:id/play", async (req, res) => {
  const who = webhookAgent(req, res);
  if (!who) return;
  const n = Number(req.body?.score);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "bad score" });
  if (!webhookReadyMatch(res, who.a, who.matchId, who.address)) return;

  try {
    const account = privateKeyToAccount(who.a.privateKey);
    const signature = await account.signMessage({
      message: scoreAuthMessage(who.matchId, who.address, n),
    });
    const after = await submitScore(who.matchId, who.address, n, req.body?.replay, signature);
    resetWebhookFailures(who.a); // el endpoint del dev vive y juega
    recordSettledResult(who.a, after, who.address); // no-op si la partida no se decidió
    // El MatchView estándar: el mismo feedback rico que cualquier jugador.
    res.json(after);
  } catch (e) {
    // Verificación fallida (replay no reproduce el score, etc.): 400 y el dev
    // puede reintentar hasta el deadline; si nunca valida, el forfeit captura.
    res.status(400).json({ error: (e as Error).message });
  }
});

function liveFail(res: Response, e: unknown): void {
  if (e instanceof LiveError) {
    res.status(400).json({ error: e.message });
    return;
  }
  console.error("[live byo]", (e as Error)?.stack ?? e);
  res.status(500).json({ error: "internal error" });
}

// EN VIVO para BYO: el secreto prueba el control del agente, así que el server
// firma la apertura con la clave del agente, como en /play firma el puntaje.
agentsRouter.post("/agents/:id/live/start", async (req, res) => {
  const who = webhookAgent(req, res);
  if (!who || !webhookReadyMatch(res, who.a, who.matchId, who.address)) return;
  try {
    const ts = Date.now();
    const signature = await privateKeyToAccount(who.a.privateKey).signMessage({
      message: liveStartAuthMessage(who.matchId, who.address, ts),
    });
    res.json(await liveStart(who.matchId, who.address, { signature, ts }));
  } catch (e) {
    liveFail(res, e);
  }
});

agentsRouter.post("/agents/:id/live/commit", async (req, res) => {
  const who = webhookAgent(req, res);
  if (!who || !webhookReadyMatch(res, who.a, who.matchId, who.address)) return;
  const { token, from, to, flaps, have, final } = req.body ?? {};
  if (!Array.isArray(flaps)) return res.status(400).json({ error: "invalid flaps" });
  try {
    const out = await liveCommit(who.matchId, who.address, {
      token: String(token ?? ""),
      from: Number(from),
      to: Number(to),
      flaps: flaps.map(Number),
      have: Number(have ?? 0),
      final: final === true,
    });
    if (!out.conflict && out.over) {
      resetWebhookFailures(who.a);
      const after = getMatch(who.matchId, who.address);
      if (after) recordSettledResult(who.a, after, who.address);
    }
    res.status(out.conflict ? 409 : 200).json(out);
  } catch (e) {
    liveFail(res, e);
  }
});
```

- [ ] **Step 4: Correr los tests nuevos y los de /play**

Run: `node --import tsx --test apps/server/test/live-webhook-routes.test.ts apps/server/test/webhook-routes.test.ts`
Expected: PASS todos: el test nuevo, y los de `/play` sin cambios de comportamiento.

Run: `npx tsc --noEmit -p apps/server/tsconfig.json && npx eslint apps/server/src/agents-routes.ts apps/server/test/live-webhook-routes.test.ts`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agents-routes.ts apps/server/test/live-webhook-routes.test.ts
git commit -m "feat(server): rutas en vivo para agentes BYO por webhook

Las guardias de /play (agente, secreto, partida pendiente, partida lista) pasan
a dos funciones que comparten /play y las rutas nuevas, con el mismo orden de
respuestas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Verificación completa y PR

**Files:** ninguno nuevo.

- [ ] **Step 1: Formato y chequeo completo**

Run: `npx prettier --write packages/game-sdk apps/server/src apps/server/test && npm run check`
Expected: exit 0; todos los tests en verde y `TODO OK ✅`. El único warning de ESLint permitido es el que ya existe en `apps/web/app/game/[gameId]/match/page.tsx`.

Si Prettier cambió archivos, commitearlos:

```bash
git add -A packages/game-sdk apps/server
git commit -m "style: prettier

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 2: e2e de pago del 1v1 (toca `submitScore` y el control de depósito)**

Run: `pgrep -fl anvil || bash packages/contracts/check-payment-e2e.sh`
Expected: si `pgrep` muestra un anvil de otra sesión, NO correr el script (hace `pkill -f anvil`) y dejar que lo corra CI. Si no hay anvil: termina con `REVERT MINADO DEL CANCEL (SE CORTA) VERIFICADO ✅` y exit 0. En un worktree nuevo, copiar antes `packages/contracts/lib` del checkout principal.

- [ ] **Step 3: Subir la rama y abrir el PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat: benchmark en vivo, PR 1 de 3 — la base apagada (motor y árbitro)" --body-file - <<'EOF'
## Qué es

La base de las partidas en vivo del spec `docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md`
(en el PR #27, junto con el plan de este PR): el motor de Flappy toma su azar de
una fuente inyectada, y el árbitro abre intentos y revela el azar de a poco a
cambio de comprometer las jugadas.

## Por qué no cambia nada en producción

`RULES_V.flappy` sigue en 1, así que `isLiveMatch` da falso para todos los
juegos: ninguna vista pierde la semilla y las rutas nuevas rechazan todo con
"is not a live game". Los tests activan el modo en vivo solo dentro de su
proceso.

## Qué se probó

- La física de Flappy no cambió: huella de 50 semillas calculada sobre `main`.
- `drawsWithin` predice exacto (más de 100.000 predicciones).
- El driver da el mismo puntaje que jugar con la semilla, se recupera de
  compromisos y respuestas perdidas, y nunca recibe un valor que se use más de
  15 ticks después de lo comprometido (contra un árbitro de referencia y contra
  el árbitro real).
- Vistas sin semilla, rendición, intento único con rotación de token, topes,
  tope de ticks, vencimiento, reinicio sin caché, depósito on-chain al abrir,
  rutas HTTP (200/400/409) y rutas BYO.
- `npm run check` y el e2e de pago del 1v1.

## Qué falta

- PR 2: web, SDK, MCP, estrategias y agentes de la casa saben jugar en vivo
  (todavía apagado).
- PR 3: el interruptor (`RULES_V.flappy = 2`) y la publicación en npm, con OK del dueño.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 4: Esperar CI en verde**

Los dos checks (`check (tipos + lint + formato + tests + selftest)` y `Contrato (forge test + e2e)`) tienen que quedar en verde. El merge lo hace el dueño desde GitHub.

---

## Corrección posterior: el azar en vivo sale de un secreto (2026-09-18)

La revisión independiente del PR #28 encontró que `SeededSource` (Tarea 2)
revelaba la salida cruda de `mulberry32(seed)`, y la semilla es de 32 bits: con
el primer valor revelado se recuperaba por fuerza bruta en unos 3 segundos
(reproducido: 2^31 semillas en 3,15 s, dos candidatas, y el segundo valor elige
la correcta). El commit `46a0f1e` lo corrige sobre lo ya implementado:

- `packages/game-sdk/src/live.ts`: `SecretSource(secreto)` reemplaza a
  `SeededSource(seed)`. El valor `i` es SHA-256(secreto ‖ i como uint32
  big-endian), primeros 4 bytes sobre 2^32, con `@noble/hashes` (nueva
  dependencia del game-sdk; ya estaba instalada por viem). `liveSecretHash`
  da el hash que se publica.
- `packages/game-sdk/src/flappy-live.ts`: `verifyFlappyLive(secreto, replay)`.
- `apps/server/src/matchmaking.ts`: `Match.liveSecret` (32 bytes de
  `randomBytes`) al crear una partida en vivo, incluidos los desafíos. `view()`
  y `publicReplay` publican `secretHash` desde el emparejamiento y `secret` al
  decidir, y no muestran la semilla en un juego en vivo.
- `apps/server/src/live.ts`: el motor del árbitro usa `SecretSource`, y una
  partida en vivo sin secreto se rechaza.
- Tests: `SecretSource` contra el SHA-256 de `node:crypto`, secretos mal
  formados, `liveSecretHash`, `verifyFlappyLive`, el driver con secretos, "ni el
  secreto ni la semilla aparecen antes de decidir", "lo revelado sale del
  secreto", y las vistas con `secretHash`/`secret`.
