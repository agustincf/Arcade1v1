# Benchmark en vivo, PR 2a: los agentes juegan en vivo (apagado) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los agentes —los hosteados de la casa, los BYO por webhook, el SDK y el MCP— sepan jugar Flappy en vivo, sin cambiar nada en producción mientras `RULES_V.flappy` siga en 1.

**Architecture:** Las estrategias suman `step(params)`: la misma decisión, tick a tick y sin azar futuro. El SDK suma `liveStart`/`liveCommit` al cliente, y `playAndSubmit` juega con `playFlappyLive` cuando la partida dice `live: true`. El runner hace lo mismo en proceso para los agentes de la casa. A los BYO los notifica sin semilla y, si el plazo vence con el intento abierto, lo cierra contando lo alcanzado. El MCP solo ajusta descripciones.

**Tech Stack:** TypeScript (ESM, `node:test` + tsx), express y viem. Paquetes: `@arcade1v1/game-sdk` (`live` y `flappy-live` del PR 1, con `SecretSource` y `verifyFlappyLive`), `@arcade1v1/strategies` y `@arcade1v1/agent-sdk`.

**Spec:** `docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md` (PR #27, corregido el 2026-09-18: el azar sale de un secreto de 256 bits). Aplica a las secciones "Estrategias", "SDK", "MCP" y a la parte de agentes de "Árbitro". La web va en el PR 2b.

**Base:** la rama del PR 1 (`feat/benchmark-en-vivo-base`, PR #28). Si el dueño ya la mergeó, rebasar sobre `main` con `git rebase --onto origin/main feat/benchmark-en-vivo-base`.

## Global Constraints

- Comentarios en español, identificadores en inglés. Commits en español con prefijo y el trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `RULES_V.flappy` **sigue en 1**. Los tests prenden el modo en vivo con `RULES_V.flappy = 2` dentro de su proceso.
- `runStrategy` y `StrategyDef.play` NO cambian de comportamiento: el builder de la web (`apps/web/app/build/page.tsx`) los usa para las vistas previas con semillas al azar.
- Nada del código del agente toca el secreto: juega con lo revelado. Los tests comparan contra la estrategia jugada de un tirón con el secreto recién publicado.
- El cliente guarda `secretHash` (de `matchmake`) y todo lo revelado. Cuando la partida ya viene decidida, comprueba que `liveSecretHash(secret) === secretHash` y que lo revelado es el comienzo de `SecretSource(secret)`; si no, tira un error claro. Es el hallazgo 6 de la revisión del PR #28: sin esto, el compromiso del secreto no le sirve a nadie.
- Versiones de paquetes, CHANGELOG, README/AGENTS.md y publicación en npm van en el PR 3.
- No tocar `.env`, no correr nada contra producción, el merge lo hace el dueño.
- Cada tarea termina con `npx tsc --noEmit`, eslint y prettier sobre lo tocado.

---

## Estructura de archivos

| Archivo                                                                                       | Responsabilidad                                                                                   | Tarea |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- |
| `packages/strategies/src/types.ts`                                                            | `LiveStep` y `StrategyDef.step?`                                                                  | 1     |
| `packages/strategies/src/flappy.ts`                                                           | `thresholdDecider` compartido por `play` y `step`                                                 | 1     |
| `packages/strategies/test/live-step.test.ts`                                                  | caracterización de `play` + `step` decide igual                                                   | 1     |
| `packages/agent-sdk/src/client.ts`                                                            | `MatchView.seed?`/`live?`/`secretHash?`/`secret?`, tipos en vivo, `liveStart`, `liveCommit` (409) | 2     |
| `packages/agent-sdk/src/sign.ts`                                                              | `signLiveStart`                                                                                   | 2     |
| `packages/agent-sdk/src/index.ts`                                                             | exports nuevos                                                                                    | 2, 3  |
| `packages/agent-sdk/examples/play-racing-llm.ts`, `apps/web/app/game/[gameId]/match/page.tsx` | tipos por la semilla opcional                                                                     | 2     |
| `packages/agent-sdk/test/live-client.test.ts`                                                 | cliente: 200, 409 y 400; firma                                                                    | 2     |
| `packages/agent-sdk/src/strategies.ts`                                                        | `LiveStrategy`, `defaultLiveStrategy`                                                             | 3     |
| `packages/agent-sdk/src/agent.ts`                                                             | `playAndSubmit` en vivo                                                                           | 3     |
| `apps/server/test/live-sdk-e2e.test.ts`                                                       | el SDK real contra las rutas reales                                                               | 3     |
| `apps/server/src/live.ts`                                                                     | `closeLiveAttempt`                                                                                | 4     |
| `apps/server/src/agent-runner.ts`                                                             | casa en vivo; BYO sin semilla y con `secretHash`; cierre al vencer                                | 4, 5  |
| `apps/server/test/live-runner.test.ts`                                                        | la casa juega en vivo sin ver el secreto                                                          | 4     |
| `apps/server/test/live-webhook-runner.test.ts`                                                | notificación en vivo y cierre al vencer                                                           | 5     |
| `apps/mcp/src/server.ts`                                                                      | descripciones de `matchmake` y `play_and_submit`                                                  | 6     |

---

### Task 1: Estrategias — la misma decisión, tick a tick

**Files:**

- Modify: `packages/strategies/src/types.ts`, `packages/strategies/src/flappy.ts`, `packages/strategies/src/index.ts`
- Test: `packages/strategies/test/live-step.test.ts` (nuevo)

**Interfaces:**

- Produces: `LiveStep { decide: (engine: unknown, tick: number) => boolean; maxTicks: number }` y `StrategyDef.step?(params): LiveStep`. `strategyFlappyThreshold.step` lo implementa.

- [ ] **Step 1: La huella de `play` ANTES de tocarlo**

Desde la raíz del worktree:

```bash
node --import tsx --input-type=module -e "import {getStrategy,defaultParams} from '@arcade1v1/strategies';import {createHash} from 'node:crypto';const d=getStrategy('flappy.threshold');const p=defaultParams(d);const alt={riskOffset:-40,reaction:5};let h=createHash('sha256');for(let s=1;s<=40;s++)for(const q of [p,alt]){const r=d.play(s,q);h.update(JSON.stringify([r.score,r.replay]))}console.log(h.digest('hex'))"
```

Anotar el hash: es la huella que fija que el refactor no cambia una sola partida.

- [ ] **Step 2: Escribir el test** (`<HUELLA>` = el hash del paso 1)

```ts
// La estrategia de Flappy decide igual jugando con la semilla (`play`, las
// vistas previas del builder) que tick a tick EN VIVO (`step`, sin azar futuro).
// La caracterización fija que el refactor no cambió ni una partida.
//
// Correr: node --import tsx --test packages/strategies/test/live-step.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FlappyEngine, FLAPPY_DT, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { getStrategy, defaultParams } from "../src/index.js";

const def = getStrategy("flappy.threshold")!;
const PARAMS = [defaultParams(def), { riskOffset: -40, reaction: 5 }];

test("caracterización: play da exactamente las mismas partidas que antes del cambio", () => {
  const h = createHash("sha256");
  for (let seed = 1; seed <= 40; seed++) {
    for (const params of PARAMS) {
      const r = def.play(seed, params);
      h.update(JSON.stringify([r.score, r.replay]));
    }
  }
  assert.equal(h.digest("hex"), "<HUELLA>");
});

test("step decide exactamente lo mismo que play, con los mismos estados", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const params of PARAMS) {
      const batch = def.play(seed, params);
      const step = def.step!(params);
      const g = new FlappyEngine(seed);
      const flaps: number[] = [];
      for (let t = 0; t < step.maxTicks && !g.over; t++) {
        if (step.decide(g, t)) {
          g.flap();
          flaps.push(t);
        }
        g.update(FLAPPY_DT);
      }
      assert.deepEqual(flaps, (batch.replay as ReplayFlappy).flaps, `seed ${seed}`);
      assert.equal(g.score, batch.score, `seed ${seed}`);
    }
  }
});

test("step existe solo en los juegos que se juegan en vivo", () => {
  assert.equal(typeof def.step, "function");
  assert.equal(getStrategy("2048.priority")!.step, undefined);
});
```

- [ ] **Step 3: Verlo fallar.** `node --import tsx --test packages/strategies/test/live-step.test.ts`: la caracterización PASA y los otros dos FALLAN (`def.step is not a function`).

- [ ] **Step 4: Implementar**

`types.ts`, antes de `StrategyDef`:

```ts
/** Cómo se juega EN VIVO: la misma estrategia, decidida tick a tick sobre lo
 *  que muestra el motor, sin conocer el azar futuro (llega de a poco; ver
 *  `@arcade1v1/game-sdk/live`). El motor va sin tipar acá para no atar el
 *  contrato a un juego: cada estrategia sabe cuál es el suyo. */
export interface LiveStep {
  /** ¿Actuar en este tick? Recibe el motor ANTES de aplicar el tick. */
  decide: (engine: unknown, tick: number) => boolean;
  /** Si el jugador llega vivo a este tick, el intento se cierra (el mismo tope
   *  que usa `play`). */
  maxTicks: number;
}
```

y dentro de `StrategyDef`, debajo de `play`:

```ts
  /** Solo juegos EN VIVO (hoy Flappy): la decisión tick a tick. `play` se queda
   *  para las vistas previas locales con semillas al azar, que no rankean. */
  step?(params: Record<string, unknown>): LiveStep;
```

`flappy.ts`: la decisión compartida y las dos formas de usarla.

```ts
/** La decisión de la estrategia, la misma para `play` (con semilla) y `step`
 *  (en vivo): solo mira el motor en el tick actual, nunca el futuro. */
function thresholdDecider(params: Record<string, unknown>) {
  const riskOffset = num(params, PARAMS[0]);
  const reaction = Math.round(num(params, PARAMS[1]));
  return (g: FlappyEngine, t: number): boolean => {
    // Primer aleteo en t=0 para arrancar la física (el motor espera started).
    if (t === 0) return true;
    // El slider de reacción espacia las decisiones, como un jugador más o
    // menos atento.
    if (t % reaction !== 0) return false;
    // Próximo caño que todavía no pasamos (el hueco a apuntar).
    const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
    const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + riskOffset;
    // Aletear solo cayendo (vy >= 0 tras el pico del aleteo) y por debajo del
    // objetivo: el clásico control por umbral.
    return g.birdY > target && g.birdVy > 0;
  };
}

export const strategyFlappyThreshold: StrategyDef = {
  id: "flappy.threshold",
  game: "flappy",
  labelKey: "strat.flappy.threshold.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const decide = thresholdDecider(params);
    const g = new FlappyEngine(seed);
    const flaps: number[] = [];
    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      if (decide(g, t)) {
        g.flap();
        flaps.push(t);
      }
      g.update(FLAPPY_DT);
    }
    const replay: ReplayFlappy = { seed, ticks: MAX_TICKS, flaps };
    return { score: g.score, replay };
  },
  step(params: Record<string, unknown>): LiveStep {
    const decide = thresholdDecider(params);
    return {
      decide: (engine, tick) => decide(engine as FlappyEngine, tick),
      maxTicks: MAX_TICKS,
    };
  },
};
```

Sumar `LiveStep` al import de `./types` en `flappy.ts` y al `export type` de `index.ts`.

- [ ] **Step 5: Correr.** `node --import tsx --test "packages/strategies/test/*.test.ts"` en verde; `npx tsc --noEmit -p packages/strategies/tsconfig.json`, eslint y prettier sin errores.

- [ ] **Step 6: Commit** `feat(strategies): step() para decidir tick a tick en los juegos en vivo`, con el cuerpo: "La estrategia de Flappy comparte la decisión entre play (con semilla) y step (en vivo). Una huella de 80 partidas fija que play no cambió."

---

### Task 2: SDK — el cliente sabe abrir y comprometer

**Files:**

- Modify: `packages/agent-sdk/src/client.ts`, `sign.ts`, `index.ts`, `agent.ts` (una guarda), `packages/agent-sdk/examples/play-racing-llm.ts`, `apps/web/app/game/[gameId]/match/page.tsx`
- Test: `packages/agent-sdk/test/live-client.test.ts` (nuevo)

**Interfaces:**

- Consumes: `FlappyLiveCommit`, `FlappyLiveReply` (`@arcade1v1/game-sdk/flappy-live`), `liveStartAuthMessage` (`@arcade1v1/game-sdk/auth`).
- Produces: `MatchView.seed?`, `live?`, `secretHash?`, `secret?`; `LiveStartView`, `LiveCommitBody`, `LiveCommitView`; `ArbiterClient.liveStart`, `ArbiterClient.liveCommit`; `signLiveStart`.

- [ ] **Step 1: El test**

```ts
// El cliente del árbitro, en vivo: manda lo que la ruta espera y trata el 409
// como lo que es (un conflicto de tick con el que resincronizar), no como error.
//
// Correr: node --import tsx --test packages/agent-sdk/test/live-client.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { liveStartAuthMessage } from "@arcade1v1/game-sdk/auth";
import { ArbiterClient } from "../src/client.ts";
import { randomWallet, signLiveStart } from "../src/sign.ts";

function clientWith(replies: { status: number; body: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, client: new ArbiterClient("http://arb", { fetchImpl, timeoutMs: 0 }) };
}

test("liveStart manda address y firma a la ruta del intento", async () => {
  const { calls, client } = clientWith([
    {
      status: 200,
      body: { over: false, token: "tk", tick: 0, flaps: [], reveal: [0.5], revealed: 1 },
    },
  ]);
  const start = await client.liveStart("0xmatch", "0xme", { signature: "0xsig", ts: 7 });
  assert.equal(start.over, false);
  assert.deepEqual(calls[0], {
    url: "http://arb/match/0xmatch/live/start",
    body: { address: "0xme", signature: "0xsig", ts: 7 },
  });
});

test("liveCommit: 200 normal, 409 como conflicto y 400 como error", async () => {
  const { calls, client } = clientWith([
    { status: 200, body: { over: false, tick: 30, reveal: [0.1], revealed: 2 } },
    { status: 409, body: { conflict: true, tick: 30, reveal: [], revealed: 2 } },
    { status: 400, body: { error: "bad token" } },
  ]);
  const body = { token: "tk", from: 0, to: 30, flaps: [0], have: 1 };
  const ok = await client.liveCommit("0xmatch", "0xme", body);
  assert.equal(ok.conflict, undefined);
  assert.equal(ok.tick, 30);
  assert.deepEqual(calls[0].body, { address: "0xme", ...body });

  const conflict = await client.liveCommit("0xmatch", "0xme", body);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.tick, 30);

  await assert.rejects(client.liveCommit("0xmatch", "0xme", body), /400.*bad token/);
});

test("signLiveStart firma el mensaje de apertura con la wallet del agente", async () => {
  const w = randomWallet();
  const { signature, ts } = await signLiveStart({
    matchId: "0xmatch",
    address: w.address,
    privateKey: w.privateKey,
  });
  const signer = await recoverMessageAddress({
    message: liveStartAuthMessage("0xmatch", w.address, ts),
    signature,
  });
  assert.equal(signer.toLowerCase(), w.address.toLowerCase());
});
```

- [ ] **Step 2: Verlo fallar** (`client.liveStart is not a function`).

- [ ] **Step 3: Implementar**

`client.ts`:

1. `import type { FlappyLiveCommit, FlappyLiveReply } from "@arcade1v1/game-sdk/flappy-live";`
2. En `MatchView`, reemplazar `seed: number;` por:

```ts
  /** No viene en los juegos EN VIVO: su azar sale de un secreto (ver `secretHash`). */
  seed?: number;
  /** Juego en vivo: se juega con `liveStart`/`liveCommit` (o `playAndSubmit`,
   *  que ya lo hace), porque el azar llega de a poco. */
  live?: boolean;
  /** En vivo: el SHA-256 del secreto del azar, público desde que se empareja. */
  secretHash?: string;
  /** En vivo y con la partida decidida: el secreto, para re-verificar con
   *  `verifyFlappyLive` y comprobar que su hash es `secretHash`. */
  secret?: string;
```

3. Después de `LeaderRow`:

```ts
/** Abrir (o retomar) un intento en vivo. Con `over: true` el intento ya estaba
 *  cerrado: no hay token, solo el puntaje que quedó. */
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

/** Un compromiso con su token (el token sale de `liveStart`). */
export type LiveCommitBody = FlappyLiveCommit & { token: string };

/** La respuesta a un compromiso; con `conflict: true` hay que seguir desde `tick`. */
export type LiveCommitView = FlappyLiveReply;

/** Un 409 que no trae el conflicto del protocolo (un proxy, por ejemplo) no es
 *  una resincronización: se deja pasar al error de siempre. */
function parseOrUndefined(text: string): { conflict?: boolean } | undefined {
  try {
    return JSON.parse(text) as { conflict?: boolean };
  } catch {
    return undefined;
  }
}
```

4. Métodos de `ArbiterClient`, después de `submitScore`:

```ts
  /** Abre o retoma TU intento en vivo. `auth` es la firma de
   *  `liveStartAuthMessage(matchId, address, ts)`: obligatoria en producción. */
  liveStart(
    id: string,
    address: string,
    auth?: { signature: string; ts: number },
  ): Promise<LiveStartView> {
    return this.post<LiveStartView>(`/match/${id}/live/start`, { address, ...(auth ?? {}) });
  }

  /** Compromete las jugadas de `[from, to)` y devuelve el azar que sigue. Un 409
   *  NO es un error: es el árbitro diciendo en qué tick está, con los valores
   *  para resincronizar, y vuelve como `conflict: true`. */
  async liveCommit(id: string, address: string, body: LiveCommitBody): Promise<LiveCommitView> {
    const path = `/match/${id}/live/commit`;
    const r = await this.fetchWithTimeout(`${this.base}${path}`, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, ...body }),
    });
    const text = await r.text();
    if (r.status === 409) {
      const reply = parseOrUndefined(text);
      if (reply?.conflict === true) return reply as LiveCommitView;
    }
    if (!r.ok) throw new Error(`arbiter ${path} ${r.status}: ${text}`);
    return JSON.parse(text) as LiveCommitView;
  }
```

`sign.ts`: sumar `liveStartAuthMessage` al import y, después de `signMatchmake`:

```ts
/** Firma "empiezo mi partida en vivo" (obligatoria en producción). Devuelve
 *  también el `ts`: el árbitro lo exige para la ventana anti-replay. */
export async function signLiveStart(opts: {
  matchId: string;
  address: string;
  privateKey: Hex;
  ts?: number;
}): Promise<{ signature: Hex; ts: number }> {
  const ts = opts.ts ?? Date.now();
  const account = privateKeyToAccount(opts.privateKey);
  const signature = await account.signMessage({
    message: liveStartAuthMessage(opts.matchId, opts.address, ts),
  });
  return { signature, ts };
}
```

`index.ts`: exportar `LiveStartView`, `LiveCommitBody`, `LiveCommitView` y `signLiveStart`.

- [ ] **Step 4: Los tipos que rompe la semilla opcional**

- `agent.ts`, antes de `strat(m.seed)`: `if (m.seed === undefined) throw new Error(\`the arbiter sent no seed for ${args.game}: this match is played live\`);` (la Tarea 3 la reemplaza por el camino en vivo).
- `examples/play-racing-llm.ts`: después del `matchmake`, `if (m.seed === undefined) throw new Error("this example needs a match with a seed (racing is not live)");`.
- `apps/web/app/game/[gameId]/match/page.tsx:152` y `:187`: `setSeed(v.seed ?? null)`. La web en vivo es el PR 2b; con `RULES_V.flappy = 1` la semilla siempre viene.

- [ ] **Step 5: Correr** los tests del SDK, `tsc` del SDK y de la web, eslint y prettier.

- [ ] **Step 6: Commit** `feat(agent-sdk): liveStart y liveCommit en el cliente, con la semilla opcional`.

---

### Task 3: SDK — `playAndSubmit` juega en vivo

**Files:**

- Modify: `packages/agent-sdk/src/strategies.ts`, `agent.ts`, `index.ts`
- Test: `apps/server/test/live-sdk-e2e.test.ts` (nuevo)

**Interfaces:**

- Consumes: `playFlappyLive`, `signLiveStart`, `client.liveStart`/`liveCommit`, `LiveStep`.
- Produces: `LiveStrategy`, `defaultLiveStrategy(game)`, `playAndSubmit({ game, stake, strategy?, liveStrategy? })`.

- [ ] **Step 1: El test**

```ts
// El SDK REAL contra las rutas REALES: dos agentes juegan Flappy en vivo con
// playAndSubmit y cada uno llega al MISMO puntaje que la estrategia jugada de un
// tirón con el secreto que se publica al decidir. Es la prueba de que la
// estrategia no usaba información del futuro.
//
// Correr: node --import tsx --test apps/server/test/live-sdk-e2e.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { SecretSource, liveSecretHash } from "@arcade1v1/game-sdk/live";
import { createAgent } from "@arcade1v1/agent-sdk";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";

process.env.REQUIRE_AUTH = "true"; // como en producción
RULES_V.flappy = 2;
const { matchmake, getMatch } = await import("../src/matchmaking.js");
const { liveRouter } = await import("../src/live-routes.js");

// Las dos rutas de index.ts que usa playAndSubmit, más el router en vivo.
const app = express();
app.use(express.json());
app.post("/matchmake", async (req, res) => {
  const { game, stake, address, signature, ts } = req.body ?? {};
  try {
    res.json(await matchmake(game, stake, address, signature ? { signature, ts } : undefined));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.get("/match/:id", (req, res) => {
  const v = getMatch(req.params.id, req.query.address ? String(req.query.address) : undefined);
  if (!v) return res.status(404).json({ error: "match not found" });
  res.json(v);
});
app.use(liveRouter((_req, _res, next) => next()));
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

/** La estrategia por defecto jugada de un tirón, con todo el azar a la vista. */
function batchWithSecret(secret: string): number {
  const def = getStrategy("flappy.threshold")!;
  const step = def.step!(defaultParams(def));
  const g = new FlappyEngine(new SecretSource(secret));
  for (let t = 0; t < step.maxTicks && !g.over; t++) {
    if (step.decide(g, t)) g.flap();
    g.update(FLAPPY_DT);
  }
  return g.score;
}

test("dos agentes del SDK juegan Flappy en vivo; cada puntaje es el de la estrategia de un tirón", async () => {
  const a = createAgent({ arbiterUrl: BASE });
  const b = createAgent({ arbiterUrl: BASE });

  const va = await a.playAndSubmit({ game: "flappy", stake: 0 });
  assert.equal(va.live, true);
  assert.equal(va.secret, undefined, "sin decidir, el secreto no sale del árbitro");
  assert.match(String(va.secretHash), /^[0-9a-f]{64}$/);
  assert.equal(typeof va.scores[a.address.toLowerCase()], "number", "su intento cerró");

  const vb = await b.playAndSubmit({ game: "flappy", stake: 0 });
  assert.ok(vb.status === "settled" || vb.status === "draw", `estado: ${vb.status}`);
  assert.equal(liveSecretHash(vb.secret!), va.secretHash, "el secreto es el comprometido");

  const expected = batchWithSecret(vb.secret!);
  assert.equal(vb.scores[a.address.toLowerCase()], expected);
  assert.equal(vb.scores[b.address.toLowerCase()], expected);
});

test("una estrategia de semilla en un juego en vivo se rechaza con el motivo", async () => {
  const c = createAgent({ arbiterUrl: BASE });
  await assert.rejects(
    c.playAndSubmit({ game: "flappy", stake: 0, strategy: () => ({ score: 0, replay: {} }) }),
    /played live/,
  );
});
```

- [ ] **Step 2: Verlo fallar** (la guarda de la Tarea 2: `the arbiter sent no seed for flappy`).

- [ ] **Step 3: Implementar**

`packages/agent-sdk/src/strategies.ts`, con `import type { FlappyEngine } from "@arcade1v1/game-sdk/flappy";` y `LiveStep` en los tipos re-exportados:

```ts
/** Estrategia EN VIVO: decide tick a tick mirando el motor, sin azar futuro. */
export interface LiveStrategy {
  decide: (engine: FlappyEngine, tick: number) => boolean;
  /** Si llega vivo a este tick, el intento se cierra con lo alcanzado. */
  maxTicks: number;
}

/** La estrategia en vivo por defecto de un juego (con los params por defecto
 *  del registro), o `undefined` si ese juego no se juega en vivo. Se crea UNA
 *  POR PARTIDA: una estrategia puede guardar estado entre ticks. */
export function defaultLiveStrategy(game: string): LiveStrategy | undefined {
  const def = strategiesFor(game).find((d) => d.step);
  return def?.step?.(defaultParams(def));
}
```

`agent.ts`:

1. Imports: `playFlappyLive` de `@arcade1v1/game-sdk/flappy-live`, `signLiveStart` de `./sign`, `defaultLiveStrategy` y `type LiveStrategy` de `./strategies`.
2. Firma de `playAndSubmit` en el tipo de `createAgent`:

```ts
  /** Empareja y juega. En un juego EN VIVO (la vista dice `live: true`) abre el
   *  intento firmado y compromete las jugadas mientras recibe el azar de a
   *  poco; `liveStrategy` reemplaza a la estrategia por defecto. */
  playAndSubmit(args: {
    game: string;
    stake: number;
    strategy?: Strategy;
    liveStrategy?: LiveStrategy;
  }): Promise<MatchView>;
```

3. En `playAndSubmit`, después del guard de versión: `if (m.live) return playLive(m, args);` (reemplaza la guarda de la Tarea 2), y debajo:

```ts
// EN VIVO: no hay semilla. Se abre el intento con una firma y se juega con
// playFlappyLive, que compromete las jugadas y consume el azar revelado.
async function playLive(
  m: MatchView,
  args: { game: string; strategy?: Strategy; liveStrategy?: LiveStrategy },
): Promise<MatchView> {
  if (args.strategy) {
    throw new Error(
      `${args.game} is played live: its randomness only exists after each commit — ` +
        `pass liveStrategy (a per-tick decision) instead of strategy`,
    );
  }
  if (args.game !== "flappy") {
    throw new Error(`this SDK cannot play ${args.game} live yet — update @arcade1v1 packages`);
  }
  const live = args.liveStrategy ?? defaultLiveStrategy(args.game);
  if (!live) throw new Error(`no default live strategy for ${args.game}`);
  const auth = await signLiveStart({
    matchId: m.matchId,
    address: wallet.address,
    privateKey: wallet.privateKey,
    ts: clock(),
  });
  const start = await client.liveStart(m.matchId, wallet.address, auth);
  if (!start.over) {
    const token = start.token;
    await playFlappyLive({
      start,
      decide: live.decide,
      commit: (c) => client.liveCommit(m.matchId, wallet.address, { ...c, token }),
      maxTicks: live.maxTicks,
    });
  }
  // El puntaje lo confirma el árbitro al cerrar el intento: la vista final es
  // la misma que devuelve un envío de puntaje de los de siempre.
  return client.getMatch(m.matchId, wallet.address);
}
```

`index.ts`: exportar `defaultLiveStrategy` y el tipo `LiveStrategy`.

- [ ] **Step 4: Correr** el e2e, los tests del SDK (`agent.test.ts`, `rules-guard.test.ts`), `tsc` del SDK y del server, eslint y prettier.

- [ ] **Step 5: Commit** `feat(agent-sdk): playAndSubmit juega las partidas en vivo`.

---

### Task 4: Runner — los agentes de la casa juegan en vivo

**Files:**

- Modify: `apps/server/src/live.ts`, `apps/server/src/agent-runner.ts`
- Test: `apps/server/test/live-runner.test.ts` (nuevo)

**Interfaces:**

- Produces:
  - `closeLiveAttempt(id, address): Promise<boolean>`, que la Tarea 5 usa;
  - `emptyReplay(game, seed: number | undefined)`: sin semilla es la rendición en vivo.

- [ ] **Step 1: El test**

```ts
// Un agente de la casa juega Flappy EN VIVO por el mismo camino que un humano:
// abre su intento firmado y compromete jugadas, en proceso. Nunca ve el secreto:
// su vista no lo trae hasta que la partida se decide.
//
// Correr: node --import tsx --test apps/server/test/live-runner.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { matchmakeAuthMessage, scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { SecretSource } from "@arcade1v1/game-sdk/live";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";

process.env.REQUIRE_AUTH = "true";
process.env.AGENTS_ENABLED = "false"; // sin timer: ticks manuales
process.env.MAX_AGENTS_PER_OWNER = "100";
RULES_V.flappy = 2;
const { createHostedAgent, getAgent } = await import("../src/agents.js");
const { runAgentsTick } = await import("../src/agent-runner.js");
const { matchmake, submitScore, getMatch } = await import("../src/matchmaking.js");

function batchWithSecret(secret: string): number {
  const def = getStrategy("flappy.threshold")!;
  const step = def.step!(defaultParams(def));
  const g = new FlappyEngine(new SecretSource(secret));
  for (let t = 0; t < step.maxTicks && !g.over; t++) {
    if (step.decide(g, t)) g.flap();
    g.update(FLAPPY_DT);
  }
  return g.score;
}

test("la casa juega Flappy en vivo sin ver el secreto, y su puntaje es el de su estrategia", async () => {
  const agent = createHostedAgent({
    owner: "0x" + "a".repeat(40),
    name: "VivoCasa",
    avatar: "🤖",
    game: "flappy",
    strategyId: "flappy.threshold",
    params: undefined,
  });
  const agentAddr = agent.address.toLowerCase();

  await runAgentsTick(); // se encola
  const pending = getAgent(agent.id)!.pendingMatchId!;
  assert.ok(pending, "quedó esperando rival");

  const rival = privateKeyToAccount(generatePrivateKey());
  const rivalAddr = rival.address.toLowerCase();
  const ts = Date.now();
  const signature = await rival.signMessage({
    message: matchmakeAuthMessage("flappy", 0, rivalAddr, ts),
  });
  const m = await matchmake("flappy", 0, rivalAddr, { signature, ts });
  assert.equal(m.matchId, pending);
  assert.equal(m.live, true);

  await runAgentsTick(); // juega en vivo
  const mid = getMatch(pending, agentAddr)!;
  assert.equal(mid.secret, undefined, "sin decidir: nada de secreto");
  const houseScore = mid.scores[agentAddr];
  assert.equal(typeof houseScore, "number", "el intento cerró con puntaje");

  const sig0 = await rival.signMessage({ message: scoreAuthMessage(pending, rivalAddr, 0) });
  const after = await submitScore(pending, rivalAddr, 0, { ticks: 0, flaps: [], v: 2 }, sig0);
  assert.ok(after.status === "settled" || after.status === "draw");

  const done = getMatch(pending)!;
  assert.equal(houseScore, batchWithSecret(done.secret!));
});
```

- [ ] **Step 2: Verlo fallar.** El runner todavía devuelve `false` en vivo, así que `mid.scores[agentAddr]` es `undefined`.

- [ ] **Step 3: `closeLiveAttempt`** al final de `apps/server/src/live.ts`:

```ts
/** Cierra un intento abierto en su último tick comprometido y cuenta lo
 *  alcanzado. Es interno del árbitro (sin token): lo usa el runner cuando a un
 *  agente BYO se le vence el plazo con el intento a medio jugar. Devuelve
 *  `false` si no había intento, ya estaba cerrado o la partida ya no admite
 *  puntajes. */
export async function closeLiveAttempt(id: string, address: string): Promise<boolean> {
  address = address.toLowerCase();
  const m = matchRecord(id);
  const a = m?.live?.[address];
  if (!m || !a || a.over || !m.liveSecret) return false;
  try {
    assertOpen(m);
  } catch {
    return false; // decidida o vencida: el barrendero se encarga
  }
  const e = engineFor(m, address, a);
  a.over = true;
  a.score = e.eng.score;
  engines.delete(`${m.id}:${address}`);
  await finishLiveAttempt(m, address, a.score, {
    ticks: a.tick,
    flaps: [...a.flaps],
    v: RULES_V[m.game] ?? 1,
  });
  return true;
}
```

- [ ] **Step 4: El camino en vivo del runner** (`apps/server/src/agent-runner.ts`)

1. Imports:
   - `getStrategy` y `validateParams` de `@arcade1v1/strategies`;
   - `liveStartAuthMessage` de `@arcade1v1/game-sdk/auth`;
   - `playFlappyLive` de `@arcade1v1/game-sdk/flappy-live`;
   - `liveStart`, `liveCommit` y `closeLiveAttempt` de `./live.js`.
2. `emptyReplay(game, seed: number | undefined)`: sin semilla, la rendición va sin ella. Agregar al comentario: "En un juego EN VIVO no hay semilla: su rendición va sin ella."

```ts
export function emptyReplay(game: string, seed: number | undefined): unknown {
  const rulesV = RULES_V[game] ?? 1;
  const v = rulesV !== 1 ? { v: rulesV } : {};
  const s = seed === undefined ? {} : { seed };
  if (game === "2048") return { ...s, moves: [], ...v };
  if (game === "flappy") return { ...s, ticks: 0, flaps: [], ...v };
  return { ...s, ticks: 0, inputs: [], ...v };
}
```

3. Reemplazar la guarda del PR 1 (`const seed = m.seed; if (m.live || seed === undefined) return false;`) por:

```ts
// PARTIDA EN VIVO (hoy Flappy desde las reglas v2): la vista no trae semilla
// y se juega comprometiendo jugadas. Un juego que NO es en vivo sin semilla
// no existe, pero si pasara no hay nada que jugar.
const live = m.live === true;
const seed = m.seed;
if (!live && seed === undefined) return false;
```

4. En la notificación del webhook, `seed,` pasa a:

```ts
            // En vivo no hay semilla: el dev abre su intento y el azar le llega
            // de a poco. Con `secretHash` comprueba el secreto cuando se publique.
            ...(live ? { live: true, secretHash: m.secretHash } : { seed }),
```

5. Después del bloque del webhook, antes de `runStrategy(`:

```ts
// AGENTE DE LA CASA EN VIVO: juega por el mismo protocolo que cualquiera,
// en proceso (sin HTTP) y sin ver el secreto, que ni está en su vista.
// Firma la apertura con su clave, como firma el puntaje.
if (live) {
  const def = getStrategy(agent.strategyId);
  const step =
    def && def.game === m.game ? def.step?.(validateParams(def, agent.params)) : undefined;
  const account = privateKeyToAccount(agent.privateKey);
  if (!step || m.game !== "flappy") {
    // No sabe jugar este juego en vivo: rendirse para no colgar al rival.
    const signature = await account.signMessage({
      message: scoreAuthMessage(m.matchId, address, 0),
    });
    const after = await submitScore(m.matchId, address, 0, emptyReplay(m.game, seed), signature);
    recordSettledResult(agent, after, address);
    return true;
  }
  const ts = Date.now();
  const signature = await account.signMessage({
    message: liveStartAuthMessage(m.matchId, address, ts),
  });
  const start = await liveStart(m.matchId, address, { signature, ts });
  if (!start.over) {
    const token = start.token;
    await playFlappyLive({
      start,
      decide: step.decide,
      commit: (c) => liveCommit(m.matchId, address, { ...c, token }),
      maxTicks: step.maxTicks,
    });
  }
  const after = getMatch(m.matchId, address);
  if (after) recordSettledResult(agent, after, address);
  return true;
}
```

- [ ] **Step 5: Correr** `live-runner`, `agents`, `webhook-agents` (incluye el test de `emptyReplay`), `tsc`, eslint y prettier.

- [ ] **Step 6: Commit** `feat(server): los agentes de la casa juegan las partidas en vivo`.

---

### Task 5: Runner — el plazo de los agentes BYO en vivo

**Files:**

- Modify: `apps/server/src/agent-runner.ts`
- Test: `apps/server/test/live-webhook-runner.test.ts` (nuevo)

- [ ] **Step 1: El test.** Un agente BYO de Flappy con un "dev" express local (el patrón de `webhook-agents.test.ts`), más `WEBHOOK_PLAY_DEADLINE_MS=150` y `RULES_V.flappy = 2`. Dos casos:
  1. **La notificación en vivo va sin semilla**, con `live: true` y `secretHash`.
  2. **Plazo vencido con el intento a medio jugar: se cierra contando lo alcanzado.**
     - Abrir el intento en proceso con la clave del agente (`liveStart`).
     - Comprometer `[0, 600)` con los aleteos que la estrategia elegiría. Se sacan jugando `step` sobre `SecretSource(matchRecord(id).liveSecret)`, algo que solo puede hacer el test.
     - Dejar vencer el plazo y correr un tick.
     - Verificar que el puntaje guardado es el del motor en el tick 600 (mayor que cero) y que el replay guardado dice `ticks: 600`, no la rendición.

- [ ] **Step 2: Verlo fallar.** Hoy el runner rinde con 0 aunque el intento tenga jugadas.

- [ ] **Step 3: Implementar.** En el forfeit por plazo vencido de `playPendingMatch`:

```ts
      try {
        // EN VIVO: si dejó el intento abierto, se cierra contando lo alcanzado
        // (el plazo corre hasta terminar el intento). Si nunca lo abrió,
        // rendición como siempre.
        const closed = live && (await closeLiveAttempt(m.matchId, address));
        let after: ReturnType<typeof getMatch> = null;
        if (closed) {
          after = getMatch(m.matchId, address);
        } else {
          const account = privateKeyToAccount(agent.privateKey);
          const signature = await account.signMessage({
            message: scoreAuthMessage(m.matchId, address, 0),
          });
          after = await submitScore(m.matchId, address, 0, emptyReplay(m.game, seed), signature);
        }
        if (!killed && recordWebhookFailure(agent)) {
          console.log(`webhook agent ${agent.id} auto-pausado (partidas sin responder)`);
        }
        if (after) recordSettledResult(agent, after, address);
        return true;
      } catch (e) { … sin cambios … }
```

- [ ] **Step 4: Correr** toda la carpeta `apps/server/test`.

- [ ] **Step 5: Commit** `feat(server): el plazo de un agente BYO corre hasta terminar el intento en vivo`.

---

### Task 6: MCP — decir que hay juegos en vivo

- [ ] **Step 1:** En `apps/mcp/test/server.test.ts`, dentro del test de las 12 herramientas:

```ts
const mm = tools.find((t) => t.name === "matchmake")!;
assert.match(String(mm.description), /live/i, "avisa que un juego en vivo no trae semilla");
```

- [ ] **Step 2:** Verlo fallar.
- [ ] **Step 3:** En `apps/mcp/src/server.ts`:
  - `matchmake`: `` `Emparejar para un juego (${GAMES.join(", ")}) en una mesa (stake). ` + "Si la partida vuelve con live: true, no trae semilla: se juega en vivo (comprometiendo jugadas) y la juega play_and_submit." ``;
  - `play_and_submit`: `"Empareja, juega con la estrategia por defecto y envía el puntaje (por ranking). " + "En un juego en vivo abre el intento, compromete las jugadas y recibe el azar de a poco."`.
- [ ] **Step 4:** `node --import tsx --test "apps/mcp/test/*.test.ts"`.
- [ ] **Step 5: Commit** `docs(mcp): las descripciones nombran las partidas en vivo`.

---

### Task 7: Verificación completa y PR

- [ ] `npx prettier --write packages apps && npm run check`: exit 0, `TODO OK ✅` y ningún warning de ESLint salvo el viejo de `match/page.tsx`.
- [ ] Subir y abrir el PR.
  - Base: `main` si el #28 ya está mergeado; si no, `feat/benchmark-en-vivo-base`, avisando que es un PR apilado.
  - Cuerpo:
    - qué es;
    - por qué no cambia nada en producción: con `RULES_V.flappy` en 1, `m.live` nunca es true;
    - qué se probó;
    - qué falta: el PR 2b (web) y el PR 3 (interruptor).
- [ ] Esperar CI en verde. El merge lo hace el dueño.
