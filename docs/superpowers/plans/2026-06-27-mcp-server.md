# Servidor MCP (@arcade1v1/mcp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `@arcade1v1/mcp`, un servidor MCP (stdio) que expone Arcade1v1 como herramientas, para que un asistente de IA (Claude Desktop, etc.) descubra y juegue por ranking sin escribir código.

**Architecture:** App nueva en `apps/mcp`. La lógica de cada herramienta vive en `tools.ts` como funciones puras testeables que reciben un `ArbiterClient`/agente del `@arcade1v1/agent-sdk` (inyectable). `server.ts` solo registra las herramientas MCP (con esquemas zod) y las conecta por stdio. Sin on-chain (Fase 1, por ranking).

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` (servidor MCP + stdio transport), `zod` (esquemas de input), `@arcade1v1/agent-sdk` (cliente + agente), `node:test` + `tsx` para tests.

## Global Constraints

- App ESM `@arcade1v1/mcp`, `"version":"0.0.0"`, `"private":true`. Imports relativos internos SIN extensión (como el agent-sdk, para evitar el problema de bundling; en este paquete corre solo en Node con tsx, así que sin extensión también va).
- Solo Fase 1 (por ranking): NINGUNA herramienta toca on-chain (sin depósitos/`settle`/USDC). La wallet del agente solo firma el envío.
- Reusar `@arcade1v1/agent-sdk` (`createAgent`, `ArbiterClient`) — NO reimplementar el cliente ni el flujo de juego.
- No modificar `packages/contracts/**`, `apps/server/**`, ni `packages/agent-sdk/**` salvo que un test lo exija (y solo agregando exports, no cambiando comportamiento).
- Tests con `node --import tsx --test` (patrón del repo).
- `ARBITER_URL` por env; default `https://arcade1v1.onrender.com` (el árbitro publicado).
- TypeScript estricto.
- Dependencia MCP: `@modelcontextprotocol/sdk@^1.29.0`. Para `zod`, instalar la versión que el SDK peer-requiera (probablemente `zod@^3.25`); el implementer verifica con `tsc` y ajusta si hace falta. Usar solo tipos básicos de zod (`z.string()`, `z.number()`, `.optional()`) que son estables entre 3 y 4.

---

### Task 1: Scaffold + herramientas de solo-lectura (list_games, leaderboard, rating)

**Files:**

- Create: `apps/mcp/package.json`
- Create: `apps/mcp/tsconfig.json`
- Create: `apps/mcp/src/tools.ts`
- Test: `apps/mcp/test/tools.test.ts`
- Modify: `package.json` (root) — el glob `test` ya es `packages/*/test/*.test.ts`; ampliarlo para incluir apps: `"{packages,apps}/*/test/*.test.ts"`

**Interfaces:**

- Consumes: `ArbiterClient` de `@arcade1v1/agent-sdk`.
- Produces:
  - `const GAMES: readonly string[]` (los 6 juegos)
  - `function listGames(): { games: readonly string[] }`
  - `function leaderboardTool(client: ArbiterClient, game: string, limit?: number): Promise<{ game: string; top: { address: string; rating: number }[] }>`
  - `function ratingTool(client: ArbiterClient, address: string): Promise<{ address: string; ratings: Record<string, number> }>`

- [ ] **Step 1: Create the scaffold**

`apps/mcp/package.json`:

```json
{
  "name": "@arcade1v1/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "arcade1v1-mcp": "src/index.ts" },
  "scripts": {
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@arcade1v1/agent-sdk": "*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "tsx": "^4.22.4",
    "typescript": "^6.0.3"
  }
}
```

`apps/mcp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Run `npm install` from the repo root to link the workspace.

- [ ] **Step 2: Write the failing test**

`apps/mcp/test/tools.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbiterClient } from "@arcade1v1/agent-sdk";
import { GAMES, listGames, leaderboardTool, ratingTool } from "../src/tools.ts";

function clientReturning(body: unknown): ArbiterClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  return new ArbiterClient("http://arbiter.test", { fetchImpl });
}

test("listGames devuelve los 6 juegos", () => {
  const out = listGames();
  assert.equal(out.games.length, 6);
  assert.ok(out.games.includes("2048"));
  assert.deepEqual([...out.games].sort(), [...GAMES].sort());
});

test("leaderboardTool devuelve el top del juego", async () => {
  const client = clientReturning({ game: "2048", top: [{ address: "0x1", rating: 1200 }] });
  const out = await leaderboardTool(client, "2048", 10);
  assert.equal(out.game, "2048");
  assert.deepEqual(out.top, [{ address: "0x1", rating: 1200 }]);
});

test("ratingTool devuelve los ratings del jugador", async () => {
  const client = clientReturning({ address: "0x9", ratings: { "2048": 1300 } });
  const out = await ratingTool(client, "0x9");
  assert.deepEqual(out.ratings, { "2048": 1300 });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --import tsx --test apps/mcp/test/tools.test.ts`
Expected: FAIL — `../src/tools.ts` no existe.

- [ ] **Step 4: Write the implementation**

`apps/mcp/src/tools.ts`:

```ts
// Lógica de cada herramienta MCP como funciones puras (reciben un ArbiterClient
// inyectable). server.ts solo las envuelve en herramientas MCP. Sin on-chain.
import { ArbiterClient } from "@arcade1v1/agent-sdk";

export const GAMES = ["2048", "tetris", "flappy", "racing", "snake", "invaders"] as const;

export function listGames(): { games: readonly string[] } {
  return { games: GAMES };
}

export async function leaderboardTool(
  client: ArbiterClient,
  game: string,
  limit = 20,
): Promise<{ game: string; top: { address: string; rating: number }[] }> {
  const top = await client.leaderboard(game, limit);
  return { game, top };
}

export async function ratingTool(
  client: ArbiterClient,
  address: string,
): Promise<{ address: string; ratings: Record<string, number> }> {
  const ratings = await client.rating(address);
  return { address, ratings };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test apps/mcp/test/tools.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Wire the test glob + confirm full suite**

In `package.json` (root), change `test` from `"node --import tsx --test packages/*/test/*.test.ts"` to:

```
"node --import tsx --test \"{packages,apps}/*/test/*.test.ts\""
```

Run: `npm test`
Expected: PASS — game-sdk + agent-sdk + mcp tests, all green.

- [ ] **Step 7: Commit**

```bash
git add apps/mcp/package.json apps/mcp/tsconfig.json apps/mcp/src/tools.ts apps/mcp/test/tools.test.ts package.json
git commit -m "feat(mcp): scaffold + herramientas read-only (list_games, leaderboard, rating)"
```

---

### Task 2: Herramientas de juego (matchmake, play_and_submit, get_result)

**Files:**

- Modify: `apps/mcp/src/tools.ts` (agregar las 3 funciones)
- Test: `apps/mcp/test/play.test.ts`

**Interfaces:**

- Consumes: `createAgent`, `ArbiterClient` de `@arcade1v1/agent-sdk`; `GAMES` (Task 1).
- Produces:
  - `type Agent = ReturnType<typeof createAgent>`
  - `function matchmakeTool(agent: Agent, game: string, stake: number): Promise<MatchView>`
  - `function playAndSubmitTool(agent: Agent, game: string, stake: number): Promise<MatchView>`
  - `function getResultTool(client: ArbiterClient, matchId: string, address?: string): Promise<MatchView>`
  - (`MatchView` se importa de `@arcade1v1/agent-sdk`.)
  - Cada función valida que `game` esté en `GAMES` y lanza un error claro si no.

- [ ] **Step 1: Write the failing test**

`apps/mcp/test/play.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { matchmakeTool, playAndSubmitTool, getResultTool } from "../src/tools.ts";

class FakeArbiter extends ArbiterClient {
  public submitted?: {
    id: string;
    address: string;
    score: number;
    replay: unknown;
    signature?: string;
  };
  constructor() {
    super("http://fake");
  }
  async matchmake(game: string, stake: number, address: string) {
    return {
      matchId: "0x" + "ab".repeat(32),
      game,
      stake,
      seed: 4242,
      status: "waiting",
      scores: {},
    } as any;
  }
  async submitScore(
    id: string,
    address: string,
    score: number,
    replay?: unknown,
    signature?: string,
  ) {
    this.submitted = { id, address, score, replay, signature };
    return {
      matchId: id,
      game: "2048",
      stake: 5,
      seed: 4242,
      status: "settled",
      scores: { [address]: score },
    } as any;
  }
  async getMatch(id: string) {
    return {
      matchId: id,
      game: "2048",
      stake: 5,
      seed: 4242,
      status: "settled",
      scores: {},
    } as any;
  }
}

test("matchmakeTool rechaza un juego desconocido", async () => {
  const agent = createAgent({ client: new FakeArbiter() });
  await assert.rejects(() => matchmakeTool(agent, "ajedrez", 5), /unknown game|juego/i);
});

test("playAndSubmitTool juega la semilla de la partida, firma y envía un score verificable", async () => {
  const fake = new FakeArbiter();
  const agent = createAgent({ client: fake });
  await playAndSubmitTool(agent, "2048", 5);
  const s = fake.submitted!;
  assert.equal((s.replay as Replay2048).seed, 4242);
  assert.equal(verify2048(s.replay as Replay2048), s.score);
  const signer = await recoverMessageAddress({
    message: scoreAuthMessage(s.id, agent.address, s.score),
    signature: s.signature as `0x${string}`,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
});

test("getResultTool devuelve el estado de la partida", async () => {
  const client = new FakeArbiter();
  const out = await getResultTool(client, "0xabc");
  assert.equal(out.status, "settled");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test apps/mcp/test/play.test.ts`
Expected: FAIL — `matchmakeTool`/`playAndSubmitTool`/`getResultTool` no existen.

- [ ] **Step 3: Write the implementation (append to tools.ts)**

Add to the top imports of `apps/mcp/src/tools.ts`:

```ts
import { createAgent, type MatchView } from "@arcade1v1/agent-sdk";

type Agent = ReturnType<typeof createAgent>;

function assertGame(game: string): void {
  if (!GAMES.includes(game as (typeof GAMES)[number])) {
    throw new Error(`unknown game: ${game}. Conocidos: ${GAMES.join(", ")}`);
  }
}
```

Append these functions to `apps/mcp/src/tools.ts`:

```ts
export async function matchmakeTool(agent: Agent, game: string, stake: number): Promise<MatchView> {
  assertGame(game);
  return agent.client.matchmake(game, stake, agent.address);
}

export async function playAndSubmitTool(
  agent: Agent,
  game: string,
  stake: number,
): Promise<MatchView> {
  assertGame(game);
  return agent.playAndSubmit({ game, stake });
}

export async function getResultTool(
  client: ArbiterClient,
  matchId: string,
  address?: string,
): Promise<MatchView> {
  return client.getMatch(matchId, address);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test apps/mcp/test/play.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p apps/mcp/tsconfig.json`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/mcp/src/tools.ts apps/mcp/test/play.test.ts
git commit -m "feat(mcp): herramientas de juego (matchmake, play_and_submit, get_result)"
```

---

### Task 3: Servidor MCP (stdio) + entrypoint + README

**Files:**

- Create: `apps/mcp/src/server.ts`
- Create: `apps/mcp/src/index.ts`
- Create: `apps/mcp/README.md`

**Interfaces:**

- Consumes: todas las funciones de `tools.ts` (Tasks 1-2); `createAgent`, `ArbiterClient` del SDK.
- Produces: `function buildServer(deps: { agent: Agent; client: ArbiterClient }): McpServer` (testeable sin stdio).

- [ ] **Step 1: Write the failing test**

`apps/mcp/test/server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { buildServer } from "../src/server.ts";

test("buildServer registra las 6 herramientas y devuelve un McpServer", () => {
  const client = new ArbiterClient("http://fake");
  const agent = createAgent({ client });
  const server = buildServer({ agent, client });
  // El McpServer expone su instancia subyacente; basta confirmar que se construyó
  // sin lanzar y que es un objeto con el método connect (contrato MCP).
  assert.ok(server);
  assert.equal(typeof (server as { connect?: unknown }).connect, "function");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test apps/mcp/test/server.test.ts`
Expected: FAIL — `../src/server.ts` no existe.

- [ ] **Step 3: Write the server**

`apps/mcp/src/server.ts`:

```ts
// Servidor MCP: registra cada herramienta (con esquema zod) y la cablea a las
// funciones puras de tools.ts. buildServer() es testeable sin stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import {
  GAMES,
  listGames,
  leaderboardTool,
  ratingTool,
  matchmakeTool,
  playAndSubmitTool,
  getResultTool,
} from "./tools";

type Agent = ReturnType<typeof createAgent>;
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function buildServer(deps: { agent: Agent; client: ArbiterClient }): McpServer {
  const { agent, client } = deps;
  const server = new McpServer({ name: "arcade1v1", version: "0.0.0" });

  server.registerTool(
    "list_games",
    { title: "List games", description: "Juegos disponibles en Arcade1v1." },
    async () => ok(listGames()),
  );

  server.registerTool(
    "leaderboard",
    {
      title: "Leaderboard",
      description: "Ranking ELO de un juego.",
      inputSchema: { game: z.string(), limit: z.number().optional() },
    },
    async ({ game, limit }) => ok(await leaderboardTool(client, game, limit)),
  );

  server.registerTool(
    "rating",
    {
      title: "Rating",
      description: "Rating ELO de una dirección por juego.",
      inputSchema: { address: z.string() },
    },
    async ({ address }) => ok(await ratingTool(client, address)),
  );

  server.registerTool(
    "matchmake",
    {
      title: "Matchmake",
      description: `Emparejar para un juego (${GAMES.join(", ")}) en una mesa (stake).`,
      inputSchema: { game: z.string(), stake: z.number() },
    },
    async ({ game, stake }) => ok(await matchmakeTool(agent, game, stake)),
  );

  server.registerTool(
    "play_and_submit",
    {
      title: "Play and submit",
      description:
        "Empareja, juega con la estrategia por defecto y envía el puntaje (por ranking).",
      inputSchema: { game: z.string(), stake: z.number() },
    },
    async ({ game, stake }) => ok(await playAndSubmitTool(agent, game, stake)),
  );

  server.registerTool(
    "get_result",
    {
      title: "Get result",
      description: "Estado/feedback de una partida por matchId.",
      inputSchema: { matchId: z.string(), address: z.string().optional() },
    },
    async ({ matchId, address }) => ok(await getResultTool(client, matchId, address)),
  );

  return server;
}
```

> If `registerTool`'s exact option/handler shape differs in `@modelcontextprotocol/sdk@^1.29.0`, adjust to the installed API (the test in Step 1 only asserts the server builds and exposes `connect`). Keep the tool names and zod fields as above.

- [ ] **Step 4: Write the entrypoint**

`apps/mcp/src/index.ts`:

```ts
// Entrypoint del servidor MCP por stdio. Config: ARBITER_URL (default = árbitro
// publicado). Crea un agente con wallet efímera por sesión (solo firma; Fase 1).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { buildServer } from "./server";

const arbiterUrl = process.env.ARBITER_URL ?? "https://arcade1v1.onrender.com";

async function main() {
  const client = new ArbiterClient(arbiterUrl);
  const agent = createAgent({ arbiterUrl, client });
  const server = buildServer({ agent, client });
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error("arcade1v1-mcp error:", (e as Error).message);
  process.exit(1);
});
```

- [ ] **Step 5: Run the server test + typecheck**

Run: `node --import tsx --test apps/mcp/test/server.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p apps/mcp/tsconfig.json`
Expected: sin errores. (Si el shape de `registerTool` difiere en la versión instalada, ajustar `server.ts` hasta que `tsc` quede limpio y el test pase.)

- [ ] **Step 6: Write the README**

`apps/mcp/README.md`:

```markdown
# @arcade1v1/mcp — servidor MCP

Expone Arcade1v1 como herramientas MCP para que un asistente de IA (Claude
Desktop, etc.) juegue por ranking sin escribir código. Fase 1: por ELO, sin
on-chain.

## Herramientas

- `list_games` · `leaderboard` · `rating` · `matchmake` · `play_and_submit` · `get_result`

## Conectarlo a Claude Desktop

En `claude_desktop_config.json`:

    {
      "mcpServers": {
        "arcade1v1": {
          "command": "npx",
          "args": ["-y", "tsx", "<RUTA_AL_REPO>/apps/mcp/src/index.ts"],
          "env": { "ARBITER_URL": "https://arcade1v1.onrender.com" }
        }
      }
    }

Reiniciá Claude Desktop. Pedile: "jugá una partida de 2048 en Arcade1v1 y contame
cómo te fue". Usará `play_and_submit`.
```

- [ ] **Step 7: Commit**

```bash
git add apps/mcp/src/server.ts apps/mcp/src/index.ts apps/mcp/README.md apps/mcp/test/server.test.ts
git commit -m "feat(mcp): servidor MCP stdio + entrypoint + README de conexión"
```

---

## Self-Review

- **Spec coverage (sección MCP del spec):** servidor MCP con tools `list_games`, `matchmake`, `play_and_submit`, `get_result`, `leaderboard`, `rating` → Tasks 1-3. Usa el agent-sdk por dentro → sí (tools.ts/server.ts). Transport stdio → Task 3. Wallet efímera por sesión → index.ts. Sin on-chain → constraint respetado (ninguna tool deposita/settlea). ✓
- **Placeholder scan:** sin TBD/TODO. Los dos condicionales ("si registerTool difiere en la versión instalada") son guías de adaptación a la API real, con el test como red — no placeholders de lógica.
- **Type consistency:** `GAMES`/`listGames`/`leaderboardTool`/`ratingTool` (Task 1) consumidos en Tasks 2-3; `Agent`/`matchmakeTool`/`playAndSubmitTool`/`getResultTool` (Task 2) consumidos en Task 3; `MatchView` importado del SDK en todas. `buildServer({ agent, client })` (Task 3) coincide entre server.ts e index.ts.

## Nota de riesgo (para el ejecutor)

El único punto con incertidumbre de API es la firma exacta de `McpServer.registerTool`
en `@modelcontextprotocol/sdk@1.29.0` (nombres de campos `inputSchema`/handler y el
shape del retorno `content`). Tras `npm install`, si `tsc` se queja, ajustar `server.ts`
a la API instalada manteniendo nombres de tools y campos zod; el resto del plan
(tools.ts puras + tests) no depende de esa API.
