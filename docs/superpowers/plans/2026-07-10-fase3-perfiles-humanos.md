# Perfiles humanos (Fase 3) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un jugador humano elija nombre + avatar (firmado) y eso se vea, con fallback al address corto, en ranking, partidas que se miran e historial de rivales.

**Architecture:** Store nuevo `profiles` en el árbitro (mismo `jsonStore` que ratings/agentes) + endpoint firmado (`profileAuthMessage`, anti-replay por `ts`). La resolución nombre/avatar se hace en la **capa de rutas** (que ya importa todo), reusando `hostedAgentByAddress` (agente gana sobre perfil). La edición vive dentro de `/my-agents`. Diseño en [../specs/2026-07-10-perfiles-humanos-design.md](../specs/2026-07-10-perfiles-humanos-design.md).

**Tech Stack:** Node/Express + tsx (server, tests con `node:test`), Next.js App Router + wagmi (web), viem (firmas), i18n propio (4 idiomas).

## Global Constraints

- **Sin dependencias nuevas.** Reusar `jsonStore`, `sanitizeName`, `AGENT_AVATARS`, patrón `checkAuth`.
- **Firmas anti-replay:** address normalizada a minúsculas; `ts` con TTL `AGENT_AUTH_TTL_MS` (10 min); el firmante debe ser la propia address.
- **`AUTH_REQUIRED`:** con firma se acepta; sin firma se rechaza en prod (mismo criterio que agentes/matchmaking).
- **Tests herméticos:** los `.test.ts` NO importan `persist-on`, corren sin tocar disco/red. Importan `../src/offline-env.js` cuando necesitan clave/entorno offline.
- **Honestidad UI:** el nombre nunca reemplaza del todo la identidad — SIEMPRE se muestra el address corto al lado. Nombres no únicos.
- **4 idiomas:** todo texto nuevo va en en/es/hi/fr (`apps/web/app/lib/i18n-dict.ts`).
- **`npm run check`** en verde antes de cerrar (typecheck + eslint + prettier + tests + selftest).

## File Structure

- `packages/game-sdk/src/auth.ts` (modificar) — `profileAuthMessage`.
- `apps/server/src/agents.ts` (modificar) — exportar `sanitizeName`.
- `apps/server/src/profiles.ts` (crear) — store + `setProfile`/`getProfile`/`resolveDisplay`/`restoreProfiles`.
- `apps/server/src/profiles-routes.ts` (crear) — `POST /profile`, `GET /profile/:address`.
- `apps/server/src/index.ts` (modificar) — montar router (POST bajo `strictLimit`), `restoreProfiles`, enriquecer leaderboard/recent/replay.
- `apps/server/src/agents-routes.ts` (modificar) — enriquecer `opponent` del historial.
- `apps/server/test/profiles.test.ts` (crear) — módulo.
- `apps/server/test/profiles-routes.test.ts` (crear) — rutas firmadas.
- `apps/web/app/lib/arbiter.ts` (modificar) — `getProfile`/`setProfile` + `name?`/`avatar?` en tipos.
- `apps/web/app/my-agents/ProfileEditor.tsx` (crear) — tarjeta + editor.
- `apps/web/app/my-agents/page.tsx` (modificar) — montar la tarjeta.
- `apps/web/app/leaderboard/page.tsx`, `apps/web/app/watch/page.tsx`, `apps/web/app/watch/[matchId]/page.tsx`, `apps/web/app/my-agents/[agentId]/page.tsx` (modificar) — mostrar name/avatar.
- `apps/web/app/lib/i18n-dict.ts` (modificar) — textos ×4.

---

### Task 1: `profileAuthMessage` en el game-sdk

**Files:**

- Modify: `packages/game-sdk/src/auth.ts`
- Test: `packages/game-sdk/test/auth.test.ts` (crear si no existe; si existe, agregar el caso)

**Interfaces:**

- Produces: `profileAuthMessage(action: string, address: string, ts: number): string`

- [ ] **Step 1: Ver si hay test de auth y su forma**

Run: `ls packages/game-sdk/test/ 2>/dev/null; grep -rn "agentAuthMessage" packages/game-sdk/test/ 2>/dev/null`
Si no hay archivo, se crea en el Step 2.

- [ ] **Step 2: Escribir el test que falla**

En `packages/game-sdk/test/auth.test.ts` (crear o agregar):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { profileAuthMessage } from "../src/auth.ts";

test("profileAuthMessage: formato estable y address en minúsculas", () => {
  const msg = profileAuthMessage(
    "set",
    "0xABCDef0000000000000000000000000000000001",
    1730000000000,
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: edito mi perfil",
      "action: set",
      "player: 0xabcdef0000000000000000000000000000000001",
      "ts: 1730000000000",
    ].join("\n"),
  );
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `node --import tsx --test packages/game-sdk/test/auth.test.ts`
Expected: FAIL — `profileAuthMessage` no existe / no exportado.

- [ ] **Step 4: Implementar**

En `packages/game-sdk/src/auth.ts`, después de `agentAuthMessage`:

```ts
/** Mensaje a firmar para editar el PERFIL humano (nombre + avatar). Ata:
 *  acción + la propia address + momento (ts). El firmante debe ser esa address:
 *  nadie edita el perfil de otro. */
export function profileAuthMessage(action: string, address: string, ts: number): string {
  return [
    "Arcade1v1: edito mi perfil",
    `action: ${action}`,
    `player: ${address.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `node --import tsx --test packages/game-sdk/test/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/game-sdk/src/auth.ts packages/game-sdk/test/auth.test.ts
git commit -m "feat(game-sdk): profileAuthMessage para editar perfil humano firmado"
```

---

### Task 2: Store de perfiles (`profiles.ts`)

**Files:**

- Create: `apps/server/src/profiles.ts`
- Modify: `apps/server/src/agents.ts` (exportar `sanitizeName`)
- Test: `apps/server/test/profiles.test.ts`

**Interfaces:**

- Consumes: `jsonStore` (persist.ts), `hostedAgentByAddress`, `sanitizeName`, `AGENT_AVATARS` (agents.ts).
- Produces:
  - `interface Profile { name: string; avatar: string; updatedAt: number }`
  - `setProfile(input: { address: string; name: unknown; avatar: unknown }): Profile`
  - `getProfile(address: string): Profile | undefined`
  - `resolveDisplay(address: string): { name?: string; avatar?: string }`
  - `restoreProfiles(): Promise<void>`

- [ ] **Step 1: Exportar `sanitizeName` en agents.ts**

En `apps/server/src/agents.ts`, cambiar la declaración (hoy `function sanitizeName`) a `export function sanitizeName`:

```ts
/** Nombre saneado: imprimible, sin saltos de línea, largo acotado. */
export function sanitizeName(raw: unknown): string {
```

- [ ] **Step 2: Escribir el test que falla**

`apps/server/test/profiles.test.ts`:

```ts
// Tests del store de perfiles humanos: saneo de nombre, allowlist de avatar,
// resolución (agente gana sobre perfil) y tope con desalojo. Herméticos.
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { setProfile, getProfile, resolveDisplay } from "../src/profiles.js";
import { createHostedAgent, deleteAgent } from "../src/agents.js";

const suffix = Date.now().toString(16).slice(-8);
const addr = (tag: string) => "0x" + (tag + suffix).padStart(40, "0");

test("setProfile sanea el nombre y respeta la allowlist de avatar", () => {
  const a = addr("a1");
  const p = setProfile({ address: a.toUpperCase(), name: "  Ana\n", avatar: "🚫noExiste" });
  assert.equal(p.name, "Ana");
  assert.notEqual(p.avatar, "🚫noExiste"); // cae al default de la allowlist
  assert.equal(getProfile(a)?.name, "Ana"); // guardado por address en minúsculas
});

test("setProfile rechaza nombre vacío", () => {
  assert.throws(() => setProfile({ address: addr("a2"), name: "   ", avatar: "👾" }), /name/);
});

test("getProfile ausente -> undefined", () => {
  assert.equal(getProfile(addr("ff")), undefined);
});

test("resolveDisplay: agente gana sobre perfil; perfil sobre nada", () => {
  const owner = addr("b0");
  const agent = createHostedAgent({
    owner,
    name: "AgenteBot",
    avatar: "🤖",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });
  // La address del agente resuelve a su nombre aunque tenga (hipotéticamente) perfil.
  setProfile({ address: agent.address, name: "Humano", avatar: "👾" });
  assert.equal(resolveDisplay(agent.address).name, "AgenteBot");

  const human = addr("c0");
  setProfile({ address: human, name: "Sol", avatar: "👾" });
  assert.equal(resolveDisplay(human).name, "Sol");

  assert.deepEqual(resolveDisplay(addr("d0")), {}); // sin nada
  deleteAgent(agent.id);
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `node --import tsx --test apps/server/test/profiles.test.ts`
Expected: FAIL — `profiles.js` no existe.

- [ ] **Step 4: Implementar `profiles.ts`**

```ts
// PERFILES HUMANOS: nombre + avatar por wallet, para que un jugador deje de
// verse como 0x1234…abcd en el ranking, las partidas y el historial. Reusa la
// validación de agentes (sanitizeName + AGENT_AVATARS): nada de reglas nuevas.
// Persistencia con el mismo jsonStore que ratings/agentes (sobrevive redeploys).
//
// resolveDisplay resuelve una address a su nombre/avatar visible: un AGENTE
// hosteado gana (ya tiene identidad propia), luego el perfil humano, si no nada
// (la web cae al address corto). profiles.ts puede importar agents.ts sin ciclo:
// nada del server importa profiles.

import { jsonStore } from "./persist.js";
import { hostedAgentByAddress, sanitizeName, AGENT_AVATARS } from "./agents.js";

export interface Profile {
  name: string;
  avatar: string;
  updatedAt: number;
}

// Opt-in (solo se crea al firmar), pero con tope + desalojo del menos reciente:
// un spammer con muchas wallets no puede hacerlo crecer sin fin.
const MAX_PROFILES = Number(process.env.MAX_PROFILES ?? 5000);

const store$ = jsonStore("profiles");
const profiles = new Map<string, Profile>(); // address(lowercase) -> Profile
const normAddr = (a: string) => String(a).toLowerCase();

function save() {
  store$.save(() => JSON.stringify([...profiles.entries()]));
}

/** Desaloja los perfiles menos recientes si se superó el tope (nunca el recién tocado). */
function evictIfNeeded(keep: string) {
  if (profiles.size <= MAX_PROFILES) return;
  const victims = [...profiles.entries()]
    .filter(([a]) => a !== keep)
    .sort((x, y) => x[1].updatedAt - y[1].updatedAt)
    .slice(0, profiles.size - MAX_PROFILES);
  for (const [a] of victims) profiles.delete(a);
}

export function setProfile(input: { address: string; name: unknown; avatar: unknown }): Profile {
  const address = normAddr(input.address);
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("bad address");
  const profile: Profile = {
    name: sanitizeName(input.name), // tira si viene vacío/solo-control
    avatar: AGENT_AVATARS.includes(String(input.avatar)) ? String(input.avatar) : AGENT_AVATARS[0],
    updatedAt: Date.now(),
  };
  profiles.set(address, profile);
  evictIfNeeded(address);
  save();
  return profile;
}

export function getProfile(address: string): Profile | undefined {
  return profiles.get(normAddr(address));
}

/** Nombre/avatar visible de una address: agente hosteado -> su identidad;
 *  humano con perfil -> el suyo; si no, {} (la web cae al address corto). */
export function resolveDisplay(address: string): { name?: string; avatar?: string } {
  const a = normAddr(address);
  const agent = hostedAgentByAddress(a);
  if (agent) return { name: agent.name, avatar: agent.avatar };
  const p = profiles.get(a);
  if (p) return { name: p.name, avatar: p.avatar };
  return {};
}

/** Restaura los perfiles guardados. La llama index.ts ANTES de escuchar. */
export async function restoreProfiles(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    const arr = JSON.parse(raw) as [string, Profile][];
    for (const [a, p] of arr) profiles.set(normAddr(a), p);
    if (arr.length) console.log(`Perfiles recuperados: ${arr.length}`);
  } catch (e) {
    console.error("profiles restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `node --import tsx --test apps/server/test/profiles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/profiles.ts apps/server/src/agents.ts apps/server/test/profiles.test.ts
git commit -m "feat(server): store de perfiles humanos con resolución agente>perfil"
```

---

### Task 3: Rutas de perfil firmadas (`profiles-routes.ts`)

**Files:**

- Create: `apps/server/src/profiles-routes.ts`
- Test: `apps/server/test/profiles-routes.test.ts`

**Interfaces:**

- Consumes: `profileAuthMessage`, `AGENT_AUTH_TTL_MS` (game-sdk), `AUTH_REQUIRED` (matchmaking), `setProfile`/`getProfile` (profiles).
- Produces: `export const profilesRouter: Router` con `POST /profile` (`{ profile }`) y `GET /profile/:address` (`{ profile: Profile | null }`).

- [ ] **Step 1: Escribir el test que falla**

`apps/server/test/profiles-routes.test.ts`:

```ts
// Tests HTTP de perfiles: firma del dueño obligatoria (REQUIRE_AUTH), address
// ajena rechazada, ts vencido rechazado, y GET que devuelve null sin perfil.
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { profileAuthMessage, AGENT_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";

process.env.REQUIRE_AUTH = "true";
const { profilesRouter } = await import("../src/profiles-routes.js");

const app = express();
app.use(express.json());
app.use(profilesRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const me = privateKeyToAccount(generatePrivateKey());
const ADDR = me.address.toLowerCase();

async function post(body: unknown) {
  const r = await fetch(`${BASE}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

test("POST /profile con firma válida guarda", async () => {
  const ts = Date.now();
  const signature = await me.signMessage({ message: profileAuthMessage("set", ADDR, ts) });
  const r = await post({ address: ADDR, name: "Nico", avatar: "👾", signature, ts });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.name, "Nico");
});

test("POST /profile sin firma es rechazado (REQUIRE_AUTH)", async () => {
  const r = await post({ address: ADDR, name: "X", avatar: "👾" });
  assert.equal(r.status, 400);
});

test("POST /profile con firma de OTRA address es rechazado", async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  const ts = Date.now();
  // Firma la víctima-address pero con la clave de 'other'
  const signature = await other.signMessage({ message: profileAuthMessage("set", ADDR, ts) });
  const r = await post({ address: ADDR, name: "Impostor", avatar: "👾", signature, ts });
  assert.equal(r.status, 400);
});

test("POST /profile con ts vencido es rechazado", async () => {
  const ts = Date.now() - AGENT_AUTH_TTL_MS - 1000;
  const signature = await me.signMessage({ message: profileAuthMessage("set", ADDR, ts) });
  const r = await post({ address: ADDR, name: "Tarde", avatar: "👾", signature, ts });
  assert.equal(r.status, 400);
});

test("GET /profile/:address sin perfil devuelve null (200)", async () => {
  const r = await fetch(`${BASE}/profile/0x${"9".repeat(40)}`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).profile, null);
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `node --import tsx --test apps/server/test/profiles-routes.test.ts`
Expected: FAIL — `profiles-routes.js` no existe.

- [ ] **Step 3: Implementar `profiles-routes.ts`**

```ts
// Rutas HTTP de perfiles humanos. Editar exige la firma del propio dueño
// (profileAuthMessage con ts anti-replay), igual que el resto de la API. Leer
// es público (no hay nada secreto en un nombre/avatar).

import { Router } from "express";
import { recoverMessageAddress, type Hex } from "viem";
import { profileAuthMessage, AGENT_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { AUTH_REQUIRED } from "./matchmaking.js";
import { setProfile, getProfile } from "./profiles.js";

const normAddr = (a: string) => String(a).toLowerCase();

export const profilesRouter = Router();

// Perfil público de una address (o null si no tiene). Sin perfil no es error.
profilesRouter.get("/profile/:address", (req, res) => {
  res.json({ profile: getProfile(req.params.address) ?? null });
});

// Crear/editar el perfil propio. Firma sobre profileAuthMessage("set", addr, ts).
profilesRouter.post("/profile", async (req, res) => {
  try {
    const { address, name, avatar, signature, ts } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "falta address" });
    const addr = normAddr(String(address));
    if (signature) {
      const t = Number(ts);
      if (!Number.isFinite(t) || Math.abs(Date.now() - t) > AGENT_AUTH_TTL_MS) {
        throw new Error("auth expired");
      }
      const signer = await recoverMessageAddress({
        message: profileAuthMessage("set", addr, t),
        signature: signature as Hex,
      });
      if (signer.toLowerCase() !== addr) throw new Error("bad signature");
    } else if (AUTH_REQUIRED) {
      throw new Error("signature required");
    }
    res.json({ profile: setProfile({ address: addr, name, avatar }) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `node --import tsx --test apps/server/test/profiles-routes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/profiles-routes.ts apps/server/test/profiles-routes.test.ts
git commit -m "feat(server): rutas de perfil firmadas (POST/GET /profile)"
```

---

### Task 4: Montar rutas + restore + enriquecer respuestas en `index.ts`

**Files:**

- Modify: `apps/server/src/index.ts`

**Interfaces:**

- Consumes: `profilesRouter`, `restoreProfiles`, `resolveDisplay` (profiles).
- Produces: leaderboard/recent/replay ahora incluyen `name?`/`avatar?` por jugador; `POST /profile` bajo `strictLimit`.

- [ ] **Step 1: Imports**

En `apps/server/src/index.ts`, junto a los imports del server:

```ts
import { profilesRouter } from "./profiles-routes.js";
import { restoreProfiles, resolveDisplay } from "./profiles.js";
```

- [ ] **Step 2: Montar el router (POST bajo strictLimit, GET libre)**

Después del bloque `app.use("/agents", …); app.use(agentsRouter);`:

```ts
// PERFILES humanos: editar (POST) recupera una firma -> límite estricto; leer libre.
app.use("/profile", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(profilesRouter);
```

- [ ] **Step 3: Enriquecer leaderboard**

Reemplazar el handler `app.get("/leaderboard/:game", …)`:

```ts
app.get("/leaderboard/:game", (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  const top = leaderboard(req.params.game, limit).map((row) => ({
    ...row,
    ...resolveDisplay(row.address),
  }));
  res.json({ game: req.params.game, top });
});
```

- [ ] **Step 4: Enriquecer recent + replay**

Reemplazar `app.get("/matches/recent", …)` y `app.get("/match/:id/replay", …)`:

```ts
app.get("/matches/recent", (req, res) => {
  const game = req.query.game ? String(req.query.game) : undefined;
  const limit = Number(req.query.limit ?? 20);
  const matches = recentMatches(game, limit).map((m) => ({
    ...m,
    players: m.players.map((p) => ({ ...p, ...resolveDisplay(p.address) })),
  }));
  res.json({ matches });
});

app.get("/match/:id/replay", (req, res) => {
  const out = publicReplay(req.params.id);
  if (!out) return res.status(404).json({ error: "match not found or not decided" });
  res.json({ ...out, players: out.players.map((p) => ({ ...p, ...resolveDisplay(p.address) })) });
});
```

- [ ] **Step 5: Agregar `restoreProfiles` al arranque**

Reemplazar la línea del `Promise.all`:

```ts
await Promise.all([
  restoreMatches(),
  restoreRatings(),
  restoreAgents(),
  restoreStats(),
  restoreProfiles(),
]);
```

- [ ] **Step 6: Agregar `GET /profile/:address` a la API auto-descriptiva**

En el objeto `endpoints` de `app.get("/", …)`, junto a los de agents:

```ts
      "POST /profile": "{ address, name, avatar, signature, ts } -> set your human display (name+avatar). Sign profileAuthMessage.",
      "GET /profile/:address": "a player's profile (name+avatar) or null",
```

- [ ] **Step 7: Typecheck + selftest**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json && npm run selftest`
Expected: sin errores de tipo; selftest `TODO OK ✅`.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): montar perfiles y resolver name/avatar en ranking/watch"
```

---

### Task 5: Enriquecer el historial del agente (`agents-routes.ts`)

**Files:**

- Modify: `apps/server/src/agents-routes.ts`

**Interfaces:**

- Consumes: `resolveDisplay` (profiles).
- Produces: cada entrada de `/agents/:id/matches` incluye `name?`/`avatar?` del **opponent**.

- [ ] **Step 1: Import**

En `apps/server/src/agents-routes.ts`:

```ts
import { resolveDisplay } from "./profiles.js";
```

- [ ] **Step 2: Enriquecer el handler de historial**

Reemplazar `agentsRouter.get("/agents/:id/matches", …)`:

```ts
agentsRouter.get("/agents/:id/matches", (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: "agent not found" });
  // name/avatar acá describen al RIVAL de cada partida (cada fila es "vs X").
  const matches = a.history.map((m) => ({
    ...m,
    ...(m.opponent ? resolveDisplay(m.opponent) : {}),
  }));
  res.json({ agentId: a.id, matches });
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/agents-routes.ts
git commit -m "feat(server): resolver nombre/avatar del rival en el historial del agente"
```

---

### Task 6: Verificación E2E server (real, por HTTP)

**Files:**

- (temporal, se borra) `apps/server/e2e-profiles.mts`

- [ ] **Step 1: Escribir el script E2E**

`apps/server/e2e-profiles.mts`:

```ts
// E2E real: setea un perfil firmado por HTTP y verifica que el leaderboard
// devuelve name/avatar para esa address (resolución server-side).
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { runStrategy, getStrategy, defaultParams } from "@arcade1v1/strategies";
import { profileAuthMessage } from "@arcade1v1/game-sdk/auth";
import { matchmakeAuthMessage, scoreAuthMessage } from "@arcade1v1/game-sdk/auth";

const BASE = process.env.BASE || "http://localhost:4056";
const acc = privateKeyToAccount(generatePrivateKey());
const ADDR = acc.address.toLowerCase();
const post = async (p: string, b: unknown) =>
  (
    await fetch(BASE + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    })
  ).json();
const get = async (p: string) => await fetch(BASE + p).json();

// 1) Setear perfil firmado
const ts = Date.now();
const signature = await acc.signMessage({ message: profileAuthMessage("set", ADDR, ts) });
const setRes = await post("/profile", {
  address: ADDR,
  name: "SolBenchmark",
  avatar: "🛸",
  signature,
  ts,
});
console.log("perfil seteado:", setRes.profile);

// 2) Jugar una partida en la ladder gratis para aparecer en el leaderboard
const ts2 = Date.now();
const mmSig = await acc.signMessage({ message: matchmakeAuthMessage("2048", 0, ADDR, ts2) });
const m = await post("/matchmake", {
  game: "2048",
  stake: 0,
  address: ADDR,
  signature: mmSig,
  ts: ts2,
});
const run = runStrategy(
  {
    game: "2048",
    strategyId: "2048.priority",
    params: defaultParams(getStrategy("2048.priority")!),
  },
  m.seed,
);
const scoreSig = await acc.signMessage({ message: scoreAuthMessage(m.matchId, ADDR, run.score) });
await post(`/match/${m.matchId}/score`, {
  address: ADDR,
  score: run.score,
  replay: run.replay,
  signature: scoreSig,
});

// 3) Verificar resolución en el leaderboard
const lb = await get("/leaderboard/2048?limit=100");
const mine = lb.top.find((r: any) => r.address.toLowerCase() === ADDR);
const ok = mine && mine.name === "SolBenchmark" && mine.avatar === "🛸";
console.log("fila propia en el ranking:", mine);
console.log(ok ? "E2E PROFILES OK ✅" : "E2E PROFILES FALLÓ ❌");
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Levantar el árbitro (dev, sin firma obligatoria off — acá firmamos igual)**

Run:

```bash
PORT=4056 AGENTS_ENABLED=false ENABLE_TEST_BOT=false \
  ARBITER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  npx tsx apps/server/src/index.ts &
sleep 4 && curl -s http://localhost:4056/health
```

Expected: `{"ok":true}`.

- [ ] **Step 3: Correr el E2E**

Run: `BASE=http://localhost:4056 npx tsx apps/server/e2e-profiles.mts`
Expected: `E2E PROFILES OK ✅`.

- [ ] **Step 4: Bajar el server y borrar el script**

Run: `kill %1 2>/dev/null; rm -f apps/server/e2e-profiles.mts`
(No se commitea nada; es verificación.)

---

### Task 7: Cliente web de perfiles + tipos (`arbiter.ts`)

**Files:**

- Modify: `apps/web/app/lib/arbiter.ts`

**Interfaces:**

- Produces: `interface Profile { name: string; avatar: string; updatedAt: number }`, `getProfile(address): Promise<Profile | null>`, `setProfile(input): Promise<Profile>`; y `name?`/`avatar?` opcionales en `LeaderRow`, en los players de `RecentMatch`/`PublicReplay`, y en `AgentMatchSummary`.

- [ ] **Step 1: Sumar `name?`/`avatar?` a los tipos existentes**

En `apps/web/app/lib/arbiter.ts`:

- `LeaderRow`:

```ts
export interface LeaderRow {
  address: string;
  rating: number;
  name?: string;
  avatar?: string;
}
```

- `RecentMatch` (players) y `PublicReplay` (players): agregar `name?: string; avatar?: string` a cada objeto de `players`.
- `AgentMatchSummary`: agregar `name?: string; avatar?: string` (display del rival).

- [ ] **Step 2: Cliente de perfil**

Agregar (junto a la sección de agentes):

```ts
export interface Profile {
  name: string;
  avatar: string;
  updatedAt: number;
}

export async function getProfile(address: string): Promise<Profile | null> {
  const out = await req<{ profile: Profile | null }>(`/profile/${encodeURIComponent(address)}`);
  return out.profile;
}

export function setProfile(input: {
  address: string;
  name: string;
  avatar: string;
  signature: string;
  ts: number;
}): Promise<Profile> {
  return req<{ profile: Profile }>("/profile", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((o) => o.profile);
}
```

- [ ] **Step 3: Typecheck web**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/arbiter.ts
git commit -m "feat(web): cliente getProfile/setProfile + name/avatar en tipos"
```

---

### Task 8: Tarjeta "Tu perfil" + editor en `/my-agents`

**Files:**

- Create: `apps/web/app/my-agents/ProfileEditor.tsx`
- Modify: `apps/web/app/my-agents/page.tsx`

**Interfaces:**

- Consumes: `getProfile`/`setProfile` (arbiter), `profileAuthMessage` (game-sdk/auth), `AGENT_AVATARS` (strategies), `useWallet`, `useSignMessage`, `useT`.

- [ ] **Step 1: Crear `ProfileEditor.tsx`**

```tsx
"use client";

// Tarjeta "Tu perfil" dentro de /my-agents: muestra avatar + nombre actual (o
// "Sin nombre") y permite editarlos firmando con la wallet. Reusa el mismo
// patrón visual que el paso 3 del builder (input de nombre + grilla de avatars).

import { useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import { profileAuthMessage } from "@arcade1v1/game-sdk/auth";
import { AGENT_AVATARS } from "@arcade1v1/strategies";
import { useT } from "@/app/lib/i18n";
import { getProfile, setProfile } from "@/app/lib/arbiter";

export function ProfileEditor({ address }: { address: string }) {
  const { t } = useT();
  const { signMessageAsync } = useSignMessage();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AGENT_AVATARS[0]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    getProfile(address)
      .then((p) => {
        if (cancel || !p) return;
        setName(p.name);
        setAvatar(p.avatar);
      })
      .finally(() => !cancel && setLoaded(true));
    return () => {
      cancel = true;
    };
  }, [address]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: profileAuthMessage("set", address, ts),
      });
      const p = await setProfile({ address, name: trimmed, avatar, signature, ts });
      setName(p.name);
      setAvatar(p.avatar);
      setEditing(false);
    } catch {
      /* firma cancelada o red caída: la tarjeta queda como estaba */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="win mb-4">
      <div className="win-title win-title--cyan">
        <span>{t("profile.title")}</span>
      </div>
      <div className="p-4">
        {!editing ? (
          <div className="flex items-center gap-3">
            <span className="text-3xl">{avatar}</span>
            <span className="flex-1 font-pixel text-xs text-(--color-text)">
              {name.trim() || t("profile.none")}
            </span>
            <button
              onClick={() => setEditing(true)}
              disabled={!loaded}
              className="btn3d btn3d--cyan disabled:opacity-50"
            >
              ✏ {t("profile.edit")}
            </button>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-(--color-muted-2)">
              {t("build.name")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder={t("build.namePh")}
                className="mt-2 w-full rounded-md border-2 border-(--color-border) bg-(--color-ink) px-3 py-2 text-base text-(--color-text) outline-none focus:border-(--color-accent)"
              />
            </label>
            <p className="mt-4 text-sm font-medium text-(--color-muted-2)">{t("build.avatar")}</p>
            <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
              {AGENT_AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={`win p-2 text-2xl transition hover:-translate-y-0.5 ${
                    avatar === a ? "!border-(--color-accent)" : ""
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="btn3d btn3d--magenta flex-1 disabled:opacity-50"
              >
                {saving ? t("profile.saving") : t("profile.save")}
              </button>
              <button onClick={() => setEditing(false)} className="btn3d btn3d--cyan flex-1">
                {t("build.prev")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Montar la tarjeta en `my-agents/page.tsx`**

Import:

```ts
import { ProfileEditor } from "./ProfileEditor";
```

Renderizar la tarjeta cuando hay `address`, arriba de la lista de agentes. Localizar el bloque que ya chequea `address` (el que muestra la lista) y anteponer, dentro del contenedor `max-w-2xl`, después del link "back":

```tsx
{
  address && <ProfileEditor address={address} />;
}
```

- [ ] **Step 3: Typecheck web**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/my-agents/ProfileEditor.tsx apps/web/app/my-agents/page.tsx
git commit -m "feat(web): tarjeta Tu perfil (editar nombre+avatar firmado) en /my-agents"
```

---

### Task 9: Mostrar nombre/avatar en ranking, watch e historial

**Files:**

- Modify: `apps/web/app/leaderboard/page.tsx`, `apps/web/app/watch/page.tsx`, `apps/web/app/watch/[matchId]/page.tsx`, `apps/web/app/my-agents/[agentId]/page.tsx`

**Interfaces:**

- Consumes: `name?`/`avatar?` de `LeaderRow`, players de `RecentMatch`/`PublicReplay`, y `AgentMatchSummary`.

**Regla de render (constante para las 4):** helper local

```tsx
const label = (short: string, name?: string, avatar?: string) =>
  name ? `${avatar ?? ""} ${name} · ${short}`.trim() : short;
```

Se aplica así por página (el address corto SIEMPRE presente):

- [ ] **Step 1: Leaderboard**

En `apps/web/app/leaderboard/page.tsx`, donde hoy se muestra `{short(row.address)}`, reemplazar el contenido del `<span className="font-mono …">` por:

```tsx
{
  row.name ? (
    <>
      <span className="mr-1">{row.avatar}</span>
      {row.name} <span className="text-(--color-muted-3)">· {short(row.address)}</span>
    </>
  ) : (
    short(row.address)
  );
}
```

- [ ] **Step 2: Watch lista**

En `apps/web/app/watch/page.tsx`, reemplazar los dos `{shortAddress(pX.address)}` por un helper inline:

```tsx
{
  p1.name ? `${p1.avatar ?? ""} ${p1.name}` : shortAddress(p1.address);
}
```

y análogo para `p2`. (El address corto ya se ve en el detalle; en la lista compacta prima el nombre.)

- [ ] **Step 3: Watch detalle**

En `apps/web/app/watch/[matchId]/page.tsx`, el `label` del `ReplayPlayer`:

```tsx
label={`${p.name ? `${p.avatar ?? ""} ${p.name}` : shortAddress(p.address)}${
  data.winner?.toLowerCase() === p.address.toLowerCase() ? " 🏆" : ""
}`}
```

Y el chip del ganador (`🏆 {shortAddress(data.winner)}`) puede quedar con el address corto (identidad on-chain del pago) — no se toca.

- [ ] **Step 4: Historial del agente**

En `apps/web/app/my-agents/[agentId]/page.tsx`, donde muestra `{t("agent.vs")} {m.opponent ? shortAddress(m.opponent) : "?"}`:

```tsx
{
  t("agent.vs");
}
{
  (" ");
}
{
  m.name ? `${m.avatar ?? ""} ${m.name}` : m.opponent ? shortAddress(m.opponent) : "?";
}
```

- [ ] **Step 5: Typecheck web**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/leaderboard/page.tsx apps/web/app/watch/page.tsx apps/web/app/watch/[matchId]/page.tsx apps/web/app/my-agents/[agentId]/page.tsx
git commit -m "feat(web): mostrar nombre+avatar (con address corto) en ranking/watch/historial"
```

---

### Task 10: Textos i18n (4 idiomas)

**Files:**

- Modify: `apps/web/app/lib/i18n-dict.ts`

**Claves nuevas** (reusa `build.name`, `build.namePh`, `build.avatar`, `build.prev` que ya existen):
`profile.title`, `profile.edit`, `profile.none`, `profile.save`, `profile.saving`.

- [ ] **Step 1: Inglés** (en el bloque `en`, cerca de las claves `build.*`):

```ts
  "profile.title": "YOUR_PROFILE",
  "profile.edit": "Edit",
  "profile.none": "No name yet",
  "profile.save": "Save profile",
  "profile.saving": "Saving…",
```

- [ ] **Step 2: Español**:

```ts
  "profile.title": "TU_PERFIL",
  "profile.edit": "Editar",
  "profile.none": "Sin nombre",
  "profile.save": "Guardar perfil",
  "profile.saving": "Guardando…",
```

- [ ] **Step 3: Hindi**:

```ts
  "profile.title": "आपकी_प्रोफ़ाइल",
  "profile.edit": "संपादित करें",
  "profile.none": "अभी कोई नाम नहीं",
  "profile.save": "प्रोफ़ाइल सहेजें",
  "profile.saving": "सहेज रहे हैं…",
```

- [ ] **Step 4: Francés**:

```ts
  "profile.title": "VOTRE_PROFIL",
  "profile.edit": "Modifier",
  "profile.none": "Pas encore de nom",
  "profile.save": "Enregistrer le profil",
  "profile.saving": "Enregistrement…",
```

- [ ] **Step 5: Verificar que las 5 claves están en los 4 idiomas**

Run: `for k in title edit none save saving; do echo "profile.$k: $(grep -c "\"profile.$k\"" apps/web/app/lib/i18n-dict.ts)"; done`
Expected: cada una = 4.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib/i18n-dict.ts
git commit -m "feat(web): textos de perfil en los 4 idiomas"
```

---

### Task 11: Cierre — check completo + verificación web E2E

- [ ] **Step 1: `npm run check` completo**

Run: `npm run check`
Expected: typecheck + eslint + prettier + tests + selftest en verde. Si prettier marca archivos: `npx prettier --write <archivos>` y volver a correr.

- [ ] **Step 2: Verificación web E2E manual**

Levantar árbitro (puerto 4056, como Task 6) y web:

```bash
cd apps/web && NEXT_PUBLIC_ARBITER_URL=http://localhost:4056 npx next dev -p 3056 &
```

Con una wallet conectada: ir a `/my-agents`, editar el perfil (nombre + avatar), firmar; confirmar que la tarjeta lo muestra; jugar/ver una partida y confirmar el nombre en `/leaderboard` y `/watch`. Bajar ambos procesos al terminar.

- [ ] **Step 3: Changelog + cierre**

Agregar entrada `## [2.4.0] — 2026-07-10` en `CHANGELOG.md` (formato Keep a Changelog, en español) describiendo perfiles humanos. Commit `docs: changelog 2.4.0 (perfiles humanos)`.

- [ ] **Step 4: Pedir OK y push**

Mostrar el resumen en simple y pedir OK explícito antes de `git push` (push = deploy). Tras verificar en producción, marcar la Fase 3 en `docs/superpowers/v3/PLAN.md`.

---

## Self-Review

**Spec coverage:**

- Store `jsonStore("profiles")` → Task 2. ✓
- Endpoint firmado (`profileAuthMessage` + ts) → Tasks 1, 3. ✓
- Reusar `sanitizeName` + `AGENT_AVATARS` → Task 2 (Step 1 exporta `sanitizeName`). ✓
- Resolución en leaderboard/watch/detalle/historial con fallback → Tasks 4, 5, 9. ✓
- UI mínima nombre+avatar en `/my-agents` → Task 8. ✓
- Nadie edita ajeno / address normalizada → Task 3 (test de firma ajena). ✓
- Misma sanitización / allowlist → Task 2. ✓
- Tope de crecimiento → Task 2 (`MAX_PROFILES` + `evictIfNeeded`). ✓
- Anti-suplantación (address corto siempre) → Task 9 (regla de render). ✓
- 4 idiomas → Task 10. ✓
- Verificación real → Tasks 6 (server E2E) y 11 (web E2E). ✓

**Placeholder scan:** sin TBD/TODO; cada step con código o comando concreto.

**Type consistency:** `Profile { name, avatar, updatedAt }` consistente entre `profiles.ts` (server) y `arbiter.ts` (web). `resolveDisplay(address): { name?, avatar? }` usado igual en index.ts y agents-routes.ts. `profileAuthMessage("set", addr, ts)` idéntico en server (verificación) y web (firma) y test.
