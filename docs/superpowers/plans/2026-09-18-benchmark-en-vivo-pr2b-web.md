# Benchmark en vivo, PR 2b: la web juega en vivo (apagado) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la web juegue Flappy en vivo. El juego espera el azar del árbitro sin trabarse, retoma un intento al recargar, muestra el puntaje que confirma el árbitro, comprueba el secreto al decidirse y reproduce los replays en vivo. Nada cambia en producción mientras `RULES_V.flappy` siga en 1.

**Architecture:** El núcleo es `FlappyLiveSession` en `@arcade1v1/game-sdk/flappy-live`: una sesión para bucles de tiempo real, pura y testeable.

- El bucle pregunta `canStep()` antes de cada tick y llama `pump()` en cada cuadro.
- La sesión compromete en segundo plano, se resincroniza y reintenta los errores de red.
- Guarda todo lo revelado.

`FlappyGame` la usa cuando recibe un controlador en vivo en vez de la semilla. La página de partida firma la apertura al empezar, guarda el `matchId` para retomar, rinde sin semilla y comprueba el secreto. `ReplayPlayer` acepta el secreto.

**Tech Stack:** Next 16 (React, client components) y TypeScript. Tests con `node:test` + tsx (game-sdk y `apps/web/test`). Prueba manual con el navegador integrado contra árbitro y web locales.

**Spec:** `docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md`, sección "Web" y el hallazgo 6 de "Por qué alcanza".

**Base:** la rama del PR 2a (`feat/benchmark-en-vivo-agentes`, PR #30), apilada. Si ya se mergeó todo abajo, rebasar sobre `main`.

## Global Constraints

- Comentarios en español, identificadores en inglés. Commits en español con prefijo y el trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `RULES_V.flappy` **sigue en 1** en lo commiteado. Para la prueba manual se cambia a 2 **solo localmente** y se revierte antes de commitear (`git diff` limpio en `rules.ts`).
- Textos nuevos en los 4 idiomas (es, en, fr, hi): `apps/web/test/i18n.test.ts` exige las mismas claves.
- Errores de acciones firmadas con su motivo real (`app/lib/errors.ts`), no el genérico de conexión.
- No tocar `.env` ni producción. El merge lo hace el dueño.

---

### Task 1: `FlappyLiveSession` en el game-sdk

**Files:**

- Create: `packages/game-sdk/test/live-fixtures.ts` (mover `secretFor`, `flapPolicy`, `referenceArbiter` y `batch` de `flappy-live-driver.test.ts`, exportados)
- Modify: `packages/game-sdk/test/flappy-live-driver.test.ts` (importarlos de ahí), `packages/game-sdk/src/flappy-live.ts`
- Test: `packages/game-sdk/test/flappy-live-session.test.ts` (nuevo)

**Interfaces:**

- Produces:

```ts
export type FlappyLiveCommitFn = (c: FlappyLiveCommit) => Promise<FlappyLiveReply>;
export class FlappyLiveSession {
  constructor(
    start: FlappyLiveStart,
    commit: FlappyLiveCommitFn,
    opts?: { now?: () => number; retryMs?: number },
  );
  readonly engine: FlappyEngine;
  readonly reveals: number[]; // todo lo revelado, en orden
  get tick(): number;
  get result(): { score: number; ticks: number } | undefined; // el cierre confirmado
  get error(): Error | undefined; // desincronizada: no puede seguir
  get waiting(): boolean; // hay un compromiso en vuelo o esperando reintento
  canStep(): boolean;
  step(flap: boolean): void;
  pump(): void;
}
```

Reglas de la sesión:

- **`canStep`:** `!engine.over && drawsWithin(1) <= buffer.available`.
- **`step`:** si no puede avanzar, tira un error.
- **`pump`**, cuando no hay nada en vuelo, ni cierre, ni error, y ya pasó el reintento:
  1. Si el motor murió, compromete `[committed, tick)`.
  2. Si no, y `drawsWithin(LIVE_LEAD_TICKS) > available`: con `tick > committed` compromete; con `tick === committed`, error `live desync`.
- **Respuestas:**
  - Siempre se agregan `reveal` al buffer y a `reveals`.
  - **Conflicto:**
    - con `reply.tick > tick`, error `live desync`;
    - si no, `committed = reply.tick`;
    - más de 5 conflictos seguidos, error.
  - **Normal:** `committed = reply.tick`, y si `over`, `result = { score, ticks }`.
  - **El motor murió, todo comprometido y el árbitro no cerró:** error `live desync`.
  - **Error de red:** se reintenta a los `retryMs` (1000 por defecto), con el reloj inyectable.

- [ ] **Step 1: Mover los fixtures** del test del driver a `live-fixtures.ts` e importarlos. Correr `node --import tsx --test packages/game-sdk/test/flappy-live-driver.test.ts`: los 7 tests en verde, sin cambios de comportamiento.

- [ ] **Step 2: Escribir los tests de la sesión** (`flappy-live-session.test.ts`), con un bucle simulado cuadro a cuadro. En cada cuadro el bucle:
  - avanza hasta `speed` ticks mientras `canStep()` (aleteando según `flapPolicy`);
  - llama `pump()`;
  - entrega las respuestas que "tardaron" `delay` cuadros;
  - espera a que corran los microtasks.

  Casos:
  1. **Mismo puntaje que de corrido:** con respuestas que tardan 6 cuadros y `speed` 1 o 3, el cierre coincide con `batch(secret)`, en 20 secretos.
  2. **Nunca avanza sin azar:** con respuestas lentas hay cuadros en que `canStep()` es falso, y `step` nunca tira.
  3. **Resincroniza:** si el árbitro pierde compromisos (`referenceArbiter(secret, 3)`), termina igual.
  4. **Reintenta:** un error de red se reintenta después de `retryMs` (reloj falso) y termina igual.
  5. **Guarda lo revelado:** `reveals` es el comienzo de `SecretSource(secret)`.
  6. **Error claro:** si el árbitro no revela lo necesario (respuestas con `reveal: []`), la sesión queda con `error` `live desync` y no se cuelga.

- [ ] **Step 3: Verlo fallar** (`FlappyLiveSession` no existe).
- [ ] **Step 4: Implementar** en `flappy-live.ts` con las reglas de arriba.
- [ ] **Step 5: Correr** los tests del game-sdk, `tsc`, eslint y prettier.
- [ ] **Step 6: Commit** `feat(game-sdk): FlappyLiveSession para jugar en vivo en un bucle de tiempo real`.

---

### Task 2: Web — cliente, rendición y retomar (piezas puras)

**Files:**

- Modify: `apps/web/app/lib/arbiter.ts`: `liveStart` y `liveCommit` (delegan en el cliente del SDK), y en `PublicReplay` `seed?`, `secret?` y `secretHash?`.
- Create: `apps/web/app/lib/live.ts`. Funciones puras:
  - `forfeitReplay(game, seed, rulesV)`: la rendición; sin semilla, es la de un juego en vivo. La página la usa en `submitForfeit`, en lugar del armado en línea.
  - `liveResumeKey(game, bet)`, `rememberLiveMatch(storage, game, bet, matchId)`, `readLiveMatch(storage, game, bet)` y `forgetLiveMatch(storage, game, bet)`. Reciben un `Storage`, así se testean sin navegador.
- Test: `apps/web/test/live.test.ts`:
  - la rendición con y sin semilla, para v1 y v2;
  - recordar, leer y olvidar el intento, con un `Storage` falso;
  - leer un valor basura devuelve `null`.

- [ ] TDD como siempre. Commit `feat(web): piezas del modo en vivo (cliente, rendición sin semilla y retomar)`.

---

### Task 3: `ReplayPlayer` con el secreto

**Files:**

- Modify:
  - `apps/web/app/components/replay/ReplayPlayer.tsx`: prop `secret?: string`. En Flappy, el motor se arma con `new FlappyEngine(secret ? new SecretSource(secret) : r.seed)`.
  - `apps/web/app/watch/[matchId]/page.tsx`: pasar `secret={data.secret}`.
  - La página de partida pasa el secreto al replay del rival (Tarea 5).
- Test: `makeSim` no se exporta. Sumar un test chico en `apps/web/test/live.test.ts` si se extrae la elección del motor a `app/lib/live.ts` (`flappyEngineFor(replay, secret?)`). Si no, cubrirlo en la prueba manual.

- [ ] Commit `feat(web): el replay de Flappy en vivo se arma con el secreto publicado`.

---

### Task 4: `FlappyGame` en vivo

**Files:**

- Modify: `apps/web/app/games/flappy/FlappyGame.tsx` y los 4 diccionarios de i18n.

Cambios:

- **Props:** `seed?: number` o `live?: FlappyLiveController`, con

```ts
export interface FlappyLiveController {
  /** Firma y abre (o retoma) el intento. Tira si el jugador cancela la firma. */
  open(): Promise<FlappyLiveStart>;
  commit: FlappyLiveCommitFn;
}
```

`FlappyResult` suma `live?: { reveals: number[] }`, para comprobar el secreto al final.

- **Empezar:**
  - con `live`, `StartScreen.onStart` hace `await live.open()`;
  - mientras, se muestra "firmá en tu wallet…" (`g.flappy.liveSign`) y un error con reintento si falla;
  - después se crea `new FlappyLiveSession(start, live.commit)` y `engineRef.current = session.engine`. Si `start.tick > 0`, retoma.
- **Bucle:**
  - Antes de cada tick, `if (!session.canStep()) { acc = Math.min(acc, STEP); break; }`: se congela en vez de adelantarse de golpe.
  - Un aleteo pendiente se aplica en el `step`, y el bucle llama `session.pump()` en cada cuadro.
  - Más de 300 ms sin poder avanzar muestran "conectando…" (`g.flappy.liveConnecting`) sobre el canvas.
  - El `dtCap` de las mesas de plata no cambia.
- **Fin:**
  - Con el motor muerto, se espera `session.result` y se muestra "confirmando…" (`g.flappy.liveConfirming`).
  - El `GameOverScreen` muestra el puntaje del árbitro.
  - `onFinish({ score: result.score, replay: { ticks: result.ticks, flaps: [] }, live: { reveals: session.reveals } })`.
  - Si `session.error`, se muestra `g.flappy.liveError` con el motivo y se termina con lo que haya.

- [ ] Sin test unitario del componente (no hay entorno de React en los tests): lo cubre la prueba manual. `tsc` y eslint de la web en verde.
- [ ] Commit `feat(web): FlappyGame juega en vivo con FlappyLiveSession`.

---

### Task 5: Página de partida en vivo

**Files:**

- Modify: `apps/web/app/game/[gameId]/match/page.tsx` y los 4 diccionarios.

Cambios:

- **Estado:** `live` (de `v.live`), `secretHash` (de `v.secretHash`) y `rivalSecret`. "Encontré partida" pasa a `matchId !== null && (seed !== null || live)`.
- **Retomar:**
  - Antes de emparejar, `readLiveMatch(sessionStorage, game.id, bet)`.
  - Si hay un id, `getMatch(id, pid)`. Si sigue sin decidir y dice `live`, se usa esa partida en vez de emparejar. Si no, se olvida.
- **Controlador en vivo** para `FlappyGame`:
  - `open()`: `ensureChain`, firma `liveStartAuthMessage(matchId, pid, ts)` (en dev sin wallet va sin firma), `liveStart`, guarda el token en un ref y hace `rememberLiveMatch`.
  - `start.over` significa que ya había jugado: `finishLive(start.score)`.
  - `commit(c)`: `liveCommit(matchId, pid, { ...c, token })`.
- **`finishLive(score, reveals)`:**
  - sin `submitScore` ni firma de puntaje;
  - `forgetLiveMatch`;
  - `getMatch`: si ya se decidió, `applyResult`; si no, `setWaiting(true)`.
- **`applyResult(v)`:** con `v.secret`, guarda `rivalSecret` y, si hay `reveals` propios, `checkLiveReveals(v.secret, secretHash, reveals)`. Si falla, muestra `match.liveSecretMismatch`.
- **`submitForfeit`:** `forfeitReplay(game.id, seed, rulesV)`; en vivo se permite sin semilla, y además `forgetLiveMatch`.
- **Replay del rival:** `<ReplayPlayer game=… replay={rivalReplay} secret={rivalSecret ?? undefined} />`.

- [ ] `tsc`, eslint y el test de i18n en verde. Commit `feat(web): la página de partida juega Flappy en vivo`.

---

### Task 6: Prueba manual en el navegador

1. Cambiar **solo localmente** `RULES_V.flappy` a 2 en `packages/game-sdk/src/rules.ts`.
2. Levantar el árbitro local (`npm run dev -w @arcade1v1/server` o el script que corresponda, puerto 4000, sin `.env` de producción, con `ENABLE_TEST_BOT=true`) y la web (`npm run dev -w @arcade1v1/web`, `NEXT_PUBLIC_ARBITER_URL=http://localhost:4000`).
3. En el navegador integrado, abrir `/game/flappy/match?bet=0` (en dev se juega como invitado, sin firma):
   - arranca;
   - aletear con clics sobre el canvas;
   - se ven los compromisos en las pedidos de red (`/live/commit`) y nunca aparece "conectando…" con el árbitro local;
   - al morir, el puntaje es el que confirma el árbitro.
4. `POST /match/:id/bot` (el botón de práctica) cierra la partida: el resultado muestra el replay del rival con el secreto.
5. Recargar a mitad de partida: retoma en el tick comprometido.
6. Revertir `rules.ts` (`git diff` limpio). Anotar en el PR lo probado, con capturas.

---

### Task 7: Verificación y PR

- [ ] `npx prettier --write packages apps && npm run check` en verde; `git diff packages/game-sdk/src/rules.ts` vacío.
- [ ] Push y PR apilado sobre el #30: qué es, por qué no cambia nada en producción, qué se probó (con la prueba manual) y qué falta (el arreglo de los deploys y el PR 3).
- [ ] CI en verde. El merge lo hace el dueño.
