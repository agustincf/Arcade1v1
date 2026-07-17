# Juegos v2 (Snake + Racing) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snake gana una moneda que vence (+3, alarga) y Racing gana salto, vallas saltables y monedas — con versión de reglas por juego, rechazo claro para clientes viejos y todo el ecosistema (estrategias, UIs, visor, i18n, docs, npm) actualizado.

**Architecture:** Los motores deterministas de `packages/game-sdk` son la única fuente de reglas (web, árbitro, estrategias y visor los comparten). Cada motor v2 exporta su versión (`SNAKE_RULES_V` / `RACING_RULES_V`); un mapa `RULES_V` nuevo en el game-sdk las agrega; el árbitro rechaza replays/partidas de otra versión con error explícito ANTES de re-simular. Corte seco: no se mantiene el motor v1.

**Tech Stack:** TypeScript monorepo (npm workspaces), `node --import tsx --test` (node:test + assert), Next 16 (usa `proxy.ts`), canvas 2D, viem.

**Spec:** `docs/superpowers/specs/2026-07-17-juegos-v2-snake-racing-design.md`

## Global Constraints

- Los nombres visibles de los juegos NO cambian (nada de "Racing+", "Snake 2"); los ids `snake` / `racing` tampoco.
- Determinismo total: misma semilla + mismos inputs en los mismos ticks ⇒ mismo resultado. Nada de `Date.now()`/`Math.random()` en motores/estrategias: solo el `rng` sembrado del motor.
- Los otros 4 juegos (2048, tetris, flappy, invaders) NO se tocan; sus reglas quedan v1.
- Nada on-chain cambia.
- i18n: TODA copy nueva va en los 4 idiomas (es, en, fr, hi) con ortografía completa.
- Comandos de test: un archivo puntual = `node --import tsx --test <ruta>`; todo = `npm test`; gate final = `npm run check` (typecheck + lint + format:check + test + selftest).
- Commits atómicos por tarea; mensajes en español estilo repo (`feat(game-sdk): …`), terminados en `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Snake v2 — moneda que vence (motor)

**Files:**
- Modify: `packages/game-sdk/src/snake.ts`
- Test: `packages/game-sdk/test/engines.test.ts` (agregar bloque al final)

**Interfaces:**
- Produces: `SNAKE_RULES_V = 2`, `COIN_VALUE = 3`, `COIN_LIFE_STEPS = 28`, `COIN_BLINK_STEPS = 8` (constantes exportadas); en `SnakeEngine`: `coin: { x: number; y: number } | null`, `coinSteps: number` (pasos de vida restantes), `coinBlinking(): boolean`; `ReplaySnake` gana `v?: number`. `verifySnake` no cambia de firma.

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `packages/game-sdk/test/engines.test.ts` (después del `for (const c of CASES)`), agregar:

```ts
// ------------------------- Snake v2: moneda que vence -------------------------
import {
  SNAKE_RULES_V,
  COIN_VALUE,
  COIN_LIFE_STEPS,
} from "@arcade1v1/game-sdk/snake";

test("snake v2: exporta la versión de reglas 2", () => {
  assert.equal(SNAKE_RULES_V, 2);
  assert.equal(COIN_VALUE, 3);
});

test("snake v2: la moneda aparece, y si nadie la come expira intacta a los N pasos", () => {
  // Jugador quieto (va derecho y wrapea): observamos el ciclo de vida de la
  // moneda contando PASOS (cambios de largo/posición de la cabeza).
  const g = new SnakeEngine(SEED);
  let sawCoin = false;
  let expiredAfter = -1;
  let bornAtStep = -1;
  let steps = 0;
  let prevHead = { ...g.body[0] };
  let prevCoin: { x: number; y: number } | null = null;
  let prevScore = 0;
  for (let t = 0; t < 4000 && !g.over && expiredAfter < 0; t++) {
    g.tick();
    const head = g.body[0];
    const stepped = head.x !== prevHead.x || head.y !== prevHead.y;
    if (stepped) steps += 1;
    prevHead = { ...head };
    if (g.coin && !prevCoin) {
      sawCoin = true;
      bornAtStep = steps;
    }
    if (!g.coin && prevCoin && g.score === prevScore) {
      expiredAfter = steps - bornAtStep; // desapareció sin sumar => expiró
    }
    prevCoin = g.coin ? { ...g.coin } : null;
    prevScore = g.score;
  }
  assert.ok(sawCoin, "en ~300 pasos tiene que aparecer al menos una moneda");
  assert.equal(expiredAfter, COIN_LIFE_STEPS, "la moneda vive exactamente COIN_LIFE_STEPS pasos");
});

test("snake v2: contabilidad — largo y puntaje cierran (fruta +1, moneda +3, ambas alargan)", () => {
  // score = frutas + 3*monedas ; largo = 3 + frutas + monedas
  // => monedas = (score - (largo - 3)) / 2, entero y >= 0 SIEMPRE.
  for (let seed = 1; seed <= 30; seed++) {
    const g = new SnakeEngine(seed);
    for (let t = 0; t < 3000 && !g.over; t++) g.tick();
    const grown = g.body.length - 3;
    const coins = (g.score - grown) / 2;
    assert.ok(Number.isInteger(coins) && coins >= 0, `seed ${seed}: score ${g.score} / largo ${g.body.length} inconsistentes`);
  }
});

test("snake v2: verify reproduce un replay que declara v", () => {
  const { score, replay } = playSnake(SEED);
  const withV = { ...(replay as object), v: SNAKE_RULES_V } as ReplaySnake;
  assert.equal(verifySnake(withV), score, "verify ignora el campo v y re-simula igual");
});
```

Nota: los imports nuevos van junto al import existente de snake al tope del archivo (fusionarlos en un solo `import { … } from "@arcade1v1/game-sdk/snake"`).

- [ ] **Step 2: Verificar que fallan**

Run: `node --import tsx --test packages/game-sdk/test/engines.test.ts`
Expected: FAIL — `SNAKE_RULES_V` no existe (error de import/compilación).

- [ ] **Step 3: Implementar la moneda en el motor**

En `packages/game-sdk/src/snake.ts`:

1. Constantes nuevas después de `export const SNAKE_DT = 1 / 60;`:

```ts
// ---- Reglas v2: la moneda que vence -----------------------------------------
// Vale más que la fruta pero desaparece sola: perseguirla es una DECISIÓN
// (desvío + más cuerpo = más riesgo). La vida se mide en PASOS de la víbora,
// así la ventana en celdas no cambia cuando el juego acelera.
export const SNAKE_RULES_V = 2;
export const COIN_VALUE = 3;
export const COIN_LIFE_STEPS = 28;
export const COIN_BLINK_STEPS = 8; // últimos pasos: la UI la hace parpadear
const COIN_CHANCE = 0.025; // probabilidad de aparición por paso sin moneda
```

2. Estado nuevo en la clase, junto a `food`:

```ts
  coin: Pt | null = null;
  coinSteps = 0; // pasos de vida que le quedan a la moneda
```

3. Método público para la UI (después de `moveEvery()`):

```ts
  /** ¿La moneda está por vencer? (la UI la dibuja parpadeando). */
  coinBlinking(): boolean {
    return this.coin !== null && this.coinSteps <= COIN_BLINK_STEPS;
  }
```

4. `spawnCoin()` privado (después de `spawnFood()`), sin pisar cuerpo ni fruta:

```ts
  private spawnCoin() {
    const empties: Pt[] = [];
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (this.body.some((s) => s.x === x && s.y === y)) continue;
        if (this.food.x === x && this.food.y === y) continue;
        empties.push({ x, y });
      }
    if (empties.length === 0) return;
    this.coin = empties[Math.floor(this.rng() * empties.length)];
    this.coinSteps = COIN_LIFE_STEPS;
  }
```

5. Reemplazar el cuerpo de `step()` COMPLETO por (mismo comienzo, cambia el final):

```ts
  private step() {
    this.dir = this.pendingDir;
    // Las paredes NO penalizan: la vibora reaparece del lado opuesto (wrap).
    const head = {
      x: (this.body[0].x + this.dir.x + GRID) % GRID,
      y: (this.body[0].y + this.dir.y + GRID) % GRID,
    };
    for (const s of this.body) {
      if (s.x === head.x && s.y === head.y) {
        this.over = true;
        return;
      }
    }
    this.body.unshift(head);
    const ateFood = head.x === this.food.x && head.y === this.food.y;
    const ateCoin = this.coin !== null && head.x === this.coin.x && head.y === this.coin.y;
    if (ateFood) {
      this.score += 1;
      this.spawnFood();
    }
    if (ateCoin) {
      this.score += COIN_VALUE;
      this.coin = null;
    }
    // Fruta y moneda alargan por igual: comer nunca es gratis.
    if (!ateFood && !ateCoin) this.body.pop();

    // Vida y aparición de la moneda — SIEMPRE en este orden y con el mismo
    // consumo de rng, para que el árbitro re-simule idéntico.
    if (this.coin) {
      this.coinSteps -= 1;
      if (this.coinSteps <= 0) this.coin = null;
    } else if (this.rng() < COIN_CHANCE) {
      this.spawnCoin();
    }
  }
```

6. `ReplaySnake` gana el campo de versión:

```ts
export interface ReplaySnake {
  seed: number;
  ticks: number;
  inputs: { t: number; a: SnakeAction }[];
  /** Versión de reglas con la que se jugó (v2+ la declaran; ausente = v1). */
  v?: number;
}
```

- [ ] **Step 4: Verificar que pasan (los nuevos Y los 4 de snake preexistentes)**

Run: `node --import tsx --test packages/game-sdk/test/engines.test.ts`
Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/snake.ts packages/game-sdk/test/engines.test.ts
git commit -m "feat(game-sdk): Snake v2 — moneda que vence (+3, alarga, 28 pasos)"
```

---

### Task 2: Racing v2 — salto, vallas y monedas (motor)

**Files:**
- Modify: `packages/game-sdk/src/racing.ts`
- Test: `packages/game-sdk/test/engines.test.ts` (agregar bloque al final)

**Interfaces:**
- Produces: `RACING_RULES_V = 2`, `JUMP_TICKS = 30`, `JUMP_COOLDOWN = 10` (exportadas); `RaceAction = "l" | "r" | "j"`; `Obstacle` gana `jumpable: boolean`; en `RacingEngine`: `jump()`, `get airborne(): boolean`, `jumpProgress(): number` (0..1 para dibujar el arco), `coins: { lane: number; y: number; taken: boolean }[]`, `passedCount: number`; `ReplayRacing` gana `v?: number`; `verifyRacing` procesa `"j"`.

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `packages/game-sdk/test/engines.test.ts`:

```ts
// --------------------- Racing v2: salto, vallas y monedas ---------------------
// (RACING_RULES_V y JUMP_TICKS se agregan al import de racing ya existente al
// tope del archivo; RACING_DT ya está importado — usarlo directo.)

test("racing v2: exporta la versión de reglas 2 y acepta la acción j", () => {
  assert.equal(RACING_RULES_V, 2);
  const g = new RacingEngine(SEED);
  g.jump();
  assert.ok(g.airborne, "tras jump() el auto está en el aire");
  assert.ok(g.jumpProgress() > 0 && g.jumpProgress() <= 1);
});

test("racing v2: en el aire no se cambia de carril (saltar compromete)", () => {
  const g = new RacingEngine(SEED);
  g.jump();
  const before = g.carLane;
  g.moveLeft();
  g.moveRight();
  assert.equal(g.carLane, before, "los cambios de carril se ignoran en el aire");
});

test("racing v2: saltar una valla salva; sin saltar, mata", () => {
  // Buscamos una semilla donde, jugando quieto, la muerte llega por una VALLA
  // (jumpable) en el carril del auto. Después re-jugamos igual pero saltando
  // justo antes: el motor tiene que dejarlo vivo más tiempo.
  const CAR_Y_TEST = 480 - 80;
  let found = false;
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const a = new RacingEngine(seed);
    let deathTick = -1;
    for (let t = 0; t < 3600 && !a.over; t++) {
      a.update(RACING_DT);
      if (a.over) deathTick = t;
    }
    if (deathTick < 0) continue;
    const killer = a.obstacles.find(
      (o) => o.lane === a.carLane && Math.abs(o.y - CAR_Y_TEST) < 60,
    );
    if (!killer || !killer.jumpable) continue;
    found = true;
    const b = new RacingEngine(seed);
    for (let t = 0; t < 3600 && !b.over; t++) {
      if (t === deathTick - Math.floor(JUMP_TICKS / 2)) b.jump();
      b.update(RACING_DT);
    }
    assert.ok(
      b.over === false || b.score > a.score,
      `seed ${seed}: saltando la valla debe sobrevivir más (a=${a.score}, b=${b.score})`,
    );
  }
  assert.ok(found, "en 60 semillas tiene que existir una muerte por valla jugando quieto");
});

test("racing v2: monedas suman puntaje pero NO velocidad (speed usa passedCount)", () => {
  // Jugador que barre carriles (para pisar filas de monedas). El test solo
  // discrimina si alguna corrida realmente tomó monedas (score > passedCount):
  // lo exigimos, y en TODAS validamos que la fórmula usa passedCount.
  let sawCoins = false;
  for (let seed = 1; seed <= 20; seed++) {
    const g = new RacingEngine(seed);
    for (let t = 0; t < 3600 && !g.over; t++) {
      if (t % 120 === 0) {
        if ((t / 120) % 2 === 0) g.moveRight();
        else g.moveLeft();
      }
      g.update(RACING_DT);
    }
    if (g.score > g.passedCount) sawCoins = true;
    assert.ok(g.score >= g.passedCount, "score = obstáculos pasados + monedas");
    const expected = Math.min(480, 190 + Math.floor(g.elapsedMs / 8000) * 35 + g.passedCount * 2);
    assert.equal(g.speed(), expected, `seed ${seed}: la velocidad escala con passedCount, no con score`);
  }
  assert.ok(sawCoins, "en 20 semillas alguna corrida debe haber tomado monedas (si no, el test no prueba nada)");
});

test("racing v2: verify procesa saltos y reproduce el puntaje", () => {
  // Un run con saltos periódicos: verify debe re-simular idéntico.
  const g = new RacingEngine(SEED);
  const inputs: { t: number; a: "l" | "r" | "j" }[] = [];
  let t = 0;
  while (!g.over && t < 3600) {
    if (t % 90 === 0) {
      g.jump();
      inputs.push({ t, a: "j" });
    }
    g.update(RACING_DT);
    t++;
  }
  const replay = { seed: SEED, ticks: t, inputs, v: RACING_RULES_V };
  assert.equal(verifyRacing(replay), g.score);
});
```

(Imports nuevos: fusionar con el import existente de racing al tope.)

- [ ] **Step 2: Verificar que fallan**

Run: `node --import tsx --test packages/game-sdk/test/engines.test.ts`
Expected: FAIL — `RACING_RULES_V` no existe.

- [ ] **Step 3: Implementar salto, vallas y monedas**

En `packages/game-sdk/src/racing.ts`:

1. Constantes nuevas después de `const OBST_H = 44;`:

```ts
// ---- Reglas v2: salto, vallas saltables y monedas ---------------------------
// Saltar COMPROMETE: en el aire no se cambia de carril, y al aterrizar hay un
// cooldown. Las vallas (jumpable) se esquivan O se saltan; los sólidos, solo
// esquivar. Las monedas suman puntaje pero NO velocidad (passedCount manda).
export const RACING_RULES_V = 2;
export const JUMP_TICKS = 30; // ~0,5 s en el aire a 60 ticks/s
export const JUMP_COOLDOWN = 10; // ticks tras aterrizar antes de re-saltar
const COIN_ROW_CHANCE = 0.35; // prob. de fila de monedas por spawn simple
const COIN_GAP_Y = 52; // separación vertical entre monedas de una fila
```

2. `Obstacle` gana `jumpable`:

```ts
export interface Obstacle {
  lane: number;
  y: number;
  kind: number;
  jumpable: boolean; // valla/bache bajo: se salta o se esquiva
  passed: boolean;
}
```

3. Estado nuevo en la clase (junto a `obstacles`) y campos privados (junto a `lastFree`):

```ts
  coins: { lane: number; y: number; taken: boolean }[] = [];
  passedCount = 0; // obstáculos superados: SOLO esto acelera el juego
```

```ts
  private jumpTicks = 0;
  private jumpCooldown = 0;
  private lastWallJump = false;
```

4. API del salto (después de `moveRight()`), y bloquear carril en el aire:

```ts
  jump() {
    if (this.over || this.jumpTicks > 0 || this.jumpCooldown > 0) return;
    this.jumpTicks = JUMP_TICKS;
  }

  get airborne(): boolean {
    return this.jumpTicks > 0;
  }

  /** 0..1: qué tan avanzado va el salto (para dibujar el arco). */
  jumpProgress(): number {
    return this.airborne ? 1 - this.jumpTicks / JUMP_TICKS : 0;
  }
```

`moveLeft`/`moveRight`: agregar la condición de aire al guard existente:

```ts
  moveLeft() {
    if (this.over || this.airborne) return;
    if (this.carLane > 0) this.carLane -= 1;
  }

  moveRight() {
    if (this.over || this.airborne) return;
    if (this.carLane < LANES - 1) this.carLane += 1;
  }
```

5. `speed()` pasa a usar `passedCount` (la fórmula es la de siempre, cambiando `score`):

```ts
  speed(): number {
    return Math.min(480, 190 + this.level() * 35 + this.passedCount * 2);
  }
```

6. `addObstacle` recibe `jumpable` y `spawn()` se reemplaza COMPLETO:

```ts
  private addObstacle(lane: number, jumpable: boolean) {
    this.obstacles.push({
      lane,
      y: -OBST_H,
      kind: Math.floor(this.rng() * 3),
      jumpable,
      passed: false,
    });
  }

  private spawn() {
    const lvl = this.level();
    // Proporción de vallas: sube con el nivel (25% -> 45%).
    const jumpChance = Math.min(0.45, 0.25 + lvl * 0.05);
    const doubleChance = Math.min(0.5, 0.14 + lvl * 0.06);
    if (this.rng() < doubleChance) {
      let free = Math.floor(this.rng() * LANES);
      if (free === this.lastFree) free = (free + 1) % LANES;
      this.lastFree = free;
      this.lastLane = -1;
      // Pared con escape SALTABLE: la única salida es saltar en el carril
      // correcto. Solo desde el nivel 2 y NUNCA dos paredes-salto seguidas:
      // el cooldown del salto no llega a recargarse entre filas consecutivas.
      const wallJump =
        lvl >= 2 && !this.lastWallJump && this.rng() < Math.min(0.4, (lvl - 1) * 0.08);
      for (let lane = 0; lane < LANES; lane++) {
        if (lane !== free) this.addObstacle(lane, this.rng() < jumpChance);
        else if (wallJump) this.addObstacle(lane, true);
      }
      this.lastWallJump = wallJump;
    } else {
      let lane = Math.floor(this.rng() * LANES);
      if (lane === this.lastLane) lane = (lane + 1) % LANES;
      this.lastLane = lane;
      this.lastFree = -1;
      this.addObstacle(lane, this.rng() < jumpChance);
      this.lastWallJump = false;
      // A veces, una fila de 3-5 monedas en OTRO carril: la jugada de riesgo
      // emerge sola cuando filas siguientes le cruzan una valla.
      if (this.rng() < COIN_ROW_CHANCE) {
        let coinLane = Math.floor(this.rng() * LANES);
        if (coinLane === lane) coinLane = (coinLane + 1) % LANES;
        const n = 3 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) {
          this.coins.push({ lane: coinLane, y: -OBST_H - i * COIN_GAP_Y, taken: false });
        }
      }
    }
  }
```

7. `update(dt)` — insertar el avance del salto al inicio (tras el guard de `over`), mover/recoger monedas junto a los obstáculos, y sumar `passedCount`. Cuerpo completo nuevo:

```ts
  update(dt: number) {
    if (this.over) return;
    this.elapsedMs += dt * 1000;

    // Arco del salto y cooldown de aterrizaje (por tick, determinista).
    if (this.jumpTicks > 0) {
      this.jumpTicks -= 1;
      if (this.jumpTicks === 0) this.jumpCooldown = JUMP_COOLDOWN;
    } else if (this.jumpCooldown > 0) {
      this.jumpCooldown -= 1;
    }

    const v = this.speed();
    this.roadOffset = (this.roadOffset + v * dt) % 40;

    for (const o of this.obstacles) o.y += v * dt;
    for (const c of this.coins) c.y += v * dt;

    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval()) {
      this.spawnTimer = 0;
      this.spawn();
    }

    // Monedas: se recogen al pasar por la banda del auto (también en el aire:
    // habilita la jugada "junto todo y salto la valla del final").
    for (const c of this.coins) {
      if (!c.taken && c.lane === this.carLane && Math.abs(c.y - CAR_Y) < CAR_H / 2) {
        c.taken = true;
        this.score += 1;
      }
    }
    this.coins = this.coins.filter((c) => !c.taken && c.y < HEIGHT + OBST_H);

    for (const o of this.obstacles) {
      const overlaps =
        o.lane === this.carLane && Math.abs(o.y - CAR_Y) < OBST_H / 2 + CAR_H / 2 - 8;
      // Una valla NO choca si el auto está en el aire; un sólido choca siempre.
      if (overlaps && !(o.jumpable && this.airborne)) {
        this.over = true;
        return;
      }
      if (!o.passed && o.y > CAR_Y + CAR_H / 2) {
        o.passed = true;
        this.score += 1;
        this.passedCount += 1;
      }
    }

    this.obstacles = this.obstacles.filter((o) => o.y < HEIGHT + OBST_H);
  }
```

8. Tipos/verify al final del archivo:

```ts
export type RaceAction = "l" | "r" | "j";

export interface ReplayRacing {
  seed: number;
  ticks: number;
  inputs: { t: number; a: RaceAction }[];
  /** Versión de reglas con la que se jugó (v2+ la declaran; ausente = v1). */
  v?: number;
}

/** ANTI-TRAMPA: re-simula el replay con dt fijo y devuelve el puntaje real. */
export function verifyRacing(r: ReplayRacing): number {
  const g = new RacingEngine(r.seed);
  const byTick = groupByTick(r.inputs);
  for (let t = 0; t < r.ticks; t++) {
    const acts = byTick.get(t);
    if (acts) {
      for (const a of acts) {
        if (a === "l") g.moveLeft();
        else if (a === "r") g.moveRight();
        else g.jump();
      }
    }
    g.update(RACING_DT);
    if (g.over) break;
  }
  return g.score;
}
```

- [ ] **Step 4: Verificar que pasan (nuevos + los 4 de racing preexistentes)**

Run: `node --import tsx --test packages/game-sdk/test/engines.test.ts`
Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/racing.ts packages/game-sdk/test/engines.test.ts
git commit -m "feat(game-sdk): Racing v2 — salto comprometido, vallas saltables y monedas"
```

---

### Task 3: Racing v2 — el generador nunca crea situaciones imposibles

**Files:**
- Create: `packages/game-sdk/test/racing-fairness.test.ts`

**Interfaces:**
- Consumes: `RacingEngine`, `RACING_DT`, `JUMP_TICKS`, `RACING_CONST` de Task 2.

- [ ] **Step 1: Escribir el test de invariantes + oráculo (falla si el generador es injusto)**

Crear `packages/game-sdk/test/racing-fairness.test.ts`:

```ts
// GARANTÍA DE SALIDA del generador de Racing v2, en dos capas:
//   (1) INVARIANTE por construcción: ninguna "fila" de spawn bloquea los 3
//       carriles con sólidos, y nunca hay dos paredes-salto consecutivas
//       (el cooldown del salto no recarga entre filas).
//   (2) ORÁCULO: una estrategia con visión perfecta y reglas simples debe
//       sobrevivir un mínimo decente en TODAS las semillas. Si el generador
//       creara algo imposible, el oráculo muere al instante y esto se pone rojo.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RacingEngine,
  RACING_DT,
  RACING_CONST,
} from "@arcade1v1/game-sdk/racing";

const CAR_Y = RACING_CONST.HEIGHT - 80;
const SEEDS = 200;

test("racing v2: cada fila de spawn deja una salida (libre o valla) y no hay dos paredes-salto seguidas", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = new RacingEngine(seed);
    let prevWallWasJump = false;
    let sawRowLastTick = false; // procesar cada fila UNA sola vez (borde de subida)
    for (let t = 0; t < 7200; t++) {
      g.update(RACING_DT);
      if (g.over) break;
      // Los obstáculos recién spawneados siguen arriba de todo (y ≈ -OBST_H).
      const news = g.obstacles.filter((o) => o.y <= -RACING_CONST.OBST_H + 20);
      const isRow = news.length > 0;
      if (isRow && !sawRowLastTick) {
        const solidLanes = new Set(news.filter((o) => !o.jumpable).map((o) => o.lane));
        assert.ok(
          solidLanes.size < RACING_CONST.LANES,
          `seed ${seed} t=${t}: fila con los ${RACING_CONST.LANES} carriles sólidos (sin salida)`,
        );
        // Una fila de 3 solo existe cuando el "escape" es una valla (pared-salto):
        // el spawn de pared normal pone 2 obstáculos y deja el carril libre vacío.
        const isWallJump = news.length === RACING_CONST.LANES;
        if (news.length >= RACING_CONST.LANES - 1) {
          assert.ok(
            !(prevWallWasJump && isWallJump),
            `seed ${seed} t=${t}: dos paredes-salto consecutivas`,
          );
          prevWallWasJump = isWallJump;
        } else {
          prevWallWasJump = false;
        }
      }
      sawRowLastTick = isRow;
    }
  }
});

test("racing v2: un oráculo simple sobrevive un mínimo razonable en todas las semillas", () => {
  const survivals: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = new RacingEngine(seed);
    let t = 0;
    for (; t < 3600 && !g.over; t++) {
      const near = (lane: number, solidOnly: boolean) =>
        g.obstacles.some(
          (o) =>
            o.lane === lane &&
            (!solidOnly || !o.jumpable) &&
            o.y > CAR_Y - 240 &&
            o.y < CAR_Y + RACING_CONST.CAR_H,
        );
      if (!g.airborne && near(g.carLane, false)) {
        const options = [g.carLane - 1, g.carLane + 1].filter(
          (l) => l >= 0 && l < RACING_CONST.LANES && !near(l, false),
        );
        if (options.length > 0) {
          if (options[0] < g.carLane) g.moveLeft();
          else g.moveRight();
        } else {
          // Sin carril limpio: si lo que viene en el mío es valla, saltar a tiempo.
          const threat = g.obstacles
            .filter((o) => o.lane === g.carLane && o.y < CAR_Y && o.y > CAR_Y - 240)
            .sort((a, b) => b.y - a.y)[0];
          if (threat?.jumpable && CAR_Y - threat.y < 120) g.jump();
          else {
            // Valla en un vecino es mejor que sólido en el mío.
            const jumpableSide = [g.carLane - 1, g.carLane + 1].filter(
              (l) => l >= 0 && l < RACING_CONST.LANES && !near(l, true),
            );
            if (jumpableSide.length > 0) {
              if (jumpableSide[0] < g.carLane) g.moveLeft();
              else g.moveRight();
            }
          }
        }
      }
      g.update(RACING_DT);
    }
    survivals.push(t);
  }
  const min = Math.min(...survivals);
  const sorted = [...survivals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Un generador imposible mata al oráculo en < 5 s. Pisos generosos anti-flaky.
  assert.ok(min >= 15 * 60, `mínimo de supervivencia muy bajo: ${(min / 60).toFixed(1)} s`);
  assert.ok(median >= 45 * 60, `mediana de supervivencia muy baja: ${(median / 60).toFixed(1)} s`);
});
```

- [ ] **Step 2: Correr y calibrar**

Run: `node --import tsx --test packages/game-sdk/test/racing-fairness.test.ts`
Expected: PASS. Si el oráculo no llega a los pisos, ajustar EN EL MOTOR (no en el test): subir `JUMP_TICKS`→persistencia del salto, bajar `wallJump` chance, o subir la distancia de mirada del oráculo a 280 — y anotar el valor final en la spec.

- [ ] **Step 3: Commit**

```bash
git add packages/game-sdk/test/racing-fairness.test.ts
git commit -m "test(game-sdk): Racing v2 — invariantes de salida garantizada + oráculo"
```

---

### Task 4: RULES_V + rechazo claro en el árbitro

**Files:**
- Create: `packages/game-sdk/src/rules.ts`
- Modify: `packages/game-sdk/package.json` (agregar export `./rules`)
- Modify: `apps/server/src/matchmaking.ts`
- Test: `apps/server/test/rules-version.test.ts` (nuevo)

**Interfaces:**
- Produces: `RULES_V: Record<string, number>` en `@arcade1v1/game-sdk/rules`; `Match.rulesV?: number`; `MatchView.rulesV?: number` (lado server). El mensaje de rechazo SIEMPRE matchea `/rules version mismatch/` y menciona `@arcade1v1/mcp`.

- [ ] **Step 1: Crear `packages/game-sdk/src/rules.ts`**

```ts
// Versión de REGLAS de cada juego. La fuente de verdad vive en cada motor
// (SNAKE_RULES_V, RACING_RULES_V…): acá solo se agregan en un mapa para el
// árbitro y los SDKs. Si un juego no figura o no exporta versión, es v1.
// Al evolucionar un juego NUNCA se lo renombra: cambia su versión, no su id.
import { SNAKE_RULES_V } from "./snake";
import { RACING_RULES_V } from "./racing";

export const RULES_V: Record<string, number> = {
  "2048": 1,
  tetris: 1,
  flappy: 1,
  racing: RACING_RULES_V,
  snake: SNAKE_RULES_V,
  invaders: 1,
};
```

En `packages/game-sdk/package.json`, dentro de `"exports"`, agregar (después de `"./auth"`):

```json
    "./auth": "./src/auth.ts",
    "./rules": "./src/rules.ts"
```

- [ ] **Step 2: Escribir el test del server que falla**

Crear `apps/server/test/rules-version.test.ts`:

```ts
// CORTE SECO con dignidad: un replay de reglas viejas (sin `v` o con otra
// versión) se rechaza ANTES de re-simular, con un error que dice claramente
// que hay que actualizar el paquete — nunca un "score mismatch" críptico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchmake, submitScore } from "../src/matchmaking.js";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { SnakeEngine, SNAKE_RULES_V, type ReplaySnake } from "@arcade1v1/game-sdk/snake";

const P1 = "0x1111111111111111111111111111111111111111";

function playQuietSnake(seed: number): { score: number; replay: ReplaySnake } {
  const g = new SnakeEngine(seed);
  let t = 0;
  while (!g.over && t < 2000) {
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs: [], v: SNAKE_RULES_V } };
}

test("árbitro: replay sin versión (cliente viejo) => error claro de actualización", async () => {
  const m = await matchmake("snake", 0, P1);
  const { score, replay } = playQuietSnake(m.seed);
  const legacy = { seed: replay.seed, ticks: replay.ticks, inputs: replay.inputs }; // sin v
  await assert.rejects(
    () => submitScore(m.matchId, P1, score, legacy),
    (e: Error) => /rules version mismatch/.test(e.message) && /@arcade1v1\/mcp/.test(e.message),
  );
});

test("árbitro: replay con la versión vigente => se acepta y verifica", async () => {
  const m = await matchmake("snake", 0, P1);
  const { score, replay } = playQuietSnake(m.seed);
  const v = await submitScore(m.matchId, P1, score, replay);
  assert.equal(v.rulesV, RULES_V.snake, "la vista expone la versión de reglas de la partida");
  assert.equal(v.yourScore ?? v.scores[P1.toLowerCase()], score);
});
```

Run: `node --import tsx --test apps/server/test/rules-version.test.ts`
Expected: FAIL — `@arcade1v1/game-sdk/rules` no resuelve todavía en server o `rulesV` undefined.
(Si el primer test "pasa" por el guard de forma en vez del de versión, seguirá fallando el assert del mensaje: OK.)

- [ ] **Step 3: Implementar en `apps/server/src/matchmaking.ts`**

1. Import nuevo junto a los verify:

```ts
import { RULES_V } from "@arcade1v1/game-sdk/rules";
```

2. `interface Match`: agregar tras `seed: number;`:

```ts
  rulesV?: number; // versión de reglas con la que nació la partida
```

3. En `createWaiting` y `createChallenge`, en el literal del `Match`, tras `seed: randomSeed(),`:

```ts
    rulesV: RULES_V[game] ?? 1,
```

4. En `submitScore`, DENTRO del `try` anti-trampa, como PRIMERA validación (antes de `const verifier = …`):

```ts
    // VERSIÓN DE REGLAS (corte seco con dignidad): un cliente con el paquete
    // viejo simula OTRAS reglas — su replay jamás verificaría. Rechazamos
    // ANTES de re-simular, con el motivo real y el remedio, nunca un
    // "score mismatch" críptico. Cubre también partidas nacidas pre-deploy.
    const currentV = RULES_V[m.game] ?? 1;
    const matchV = m.rulesV ?? 1;
    const replayV = (replay as { v?: unknown })?.v ?? 1;
    if (matchV !== currentV || replayV !== currentV) {
      throw new Error(
        `rules version mismatch (match v${matchV}, replay v${String(replayV)}, arbiter v${currentV}) — update @arcade1v1/mcp`,
      );
    }
```

5. `interface MatchView`: agregar tras `seed: number;`:

```ts
  /** Versión de reglas del juego en esta partida (clientes nuevos la validan). */
  rulesV?: number;
```

6. En `view()`, en el literal `const v: MatchView`, tras `seed: m.seed,`:

```ts
    rulesV: m.rulesV,
```

- [ ] **Step 4: Verificar**

Run: `node --import tsx --test apps/server/test/rules-version.test.ts`
Expected: PASS (2 tests).
Run también: `npm test` — los tests preexistentes del server que envían replays de snake/racing sin `v` van a FALLAR con el mensaje nuevo: actualizarlos agregando `v: SNAKE_RULES_V` / `v: RACING_RULES_V` a sus replays (buscarlos con `grep -rn "ticks: \|inputs: \[\]" apps/server/test/`). Los de 2048/tetris/flappy/invaders no cambian (v1).

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/rules.ts packages/game-sdk/package.json apps/server/src/matchmaking.ts apps/server/test/
git commit -m "feat(server): versión de reglas por juego — rechazo claro a clientes desactualizados"
```

---

### Task 5: agent-sdk — validación proactiva de versión

**Files:**
- Modify: `packages/agent-sdk/src/client.ts` (MatchView + rulesV)
- Modify: `packages/agent-sdk/src/agent.ts` (guard en playAndSubmit)
- Test: `packages/agent-sdk/test/rules-guard.test.ts` (nuevo)

**Interfaces:**
- Consumes: `RULES_V` de Task 4; `MatchView.rulesV` del server.
- Produces: `MatchView.rulesV?: number` (lado cliente); `playAndSubmit` lanza `/rules version mismatch/` ANTES de jugar si el árbitro corre otra versión.

- [ ] **Step 1: Test que falla**

Crear `packages/agent-sdk/test/rules-guard.test.ts`:

```ts
// El agente NUEVO no juega 10 minutos para enterarse al final: valida la
// versión de reglas apenas matchmakea. (El agente viejo no conoce el campo;
// a él lo ataja el árbitro en submit con el error claro.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgent } from "../src/agent";
import { ArbiterClient } from "../src/client";
import { RULES_V } from "@arcade1v1/game-sdk/rules";

function fakeFetch(rulesV: number): typeof fetch {
  return (async (_url: unknown, _init?: unknown) =>
    new Response(
      JSON.stringify({
        matchId: "0x" + "ab".repeat(32),
        game: "snake",
        stake: 0,
        seed: 7,
        rulesV,
        status: "waiting",
        scores: {},
      }),
      { status: 200 },
    )) as typeof fetch;
}

test("playAndSubmit corta ANTES de jugar si el árbitro corre otras reglas", async () => {
  const client = new ArbiterClient("http://fake", { fetchImpl: fakeFetch(RULES_V.snake + 1) });
  const agent = createAgent({ client });
  await assert.rejects(
    () => agent.playAndSubmit({ game: "snake", stake: 0 }),
    (e: Error) => /rules version mismatch/.test(e.message) && /update/.test(e.message),
  );
});
```

Run: `node --import tsx --test packages/agent-sdk/test/rules-guard.test.ts`
Expected: FAIL — no rechaza (el guard no existe).

- [ ] **Step 2: Implementar**

En `packages/agent-sdk/src/client.ts`, `interface MatchView`, tras `seed: number;`:

```ts
  /** Versión de reglas del juego en esta partida (el SDK nuevo la valida). */
  rulesV?: number;
```

En `packages/agent-sdk/src/agent.ts`:

```ts
import { RULES_V } from "@arcade1v1/game-sdk/rules";
```

y en `playAndSubmit`, inmediatamente después de `const m = await matchmake(args.game, args.stake);`:

```ts
    // Guard de versión: si el árbitro corre otras reglas, avisar YA (antes de
    // jugar), con el remedio. El árbitro repite este control en el submit.
    const localV = RULES_V[args.game];
    if (m.rulesV !== undefined && localV !== undefined && m.rulesV !== localV) {
      throw new Error(
        `rules version mismatch for ${args.game}: arbiter v${m.rulesV}, SDK v${localV} — update @arcade1v1 packages`,
      );
    }
```

- [ ] **Step 3: Verificar**

Run: `node --import tsx --test packages/agent-sdk/test/rules-guard.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-sdk/src/client.ts packages/agent-sdk/src/agent.ts packages/agent-sdk/test/rules-guard.test.ts
git commit -m "feat(agent-sdk): validar la versión de reglas al matchmakear"
```

---

### Task 6: Estrategias v2 — saltan, codician monedas, replays con v

**Files:**
- Modify: `packages/strategies/src/racing.ts` (dodger)
- Modify: `packages/strategies/src/racing-weaver.ts`
- Modify: `packages/strategies/src/snake.ts` (greedy)
- Modify: `packages/strategies/src/snake-survivor.ts`
- Test: `packages/strategies/test/strategies-v2.test.ts` (nuevo)

**Interfaces:**
- Consumes: motores v2 (Tasks 1-2): `jump()`, `airborne`, `coins`, `Obstacle.jumpable`, `g.coin`, `g.coinSteps`, `RACING_RULES_V`, `SNAKE_RULES_V`.
- Produces: las 4 estrategias devuelven replays `{ seed, ticks, inputs, v: <RULES_V del juego> }` y ganan el param `coinGreed` (slider 0..1). Claves i18n nuevas: `strat.racing.dodger.coinGreed`, `strat.racing.weaver.coinGreed`, `strat.snake.greedy.coinGreed`, `strat.snake.survivor.coinGreed` (textos en Task 9).

- [ ] **Step 1: Test que falla**

Crear `packages/strategies/test/strategies-v2.test.ts`:

```ts
// Las estrategias incluidas son la VARA del benchmark: sus replays tienen que
// declarar la versión y verificar idéntico contra el motor v2. Y la codicia
// tiene que notarse: con coinGreed alto se ganan MÁS puntos promedio que con 0
// (en snake, donde la moneda vale 3 y perseguirla es decisión pura).
import { test } from "node:test";
import assert from "node:assert/strict";
import { getStrategy, defaultParams } from "../src/index";
import { verifyRacing, RACING_RULES_V, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { verifySnake, SNAKE_RULES_V, type ReplaySnake } from "@arcade1v1/game-sdk/snake";

const RACING_IDS = ["racing.dodger", "racing.weaver"];
const SNAKE_IDS = ["snake.greedy", "snake.survivor"];

for (const id of RACING_IDS) {
  test(`${id}: replay v2 válido que verifica idéntico`, () => {
    const def = getStrategy(id)!;
    const { score, replay } = def.play(1234, defaultParams(def));
    const r = replay as ReplayRacing;
    assert.equal(r.v, RACING_RULES_V, "el replay declara la versión de reglas");
    assert.equal(verifyRacing(r), score);
  });
}

for (const id of SNAKE_IDS) {
  test(`${id}: replay v2 válido que verifica idéntico`, () => {
    const def = getStrategy(id)!;
    const { score, replay } = def.play(1234, defaultParams(def));
    const r = replay as ReplaySnake;
    assert.equal(r.v, SNAKE_RULES_V, "el replay declara la versión de reglas");
    assert.equal(verifySnake(r), score);
  });
}

test("snake.greedy: la codicia rinde — coinGreed alto gana más que 0 en promedio", () => {
  const def = getStrategy("snake.greedy")!;
  let withGreed = 0;
  let without = 0;
  for (let seed = 1; seed <= 25; seed++) {
    withGreed += def.play(seed, { ...defaultParams(def), coinGreed: 0.8 }).score;
    without += def.play(seed, { ...defaultParams(def), coinGreed: 0 }).score;
  }
  assert.ok(
    withGreed > without,
    `coinGreed 0.8 (${withGreed}) debe superar a 0 (${without}) sobre 25 semillas`,
  );
});

test("racing.dodger: sabe saltar — sobrevive/puntúa más que ignorando vallas", () => {
  const def = getStrategy("racing.dodger")!;
  let total = 0;
  for (let seed = 1; seed <= 15; seed++) {
    total += def.play(seed, defaultParams(def)).score;
  }
  // Umbral suave: con vallas presentes desde el arranque (25%), una estrategia
  // que NO salta muere temprano seguido. 15 semillas deben promediar > 12.
  assert.ok(total / 15 > 12, `promedio muy bajo: ${(total / 15).toFixed(1)}`);
});
```

Run: `node --import tsx --test packages/strategies/test/strategies-v2.test.ts`
Expected: FAIL — los replays no tienen `v` y el dodger muere contra la primera valla obligada.

- [ ] **Step 2: Actualizar `racing.ts` (dodger)**

Reemplazar el archivo COMPLETO por:

```ts
// Estrategia de la Carrera: seguir en el carril hasta que un obstáculo entre
// en la distancia de mirada, y ahí esquivar hacia el carril libre más cercano
// (con preferencia configurable). v2: si no hay carril limpio y lo que viene
// es una VALLA, la salta con timing; con `coinGreed`, deriva hacia filas de
// monedas cuando el desvío es seguro. Histéresis con cooldown anti-zigzag.

import {
  RacingEngine,
  RACING_DT,
  RACING_CONST,
  RACING_RULES_V,
  LANES,
  type RaceAction,
} from "@arcade1v1/game-sdk/racing";
import type { StrategyDef, PlayResult } from "./types";
import { num, choice } from "./params";

const MAX_TICKS = 36_000;
const CAR_Y = RACING_CONST.HEIGHT - 80; // igual que el motor (CAR_Y privado)
const CHANGE_COOLDOWN = 8; // ticks mínimos entre cambios de carril
const JUMP_LEAD = 120; // px: saltar cuando la valla entra en esta distancia
const COIN_SIGHT = 360; // px: hasta dónde "ve" monedas la codicia

const PARAMS = [
  {
    key: "lookahead",
    kind: "slider" as const,
    min: 80,
    max: 240,
    step: 20,
    def: 160,
    labelKey: "strat.racing.dodger.lookahead",
  },
  {
    key: "preferredLane",
    kind: "choice" as const,
    options: ["left", "center", "right"],
    def: "center",
    labelKey: "strat.racing.dodger.preferredLane",
  },
  {
    key: "coinGreed",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.5,
    labelKey: "strat.racing.dodger.coinGreed",
  },
];

const LANE_INDEX: Record<string, number> = { left: 0, center: 1, right: 2 };

export const strategyRacingDodger: StrategyDef = {
  id: "racing.dodger",
  game: "racing",
  labelKey: "strat.racing.dodger.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const lookahead = num(params, PARAMS[0]);
    const homeLane = LANE_INDEX[choice(params, PARAMS[1])] ?? 1;
    const coinGreed = num(params, PARAMS[2]);
    const g = new RacingEngine(seed);
    const inputs: { t: number; a: RaceAction }[] = [];
    let cooldown = 0;

    /** ¿Hay peligro en `lane` dentro de `dist` px? (una valla también lo es:
     *  solo deja de serlo en el instante del salto). */
    const danger = (lane: number, dist: number, solidOnly = false): boolean =>
      g.obstacles.some(
        (o) =>
          o.lane === lane &&
          (!solidOnly || !o.jumpable) &&
          o.y > CAR_Y - dist &&
          o.y < CAR_Y + RACING_CONST.CAR_H,
      );

    /** Valla más cercana por delante en `lane`, o null. */
    const nextBarrier = (lane: number) =>
      g.obstacles
        .filter((o) => o.lane === lane && o.jumpable && o.y < CAR_Y && o.y > CAR_Y - lookahead * 2)
        .sort((a, b) => b.y - a.y)[0] ?? null;

    /** ¿Hay monedas sin tomar en `lane` a la vista? */
    const coinsAhead = (lane: number): boolean =>
      g.coins.some((c) => !c.taken && c.lane === lane && c.y < CAR_Y && c.y > CAR_Y - COIN_SIGHT);

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0 && !g.airborne) {
        // OJO determinismo: este loop hace SIEMPRE un g.update() por tick
        // (nunca `continue` antes del update) — si no, el replay que graba no
        // coincide con la re-simulación del árbitro.
        let target = g.carLane;
        let jumped = false;
        if (danger(g.carLane, lookahead)) {
          // Elegir el carril vecino seguro; si hay dos, el más cercano al
          // preferido (con margen extra para no esquivar hacia otro peligro).
          const candidates = [g.carLane - 1, g.carLane + 1].filter(
            (l) => l >= 0 && l < LANES && !danger(l, lookahead + 40),
          );
          if (candidates.length > 0) {
            candidates.sort((a, b) => Math.abs(a - homeLane) - Math.abs(b - homeLane));
            target = candidates[0];
          } else {
            // Sin carril limpio: si lo mío es valla, saltarla con timing.
            const b = nextBarrier(g.carLane);
            if (b && CAR_Y - b.y < JUMP_LEAD) {
              g.jump();
              inputs.push({ t, a: "j" });
              jumped = true;
            } else {
              // Sólido en el mío y vecinos con valla: mejor pararse en la valla
              // (saltable, la salto después) que en el sólido.
              const softSide = [g.carLane - 1, g.carLane + 1].filter(
                (l) => l >= 0 && l < LANES && !danger(l, lookahead + 40, true),
              );
              if (softSide.length > 0) target = softSide[0];
            }
          }
        } else if (coinGreed > 0) {
          // Codicia: derivar hacia un carril vecino con monedas si está limpio.
          const sides = [g.carLane - 1, g.carLane + 1].filter(
            (l) => l >= 0 && l < LANES && coinsAhead(l) && !danger(l, lookahead * (2 - coinGreed)),
          );
          if (sides.length > 0) target = sides[0];
          else if (
            g.carLane !== homeLane &&
            !coinsAhead(g.carLane) &&
            !danger(homeLane, lookahead * 1.5) &&
            !danger(g.carLane + Math.sign(homeLane - g.carLane), lookahead * 1.5)
          ) {
            // Volver de a un carril al preferido cuando el camino está despejado.
            target = g.carLane + Math.sign(homeLane - g.carLane);
          }
        }
        if (!jumped && target !== g.carLane) {
          const a: RaceAction = target < g.carLane ? "l" : "r";
          if (a === "l") g.moveLeft();
          else g.moveRight();
          inputs.push({ t, a });
          cooldown = CHANGE_COOLDOWN;
        }
      }
      g.update(RACING_DT);
    }

    return {
      score: g.score,
      replay: { seed, ticks: MAX_TICKS, inputs, v: RACING_RULES_V },
    };
  },
};
```

- [ ] **Step 3: Actualizar `racing-weaver.ts` (cambios mínimos)**

1. Import: agregar `RACING_RULES_V` y `type RaceAction` al import del motor.
2. Tipo de inputs: `const inputs: { t: number; a: RaceAction }[] = [];`
3. `clearance` ya cuenta vallas como obstáculo (elige carriles esquivando todo): queda igual. Agregar DESPUÉS del bloque `if (target !== g.carLane && …)` (dentro del `if (cooldown === 0)`), el salto de emergencia:

```ts
        // v2: si me quedé sin deriva y lo que tengo encima es una VALLA, saltar.
        if (!g.airborne && clearance(g.carLane) < DANGER) {
          const threat = g.obstacles
            .filter((o) => o.lane === g.carLane && o.y < CAR_Y + HIT_BAND)
            .sort((a, b) => b.y - a.y)[0];
          if (threat?.jumpable && CAR_Y - threat.y < 120) {
            g.jump();
            inputs.push({ t, a: "j" });
          }
        }
```

4. Sesgo de monedas en `eff` — reemplazar la definición de `eff` por:

```ts
        const coinBias = (lane: number): number =>
          coinGreed > 0 &&
          g.coins.some((c) => !c.taken && c.lane === lane && c.y < CAR_Y && c.y > CAR_Y - 300)
            ? coinGreed * 40
            : 0;
        const eff = (lane: number): number =>
          clearance(lane) - CENTER_BIAS * Math.abs(lane - CENTER) + coinBias(lane);
```

5. Param nuevo en `PARAMS` (después de boldness) + su lectura:

```ts
  {
    key: "coinGreed",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.4,
    labelKey: "strat.racing.weaver.coinGreed",
  },
```

```ts
    const coinGreed = num(params, PARAMS[1]);
```

6. Return con versión: `replay: { seed, ticks: MAX_TICKS, inputs, v: RACING_RULES_V }`.

- [ ] **Step 4: Actualizar `snake.ts` (greedy) y `snake-survivor.ts`**

En ambos, el patrón es el mismo (cambios mínimos):

1. Import: agregar `SNAKE_RULES_V` al import del motor.
2. Param `coinGreed` al final de `PARAMS` (def 0.5 en greedy, 0.35 en survivor, mismo shape slider 0..1 step 0.1, labelKey `strat.snake.greedy.coinGreed` / `strat.snake.survivor.coinGreed`) y su lectura con `num(params, PARAMS[<i>])`.
3. Objetivo dinámico — en el loop, ANTES del `for (const a of ACTS)`, elegir blanco:

```ts
      // v2: perseguir la moneda solo si es alcanzable ANTES de que venza y
      // está dentro del radio que la codicia habilita.
      const head0 = g.body[0];
      const coinDist = g.coin ? wrapDist(head0.x, head0.y, g.coin.x, g.coin.y) : Infinity;
      const chaseCoin =
        g.coin !== null && coinDist <= g.coinSteps && coinDist <= coinGreed * GRID;
      const target = chaseCoin ? g.coin! : g.food;
```

4. Dentro del loop de acciones, reemplazar la distancia a `g.food` por `target`:
   - greedy: `const dist = wrapDist(nx, ny, target.x, target.y);`
   - survivor: `const dist = wrapDist(nx, ny, target.x, target.y);`
5. Return con versión: `replay: { seed, ticks: MAX_TICKS, inputs, v: SNAKE_RULES_V }`.

- [ ] **Step 5: Verificar**

Run: `node --import tsx --test packages/strategies/test/strategies-v2.test.ts`
Expected: PASS (6 tests). Si `racing.dodger` no llega al umbral, subir `JUMP_LEAD` a 140 o bajar `CHANGE_COOLDOWN` del salto — el motor no se toca desde acá.
Run: `npm test` — si algún test preexistente de estrategias/servidor usa replays de snake/racing sin `v`, agregárselo (igual que en Task 4).

- [ ] **Step 6: Commit**

```bash
git add packages/strategies/src/ packages/strategies/test/
git commit -m "feat(strategies): las 4 estrategias de Snake/Racing aprenden monedas y salto (v2)"
```

---

### Task 7: Script de brecha — el criterio de éxito medible

**Files:**
- Create: `scripts/gap-check.mjs`

**Interfaces:**
- Consumes: estrategias v2 (Task 6) vía `@arcade1v1/strategies`.

- [ ] **Step 1: Crear `scripts/gap-check.mjs`**

```js
#!/usr/bin/env node
// CRITERIO DE ÉXITO de juegos v2: la brecha entre la estrategia "trivial"
// (sin codicia) y la "planificadora" (codiciosa) debe ser CLARA. Si la brecha
// es ~0, las mecánicas nuevas no discriminan habilidad y hay que recalibrar.
// Uso: node --import tsx scripts/gap-check.mjs [semillas=200]
import { getStrategy, defaultParams } from "@arcade1v1/strategies";

const N = Number(process.argv[2] ?? 200);

function avg(id, overrides) {
  const def = getStrategy(id);
  let total = 0;
  for (let seed = 1; seed <= N; seed++) {
    total += def.play(seed, { ...defaultParams(def), ...overrides }).score;
  }
  return total / N;
}

function report(game, id, overrides) {
  const trivial = avg(id, { coinGreed: 0 });
  const planner = avg(id, overrides);
  const gap = trivial > 0 ? ((planner - trivial) / trivial) * 100 : Infinity;
  console.log(
    `${game.padEnd(8)} ${id.padEnd(16)} trivial=${trivial.toFixed(1)}  planificadora=${planner.toFixed(1)}  brecha=${gap.toFixed(1)}%`,
  );
  return gap;
}

console.log(`Semillas por corrida: ${N}\n`);
const gaps = [
  report("snake", "snake.greedy", { coinGreed: 0.8 }),
  report("racing", "racing.dodger", { coinGreed: 0.8 }),
];
const ok = gaps.every((g) => g >= 10);
console.log(ok ? "\nOK: brecha ≥ 10% en ambos juegos." : "\nATENCIÓN: brecha < 10% — recalibrar (COIN_CHANCE/COIN_VALUE o monedas de racing).");
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Correr y registrar**

Run: `node --import tsx scripts/gap-check.mjs 200` (tsx resuelve los paquetes TS del workspace)
Expected: exit 0 con brecha ≥ 10% en ambos. Anotar los números impresos en el commit message. Si falla, recalibrar constantes del MOTOR (p. ej. `COIN_CHANCE` 0.025→0.035 o `COIN_ROW_CHANCE` 0.35→0.45) y re-correr `npm test` + este script.

- [ ] **Step 3: Commit**

```bash
git add scripts/gap-check.mjs
git commit -m "feat(scripts): gap-check — mide la brecha trivial vs planificadora (criterio v2)"
```

---

### Task 8: UI web — Snake dibuja la moneda; Racing salta; replays declaran v

**Files:**
- Modify: `apps/web/app/games/snake/SnakeGame.tsx`
- Modify: `apps/web/app/games/racing/RacingGame.tsx`

**Interfaces:**
- Consumes: `coin`, `coinSteps`, `coinBlinking()`, `SNAKE_RULES_V`; `jump()`, `airborne`, `jumpProgress()`, `coins`, `Obstacle.jumpable`, `RACING_RULES_V`.
- Produces: replays con `v` desde la web; controles de salto (↑/Espacio/W, swipe up, botón central).

- [ ] **Step 1: SnakeGame.tsx**

1. Import: agregar `SNAKE_RULES_V` al import del motor.
2. En `draw()`, después del bloque de la comida y antes de la serpiente:

```ts
      // moneda (vale 3, vence): parpadea a ritmo de paso cuando está por irse
      if (eng.coin && (!eng.coinBlinking() || eng.coinSteps % 2 === 0)) {
        ctx.fillStyle = "#ffd23d";
        ctx.shadowColor = "#ffd23d";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(eng.coin.x * CELL + CELL / 2, eng.coin.y * CELL + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#8a6d00";
        ctx.font = "bold 10px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText("3", eng.coin.x * CELL + CELL / 2, eng.coin.y * CELL + CELL / 2 + 3.5);
        ctx.textAlign = "left";
      }
```

3. En el `onConfirm` del `GameOverScreen`, el replay declara la versión:

```ts
                replay: { seed, ticks: tickRef.current, inputs: inputs.current, v: SNAKE_RULES_V },
```

- [ ] **Step 2: RacingGame.tsx**

1. Import: agregar `RACING_RULES_V` al import del motor.
2. En el loop determinista, el drenaje de `pending` maneja `"j"`:

```ts
        while (pending.current.length) {
          const a = pending.current.shift()!;
          if (a === "l") eng.moveLeft();
          else if (a === "r") eng.moveRight();
          else eng.jump();
          inputs.current.push({ t: tickRef.current, a });
        }
```

3. Teclado — agregar salto al `onKey`:

```ts
      } else if (e.key === "ArrowUp" || e.key === " " || e.key === "w" || e.key === "W") {
        e.preventDefault();
        enqueue("j");
      }
```

4. Swipe up sobre el canvas — en el `div` contenedor del canvas agregar handlers análogos a los de SnakeGame:

```tsx
        onPointerDown={(e) => (touch.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          if (!touch.current) return;
          const dy = e.clientY - touch.current.y;
          touch.current = null;
          if (dy < -24) enqueue("j");
        }}
```

con el ref correspondiente junto a los otros refs: `const touch = useRef<{ x: number; y: number } | null>(null);` y `className` del canvas ganando `touch-none` (igual que Snake).

5. Botonera táctil: pasar el grid a 3 columnas con salto en el medio:

```tsx
        <div className="grid w-full max-w-[320px] grid-cols-3 gap-3">
          <button onClick={() => enqueue("l")} aria-label="Mover a la izquierda" className="btn3d btn3d--cyan !text-2xl">
            <span aria-hidden="true">◀</span>
          </button>
          <button onClick={() => enqueue("j")} aria-label="Saltar" className="btn3d btn3d--cyan !text-2xl">
            <span aria-hidden="true">⤒</span>
          </button>
          <button onClick={() => enqueue("r")} aria-label="Mover a la derecha" className="btn3d btn3d--cyan !text-2xl">
            <span aria-hidden="true">▶</span>
          </button>
        </div>
```

6. Render — `drawCar` gana un parámetro de salto (el cuerpo sube, la sombra queda en el piso). Firma y primeras líneas nuevas:

```ts
    function drawCar(cx: number, cy: number, scale: number, body: string, player = false, jumpArc = 0) {
      const lift = 26 * jumpArc * scale; // el cuerpo sube; la sombra NO
      const s = scale * (1 + 0.3 * jumpArc);
      const w = 42 * s;
      const h = 30 * s;
      const x = cx - w / 2;
      const y = cy - h / 2 - lift;
      // sombra (queda en el piso y se achica al despegar)
      ctx.fillStyle = `rgba(0,0,0,${0.35 - 0.18 * jumpArc})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy + (30 * scale) * 0.5, w * (0.55 - 0.15 * jumpArc), h * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
```

y TODO el resto del cuerpo del auto usa `s` en lugar de `scale` y la `y` ya corrida (el resto del método queda igual, reemplazando `scale` por `s`).

7. Obstáculos — en el bucle de dibujo, vallas distintas y por encima el auto saltando:

```ts
      const obs = [...eng.obstacles].sort((a, b) => a.y - b.y);
      for (const o of obs) {
        const sy = projY(o.y);
        if (sy < HORIZON - 2) continue;
        if (o.jumpable) {
          // valla baja con franjas amarillo/negro
          const sc = depthScale(sy);
          const w = 46 * sc;
          const h = 12 * sc;
          const bx = laneCenterAt(o.lane, sy) - w / 2;
          ctx.fillStyle = "#0a0510";
          ctx.fillRect(bx, sy - h, w, h);
          ctx.fillStyle = "#ffd23d";
          const stripe = w / 5;
          for (let i = 0; i < 5; i += 2) ctx.fillRect(bx + i * stripe, sy - h, stripe, h);
          ctx.fillStyle = "#0a0510";
          ctx.fillRect(bx, sy - h - 3 * sc, 3 * sc, h + 3 * sc);
          ctx.fillRect(bx + w - 3 * sc, sy - h - 3 * sc, 3 * sc, h + 3 * sc);
        } else {
          drawCar(laneCenterAt(o.lane, sy), sy, depthScale(sy), OBST_COLORS[o.kind]);
        }
      }
      // monedas
      for (const c of eng.coins) {
        if (c.taken) continue;
        const sy = projY(c.y);
        if (sy < HORIZON - 2) continue;
        const sc = depthScale(sy);
        ctx.fillStyle = "#ffd23d";
        ctx.shadowColor = "#ffd23d";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(laneCenterAt(c.lane, sy), sy - 8 * sc, 7 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // auto del jugador (con arco de salto)
      const psy = projY(eng.carY);
      const jumpArc = Math.sin(Math.PI * eng.jumpProgress());
      drawCar(laneCenterAt(eng.carLane, psy), psy, depthScale(psy), "#39ff7a", true, jumpArc);
```

(Esto REEMPLAZA los bloques actuales de obstáculos y auto del jugador.)

8. `sfx.move()` en `enqueue` queda igual (suena también al saltar — bien).
9. `onConfirm`: `replay: { seed, ticks: tickRef.current, inputs: inputs.current, v: RACING_RULES_V }`.

- [ ] **Step 3: Verificar a mano y con typecheck**

Run: `npm run typecheck:web`
Expected: PASS.
Run: `npm run web` y jugar Snake y Racing en `http://localhost:3000` (modo libre): moneda visible y parpadeando; salto con ↑/Espacio, swipe up y botón; vallas con franjas; recoger monedas suma.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/games/snake/SnakeGame.tsx apps/web/app/games/racing/RacingGame.tsx
git commit -m "feat(web): UI v2 — moneda de Snake y salto/vallas/monedas de Racing"
```

---

### Task 9: i18n — instrucciones nuevas, labels de estrategias y err.rulesVersion (4 idiomas)

**Files:**
- Modify: `apps/web/app/lib/i18n/es.ts`, `en.ts`, `fr.ts`, `hi.ts`
- Modify: `apps/web/app/game/[gameId]/match/page.tsx` (catch del envío)

**Interfaces:**
- Consumes: claves `strat.*.coinGreed` referenciadas en Task 6.
- Produces: claves `err.rulesVersion` + instrucciones actualizadas. El catch del submit distingue `/rules version mismatch/`.

- [ ] **Step 1: Reemplazar/agregar claves en los 4 archivos**

`es.ts` — reemplazar los valores existentes de estas claves y agregar las nuevas:

```ts
  "g.racing.instr":
    "Cambiá de carril y saltá las vallas rayadas. +1 por auto que dejás atrás y por moneda. ¡Cada vez más rápido!",
  "g.racing.hint": "← → carril · ↑ o Espacio para saltar · en el celu: botones o deslizá hacia arriba.",
  "g.snake.instr":
    "Usá las flechas (o deslizá) para comer y crecer. La moneda dorada vale 3, ¡pero desaparece rápido! No te muerdas la cola (los bordes dan la vuelta).",
  "err.rulesVersion":
    "Las reglas del juego se actualizaron mientras jugabas. Recargá la página y jugá de nuevo.",
  "strat.racing.dodger.coinGreed": "Codicia de monedas",
  "strat.racing.weaver.coinGreed": "Codicia de monedas",
  "strat.snake.greedy.coinGreed": "Codicia de monedas",
  "strat.snake.survivor.coinGreed": "Codicia de monedas",
```

`en.ts`:

```ts
  "g.racing.instr":
    "Switch lanes and jump the striped barriers. +1 per car you leave behind and per coin. It keeps speeding up!",
  "g.racing.hint": "← → lanes · ↑ or Space to jump · on mobile: buttons or swipe up.",
  "g.snake.instr":
    "Use the arrows (or swipe) to eat and grow. The golden coin is worth 3 — but it vanishes fast! Don't bite your tail (edges wrap around).",
  "err.rulesVersion":
    "The game rules were updated while you were playing. Reload the page and play again.",
  "strat.racing.dodger.coinGreed": "Coin greed",
  "strat.racing.weaver.coinGreed": "Coin greed",
  "strat.snake.greedy.coinGreed": "Coin greed",
  "strat.snake.survivor.coinGreed": "Coin greed",
```

`fr.ts`:

```ts
  "g.racing.instr":
    "Changez de voie et sautez les barrières rayées. +1 par voiture laissée derrière et par pièce. Ça accélère sans cesse !",
  "g.racing.hint": "← → voies · ↑ ou Espace pour sauter · sur mobile : boutons ou glissez vers le haut.",
  "g.snake.instr":
    "Utilisez les flèches (ou glissez) pour manger et grandir. La pièce dorée vaut 3 — mais elle disparaît vite ! Ne mordez pas votre queue (les bords se rejoignent).",
  "err.rulesVersion":
    "Les règles du jeu ont été mises à jour pendant que vous jouiez. Rechargez la page et rejouez.",
  "strat.racing.dodger.coinGreed": "Gourmandise de pièces",
  "strat.racing.weaver.coinGreed": "Gourmandise de pièces",
  "strat.snake.greedy.coinGreed": "Gourmandise de pièces",
  "strat.snake.survivor.coinGreed": "Gourmandise de pièces",
```

`hi.ts`:

```ts
  "g.racing.instr":
    "लेन बदलें और धारीदार बाधाओं के ऊपर से कूदें। हर पीछे छूटी कार और हर सिक्के पर +1। रफ़्तार बढ़ती जाती है!",
  "g.racing.hint": "← → लेन · कूदने के लिए ↑ या Space · मोबाइल पर: बटन या ऊपर स्वाइप करें।",
  "g.snake.instr":
    "तीरों (या स्वाइप) से खाएँ और बढ़ें। सुनहरा सिक्का 3 अंक का है — पर जल्दी गायब हो जाता है! अपनी पूँछ मत काटें (किनारे आपस में जुड़े हैं)।",
  "err.rulesVersion":
    "खेलते समय खेल के नियम अपडेट हो गए। पेज को फिर से लोड करें और दोबारा खेलें।",
  "strat.racing.dodger.coinGreed": "सिक्कों का लालच",
  "strat.racing.weaver.coinGreed": "सिक्कों का लालच",
  "strat.snake.greedy.coinGreed": "सिक्कों का लालच",
  "strat.snake.survivor.coinGreed": "सिक्कों का लालच",
```

Además, en los 4 idiomas revisar `game.racing.desc` (la card del catálogo): si describe "esquivá" a secas, sumar el salto en una frase corta (ej. es: "Esquivá el tráfico, saltá las vallas y juntá monedas. El que llega más lejos gana."). Mantener el NOMBRE tal cual.

- [ ] **Step 2: El envío de puntaje distingue el error de versión**

En `apps/web/app/game/[gameId]/match/page.tsx`, el `catch` del submit (el que hoy hace `setError("server")`, línea ~381) pasa a:

```ts
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/rules version mismatch/i.test(msg)) setError("rules");
      else if (devMode) simulate(score);
      else setError("server");
    } finally {
```

Ubicar dónde se renderiza el estado `error === "server"` (buscar con `grep -n '"server"' apps/web/app/game/\[gameId\]/match/page.tsx`) y agregar la variante `"rules"` en el MISMO patrón visual, con texto `t("err.rulesVersion")` y el botón de reintento recargando la página (`window.location.reload()`). Ajustar el tipo del estado de error si es un union literal (agregar `"rules"`).

- [ ] **Step 3: Verificar**

Run: `npm run typecheck:web && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/i18n/ "apps/web/app/game/[gameId]/match/page.tsx"
git commit -m "feat(web): i18n v2 en 4 idiomas + error claro de versión de reglas"
```

---

### Task 10: Visor de replays — dibuja y re-simula las reglas v2

**Files:**
- Modify: `apps/web/app/components/replay/render.ts`
- Modify: `apps/web/app/components/replay/ReplayPlayer.tsx`

**Interfaces:**
- Consumes: `coin`/`coinBlinking()` de Snake v2; `coins`/`jumpable`/`airborne`/`jumpProgress()` y acción `"j"` de Racing v2.

- [ ] **Step 1: `render.ts`**

1. `drawSnake` — después del bloque de comida:

```ts
  if (eng.coin && (!eng.coinBlinking() || eng.coinSteps % 2 === 0)) {
    ctx.fillStyle = "#ffd23d";
    ctx.beginPath();
    ctx.arc(eng.coin.x * CELL + CELL / 2, eng.coin.y * CELL + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
  }
```

2. `drawRacing` — reemplazar el bloque de obstáculos y auto por:

```ts
  // obstáculos: sólidos llenos; vallas = barra chata rayada
  for (const o of eng.obstacles) {
    if (o.jumpable) {
      const w = OBST_W;
      const h = OBST_H * 0.35;
      const bx = laneX(o.lane) - w / 2;
      ctx.fillStyle = "#0a0510";
      ctx.fillRect(bx, o.y - h / 2, w, h);
      ctx.fillStyle = "#ffd23d";
      const stripe = w / 5;
      for (let i = 0; i < 5; i += 2) ctx.fillRect(bx + i * stripe, o.y - h / 2, stripe, h);
    } else {
      ctx.fillStyle = OBST_COLORS[o.kind % OBST_COLORS.length];
      ctx.fillRect(laneX(o.lane) - OBST_W / 2, o.y - OBST_H / 2, OBST_W, OBST_H);
    }
  }
  // monedas
  ctx.fillStyle = "#ffd23d";
  for (const c of eng.coins) {
    if (c.taken) continue;
    ctx.beginPath();
    ctx.arc(laneX(c.lane), c.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // auto (se agranda al saltar)
  const jumpArc = Math.sin(Math.PI * eng.jumpProgress());
  const cw = CAR_W * (1 + 0.3 * jumpArc);
  const ch = CAR_H * (1 + 0.3 * jumpArc);
  ctx.fillStyle = "#39ff7a";
  ctx.fillRect(laneX(eng.carLane) - cw / 2, eng.carY - ch / 2, cw, ch);
  ctx.fillStyle = "#0a0518";
  ctx.fillRect(laneX(eng.carLane) - cw / 2 + 6, eng.carY - ch / 2 + 10, cw - 12, 16);
```

- [ ] **Step 2: `ReplayPlayer.tsx` — la rama de racing maneja `"j"`**

Donde hoy dice `if (a === "l") eng.moveLeft(); else eng.moveRight();` (líneas ~128-129), reemplazar por:

```ts
              if (a === "l") eng.moveLeft();
              else if (a === "r") eng.moveRight();
              else eng.jump();
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck:web`
Expected: PASS. A mano: abrir un replay del modo espectador y ver vallas/monedas.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/replay/
git commit -m "feat(web): el visor de replays entiende las reglas v2 de Snake y Racing"
```

---

### Task 11: Docs, catálogo y bump 0.2.0 de los 4 paquetes

**Files:**
- Modify: `packages/game-sdk/package.json`, `packages/strategies/package.json`, `packages/agent-sdk/package.json`, `apps/mcp/package.json` (version → `0.2.0`)
- Modify: `apps/mcp/src/server.ts` (version del McpServer → `"0.2.0"`)
- Modify: `packages/game-sdk/README.md`, `packages/strategies/README.md`, `packages/agent-sdk/README.md`, `apps/mcp/README.md`
- Verify: `apps/web/app/agents/content.ts`, `apps/web/app/agents/start/content.ts`, `apps/web/app/lib/games.ts`

**Interfaces:**
- Consumes: nada de código; solo lo publicado en Tasks 1-10.

- [ ] **Step 1: Versiones**

En los 4 `package.json`: `"version": "0.2.0"`. En `apps/mcp/src/server.ts`: `new McpServer({ name: "arcade1v1", version: "0.2.0" })`.

- [ ] **Step 2: READMEs**

`grep -n "racing\|snake" packages/*/README.md apps/mcp/README.md` y en cada mención de mecánicas, actualizar la frase. Agregar además en los 4 README, al final de la sección de juegos (o donde se listan), la nota:

```md
> **Rules v2 (July 2026):** Snake now spawns a fleeting golden coin (+3, it also
> grows you) and Racing adds a committed jump, jumpable barriers and coin rows.
> Replays must declare `v` — packages older than 0.2.0 are rejected by the
> arbiter with a clear `rules version mismatch` error. Update to `>=0.2.0`.
```

- [ ] **Step 3: Contenido de la web**

`grep -in "esquiv\|dodge\|racing\|snake" apps/web/app/agents/content.ts apps/web/app/agents/start/content.ts apps/web/app/lib/games.ts` — si alguna frase describe las mecánicas viejas ("solo esquivá", "comé la fruta"), actualizarla en los idiomas que el archivo maneje. Los NOMBRES de los juegos no se tocan.

- [ ] **Step 4: Verificar + commit**

Run: `npm run check`
Expected: PASS completo (typecheck + lint + format + tests + selftest).

```bash
git add packages/*/package.json packages/*/README.md apps/mcp/ apps/web/app/agents/ apps/web/app/lib/games.ts
git commit -m "docs+chore: nota de reglas v2 y bump 0.2.0 de game-sdk/strategies/agent-sdk/mcp"
```

---

### Task 12: Verificación final de la tanda

- [ ] **Step 1: Gate completo**

Run: `npm run check`
Expected: PASS. Si `format:check` protesta, correr `npm run format` y amendear.

- [ ] **Step 2: Criterio de éxito medible**

Run: `node --import tsx scripts/gap-check.mjs 200` (tsx resuelve los paquetes TS del workspace)
Expected: exit 0, brecha ≥ 10% en snake y racing. Registrar los números.

- [ ] **Step 3: Playtest manual (criterio 4 de la spec)**

`npm run web` + `npm run server`: jugar Racing en un viewport móvil (DevTools): saltar con botón y con swipe, juntar monedas, morir contra un sólido estando en el aire (debe matar), saltar una valla (debe salvar). Snake: comer moneda (+3 y crece), verla vencer parpadeando.

- [ ] **Step 4: Commit final si quedó algo suelto; NO pushear**

El push dispara auto-deploy (Vercel + Render): queda para la ventana de deploy coordinada con el dueño.

---

## Checklist de deploy (manual, coordinado con el dueño — NO es una tarea del plan)

1. Ventana tranquila; **no sembrar durante el deploy** (gotcha conocido).
2. `git push` → auto-deploy web (Vercel) + árbitro (Render) del mismo commit.
3. Publicar npm en orden: game-sdk → strategies → agent-sdk (`npm run release` en cada uno, script `scripts/publish-sdk.mjs`) → mcp (`npm publish` en `apps/mcp`, corre `prepublishOnly`).
4. Smoke E2E contra prod: partida de snake y de racing vía MCP/agent-sdk nuevo; y un submit con paquete viejo debe devolver `rules version mismatch`.
5. Avisar en la página de agentes/README si algo quedó desalineado.
