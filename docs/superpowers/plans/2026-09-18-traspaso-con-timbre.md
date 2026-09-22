# Traspaso con timbre — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un deploy de Render no puede dejar dos árbitros escribiendo o decidiendo a la vez. La instancia nueva carga exactamente lo que la vieja guardó al entregar, y la pausa dura segundos.

**Architecture:**

- **Posta por épocas** en Upstash (`INCR`, atómica y sin Lua), en `lease.ts`.
- **Modos** de la instancia y qué atiende en cada uno, en `readiness.ts`.
- **Registro de relojes**, que se frenan antes del guardado final, en `jobs.ts`.
- **Orquestación del traspaso** en `handover.ts`:
  - la nueva da `/health` 503 hasta tener el estado, y le toca el timbre a la vieja por la URL pública;
  - la vieja frena, guarda y suelta la posta;
  - respaldo sin tope ciego.
- **`persist.ts`**: escribe solo la dueña de la posta, y `flush()` rechaza si no pudo guardar.

**Tech Stack:** TypeScript (ESM), Node 22 en CI, Express 5, `node:test` con tsx y Upstash REST con `fetch` puro. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md` (leerlo antes de arrancar).

## Global Constraints

- Comentarios y mensajes de commit en español; identificadores en inglés. Commits con prefijo (`fix(server): …`, `test(server): …`, `docs: …`) y el trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **No leer ni escribir ningún `.env`.** No correr nada contra `https://arcade1v1.onrender.com` ni contra arcade1v1.com. No publicar nada en npm.
- Sin dependencias npm nuevas.
- Sin escrituras extra del blob entero: las claves de la posta son chicas y los blobs siguen yendo por `POST /set/<clave>` con el valor en el body.
- La posta es de Render + Upstash y solo se enciende con `ARCADE_PERSIST_HANDOVER=1`, que lo pone `persist-on.ts` en el servidor real. **Sin ese flag, persist.ts se comporta como siempre** (una instancia, escribe sin posta): de eso dependen `aleph-money-durability.test.ts` y el resto de los tests.
- Tiempos de producción:
  - latido de la posta: 60 s;
  - posta vencida: 3 latidos;
  - sondeo de la posta: 500 ms;
  - timbre: cada 5 s, y respaldo si no hay 202 en 30 s o si no suelta en 30 s;
  - tope para frenar relojes y pedidos en curso: 10 s;
  - reintentos de guardado: 3;
  - retomar si nadie toma la posta en 90 s;
  - como mucho un toque de timbre cada 2 s;
  - un pedido de traspaso vale 60 s.
- Tests: desde la raíz del repo, `node --import tsx --test apps/server/test/<archivo>.test.ts`. Chequeo completo: `npm run check` (tipos, lint, formato, tests y selftest).
- Un worktree nuevo necesita `npm ci` real, no symlinks a `node_modules`.

## Mapa de archivos

| Archivo                                                                                             | Qué hace                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/redis.ts` (nuevo)                                                                  | Cliente Upstash REST: `redisGet`/`redisSet` para blobs, `redisCommand`/`redisPipeline` para claves chicas.                   |
| `apps/server/test/fake-upstash.ts` (nuevo, helper)                                                  | Upstash falso en memoria (GET, SET, INCR, DEL, EXPIRE; path, JSON y pipeline).                                               |
| `apps/server/src/lease.ts` (nuevo)                                                                  | Posta por épocas: leer, clasificar, tomar, confirmar, latir, soltar, pedido de traspaso, transición desde el #33.            |
| `apps/server/src/readiness.ts`                                                                      | Modos (`starting`, `fallback`, `ready`, `draining`, `released`, `fenced`), la puerta HTTP y el contador de pedidos en curso. |
| `apps/server/src/jobs.ts` (nuevo)                                                                   | Registro de relojes con arranque y freno (esperando la vuelta en curso, con tope).                                           |
| `apps/server/src/handover.ts` (nuevo)                                                               | `takeOver` (la nueva), `handOver` (la vieja), retomar, timbre, cerco y apagado.                                              |
| `apps/server/src/persist.ts`                                                                        | Guarda por posta, `flush()` estricto, `flushAll()`. Sale el código de posta del #33.                                         |
| `apps/server/src/index.ts`                                                                          | Probar Redis antes de escuchar, ruta del timbre, orden de arranque, relojes registrados.                                     |
| `apps/server/src/matchmaking.ts`, `agent-runner.ts`, `aleph.ts`, `aleph-house.ts`, `gas-monitor.ts` | Relojes con `start…`/`stop…`. `aleph.ts` además guarda la tabla firmada antes de CADA publicación hasta que quede guardada.  |

---

### Task 1: Cliente Upstash (`redis.ts`) y Upstash falso para tests

**Files:**

- Create: `apps/server/src/redis.ts`
- Create: `apps/server/test/fake-upstash.ts`
- Create: `apps/server/test/redis.test.ts`
- Modify: `apps/server/src/persist.ts` (sacar su `redisGet`/`redisSet` e importarlos; exportar `handoverEnabled`)

**Interfaces:**

- Produces:
  - `redisGet(key: string): Promise<string | null>`
  - `redisSet(key: string, value: string): Promise<void>`
  - `type RedisArg = string | number`
  - `redisCommand(cmd: RedisArg[]): Promise<unknown>`
  - `redisPipeline(cmds: RedisArg[][]): Promise<unknown[]>`
  - En `persist.ts`: `export const handoverEnabled: boolean`
  - En el helper: `startFakeUpstash(): Promise<FakeUpstash>`, con `FakeUpstash = { url, kv: Map<string,string>, log: string[][], failWith: number | null, close() }`

- [ ] **Step 1: Escribir el Upstash falso**

`apps/server/test/fake-upstash.ts`:

```ts
// Un Upstash falso en memoria para los tests del árbitro. Habla las formas que
// usa redis.ts: GET /get/<clave> y POST /set/<clave> con el valor en el body,
// un comando como arreglo JSON en POST /, y varios en POST /pipeline.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeUpstash {
  url: string;
  kv: Map<string, string>;
  /** Cada comando recibido, en orden: [NOMBRE, clave]. */
  log: string[][];
  /** Con un número, TODO pedido responde ese status de error (Upstash caído). */
  failWith: number | null;
  close(): Promise<void>;
}

export async function startFakeUpstash(): Promise<FakeUpstash> {
  const kv = new Map<string, string>();
  const log: string[][] = [];

  function run(cmd: string[]): unknown {
    const [raw, ...args] = cmd;
    const name = raw.toUpperCase();
    log.push([name, args[0] ?? ""]);
    switch (name) {
      case "GET":
        return kv.get(args[0]) ?? null;
      case "SET":
        kv.set(args[0], args[1]);
        return "OK";
      case "DEL":
        return kv.delete(args[0]) ? 1 : 0;
      case "INCR": {
        const n = Number(kv.get(args[0]) ?? "0") + 1;
        kv.set(args[0], String(n));
        return n;
      }
      case "EXPIRE":
        return kv.has(args[0]) ? 1 : 0;
      default:
        throw new Error(`fake-upstash: comando no soportado ${name}`);
    }
  }

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => void chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = decodeURIComponent(req.url ?? "/");
      res.setHeader("Content-Type", "application/json");
      if (fake.failWith) {
        res.statusCode = fake.failWith;
        res.end(JSON.stringify({ error: "caído" }));
        return;
      }
      try {
        let out: unknown;
        if (url.startsWith("/get/")) out = { result: run(["GET", url.slice(5)]) };
        else if (url.startsWith("/set/")) out = { result: run(["SET", url.slice(5), body]) };
        else if (url === "/pipeline")
          out = (JSON.parse(body) as string[][]).map((c) => ({ result: run(c) }));
        else if (url === "/") out = { result: run(JSON.parse(body) as string[]) };
        else {
          res.statusCode = 404;
          out = { error: "ruta desconocida" };
        }
        res.end(JSON.stringify(out));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  server.unref();

  const fake: FakeUpstash = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    kv,
    log,
    failWith: null,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
  return fake;
}
```

- [ ] **Step 2: Escribir el test que falla**

`apps/server/test/redis.test.ts`:

```ts
// El cliente Upstash de redis.ts contra el Upstash falso.
// Correr: node --import tsx --test apps/server/test/redis.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
// Antes de importar: redis.ts lee estas variables al cargarse.
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
const R = await import("../src/redis.js");

test("GET y SET por ruta: el valor viaja en el body, sin escapar", async () => {
  await R.redisSet("arcade:x", '{"a":"b"}');
  assert.equal(fake.kv.get("arcade:x"), '{"a":"b"}');
  assert.equal(await R.redisGet("arcade:x"), '{"a":"b"}');
  assert.equal(await R.redisGet("arcade:nada"), null);
});

test("un comando chico como arreglo JSON: INCR es atómico y devuelve el número", async () => {
  assert.equal(await R.redisCommand(["INCR", "arcade:n"]), 1);
  assert.equal(await R.redisCommand(["INCR", "arcade:n"]), 2);
  assert.equal(await R.redisCommand(["GET", "arcade:n"]), "2");
});

test("pipeline: varios comandos en un pedido, cada uno con su resultado", async () => {
  const out = await R.redisPipeline([
    ["SET", "arcade:p", "v"],
    ["GET", "arcade:p"],
  ]);
  assert.deepEqual(out, ["OK", "v"]);
});

test("un error de Upstash se propaga: no se traga", async () => {
  fake.failWith = 500;
  try {
    await assert.rejects(R.redisCommand(["GET", "arcade:x"]), /redis GET/);
    await assert.rejects(R.redisSet("arcade:x", "v"), /HTTP 500/);
    await assert.rejects(R.redisGet("arcade:x"), /HTTP 500/);
    await assert.rejects(R.redisPipeline([["GET", "arcade:x"]]), /HTTP 500/);
  } finally {
    fake.failWith = null;
  }
});
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `node --import tsx --test apps/server/test/redis.test.ts`
Expected: FAIL (`Cannot find module '../src/redis.js'`).

- [ ] **Step 4: Escribir `redis.ts`**

`apps/server/src/redis.ts`:

```ts
// Cliente mínimo de Upstash Redis por REST: fetch puro, sin dependencia npm.
// Dos formas de hablarle, cada una para lo suyo:
//
//  - GET /get/<clave> y POST /set/<clave> con el valor en el BODY: para los
//    blobs del estado (cientos de KB). No entran en una URL, y mandarlos dentro
//    de un JSON los escaparía y agregaría bytes, que se pagan en ancho de banda
//    (ver el agrupador de escrituras en persist.ts).
//  - POST / con el comando como arreglo JSON, y POST /pipeline con varios en un
//    solo pedido: para las claves chicas de la posta (INCR, GET, SET). Un
//    pipeline NO es atómico (Upstash lo aclara); lo atómico es cada comando.

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const REDIS_TIMEOUT_MS = 10_000;

const authHeader = () => ({ Authorization: `Bearer ${REDIS_TOKEN}` });

export async function redisGet(key: string): Promise<string | null> {
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: authHeader(),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis GET ${key}: HTTP ${r.status}`);
  const body = (await r.json()) as { result: string | null };
  return body.result;
}

export async function redisSet(key: string, value: string): Promise<void> {
  // El valor va en el BODY (no en la URL): el JSON de partidas con replays
  // puede medir cientos de KB y reventaría el largo máximo de una URL.
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: authHeader(),
    body: value,
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis SET ${key}: HTTP ${r.status}`);
}

export type RedisArg = string | number;

interface Reply {
  result?: unknown;
  error?: string;
}

/** Un comando chico: POST / con el comando como arreglo JSON. */
export async function redisCommand(cmd: RedisArg[]): Promise<unknown> {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  const body = (await r.json().catch(() => ({}))) as Reply;
  if (!r.ok || body.error) {
    throw new Error(`redis ${cmd[0]}: ${body.error ?? `HTTP ${r.status}`}`);
  }
  return body.result ?? null;
}

/** Varios comandos chicos en UN pedido, en orden (no atómico). */
export async function redisPipeline(cmds: RedisArg[][]): Promise<unknown[]> {
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis pipeline: HTTP ${r.status}`);
  const rows = (await r.json()) as Reply[];
  return rows.map((row, i) => {
    if (row.error) throw new Error(`redis ${cmds[i][0]}: ${row.error}`);
    return row.result ?? null;
  });
}
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `node --import tsx --test apps/server/test/redis.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Que `persist.ts` use `redis.ts` y exporte `handoverEnabled`**

En `apps/server/src/persist.ts`:

1. Borrar estas dos líneas (quedan en `redis.ts`):
   ```ts
   const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
   const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
   ```
2. Borrar `const REDIS_TIMEOUT_MS = 10_000;` y las funciones `redisGet` y `redisSet` enteras.
3. Agregar, debajo de `import { dirname, join } from "node:path";`:
   ```ts
   import { redisGet, redisSet } from "./redis.js";
   ```
4. Debajo de `const USE_REDIS = persistenceBackend === "redis";`, agregar:
   ```ts
   /** ¿Hay traspaso entre instancias? Solo con Redis y en el servidor real (lo
    *  enciende persist-on.ts). Sin traspaso (tests, dev con archivo) hay UNA
    *  instancia y siempre escribe. */
   export const handoverEnabled = USE_REDIS && process.env.ARCADE_PERSIST_HANDOVER === "1";
   ```
5. Cambiar `let writable = !(USE_REDIS && process.env.ARCADE_PERSIST_HANDOVER === "1");` por `let writable = !handoverEnabled;`.

- [ ] **Step 7: Verificar que la persistencia sigue igual**

Run: `node --import tsx --test apps/server/test/persist-handover.test.ts apps/server/test/aleph-money-durability.test.ts apps/server/test/redis.test.ts && npm run typecheck:server`
Expected: todo PASS, sin errores de tipos.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/redis.ts apps/server/src/persist.ts apps/server/test/fake-upstash.ts apps/server/test/redis.test.ts
git commit -m "refactor(server): el cliente de Upstash pasa a redis.ts, con comandos chicos y pipeline

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: La posta por épocas (`lease.ts`)

**Files:**

- Create: `apps/server/src/lease.ts`
- Create: `apps/server/test/lease.test.ts`

**Interfaces:**

- Consumes: `redisCommand`, `redisPipeline` (Task 1); `startFakeUpstash` (Task 1).
- Produces:
  - `LEASE_HEARTBEAT_MS`, `LEASE_STALE_MS`, `INSTANCE_ID`
  - tipos `LeaseRecord`, `LegacyLease`, `LeaseView = { epoch: number | null; record: LeaseRecord | null; legacy: LegacyLease | null }`, `LeaseStatus = "none" | "released" | "stale" | "held" | "legacy-held"`, `HandoverRequest = { by: string; forEpoch: number; at: number }`
  - lectura y clasificación: `currentEpoch(): Promise<number | null>`, `readLease(): Promise<LeaseView>`, `classifyLease(v: LeaseView, now?: number): LeaseStatus`
  - la posta propia: `acquireLease(view?: LeaseView): Promise<number>`, `isHolder(): boolean`, `myEpoch(): number | null`, `onLeaseLost(fn: () => void): void`, `confirmHolder(): Promise<boolean>`, `releaseLease(): Promise<void>`
  - latido: `leaseHeartbeat(): Promise<void>`, `startLeaseHeartbeat(): void`, `stopLeaseHeartbeat(): void`
  - pedido de traspaso: `requestHandover(forEpoch: number): Promise<void>`, `readHandoverRequest(): Promise<HandoverRequest | null>`
  - `resetLeaseForTests(): void`

- [ ] **Step 1: Escribir el test que falla**

`apps/server/test/lease.test.ts`:

```ts
// LA POSTA POR ÉPOCAS (lease.ts) contra el Upstash falso. La "otra instancia" se
// simula escribiendo sus claves a mano: INSTANCE_ID es uno por proceso.
// Correr: node --import tsx --test apps/server/test/lease.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
process.env.LEASE_HEARTBEAT_MS = "60000";
const L = await import("../src/lease.js");

const rec = (e: number) => JSON.parse(fake.kv.get(`arcade:lease:e:${e}`) ?? "null");
const NOW = Date.now();

beforeEach(() => {
  fake.kv.clear();
  fake.failWith = null;
  L.resetLeaseForTests();
});

test("sin posta: 'none'", async () => {
  assert.equal(L.classifyLease(await L.readLease(), NOW), "none");
});

test("tomar la posta: INCR da la época y su registro queda activo", async () => {
  assert.equal(await L.acquireLease(), 1);
  assert.equal(L.isHolder(), true);
  assert.equal(L.myEpoch(), 1);
  assert.equal(rec(1).id, L.INSTANCE_ID);
  assert.equal(rec(1).state, "active");
  assert.equal(L.classifyLease(await L.readLease()), "held");
});

test("viva es 'held'; soltada, 'released'; sin latir o sin registro, 'stale'", () => {
  const view = (r: object | null) =>
    ({ epoch: 4, record: r, legacy: null }) as Parameters<typeof L.classifyLease>[0];
  assert.equal(L.classifyLease(view({ id: "x", at: NOW, state: "active" }), NOW), "held");
  assert.equal(L.classifyLease(view({ id: "x", at: NOW, state: "released" }), NOW), "released");
  const vieja = NOW - L.LEASE_STALE_MS - 1;
  assert.equal(L.classifyLease(view({ id: "x", at: vieja, state: "active" }), NOW), "stale");
  assert.equal(L.classifyLease(view(null), NOW), "stale");
});

test("posta del #33: viva, 'legacy-held'; soltada, 'released'; vencida, 'stale'", () => {
  const view = (l: object) =>
    ({ epoch: null, record: null, legacy: l }) as Parameters<typeof L.classifyLease>[0];
  assert.equal(L.classifyLease(view({ id: "v", at: NOW, released: false }), NOW), "legacy-held");
  assert.equal(L.classifyLease(view({ id: "v", at: NOW, released: true }), NOW), "released");
  const vieja = NOW - L.LEASE_STALE_MS - 1;
  assert.equal(L.classifyLease(view({ id: "v", at: vieja, released: false }), NOW), "stale");
});

test("al tomarla desde la del #33, la marca como nuestra: la vieja deja de escribir", async () => {
  fake.kv.set("arcade:lease", JSON.stringify({ id: "vieja-33", at: NOW, released: true }));
  const v = await L.readLease();
  assert.equal(v.epoch, null);
  assert.equal(v.legacy?.id, "vieja-33");
  await L.acquireLease(v);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease")!).id, L.INSTANCE_ID);
});

test("si otra instancia sacó una época más alta, confirmar da false y avisa", async () => {
  await L.acquireLease();
  let lost = 0;
  L.onLeaseLost(() => lost++);
  fake.kv.set("arcade:lease:epoch", "2");
  assert.equal(await L.confirmHolder(), false);
  assert.equal(L.isHolder(), false);
  assert.equal(lost, 1);
});

test("un error de red al confirmar TIRA: no es lo mismo que haberla perdido", async () => {
  await L.acquireLease();
  fake.failWith = 500;
  await assert.rejects(L.confirmHolder());
  fake.failWith = null;
  assert.equal(L.isHolder(), true);
});

test("el latido renueva el registro; si la época cambió, se da por perdida", async () => {
  await L.acquireLease();
  fake.kv.set("arcade:lease:e:1", JSON.stringify({ id: L.INSTANCE_ID, at: 1, state: "active" }));
  await L.leaseHeartbeat();
  assert.ok(rec(1).at > 1, "latió");
  let lost = 0;
  L.onLeaseLost(() => lost++);
  fake.kv.set("arcade:lease:epoch", "7");
  await L.leaseHeartbeat();
  assert.equal(lost, 1);
  assert.equal(L.isHolder(), false);
});

test("soltar: el registro dice 'released' y deja de ser dueña", async () => {
  await L.acquireLease();
  await L.releaseLease();
  assert.equal(rec(1).state, "released");
  assert.equal(L.isHolder(), false);
  assert.equal(L.classifyLease(await L.readLease()), "released");
});

test("si Upstash falla al soltar, sigue siendo dueña: no suelta a medias", async () => {
  await L.acquireLease();
  fake.failWith = 500;
  await assert.rejects(L.releaseLease());
  fake.failWith = null;
  assert.equal(L.isHolder(), true);
  assert.equal(rec(1).state, "active");
});

test("pedido de traspaso: la nueva lo escribe y la vieja lo lee", async () => {
  await L.requestHandover(3);
  const r = await L.readHandoverRequest();
  assert.equal(r?.forEpoch, 3);
  assert.equal(r?.by, L.INSTANCE_ID);
  assert.ok(r && Date.now() - r.at < 5_000);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --import tsx --test apps/server/test/lease.test.ts`
Expected: FAIL (`Cannot find module '../src/lease.js'`).

- [ ] **Step 3: Escribir `lease.ts`**

`apps/server/src/lease.ts`:

```ts
// LA POSTA ENTRE INSTANCIAS. En todo momento hay UNA sola instancia dueña del
// estado del árbitro: la única que atiende, corre relojes y escribe en Redis.
// Un deploy de Render la pasa de la vieja a la nueva (ver handover.ts y el spec
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md).
//
// POR ÉPOCAS, SIN LUA. Tomar la posta es `INCR arcade:lease:epoch`, que es
// atómico: la dueña es la instancia que sacó el valor ACTUAL, y si dos la
// toman a la vez cada una recibe un número distinto y gana el más alto. Cada
// época tiene su propio registro (`arcade:lease:e:<E>`) que solo escribe su
// dueña, así que nadie puede pisar la marca de otra. La posta del PR #33 era
// UNA clave que se leía y después se escribía: una vieja podía reescribirla
// encima de la nueva, y la nueva dejaba de guardar para siempre sin avisar.

import { randomUUID } from "node:crypto";
import { redisCommand, redisPipeline } from "./redis.js";

export const LEASE_HEARTBEAT_MS = Number(process.env.LEASE_HEARTBEAT_MS ?? 60_000);
/** Sin latir este tiempo, la dueña se da por muerta (tres latidos). */
export const LEASE_STALE_MS = Number(process.env.LEASE_STALE_MS ?? 3 * LEASE_HEARTBEAT_MS);

const EPOCH_KEY = "arcade:lease:epoch";
const recordKey = (e: number) => `arcade:lease:e:${e}`;
const HANDOVER_KEY = "arcade:lease:handover";
/** La posta de una sola clave del PR #33: solo importa en la transición. */
const LEGACY_KEY = "arcade:lease";

/** Identidad de este proceso: cada deploy o reinicio es una instancia nueva. */
export const INSTANCE_ID = randomUUID();

export interface LeaseRecord {
  id: string;
  /** RENDER_INSTANCE_ID, para cruzar con los logs de Render. */
  instance?: string;
  /** Último latido. */
  at: number;
  state: "active" | "released";
}

export interface LegacyLease {
  id: string;
  at: number;
  released: boolean;
}

/** Lo que ve una instancia al mirar la posta. */
export interface LeaseView {
  /** La época actual (null: nunca se tomó con este formato). */
  epoch: number | null;
  /** El registro de esa época (null: su dueña no llegó a escribirlo). */
  record: LeaseRecord | null;
  /** La posta del #33, si todavía no hay épocas. */
  legacy: LegacyLease | null;
}

export type LeaseStatus = "none" | "released" | "stale" | "held" | "legacy-held";

export interface HandoverRequest {
  by: string;
  forEpoch: number;
  at: number;
}

let epoch: number | null = null;
let holding = false;
const lostHandlers: (() => void)[] = [];
let hbTimer: NodeJS.Timeout | undefined;
let hbInFlight: Promise<void> | null = null;

function parse<T>(raw: unknown, ok: (v: Partial<T>) => boolean): T | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as Partial<T>;
    return v && typeof v === "object" && ok(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

const parseRecord = (raw: unknown) =>
  parse<LeaseRecord>(
    raw,
    (v) =>
      typeof v.id === "string" &&
      typeof v.at === "number" &&
      (v.state === "active" || v.state === "released"),
  );

const parseLegacy = (raw: unknown) =>
  parse<LegacyLease>(raw, (v) => typeof v.id === "string" && typeof v.at === "number");

/** La época actual en Redis (null si nunca se tomó). */
export async function currentEpoch(): Promise<number | null> {
  const raw = await redisCommand(["GET", EPOCH_KEY]);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function readLease(): Promise<LeaseView> {
  const e = await currentEpoch();
  if (e === null) {
    const legacy = parseLegacy(await redisCommand(["GET", LEGACY_KEY]));
    return { epoch: null, record: null, legacy };
  }
  const record = parseRecord(await redisCommand(["GET", recordKey(e)]));
  return { epoch: e, record, legacy: null };
}

/** Qué significa lo que se ve. */
export function classifyLease(v: LeaseView, now = Date.now()): LeaseStatus {
  if (v.epoch === null) {
    const l = v.legacy;
    if (!l) return "none";
    if (l.released) return "released";
    return now - l.at > LEASE_STALE_MS ? "stale" : "legacy-held";
  }
  const r = v.record;
  // Una época sin registro: su dueña sacó el número y se cayó antes de
  // escribirlo. Nadie la sostiene.
  if (!r) return "stale";
  if (r.state === "released") return "released";
  return now - r.at > LEASE_STALE_MS ? "stale" : "held";
}

function recordNow(state: LeaseRecord["state"]): string {
  const rec: LeaseRecord = {
    id: INSTANCE_ID,
    instance: process.env.RENDER_INSTANCE_ID,
    at: Date.now(),
    state,
  };
  return JSON.stringify(rec);
}

/** Tomar la posta: una época nueva. Si había una posta del #33, la marca como
 *  nuestra: una instancia con ese código deja de escribir en su próximo latido. */
export async function acquireLease(view?: LeaseView): Promise<number> {
  epoch = Number(await redisCommand(["INCR", EPOCH_KEY]));
  holding = true;
  await redisCommand(["SET", recordKey(epoch), recordNow("active")]);
  if (view?.legacy) {
    const mine: LegacyLease = { id: INSTANCE_ID, at: Date.now(), released: false };
    await redisCommand(["SET", LEGACY_KEY, JSON.stringify(mine)]);
  }
  return epoch;
}

export const isHolder = (): boolean => holding;
export const myEpoch = (): number | null => epoch;

/** Se llama cuando esta instancia descubre que perdió la posta sin soltarla. */
export function onLeaseLost(fn: () => void): void {
  lostHandlers.push(fn);
}

function markLost(why: string): void {
  if (!holding) return;
  holding = false;
  stopLeaseHeartbeat();
  console.error(`⚠️ Posta perdida (${why}): esta instancia deja de escribir y se cerca`);
  for (const fn of lostHandlers) fn();
}

/** ¿La época actual sigue siendo la mía? Si no, se da por perdida. Un error de
 *  red TIRA: no es lo mismo que "ya no soy la dueña". */
export async function confirmHolder(): Promise<boolean> {
  if (!holding || epoch === null) return false;
  const cur = await currentEpoch();
  if (cur === epoch) return true;
  markLost(`la época actual es ${cur}, la mía era ${epoch}`);
  return false;
}

/** Un latido: chequea la época y renueva el registro, en un solo pedido. */
export async function leaseHeartbeat(): Promise<void> {
  if (!holding || epoch === null) return;
  const mine = epoch;
  const [cur] = await redisPipeline([
    ["GET", EPOCH_KEY],
    ["SET", recordKey(mine), recordNow("active")],
  ]);
  if (Number(cur) !== mine) markLost(`la época actual es ${String(cur)}, la mía era ${mine}`);
}

export function startLeaseHeartbeat(): void {
  if (hbTimer) return;
  hbTimer = setInterval(() => {
    if (hbInFlight) return;
    hbInFlight = leaseHeartbeat()
      .catch((e) => console.error("posta, latido:", (e as Error).message))
      .finally(() => {
        hbInFlight = null;
      });
  }, LEASE_HEARTBEAT_MS);
  hbTimer.unref?.();
}

export function stopLeaseHeartbeat(): void {
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = undefined;
}

/** Soltar la posta: la instancia nueva ya puede cargar lo guardado. Antes frena
 *  el latido y espera el que estuviera en vuelo, para que un "active" tardío no
 *  pise el "released". Si Upstash falla, TIRA y esta instancia sigue dueña. */
export async function releaseLease(): Promise<void> {
  if (!holding || epoch === null) return;
  stopLeaseHeartbeat();
  if (hbInFlight) await hbInFlight;
  await redisCommand(["SET", recordKey(epoch), recordNow("released")]);
  holding = false;
}

/** La instancia nueva pide la posta de la época `forEpoch`. */
export async function requestHandover(forEpoch: number): Promise<void> {
  const req: HandoverRequest = { by: INSTANCE_ID, forEpoch, at: Date.now() };
  await redisCommand(["SET", HANDOVER_KEY, JSON.stringify(req)]);
}

export async function readHandoverRequest(): Promise<HandoverRequest | null> {
  return parse<HandoverRequest>(
    await redisCommand(["GET", HANDOVER_KEY]),
    (v) => typeof v.by === "string" && typeof v.forEpoch === "number" && typeof v.at === "number",
  );
}

/** Tests: volver al estado de recién arrancada. */
export function resetLeaseForTests(): void {
  stopLeaseHeartbeat();
  epoch = null;
  holding = false;
  hbInFlight = null;
  lostHandlers.length = 0;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --import tsx --test apps/server/test/lease.test.ts && npm run typecheck:server`
Expected: PASS (11 tests), sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lease.ts apps/server/test/lease.test.ts
git commit -m "feat(server): la posta por épocas (INCR atómico), con latido, cerco y transición desde el #33

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Los modos de la instancia (`readiness.ts`)

**Files:**

- Modify: `apps/server/src/readiness.ts` (reescribir)
- Modify: `apps/server/test/readiness.test.ts` (reescribir)
- Modify: `apps/server/src/index.ts` (`markReady()` pasa a `setMode("ready")`)

**Interfaces:**

- Produces:
  - `type Mode = "starting" | "fallback" | "ready" | "draining" | "released" | "fenced"`
  - `HANDOVER_PATH = "/internal/handover"`
  - `getMode(): Mode`, `setMode(m: Mode): void`
  - `readinessGate(): RequestHandler`
  - `waitForIdle(capMs: number, pollMs?: number): Promise<boolean>`
  - `markReady` desaparece.

- [ ] **Step 1: Escribir el test que falla**

Reemplazar todo `apps/server/test/readiness.test.ts` por:

```ts
// LOS MODOS DE UNA INSTANCIA y qué atiende en cada uno: la tabla 3.3 del spec
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md, fila por fila.
// Correr: node --import tsx --test apps/server/test/readiness.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { readinessGate, setMode, waitForIdle, HANDOVER_PATH, type Mode } from "../src/readiness.js";

const hold: { release?: () => void } = {};
const app = express();
app.use(readinessGate());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.json({ name: "api" }));
app.post(HANDOVER_PATH, (_req, res) => res.status(202).json({ accepted: true }));
app.get("/aleph/lobbies", (_req, res) => res.json({ lobbies: [] }));
app.post("/matchmake", (_req, res) => res.json({ matched: true }));
app.get("/lento", (_req, res) => {
  hold.release = () => res.json({ ok: true });
});
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const status = async (path: string, method = "GET") =>
  (await fetch(`${BASE}${path}`, { method })).status;

// [modo, /health, todo lo demás]
const TABLA: [Mode, number, number][] = [
  ["starting", 503, 503],
  ["fallback", 200, 503],
  ["ready", 200, 200],
  ["draining", 200, 503],
  ["released", 200, 503],
  ["fenced", 503, 503],
];

for (const [mode, health, rest] of TABLA) {
  test(`modo ${mode}: /health ${health}, lo demás ${rest}; el índice y el timbre, siempre`, async () => {
    setMode(mode);
    assert.equal(await status("/health"), health);
    assert.equal(await status("/matchmake", "POST"), rest);
    assert.equal(await status("/aleph/lobbies"), rest, "leer también cambia el estado");
    assert.equal(await status("/"), 200);
    assert.equal(await status(HANDOVER_PATH, "POST"), 202);
  });
}

test("el 503 lleva Retry-After, para que el cliente reintente", async () => {
  setMode("starting");
  const r = await fetch(`${BASE}/matchmake`, { method: "POST" });
  assert.equal(r.headers.get("retry-after"), "5");
  assert.match(((await r.json()) as { error: string }).error, /restarting/);
});

test("waitForIdle espera los pedidos en curso y se rinde al tope", async () => {
  setMode("ready");
  const pending = fetch(`${BASE}/lento`);
  while (!hold.release) await new Promise((r) => setTimeout(r, 5));
  assert.equal(await waitForIdle(50), false, "con uno en curso, vence el tope");
  hold.release();
  await pending;
  assert.equal(await waitForIdle(1_000), true);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --import tsx --test apps/server/test/readiness.test.ts`
Expected: FAIL (`setMode`, `waitForIdle` y `HANDOVER_PATH` no existen).

- [ ] **Step 3: Reescribir `readiness.ts`**

Reemplazar todo `apps/server/src/readiness.ts` por:

```ts
// EN QUÉ ESTÁ ESTA INSTANCIA y qué atiende en cada caso (tabla 3.3 del spec
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md):
//
//  - starting: esperando la posta. /health da 503 A PROPÓSITO: así Render le
//    sigue mandando el tráfico a la vieja, y el timbre (que va por la URL
//    pública) le llega a ella.
//  - fallback: esperando que Render apague a la vieja. /health da 200 para que
//    Render pase el tráfico y le mande el SIGTERM; lo demás, 503.
//  - ready: atiende todo.
//  - draining / released: entregando la posta, o ya entregada. /health sigue en
//    200 (si no, Render la saca antes de tiempo); lo demás, 503. Leer también
//    cambia el estado (GET /aleph/* corre settleDue), así que no se atiende nada.
//  - fenced: perdió la posta sin entregarla. /health da 503 para que Render la
//    reinicie.
//
// El índice (GET /) no toca estado y se atiende siempre. El timbre del traspaso
// también: su handler decide (ver handover.ts).

import type { RequestHandler } from "express";

export type Mode = "starting" | "fallback" | "ready" | "draining" | "released" | "fenced";

export const HANDOVER_PATH = "/internal/handover";

const HEALTHY: ReadonlySet<Mode> = new Set<Mode>(["fallback", "ready", "draining", "released"]);

let mode: Mode = "starting";
let inflight = 0;

export const getMode = (): Mode => mode;

export function setMode(m: Mode): void {
  mode = m;
}

export function readinessGate(): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/health") {
      if (HEALTHY.has(mode)) return next();
      res.setHeader("Retry-After", "5");
      res.status(503).json({ ok: false, mode });
      return;
    }
    if ((req.method === "GET" && req.path === "/") || req.path === HANDOVER_PATH) return next();
    if (mode !== "ready") {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "arbiter restarting, retry in a few seconds" });
      return;
    }
    // Pedido en curso: la entrega de la posta espera a que termine antes del
    // guardado final (ver waitForIdle).
    inflight++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      inflight--;
    };
    res.on("finish", end);
    res.on("close", end);
    next();
  };
}

/** Espera a que terminen los pedidos en curso, con tope. true si terminaron. */
export async function waitForIdle(capMs: number, pollMs = 25): Promise<boolean> {
  const until = Date.now() + capMs;
  while (inflight > 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return inflight === 0;
}
```

- [ ] **Step 4: Ajustar `index.ts`**

En `apps/server/src/index.ts`:

- `import { readinessGate, markReady } from "./readiness.js";` pasa a `import { readinessGate, setMode } from "./readiness.js";`
- `markReady();` pasa a `setMode("ready");`

- [ ] **Step 5: Correr los tests y el typecheck**

Run: `node --import tsx --test apps/server/test/readiness.test.ts && npm run typecheck:server`
Expected: PASS (8 tests), sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/readiness.ts apps/server/test/readiness.test.ts apps/server/src/index.ts
git commit -m "feat(server): los modos de la instancia; /health da 503 hasta tener el estado

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Relojes que se pueden frenar (`jobs.ts` y los módulos)

**Files:**

- Create: `apps/server/src/jobs.ts`
- Create: `apps/server/test/jobs.test.ts`
- Modify:
  - `apps/server/src/matchmaking.ts`: el barrido pasa de arrancar al importar a `startSweeper`/`stopSweeper`.
  - `apps/server/src/agent-runner.ts`: pasa de arrancar al importar a `startAgentRunner`/`stopAgentRunner`.
  - `apps/server/src/aleph.ts`: `stopAlephTicker`, que espera la vuelta on-chain.
  - `apps/server/src/aleph-house.ts`: `stopAlephHouse` pasa a ser async y espera la vuelta.
  - `apps/server/src/gas-monitor.ts`: `stopGasMonitor`.
  - `apps/server/src/index.ts`: registrar los relojes y arrancarlos con `startJobs()`.

**Interfaces:**

- Produces:
  - `interface Job { name: string; start(): void; stop(): Promise<void> }`
  - `registerJob(job: Job): void`, `startJobs(): void`, `stopJobs(capMs: number): Promise<string[]>` (devuelve los que no terminaron a tiempo), `resetJobsForTests(): void`
  - en los módulos: `startSweeper()`/`stopSweeper()`, `startAgentRunner()`/`stopAgentRunner()`, `stopAlephTicker()`, `stopAlephHouse()`, `stopGasMonitor()`, todos los `stop…` con tipo `Promise<void>`.

- [ ] **Step 1: Escribir el test que falla**

`apps/server/test/jobs.test.ts`:

```ts
// LOS RELOJES (jobs.ts): arrancan juntos y, al entregar la posta, se frenan
// esperando la vuelta en curso de cada uno, con tope.
// Correr: node --import tsx --test apps/server/test/jobs.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerJob, startJobs, stopJobs, resetJobsForTests } from "../src/jobs.js";

beforeEach(() => resetJobsForTests());

test("arranca todos y, al frenar, espera la vuelta en curso de cada uno", async () => {
  const log: string[] = [];
  let finish!: () => void;
  registerJob({
    name: "a",
    start: () => void log.push("start a"),
    stop: async () => void log.push("stop a"),
  });
  registerJob({
    name: "b",
    start: () => void log.push("start b"),
    stop: () =>
      new Promise<void>((ok) => {
        finish = () => {
          log.push("stop b");
          ok();
        };
      }),
  });
  startJobs();
  assert.deepEqual(log, ["start a", "start b"]);
  const stopping = stopJobs(1_000);
  setTimeout(() => finish(), 20);
  assert.deepEqual(await stopping, []);
  assert.deepEqual(log, ["start a", "start b", "stop a", "stop b"]);
});

test("un reloj que no termina a tiempo no traba la entrega: se informa", async () => {
  registerJob({ name: "colgado", start: () => {}, stop: () => new Promise<void>(() => {}) });
  registerJob({ name: "bien", start: () => {}, stop: async () => {} });
  assert.deepEqual(await stopJobs(30), ["colgado"]);
});

test("un reloj que falla al frenar no traba a los demás", async () => {
  registerJob({
    name: "falla",
    start: () => {},
    stop: async () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(await stopJobs(100), []);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --import tsx --test apps/server/test/jobs.test.ts`
Expected: FAIL (`Cannot find module '../src/jobs.js'`).

- [ ] **Step 3: Escribir `jobs.ts`**

`apps/server/src/jobs.ts`:

```ts
// LOS RELOJES DEL ÁRBITRO: el barrido de partidas, el runner de agentes, el
// ticker y la casa de Aleph, y el monitor de gas. Solo corren en la instancia
// dueña de la posta: index.ts los arranca DESPUÉS de cargar el estado, y la
// entrega de la posta los frena ANTES del guardado final, así la foto que carga
// la instancia nueva es la última (ver handover.ts).

export interface Job {
  name: string;
  start(): void;
  /** Frena el reloj y espera la vuelta que estaba en curso. */
  stop(): Promise<void>;
}

const jobs: Job[] = [];

export function registerJob(job: Job): void {
  jobs.push(job);
}

export function startJobs(): void {
  for (const j of jobs) j.start();
}

/** Frena todos. Si alguno tarda más que `capMs`, se sigue igual: lo que se
 *  publica on-chain ya se guarda antes (ver persistNow en aleph.ts). Devuelve
 *  los nombres de los que no terminaron a tiempo. */
export async function stopJobs(capMs: number): Promise<string[]> {
  const late: string[] = [];
  await Promise.all(
    jobs.map(async (j) => {
      let timer: NodeJS.Timeout | undefined;
      const capped = new Promise<false>((ok) => {
        timer = setTimeout(() => ok(false), capMs);
      });
      const done = j.stop().then(
        () => true as const,
        (e) => {
          console.error(`[relojes] ${j.name}:`, (e as Error).message);
          return true as const;
        },
      );
      const ok = await Promise.race([done, capped]);
      clearTimeout(timer);
      if (!ok) late.push(j.name);
    }),
  );
  return late;
}

/** Tests: vaciar el registro. */
export function resetJobsForTests(): void {
  jobs.length = 0;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --import tsx --test apps/server/test/jobs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Relojes con `start`/`stop` en cada módulo**

**`apps/server/src/matchmaking.ts`**: reemplazar

```ts
const sweeper = setInterval(sweepMatches, SWEEP_EVERY_MS);
sweeper.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
```

por:

```ts
let sweeper: NodeJS.Timeout | undefined;

/** El barrido periódico. Lo arranca index.ts DESPUÉS de cargar el estado (antes
 *  arrancaba al importar el módulo) y lo frena la entrega de la posta. Los tests
 *  llaman a sweepMatches con su propio reloj. */
export function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => sweepMatches(), SWEEP_EVERY_MS);
  sweeper.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
}

export async function stopSweeper(): Promise<void> {
  if (sweeper) clearInterval(sweeper);
  sweeper = undefined;
}
```

**`apps/server/src/agent-runner.ts`**: reemplazar el bloque final

```ts
if (ENABLED) {
  const timer = setInterval(() => {
    runAgentsTick().catch((e) => console.error("agent runner:", (e as Error).message));
  }, TICK_MS);
  timer.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
}
```

por:

```ts
let runner: NodeJS.Timeout | undefined;
const ticksInFlight = new Set<Promise<void>>();

/** Arranca el runner. Lo llama index.ts DESPUÉS de cargar el estado; antes
 *  arrancaba al importar el módulo y podía correr sobre un estado vacío. */
export function startAgentRunner(): void {
  if (runner || !ENABLED) return;
  runner = setInterval(() => {
    const tick = runAgentsTick().catch((e) => console.error("agent runner:", (e as Error).message));
    ticksInFlight.add(tick);
    void tick.finally(() => ticksInFlight.delete(tick));
  }, TICK_MS);
  runner.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
}

/** Frena el runner y espera las vueltas en curso (entrega de la posta). */
export async function stopAgentRunner(): Promise<void> {
  if (runner) clearInterval(runner);
  runner = undefined;
  await Promise.all([...ticksInFlight]);
}
```

**`apps/server/src/aleph.ts`**: reemplazar `let ticker…` y `startAlephTicker` (sección `// ---- Ticker`) por:

```ts
let ticker: NodeJS.Timeout | undefined;
const chainTicksInFlight = new Set<Promise<void>>();

/** Respaldo: vence lobbies y fases aunque nadie consulte la sala. Lo arranca
 *  index.ts (nunca al importar: los tests usan su propio reloj). Arranca SIEMPRE:
 *  el kill switch gobierna las entradas nuevas, no el reloj — sin ticker, una
 *  sala en curso que nadie consulta no se liquidaría nunca. */
export function startAlephTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    try {
      settleDue();
    } catch (e) {
      console.error("[aleph] tick:", (e as Error).message);
    }
    const tick = alephChainTick().catch((e) =>
      console.error("[aleph-chain] tick:", (e as Error).message),
    );
    chainTicksInFlight.add(tick);
    void tick.finally(() => chainTicksInFlight.delete(tick));
  }, ALEPH_TICK_MS);
  ticker.unref?.();
}

/** Frena el ticker y espera la vuelta on-chain en curso (entrega de la posta). */
export async function stopAlephTicker(): Promise<void> {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
  await Promise.all([...chainTicksInFlight]);
}
```

**`apps/server/src/aleph-house.ts`**:

- Debajo de `let ticker: NodeJS.Timeout | undefined;`, agregar:
  ```ts
  const ticksInFlight = new Set<Promise<void>>();
  ```
- Reemplazar `startAlephHouse` y `stopAlephHouse` por:

```ts
export function startAlephHouse(): void {
  if (ticker || !alephHouseEnabled()) return;
  ticker = setInterval(() => {
    const tick = alephHouseTick().catch((e) =>
      console.error("[aleph-house] tick:", (e as Error).message),
    );
    ticksInFlight.add(tick);
    void tick.finally(() => ticksInFlight.delete(tick));
  }, TICK_MS);
  ticker.unref?.();
}

/** Frena el barrido y espera la vuelta en curso (entrega de la posta; tests). */
export async function stopAlephHouse(): Promise<void> {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
  await Promise.all([...ticksInFlight]);
}
```

**`apps/server/src/gas-monitor.ts`**: reemplazar `startGasMonitor` por la versión de abajo y agregar `stopGasMonitor` a continuación:

```ts
/** Arranca un chequeo inmediato y luego periódico. No bloquea el arranque HTTP. */
export function startGasMonitor() {
  if (timer) return gasSnapshot();
  const config = gasMonitorConfig();
  if (!config) return gasSnapshot();

  if (!monitor) {
    const client = createPublicClient({ transport: http(config.rpcUrl) });
    monitor = new GasMonitor(config, client, reporter(config.webhookUrl));
  }
  void monitor.check();
  timer = setInterval(() => void monitor?.check(), config.intervalMs);
  timer.unref?.();
  return monitor.snapshot();
}

/** Frena el chequeo periódico (entrega de la posta). La última foto queda. */
export async function stopGasMonitor(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = undefined;
}
```

- [ ] **Step 6: Registrar los relojes en `index.ts`**

En `apps/server/src/index.ts`:

- Imports:
  - `import { restoreAleph, startAlephTicker } from "./aleph.js";` pasa a `import { restoreAleph, startAlephTicker, stopAlephTicker } from "./aleph.js";`
  - `import { startAlephHouse } from "./aleph-house.js";` pasa a `import { startAlephHouse, stopAlephHouse } from "./aleph-house.js";`
  - `import { gasSnapshot, startGasMonitor } from "./gas-monitor.js";` pasa a `import { gasSnapshot, startGasMonitor, stopGasMonitor } from "./gas-monitor.js";`
  - `import "./agent-runner.js"; // runner de agentes hosteados (juegan solos)` pasa a `import { startAgentRunner, stopAgentRunner } from "./agent-runner.js";`
  - Al import de `./matchmaking.js`, agregarle `startSweeper,` y `stopSweeper,`.
  - Agregar `import { registerJob, startJobs } from "./jobs.js";`
- Justo antes del comentario `// ESCUCHAR PRIMERO, ATENDER DESPUÉS`, agregar:

```ts
// LOS RELOJES (ver jobs.ts): arrancan después de cargar el estado, y la entrega
// de la posta los frena antes del guardado final.
//  - gas: no bloquea el API; en producción con escrow está activo por defecto.
//  - aleph-ticker: vence lobbies y fases aunque nadie consulte la sala.
//  - aleph-house: completa el lobby que está por vencerse y juega esos asientos.
//  - sweeper: vence partidas y pide sus reembolsos on-chain.
//  - agents: los agentes hosteados juegan solos.
registerJob({ name: "gas", start: () => void startGasMonitor(), stop: stopGasMonitor });
registerJob({ name: "aleph-ticker", start: startAlephTicker, stop: stopAlephTicker });
registerJob({ name: "aleph-house", start: startAlephHouse, stop: stopAlephHouse });
registerJob({ name: "sweeper", start: startSweeper, stop: stopSweeper });
registerJob({ name: "agents", start: startAgentRunner, stop: stopAgentRunner });
```

- Reemplazar el final del archivo, desde `// No bloquea el API: el chequeo inicial y los siguientes corren en segundo plano.` hasta `console.log("Árbitro listo: estado cargado");`, por:

```ts
// La posta late mientras esta instancia la tenga; desde acá se atiende todo y
// corren los relojes.
startLeaseHeartbeat();
setMode("ready");
startJobs();
console.log("Árbitro listo: estado cargado");
```

- [ ] **Step 7: Verificar que nada se rompió**

Run: `npm run typecheck:server && node --import tsx --test apps/server/test/jobs.test.ts apps/server/test/agents.test.ts apps/server/test/challenge.test.ts apps/server/test/aleph-house.test.ts apps/server/test/gas-monitor.test.ts apps/server/test/live-flappy.test.ts && npm run selftest`
Expected: todo PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/jobs.ts apps/server/test/jobs.test.ts apps/server/src/matchmaking.ts apps/server/src/agent-runner.ts apps/server/src/aleph.ts apps/server/src/aleph-house.ts apps/server/src/gas-monitor.ts apps/server/src/index.ts
git commit -m "feat(server): los relojes del árbitro se registran, arrancan después de cargar y se pueden frenar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: La orquestación del traspaso (`handover.ts`)

**Files:**

- Create: `apps/server/src/handover.ts`
- Create: `apps/server/test/handover.test.ts`

**Interfaces:**

- Consumes:
  - `handoverEnabled` de `persist.ts` (Task 1);
  - de `lease.ts` (Task 2): `INSTANCE_ID`, `acquireLease`, `classifyLease`, `currentEpoch`, `isHolder`, `myEpoch`, `onLeaseLost`, `readHandoverRequest`, `readLease`, `releaseLease`, `requestHandover`, `startLeaseHeartbeat` y los tipos `LeaseStatus`, `LeaseView`;
  - de `readiness.ts` (Task 3): `HANDOVER_PATH`, `getMode`, `setMode`.
- Produces:
  - `interface HandoverDeps { now; sleep; doorbellConfigured; ringDoorbell; flushAll; startJobs; stopJobs; waitForIdle; log }` (tipos exactos en el código).
  - `interface HandoverTiming` y `HANDOVER_TIMING`.
  - La nueva: `type TakeoverOutcome = "off" | "none" | "released" | "stale" | "doorbell" | "fallback"` y `takeOver(d, t?): Promise<TakeoverOutcome>`.
  - La vieja: `type HandoverResult = "released" | "aborted" | "not-holder"` y `handOver(reason: "doorbell" | "sigterm", d, t?): Promise<HandoverResult>`.
  - Timbre: `answerDoorbell(d, t?): Promise<{ status: number; body: Record<string, unknown> }>` y `doorbellAt(baseUrl: string | undefined): () => Promise<boolean>`.
  - Cerco y apagado: `installFence(d): void`, `shutdown(sig: string, d): Promise<void>`, `installShutdown(d, exit?): void`.

- [ ] **Step 1: Escribir el test que falla**

`apps/server/test/handover.test.ts`:

```ts
// EL TRASPASO (handover.ts), con la posta real contra el Upstash falso y un
// reloj virtual: `sleep` adelanta el reloj en vez de esperar. La "otra
// instancia" se simula escribiendo sus claves de Redis a mano.
// Correr: node --import tsx --test apps/server/test/handover.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.ARCADE_PERSIST = "1";
process.env.ARCADE_PERSIST_HANDOVER = "1";
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
// Posta vencida a los 30 min: el reloj virtual nunca llega ahí sin querer.
process.env.LEASE_HEARTBEAT_MS = "600000";
const H = await import("../src/handover.js");
const L = await import("../src/lease.js");
const R = await import("../src/readiness.js");

const T: import("../src/handover.js").HandoverTiming = {
  ...H.HANDOVER_TIMING,
  pollMs: 50,
  doorbellEveryMs: 100,
  acceptWaitMs: 1_000,
  releaseWaitMs: 1_000,
  fallbackPollMs: 50,
  drainCapMs: 100,
  resumeAfterMs: 500,
  resumePollMs: 50,
  doorbellMinGapMs: 0,
};

type Deps = import("../src/handover.js").HandoverDeps & { logs: string[]; calls: string[] };

function deps(over: Partial<Deps> = {}): Deps {
  const logs: string[] = [];
  const calls: string[] = [];
  let clock = Date.now();
  return {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      await new Promise((r) => setImmediate(r));
    },
    doorbellConfigured: true,
    ringDoorbell: async () => false,
    flushAll: async () => void calls.push("flush"),
    startJobs: () => void calls.push("startJobs"),
    stopJobs: async () => {
      calls.push("stopJobs");
      return [];
    },
    waitForIdle: async () => {
      calls.push("idle");
      return true;
    },
    log: (m) => void logs.push(m),
    logs,
    calls,
    ...over,
  };
}

const record = (id: string, state: "active" | "released", at = Date.now()) =>
  JSON.stringify({ id, at, state });
/** Una instancia vieja viva, dueña de la época `e`. */
function oldHolder(e: number) {
  fake.kv.set("arcade:lease:epoch", String(e));
  fake.kv.set(`arcade:lease:e:${e}`, record("vieja", "active"));
}
async function until(cond: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("se venció la espera");
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  fake.kv.clear();
  fake.failWith = null;
  L.resetLeaseForTests();
  R.setMode("starting");
});

// ---- La nueva: takeOver -------------------------------------------------------

test("sin posta la toma enseguida: 'none'", async () => {
  assert.equal(await H.takeOver(deps(), T), "none");
  assert.equal(L.isHolder(), true);
  assert.equal(L.myEpoch(), 1);
});

test("con la posta soltada: 'released'; vencida: 'stale'", async () => {
  fake.kv.set("arcade:lease:epoch", "3");
  fake.kv.set("arcade:lease:e:3", record("vieja", "released"));
  assert.equal(await H.takeOver(deps(), T), "released");
  assert.equal(L.myEpoch(), 4);

  L.resetLeaseForTests();
  fake.kv.set("arcade:lease:epoch", "8");
  fake.kv.set("arcade:lease:e:8", record("vieja", "active", Date.now() - L.LEASE_STALE_MS - 1));
  assert.equal(await H.takeOver(deps(), T), "stale");
  assert.equal(L.myEpoch(), 9);
});

test("con una dueña viva: pide la posta, toca el timbre y la toma cuando la vieja la suelta", async () => {
  oldHolder(5);
  let rings = 0;
  const d = deps({
    ringDoorbell: async () => {
      rings++;
      // La vieja acepta, entrega y suelta (acá, antes de responder).
      fake.kv.set("arcade:lease:e:5", record("vieja", "released"));
      return true;
    },
  });
  assert.equal(await H.takeOver(d, T), "doorbell");
  assert.equal(rings, 1);
  const pedido = JSON.parse(fake.kv.get("arcade:lease:handover")!);
  assert.equal(pedido.forEpoch, 5);
  assert.equal(pedido.by, L.INSTANCE_ID);
  assert.equal(L.myEpoch(), 6);
  assert.equal(R.getMode(), "starting", "la nueva no se declara sana hasta cargar");
});

test("si nadie contesta el timbre, pasa a respaldo (/health 200) y espera sin tope ciego", async () => {
  oldHolder(2);
  const d = deps();
  const taking = H.takeOver(d, T);
  await until(() => R.getMode() === "fallback");
  assert.ok(d.logs.some((l) => /respaldo/.test(l)));
  assert.equal(L.isHolder(), false, "no toma la posta de una dueña viva");
  // La vieja recibe su SIGTERM de Render, guarda y suelta.
  fake.kv.set("arcade:lease:e:2", record("vieja", "released"));
  assert.equal(await taking, "fallback");
  assert.equal(L.myEpoch(), 3);
});

test("con una posta viva del #33: respaldo directo, sin timbre", async () => {
  fake.kv.set("arcade:lease", JSON.stringify({ id: "vieja-33", at: Date.now(), released: false }));
  let rings = 0;
  const d = deps({
    ringDoorbell: async () => {
      rings++;
      return false;
    },
  });
  const taking = H.takeOver(d, T);
  await until(() => R.getMode() === "fallback");
  fake.kv.set("arcade:lease", JSON.stringify({ id: "vieja-33", at: Date.now(), released: true }));
  assert.equal(await taking, "fallback");
  assert.equal(rings, 0);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease")!).id, L.INSTANCE_ID);
});

test("sin URL para el timbre, respaldo directo", async () => {
  oldHolder(1);
  const d = deps({ doorbellConfigured: false });
  const taking = H.takeOver(d, T);
  await until(() => R.getMode() === "fallback");
  fake.kv.set("arcade:lease:e:1", record("vieja", "released"));
  assert.equal(await taking, "fallback");
});

test("un error pasajero de Upstash no tira el arranque: reintenta", async () => {
  fake.failWith = 500;
  const d = deps();
  const taking = H.takeOver(d, T);
  await until(() => d.logs.some((l) => /reintento/.test(l)));
  fake.failWith = null;
  assert.equal(await taking, "none");
});

// ---- La vieja: handOver -------------------------------------------------------

test("entrega: frena relojes, espera lo en curso, guarda y RECIÉN AHÍ suelta", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  assert.equal(await H.handOver("doorbell", d, T), "released");
  fake.kv.set("arcade:lease:epoch", "2"); // la nueva la toma: no hay que retomar
  assert.deepEqual(d.calls, ["stopJobs", "idle", "flush"]);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:1")!).state, "released");
  assert.equal(L.isHolder(), false);
  assert.equal(R.getMode(), "released");
  assert.ok(d.logs.some((l) => /Entregué la posta \(época 1, por timbre\)/.test(l)));
});

test("si el guardado falla, la entrega se aborta: no suelta y vuelve a atender", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps({
    flushAll: async () => {
      throw new Error("upstash caído");
    },
  });
  assert.equal(await H.handOver("sigterm", d, T), "aborted");
  assert.equal(L.isHolder(), true);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:1")!).state, "active");
  assert.equal(R.getMode(), "ready");
  assert.ok(d.calls.includes("startJobs"), "rearranca los relojes");
});

test("un SIGTERM durante una entrega por timbre espera ESA entrega (no guarda dos veces)", async () => {
  await L.acquireLease();
  R.setMode("ready");
  let flushes = 0;
  let finish!: () => void;
  const d = deps({
    flushAll: () =>
      new Promise<void>((ok) => {
        flushes++;
        finish = ok;
      }),
  });
  const porTimbre = H.handOver("doorbell", d, T);
  await until(() => flushes === 1);
  const porSigterm = H.handOver("sigterm", d, T);
  finish();
  assert.equal(await porTimbre, "released");
  assert.equal(await porSigterm, "released");
  assert.equal(flushes, 1);
  fake.kv.set("arcade:lease:epoch", "2");
});

test("si la nueva no toma la posta, la vieja la retoma y vuelve a atender", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  assert.equal(await H.handOver("doorbell", d, T), "released");
  await until(() => R.getMode() === "ready");
  assert.equal(L.isHolder(), true);
  assert.equal(L.myEpoch(), 2);
  assert.ok(d.calls.includes("startJobs"));
  assert.ok(d.logs.some((l) => /Retomé la posta/.test(l)));
});

test("si la nueva la tomó, la vieja no retoma", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  await H.handOver("doorbell", d, T);
  fake.kv.set("arcade:lease:epoch", "2");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(R.getMode(), "released");
  assert.equal(L.isHolder(), false);
});

// ---- El timbre ------------------------------------------------------------------

test("timbre válido: 202 y arranca la entrega", async () => {
  await L.acquireLease();
  R.setMode("ready");
  fake.kv.set(
    "arcade:lease:handover",
    JSON.stringify({ by: "nueva", forEpoch: 1, at: Date.now() }),
  );
  const r = await H.answerDoorbell(deps(), T);
  assert.equal(r.status, 202);
  assert.ok(["draining", "released"].includes(R.getMode()));
  await until(() => R.getMode() === "released");
  fake.kv.set("arcade:lease:epoch", "2");
});

test("timbre sin pedido en Redis, para otra época, propio o viejo: 409 y no entrega", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  assert.equal((await H.answerDoorbell(d, T)).status, 409, "sin pedido");
  const pedido = (p: object) => fake.kv.set("arcade:lease:handover", JSON.stringify(p));
  pedido({ by: "nueva", forEpoch: 7, at: Date.now() });
  assert.equal((await H.answerDoorbell(d, T)).status, 409, "otra época");
  pedido({ by: L.INSTANCE_ID, forEpoch: 1, at: Date.now() });
  assert.equal((await H.answerDoorbell(d, T)).status, 409, "propio");
  pedido({ by: "nueva", forEpoch: 1, at: Date.now() - 61_000 });
  assert.equal((await H.answerDoorbell(d, T)).status, 409, "viejo");
  assert.equal(R.getMode(), "ready");
  assert.equal(L.isHolder(), true);
});

test("timbre a una instancia que no es dueña: 409", async () => {
  R.setMode("starting");
  assert.equal((await H.answerDoorbell(deps(), T)).status, 409);
});

// ---- Cerco y apagado -----------------------------------------------------------

test("al perder la posta sin entregarla: se cerca (/health 503) y frena relojes", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  H.installFence(d);
  fake.kv.set("arcade:lease:epoch", "9");
  assert.equal(await L.confirmHolder(), false);
  assert.equal(R.getMode(), "fenced");
  assert.ok(d.calls.includes("stopJobs"));
});

test("apagado: en ready entrega; arrancando con la posta, la suelta SIN guardar", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  await H.shutdown("SIGTERM", d);
  assert.deepEqual(d.calls, ["stopJobs", "idle", "flush"]);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:1")!).state, "released");

  L.resetLeaseForTests();
  await L.acquireLease(); // época 2, todavía cargando
  R.setMode("starting");
  const d2 = deps();
  await H.shutdown("SIGTERM", d2);
  assert.deepEqual(d2.calls, [], "no guarda: no cargó nada que valga más que lo de Redis");
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:2")!).state, "released");
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --import tsx --test apps/server/test/handover.test.ts`
Expected: FAIL (`Cannot find module '../src/handover.js'`).

- [ ] **Step 3: Escribir `handover.ts`**

`apps/server/src/handover.ts`:

```ts
// EL TRASPASO ENTRE INSTANCIAS en un deploy de Render (spec:
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md).
//
// Render arranca la instancia nueva, le pasa el tráfico cuando pasa el health
// check y recién 60 s DESPUÉS le manda SIGTERM a la vieja. Por eso la nueva no
// espera ese SIGTERM: no se declara sana (/health 503, ver readiness.ts) hasta
// tener el estado, y mientras tanto le TOCA EL TIMBRE a la vieja con un pedido a
// la URL pública del servicio, que en ese momento solo puede llegarle a la
// vieja. La vieja frena sus relojes, termina lo que tenía en curso, guarda todo
// y suelta la posta; la nueva la toma, carga y recién ahí se declara sana.
//
// Si el timbre no llega (el primer deploy desde el PR #33, o una vieja que no
// contesta), la nueva pasa a RESPALDO: /health en 200 para que Render pase el
// tráfico y apague a la vieja, que entrega igual en su SIGTERM. Nunca se toma la
// posta de una dueña viva: solo si está soltada, vencida o no existe.

import { handoverEnabled } from "./persist.js";
import {
  INSTANCE_ID,
  acquireLease,
  classifyLease,
  currentEpoch,
  isHolder,
  myEpoch,
  onLeaseLost,
  readHandoverRequest,
  readLease,
  releaseLease,
  requestHandover,
  startLeaseHeartbeat,
  type LeaseStatus,
  type LeaseView,
} from "./lease.js";
import { HANDOVER_PATH, getMode, setMode } from "./readiness.js";

export interface HandoverDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** ¿Hay adónde tocar el timbre? (RENDER_EXTERNAL_URL o HANDOVER_URL). */
  doorbellConfigured: boolean;
  /** Toca el timbre de la vieja: true si respondió 202. */
  ringDoorbell: () => Promise<boolean>;
  /** Guarda todos los stores; rechaza si alguno falló (persist.ts). */
  flushAll: () => Promise<void>;
  startJobs: () => void;
  stopJobs: (capMs: number) => Promise<string[]>;
  waitForIdle: (capMs: number) => Promise<boolean>;
  log: (msg: string) => void;
}

export interface HandoverTiming {
  pollMs: number;
  doorbellEveryMs: number;
  acceptWaitMs: number;
  releaseWaitMs: number;
  fallbackPollMs: number;
  drainCapMs: number;
  flushTries: number;
  resumeAfterMs: number;
  resumePollMs: number;
  doorbellMinGapMs: number;
  requestMaxAgeMs: number;
}

const envMs = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export const HANDOVER_TIMING: HandoverTiming = {
  pollMs: envMs("HANDOVER_POLL_MS", 500),
  doorbellEveryMs: 5_000,
  acceptWaitMs: envMs("HANDOVER_ACCEPT_WAIT_MS", 30_000),
  releaseWaitMs: 30_000,
  fallbackPollMs: 1_000,
  drainCapMs: 10_000,
  flushTries: 3,
  resumeAfterMs: envMs("HANDOVER_RESUME_MS", 90_000),
  resumePollMs: 2_000,
  doorbellMinGapMs: 2_000,
  requestMaxAgeMs: 60_000,
};

export type TakeoverOutcome = "off" | "none" | "released" | "stale" | "doorbell" | "fallback";
type Free = "none" | "released" | "stale";

const isFree = (s: LeaseStatus): s is Free => s === "none" || s === "released" || s === "stale";

/** Reintenta un paso contra Upstash: un error pasajero no tira el arranque. Si
 *  Upstash sigue caído, la nueva nunca se declara sana y Render cancela el
 *  deploy a los 15 min, con la vieja atendiendo. */
async function retrying<T>(d: HandoverDeps, what: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      d.log(`Traspaso: falló ${what} (${(e as Error).message}); reintento`);
      await d.sleep(Math.min(5_000, 500 * 2 ** i));
    }
  }
}

async function look(d: HandoverDeps): Promise<{ view: LeaseView; status: LeaseStatus }> {
  const view = await retrying(d, "leer la posta", readLease);
  return { view, status: classifyLease(view, d.now()) };
}

async function take(d: HandoverDeps, view: LeaseView): Promise<void> {
  await retrying(d, "tomar la posta", () => acquireLease(view));
}

// ---- La nueva ----------------------------------------------------------------

/** LA NUEVA: consigue la posta. Al volver, esta instancia es la dueña. */
export async function takeOver(
  d: HandoverDeps,
  t: HandoverTiming = HANDOVER_TIMING,
): Promise<TakeoverOutcome> {
  if (!handoverEnabled) return "off";
  const first = await look(d);
  if (isFree(first.status)) {
    await take(d, first.view);
    return first.status;
  }
  if (first.status === "held" && first.view.epoch !== null && d.doorbellConfigured) {
    const got = await viaDoorbell(d, t, first.view.epoch);
    if (got) return got;
  }
  // RESPALDO, sin tope ciego: /health en 200 para que Render pase el tráfico y
  // le mande el SIGTERM a la vieja, que entrega igual que con el timbre.
  setMode("fallback");
  d.log("Traspaso: respaldo (esperando el SIGTERM de la vieja)");
  for (;;) {
    await d.sleep(t.fallbackPollMs);
    const cur = await look(d);
    if (isFree(cur.status)) {
      await take(d, cur.view);
      return "fallback";
    }
  }
}

async function viaDoorbell(
  d: HandoverDeps,
  t: HandoverTiming,
  epoch: number,
): Promise<TakeoverOutcome | null> {
  await retrying(d, "pedir la posta", () => requestHandover(epoch));
  const t0 = d.now();
  let accepted = false;
  while (d.now() - t0 < t.acceptWaitMs) {
    accepted = await d.ringDoorbell().catch(() => false);
    if (accepted) break;
    const cur = await look(d);
    if (isFree(cur.status)) {
      await take(d, cur.view);
      return cur.status;
    }
    await d.sleep(t.doorbellEveryMs);
  }
  if (!accepted) return null;
  const t1 = d.now();
  while (d.now() - t1 < t.releaseWaitMs) {
    // Primero esperar: la vieja necesita un momento para frenar y guardar.
    await d.sleep(t.pollMs);
    const cur = await look(d);
    if (isFree(cur.status)) {
      await take(d, cur.view);
      return "doorbell";
    }
  }
  return null;
}

// ---- La vieja ----------------------------------------------------------------

export type HandoverResult = "released" | "aborted" | "not-holder";

let draining: Promise<HandoverResult> | null = null;

/** LA VIEJA: entrega la posta, por el timbre o por SIGTERM. Si ya estaba
 *  entregando, devuelve ESA entrega (no guarda dos veces). */
export function handOver(
  reason: "doorbell" | "sigterm",
  d: HandoverDeps,
  t: HandoverTiming = HANDOVER_TIMING,
): Promise<HandoverResult> {
  if (draining) return draining;
  if (getMode() === "released") return Promise.resolve("released");
  if (!isHolder()) return Promise.resolve("not-holder");
  draining = drain(reason, d, t).finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(
  reason: "doorbell" | "sigterm",
  d: HandoverDeps,
  t: HandoverTiming,
): Promise<HandoverResult> {
  const t0 = d.now();
  const epoch = myEpoch();
  setMode("draining");
  const late = await d.stopJobs(t.drainCapMs);
  if (late.length) d.log(`Entrega: relojes que no terminaron a tiempo: ${late.join(", ")}`);
  if (!(await d.waitForIdle(t.drainCapMs))) d.log("Entrega: quedaron pedidos en curso; sigo igual");
  let saved = false;
  for (let i = 0; i < t.flushTries && !saved; i++) {
    try {
      await d.flushAll();
      saved = true;
    } catch (e) {
      d.log(`Entrega: falló el guardado (${(e as Error).message})`);
      if (i + 1 < t.flushTries) await d.sleep(1_000);
    }
  }
  if (saved) {
    try {
      await releaseLease();
    } catch (e) {
      saved = false;
      d.log(`Entrega: no pude soltar la posta (${(e as Error).message})`);
    }
  }
  if (!saved) {
    // Soltar sin haber guardado haría cargar a la nueva un estado viejo: mejor
    // seguir atendiendo con la posta. La nueva espera (o pasa a respaldo).
    startLeaseHeartbeat();
    setMode("ready");
    d.startJobs();
    d.log("⚠️ Entrega abortada: sigo atendiendo con la posta");
    return "aborted";
  }
  setMode("released");
  d.log(
    `Entregué la posta (época ${epoch}, por ${reason === "sigterm" ? "SIGTERM" : "timbre"}): ` +
      `relojes frenados, guardado en ${d.now() - t0} ms`,
  );
  if (reason === "doorbell" && epoch !== null) void watchForResume(epoch, d, t);
  return "released";
}

/** Si la nueva se cae después del timbre y antes de tomar la posta, Render no le
 *  pasó el tráfico y esta instancia quedaría respondiendo 503 para siempre: a
 *  los `resumeAfterMs` sin que nadie la tome, la retoma. Su memoria es la última
 *  versión y nadie escribió después, así que no recarga. */
async function watchForResume(epoch: number, d: HandoverDeps, t: HandoverTiming): Promise<void> {
  const t0 = d.now();
  while (d.now() - t0 < t.resumeAfterMs) {
    await d.sleep(t.resumePollMs);
    if (getMode() !== "released") return;
    // Si Upstash falla, seguir mirando.
    const cur = await currentEpoch().catch(() => epoch);
    if (cur !== epoch) return; // la nueva ya la tomó
  }
  if (getMode() !== "released") return;
  try {
    if ((await currentEpoch()) !== epoch) return;
    await acquireLease();
    startLeaseHeartbeat();
    setMode("ready");
    d.startJobs();
    d.log(`Retomé la posta (época ${myEpoch()}): la instancia nueva no apareció`);
  } catch (e) {
    d.log(`No pude retomar la posta: ${(e as Error).message}`);
  }
}

// ---- El timbre ---------------------------------------------------------------

let lastRing = 0;

/** POST /internal/handover: la nueva pide la posta. La autoridad está en Redis
 *  (el pedido que escribió la nueva); el timbre solo avisa que hay que mirarlo,
 *  así que no lleva secreto. Como mucho, un toque cada `doorbellMinGapMs`. */
export async function answerDoorbell(
  d: HandoverDeps,
  t: HandoverTiming = HANDOVER_TIMING,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const mode = getMode();
  const active = mode === "ready" && isHolder();
  const handingOver = mode === "draining" || mode === "released";
  if (!active && !handingOver) return { status: 409, body: { accepted: false, mode } };
  const now = d.now();
  if (now - lastRing < t.doorbellMinGapMs) return { status: 429, body: { accepted: false } };
  lastRing = now;
  const req = await readHandoverRequest();
  const epoch = myEpoch();
  if (
    !req ||
    req.forEpoch !== epoch ||
    req.by === INSTANCE_ID ||
    now - req.at > t.requestMaxAgeMs
  ) {
    return { status: 409, body: { accepted: false, mode } };
  }
  if (active) void handOver("doorbell", d, t);
  return { status: 202, body: { accepted: true, epoch } };
}

/** Toca el timbre por la URL pública del servicio: mientras la nueva no está
 *  sana, Render solo enruta a la vieja. */
export function doorbellAt(baseUrl: string | undefined): () => Promise<boolean> {
  return async () => {
    if (!baseUrl) return false;
    const r = await fetch(`${baseUrl.replace(/\/+$/, "")}${HANDOVER_PATH}`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    return r.status === 202;
  };
}

// ---- Cerco y apagado ---------------------------------------------------------

/** Si esta instancia descubre que perdió la posta sin haberla entregado, se
 *  cerca: frena sus relojes y /health da 503 para que Render la reinicie. */
export function installFence(d: HandoverDeps): void {
  onLeaseLost(() => {
    if (getMode() === "released") return;
    setMode("fenced");
    void d.stopJobs(HANDOVER_TIMING.drainCapMs);
    d.log("⚠️ Instancia cercada: otra tomó la posta. /health da 503 para que Render la reinicie.");
  });
}

/** SIGTERM/SIGINT. Con traspaso: la dueña entrega (igual que con el timbre).
 *  Una instancia que nunca terminó de arrancar pero alcanzó a tomar la posta la
 *  suelta SIN guardar: no cargó nada que valga más que lo que ya está en Redis.
 *  Sin traspaso (dev con archivo): guardar todo. */
export async function shutdown(sig: string, d: HandoverDeps): Promise<void> {
  try {
    if (!handoverEnabled) {
      await d.flushAll();
      return;
    }
    const mode = getMode();
    if (mode === "ready" || mode === "draining") {
      d.log(`Apagado (${sig}): ${await handOver("sigterm", d)}`);
      return;
    }
    if ((mode === "starting" || mode === "fallback") && isHolder()) await releaseLease();
  } catch (e) {
    d.log(`Apagado (${sig}): ${(e as Error).message}`);
  }
}

export function installShutdown(
  d: HandoverDeps,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      void shutdown(sig, d).finally(() => exit(0));
    });
  }
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --import tsx --test apps/server/test/handover.test.ts && npm run typecheck:server`
Expected: PASS (17 tests), sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/handover.ts apps/server/test/handover.test.ts
git commit -m "feat(server): el traspaso con timbre (la nueva pide la posta, la vieja frena, guarda y suelta)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Guarda estricta en `persist.ts`, Aleph que no publica sin guardar, y el arranque en `index.ts`

**Files:**

- Modify:
  - `apps/server/src/persist.ts`: guarda por posta, `flush()` estricto, `flushAll()`, y sale todo el código de posta del #33.
  - `apps/server/src/aleph.ts`: guardar la tabla firmada antes de CADA publicación hasta que quede guardada.
  - `apps/server/src/index.ts`: probar Redis, timbre, arranque, cerco y apagado.
  - `apps/server/test/aleph-money-durability.test.ts`: un caso nuevo.
- Create: `apps/server/test/persist-guard.test.ts`
- Delete: `apps/server/test/persist-handover.test.ts` (probaba la posta del #33, que desaparece)

**Interfaces:**

- Consumes: `isHolder`, `confirmHolder`, `readLease`, `startLeaseHeartbeat` (Task 2); `setMode`, `waitForIdle`, `readinessGate`, `HANDOVER_PATH` (Task 3); `registerJob`, `startJobs`, `stopJobs` (Task 4); `takeOver`, `answerDoorbell`, `doorbellAt`, `installFence`, `installShutdown`, `HandoverDeps` (Task 5).
- Produces:
  - `persist.ts`: `class NotHolderError extends Error`, `flushAll(): Promise<void>`, `handoverEnabled`.
  - Salen de `persist.ts`: `INSTANCE_ID`, `waitForHandover`, `acquireLease`, `leaseHeartbeat`, `startLeaseHeartbeat`, `shutdownPersistence`, `HandoverOutcome` y el manejador de SIGTERM.

- [ ] **Step 1: Escribir los tests que fallan**

`apps/server/test/persist-guard.test.ts`:

```ts
// LA GUARDA DE ESCRITURA de persist.ts: con traspaso, escribe SOLO la dueña de la
// posta, y un guardado que no se pudo hacer RECHAZA. aleph.ts publica on-chain
// DESPUÉS de guardar: un "listo" falso publicaría una tabla sin guardar.
// Correr: node --import tsx --test apps/server/test/persist-guard.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.ARCADE_PERSIST = "1";
process.env.ARCADE_PERSIST_HANDOVER = "1"; // lo que enciende persist-on.ts en el servidor real
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
process.env.PERSIST_DEBOUNCE_MS = "3600000"; // nada se escribe solo
const P = await import("../src/persist.js");
const L = await import("../src/lease.js");

const sets = (key: string) => fake.log.filter((c) => c[0] === "SET" && c[1] === key).length;

beforeEach(() => {
  fake.kv.clear();
  fake.failWith = null;
  L.resetLeaseForTests();
});

test("sin la posta no escribe, y flush RECHAZA: no hace como que guardó", async () => {
  const s = P.jsonStore("g1");
  s.save(() => '{"v":1}');
  await assert.rejects(s.flush(), P.NotHolderError);
  assert.equal(fake.kv.has("arcade:g1"), false);
});

test("lo que quedó pendiente sin la posta se guarda al tenerla", async () => {
  const s = P.jsonStore("g2");
  s.save(() => '{"v":2}');
  await assert.rejects(s.flush());
  await L.acquireLease();
  await s.flush();
  assert.equal(fake.kv.get("arcade:g2"), '{"v":2}');
});

test("si Upstash falla, flush RECHAZA y el próximo flush lo reintenta solo", async () => {
  await L.acquireLease();
  const s = P.jsonStore("g3");
  s.save(() => '{"v":3}');
  fake.failWith = 500;
  await assert.rejects(s.flush());
  fake.failWith = null;
  await s.flush(); // nadie volvió a llamar a save(): igual se reintenta
  assert.equal(fake.kv.get("arcade:g3"), '{"v":3}');
});

test("antes de subir un blob confirma la posta: si otra la tomó, no escribe", async () => {
  await L.acquireLease();
  let lost = 0;
  L.onLeaseLost(() => lost++);
  fake.kv.set("arcade:lease:epoch", "9");
  const s = P.jsonStore("g4");
  s.save(() => '{"v":4}');
  await assert.rejects(s.flush(), P.NotHolderError);
  assert.equal(fake.kv.has("arcade:g4"), false);
  assert.equal(lost, 1);
});

test("un flush sin cambios no vuelve a subir el blob", async () => {
  await L.acquireLease();
  const s = P.jsonStore("g5");
  s.save(() => '{"v":5}');
  await s.flush();
  const antes = sets("arcade:g5");
  s.save(() => '{"v":5}');
  await s.flush();
  assert.equal(sets("arcade:g5"), antes);
});

test("flushAll rechaza si algún store no se pudo guardar", async () => {
  const s = P.jsonStore("g6");
  s.save(() => '{"v":6}');
  await assert.rejects(P.flushAll(), /no se guardaron/);
});
```

En `apps/server/test/aleph-money-durability.test.ts`:

1. Agregar `let failSetsLeft = 0;` justo arriba de `const writes: { key: string; body: string }[] = [];`.
2. En el handler del Upstash falso, reemplazar el bloque `if (url.startsWith("/set/")) { … }` por:
   ```ts
   if (url.startsWith("/set/")) {
     if (failSetsLeft > 0) {
       failSetsLeft--;
       res.statusCode = 500;
       res.end(JSON.stringify({ error: "caído" }));
       return;
     }
     writes.push({ key: url.slice("/set/".length), body: Buffer.concat(chunks).toString("utf8") });
     res.end(JSON.stringify({ result: "OK" }));
   }
   ```
3. Agregar este test después del primero ("la tabla de pagos firmada llega al store ANTES…"):

```ts
test("si guardar la tabla firmada falla, el settle NO sale; el reintento la guarda antes de publicar", async () => {
  V.__resetAlephForTest();
  writes.length = 0;
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  const end = await playToSettled(roomId, ws, T0 + 2_000);

  failSetsLeft = 1; // Upstash rechaza la próxima escritura
  await V.alephChainTick(end + 1);
  assert.deepEqual(chain.calls, [], "sin la tabla guardada, el settle no sale");
  const firmada = (await V.getAlephRoom(roomId, undefined, end + 2))!.payoutSig;
  assert.ok(firmada, "la tabla quedó firmada en memoria");

  // Pasado el backoff, el reintento guarda PRIMERO y recién ahí publica, con la
  // MISMA tabla (una sala firma una sola en su vida).
  await V.alephChainTick(end + 10 * 60_000);
  assert.deepEqual(chain.calls, ["settle"]);
  assert.ok(chain.blobAtSettle, "en el instante del settle, la tabla ya estaba guardada");
  const guardada = (
    JSON.parse(chain.blobAtSettle!) as { id: string; chain?: { payoutSig?: string } }[]
  ).find((r) => r.id === roomId);
  assert.equal(guardada?.chain?.payoutSig, firmada);
  C.setAlephChainForTest(undefined);
});
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `node --import tsx --test apps/server/test/persist-guard.test.ts apps/server/test/aleph-money-durability.test.ts`
Expected: FAIL. `NotHolderError` y `flushAll` no existen, y hoy el `settle` sale aunque la escritura falle (`chain.calls` = `["settle"]`).

- [ ] **Step 3: `persist.ts` con guarda por posta y `flush()` estricto**

En `apps/server/src/persist.ts`:

1. Borrar `import { randomUUID } from "node:crypto";`.
2. Debajo de `import { redisGet, redisSet } from "./redis.js";`, agregar:
   ```ts
   import { confirmHolder, isHolder } from "./lease.js";
   ```
3. Borrar el bloque entero desde el comentario `// TRASPASO ENTRE INSTANCIAS (deploys sin cortes).` hasta el final de `startLeaseHeartbeat` inclusive. Eso incluye `LEASE_KEY`, `LEASE_HEARTBEAT_MS`, `INSTANCE_ID`, `Lease`, `writable`, `readLease`, `writeLease`, `HandoverOutcome`, `waitForHandover`, `acquireLease`, `leaseHeartbeat` y `startLeaseHeartbeat`.
4. Reemplazar la declaración de `handoverEnabled` que agregó la Task 1 (con su comentario) por este bloque, que la redefine y suma la guarda y el error:

```ts
/** ¿Hay traspaso entre instancias? Solo con Redis y en el servidor real (lo
 *  enciende persist-on.ts). Sin traspaso (tests, dev con archivo) hay UNA
 *  instancia y siempre escribe. Con traspaso escribe SOLO la dueña de la posta
 *  (lease.ts): una instancia que arranca nunca pisa el estado real con el suyo
 *  vacío, y una vieja que ya entregó no pisa el de la nueva. */
export const handoverEnabled = USE_REDIS && process.env.ARCADE_PERSIST_HANDOVER === "1";
const canWrite = (): boolean => !handoverEnabled || isHolder();

/** Sin la posta no se guarda nada, y eso es un error, no un "listo": aleph.ts
 *  publica on-chain DESPUÉS de guardar, y una tabla firmada que no quedó
 *  guardada no se puede publicar. */
export class NotHolderError extends Error {
  constructor(store: string) {
    super(`persist ${store}: sin la posta, no se guarda`);
    this.name = "NotHolderError";
  }
}
```

5. En `interface JsonStore`, reemplazar la doc de `flush` por:
   ```ts
   /** Escritura inmediata de lo pendiente. RECHAZA si no se pudo guardar (sin
    *  la posta, o Upstash/disco falló): quien publica algo después de guardar
    *  tiene que enterarse. */
   flush(): Promise<void>;
   ```
6. Reemplazar el cuerpo de `jsonStore` (desde `let pending` hasta `return store;`) por:

```ts
let pending: (() => string) | null = null;
let timer: NodeJS.Timeout | null = null;
// Último contenido efectivamente escrito, para no repetir escrituras idénticas.
let lastWritten: string | null = null;
// La suerte de la última escritura (rechaza si falló). Un flush sin nada nuevo
// devuelve ESTA: "sin cambios" no es "guardado" si la anterior todavía viaja
// o falló.
let lastAttempt: Promise<void> = Promise.resolve();
// Las escrituras a Redis se encadenan: si una tarda y llega otra, la nueva
// espera a la anterior — nunca se persiste estado viejo por completarse fuera
// de orden (cada SET es el blob entero, gana el último). `chain` nunca
// rechaza, así una falla no traba las siguientes.
let chain: Promise<void> = Promise.resolve();

const failed = (e: unknown): Promise<void> => {
  const p = Promise.reject(e);
  p.catch(() => {}); // que no cuente como rechazo sin manejar
  return p;
};

function writeNow(): Promise<void> {
  // Sin la posta no se escribe: lo pendiente queda para cuando la tenga.
  if (!canWrite()) return pending ? failed(new NotHolderError(name)) : lastAttempt;
  const getJson = pending;
  pending = null;
  if (!getJson) return lastAttempt;
  const json = getJson();
  // SIN CAMBIOS, SIN ESCRITURA. Varios caminos llaman persist() aunque no
  // haya cambiado nada (el barrido, reintentos, endpoints que releen). Cada
  // una de esas subía el blob entero de nuevo para dejarlo igual que estaba.
  if (json === lastWritten) return lastAttempt;
  lastWritten = json;
  if (USE_REDIS) {
    const attempt = chain.then(async () => {
      // Antes de subir el blob, confirmar que la posta sigue siendo mía (una
      // lectura chica): una instancia que la perdió sin enterarse —colgada,
      // por ejemplo— no pisa el estado de la dueña.
      if (handoverEnabled && !(await confirmHolder())) throw new NotHolderError(name);
      await redisSet(redisKey, json);
    });
    chain = attempt.catch((e) => {
      // Falló: se olvida como "escrito" y queda pendiente, así el próximo
      // flush lo vuelve a mandar aunque nadie lo haya modificado.
      if (lastWritten === json) lastWritten = null;
      pending ??= getJson;
      if (!(e instanceof NotHolderError)) {
        console.error(`persist ${name} (redis):`, (e as Error).message);
      }
    });
    lastAttempt = attempt;
    return attempt;
  }
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    // Escritura atómica: a un temporal y luego rename, así un corte a mitad
    // de escritura no deja el archivo corrupto.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, json);
    renameSync(tmp, file);
    lastAttempt = Promise.resolve();
  } catch (e) {
    lastWritten = null; // igual que en Redis: que el próximo intento reescriba
    pending ??= getJson;
    console.error(`persist ${name} (file):`, (e as Error).message);
    lastAttempt = failed(e);
  }
  return lastAttempt;
}

const store: JsonStore = {
  async load() {
    if (!ENABLED) return null;
    if (USE_REDIS) return redisGet(redisKey); // un error acá corta el arranque
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null; // sin archivo: arrancamos limpio
    }
  },
  save(getJson) {
    if (!ENABLED) return;
    pending = getJson;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      // El agrupador no tiene a quién avisarle: la falla ya quedó en el log
      // y lo pendiente, para el próximo intento.
      writeNow().catch(() => {});
    }, DEBOUNCE_MS);
    timer.unref?.();
  },
  async flush() {
    if (!ENABLED) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await writeNow();
  },
};
stores.push(store);
return store;
```

7. Reemplazar todo lo que sigue a `jsonStore` (la función `shutdownPersistence` y el bloque `if (ENABLED) { for (const sig of … ) … }`) por:

```ts
/** Guarda YA todos los stores (entrega de la posta, apagado). RECHAZA si alguno
 *  no se pudo guardar: soltar la posta sin haber guardado haría cargar a la
 *  instancia nueva un estado viejo. El SIGTERM lo maneja handover.ts. */
export async function flushAll(): Promise<void> {
  const results = await Promise.allSettled(stores.map((s) => s.flush()));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) {
    const first = failures[0].reason as Error | undefined;
    throw new Error(
      `no se guardaron ${failures.length} de ${stores.length} stores: ${first?.message ?? "?"}`,
    );
  }
}
```

- [ ] **Step 4: Aleph guarda la tabla firmada antes de CADA publicación hasta que quede guardada**

En `apps/server/src/aleph.ts`:

1. Debajo de `const store$ = jsonStore("aleph");`, agregar:
   ```ts
   /** Salas cuya tabla firmada ya quedó GUARDADA en este proceso (ver settleOnchain). */
   const payoutSaved = new Set<string>();
   ```
2. En `settleOnchain`, sacar `await persistNow();` de adentro del `if (!rec.payoutSig) { … }` y ponerlo después del bloque, así:

```ts
if (!rec.payoutSig) {
  // La comisión se lee del CONTRATO: si difiriera del env, la suma no
  // cerraría y el settle revertiría.
  const feeBps = await chain.feeBps();
  const { amounts } = usdcPayoutTable(seats, room.payouts!, stakeToUnits(room.stake), feeBps);
  rec.feeBps = feeBps;
  rec.payoutsUsdc = Object.fromEntries(seats.map((a, i) => [a, amounts[i].toString()]));
  rec.payoutSig = await signAlephPayout(room.id, alephTableHash(seats, amounts));
}
// LA TABLA FIRMADA SE GUARDA ANTES DE PUBLICARSE. Una sala firma UNA sola
// tabla en su vida: la firma no lleva nonce y `settle` es permissionless,
// así que dos tablas firmadas de la misma sala son dos órdenes de pago
// válidas y cobra la que alguien presente primero. Lo único que puede
// romper esa garantía es perder ESTA en una caída dura (OOM/crash; un
// redeploy la guarda al entregar la posta): si la ventana perdida se lleva
// también las últimas acciones, la sala restaurada re-simula a OTRA tabla y
// la firma. Con el debounce de 20 s esa ventana dura 20 s; con este flush
// queda en UN viaje al store, no en cero: el event loop sigue atendiendo
// requests mientras se espera, y `roomView` ya devuelve la firma desde
// memoria. Va en CADA intento hasta que quede guardada: si el guardado de
// un intento falla (persist.ts rechaza), este intento no publica, y el
// reintento guarda antes de publicar. Cuesta una escritura por mesa de
// plata liquidada.
if (!payoutSaved.has(room.id)) {
  await persistNow();
  payoutSaved.add(room.id);
}
```

(Borrar el comentario viejo que estaba dentro del `if`, porque este lo reemplaza.)

3. En `__resetAlephForTest`, agregar `payoutSaved.clear();`.

- [ ] **Step 5: El arranque en `index.ts`**

En `apps/server/src/index.ts`:

1. Reemplazar el import de `./persist.js` (hoy trae `persistenceBackend, waitForHandover, acquireLease, startLeaseHeartbeat`) por:

```ts
import { persistenceBackend, handoverEnabled, flushAll } from "./persist.js";
import { readLease, startLeaseHeartbeat, confirmHolder } from "./lease.js";
import {
  takeOver,
  answerDoorbell,
  doorbellAt,
  installFence,
  installShutdown,
  type HandoverDeps,
} from "./handover.js";
```

2. `import { readinessGate, setMode } from "./readiness.js";` pasa a `import { readinessGate, setMode, waitForIdle, HANDOVER_PATH } from "./readiness.js";`
3. `import { registerJob, startJobs } from "./jobs.js";` pasa a `import { registerJob, startJobs, stopJobs } from "./jobs.js";`
4. Justo debajo del bloque `if (cfgErrors.length) { … }`, agregar:

```ts
// El traspaso entre instancias (ver handover.ts). El timbre va a la URL pública
// del servicio: Render define RENDER_EXTERNAL_URL; HANDOVER_URL la reemplaza
// (pruebas locales).
const HANDOVER_BASE_URL = process.env.HANDOVER_URL ?? process.env.RENDER_EXTERNAL_URL;
const handoverDeps: HandoverDeps = {
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  doorbellConfigured: !!HANDOVER_BASE_URL,
  ringDoorbell: doorbellAt(HANDOVER_BASE_URL),
  flushAll,
  startJobs,
  stopJobs,
  waitForIdle,
  log: (m) => console.log(m),
};
```

5. Reemplazar:

```ts
// ARRANQUE EN DOS TIEMPOS: hasta tener el estado (traspaso y carga, al final de
// este archivo), cualquier pedido salvo /health recibe 503 y reintenta.
app.use(readinessGate());
```

por:

```ts
// EL TIMBRE DEL TRASPASO: una instancia nueva le pide la posta a esta (ver
// handover.ts). Va antes de la puerta de readiness: se atiende en cualquier modo.
app.post(HANDOVER_PATH, async (_req, res) => {
  try {
    const r = await answerDoorbell(handoverDeps);
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error("[traspaso] timbre:", (e as Error).message);
    res.status(503).json({ accepted: false });
  }
});

// LOS MODOS DE LA INSTANCIA (ver readiness.ts): hasta tener el estado, /health y
// todo lo demás dan 503 (así Render le sigue mandando el tráfico a la vieja);
// también mientras entrega la posta.
app.use(readinessGate());
```

6. Reemplazar TODO el final del archivo, desde `// ESCUCHAR PRIMERO, ATENDER DESPUÉS` hasta el final, por:

```ts
// PROBAR REDIS ANTES DE ESCUCHAR: si Upstash no responde, el proceso termina sin
// haber escuchado, el deploy falla y la instancia vieja sigue atendiendo.
if (handoverEnabled) await readLease();
installFence(handoverDeps);
installShutdown(handoverDeps);

// ESCUCHAR PRIMERO, ATENDER DESPUÉS: /health da 503 hasta tener el estado.
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Arbitro escuchando en http://localhost:${port}`);
  console.log(`Direccion del arbitro: ${arbiterAddress()}`);
  console.log(`Persistencia: ${persistenceBackend}`);
  console.log(`Auth obligatoria (firma): ${AUTH_REQUIRED ? "SÍ" : "no"}`);
  if (process.env.NODE_ENV === "production" && !AUTH_REQUIRED) {
    console.warn(
      "⚠️  PRODUCCIÓN SIN AUTH: REQUIRE_AUTH=false desactivó la firma obligatoria. " +
        "Cualquiera podría enviar puntajes a nombre de otro. Quitá REQUIRE_AUTH (o ponelo en true).",
    );
  }
});

// TRASPASO: conseguir la posta (timbre a la vieja, o respaldo). Al volver, esta
// instancia es la dueña y carga exactamente lo que la vieja guardó.
const handover = await takeOver(handoverDeps);
console.log(`Traspaso: ${handover}`);
if (handoverEnabled) startLeaseHeartbeat();

// Restaurar el estado persistido. Si Redis está configurado y falla, el proceso
// termina sin haber atendido nada: mejor eso que atender "vacío" y pisar los
// datos reales.
await Promise.all([
  restoreMatches(),
  restoreRatings(),
  restoreAgents(),
  restoreStats(),
  restoreProfiles(),
  restoreAleph(),
  restoreAlephHouse(),
]);

// Embudo (v4.1): el settle clasifica cada partida por origen (casa/mixta/
// terceros). El checker vive acá para no crear el ciclo matchmaking→agents.
setHouseAddressCheck((a) => {
  const agent = hostedAgentByAddress(a);
  return !!agent && isHouseWallet(agent.owner);
});

// Si otra instancia tomó la posta mientras cargábamos, el cerco ya dejó esta en
// "fenced" (/health 503) y Render la reinicia: no se atiende ni corren relojes.
if (!handoverEnabled || (await confirmHolder())) {
  setMode("ready");
  startJobs();
  console.log("Árbitro listo: estado cargado");
}
```

- [ ] **Step 6: Borrar el test de la posta del #33**

```bash
git rm apps/server/test/persist-handover.test.ts
```

- [ ] **Step 7: Correr los tests y el chequeo de tipos**

Run: `node --import tsx --test apps/server/test/persist-guard.test.ts apps/server/test/aleph-money-durability.test.ts apps/server/test/handover.test.ts apps/server/test/lease.test.ts apps/server/test/readiness.test.ts && npm run typecheck:server && npm run lint`
Expected: todo PASS, sin errores de tipos ni de lint.

- [ ] **Step 8: Commit**

```bash
git add -A apps/server/src/persist.ts apps/server/src/aleph.ts apps/server/src/index.ts apps/server/test/persist-guard.test.ts apps/server/test/aleph-money-durability.test.ts apps/server/test/persist-handover.test.ts
git commit -m "fix(server): el árbitro solo escribe con la posta y la nueva la pide por el timbre

flush() rechaza sin la posta o si Upstash falla, y Aleph guarda la tabla
firmada antes de CADA publicación hasta que quede guardada: antes, un
guardado que fallaba en silencio dejaba publicar una tabla sin guardar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Simulación de un deploy de Render de punta a punta

**Files:**

- Create: `apps/server/test/handover-sim.test.ts`

**Interfaces:**

- Consumes: `startFakeUpstash` (Task 1) y el servidor real `apps/server/src/index.ts` (Task 6), corrido como proceso hijo. Las variables de entorno que lee: `PORT`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RENDER_EXTERNAL_URL`, `ARBITER_PRIVATE_KEY`, `LEASE_HEARTBEAT_MS`, `LEASE_STALE_MS`, `HANDOVER_POLL_MS`, `HANDOVER_ACCEPT_WAIT_MS`, `HANDOVER_RESUME_MS`, `PERSIST_DEBOUNCE_MS`, `AGENTS_ENABLED` y `ALEPH_HOUSE_ENABLED`.

- [ ] **Step 1: Escribir la simulación**

`apps/server/test/handover-sim.test.ts`:

```ts
// SIMULACIÓN DE UN DEPLOY DE RENDER con árbitros de verdad (procesos hijos), el
// Upstash falso y un "Render" falso que imita lo que importa:
//  1. mientras la nueva no da /health 200, TODO el tráfico (incluido el timbre
//     por la URL pública) va a la vieja;
//  2. cuando la nueva da 200, el tráfico pasa a la nueva;
//  3. recién un rato DESPUÉS (60 s en Render; comprimido acá) le manda SIGTERM
//     a la vieja.
// Es la prueba que le faltó al PR #33: su simulación mandaba el SIGTERM
// enseguida, y en Render llega 60 s después del cambio de tráfico.
//
// Correr: node --import tsx --test apps/server/test/handover-sim.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { startFakeUpstash } from "./fake-upstash.js";

const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
// Sin .env: el árbitro carga dotenv desde su cwd, y un .env local podría traer
// variables reales (RPC, escrow). Un directorio vacío lo evita.
const CWD = mkdtempSync(join(tmpdir(), "arcade-sim-"));
// La cuenta #1 de anvil: pública y sin valor (la misma del selftest).
const ARBITER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const fake = await startFakeUpstash();
after(() => fake.close());

// ---- El Render falso: un proxy que manda todo a `target` ---------------------
const router = { target: 0, port: 0 };
const routerServer = createServer((req, res) => {
  const up = request(
    {
      host: "127.0.0.1",
      port: router.target,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (u) => {
      res.writeHead(u.statusCode ?? 502, u.headers);
      u.pipe(res);
    },
  );
  up.on("error", () => {
    res.statusCode = 502;
    res.end();
  });
  req.pipe(up);
});
await new Promise<void>((ok) => routerServer.listen(0, "127.0.0.1", ok));
router.port = (routerServer.address() as AddressInfo).port;
after(() => routerServer.close());
const PUBLIC = `http://127.0.0.1:${router.port}`;

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

interface Arbiter {
  name: string;
  port: number;
  proc: ChildProcess;
  out: string[];
  exited: Promise<number | null>;
}

async function startArbiter(name: string, env: Record<string, string> = {}): Promise<Arbiter> {
  const port = await freePort();
  const proc = spawn(process.execPath, ["--import", TSX, INDEX], {
    cwd: CWD,
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      UPSTASH_REDIS_REST_URL: fake.url,
      UPSTASH_REDIS_REST_TOKEN: "token-de-prueba",
      RENDER_EXTERNAL_URL: PUBLIC,
      ARBITER_PRIVATE_KEY: ARBITER_KEY,
      AGENTS_ENABLED: "false",
      ALEPH_HOUSE_ENABLED: "false",
      // Una hora de debounce: lo que aparezca guardado salió de la entrega.
      PERSIST_DEBOUNCE_MS: "3600000",
      LEASE_HEARTBEAT_MS: "1000",
      HANDOVER_POLL_MS: "100",
      HANDOVER_ACCEPT_WAIT_MS: "5000",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: string[] = [];
  const collect = (b: Buffer) => {
    for (const line of b.toString("utf8").split("\n")) if (line.trim()) out.push(line);
  };
  proc.stdout!.on("data", collect);
  proc.stderr!.on("data", collect);
  const exited = new Promise<number | null>((ok) => proc.on("exit", (code) => ok(code)));
  return { name, port, proc, out, exited };
}

const logged = (a: Arbiter, re: RegExp) => a.out.some((l) => re.test(l));

async function waitUntil(
  what: string,
  cond: () => boolean | Promise<boolean>,
  arbiters: Arbiter[],
  ms = 30_000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) {
      const dump = arbiters.map((a) => `--- ${a.name}\n${a.out.join("\n")}`).join("\n");
      throw new Error(`se venció esperando: ${what}\n${dump}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function health(port: number): Promise<number | undefined> {
  return (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.status;
}

test(
  "deploy normal: la nueva pide la posta por el timbre y carga lo último de la vieja",
  { timeout: 90_000 },
  async () => {
    fake.kv.clear();
    const a = await startArbiter("A");
    let b: Arbiter | undefined;
    try {
      router.target = a.port;
      await waitUntil("A lista", () => logged(a, /Árbitro listo/), [a]);

      const address = "0x" + "1".repeat(40);
      const mm = await fetch(`${PUBLIC}/matchmake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: "2048", stake: 0, address }),
      });
      assert.equal(mm.status, 200, await mm.clone().text());
      const { matchId } = (await mm.json()) as { matchId: string };
      assert.ok(
        !(fake.kv.get("arcade:matches") ?? "").includes(matchId),
        "la partida todavía vive solo en la memoria de A",
      );

      b = await startArbiter("B");
      const bb = b;
      // Render: espera a que la nueva dé 200, le pasa el tráfico y 60 s
      // (comprimidos en 1,5 s) después le manda SIGTERM a la vieja.
      const seen: number[] = [];
      await waitUntil(
        "B sana",
        async () => {
          const s = await health(bb.port);
          if (s) seen.push(s);
          return s === 200;
        },
        [a, bb],
      );
      router.target = bb.port;
      setTimeout(() => a.proc.kill("SIGTERM"), 1_500);

      assert.ok(seen.includes(503), "B no se declaró sana mientras A tenía la posta");
      assert.ok(logged(bb, /Traspaso: doorbell/), bb.out.join("\n"));
      assert.ok(logged(a, /Entregué la posta \(época 1, por timbre\)/), a.out.join("\n"));
      assert.equal(fake.kv.get("arcade:lease:epoch"), "2");

      const got = await fetch(`${PUBLIC}/match/${matchId}`);
      assert.equal(got.status, 200, "la partida creada en A existe en B");

      assert.equal(await a.exited, 0, "A sale limpia con el SIGTERM");
      assert.ok(!logged(a, /cercada|abortada/), a.out.join("\n"));
      assert.ok(!logged(bb, /cercada|abortada|respaldo/), bb.out.join("\n"));
    } finally {
      a.proc.kill("SIGKILL");
      b?.proc.kill("SIGKILL");
    }
  },
);

test(
  "primer deploy desde el #33: respaldo sin tope ciego, y la posta vieja queda marcada",
  { timeout: 90_000 },
  async () => {
    fake.kv.clear();
    fake.kv.set(
      "arcade:lease",
      JSON.stringify({ id: "vieja-33", at: Date.now(), released: false }),
    );
    const b = await startArbiter("B", { LEASE_STALE_MS: "600000" });
    try {
      await waitUntil("B en respaldo", () => logged(b, /Traspaso: respaldo/), [b]);
      assert.equal(await health(b.port), 200, "en respaldo da 200 para que Render pase el tráfico");
      const r = await fetch(`http://127.0.0.1:${b.port}/matches/recent`);
      assert.equal(r.status, 503, "pero no atiende hasta tener la posta");
      // La vieja del #33 recibe su SIGTERM de Render, guarda y suelta.
      fake.kv.set(
        "arcade:lease",
        JSON.stringify({ id: "vieja-33", at: Date.now(), released: true }),
      );
      await waitUntil("B lista", () => logged(b, /Árbitro listo/), [b]);
      assert.ok(logged(b, /Traspaso: fallback/), b.out.join("\n"));
      assert.notEqual(JSON.parse(fake.kv.get("arcade:lease")!).id, "vieja-33");
      assert.equal(fake.kv.get("arcade:lease:epoch"), "1");
    } finally {
      b.proc.kill("SIGKILL");
    }
  },
);

test(
  "si la nueva muere después del timbre, la vieja retoma la posta y sigue atendiendo",
  { timeout: 90_000 },
  async () => {
    fake.kv.clear();
    const a = await startArbiter("A", { HANDOVER_RESUME_MS: "1500" });
    let b: Arbiter | undefined;
    try {
      router.target = a.port;
      await waitUntil("A lista", () => logged(a, /Árbitro listo/), [a]);
      // B mira la posta recién a los 10 s: muere antes de tomarla.
      b = await startArbiter("B", { HANDOVER_POLL_MS: "10000" });
      const bb = b;
      await waitUntil("A entregó", () => logged(a, /Entregué la posta/), [a, bb]);
      bb.proc.kill("SIGKILL");
      await waitUntil("A retomó", () => logged(a, /Retomé la posta/), [a, bb]);
      assert.equal((await fetch(`${PUBLIC}/matches/recent`)).status, 200, "A vuelve a atender");
      assert.equal(fake.kv.get("arcade:lease:epoch"), "2");
    } finally {
      a.proc.kill("SIGKILL");
      b?.proc.kill("SIGKILL");
    }
  },
);
```

- [ ] **Step 2: Correrla y verla pasar**

Run: `node --import tsx --test apps/server/test/handover-sim.test.ts`
Expected: PASS (3 tests). Si falla, el error trae los logs de cada árbitro: leerlos antes de tocar nada.

- [ ] **Step 3: Confirmar que la simulación ve el bug del #33**

Correr el primer caso contra el código del #33 (es la prueba que le faltó), trayendo temporalmente `apps/server/src` de `origin/main`:

```bash
git checkout origin/main -- apps/server/src
node --import tsx --test --test-name-pattern "deploy normal" apps/server/test/handover-sim.test.ts || echo "FALLA CONTRA EL #33, COMO SE ESPERABA"
git checkout HEAD -- apps/server/src
git status --short apps/server/src
```

Expected:

- se imprime `FALLA CONTRA EL #33, COMO SE ESPERABA`, porque con el #33 la nueva da `/health` 200 enseguida y el test ve que nunca dio 503;
- el último comando no imprime nada, porque el código de las tasks 1–6 volvió intacto. `git checkout origin/main -- apps/server/src` no borra los archivos nuevos (`redis.ts`, `lease.ts`, etc.); el `index.ts` del #33 no los usa.

- [ ] **Step 4: Commit**

```bash
git add apps/server/test/handover-sim.test.ts
git commit -m "test(server): simulación de un deploy de Render con el SIGTERM 60 s después del cambio de tráfico

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentación, chequeo completo y PR

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `DEPLOY.md`

- [ ] **Step 1: CHANGELOG**

En `CHANGELOG.md`, reemplazar la sección `### Corregido — los deploys ya no pierden estado del árbitro` (la del #33) completa por:

```markdown
### Corregido — los deploys ya no pierden ni duplican estado del árbitro

- **Traspaso con timbre entre instancias.** Render arranca la instancia nueva,
  le pasa el tráfico y recién **60 s después** le manda SIGTERM a la vieja. La
  primera versión del arreglo (PR #33) esperaba ese SIGTERM con un tope de 60 s
  que vencía siempre antes: en cada deploy había casi un minuto de 503 y unos
  segundos con dos árbitros escribiendo a la vez. Ahora la nueva no se declara
  sana hasta tener el estado, y le **pide la posta a la vieja** con un pedido a
  la URL pública (que en ese momento solo le llega a la vieja). La vieja frena
  sus relojes, guarda todo y suelta la posta, y la nueva carga exactamente eso.
  La pausa es de segundos. Si la nueva se cae a mitad de camino, la vieja retoma
  sola. La posta es atómica (épocas con `INCR`): dos instancias ya no pueden
  pisarse.
- **Un guardado que falla ya no dice "listo".** `flush()` rechaza si no se pudo
  guardar (Upstash caído o sin la posta), y Aleph guarda la tabla de pagos
  firmada antes de cada intento de publicarla hasta que quede guardada. Antes
  podía publicar una tabla que nunca se guardó.
- El primer deploy con este cambio todavía tiene el minuto de 503 de antes
  (la vieja no conoce el timbre), pero ya con una sola dueña. No hacer rollback
  a una versión anterior a este cambio sin avisar: esas no conocen la posta
  por épocas.
```

- [ ] **Step 2: DEPLOY.md**

En `DEPLOY.md`, justo antes de la línea `- Anotá la **URL pública** del árbitro …`, agregar:

```markdown
- **Deploys sin cortes (traspaso con timbre).** No hay que configurar nada:
  Render define `RENDER_EXTERNAL_URL`, y el árbitro la usa para que la
  instancia nueva le pida la posta a la vieja. En los logs de un deploy se ve:
  - en la vieja, `Entregué la posta (época N, por timbre) …`;
  - en la nueva, `Traspaso: doorbell` y después `Árbitro listo: estado cargado`,
    pocos segundos después de `Arbitro escuchando`.

  El primer deploy con este cambio dice `Traspaso: respaldo …` y tarda ~1 min:
  es normal. **Si aparece otra cosa en un deploy normal**, hay que revisarlo:
  `Traspaso: respaldo`, `Traspaso: stale`, `Instancia cercada` o
  `Entrega abortada`.
```

- [ ] **Step 3: Chequeo completo**

Run: `npm run check`
Expected: sin errores de tipos, lint ni formato, todos los tests PASS y el selftest OK. Si `format:check` falla, correr `npx prettier --write` sobre los archivos tocados y volver a correr.

- [ ] **Step 4: E2E de pago (cambia el arranque del árbitro)**

```bash
pgrep -fl anvil || echo "sin anvil corriendo"
```

Si aparece un anvil, **no seguir**: es de otra sesión y el script hace `pkill -f anvil`. Avisar y esperar. Si no hay:

Run: `bash packages/contracts/check-payment-e2e.sh`
Expected: termina OK.

- [ ] **Step 5: Commit de docs, push y PR**

```bash
git add CHANGELOG.md DEPLOY.md
git commit -m "docs: el traspaso con timbre en el CHANGELOG y qué mirar en los logs de Render

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin fix/traspaso-con-timbre
gh pr create --base main --head fix/traspaso-con-timbre --title "fix(server): traspaso con timbre — un deploy ya no deja dos árbitros a la vez" --body-file "$SCRATCH/pr-traspaso.md"
```

El cuerpo del PR, en español y guardado en `$SCRATCH/pr-traspaso.md` (`$SCRATCH` es el directorio scratch de la sesión), explica:

- qué pasaba (el SIGTERM llega 60 s después y el tope del #33 vencía siempre);
- qué cambia (el timbre, la posta por épocas, el `flush` estricto y Aleph);
- qué se probó (unitarios, simulación de punta a punta, `npm run check`, e2e de pago);
- qué mirar en los logs del primer deploy y de los siguientes.

Termina con la línea `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Esperar los 2 checks de CI en verde**

Run: `gh pr checks --watch`
Expected: `check (tipos + lint + formato + tests + selftest)` y `Contrato (forge test + e2e)` en verde. El merge lo hace el dueño desde GitHub.
