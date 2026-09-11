# Aleph — Etapa 4, PR 3 de 3: agentes (SDK + MCP), web, docs y despliegue en Sepolia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente pueda sentarse en la mesa de 2 USDC y depositar **con su propia wallet** desde el SDK (`agent.alephDeposit`) o desde un cliente MCP (`aleph_deposit`); que la web muestre la mesa de plata al lado de la gratis, la fase de fondeo de una sala y el link a la transacción de pago; que las reglas expliquen con todas las letras cómo se paga al final (decisión 4); que docs, CHANGELOG y versiones (0.4.0) queden al día; y que el contrato quede desplegado en Base Sepolia con el árbitro y la web apuntando a él, verificado con un smoke de 4 wallets.

**Architecture:** El SDK ya firma todo lo que el árbitro exige; lo único nuevo es que la wallet del agente **manda dos transacciones** (`approve` y `open`/`deposit`) cuando `createAgent` recibe `rpcUrl`. La decisión open-vs-deposit se toma leyendo el contrato y tolera la carrera de dos asientos que abren a la vez. El ABI y el enum salen del `game-sdk` (PR 2). El MCP suma una sexta herramienta (`aleph_deposit`) y lee `ARCADE_PRIVATE_KEY` + `RPC_URL` del entorno para tener una wallet con fondos; sin ellas sigue como hoy (mesa gratis). La web sigue siendo de espectador: no deposita, solo lee los campos nuevos de la vista (`fundingDeadline`, `deposited`, `payoutsUsdc`, `settleTx`) y el `stakes` del lobby.

**Tech Stack:** TypeScript estricto, `node:test`, viem 2.53 (`createPublicClient`, `createWalletClient`, `simulateContract`), `@modelcontextprotocol/sdk` 1.30 + zod 3, Next 16 (App Router, `"use client"`), i18n propia de la web (4 idiomas con paridad de claves forzada por test), Foundry para el deploy.

**Spec:** `docs/superpowers/specs/2026-09-10-aleph-etapa4-mesas-de-plata-design.md`, secciones "Capa de agentes y web", "Seguridad › Colusión" (el párrafo de reglas), "Alcance" y "Etapas de construcción › 3". **Depende del PR 2** (`docs/superpowers/plans/2026-09-11-aleph-etapa4-2-arbitro.md`, mergeado): la forma de `deposit` en la vista, `{ lobbies, stakes }` y `usdc` en el registro salen de ahí. Desvíos deliberados:

1. El spec dice "MCP: las mismas cinco herramientas, con el paso de depósito documentado en `aleph_rules`". Se agrega una **sexta**, `aleph_deposit`: el modelo no tiene forma de mandar una transacción sin una herramienta, y meter el depósito como efecto secundario de `aleph_view` sería peor. `aleph_rules` sí documenta el paso, como pide el spec.
2. El spec dice "`alephJoin(stake)` devuelve el pase". El pase llega en la vista privada cuando la sala está en `funding` (desvío 1 del PR 2); `alephJoin(2)` funciona igual que `alephJoin(0)` y el agente sondea con `alephView` hasta que `status === "funding"`, entonces llama `alephDeposit`.
3. La web **no necesita variables nuevas**: la dirección del escrow viaja en la vista (`escrow`) y el link al explorador se arma con `NEXT_PUBLIC_CHAIN_ID`, que ya existe.

## Global Constraints

- Rama: `feat/aleph-etapa4-agentes-web` desde `main` **después de mergear el PR 2**. **`main` no acepta push directo**: PR + 2 checks. **No publicar en npm ni en el registry MCP, ni desplegar en Sepolia, ni tocar Render/Vercel sin el OK explícito del dueño** (la última tarea lo pide paso por paso).
- Cada tarea termina en verde: `npm run typecheck && npm run lint && npm run format:check` y los tests del archivo tocado; antes del último commit, `npm run check` completo y `npm run build --workspace apps/web`.
- Estilo del repo: comentarios en **español**; identificadores en inglés; texto dirigido a agentes/modelos (reglas, descripciones de herramientas, AGENTS.md, llms.txt, READMEs de paquetes) en **inglés**; copy de la web en los 4 idiomas (`es`, `en`, `fr`, `hi`) con las MISMAS claves (lo fija `apps/web/test/i18n.test.ts`).
- Contrato con el árbitro (del PR 2, NO redefinir): `GET /aleph/lobbies → { lobbies: AlephLobby[], stakes: number[] }` con `AlephLobby.status: "lobby" | "funding"` y `deposited?`; la vista privada en `funding` trae `deposit: { chainId, escrow, usdc, stake (string, micro-USDC), seats, seatsHash, fundDeadline (s), playDeadline (s), seatSig }` y `deposited: string[]`; la vista `settled` con `stake > 0` trae `payoutsUsdc`, `payoutSig`, `settleTx`, `escrow`; el registro trae `usdc: { escrow, chainId, feeBps, table, signature, settleTx }`. Contrato on-chain (del PR 1): `open(id, seats, stake, fundDeadline, playDeadline, seatSig)`, `deposit(id, seatSig)`, `roomOf(id)[5]` = status, revert `"room exists"`.
- Constantes del spec: stake **2 USDC**; comisión **15 %**; fondeo **10 min**. Los números del texto de reglas salen de `ALEPH_RULES` (nunca a mano).
- Versión de esta etapa: **0.4.0** en `game-sdk`, `strategies`, `agent-sdk`, `mcp` (`package.json`, `server.json`, `buildServer`). `ALEPH_RULES_V` NO cambia (el motor no cambió).
- No escribir secuencias `\u` (backslash-u) en ningún archivo ni parámetro.
- Commits chicos, mensajes en español con prefijo (`feat(agent-sdk): …`, `feat(mcp): …`, `feat(web): …`, `docs: …`, `chore(release): …`) y el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `npm run format` antes de commitear si `format:check` falla.

## File structure

| Archivo                                                                                                                                                                                                                                | Responsabilidad                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-sdk/src/client.ts` (modificar)                                                                                                                                                                                         | `AlephRoomStatus` + `"funding"`; `AlephDeposit`; campos nuevos en `AlephRoomView`, `AlephLobby`, `AlephLog`; `alephLobbiesInfo()` |
| `packages/agent-sdk/src/agent.ts` (modificar)                                                                                                                                                                                          | `createAgent({ rpcUrl })`; `alephJoin` acepta `stake > 0` con `rpcUrl`; `alephDeposit(roomId)`                                    |
| `packages/agent-sdk/src/aleph.ts` (modificar)                                                                                                                                                                                          | `describeAlephRules()`: párrafo de mesas de plata + el piso de la caja (decisión 4)                                               |
| `packages/agent-sdk/src/index.ts` (modificar)                                                                                                                                                                                          | Re-exports (`AlephDeposit`, `AlephDepositResult`)                                                                                 |
| `packages/agent-sdk/test/aleph-client.test.ts`, `agent-aleph.test.ts`, `aleph-text.test.ts` (modificar)                                                                                                                                | Los casos nuevos                                                                                                                  |
| `apps/server/src/aleph-onchain-e2e.ts` (modificar)                                                                                                                                                                                     | Los asientos depositan con `agent.alephDeposit` contra el router real por HTTP (prueba el SDK en anvil, en CI)                    |
| `apps/mcp/src/index.ts`, `tools.ts`, `server.ts` (modificar)                                                                                                                                                                           | Wallet configurable (`ARCADE_PRIVATE_KEY`, `RPC_URL`); `aleph_deposit`; `mustDeposit`; descripciones                              |
| `apps/mcp/test/tools-aleph.test.ts`, `server.test.ts` (modificar)                                                                                                                                                                      | La herramienta nueva y el cableado                                                                                                |
| `apps/web/app/lib/arbiter.ts` (modificar)                                                                                                                                                                                              | `getAlephLobbiesInfo()`; `RecentAlephRoom.settleTx?`                                                                              |
| `apps/web/app/lib/explorer.ts` (nuevo)                                                                                                                                                                                                 | `txUrl(hash)` según `NEXT_PUBLIC_CHAIN_ID`                                                                                        |
| `apps/web/app/aleph/page.tsx` (modificar)                                                                                                                                                                                              | Una tarjeta por mesa (`stakes`), salas en `funding`, nota de la casa                                                              |
| `apps/web/app/aleph/[roomId]/page.tsx` (modificar)                                                                                                                                                                                     | Estado `funding` (depósitos + cuenta regresiva), tabla de pagos en USDC, link a `settleTx`                                        |
| `apps/web/app/lib/i18n/{es,en,fr,hi}.ts` (modificar)                                                                                                                                                                                   | Las claves nuevas, en los 4 idiomas                                                                                               |
| `apps/web/app/agents/content.ts` (modificar)                                                                                                                                                                                           | "Six MCP tools"; una línea sobre la mesa de plata                                                                                 |
| `AGENTS.md`, `apps/web/public/llms.txt`, `packages/agent-sdk/README.md`, `apps/mcp/README.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `SECURITY.md`, `DEPLOY.md`, `docs/ROADMAP.md`, `README.md`, `CHANGELOG.md`, spec (modificar) | Documentación de la etapa                                                                                                         |
| `packages/*/package.json`, `apps/mcp/package.json`, `apps/mcp/server.json`, `apps/mcp/src/server.ts` (modificar)                                                                                                                       | 0.4.0                                                                                                                             |
| `scripts/aleph-money-smoke.mjs` (nuevo)                                                                                                                                                                                                | Smoke en Sepolia: 4 wallets del SDK se sientan, depositan, juegan y cobran contra el árbitro publicado                            |

---

### Task 1: Tipos y cliente HTTP del SDK

**Files:**

- Modify: `packages/agent-sdk/src/client.ts`
- Modify: `packages/agent-sdk/src/index.ts`
- Test: `packages/agent-sdk/test/aleph-client.test.ts`

**Interfaces:**

- Produces: `AlephRoomStatus = "lobby" | "funding" | "playing" | "settled" | "dissolved"`; `AlephDeposit`; `AlephRoomView` + `fundingDeadline?`, `deposited?`, `deposit?`, `escrow?`, `payoutsUsdc?`, `payoutSig?`, `settleTx?`; `AlephLobby` + `status`, `deposited?`; `AlephLog` + `usdc?`; `ArbiterClient.alephLobbiesInfo(): Promise<{ lobbies: AlephLobby[]; stakes: number[] }>` (`alephLobbies()` sigue devolviendo solo la lista).

- [ ] **Step 0: Pararse en la rama**

```bash
git fetch origin && git checkout -b feat/aleph-etapa4-agentes-web origin/main
git log --oneline -1 -- apps/server/src/aleph-chain.ts   # PR 2 mergeado
```

- [ ] **Step 1: Escribir el test que falla**

Agregar a `packages/agent-sdk/test/aleph-client.test.ts` (reusa `fakeFetch`, `Captured`, `ROOM` de ese archivo):

```ts
test("alephLobbiesInfo: GET /aleph/lobbies con las mesas que acepta el árbitro", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, {
      lobbies: [
        {
          roomId: ROOM,
          stake: 2,
          status: "funding",
          seats: 4,
          deposited: 1,
          min: 4,
          max: 8,
          closesAt: 9,
        },
      ],
      stakes: [0, 2],
    }),
  });
  const info = await client.alephLobbiesInfo();
  assert.equal(cap.url, "http://arbiter.test/aleph/lobbies");
  assert.deepEqual(info.stakes, [0, 2]);
  assert.equal(info.lobbies[0].status, "funding");
  assert.equal(info.lobbies[0].deposited, 1);
  // Sin `stakes` (árbitro viejo): la mesa gratis y nada más.
  const old = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch({}, { lobbies: [] }),
  });
  assert.deepEqual(await old.alephLobbiesInfo(), { lobbies: [], stakes: [0] });
});
```

Run: `node --import tsx --test packages/agent-sdk/test/aleph-client.test.ts`
Expected: FAIL (`alephLobbiesInfo` no es una función).

- [ ] **Step 2: Implementar**

En `client.ts`:

```ts
export type AlephRoomStatus = "lobby" | "funding" | "playing" | "settled" | "dissolved";

/** Lo que un asiento necesita para depositar en una mesa de plata. Llega en
 *  la vista PRIVADA mientras la sala está en `funding`. Deadlines en SEGUNDOS
 *  (como los lee el contrato); `stake` en micro-USDC como string. */
export interface AlephDeposit {
  chainId: number;
  escrow: string;
  usdc: string;
  stake: string;
  seats: string[];
  seatsHash: string;
  fundDeadline: number;
  playDeadline: number;
  seatSig: string;
}
```

En `AlephRoomView`, después de `rating?`:

```ts
  /** `funding` (mesa de plata): cuándo vence el fondeo (epoch ms) */
  fundingDeadline?: number;
  /** `funding`: quién ya depositó (minúsculas) */
  deposited?: string[];
  /** `funding`, solo en tu vista privada: con qué depositar */
  deposit?: AlephDeposit;
  /** stake > 0: el contrato que custodia la mesa */
  escrow?: string;
  /** `settled`, stake > 0: la tabla en micro-USDC, su firma y la transacción */
  payoutsUsdc?: Record<string, string>;
  payoutSig?: string;
  settleTx?: string;
```

En `AlephLobby`:

```ts
export interface AlephLobby {
  roomId: string;
  stake: number;
  /** `lobby`: esperando asientos; `funding`: lista congelada, esperando depósitos */
  status: "lobby" | "funding";
  seats: number;
  deposited?: number;
  min: number;
  max: number;
  closesAt: number;
}
```

En `AlephLog`:

```ts
  /** Solo mesas de plata: la parte en USDC del registro. */
  usdc?: {
    escrow: string;
    chainId: number;
    feeBps?: number;
    table?: Record<string, string>;
    signature?: string;
    settleTx?: string;
  };
```

Y el método, debajo de `alephLobbies`:

```ts
  /** Lobbies + las mesas (stakes) que acepta este árbitro. Un árbitro anterior
   *  a la etapa 4 no manda `stakes`: se asume solo la gratis. */
  async alephLobbiesInfo(): Promise<{ lobbies: AlephLobby[]; stakes: number[] }> {
    const j = await this.get<{ lobbies?: AlephLobby[]; stakes?: number[] }>("/aleph/lobbies");
    return { lobbies: j.lobbies ?? [], stakes: j.stakes ?? [0] };
  }
```

En `index.ts`, agregar `AlephDeposit` al `export type { … } from "./client"`.

- [ ] **Step 3: Correr y commitear**

Run: `node --import tsx --test packages/agent-sdk/test/aleph-client.test.ts && npm run typecheck`
Expected: PASS; `typecheck` verde en TODO el monorepo (la web y el MCP importan estos tipos; si `AlephLobby.status` obligatorio rompe un fake en `apps/mcp/test` o `apps/web`, agregar `status: "lobby"` a ese fake).

```bash
git add packages/agent-sdk/src/client.ts packages/agent-sdk/src/index.ts packages/agent-sdk/test/aleph-client.test.ts
git commit -m "feat(agent-sdk): tipos de la mesa de plata (funding, deposit, payoutsUsdc) y alephLobbiesInfo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `createAgent({ rpcUrl })` y `alephDeposit`: la wallet del agente deposita

**Files:**

- Modify: `packages/agent-sdk/src/agent.ts`
- Modify: `packages/agent-sdk/src/index.ts`
- Modify: `packages/agent-sdk/test/agent-aleph.test.ts` (el test de la línea 88 cambia de sentido)
- Modify: `apps/server/src/aleph-onchain-e2e.ts` (los asientos depositan con el SDK por HTTP)

**Interfaces:**

- Consumes: `escrowAlephAbi`, `erc20MinimalAbi`, `ALEPH_ESCROW_STATUS` de `@arcade1v1/game-sdk/aleph`; `AlephDeposit` (Task 1).
- Produces: opción `rpcUrl?: string` en `createAgent`; `alephJoin(stake)` acepta `stake > 0` solo con `rpcUrl`; `alephDeposit(roomId: string): Promise<AlephDepositResult>` con `AlephDepositResult = { step: "open" | "deposit" | "already"; txHash?: Hex; view: AlephRoomView }`.

- [ ] **Step 1: Los tests que fallan**

En `packages/agent-sdk/test/agent-aleph.test.ts`, reemplazar el test `"alephJoin: rechaza mesas de plata sin pedir asiento, y otra versión de reglas"` por:

```ts
test("alephJoin: una mesa de plata exige rpcUrl (la wallet tiene que poder depositar); con rpcUrl firma stake 2", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  await assert.rejects(() => agent.alephJoin(2), /rpcUrl/);
  assert.equal(fake.joins.length, 0, "no llegó a pedir asiento");

  const paying = createAgent({ client: fake, rpcUrl: "http://localhost:8545" });
  await paying.alephJoin(2);
  assert.equal(fake.joins.length, 1);
  assert.equal(fake.joins[0].stake, 2);
  assert.ok(fake.joins[0].auth?.signature, "firmado con stake 2 en el mensaje");
});

test("alephJoin: otra versión de reglas corta antes de sentarse", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  fake.rulesV = ALEPH_RULES_V + 1;
  await assert.rejects(() => agent.alephJoin(0), /rules version mismatch/);
});

test("alephDeposit: sin rpcUrl falla claro; con la sala fuera de funding no toca la cadena", async () => {
  const fake = new FakeAleph(); // su vista es `playing`
  const agent = createAgent({ client: fake });
  await assert.rejects(() => agent.alephDeposit(ROOM), /rpcUrl/);
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" }); // nada escucha ahí
  await assert.rejects(() => paying.alephDeposit(ROOM), /not funding \(playing\)/);
});

test("alephDeposit: si ya figuro entre los depositados, no manda nada", async () => {
  const fake = new FakeAleph();
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" });
  fake.status = "funding";
  fake.deposited = [paying.address.toLowerCase()];
  fake.deposit = {
    chainId: 31337,
    escrow: "0x" + "e".repeat(40),
    usdc: "0x" + "1".padStart(40, "0"),
    stake: "2000000",
    seats: [paying.address.toLowerCase()],
    seatsHash: "0x" + "0".repeat(64),
    fundDeadline: 1,
    playDeadline: 2,
    seatSig: "0x" + "0".repeat(130),
  };
  const r = await paying.alephDeposit(ROOM);
  assert.equal(r.step, "already");
  assert.equal(r.txHash, undefined);
});
```

(Ajustar `FakeAleph` de ese archivo para que su `view()` lea `this.status`, `this.deposited` y `this.deposit` cuando existan — hoy devuelve `status: "playing"` fijo. Si el nombre del test que se reemplaza difiere un poco, buscar el `assert.rejects(() => agent.alephJoin(1), /no deposita on-chain/)` de la línea 91: ese assert desaparece.)

Run: `node --import tsx --test packages/agent-sdk/test/agent-aleph.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementar en `agent.ts`**

Imports nuevos:

```ts
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";
import { foundry, base, baseSepolia } from "viem/chains";
import { escrowAlephAbi, erc20MinimalAbi, ALEPH_ESCROW_STATUS } from "@arcade1v1/game-sdk/aleph";
```

(y quitar `import type { Hex } from "viem";` que ya no hace falta aparte).

Tipo nuevo, antes de `createAgent`:

```ts
export interface AlephDepositResult {
  /** `open` (fui el primero: abrí la sala), `deposit`, o `already` (ya figuraba). */
  step: "open" | "deposit" | "already";
  txHash?: Hex;
  /** La vista privada que se leyó antes de depositar. */
  view: AlephRoomView;
}

/** Red según el `chainId` que manda el árbitro en `deposit`. */
function chainFor(id: number): Chain {
  if (id === 31337) return foundry;
  if (id === 8453) return base;
  return baseSepolia;
}
```

En las opciones de `createAgent`:

```ts
  /** RPC de la red del escrow. Con él, la wallet del agente puede DEPOSITAR en
   *  una mesa de plata de Aleph (`alephDeposit`) y `alephJoin` acepta stake > 0.
   *  La wallet tiene que tener el USDC del stake y gas. Sin `rpcUrl` el SDK
   *  solo firma mensajes, como siempre. */
  rpcUrl?: string;
```

Y en el tipo de retorno, después de `alephJoin`:

```ts
  /** Aleph, mesa de plata: deposita el stake de ESTA wallet en la sala en
   *  `funding` (approve si hace falta, `open` si soy el primero, `deposit` si
   *  no). Idempotente: si ya deposité, no manda nada. Exige `rpcUrl`. */
  alephDeposit(roomId: string): Promise<AlephDepositResult>;
```

`alephJoin` cambia su primera línea:

```ts
  async function alephJoin(stake = 0): Promise<AlephRoomView> {
    // Una mesa de plata solo tiene sentido si esta wallet puede depositar: sin
    // RPC se sentaría, la sala entraría en fondeo y se disolvería a los 10 min
    // haciendo perder el tiempo a los otros 3-7 asientos.
    if (stake > 0 && !opts.rpcUrl) {
      throw new Error(
        `a money table (${stake} USDC) needs a wallet that can deposit: pass rpcUrl (and a funded privateKey) to createAgent, or use stake 0`,
      );
    }
    await assertCompatibleRules(stake);
```

(el `assertFreeTable(stake)` de `alephJoin` se va; el de `matchmake` queda, el 1v1 no cambia).

Y la función nueva, después de `alephAct`:

```ts
async function alephDeposit(roomId: string): Promise<AlephDepositResult> {
  if (!opts.rpcUrl) throw new Error("createAgent needs rpcUrl to deposit in a money table");
  // Primero la vista: si la sala no está fondeando no hay nada que mandar, y
  // así el error es del árbitro (claro) y no del RPC (críptico).
  const view = await alephView(roomId);
  if (view.status !== "funding" || !view.deposit) {
    throw new Error(`room ${roomId} is not funding (${view.status})`);
  }
  const me = wallet.address.toLowerCase();
  if (view.deposited?.some((a) => a.toLowerCase() === me)) return { step: "already", view };

  const d = view.deposit;
  const chain = chainFor(d.chainId);
  const account = privateKeyToAccount(wallet.privateKey);
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) });
  const w = createWalletClient({ account, chain, transport: http(opts.rpcUrl) });
  const escrow = d.escrow as Hex;
  const usdc = d.usdc as Hex;
  const stake = BigInt(d.stake);

  const balance = (await pub.readContract({
    address: usdc,
    abi: erc20MinimalAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (balance < stake) {
    throw new Error(
      `insufficient USDC to deposit: have ${balance}, need ${stake} (micro-USDC) at ${usdc}`,
    );
  }
  const allowance = (await pub.readContract({
    address: usdc,
    abi: erc20MinimalAbi,
    functionName: "allowance",
    args: [account.address, escrow],
  })) as bigint;
  if (allowance < stake) {
    const hash = await w.writeContract({
      address: usdc,
      abi: erc20MinimalAbi,
      functionName: "approve",
      args: [escrow, stake],
      account,
      chain,
    });
    await pub.waitForTransactionReceipt({ hash });
  }

  // Simular antes de mandar: un revert seguro no quema gas.
  const send = async (functionName: "open" | "deposit", args: readonly unknown[]): Promise<Hex> => {
    const { request } = await pub.simulateContract({
      address: escrow,
      abi: escrowAlephAbi,
      functionName,
      args: args as never,
      account,
      chain,
    });
    const hash = await w.writeContract(request);
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  };
  const onchain = await pub.readContract({
    address: escrow,
    abi: escrowAlephAbi,
    functionName: "roomOf",
    args: [roomId as Hex],
  });
  let step: "open" | "deposit" =
    Number(onchain[5]) === ALEPH_ESCROW_STATUS.None ? "open" : "deposit";
  const openArgs = [
    roomId,
    d.seats,
    stake,
    BigInt(d.fundDeadline),
    BigInt(d.playDeadline),
    d.seatSig,
  ] as const;
  let txHash: Hex;
  try {
    txHash =
      step === "open" ? await send("open", openArgs) : await send("deposit", [roomId, d.seatSig]);
  } catch (e) {
    // Carrera: otro asiento abrió la sala entre mi lectura y mi envío.
    if (step === "open" && /room exists/i.test((e as Error).message)) {
      step = "deposit";
      txHash = await send("deposit", [roomId, d.seatSig]);
    } else {
      throw e;
    }
  }
  return { step, txHash, view };
}
```

Y agregar `alephDeposit` al objeto que devuelve `createAgent`. En `index.ts`: `export type { AlephDepositResult } from "./agent";`.

- [ ] **Step 3: Correr los tests del SDK**

Run: `node --import tsx --test packages/agent-sdk/test/*.test.ts && npm run typecheck`
Expected: PASS. (`onchain[5]`: viem infiere la tupla del ABI `as const`; si se queja, `(onchain as readonly unknown[])[5]`.)

- [ ] **Step 4: El e2e de anvil deposita con el SDK**

En `apps/server/src/aleph-onchain-e2e.ts` (PR 2): montar el router real en un express local y que cada asiento sea un `createAgent({ arbiterUrl: BASE, privateKey, rpcUrl: RPC })`; en `happyPath` y `unfundedScenario`, reemplazar los `send(seats[i].w, ESCROW, escrowAlephAbi, "open"/"deposit", …)` por:

```ts
const r = await agents[i].alephDeposit(roomId);
console.log(`✓ asiento ${i}: ${r.step} ${r.txHash}`);
```

y los `join(s, now)` / `view(…)` / `act(…)` in-process por `agents[i].alephJoin(2)`, `agents[i].alephView(roomId)`, `agents[i].alephAct(roomId, action, at)`. El escenario 2 sigue avanzando el reloj del árbitro con `alephChainTick(now)` in-process (las dos cosas conviven: el router y las funciones son el mismo módulo). Para el montaje:

```ts
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgent } from "@arcade1v1/agent-sdk";
import { alephRouter } from "./aleph-routes.js";

const app = express();
app.use(express.json());
app.use(alephRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const agents = SEAT_KEYS.map((pk) =>
  createAgent({ arbiterUrl: BASE, privateKey: pk as Hex, rpcUrl: RPC }),
);
// … y al final de main(): server.close();
```

Como el e2e ahora entra por HTTP, el árbitro exige firma solo si `REQUIRE_AUTH=true`: dejarlo sin setear (dev), el SDK firma igual.

Run: `bash packages/contracts/check-aleph-e2e.sh`
Expected: `REEMBOLSO POR FONDEO INCOMPLETO VERIFICADO ✅`, con las líneas `asiento 0: open 0x…` y `asiento 1..3: deposit 0x…`. Para probar la carrera de `open` no hace falta un test aparte: en el escenario 1, mandar los 4 `alephDeposit` con `Promise.all` — anvil mina en orden, uno abre y los otros tres caen en `"room exists"` → `deposit`. Dejarlo así en el script (documenta la carrera).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-sdk/src/agent.ts packages/agent-sdk/src/index.ts packages/agent-sdk/test/agent-aleph.test.ts apps/server/src/aleph-onchain-e2e.ts
git commit -m "feat(agent-sdk): alephDeposit — la wallet del agente deposita en la mesa de plata (approve + open/deposit)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Las reglas dicen cómo se paga al final (decisión 4) y cómo es la mesa de plata

**Files:**

- Modify: `packages/agent-sdk/src/aleph.ts` (`describeAlephRules`)
- Modify: `packages/agent-sdk/test/aleph-text.test.ts`

- [ ] **Step 1: El test que falla**

```ts
test("las reglas explican el piso de la caja y el flujo de la mesa de plata", () => {
  const text = describeAlephRules();
  // Decisión 4 del spec de la etapa 4: nadie se sienta creyendo que aportar
  // siempre conviene. El piso: bolsillo + caja por cabeza, votado o no.
  assert.match(text, /PAYOUT FLOOR/);
  assert.match(text, /pocket is yours/i);
  assert.match(text, /alive or eliminated/i);
  // La mesa de plata: stakes del árbitro, funding, deposit, settleTx.
  assert.match(text, /MONEY TABLES/);
  assert.match(text, /GET \/aleph\/lobbies/);
  assert.match(text, /`funding`/);
  assert.match(text, /alephDeposit/);
  assert.match(text, /aleph_deposit/);
  assert.match(text, /settleTx/);
  assert.doesNotMatch(text, /Only the free table/);
});
```

Run: `node --import tsx --test packages/agent-sdk/test/aleph-text.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementar**

En `describeAlephRules()`:

1. En la primera línea, reemplazar `Only the free table (stake 0) exists in this version.` por `Two tables: free (stake 0) and money (see MONEY TABLES below).`
2. Después de la línea `"- When the room ends, each seat is paid pocket + floor(box / seats). Eliminated seats keep their pocket."` agregar:

```ts
    "- PAYOUT FLOOR (read this before you contribute): whatever is in your pocket is yours, and the box is split per head among ALL seats, alive or eliminated. No vote can take that away. Contributing only pays if enough others contribute too: a table that votes you out AFTER you contributed keeps your contribution in the pot. Keeping is a hard floor; contributing is a bet on the table.",
```

3. Antes de la línea `"TIME: …"` agregar:

```ts
    "MONEY TABLES (stake > 0, testnet USDC): the arbiter lists its stakes in GET /aleph/lobbies (`stakes`). Taking a seat is free and off-chain; when the lobby closes, a money room enters `funding` instead of starting: your private view carries `deposit` (escrow, USDC, stake in micro-USDC, the frozen seat list, deadlines and your signed pass). Deposit within about 10 minutes — SDK: `agent.alephDeposit(roomId)` (needs `rpcUrl` and a wallet holding the stake plus gas); MCP: `aleph_deposit`. The room starts only when EVERY seat deposited; if one is missing when the funding deadline passes, the room dissolves and everyone who deposited gets their stake back. At the end the units table is converted to USDC minus the platform fee (15 % of the pot), signed by the arbiter and paid by the contract to all seats in one transaction (`payoutsUsdc`, `payoutSig` and `settleTx` in the view and the log; anyone can present the signed table). The house never fills a money table, so they start less often than the free one.",
    "",
```

- [ ] **Step 3: Correr, y el snapshot del ejemplo LLM**

Run: `node --import tsx --test packages/agent-sdk/test/aleph-text.test.ts packages/agent-sdk/test/aleph-llm.test.ts`
Expected: PASS (si `aleph-llm.test.ts` fija el texto de reglas por longitud o por snapshot, actualizar ese assert; el contenido lo manda este cambio).

- [ ] **Step 4: Commit**

```bash
git add packages/agent-sdk/src/aleph.ts packages/agent-sdk/test/aleph-text.test.ts
git commit -m "feat(agent-sdk): las reglas explican el piso de la caja y la mesa de plata

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: MCP: wallet configurable y `aleph_deposit`

**Files:**

- Modify: `apps/mcp/src/index.ts`
- Modify: `apps/mcp/src/tools.ts`
- Modify: `apps/mcp/src/server.ts`
- Modify: `apps/mcp/test/tools-aleph.test.ts`, `apps/mcp/test/server.test.ts`

**Interfaces:**

- Produces: `alephDepositTool(agent, roomId): Promise<AlephAgentView & { step; txHash? }>`; `AlephAgentView.mustDeposit: boolean`; herramienta MCP `aleph_deposit { roomId }`; env `ARCADE_PRIVATE_KEY` (opcional) y `RPC_URL` (opcional).

- [ ] **Step 1: Los tests que fallan**

En `apps/mcp/test/tools-aleph.test.ts` (extender `FakeAleph` con `status`, `deposited`, `deposit` como en el SDK):

```ts
test("aleph_view marca mustDeposit cuando la sala fondea y este asiento no depositó", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" });
  fake.status = "funding";
  fake.deposited = [];
  fake.deposit = {
    chainId: 31337,
    escrow: "0x" + "e".repeat(40),
    usdc: "0x" + "1".padStart(40, "0"),
    stake: "2000000",
    seats: [agent.address.toLowerCase()],
    seatsHash: "0x" + "0".repeat(64),
    fundDeadline: 1,
    playDeadline: 2,
    seatSig: "0x" + "0".repeat(130),
  };
  const v = await alephViewTool(agent, ROOM);
  assert.equal(v.mustDeposit, true);
  assert.deepEqual(v.legal, [], "sin acciones del motor mientras fondea");
  fake.deposited = [agent.address.toLowerCase()];
  assert.equal((await alephViewTool(agent, ROOM)).mustDeposit, false);
});

test("aleph_deposit: sin rpcUrl explica qué falta; con la sala en juego no manda nada", async () => {
  const fake = new FakeAleph();
  await assert.rejects(() => alephDepositTool(createAgent({ client: fake }), ROOM), /rpcUrl/);
  await assert.rejects(
    () => alephDepositTool(createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" }), ROOM),
    /not funding/,
  );
});
```

En `apps/mcp/test/server.test.ts` (cableado real por `InMemoryTransport`): en el assert que lista las herramientas, agregar `"aleph_deposit"` (12 herramientas en total).

Run: `node --import tsx --test apps/mcp/test/tools-aleph.test.ts apps/mcp/test/server.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementar**

`tools.ts`: en `AlephAgentView` agregar:

```ts
/** Mesa de plata en `funding` y este asiento todavía no depositó: la
 *  próxima llamada es `aleph_deposit`, no `aleph_act`. */
mustDeposit: boolean;
```

En `withLegal`:

```ts
    mustDeposit:
      v.status === "funding" &&
      !!v.deposit &&
      !(v.deposited ?? []).some((a) => a.toLowerCase() === agent.address.toLowerCase()),
```

Y la herramienta nueva:

```ts
export async function alephDepositTool(
  agent: Agent,
  roomId: string,
): Promise<AlephAgentView & { step: "open" | "deposit" | "already"; txHash?: string }> {
  const r = await agent.alephDeposit(roomId);
  // La vista que se devuelve es la de ANTES de depositar (el árbitro ve el
  // depósito en su próximo tick, unos segundos): el modelo sigue sondeando
  // aleph_view hasta que `deposited` lo incluya y la sala pase a `playing`.
  return { ...withLegal(agent, r.view), step: r.step, txHash: r.txHash };
}
```

`server.ts`: importar `alephDepositTool`; versión `"0.4.0"`; en `aleph_rules` quitar `Only the free table exists.`; en `aleph_join` el `stake` pasa a:

```ts
        stake: z
          .number()
          .describe(
            "0 = the free table. A money table (see aleph_lobbies `stakes`, e.g. 2 USDC on testnet) needs this server started with ARCADE_PRIVATE_KEY (a wallet holding the stake in USDC plus gas) and RPC_URL; the room then enters `funding` and you must call aleph_deposit before the deadline.",
          )
          .default(0),
```

y registrar, después de `aleph_act`:

```ts
server.registerTool(
  "aleph_deposit",
  {
    title: "Aleph: deposit my stake",
    description:
      "Money tables only. When aleph_view shows `mustDeposit: true` (the room is `funding` and you have not deposited), this sends your stake from this server's wallet to the escrow: approve if needed, then `open` (if you are the first) or `deposit`. Idempotent. Needs ARCADE_PRIVATE_KEY and RPC_URL in this server's environment. Then keep polling aleph_view: the room starts once every seat deposited, or dissolves (refunding everyone) if one is missing at the deadline.",
    inputSchema: { roomId: z.string() },
  },
  async ({ roomId }) => ok(await alephDepositTool(agent, roomId)),
);
```

`index.ts`:

```ts
import type { Hex } from "viem";
...
// Wallet: efímera por sesión (solo firma) salvo que el operador ponga la suya.
// Con ARCADE_PRIVATE_KEY + RPC_URL la wallet puede DEPOSITAR en una mesa de
// plata de Aleph; sin ellas, solo la mesa gratis (como siempre).
const privateKey = process.env.ARCADE_PRIVATE_KEY as Hex | undefined;
const rpcUrl = process.env.RPC_URL;
...
  const agent = createAgent({ arbiterUrl, client, privateKey, rpcUrl });
```

- [ ] **Step 3: Correr y commitear**

Run: `node --import tsx --test apps/mcp/test/*.test.ts && npm run typecheck:mcp`
Expected: PASS.

```bash
git add apps/mcp/src apps/mcp/test
git commit -m "feat(mcp): aleph_deposit y wallet configurable (ARCADE_PRIVATE_KEY + RPC_URL) para la mesa de plata

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: La web: mesa de plata en `/aleph`, fondeo y pago en la sala

**Files:**

- Modify: `apps/web/app/lib/arbiter.ts`
- Create: `apps/web/app/lib/explorer.ts`
- Modify: `apps/web/app/aleph/page.tsx`
- Modify: `apps/web/app/aleph/[roomId]/page.tsx`
- Modify: `apps/web/app/lib/i18n/es.ts`, `en.ts`, `fr.ts`, `hi.ts`
- Modify: `apps/web/app/agents/content.ts`

- [ ] **Step 1: Cliente y explorador**

En `arbiter.ts`, junto a `getAlephLobbies`:

```ts
/** Lobbies (abiertos o fondeando) más las mesas que acepta el árbitro. */
export function getAlephLobbiesInfo(): Promise<{ lobbies: AlephLobby[]; stakes: number[] }> {
  return client.alephLobbiesInfo();
}
```

Y en `RecentAlephRoom`: `settleTx?: string;`.

```ts
// apps/web/app/lib/explorer.ts
// Link a una transacción en el explorador de la red configurada. Una sola
// función para que el chainId no se re-declare en cada página.
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);

export function txUrl(hash: string): string {
  const host = CHAIN_ID === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${host}/tx/${hash}`;
}
```

- [ ] **Step 2: Las claves i18n (4 idiomas)**

Agregar en `es.ts` (y sus equivalentes en `en`, `fr`, `hi`; los tres se escriben completos, no se copian del español):

```ts
  "aleph.lobby.money": "{stake} USDC",
  "aleph.lobby.emptyMoney":
    "No hay mesa de {stake} USDC armándose. La casa no la rellena: arranca solo cuando cuatro agentes de verdad ponen su stake.",
  "aleph.lobby.funding": "fondeando: {deposited} de {seats} depositaron",
  "aleph.lobby.fundingCountdown": "vence en {time}",
  "aleph.lobby.moneyNote":
    "Si al vencer el fondeo falta un depósito, la sala se disuelve y el contrato devuelve cada stake.",
  "aleph.room.status.funding": "FONDEANDO",
  "aleph.room.stakeChip": "{stake} USDC",
  "aleph.room.fundingIntro":
    "Lista congelada: {deposited} de {n} asientos ya depositaron {stake} USDC. Si falta uno al vencer, se devuelve todo.",
  "aleph.room.fundingDeadline": "vence en {time}",
  "aleph.room.dissolvedMoney":
    "El fondeo venció sin los {n} depósitos: la sala se disolvió y el contrato devolvió cada stake.",
  "aleph.seat.deposited": "depositó",
  "aleph.seat.pending": "sin depositar",
  "aleph.room.usdc": "USDC",
  "aleph.room.payoutsMoney":
    "Pozo de {pot} USDC menos la comisión del {fee} %: cada fila es bolsillo + caja, convertido a USDC.",
  "aleph.room.settleTx": "Ver la transacción de pago",
  "aleph.room.settlePending":
    "La tabla firmada ya está publicada; la transacción de pago todavía no salió. Cualquiera puede presentarla al contrato.",
```

Y cambiar dos existentes: `aleph.p3` termina en `"…verifica la tabla de pagos. Hay una mesa gratis y una de 2 USDC de testnet; en la de plata cada asiento deposita en el contrato antes de que la sala arranque."` (quitando "Por ahora, solo la mesa gratis."), y `aleph.join.mcpBody` pasa de "Cinco herramientas" a "Seis herramientas".

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: PASS (paridad de claves en los 4 idiomas).

- [ ] **Step 3: `/aleph`: una tarjeta por mesa**

En `page.tsx`: importar `getAlephLobbiesInfo` en vez de `getAlephLobbies`; estado `stakes` (`number[]`, default `[0]`); en `load`, `const [l, r] = await Promise.allSettled([getAlephLobbiesInfo(), getRecentAlephRooms(10)])` y `setLobbies(l.value.lobbies); setStakes(l.value.stakes)`. La sección "Lobby abierto" pasa a renderizar una `<section className="win">` por cada `stake` de `stakes`:

```tsx
{
  stakes.map((stake) => {
    const mine = lobbies.filter((l) => l.stake === stake);
    return (
      <section key={stake} className="win mt-6">
        <div className="win-title">
          <span>{t("aleph.lobby.title")}</span>
          <span className={`chip ${stake > 0 ? "chip--money" : ""}`}>
            {stake === 0 ? t("aleph.lobby.free") : t("aleph.lobby.money", { stake })}
          </span>
        </div>
        <div className="p-5">
          {offline ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {t("aleph.offline")}
            </p>
          ) : lobbies === null ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {t("match.connecting")}
            </p>
          ) : mine.length === 0 ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {stake === 0 ? t("aleph.lobby.empty") : t("aleph.lobby.emptyMoney", { stake })}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {mine.map((l) => (
                <LobbyCard key={l.roomId} l={l} now={now} t={t} />
              ))}
            </div>
          )}
          {stake > 0 && (
            <p className="mt-4 text-sm leading-relaxed text-(--color-muted-3)">
              {t("aleph.lobby.moneyNote")}
            </p>
          )}
        </div>
      </section>
    );
  });
}
```

Y extraer la tarjeta actual a `LobbyCard`, con la rama de fondeo:

```tsx
function LobbyCard({ l, now, t }: { l: AlephLobby; now: number; t: T }) {
  const left = countdown(l.closesAt, now);
  if (l.status === "funding") {
    const dep = l.deposited ?? 0;
    return (
      <Link
        href={`/aleph/${l.roomId}`}
        className="block rounded-lg bg-(--color-surface-2) p-4 transition hover:-translate-y-0.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-pixel text-sm text-(--color-gold)">
            {t("aleph.lobby.funding", { deposited: dep, seats: l.seats })}
          </span>
          <span className="font-mono text-sm text-(--color-muted-bright)">
            {left === null
              ? t("aleph.lobby.closing")
              : t("aleph.lobby.fundingCountdown", { time: left })}
          </span>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {Array.from({ length: l.seats }, (_, i) => (
            <span
              key={i}
              className={`h-2 flex-1 rounded-full ${i < dep ? "bg-(--color-gold)" : "bg-(--color-border)"}`}
            />
          ))}
        </div>
      </Link>
    );
  }
  // … la tarjeta de lobby tal como está hoy (asientos, cuenta regresiva, barra, willStart/needs)
}
```

(`T` es el mismo alias de tipo que usa `[roomId]/page.tsx`; importar `AlephLobby` de `@/app/lib/arbiter`.) Ajustar el snippet `MCP_SNIPPET` para mencionar la mesa de plata:

```ts
aleph_join   { stake: 0 }   # take a seat (stake 2 = the money table; needs a funded wallet)
aleph_deposit { roomId }    # money table only: deposit when the room is funding
```

- [ ] **Step 4: `/aleph/[roomId]`: fondeo y pago**

En el encabezado (dentro de `.win-title`), después del chip de estado, si `room.stake > 0`: `<span className="chip chip--money">{t("aleph.room.stakeChip", { stake: room.stake })}</span>`.

En el cuerpo del encabezado, una rama nueva antes de `room.status === "dissolved"`:

```tsx
          ) : room.status === "funding" ? (
            <p className="text-base leading-relaxed text-(--color-muted)">
              {t("aleph.room.fundingIntro", {
                deposited: room.deposited?.length ?? 0,
                n: room.seats.length,
                stake: room.stake,
              })}{" "}
              {room.fundingDeadline ? (
                <span className="font-mono text-(--color-muted-bright)">
                  {t("aleph.room.fundingDeadline", { time: mmss(room.fundingDeadline - now) })}
                </span>
              ) : null}
            </p>
```

Y la rama `dissolved` distingue la mesa de plata: `room.fundingDeadline !== undefined ? t("aleph.room.dissolvedMoney", { n: room.seats.length }) : t("aleph.room.dissolved", { min: room.min })`.

El reloj propio corre también en `funding`: `const counting = (room?.status === "playing" && room.deadline !== undefined) || (room?.status === "funding" && room.fundingDeadline !== undefined);`. Y el sondeo sigue mientras `funding` (ya sigue: solo corta en `settled`/`dissolved`).

`SeatRow` recibe `deposited?: boolean` y, cuando la sala está en `funding`, muestra `t(deposited ? "aleph.seat.deposited" : "aleph.seat.pending")` en vez de `t(`aleph.seat.${seat.status}`)`:

```tsx
{
  room.seats.map((s) => (
    <SeatRow
      key={s.address}
      seat={s}
      payout={room.payouts?.[s.address]}
      funding={room.status === "funding"}
      deposited={room.deposited?.some((a) => a.toLowerCase() === s.address.toLowerCase())}
      t={t}
    />
  ));
}
```

En la tabla de pagos (`room.status === "settled" && room.payouts`), si `room.payoutsUsdc`: cada fila suma una tercera columna `{(Number(room.payoutsUsdc[address] ?? 0) / 1e6).toFixed(2)} USDC` en `font-mono text-sm text-(--color-gold)`; el chip del título pasa a `t("aleph.room.usdc")` cuando hay USDC; debajo de la lista:

```tsx
{
  room.payoutsUsdc && (
    <p className="mt-3 text-sm leading-relaxed text-(--color-muted-3)">
      {t("aleph.room.payoutsMoney", { pot: room.stake * room.seats.length, fee: 15 })}
    </p>
  );
}
{
  room.stake > 0 && (
    <p className="mt-3">
      {room.settleTx && /^0x[0-9a-f]{64}$/i.test(room.settleTx) ? (
        <a
          href={txUrl(room.settleTx)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-(--color-accent-2) hover:underline"
        >
          {t("aleph.room.settleTx")} ↗
        </a>
      ) : (
        <span className="text-sm text-(--color-muted-3)">{t("aleph.room.settlePending")}</span>
      )}
    </p>
  );
}
```

(`fee: 15` viene del spec; si el registro trae `usdc.feeBps` se podría leer de ahí, pero la vista no lo trae y 15 % es la constante de producción documentada. Dejar un comentario diciéndolo.) Importar `txUrl` de `@/app/lib/explorer`.

En `content.ts`, en los 4 idiomas: `tools` pasa a "Six MCP tools … **aleph_act** and **aleph_deposit** (money tables)"; `body` suma una frase final: "There is a free table and a 2 USDC testnet table: on the money one, every seat deposits into the escrow before the room starts and one signed table pays everyone at the end."

- [ ] **Step 5: Verificar**

```bash
npm run typecheck:web && node --import tsx --test apps/web/test/*.test.ts && npm run lint && npm run build --workspace apps/web
```

Expected: verde. Después, con el árbitro local corriendo con `ALEPH_STAKES=0,2` y `ALEPH_ESCROW_ADDRESS` de un anvil (o directamente contra `NEXT_PUBLIC_ARBITER_URL` de producción una vez desplegado el PR 2 + Task 7), abrir `/aleph` y `/es/aleph`: dos tarjetas (GRATIS y 2 USDC), la de plata con su nota. Sacar captura y adjuntarla al PR.

- [ ] **Step 6: Commit**

```bash
npm run format
git add apps/web/app/lib/arbiter.ts apps/web/app/lib/explorer.ts apps/web/app/aleph apps/web/app/lib/i18n apps/web/app/agents/content.ts
git commit -m "feat(web): la mesa de plata en /aleph, la fase de fondeo y el link a la transacción de pago

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs, CHANGELOG, versiones 0.4.0 y dry-run de publicación

**Files:** `AGENTS.md`, `apps/web/public/llms.txt`, `packages/agent-sdk/README.md`, `apps/mcp/README.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `SECURITY.md`, `DEPLOY.md`, `docs/ROADMAP.md`, `README.md`, `CHANGELOG.md`, el spec, `packages/{game-sdk,strategies,agent-sdk}/package.json`, `apps/mcp/package.json`, `apps/mcp/server.json`.

- [ ] **Step 1: Textos para agentes (inglés)**

`AGENTS.md`, sección "Aleph": reemplazar `Free table (stake 0) only in this version;` por `Two tables: free (stake 0) and 2 USDC on testnet (see "Money tables" below);`. Después de la lista "Four things every agent must know", agregar:

```markdown
### Money tables (stage 4)

`GET /aleph/lobbies` returns `stakes` (today `[0, 2]`). A seat at the 2 USDC
table is free and off-chain; when the lobby closes the room enters
**`funding`**: your private view carries `deposit` (escrow, USDC, stake in
micro-USDC, the frozen seat list, on-chain deadlines and your signed pass). You
have ~10 minutes to deposit — `agent.alephDeposit(roomId)` with
`createAgent({ privateKey, rpcUrl })` (a wallet holding the stake plus gas), or
the MCP tool `aleph_deposit` (server started with `ARCADE_PRIVATE_KEY` and
`RPC_URL`). The room starts only when every seat deposited; otherwise it
dissolves and the contract refunds each stake. At the end the units table is
converted to USDC minus the 15 % fee, signed by the arbiter and paid to all
seats in one transaction (`payoutsUsdc`, `payoutSig`, `settleTx`; the signed
table is public, anyone can present it). The house never fills a money table.

**Read the payout floor before you contribute** (`aleph_rules`, "PAYOUT
FLOOR"): your pocket is yours and the box is split per head among all seats,
voted out or not — contributing is a bet on the table, not a guaranteed gain.
```

Y en el bloque del flujo raw HTTP, `{ stake: 0, …}` pasa a `{ stake: 0 | 2, … }` con una línea: `-> (money table) when status is "funding", deposit with the pass from your private view, then keep polling`.

`llms.txt`: `Free table (stake 0) only.` → `Free table (stake 0) and a 2 USDC testnet table: on the money table the room enters "funding" when the lobby closes, every seat deposits on-chain with a signed pass from its private view (SDK: agent.alephDeposit; MCP: aleph_deposit), and one signed USDC table pays everyone at the end (settleTx in the log).`; en la línea de herramientas, agregar `aleph_deposit`; en el flujo, `{ stake: 0, …}` → `{ stake: 0 | 2, … }`.

`packages/agent-sdk/README.md`: nueva nota de versión arriba de la de 0.3.0:

```markdown
> **0.4.0 (September 2026):** money tables in Aleph — `createAgent({ rpcUrl })`
> lets the agent's wallet deposit (`agent.alephDeposit(roomId)`) when a 2 USDC
> room enters `funding`; the view carries `deposit`, `deposited`,
> `payoutsUsdc` and `settleTx`; `mcp` adds `aleph_deposit`. Free-table play is
> unchanged.
```

y en "Play Aleph", después del bloque de código, un párrafo con el mismo contenido que "Money tables" de AGENTS.md (resumido en 6 líneas) más el snippet:

```ts
const paying = createAgent({
  privateKey: process.env.ARCADE_PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL,
});
let v = await paying.alephJoin(2);
while (v.status === "lobby") {
  await sleep(5_000);
  v = await paying.alephView(v.roomId);
}
if (v.status === "funding") await paying.alephDeposit(v.roomId); // approve + open/deposit
```

`apps/mcp/README.md`: la misma nota 0.4.0; en "Tools", `Aleph (…): … · aleph_act · aleph_deposit (money tables; needs ARCADE_PRIVATE_KEY + RPC_URL)`; y una sección "Money tables" de 4 líneas con las dos variables.

- [ ] **Step 2: Textos del repo (español)**

`SECURITY.md`, sección "Aleph": reemplazar el primer párrafo (`Aleph corre solo en la mesa gratis…`) por:

```markdown
Aleph tiene dos mesas: la gratis (sin USDC ni contrato: su superficie de riesgo
es la del árbitro) y la de **2 USDC de testnet**, custodiada por
`EscrowAleph.sol`, un contrato aparte del 1v1. Lo que el contrato garantiza
aunque la llave del árbitro se filtre: la tabla de pagos solo puede pagar a los
asientos de ESA sala, en su orden, y la plataforma nunca cobra más que la
comisión más el polvo del redondeo (menos de N micro-USDC); una llave robada
puede repartir mal entre los que jugaban, no sacar la plata a un extraño ni
inventar fondos. Lo que NO garantiza: el árbitro sigue calculando la tabla, y lo
que lo mantiene honesto es el registro público (`scripts/aleph-verify.mjs`
recalcula también la tabla en USDC). Tres reembolsos cubren fondeo vencido,
liquidación que no llega (tras `playDeadline` + 30 min de gracia) y disputa. La
colusión está medida y aceptada (spec de la etapa 4, decisión 4): contra un
asiento que se defiende no paga; contra uno ingenuo, la comisión se come casi
todo. Esta etapa NO desbloquea mainnet: un contrato más para auditar.
```

Y en el párrafo de la casa, `La etapa 4 no puede reusarlas tal cual: ahí una clave del servidor custodiaría dinero.` → `La casa nunca se sienta en una mesa de plata (decisión 6 de la etapa 4, con test).`

`DEPLOY.md`: una sección corta "EscrowAleph (mesas de plata de Aleph)": `bash packages/contracts/deploy-aleph-base-sepolia.sh`, las dos variables de Render (`ALEPH_ESCROW_ADDRESS`, `ALEPH_STAKES=0,2`), y que el árbitro necesita gas para `settle`/`cancelRoom` (mismo `ARBITER_PRIVATE_KEY`).

`docs/ROADMAP.md`: la viñeta de la etapa 4 pasa a `- **Etapa 4 — mesas de plata** ✅: contrato \`EscrowAleph\` con N depósitos y una tabla firmada que paga en una transacción; fondeo en el árbitro; depósito desde el SDK y el MCP; \`/aleph\` con la mesa de 2 USDC. Desplegado en Base Sepolia el <fecha>.`y el título de v4.2 pasa a`_(etapas 1–4)_`.

`README.md`: en la viñeta de Aleph (línea ~187), agregar `Mesa gratis y mesa de 2 USDC de testnet: en la de plata cada asiento deposita en el contrato antes de arrancar y una sola tabla firmada paga a todos.`

`docs/ARCHITECTURE.md` (sección 7bis): un párrafo "Money tables" con los tres módulos (`EscrowAleph.sol`, `aleph-chain.ts` + la fase `funding` en `aleph.ts`, `alephDeposit` en el SDK) y el diagrama de estados `lobby → funding → playing → settled`.

`docs/TESTING.md`: en la tabla, sumar `aleph-usdc.test.ts` (game-sdk), `aleph-sign.test.ts`, `aleph-funding.test.ts` (server), `EscrowAleph.t.sol` (contracts), y los dos scripts de anvil `check-aleph-deploy.sh` y `check-aleph-e2e.sh`.

El spec (`…mesas-de-plata-design.md`): `**Estado:** listo para construir…` → `**Estado:** construido (PRs #N, #N+1, #N+2) y desplegado en Base Sepolia el <fecha>. Desvíos de implementación anotados en los tres planes de \`docs/superpowers/plans/2026-09-11-aleph-etapa4-\*.md\`.`

- [ ] **Step 3: CHANGELOG**

En `## [Sin publicar]`, arriba de "Relleno de la casa en Aleph":

```markdown
- **Mesas de plata en Aleph (etapa 4).** Hasta acá el pozo eran unidades que no
  valían nada afuera de la sala: traicionar en la Final no le costaba a nadie.
  Ahora hay una mesa de **2 USDC de testnet** al lado de la gratis. Un contrato
  nuevo, `EscrowAleph.sol` (aparte del 1v1, que custodia plata viva), recibe el
  stake de los 4 a 8 asientos con un **pase firmado** por el árbitro para cada
  uno (ata la sala, la lista congelada, el stake y los plazos: nadie puede
  sentarse ni inventar la mesa), arranca la sala recién con los N depósitos, y
  al final paga a todos **en una sola transacción** con una tabla firmada que
  el contrato verifica: solo asientos de esa sala, en su orden, y la plataforma
  no cobra más que la comisión más el polvo del redondeo. Tres reembolsos
  exactos: fondeo vencido, liquidación que no llega (más 30 min de gracia) y
  disputa. La casa nunca se sienta en una mesa de plata.

  En el árbitro, el lobby de plata que cierra entra en **fondeo** (10 min) y el
  pase viaja en la vista privada del asiento; el árbitro lee la cadena, convierte
  la tabla de unidades a USDC (comisión leída del contrato, polvo aparte), la
  firma, la publica y la manda. En el SDK, `createAgent({ rpcUrl })` +
  `agent.alephDeposit(roomId)`; en el MCP, `aleph_deposit` con
  `ARCADE_PRIVATE_KEY` y `RPC_URL`. `/aleph` muestra las dos mesas, la fase de
  fondeo y el link a la transacción de pago. Las reglas explican con todas las
  letras el **piso de la caja**: el bolsillo es tuyo y la caja se reparte por
  cabeza entre todos, votados o no. Perillas: `ALEPH_STAKES`,
  `ALEPH_ESCROW_ADDRESS`, `ALEPH_FUNDING_MS`, `ALEPH_PLAY_WINDOW_MS`.
  `scripts/aleph-verify.mjs` recalcula también la tabla en USDC. Sigue en
  testnet: esta etapa no desbloquea mainnet.
```

- [ ] **Step 4: Versiones y dry-run**

`0.3.0` → `0.4.0` en `packages/game-sdk/package.json`, `packages/strategies/package.json`, `packages/agent-sdk/package.json`, `apps/mcp/package.json`, `apps/mcp/server.json` (2 lugares) y `new McpServer({ name: "arcade1v1", version: "0.4.0" })` en `server.ts` (ya hecho en Task 4; verificar). Si `apps/mcp/test/manifest.test.ts` fija la versión, actualizarlo.

```bash
npm run check && npm run build --workspace apps/web
node scripts/publish-sdk.mjs game-sdk --dry-run
node scripts/publish-sdk.mjs strategies --dry-run
node scripts/publish-sdk.mjs agent-sdk --dry-run
```

Expected: todo verde; los dry-run listan los archivos (incluido `aleph-escrow` dentro del bundle de `aleph`). **No publicar.**

- [ ] **Step 5: Commit y PR**

```bash
npm run format
git add -A
git commit -m "docs(aleph): etapa 4 — mesas de plata en AGENTS, llms.txt, READMEs, SECURITY, DEPLOY, ROADMAP y CHANGELOG; 0.4.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/aleph-etapa4-agentes-web
gh pr create --title "feat(aleph): etapa 4, PR 3 — depósito desde SDK y MCP, la mesa de plata en la web, docs y 0.4.0" --body "$(cat <<'EOF'
## Qué hay

- SDK: `createAgent({ rpcUrl })` y `agent.alephDeposit(roomId)` (approve + open/deposit, tolera la carrera de dos que abren); tipos de `funding`/`deposit`/`payoutsUsdc`; `alephLobbiesInfo()`.
- MCP: `aleph_deposit` (sexta herramienta) y wallet configurable con `ARCADE_PRIVATE_KEY` + `RPC_URL`; `mustDeposit` en cada vista.
- Reglas: párrafo MONEY TABLES y el PAYOUT FLOOR (decisión 4 del spec).
- Web: una tarjeta por mesa en `/aleph`, fase de fondeo en la sala, tabla en USDC y link a la transacción.
- E2E de anvil: los asientos ahora depositan con el SDK por HTTP.
- Docs, CHANGELOG, 0.4.0 (dry-run de publicación hecho; NO publicado).

Spec: docs/superpowers/specs/2026-09-10-aleph-etapa4-mesas-de-plata-design.md
Plan: docs/superpowers/plans/2026-09-11-aleph-etapa4-3-agentes-y-web.md
Depende de: PR 2, ya en main.

## Desvíos del spec (en el plan)

1. Sexta herramienta MCP `aleph_deposit` (el modelo no puede mandar una transacción sin herramienta).
2. `alephJoin(2)` no devuelve el pase: llega en `alephView` cuando la sala está en `funding`.
3. La web no necesita variables nuevas.

## Después del merge (con OK del dueño)

Desplegar `EscrowAleph` en Sepolia, cargar `ALEPH_ESCROW_ADDRESS` y `ALEPH_STAKES=0,2` en Render, smoke con 4 wallets, publicar 0.4.0. Pasos en la Task 7 del plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 7: Despliegue en Base Sepolia y smoke con 4 wallets (cada paso con OK del dueño)

**Files:**

- Create: `scripts/aleph-money-smoke.mjs`

Esta tarea toca infraestructura real (contrato en testnet, variables de Render, publicación en npm). **Cada paso se ejecuta solo con el OK explícito del dueño**, y sin costo nuevo: el árbitro ya corre en Render, el gas es de testnet.

- [ ] **Step 1: El smoke (se escribe antes, se corre después)**

```js
#!/usr/bin/env node
// scripts/aleph-money-smoke.mjs
// SMOKE de la mesa de plata contra un árbitro PUBLICADO (Base Sepolia): cuatro
// wallets del SDK se sientan en la mesa de 2 USDC, esperan que el lobby cierre
// (hasta ALEPH_LOBBY_MS, 10 min), depositan, juegan con una política guionada,
// y al final comprueban que el contrato pagó lo que dice la tabla firmada.
// Tarda 15-30 minutos: el lobby y el fondeo tienen plazos reales.
//
// Uso: ARBITER_URL=https://arcade1v1.onrender.com RPC_URL=https://sepolia.base.org \
//      FUNDER_KEY=0x… node --import tsx scripts/aleph-money-smoke.mjs
// FUNDER_KEY: una wallet con ETH de Sepolia; manda 0,002 ETH de gas a cada una
// de las 4 wallets efímeras. El USDC de prueba tiene mint abierto: se mintea.
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createAgent } from "@arcade1v1/agent-sdk";
import { erc20MinimalAbi, usdcPayoutTable } from "@arcade1v1/game-sdk/aleph";

const ARBITER = process.env.ARBITER_URL ?? "https://arcade1v1.onrender.com";
const RPC = process.env.RPC_URL ?? "https://sepolia.base.org";
const FUNDER = process.env.FUNDER_KEY;
if (!FUNDER) {
  console.error("falta FUNDER_KEY (wallet con ETH de Base Sepolia para el gas de las 4 wallets)");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const funder = createWalletClient({
  account: privateKeyToAccount(FUNDER),
  chain: baseSepolia,
  transport: http(RPC),
});

function policy(v, me) {
  const st = v.stage;
  if (st.phase === "talk") return { type: "ready" };
  const alive = v.seats.filter((s) => s.status === "alive");
  switch (st.kind) {
    case "share":
      return { type: me === alive[0].address ? "keep" : "contribute" };
    case "offer":
      return { type: "decline" };
    case "vote":
      return { type: "vote", target: (alive.find((s) => s.address !== me) ?? alive[0]).address };
    case "lock":
      return { type: "ready" };
    default:
      return { type: "split" };
  }
}

const agents = Array.from({ length: 4 }, () =>
  createAgent({ arbiterUrl: ARBITER, privateKey: generatePrivateKey(), rpcUrl: RPC }),
);
console.log("wallets:", agents.map((a) => a.address).join(" "));

// 1) Sentarse (la mesa de 2 tiene que estar en `stakes`).
const info = await agents[0].client.alephLobbiesInfo();
if (!info.stakes.includes(2))
  throw new Error(`el árbitro no ofrece la mesa de 2: stakes=${info.stakes}`);
let v;
for (const a of agents) v = await a.alephJoin(2);
const roomId = v.roomId;
console.log("sala:", roomId, "estado:", v.status);

// 2) Esperar el cierre del lobby (hasta 10 min) y leer el bloque de depósito.
while (v.status === "lobby") {
  await sleep(10_000);
  v = await agents[0].alephView(roomId);
  process.stdout.write(".");
}
console.log("\nestado:", v.status);
if (v.status !== "funding") throw new Error(`esperaba funding, hay ${v.status}`);
const d = v.deposit;
const stake = BigInt(d.stake);

// 3) Gas + USDC para las 4 y depositar.
for (const a of agents) {
  const h = await funder.sendTransaction({ to: a.address, value: parseEther("0.002") });
  await pub.waitForTransactionReceipt({ hash: h });
  const m = await funder.writeContract({
    address: d.usdc,
    abi: erc20MinimalAbi,
    functionName: "mint",
    args: [a.address, stake],
  });
  await pub.waitForTransactionReceipt({ hash: m });
}
const results = await Promise.all(agents.map((a) => a.alephDeposit(roomId)));
for (const r of results) console.log("depósito:", r.step, r.txHash);

// 4) Esperar que el árbitro vea los depósitos y arranque; jugar hasta el final.
while (v.status === "funding") {
  await sleep(5_000);
  v = await agents[0].alephView(roomId);
}
if (v.status !== "playing") throw new Error(`esperaba playing, hay ${v.status}`);
console.log("arrancó · commit:", v.commit);
while (v.status === "playing") {
  for (const a of agents) {
    const mine = await a.alephView(roomId);
    const you = mine.you;
    if (mine.status !== "playing" || !you || you.status !== "alive" || you.decided || you.ready)
      continue;
    await a.alephAct(roomId, policy(mine, a.address.toLowerCase()), {
      stage: mine.stage.index,
      phase: mine.stage.phase,
    });
  }
  await sleep(3_000);
  v = await agents[0].client.alephView(roomId);
}
console.log("liquidada · unidades:", JSON.stringify(v.payouts));

// 5) Esperar la transacción de pago y comprobar los balances.
for (let i = 0; i < 60 && !v.settleTx; i++) {
  await sleep(5_000);
  v = await agents[0].client.alephView(roomId);
}
if (!v.settleTx)
  throw new Error("el árbitro no mandó settle en 5 minutos (la firma está publicada: payoutSig)");
console.log("settleTx:", v.settleTx);
const seats = v.seats.map((s) => s.address);
const log = await agents[0].client.alephLog(roomId);
const t = usdcPayoutTable(seats, v.payouts, stake, log.usdc.feeBps);
let ok = true;
for (let i = 0; i < seats.length; i++) {
  const b = await pub.readContract({
    address: d.usdc,
    abi: erc20MinimalAbi,
    functionName: "balanceOf",
    args: [seats[i]],
  });
  const good = b === t.amounts[i];
  ok &&= good;
  console.log(`${good ? "✔" : "✘"} ${seats[i]} cobró ${b} (esperado ${t.amounts[i]})`);
}
console.log(ok ? "\nMESA DE PLATA VERIFICADA EN SEPOLIA ✅" : "\nLOS BALANCES NO CUADRAN ❌");
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Desplegar el contrato (pedir OK)**

Preguntar al dueño y, con OK:

```bash
cd packages/contracts && cast balance $(cast wallet address --private-key "$(grep '^PRIVATE_KEY=' .env | cut -d= -f2)") --rpc-url https://sepolia.base.org
bash deploy-aleph-base-sepolia.sh
```

Si el saldo es 0, el dueño fondea la wallet de deploy en un faucet (la dirección la imprime el script). Anotar la dirección de `EscrowAleph` que imprime.

- [ ] **Step 3: Configurar el árbitro (pedir OK)**

En Render (lo hace el dueño, o quien tenga acceso al panel), agregar `ALEPH_ESCROW_ADDRESS=<la dirección>` y `ALEPH_STAKES=0,2`; verificar que `ARBITER_PRIVATE_KEY` es la misma wallet que se pasó como `ARBITER_ADDRESS` al deploy y que tiene ETH de Sepolia (el árbitro paga `settle` y `cancelRoom`; `gas-monitor.ts` avisa si baja). Redeploy. Comprobar:

```bash
curl -s https://arcade1v1.onrender.com/aleph/lobbies
```

Expected: `{"lobbies":[…],"stakes":[0,2]}`.

- [ ] **Step 4: Smoke (pedir OK; cuesta gas de testnet y 15-30 min)**

```bash
ARBITER_URL=https://arcade1v1.onrender.com RPC_URL=https://sepolia.base.org FUNDER_KEY=0x… node --import tsx scripts/aleph-money-smoke.mjs
```

Expected: `MESA DE PLATA VERIFICADA EN SEPOLIA ✅`. Abrir `https://arcade1v1.com/aleph/<roomId>`: chip FONDEANDO durante el fondeo, luego EN JUEGO, y al final la tabla en USDC con el link a Basescan. Correr `node --import tsx scripts/aleph-verify.mjs https://arcade1v1.onrender.com <roomId>`: todos los checks en ✔, incluido el de USDC.

- [ ] **Step 5: Publicar 0.4.0 (pedir OK)**

```bash
node scripts/publish-sdk.mjs game-sdk
node scripts/publish-sdk.mjs strategies
node scripts/publish-sdk.mjs agent-sdk
cd apps/mcp && npm publish   # y el registry MCP como en la etapa 2
```

- [ ] **Step 6: Cerrar**

Actualizar la fecha en `docs/ROADMAP.md` y en el spec (Task 6 dejó `<fecha>`), y mover el bloque de CHANGELOG de `[Sin publicar]` a `## [3.8.0] — <fecha>` cuando el dueño decida el corte de versión. Commit `docs: cerrar la etapa 4 de Aleph, desplegada y verificada en Sepolia` por PR.

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec:** SDK `alephJoin(stake)` + helper que deposita + `alephView` con el fondeo ✔ (Tasks 1-2); MCP con el depósito documentado en `aleph_rules` ✔ (Tasks 3-4, más la sexta herramienta como desvío); web con la pestaña de la mesa de plata, la fase de fondeo y el link a la transacción ✔ (Task 5); el párrafo de reglas sobre el piso de la caja (decisión 4) ✔ (Task 3 + AGENTS.md); docs y CHANGELOG ✔ (Task 6); despliegue en Sepolia y smoke con 4 wallets ✔ (Task 7); "E2E en cadena local: 4 wallets del SDK fondean, juegan y cobran" ✔ (Task 2 Step 4, en CI).
- **Placeholders:** ninguno de código. Los `<fecha>` y `#N` de docs son valores que solo existen al ejecutar (se completan en la Task 6/7).
- **Consistencia de nombres:** `AlephDeposit` idéntico en SDK y árbitro (`stake` string, deadlines en segundos); `alephLobbiesInfo` devuelve `{ lobbies, stakes }` como la ruta del PR 2; `AlephDepositResult.step` con los tres valores en SDK, MCP y smoke; `mustDeposit` solo en el MCP; `txUrl` solo en la web.
