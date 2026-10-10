# Carrera en vivo, PR 1 (apagado) — plan de implementación

> **Para quien ejecute:** este plan lo ejecuto yo en la misma sesión, tarea por
> tarea (superpowers:executing-plans), sin subagentes: el dueño no los pidió.
> Los pasos usan casillas (`- [ ]`).

**Objetivo:** que todo el sistema sepa jugar Carrera en vivo, con el interruptor
apagado (`RULES_V.racing` sigue en 2), y que el modo en vivo deje de estar atado
a Flappy.

**Arquitectura:** una definición `LiveGame` por juego (motor, paso, azar que
consume, formato de las jugadas) y un núcleo genérico (driver, sesión,
verificación, árbitro) que la usa. Flappy y Carrera son las dos definiciones;
Flappy no cambia en el cable.

**Stack:** TypeScript, `node:test` con `tsx`, viem, Next (web).

**Spec:** [`docs/superpowers/specs/2026-10-10-carrera-en-vivo-design.md`](../specs/2026-10-10-carrera-en-vivo-design.md)

## Restricciones globales

- `RULES_V.racing` queda en **2** y `RACING_RULES_V` en **2**. Se agrega
  `LIVE_SINCE_RULES_V.racing = 3`. Los tests prenden Carrera en vivo con
  `RULES_V.racing = 3` al principio del archivo (cada archivo corre en su
  proceso).
- Flappy no cambia nada en el cable: `flaps` en la apertura y los compromisos,
  `{ ticks, flaps, v }` en el replay. Los tests actuales de Flappy pasan sin
  tocarlos.
- Carrera en vivo: **un valor por fila**; `LIVE_LEAD_TICKS = 15`; acciones
  `l`/`r`/`j`; **a lo sumo 3 por tick**; tope del intento
  `floor(ticks / 4) + 64` acciones.
- Con semilla, Carrera y sus estrategias dan exactamente lo mismo que hoy.
  Hashes de caracterización (calculados antes de tocar nada):
  - motor: `d62153c4531372e7a791dd5d9c969bac0dc4a5c56ed0fffb940c8c62773074f9`
  - `racing.dodger`: `c1391f97ceb6c552d91f029711e8d20a952a8f9ee730d2ce4c48c6a34c9c5b92`
  - `racing.weaver`: `87e9f285d8f55029bebe9caee47f9916a929012664bdd30394b3af3aa90dc4d3`
- Cada tarea cierra con `npm test` del paquete tocado en verde y un commit.
  Push a `origin/feat/carrera-en-vivo` al cerrar cada tarea (la app borra los
  worktrees al cerrar la sesión).
- Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Lo que más puede morder (y dónde se prueba)

1. **El reloj de filas y su predicción difieren en un tick** por punto flotante
   → `drawsWithin` exacto contra el consumo real en 30 secretos (Tarea 1).
2. **Un cliente honesto choca contra los topes** (tecla mantenida, puesta al
   día tras un alt-tab) → la sesión y el driver recortan antes de jugar, y un
   test manda 10 acciones en un tick y comprueba que no hay rechazo (Tarea 2).
3. **Un intento de Flappy guardado antes del deploy no se puede retomar** → test
   de `live-store` que carga un registro de Flappy viejo y uno de Carrera
   (Tarea 4).
4. **La estrategia "serpenteador" decide distinto en vivo** porque su salto
   dependía del carril ya movido → test `step` = `play` en 40 semillas
   (Tarea 3).
5. **Una rendición con el replay vacío de Flappy en una partida de Carrera** →
   se rechaza; la de Carrera (`inputs: []`) se acepta (Tarea 4).

---

### Task 1: el motor de Carrera en vivo

**Archivos:**
- Modificar: `packages/game-sdk/src/racing.ts`
- Crear: `packages/game-sdk/test/racing-live.test.ts`

**Interfaces:**
- Produce: `new RacingEngine(source: number | RandomSource)`;
  `RacingEngine.drawsWithin(ticks: number): number` (filas que nacen en los
  próximos `ticks`; 0 si terminó).

- [ ] **Paso 1: test que falla** (`racing-live.test.ts`): caracterización con
  semilla (hash del motor de arriba, con la política `dodge` del script de
  caracterización, 50 semillas, 6000 ticks, foto cada 250); con una fuente que
  cuenta, cada fila consume exactamente un valor; `drawsWithin(n)` igual al
  consumo real de los próximos `n` ticks mientras el auto vive (30 secretos,
  n = 1 y 15); `drawsWithin` no toca el motor y da 0 con la partida terminada;
  una fila consume su valor aunque la fuente sea `BufferedRandom` con un solo
  valor por fila.
- [ ] **Paso 2:** correr `node --import tsx --test packages/game-sdk/test/racing-live.test.ts`
  → falla (el constructor no acepta una fuente).
- [ ] **Paso 3: implementar** en `racing.ts`:

```ts
import { mulberry32, groupByTick, type RandomSource } from "./replay";

/** Nivel y ritmo de filas según el tiempo de carrera: los usan el juego y la
 *  predicción (`drawsWithin`) con exactamente las mismas operaciones. */
const levelAt = (elapsedMs: number) => Math.floor(elapsedMs / 8000);
const spawnDue = (elapsedMs: number, spawnTimer: number) =>
  spawnTimer >= Math.max(0.5, 1.15 - levelAt(elapsedMs) * 0.07);

// en la clase:
private rng: () => number;
/** En vivo: de dónde sale el valor de cada fila. */
private readonly rows?: RandomSource;

constructor(source: number | RandomSource) {
  if (typeof source === "number") {
    this.rng = mulberry32(source);
  } else {
    this.rows = source;
    this.rng = () => {
      throw new Error("racing: in live play each row draws from its own value");
    };
  }
}

private level(): number {
  return levelAt(this.elapsedMs);
}

drawsWithin(ticks: number): number {
  if (this.over) return 0;
  let elapsedMs = this.elapsedMs;
  let spawnTimer = this.spawnTimer;
  let rows = 0;
  for (let i = 0; i < ticks; i++) {
    elapsedMs += RACING_DT * 1000;
    spawnTimer += RACING_DT;
    if (spawnDue(elapsedMs, spawnTimer)) {
      rows += 1;
      spawnTimer = 0;
    }
  }
  return rows;
}

private spawn() {
  // En vivo, la fila entera sale de UN valor: se expande con un mulberry32
  // propio, así cuántos valores consume el juego no depende del azar.
  if (this.rows) this.rng = mulberry32(Math.floor(this.rows.next() * 4294967296));
  // …el resto de spawn() sin cambios…
}

// en update(), el chequeo de fila pasa a:
this.spawnTimer += dt;
if (spawnDue(this.elapsedMs, this.spawnTimer)) {
  this.spawnTimer = 0;
  this.spawn();
}
```

  `spawnInterval()` desaparece (lo reemplaza `spawnDue`). Comentario de
  `drawsWithin`: en vivo un valor por fila; con semilla no se usa.
- [ ] **Paso 4:** correr el test → pasa. Correr `npm test` entero → 843 + los
  nuevos, en verde (el de caracterización prueba que v2 no cambió).
- [ ] **Paso 5: commit** `game-sdk: el motor de Carrera juega en vivo (un valor por fila)`.

### Task 2: el núcleo genérico del modo en vivo

**Archivos:**
- Modificar: `packages/game-sdk/src/live.ts` (tipos y codec)
- Crear: `packages/game-sdk/src/live-play.ts` (driver, sesión, verificación)
- Modificar: `packages/game-sdk/src/flappy-live.ts` (definición + envoltorios)
- Crear: `packages/game-sdk/src/racing-live.ts`, `packages/game-sdk/src/live-games.ts`
- Modificar: `packages/game-sdk/package.json` (exports `./live-play`,
  `./racing-live`, `./live-games`)
- Modificar: `packages/game-sdk/test/live-fixtures.ts` (árbitro de referencia genérico)
- Crear: `packages/game-sdk/test/racing-live-play.test.ts`

**Interfaces (producidas):**

```ts
// live.ts
export interface LiveInput { t: number; a: string }
export type LiveDecision = boolean | string | readonly string[] | null | undefined;
export interface LiveGame<E> {
  id: string;
  create(src: RandomSource): E;
  step(e: E, actions: readonly string[]): void;
  over(e: E): boolean;
  score(e: E): number;
  drawsWithin(e: E, ticks: number): number;
  idle?(e: E, actions: readonly string[]): boolean;
  wire: "flaps" | "inputs";
  actions: readonly string[];
  maxActionsPerTick: number;
  inputBudget(ticks: number): number;
}
export function encodeLiveInputs(game: LiveGame<unknown>, inputs: readonly LiveInput[]):
  { flaps: number[] } | { inputs: LiveInput[] };
export function decodeLiveInputs(game: LiveGame<unknown>, wire: { flaps?: unknown; inputs?: unknown }):
  LiveInput[];               // sin validar: el árbitro valida aparte
export function liveActions(game: LiveGame<unknown>, d: LiveDecision): string[]; // normaliza y valida
export function capLiveActions(game: LiveGame<unknown>, actions: readonly string[], sofar: number, tick: number): string[];

// live-play.ts
export interface LiveStart { tick: number; reveal: number[]; flaps?: number[]; inputs?: LiveInput[] }
export interface LiveCommit { from: number; to: number; have: number; final?: boolean; flaps?: number[]; inputs?: LiveInput[] }
export type LiveReply = /* el mismo union que FlappyLiveReply */;
export type LiveCommitFn = (c: LiveCommit) => Promise<LiveReply>;
export function isRetriableLiveError(e: unknown): boolean;
export function playLive<E>(game: LiveGame<E>, opts: {
  start: LiveStart;
  decide: (engine: E, tick: number) => LiveDecision | Promise<LiveDecision>;
  commit: LiveCommitFn;
  maxTicks: number;
  retryDelaysMs?: number[];
}): Promise<{ score: number; ticks: number }>;
export class LiveSession<E> { /* engine, reveals, tick, result, error, waiting, canStep(), step(actions), pump() */ }
export function verifyLive<E>(game: LiveGame<E>, secret: string,
  replay: { ticks: number; flaps?: number[]; inputs?: LiveInput[] }): number;

// flappy-live.ts: flappyLive, playFlappyLive, FlappyLiveSession, verifyFlappyLive
//   y los tipos FlappyLive* (alias de los genéricos, mismas firmas que hoy).
// racing-live.ts: racingLive, verifyRacingLive(secret, { ticks, inputs }),
//   RACING_MAX_ACTIONS_PER_TICK = 3, racingInputBudget(ticks) = floor(ticks / 4) + 64.
// live-games.ts: liveGameFor(id): LiveGame<unknown> | undefined.
```

- [ ] **Paso 1: tests que fallan** (`racing-live-play.test.ts`), con el árbitro
  de referencia generalizado (`referenceArbiter(game, secret, rollbackOnCommit?)`
  y `batch(game, secret, decide, maxTicks)` en `live-fixtures.ts`, que siguen
  exportando las versiones de Flappy con la firma de hoy):
  - jugar en vivo da el mismo puntaje y ticks que de corrido (30 secretos);
  - si el árbitro pierde compromisos, termina igual;
  - propiedad central: la fila de cada valor revelado nace antes de
    `to + LIVE_LEAD_TICKS` (horario de filas calculado aparte, sin el auto);
  - `verifyRacingLive` con el secreto da el puntaje confirmado;
  - la sesión en tiempo real con respuestas lentas cierra igual y nunca avanza
    sin azar;
  - **topes:** `decide` que devuelve 10 acciones por tick → se juegan 3 y el
    árbitro no rechaza; `decide` que devuelve una acción cada tick → el tope del
    intento las recorta y el árbitro no rechaza;
  - `decide` asíncrono funciona (`Promise`);
  - `liveActions`: `true` en Carrera tira (Carrera no tiene acción única), una
    acción desconocida tira.
- [ ] **Paso 2:** correrlos → fallan (no existe `live-play`).
- [ ] **Paso 3: implementar.** `playLive` y `LiveSession` son `playFlappyLive`
  y `FlappyLiveSession` de hoy con `game.step`, `game.over`, `game.score`,
  `game.drawsWithin`, las jugadas como `LiveInput[]` (agrupadas por tick para
  retomar) y el compromiso armado con `encodeLiveInputs`. Antes de jugar cada
  tick: `capLiveActions` (corta en `maxActionsPerTick` y en
  `inputBudget(tick + 1) - sofar`). La sesión: `step(actions)` chequea
  `canStep()`, después `game.idle?.(engine, actions)` (Flappy: sin aletear y
  sin arrancar no cuenta), después recorta y juega. `verifyLive` corre el motor
  con `SecretSource` y corta al terminar.
  Flappy: `flappyLive = { id: "flappy", create: (s) => new FlappyEngine(s),
  step: (e, acts) => { if (acts.length) e.flap(); e.update(FLAPPY_DT); },
  over: (e) => e.over, score: (e) => e.score, drawsWithin: (e, n) => e.drawsWithin(n),
  idle: (e, acts) => !e.started && acts.length === 0, wire: "flaps",
  actions: ["f"], maxActionsPerTick: 1, inputBudget: () => Infinity }`.
  `playFlappyLive(opts)` = `playLive(flappyLive, opts)`; `FlappyLiveSession`
  envuelve una `LiveSession` y traduce `step(flap)` a `step(flap ? ["f"] : [])`;
  `verifyFlappyLive` = `verifyLive(flappyLive, …)`.
  Carrera: `racingLive = { id: "racing", create: (s) => new RacingEngine(s),
  step: (e, acts) => { for (const a of acts) a === "l" ? e.moveLeft() : a === "r"
  ? e.moveRight() : e.jump(); e.update(RACING_DT); }, … wire: "inputs",
  actions: ["l", "r", "j"], maxActionsPerTick: 3, inputBudget: racingInputBudget }`.
- [ ] **Paso 4:** `npm test` → todos los de Flappy sin tocar + los nuevos, en verde.
- [ ] **Paso 5: commit** `game-sdk: núcleo genérico del modo en vivo (Flappy y Carrera)`.

### Task 3: las estrategias de Carrera juegan en vivo

**Archivos:**
- Modificar: `packages/strategies/src/types.ts` (`LiveStep.decide` devuelve `LiveDecision`)
- Modificar: `packages/strategies/src/racing.ts`, `packages/strategies/src/racing-weaver.ts`
- Crear: `packages/strategies/test/racing-live-step.test.ts`

- [ ] **Paso 1: tests que fallan:** caracterización de `play` (hashes de
  arriba, 40 semillas × 2 juegos de parámetros: los por defecto y
  `{ lookahead: 240, preferredLane: "left", coinGreed: 0 }` /
  `{ boldness: 0.9, coinGreed: 0 }`); `step` decide lo mismo que `play`
  (mismas acciones por tick, mismo puntaje) jugando con `racingLive.step`.
- [ ] **Paso 2:** correr → falla (`step` no existe).
- [ ] **Paso 3:** cada estrategia pasa a un `decider(params)` que devuelve
  `(g, t) => RaceAction[]` sin tocar el motor (con su cooldown adentro); `play`
  aplica esas acciones y graba los inputs; `step` devuelve
  `{ decide: (e, t) => decider(e as RacingEngine, t), maxTicks: MAX_TICKS }`.
  En el serpenteador, el salto se decide con el carril de DESPUÉS del cambio:
  `lane = g.airborne ? g.carLane : g.carLane + (a === "l" ? -1 : 1)`.
- [ ] **Paso 4:** test en verde; `npm test` en verde.
- [ ] **Paso 5: commit** `strategies: Carrera decide tick a tick (step) para jugar en vivo`.

### Task 4: el árbitro juega cualquier juego en vivo

**Archivos:**
- Modificar: `apps/server/src/matchmaking.ts` (`LiveAttempt.inputs`,
  `attemptInputs`, `recordLiveInputs`, `liveReplayOf`, rendición genérica,
  `healUnfinishedLiveAttempts`)
- Modificar: `apps/server/src/live.ts` (motor por definición, validación del
  tramo, apertura con las jugadas en su formato)
- Modificar: `apps/server/src/live-store.ts` (acepta `inputs`)
- Modificar: `apps/server/src/live-routes.ts`, `apps/server/src/agents-routes.ts`
  (aceptan `inputs`)
- Modificar: `apps/server/src/agent-runner.ts` (la casa juega cualquier juego en vivo)
- Crear: `apps/server/test/live-racing.test.ts`
- Modificar: `apps/server/test/live-store.test.ts`, `apps/server/test/live-runner.test.ts`,
  `apps/server/test/live-webhook-routes.test.ts` (un caso de Carrera cada uno)

**Interfaces:**
- Consume: `liveGameFor`, `encodeLiveInputs`, `decodeLiveInputs`, `LiveInput`.
- Produce: `LiveCommitBody { token; from; to; have; final?; flaps?: number[]; inputs?: LiveInput[] }`;
  `LiveStartView` abierto con `flaps?` / `inputs?`.

- [ ] **Paso 1: tests que fallan** (`live-racing.test.ts`, con
  `RULES_V.racing = 3`): abrir sin nada revelado hasta que la primera fila esté
  cerca (`inputs: []`); jugar con `playLive(racingLive, …)` da el puntaje que
  verifica el secreto y liquida al terminar los dos; propiedad central; topes
  (4 acciones en un tick, acción `x`, pasar el promedio, `flaps` en vez de
  `inputs`) se rechazan sin avanzar; un segundo abrir devuelve las jugadas en
  `inputs`; rendición con `{ ticks: 0, inputs: [], v: 3 }` cierra con 0 y la de
  Flappy se rechaza; un replay con semilla se rechaza; sin caché de motores
  sigue igual; nada del secreto antes de decidir. Más: `live-store` carga un
  registro de Flappy (sin `inputs`) y uno de Carrera; el runner juega una
  partida de Carrera en vivo con `racing.dodger`; el BYO compromete `inputs`.
- [ ] **Paso 2:** correr → fallan.
- [ ] **Paso 3: implementar.** En `live.ts`, `engineFor` arma el motor con
  `liveGameFor(m.game)` y rehace el registro; `reveal` usa
  `game.drawsWithin(e.eng, LIVE_LEAD_TICKS)`; el compromiso valida el tramo:
  Flappy con el mensaje de hoy (`invalid flaps: …`), el resto con
  `invalid inputs: integer ticks inside [from, to), in order, actions <lista>,
  at most <n> per tick` y `too many inputs: at most <budget> by tick <to>`;
  aplica tick a tick con `game.step` y guarda solo lo jugado antes de terminar.
  La apertura devuelve `encodeLiveInputs(game, attemptInputs(...))`.
- [ ] **Paso 4:** `npm test` en verde (Flappy sin tocar).
- [ ] **Paso 5: commit** `árbitro: el modo en vivo sirve para cualquier juego (Carrera, apagada)`.

### Task 5: el SDK juega Carrera en vivo

**Archivos:**
- Modificar: `packages/agent-sdk/src/strategies.ts` (`LiveStrategy.decide` como
  método: `decide(engine: unknown, tick: number): LiveDecision | Promise<LiveDecision>`)
- Modificar: `packages/agent-sdk/src/agent.ts` (`liveGameFor` en vez de `"flappy"`; `playLive`)
- Modificar: `packages/agent-sdk/src/client.ts` (tipos genéricos)
- Modificar: `packages/agent-sdk/src/index.ts` (exporta `verifyRacingLive`)
- Modificar: `apps/server/test/live-sdk-e2e.test.ts` (caso de Carrera)

- [ ] **Paso 1: test que falla:** `playAndSubmit({ game: "racing", stake: 0 })`
  contra el árbitro en proceso juega en vivo, y el puntaje es el de la
  estrategia jugada de corrido con el secreto publicado.
- [ ] **Paso 2:** correr → falla ("this SDK cannot play racing live yet").
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test` y `npm run typecheck:packages` en verde.
- [ ] **Paso 5: commit** `agent-sdk: playAndSubmit juega Carrera en vivo`.

### Task 6: el ejemplo de Claude decide en vivo

**Archivos:**
- Modificar: `packages/agent-sdk/examples/play-racing-llm.ts`
- Modificar: `packages/agent-sdk/test/racing-llm.test.ts`

- [ ] **Paso 1: test que falla:** `brainLiveStrategy(brain)` (decide asíncrono
  que consulta al cerebro solo en los puntos de decisión) contra el árbitro de
  referencia da el mismo puntaje que `playRacingWithBrain` de corrido con la
  misma fuente.
- [ ] **Paso 2:** correr → falla.
- [ ] **Paso 3:** `main()` empareja; si la partida vuelve `live`, abre el
  intento y juega con `playLive(racingLive, { decide: brainLiveStrategy(...).decide, … })`;
  si no, sigue como hoy (semilla + replay firmado).
- [ ] **Paso 4:** test en verde.
- [ ] **Paso 5: commit** `ejemplo: Claude juega Carrera en vivo`.

### Task 7: la web juega Carrera en vivo

**Archivos:**
- Modificar: `apps/web/app/lib/live.ts` (`racingReplaySource`, tipo `LiveController`)
- Modificar: `apps/web/app/games/flappy/FlappyGame.tsx` (usa el tipo genérico)
- Modificar: `apps/web/app/games/racing/RacingGame.tsx` (`seed?` o `live?`)
- Modificar: `apps/web/app/game/[gameId]/match/page.tsx`
- Modificar: `apps/web/app/components/replay/ReplayPlayer.tsx`
- Modificar: `apps/web/app/lib/i18n/{es,en,fr}.ts` (`g.racing.live*`)
- Modificar: `apps/web/test/live.test.ts`

- [ ] **Paso 1: test que falla:** `racingReplaySource` (secreto → `SecretSource`;
  sin secreto y sin semilla → error) y la rendición de Carrera sin semilla.
- [ ] **Paso 2:** correr → falla.
- [ ] **Paso 3:** `RacingGame` en vivo: al apretar empezar abre el intento con
  `live.open()` y crea `new LiveSession(racingLive, start, live.commit)`; en el
  bucle, antes de cada tick `if (!session.canStep()) break`, las teclas van a
  `session.step(acciones)`; `session.pump()` en cada cuadro; avisos
  "conectando…"/"confirmando…"; al cerrar, `onFinish({ score, live: { reveals } })`.
  La página le pasa el mismo controlador que a Flappy. `ReplayPlayer` usa
  `racingReplaySource(r, secret)`.
- [ ] **Paso 4:** `npm test`, `npm run typecheck:web` y `npm run lint` en verde.
- [ ] **Paso 5: commit** `web: Carrera se puede jugar en vivo (apagada)`.

### Task 8: cierre del PR 1

- [ ] CHANGELOG `[Sin publicar]`: "Agregado (apagado)" con lo de este PR.
- [ ] `npm run check` entero en verde; `npm run build --workspace apps/web` si
  el entorno lo permite (si no, lo corre CI).
- [ ] Push y PR a `main` con el resumen, el spec y este plan; avisar al dueño
  que es seguro mergearlo (no cambia nada en producción).
