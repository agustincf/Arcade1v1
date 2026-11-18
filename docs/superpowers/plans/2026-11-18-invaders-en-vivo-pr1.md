# Space Invaders en vivo, PR 1 (apagado) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que Space Invaders se pueda jugar en vivo (sin semilla, el azar revelado de a bloques de 60 ticks), con todo apagado en producción.

**Architecture:** el motor acepta una fuente de azar y en vivo saca un valor por bloque de 60 ticks, expandido en 4 sub-valores fijos por tick. `invaders-live.ts` lo describe como `LiveGame`; el núcleo genérico (driver, sesión, árbitro) ya hace el resto. La estrategia de la casa, el SDK y la web suman el camino en vivo.

**Tech Stack:** TypeScript, `node --test` con tsx, Next.js (web).

**Spec:** [`docs/superpowers/specs/2026-11-18-invaders-en-vivo-design.md`](../specs/2026-11-18-invaders-en-vivo-design.md)

## Global Constraints

- `INVADERS_RULES_V = 1` en este PR; `LIVE_SINCE_RULES_V.invaders = 2`. Producción no cambia.
- `INVADERS_LIVE_BLOCK = 60`; 4 sub-valores por tick, en este orden: tirada de bomba, columna, tirada del OVNI, sentido del OVNI.
- Acciones `l1 l0 r1 r0 f1 f0`; a lo sumo 6 por tick; `inputBudget(ticks) = floor(ticks / 3) + 64`.
- Con semilla, el motor y `invaders.hunter.play` dan exactamente lo mismo que antes (caracterización con hash).
- `npm run typecheck` entero antes de cada commit; `npm run check` en verde antes del PR.
- Textos de la web en es/en/fr; código y comentarios en español, como el resto del repo.

## Review Focus

- La partida termina (última vida) a mitad de un bloque: el árbitro cierra el intento y `drawsWithin` da 0 después → test en Task 1 y en Task 4.
- La oleada se despeja en un tick: igual se consumen sus 4 sub-valores, el bloque siguiente sale del mismo valor → test en Task 1.
- Un intento retomado (corte de red) con teclas apretadas: la estrategia lee `held` del motor y sigue igual → test de retomar en Task 3.
- En la web, un tope recorta un cambio de tecla: el tick siguiente lo vuelve a mandar (no queda una tecla pegada) → test del ayudante puro en Task 5.
- Un compromiso que pasa el tope de jugadas: el árbitro lo rechaza con 400 → test en Task 4.

---

### Task 1: el motor juega en vivo

**Files:**
- Modify: `packages/game-sdk/src/invaders.ts`
- Modify: `packages/game-sdk/src/rules.ts` (`invaders: INVADERS_RULES_V`)
- Test: `packages/game-sdk/test/invaders-live.test.ts`

**Interfaces:**
- Produces: `INVADERS_RULES_V = 1`, `INVADERS_LIVE_BLOCK = 60`, `new InvadersEngine(source: number | RandomSource)`, `engine.tickCount: number`, `engine.held: { left: boolean; right: boolean; fire: boolean }`, `engine.drawsWithin(ticks: number): number`, `ReplayInvaders.v?: number`.

- [ ] **Step 1:** test de caracterización ANTES de tocar el motor: `trace(seed)` juega 6.000 ticks con una política fija (perseguir el alien más cercano, disparar siempre, cambiar de tecla cada 30 ticks) y fotografía `{ score, lives, wave, playerX, bombs, ufo }` cada 250 ticks; hash sha256 de las fotos de las semillas 1..12. Correrlo, anotar el hash en el test.
- [ ] **Step 2:** tests nuevos (fallan): un valor por bloque (`BufferedRandom` con k valores alcanza para `60·k` ticks y el siguiente tira `NeedsReveal`); `drawsWithin` (en 0: `drawsWithin(15) = 1`, `drawsWithin(60) = 1`, `drawsWithin(61) = 2`; en el tick 1: `drawsWithin(59) = 0`, `drawsWithin(60) = 1`); `drawsWithin` exacto contra lo consumido tick a tick en 5 partidas con `SecretSource`, y no toca el motor; terminada, 0; oleada despejada (motor con todos los aliens muertos salvo uno, al matarlo) sigue consumiendo un bloque cada 60 ticks; `held` refleja `apply`.
- [ ] **Step 3:** implementar. En vivo, `rng` tira si se llama; `tick()` arma `this.dice` con 4 valores del `mulberry32` del bloque al empezar (después de `if (this.over) return`, antes de la salida por oleada); un ayudante `roll(i)` devuelve `rng()` con semilla y `dice[i]` en vivo, usado en los 4 lugares de siempre. `tickCount += 1` en los dos modos.
- [ ] **Step 4:** correr `node --import tsx --test packages/game-sdk/test/invaders-live.test.ts packages/game-sdk/test/engines.test.ts` → PASS (la caracterización con el hash del paso 1).
- [ ] **Step 5:** `npm run typecheck` y commit.

### Task 2: la definición en vivo

**Files:**
- Create: `packages/game-sdk/src/invaders-live.ts`
- Modify: `packages/game-sdk/src/live-games.ts`, `packages/game-sdk/src/live.ts` (`LIVE_SINCE_RULES_V`), `packages/game-sdk/package.json` (subpath `./invaders-live`)
- Test: `packages/game-sdk/test/invaders-live-play.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `invadersLive: LiveGame<InvadersEngine>`, `INVADERS_MAX_ACTIONS_PER_TICK = 6`, `invadersInputBudget(ticks: number): number`, `verifyInvadersLive(secret: string, replay: { ticks: number; inputs: LiveInput[] }): number`.

- [ ] **Step 1:** tests (fallan): `liveGameFor("invaders") === invadersLive`; `isLiveMatch("invaders", 1) === false` y `isLiveMatch("invaders", 2) === true`; con una política simple, `playLive` contra `referenceLiveArbiter(invadersLive, secret)` da el mismo puntaje que `batchLive` y que `verifyInvadersLive`; en cada compromiso del log, `revealed` no pasa de los bloques que empiezan antes de `to + LIVE_LEAD_TICKS`; `LiveSession` con el mismo árbitro (bucle simulado) termina con el mismo puntaje; una política que manda 8 acciones por tick queda recortada a 6 y nunca recibe un rechazo; `invadersInputBudget(0) = 64`, `invadersInputBudget(300) = 164`.
- [ ] **Step 2:** implementar `invaders-live.ts` (acciones en orden y `tick()`, como `verifyInvaders`), registrar en `live-games.ts`, `invaders: 2` en `LIVE_SINCE_RULES_V`, subpath en `package.json`.
- [ ] **Step 3:** `node --import tsx --test packages/game-sdk/test/*.test.ts` → PASS.
- [ ] **Step 4:** `npm run typecheck` y commit.

### Task 3: la estrategia decide tick a tick

**Files:**
- Modify: `packages/strategies/src/invaders.ts`, `packages/strategies/src/types.ts` (comentario de `step`)
- Test: `packages/strategies/test/invaders-live-step.test.ts`

**Interfaces:**
- Consumes: Task 1 (`held`), Task 2 (`invadersLive`).
- Produces: `strategyInvadersHunter.step(params): LiveStep`.

- [ ] **Step 1:** caracterización ANTES del refactor: hash de `[score, replay]` de `play` en las semillas 1..30 con los parámetros por defecto y `{ aggression: 0.2, dodge: 1 }`. Anotar el hash.
- [ ] **Step 2:** tests (fallan): `step` decide lo mismo que `play` (mismas jugadas y puntaje jugando el motor con semilla con `invadersLive.step`); retomar: jugar 2.000 ticks con un `step`, crear otro `step` nuevo y seguir con el mismo motor da una partida válida en la que el motor nunca queda con una tecla que la decisión cree suelta (`held` manda).
- [ ] **Step 3:** refactor a una decisión `hunter(params)` que devuelve `(g, t) => InvaderAction[]` sin tocar el motor, leyendo `g.held`; `play` la usa aplicando las acciones y `step` la devuelve con `maxTicks: MAX_TICKS`.
- [ ] **Step 4:** `node --import tsx --test packages/strategies/test/*.test.ts` → PASS (la caracterización con el hash del paso 1).
- [ ] **Step 5:** `npm run typecheck` y commit.

### Task 4: árbitro y SDK

**Files:**
- Test: `apps/server/test/live-invaders.test.ts`; modify `apps/server/test/live-sdk-e2e.test.ts`
- Modify: `packages/agent-sdk/src/index.ts` (exporta `verifyInvadersLive`), `packages/agent-sdk/src/strategies.ts` (comentario de `LiveStrategy`)

**Interfaces:**
- Consumes: Tasks 1–3.

- [ ] **Step 1:** tests con `RULES_V.invaders = 2` dentro del test: emparejar no da semilla (`live`, `secretHash`, `rulesV: 2`); el intento entero con `invaders.hunter` cierra solo con el puntaje que da `verifyInvadersLive` con el secreto publicado; ningún compromiso revela más allá de los bloques que empiezan antes de `to + 15`; un tramo con 7 acciones en un tick y uno que pasa el tope del intento → `LiveError`; la rendición `{ ticks: 0, inputs: [], v: 2 }` vale y otro replay da `replay not allowed`; cerrar con `final` a mitad de un bloque cuenta lo alcanzado. En `live-sdk-e2e`: `playAndSubmit({ game: "invaders", stake: 0 })` contra el árbitro en proceso da el puntaje de la estrategia jugada de corrido con el secreto.
- [ ] **Step 2:** exportar `verifyInvadersLive` del SDK y nombrar las acciones de Invaders en la doc de `LiveStrategy`.
- [ ] **Step 3:** `node --import tsx --test apps/server/test/live-*.test.ts` → PASS.
- [ ] **Step 4:** `npm run typecheck` y commit.

### Task 5: la web

**Files:**
- Modify: `apps/web/app/games/invaders/InvadersGame.tsx`, `apps/web/app/game/[gameId]/match/page.tsx`, `apps/web/app/components/replay/ReplayPlayer.tsx`, `apps/web/app/lib/live.ts`, `apps/web/app/lib/i18n/{es,en,fr}.ts`
- Test: `apps/web/test/live.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `invadersReplaySource(replay, secret?)`, `heldDiff(want: { left; right; fire }, held: { left; right; fire }): InvaderAction[]` (orden l, r, f; primero las que se sueltan de cada tecla) en `apps/web/app/lib/live.ts`; `InvadersResult` con `live?: { reveals: number[] }`.

- [ ] **Step 1:** tests (fallan): `heldDiff` da `[]` si coinciden, `["l1"]` al apretar izquierda, `["l0", "r1"]` al pasar de izquierda a derecha, y vuelve a dar `["f0"]` si el motor sigue con el disparo apretado después de un recorte; `invadersReplaySource` usa el secreto si está y la semilla si no, y tira sin ninguno de los dos.
- [ ] **Step 2:** implementar como en `RacingGame`: prop `live?: LiveController` y `seed?`, el motor nace con la sesión, en vivo cada tick `session.step(heldDiff(keys.current, eng.held))`, congelado con aviso `g.invaders.liveConnecting` / `g.invaders.liveConfirming`, `onAttemptClosed`, resultado en vivo con `reveals`. La página pasa el controlador a Invaders; `ReplayPlayer` usa `invadersReplaySource`.
- [ ] **Step 3:** `node --import tsx --test apps/web/test/*.test.ts` → PASS; `npm run typecheck` y commit.

### Task 6: docs, check y PR

**Files:**
- Modify: `CHANGELOG.md` (Sin publicar), `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/MAINNET.md` (C13), `packages/game-sdk/README.md`

- [ ] **Step 1:** CHANGELOG: Invaders se puede jugar en vivo, todavía apagado (qué cambia el día del interruptor y el PR del registro antes). ARCHITECTURE y el README de game-sdk: `invaders-live`. TESTING: los archivos nuevos. MAINNET C13: Invaders listo, apagado.
- [ ] **Step 2:** `npm run check` → verde.
- [ ] **Step 3:** commit, push y PR contra `main` con la descripción en español simple.
