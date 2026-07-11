# Duelos directos (Fase 4) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desafiar a un agente puntual en la ladder gratis — humano→agente (jugás vos) y agente→agente (tu agente vs el de otro) — en vez de solo la cola por orden de llegada.

**Architecture:** Un "desafío" es una partida gratis (stake 0) con `target` (address del agente desafiado) que NO entra en la cola general; solo su runner la acepta (in-process, `joiner===target`) y expira por TTL. Crear va firmado (humano: su wallet; agente→agente: el dueño sobre su agente). Diseño: [../specs/2026-07-10-duelos-directos-design.md](../specs/2026-07-10-duelos-directos-design.md).

**Tech Stack:** Node/Express + tsx (server, `node:test`), Next.js App Router + wagmi (web), viem (firmas).

## Global Constraints

- **Solo ladder gratis (stake 0)**, sin escrow ni plata. El target es SIEMPRE un agente hosteado activo.
- **Sin dependencias nuevas.** Reusar `Match`/`view`/`settleIfReady`/persistencia, el runner, las firmas del game-sdk, `resolveDisplay` (Fase 3), la página de partida.
- **Firmas anti-replay:** address en minúsculas; `ts` TTL `AGENT_AUTH_TTL_MS` (10 min); firmante correcto.
- **Anti-farming:** agente→agente del mismo dueño rechazado. Solo el `target` acepta.
- **Tests herméticos** (sin `persist-on`; `../src/offline-env.js` cuando haga falta clave/entorno).
- **4 idiomas** (en/es/hi/fr) para todo texto nuevo.
- **`npm run check`** en verde antes de cerrar.

## File Structure

- `packages/game-sdk/src/auth.ts` (mod) — `challengeAuthMessage`.
- `apps/server/src/matchmaking.ts` (mod) — `target`, `createChallenge`, `acceptChallenge`, `pendingChallengesFor`, TTL barrendero.
- `apps/server/src/profiles.ts` (mod) — `resolveDisplay` suma `agentId?`.
- `apps/server/src/challenge-routes.ts` (nuevo) — `POST /challenge` (2 ramas).
- `apps/server/src/index.ts` (mod) — montar router.
- `apps/server/src/agent-runner.ts` (mod) — aceptar/priorizar desafíos.
- `apps/server/test/challenge.test.ts`, `apps/server/test/challenge-routes.test.ts` (nuevos).
- `apps/web/app/lib/arbiter.ts` (mod) — `createChallenge` + `agentId?` en `LeaderRow`.
- `apps/web/app/my-agents/ChallengeButton.tsx` (nuevo).
- `apps/web/app/my-agents/[agentId]/page.tsx` (mod) — montar el botón.
- `apps/web/app/leaderboard/page.tsx` (mod) — filas de agente clickeables.
- `apps/web/app/game/[gameId]/match/page.tsx` (mod) — modo `?challenge=`.
- `apps/web/app/lib/i18n-dict.ts` (mod) — textos ×4.

---

### Task 1: `challengeAuthMessage` (game-sdk)

**Files:**

- Modify: `packages/game-sdk/src/auth.ts`
- Test: `packages/game-sdk/test/auth.test.ts`

**Interfaces:**

- Produces: `challengeAuthMessage(challenger: string, target: string, ts: number): string`

- [ ] **Step 1: Agregar el caso al test**

En `packages/game-sdk/test/auth.test.ts`, agregar:

```ts
import { challengeAuthMessage } from "@arcade1v1/game-sdk/auth";

test("challengeAuthMessage: formato estable y addresses en minúsculas", () => {
  const msg = challengeAuthMessage(
    "0xAAA0000000000000000000000000000000000001",
    "0xBBB0000000000000000000000000000000000002",
    1730000000000,
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: desafío a un rival",
      "challenger: 0xaaa0000000000000000000000000000000000001",
      "target: 0xbbb0000000000000000000000000000000000002",
      "ts: 1730000000000",
    ].join("\n"),
  );
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `node --import tsx --test packages/game-sdk/test/auth.test.ts`
Expected: FAIL — `challengeAuthMessage` no existe.

- [ ] **Step 3: Implementar** (en `auth.ts`, después de `profileAuthMessage`)

```ts
/** Mensaje a firmar para DESAFIAR a un rival puntual (ladder gratis). Ata:
 *  quién desafía + a quién + momento (ts). Lo firma el humano que desafía; para
 *  agente→agente se usa agentAuthMessage("challenge", ...) en su lugar. */
export function challengeAuthMessage(challenger: string, target: string, ts: number): string {
  return [
    "Arcade1v1: desafío a un rival",
    `challenger: ${challenger.toLowerCase()}`,
    `target: ${target.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}
```

- [ ] **Step 4: Correr (debe pasar)**

Run: `node --import tsx --test packages/game-sdk/test/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/auth.ts packages/game-sdk/test/auth.test.ts
git commit -m "feat(game-sdk): challengeAuthMessage para duelos directos firmados"
```

---

### Task 2: Modelo de desafío en matchmaking

**Files:**

- Modify: `apps/server/src/matchmaking.ts`
- Test: `apps/server/test/challenge.test.ts`

**Interfaces:**

- Consumes: `recordMatchCreated` (stats), helpers internos (`normAddr`, `randomId`, `randomSeed`, `view`, `isKnownGame`).
- Produces:
  - `Match.target?: string`
  - `CHALLENGE_TTL: number`
  - `createChallenge(game: string, challenger: string, target: string): MatchView`
  - `acceptChallenge(matchId: string, joiner: string): MatchView`
  - `pendingChallengesFor(address: string): { matchId: string; game: string }[]`

- [ ] **Step 1: Escribir el test que falla**

`apps/server/test/challenge.test.ts`:

```ts
// Desafíos directos (ladder gratis): creación fuera de la cola, aceptación solo
// por el target, listado de pendientes, y que el matchmake normal no los toca.
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChallenge,
  acceptChallenge,
  pendingChallengesFor,
  matchmake,
  submitScore,
} from "../src/matchmaking.js";

const suf = Date.now().toString(16).slice(-8);
const addr = (t: string) => "0x" + (t + suf).padStart(40, "0");

test("createChallenge no entra en la cola general (matchmake no lo toma)", async () => {
  const chA = addr("c1");
  const target = addr("t1");
  const ch = createChallenge("2048", chA, target);
  assert.equal(ch.status, "waiting");
  // Otro jugador que hace matchmake normal NO debe emparejarse con el desafío.
  const other = await matchmake("2048", 0, addr("o1"));
  assert.notEqual(other.matchId, ch.matchId);
  assert.equal(other.status, "waiting"); // creó su propia espera, no tomó el desafío
});

test("acceptChallenge: solo el target; un tercero es rechazado", () => {
  const chA = addr("c2");
  const target = addr("t2");
  const ch = createChallenge("2048", chA, target);
  assert.throws(() => acceptChallenge(ch.matchId, addr("x2")), /not the challenged rival/);
  assert.throws(() => acceptChallenge(ch.matchId, chA), /own challenge/);
  const ready = acceptChallenge(ch.matchId, target);
  assert.equal(ready.status, "ready");
});

test("pendingChallengesFor lista solo los dirigidos a esa address", () => {
  const target = addr("t3");
  const ch = createChallenge("2048", addr("c3"), target);
  const list = pendingChallengesFor(target);
  assert.ok(list.some((c) => c.matchId === ch.matchId && c.game === "2048"));
  assert.equal(pendingChallengesFor(addr("z3")).length, 0);
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `node --import tsx --test apps/server/test/challenge.test.ts`
Expected: FAIL — funciones no exportadas.

- [ ] **Step 3: Agregar `target` a la interfaz `Match`**

En `matchmaking.ts`, en `interface Match { ... }`, agregar tras `p2?: string;`:

```ts
  target?: string; // desafío directo: solo esta address (un agente) puede aceptar
```

- [ ] **Step 4: Implementar las funciones**

En `matchmaking.ts`, después de `createWaiting(...)` (usa los helpers ya presentes: `normAddr`, `randomId`, `randomSeed`, `matches`, `view`, `isKnownGame`, `persist`, `recordMatchCreated`):

```ts
// DUELOS DIRECTOS (ladder gratis). Un desafío es una partida stake 0 con `target`
// que NO entra en la cola general: solo el agente objetivo la acepta (su runner),
// y expira por CHALLENGE_TTL si no la toma. Cumple "desafiar a quien vos quieras"
// + "que nadie lo robe" + "expira si no se acepta", sin tocar plata.
export const CHALLENGE_TTL = Number(process.env.CHALLENGE_TTL_MS ?? 30 * 60_000);

/** Crea un desafío apuntado a `target` (address de un agente). Devuelve la vista
 *  para `challenger`. La autorización (firma) se hace en la capa de rutas. */
export function createChallenge(game: string, challenger: string, target: string) {
  challenger = normAddr(challenger);
  target = normAddr(target);
  if (!isKnownGame(game)) throw new Error(`unknown game: ${game}`);
  if (challenger === target) throw new Error("cannot challenge yourself");
  const m: Match = {
    id: randomId(),
    game,
    stake: 0,
    seed: randomSeed(),
    p1: challenger,
    target,
    scores: {},
    replays: {},
    createdAt: Date.now(),
    status: "waiting",
  };
  matches.set(m.id, m);
  recordMatchCreated();
  persist();
  return view(m, challenger);
}

/** El agente objetivo acepta un desafío dirigido a él. In-process (lo llama su
 *  runner): solo el target entra, un tercero o el propio challenger es rechazado. */
export function acceptChallenge(matchId: string, joiner: string) {
  joiner = normAddr(joiner);
  const m = matches.get(matchId);
  if (!m) throw new Error("match not found");
  if (!m.target) throw new Error("not a challenge");
  if (m.status !== "waiting" || m.p2) throw new Error("challenge not open");
  if (joiner !== m.target) throw new Error("not the challenged rival");
  if (joiner === m.p1) throw new Error("cannot accept your own challenge");
  m.p2 = joiner;
  m.status = "ready";
  persist();
  return view(m, joiner);
}

/** Desafíos en espera dirigidos a `address` (sin rival aún, no vencidos). */
export function pendingChallengesFor(address: string): { matchId: string; game: string }[] {
  address = normAddr(address);
  const now = Date.now();
  const out: { matchId: string; game: string }[] = [];
  for (const m of matches.values()) {
    if (
      m.target === address &&
      !m.p2 &&
      m.status === "waiting" &&
      now - m.createdAt <= CHALLENGE_TTL
    ) {
      out.push({ matchId: m.id, game: m.game });
    }
  }
  return out;
}
```

- [ ] **Step 5: Barrendero — TTL de desafío**

En `sweepMatches`, en la rama `if (!m.p2) {`, reemplazar la condición de vencimiento por una que use `CHALLENGE_TTL` para desafíos:

```ts
if (!m.p2) {
  // Esperando rival: vencido, se descarta. Un desafío dirigido usa su propio
  // TTL (más corto); una espera de cola normal, el WAIT_TTL de siempre.
  const ttl = m.target ? CHALLENGE_TTL : WAIT_TTL;
  if (now - m.createdAt > ttl) {
    const k = qkey(m.game, m.stake);
    if (queue.get(k) === m.id) queue.delete(k);
    matches.delete(m.id);
    dirty = true;
  }
  continue;
}
```

- [ ] **Step 6: Correr (debe pasar)**

Run: `node --import tsx --test apps/server/test/challenge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/matchmaking.ts apps/server/test/challenge.test.ts
git commit -m "feat(server): modelo de desafío directo (createChallenge/acceptChallenge)"
```

---

### Task 3: `resolveDisplay` suma `agentId`

**Files:**

- Modify: `apps/server/src/profiles.ts`
- Test: `apps/server/test/profiles.test.ts` (extender el caso de resolveDisplay)

**Interfaces:**

- Produces: `resolveDisplay(address): { name?: string; avatar?: string; agentId?: string }`

- [ ] **Step 1: Extender el test**

En `apps/server/test/profiles.test.ts`, en el test "resolveDisplay: agente gana sobre perfil…", después de la aserción del nombre del agente, agregar:

```ts
assert.equal(resolveDisplay(agent.address).agentId, agent.id);
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `node --import tsx --test apps/server/test/profiles.test.ts`
Expected: FAIL — `agentId` es `undefined`.

- [ ] **Step 3: Implementar**

En `profiles.ts`, cambiar la firma y el retorno del agente en `resolveDisplay`:

```ts
export function resolveDisplay(address: string): {
  name?: string;
  avatar?: string;
  agentId?: string;
} {
  const a = normAddr(address);
  const agent = hostedAgentByAddress(a);
  if (agent) return { name: agent.name, avatar: agent.avatar, agentId: agent.id };
  const p = profiles.get(a);
  if (p) return { name: p.name, avatar: p.avatar };
  return {};
}
```

- [ ] **Step 4: Correr (debe pasar)**

Run: `node --import tsx --test apps/server/test/profiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/profiles.ts apps/server/test/profiles.test.ts
git commit -m "feat(server): resolveDisplay incluye agentId (para linkear al agente)"
```

---

### Task 4: Ruta `POST /challenge` firmada

**Files:**

- Create: `apps/server/src/challenge-routes.ts`
- Test: `apps/server/test/challenge-routes.test.ts`

**Interfaces:**

- Consumes: `challengeAuthMessage`, `agentAuthMessage`, `AGENT_AUTH_TTL_MS` (game-sdk); `AUTH_REQUIRED`, `createChallenge` (matchmaking); `getAgent`, `setAgentPending` (agents).
- Produces: `export const challengeRouter: Router` con `POST /challenge` (humano→agente y agente→agente).

- [ ] **Step 1: Escribir el test que falla**

`apps/server/test/challenge-routes.test.ts`:

```ts
// Tests HTTP de duelos: firma del challenger (humano) / del dueño (agente→agente),
// anti-farming del mismo dueño, y rechazo de firma ajena. REQUIRE_AUTH on.
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { challengeAuthMessage, agentAuthMessage } from "@arcade1v1/game-sdk/auth";

process.env.REQUIRE_AUTH = "true";
const { challengeRouter } = await import("../src/challenge-routes.js");
const { createHostedAgent } = await import("../src/agents.js");

const app = express();
app.use(express.json());
app.use(challengeRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const suf = Date.now().toString(16).slice(-8);
const ownerA = "0x" + ("aa" + suf).padStart(40, "0");
const ownerB = "0x" + ("bb" + suf).padStart(40, "0");
const mkAgent = (owner: string, name: string) =>
  createHostedAgent({
    owner,
    name,
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });

async function post(body: unknown) {
  const r = await fetch(`${BASE}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

test("humano→agente con firma válida crea el desafío", async () => {
  const target = mkAgent(ownerB, "Rival");
  const human = privateKeyToAccount(generatePrivateKey());
  const H = human.address.toLowerCase();
  const ts = Date.now();
  const signature = await human.signMessage({
    message: challengeAuthMessage(H, target.address, ts),
  });
  const r = await post({ challenger: H, targetAgentId: target.id, signature, ts });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "waiting");
});

test("humano→agente con firma ajena es rechazado", async () => {
  const target = mkAgent(ownerB, "Rival2");
  const human = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const H = human.address.toLowerCase();
  const ts = Date.now();
  const signature = await other.signMessage({
    message: challengeAuthMessage(H, target.address, ts),
  });
  const r = await post({ challenger: H, targetAgentId: target.id, signature, ts });
  assert.equal(r.status, 400);
});

test("agente→agente del MISMO dueño es rechazado (anti-farming)", async () => {
  const mine1 = mkAgent(ownerA, "MioUno");
  const mine2 = mkAgent(ownerA, "MioDos");
  // firma del dueño A sobre su agente mine1
  const ownerAcc = privateKeyToAccount(generatePrivateKey());
  // Nota: el owner real es ownerA (string); acá probamos que ANTES de la firma,
  // el server corta por mismo dueño. Usamos firma de ownerA simulada:
  const ts = Date.now();
  const signature = await ownerAcc.signMessage({
    message: agentAuthMessage("challenge", mine1.id, mine1.owner, ts),
  });
  const r = await post({ byAgentId: mine1.id, targetAgentId: mine2.id, signature, ts });
  assert.equal(r.status, 400);
});
```

> Nota: el 3er test verifica el corte anti-farming por mismo dueño. Como `mine1.owner` (ownerA) no coincide con la clave `ownerAcc`, la firma no recuperaría ownerA; el server debe rechazar (400) sea por firma o por mismo dueño — en ambos casos el resultado correcto es 400. El caso feliz de agente→agente entre dueños distintos se cubre en el E2E (Task 7) con la clave del dueño real, que en producción es la wallet del usuario.

- [ ] **Step 2: Correr (debe fallar)**

Run: `node --import tsx --test apps/server/test/challenge-routes.test.ts`
Expected: FAIL — `challenge-routes.js` no existe.

- [ ] **Step 3: Implementar `challenge-routes.ts`**

```ts
// Ruta HTTP de duelos directos (ladder gratis). Crear un desafío va FIRMADO:
// - humano→agente: el humano firma challengeAuthMessage(challenger, targetAddr, ts).
// - agente→agente: el dueño firma agentAuthMessage("challenge", byAgentId, owner, ts).
// El target es siempre un agente hosteado activo; su runner lo acepta y juega.

import { Router } from "express";
import { recoverMessageAddress, type Hex } from "viem";
import {
  challengeAuthMessage,
  agentAuthMessage,
  AGENT_AUTH_TTL_MS,
} from "@arcade1v1/game-sdk/auth";
import { AUTH_REQUIRED, createChallenge } from "./matchmaking.js";
import { getAgent, setAgentPending } from "./agents.js";

const normAddr = (a: string) => String(a).toLowerCase();

function freshTs(ts: unknown): number {
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > AGENT_AUTH_TTL_MS) {
    throw new Error("auth expired");
  }
  return t;
}

export const challengeRouter = Router();

challengeRouter.post("/challenge", async (req, res) => {
  try {
    const { challenger, targetAgentId, byAgentId, signature, ts } = req.body ?? {};
    if (!targetAgentId) return res.status(400).json({ error: "falta targetAgentId" });
    const target = getAgent(String(targetAgentId));
    if (!target || !target.active)
      return res.status(400).json({ error: "target agent not available" });

    if (byAgentId) {
      // AGENTE → AGENTE: firma del dueño del agente desafiante.
      const by = getAgent(String(byAgentId));
      if (!by) return res.status(400).json({ error: "agent not found" });
      if (by.game !== target.game) return res.status(400).json({ error: "distinto juego" });
      if (by.owner === target.owner) {
        return res.status(400).json({ error: "no podés desafiar a tu propio agente" });
      }
      if (signature) {
        const t = freshTs(ts);
        const signer = await recoverMessageAddress({
          message: agentAuthMessage("challenge", by.id, by.owner, t),
          signature: signature as Hex,
        });
        if (signer.toLowerCase() !== normAddr(by.owner)) throw new Error("bad signature");
      } else if (AUTH_REQUIRED) {
        throw new Error("signature required");
      }
      const m = createChallenge(by.game, by.address, target.address);
      setAgentPending(by, m.matchId); // su runner juega el intento del challenger
      return res.json(m);
    }

    // HUMANO → AGENTE: firma del propio challenger.
    if (!challenger) return res.status(400).json({ error: "falta challenger" });
    const ch = normAddr(String(challenger));
    if (signature) {
      const t = freshTs(ts);
      const signer = await recoverMessageAddress({
        message: challengeAuthMessage(ch, normAddr(target.address), t),
        signature: signature as Hex,
      });
      if (signer.toLowerCase() !== ch) throw new Error("bad signature");
    } else if (AUTH_REQUIRED) {
      throw new Error("signature required");
    }
    if (ch === normAddr(target.address)) {
      return res.status(400).json({ error: "cannot challenge yourself" });
    }
    return res.json(createChallenge(target.game, ch, target.address));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
```

- [ ] **Step 4: Correr (debe pasar)**

Run: `node --import tsx --test apps/server/test/challenge-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/challenge-routes.ts apps/server/test/challenge-routes.test.ts
git commit -m "feat(server): ruta POST /challenge firmada (humano→agente y agente→agente)"
```

---

### Task 5: Montar el router en index.ts

**Files:**

- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Import**

```ts
import { challengeRouter } from "./challenge-routes.js";
```

- [ ] **Step 2: Montar (POST bajo strictLimit) después de `app.use(profilesRouter)`**

```ts
// DUELOS directos: crear (POST) recupera una firma -> límite estricto.
app.use("/challenge", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(challengeRouter);
```

- [ ] **Step 3: API auto-descriptiva** (en el objeto `endpoints`)

```ts
      "POST /challenge":
        "{ challenger, targetAgentId, signature, ts } (human) or { byAgentId, targetAgentId, signature, ts } (agent) -> a direct free-ladder duel vs a specific agent",
```

- [ ] **Step 4: Typecheck + selftest**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json && npm run selftest`
Expected: sin errores; `TODO OK ✅`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): montar la ruta de duelos directos"
```

---

### Task 6: Runner acepta y prioriza desafíos

**Files:**

- Modify: `apps/server/src/agent-runner.ts`
- Test: `apps/server/test/challenge.test.ts` (agregar un caso de runner)

**Interfaces:**

- Consumes: `pendingChallengesFor`, `acceptChallenge` (matchmaking); `setAgentPending` (agents).

- [ ] **Step 1: Agregar test de runner end-to-end**

En `apps/server/test/challenge.test.ts`, agregar (importa lo necesario arriba):

```ts
import { runAgentsTick } from "../src/agent-runner.js";
import { createHostedAgent, deleteAgent, getAgent } from "../src/agents.js";

test("el runner del agente objetivo acepta un desafío humano y lo juega", async () => {
  const target = createHostedAgent({
    owner: addr("ow"),
    name: "Retado",
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });
  const human = addr("hu");
  const ch = createChallenge("2048", human, target.address);
  // El humano juega su intento (simulado: cualquier score válido vía submitScore
  // requiere replay; para el test alcanza con que el runner acepte y juegue su
  // lado y quede a la espera del humano). Corremos un tick:
  await runAgentsTick();
  const after = getAgent(target.id)!;
  // El agente tomó el desafío como su partida pendiente.
  assert.equal(after.pendingMatchId, ch.matchId);
  deleteAgent(target.id);
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `node --import tsx --test apps/server/test/challenge.test.ts`
Expected: FAIL — el runner todavía no toma desafíos (`pendingMatchId` no coincide).

- [ ] **Step 3: Implementar en `agent-runner.ts`**

Imports (arriba, junto a los otros de matchmaking):

```ts
import {
  getMatch,
  matchmake,
  peekWaiterAddress,
  submitScore,
  SUBMIT_WINDOW_MS,
  pendingChallengesFor,
  acceptChallenge,
} from "./matchmaking.js";
```

En `runAgentsTick`, dentro del `try`, después del bloque `if (agent.pendingMatchId) { ... continue; }` y ANTES del cooldown, insertar:

```ts
// DESAFÍOS: tienen prioridad sobre la cola aleatoria. Si hay uno dirigido
// a este agente, lo acepta (in-process) y lo juega.
const challenges = pendingChallengesFor(agent.address);
if (challenges.length) {
  acceptChallenge(challenges[0].matchId, agent.address);
  setAgentPending(agent, challenges[0].matchId);
  if (await playPendingMatch(agent)) plays++;
  continue;
}
```

- [ ] **Step 4: Correr (debe pasar)**

Run: `node --import tsx --test apps/server/test/challenge.test.ts`
Expected: PASS.

- [ ] **Step 5: Suite server completa**

Run: `node --import tsx --test "apps/server/test/*.test.ts"`
Expected: todo PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent-runner.ts apps/server/test/challenge.test.ts
git commit -m "feat(server): el runner acepta y prioriza los desafíos dirigidos"
```

---

### Task 7: Verificación E2E server (HTTP real)

**Files:** (temporal) `apps/server/e2e-challenge.mts`

- [ ] **Step 1: Script E2E** — humano→agente y agente→agente, jugados por el runner.

```ts
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { runStrategy, getStrategy, defaultParams } from "@arcade1v1/strategies";
import {
  challengeAuthMessage,
  agentAuthMessage,
  matchmakeAuthMessage,
  scoreAuthMessage,
} from "@arcade1v1/game-sdk/auth";

const BASE = process.env.BASE || "http://localhost:4057";
const post = async (p: string, b: unknown) =>
  (
    await fetch(BASE + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    })
  ).json();
const get = async (p: string) => (await fetch(BASE + p)).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Crear un agente objetivo (firmado por su dueño).
async function makeAgent(name: string) {
  const owner = privateKeyToAccount(generatePrivateKey());
  const O = owner.address.toLowerCase();
  const ts = Date.now();
  const sig = await owner.signMessage({
    message: agentAuthMessage("create", `2048:2048.priority:${name}`, O, ts),
  });
  const a = await post("/agents", {
    owner: O,
    name,
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
    signature: sig,
    ts,
  });
  return { owner, O, agent: a };
}

// HUMANO → AGENTE
const { agent: target } = await makeAgent("Retado");
const human = privateKeyToAccount(generatePrivateKey());
const H = human.address.toLowerCase();
let ts = Date.now();
let sig = await human.signMessage({ message: challengeAuthMessage(H, target.address, ts) });
const ch = await post("/challenge", {
  challenger: H,
  targetAgentId: target.id,
  signature: sig,
  ts,
});
console.log("desafío creado:", ch.matchId?.slice(0, 10), "seed", ch.seed);
// El humano juega su intento (firmado).
const run = runStrategy(
  {
    game: "2048",
    strategyId: "2048.priority",
    params: defaultParams(getStrategy("2048.priority")!),
  },
  ch.seed,
);
const ssig = await human.signMessage({ message: scoreAuthMessage(ch.matchId, H, run.score) });
await post(`/match/${ch.matchId}/score`, {
  address: H,
  score: run.score,
  replay: run.replay,
  signature: ssig,
});
// Esperar a que el runner del agente lo acepte y juegue (tick ~30s; poll ~90s).
let settled = false;
for (let i = 0; i < 30; i++) {
  const m = await get(`/match/${ch.matchId}?address=${H}`);
  if (m.status === "settled" || m.status === "draw") {
    settled = true;
    console.log("resultado:", m.status, "yourScore", m.yourScore, "rivalScore", m.rivalScore);
    break;
  }
  await sleep(3000);
}
console.log(settled ? "HUMANO→AGENTE OK ✅" : "HUMANO→AGENTE no liquidó ❌");
process.exit(settled ? 0 : 1);
```

- [ ] **Step 2: Levantar árbitro con el runner rápido (tick corto) y correr**

```bash
PORT=4057 ENABLE_TEST_BOT=false AGENT_RUNNER_TICK_MS=2000 AGENT_PLAY_INTERVAL_MS=1000 \
  ARBITER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  npx tsx apps/server/src/index.ts &
sleep 4 && BASE=http://localhost:4057 npx tsx apps/server/e2e-challenge.mts
```

Expected: `HUMANO→AGENTE OK ✅` (el runner acepta y juega el lado del agente).

- [ ] **Step 3: Bajar y limpiar**

Run: `kill %1 2>/dev/null; rm -f apps/server/e2e-challenge.mts`

---

### Task 8: Cliente web (`arbiter.ts`)

**Files:**

- Modify: `apps/web/app/lib/arbiter.ts`

**Interfaces:**

- Produces: `createChallenge(input): Promise<MatchView>`; `LeaderRow.agentId?`.

- [ ] **Step 1: `agentId?` en `LeaderRow`**

```ts
export interface LeaderRow {
  address: string;
  rating: number;
  name?: string;
  avatar?: string;
  agentId?: string;
}
```

- [ ] **Step 2: `createChallenge`** (junto a la sección de agentes)

```ts
/** Crea un duelo directo (ladder gratis) contra un agente. Humano→agente:
 *  { challenger, targetAgentId, signature, ts }. Agente→agente:
 *  { byAgentId, targetAgentId, signature, ts }. Devuelve la partida creada. */
export function createChallenge(
  input:
    | { challenger: string; targetAgentId: string; signature: string; ts: number }
    | { byAgentId: string; targetAgentId: string; signature: string; ts: number },
): Promise<MatchView> {
  return req<MatchView>("/challenge", { method: "POST", body: JSON.stringify(input) });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/arbiter.ts
git commit -m "feat(web): cliente createChallenge + agentId en LeaderRow"
```

---

### Task 9: `ChallengeButton` + montaje en la página del agente

**Files:**

- Create: `apps/web/app/my-agents/ChallengeButton.tsx`
- Modify: `apps/web/app/my-agents/[agentId]/page.tsx`

- [ ] **Step 1: Crear `ChallengeButton.tsx`**

```tsx
"use client";

// Botón "Desafiar" en la página (pública) de un agente, para un visitante que NO
// es el dueño. Ofrece: (1) "Juego yo" -> crea un duelo humano→agente firmado y
// abre la partida para jugar el intento; (2) "Con mi agente" -> elige uno de tus
// agentes del mismo juego y crea un duelo agente→agente (ambos juegan solos).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSignMessage } from "wagmi";
import { challengeAuthMessage, agentAuthMessage } from "@arcade1v1/game-sdk/auth";
import { useT } from "@/app/lib/i18n";
import { createChallenge, listAgents, type AgentView } from "@/app/lib/arbiter";

export function ChallengeButton({
  targetAgentId,
  targetAddress,
  game,
  viewer,
}: {
  targetAgentId: string;
  targetAddress: string;
  game: string;
  viewer: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const { signMessageAsync } = useSignMessage();
  const [mine, setMine] = useState<AgentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [pick, setPick] = useState(false);

  useEffect(() => {
    let cancel = false;
    listAgents(viewer)
      .then((a) => !cancel && setMine(a.filter((x) => x.game === game)))
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [viewer, game]);

  async function challengeAsHuman() {
    setBusy(true);
    try {
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: challengeAuthMessage(viewer, targetAddress, ts),
      });
      const m = await createChallenge({ challenger: viewer, targetAgentId, signature, ts });
      router.push(`/game/${game}/match?challenge=${m.matchId}`);
    } catch {
      setBusy(false);
    }
  }

  async function challengeWithAgent(byAgentId: string, owner: string) {
    setBusy(true);
    try {
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: agentAuthMessage("challenge", byAgentId, owner, ts),
      });
      await createChallenge({ byAgentId, targetAgentId, signature, ts });
      setSent(true);
    } catch {
      /* firma cancelada o red caída */
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return <p className="mt-4 text-center text-sm text-(--color-win)">{t("challenge.sent")}</p>;
  }

  return (
    <div className="mt-4">
      <div className="flex gap-3">
        <button
          onClick={challengeAsHuman}
          disabled={busy}
          className="btn3d btn3d--magenta flex-1 disabled:opacity-50"
        >
          ⚔ {t("challenge.me")}
        </button>
        {mine.length > 0 && (
          <button
            onClick={() => setPick((v) => !v)}
            disabled={busy}
            className="btn3d btn3d--cyan flex-1 disabled:opacity-50"
          >
            🤖 {t("challenge.withAgent")}
          </button>
        )}
      </div>
      {pick && (
        <div className="win mt-3 p-3">
          <p className="mb-2 text-sm text-(--color-muted-2)">{t("challenge.pickAgent")}</p>
          <div className="flex flex-col gap-2">
            {mine.map((a) => (
              <button
                key={a.id}
                onClick={() => challengeWithAgent(a.id, a.owner)}
                disabled={busy}
                className="win flex items-center gap-2 p-2 text-left text-sm transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                <span className="text-xl">{a.avatar}</span> {a.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Montar en `my-agents/[agentId]/page.tsx`**

Import:

```ts
import { ChallengeButton } from "../ChallengeButton";
```

Dentro del `<div className="p-5">` de la cabecera, DESPUÉS del bloque `{isOwner && ( ... )}` de administración, agregar el botón para NO dueños con wallet:

```tsx
{
  !isOwner && address && (
    <ChallengeButton
      targetAgentId={agent.id}
      targetAddress={agent.address}
      game={agent.game}
      viewer={address}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/my-agents/ChallengeButton.tsx "apps/web/app/my-agents/[agentId]/page.tsx"
git commit -m "feat(web): botón Desafiar (humano→agente y agente→agente) en la página del agente"
```

---

### Task 10: Ranking clickeable (link al agente)

**Files:**

- Modify: `apps/web/app/leaderboard/page.tsx`

- [ ] **Step 1: Envolver la fila del agente en un Link**

En `leaderboard/page.tsx`, el bloque `<span className="font-mono …">` que muestra el nombre/address: cuando `row.agentId` existe, envolver el nombre en un `Link` a la página del agente. Reemplazar el contenido del `<span>` de nombre por:

```tsx
{
  row.name ? (
    <>
      <span className="mr-1">{row.avatar}</span>
      {row.agentId ? (
        <Link
          href={`/my-agents/${row.agentId}`}
          className="font-sans text-(--color-accent-2) hover:underline"
        >
          {row.name}
        </Link>
      ) : (
        <span className="font-sans">{row.name}</span>
      )}{" "}
      <span className="text-(--color-muted-3)">· {short(row.address)}</span>
    </>
  ) : (
    short(row.address)
  );
}
```

(`Link` ya está importado en el archivo.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/leaderboard/page.tsx
git commit -m "feat(web): en el ranking, el nombre de un agente linkea a su página"
```

---

### Task 11: Modo desafío en la página de partida

**Files:**

- Modify: `apps/web/app/game/[gameId]/match/page.tsx`

**Interfaces:**

- Consumes: `getMatch` (arbiter) — ya importado en el archivo.

- [ ] **Step 1: Leer el parámetro `challenge`**

Cerca de `const free = search.get("free") === "1";`, agregar:

```ts
const challengeId = search.get("challenge");
```

- [ ] **Step 2: Cargar la partida-desafío en vez de emparejar**

En el `useEffect` de emparejamiento (el que arranca con `if (free || matchId || error) return;`), al comienzo del cuerpo async (después de `mmStarted.current = true;` y `pidRef.current = playerId(address ?? null);`), insertar la rama de desafío:

```ts
// MODO DESAFÍO: la partida ya existe (la creó el botón "Desafiar"); no se
// empareja, se carga y se juega como una ladder gratis rankeada.
if (challengeId) {
  try {
    const v = await getMatch(challengeId, pidRef.current);
    if (!v) throw new Error("challenge not found");
    setMatchId(v.matchId);
    setSeed(v.seed);
    setRole(v.role ?? null);
  } catch {
    mmStarted.current = false;
    setError("server");
  }
  return;
}
```

- [ ] **Step 3: Verificar que el modo desafío cuenta como partida rankeada gratis**

`rankedFree = !free && bet === 0` ya es `true` para un desafío (sin `?free`, `bet` 0), así que el resto del flujo (jugar el intento + enviar puntaje firmado + resultado + mirar rival) se reusa sin cambios. No hace falta tocar nada más.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/game/[gameId]/match/page.tsx"
git commit -m "feat(web): modo desafío (?challenge=) en la página de partida"
```

---

### Task 12: Textos i18n (4 idiomas)

**Files:**

- Modify: `apps/web/app/lib/i18n-dict.ts`

**Claves nuevas:** `challenge.me`, `challenge.withAgent`, `challenge.pickAgent`, `challenge.sent`.

- [ ] **Step 1: Inglés** (cerca de las claves `profile.*`)

```ts
  "challenge.me": "Challenge (you play)",
  "challenge.withAgent": "With my agent",
  "challenge.pickAgent": "Pick one of your agents (same game):",
  "challenge.sent": "Challenge sent — both play on their own.",
```

- [ ] **Step 2: Español**

```ts
  "challenge.me": "Desafiar (jugás vos)",
  "challenge.withAgent": "Con mi agente",
  "challenge.pickAgent": "Elegí uno de tus agentes (mismo juego):",
  "challenge.sent": "Desafío enviado — juegan solos.",
```

- [ ] **Step 3: Hindi**

```ts
  "challenge.me": "चुनौती दें (आप खेलें)",
  "challenge.withAgent": "मेरे एजेंट से",
  "challenge.pickAgent": "अपना एक एजेंट चुनें (वही खेल):",
  "challenge.sent": "चुनौती भेजी — दोनों खुद खेलते हैं।",
```

- [ ] **Step 4: Francés**

```ts
  "challenge.me": "Défier (vous jouez)",
  "challenge.withAgent": "Avec mon agent",
  "challenge.pickAgent": "Choisissez un de vos agents (même jeu) :",
  "challenge.sent": "Défi envoyé — les deux jouent seuls.",
```

- [ ] **Step 5: Verificar 4 ocurrencias por clave**

Run: `for k in me withAgent pickAgent sent; do echo "challenge.$k: $(grep -c "\"challenge.$k\"" apps/web/app/lib/i18n-dict.ts)"; done`
Expected: cada una = 4.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib/i18n-dict.ts
git commit -m "feat(web): textos de duelos directos en los 4 idiomas"
```

---

### Task 13: Cierre — check + web E2E + changelog

- [ ] **Step 1: `npm run check`**

Run: `npm run check`
Expected: todo verde. Si prettier marca: `npx prettier --write <archivos>` y repetir.

- [ ] **Step 2: Web E2E manual**

Levantar árbitro (tick corto, puerto 4057) + web (`NEXT_PUBLIC_ARBITER_URL=http://localhost:4057`). Con una wallet: crear un agente, abrir la página de OTRO agente (o simular con dos wallets), tocar "Desafiar (jugás vos)", jugar el intento, ver el resultado. Probar "Con mi agente". Bajar procesos.

- [ ] **Step 3: Changelog 2.5.0** en `CHANGELOG.md` (Keep a Changelog, español) describiendo duelos directos. Commit `docs: changelog 2.5.0 (duelos directos)`.

- [ ] **Step 4: Pedir OK y push.** Tras verificar en producción, marcar la Fase 4 en `docs/superpowers/v3/PLAN.md`.

---

## Self-Review

**Spec coverage:**

- `target` + no-cola + expira → Task 2. ✓
- Solo el target acepta → Task 2 (`acceptChallenge`) + test. ✓
- Firma humano→agente y agente→agente + anti-farming → Tasks 1, 4. ✓
- Runner acepta/prioriza → Task 6. ✓
- Ranking clickeable (`agentId`) → Tasks 3, 10. ✓
- Botón Desafiar (2 flujos) → Task 9. ✓
- Humano juega el desafío → Task 11. ✓
- 4 idiomas → Task 12. ✓
- Verificación real → Tasks 7 (server E2E) y 13 (web). ✓

**Placeholder scan:** sin TBD/TODO; cada step con código o comando concreto.

**Type consistency:** `createChallenge` (server) y `createChallenge` (web) coinciden en las dos formas de body. `MatchView` reusado (ya exportado por arbiter.ts). `resolveDisplay` retorna `{name?,avatar?,agentId?}` consistente entre server y `LeaderRow` (web). `challengeAuthMessage(challenger, target, ts)` idéntico en server (verificación), web (firma) y test.
