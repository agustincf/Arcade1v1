# Aleph — Etapa 3 (web mínima y cierre) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que Aleph deje de ser invisible: dos páginas nuevas en la web (`/aleph` y `/aleph/[roomId]`), pestaña propia en el ranking, card en el home, los 4 idiomas, SEO, documentación de cierre y CHANGELOG 3.7.0, desplegado y verificado en producción.

**Architecture:** la web NO habla de reglas por su cuenta ni re-implementa el motor. Lee del árbitro (que ya expone todo desde la etapa 1) a través de cuatro funciones nuevas en `app/lib/arbiter.ts`, y convierte la sala en prosa con un módulo **puro** (`app/lib/alephStory.ts`) que devuelve claves i18n con variables, nunca texto. Así el registro se cuenta igual en los 4 idiomas y se testea sin React ni red. Las dos páginas son client components con sondeo cada 5 s (mismo patrón que `/watch` y `/leaderboard`); el SEO vive en sus `layout.tsx` (mismo patrón que `/watch/layout.tsx`). No se toca el árbitro, ni el motor, ni los SDKs, ni el MCP: esta etapa es 100 % `apps/web` + documentación.

**Tech Stack:** Next 16 (App Router, `proxy.ts` como middleware), React 19, Tailwind v4 con las clases del sistema (`win`, `win-title`, `paper`, `btn3d`, `chip`), `@arcade1v1/game-sdk/aleph` (constantes y tipos del motor, ya es dependencia de la web), `node:test` + `tsx` para los tests.

**Spec:** `docs/superpowers/specs/2026-09-05-la-boveda-design.md` — leer entero antes de empezar; esta etapa implementa la sección **"Web mínima (etapa 3)"**, el bloque **"Documentación"** y la etapa 3 de **"Etapas de construcción"**.

## Global Constraints

- **Rama:** `feat/aleph-etapa3` (ya existe, nace de `main` con el commit `9c39700`). **`main` no acepta push directo**: al final se abre un PR y CI corre los 2 checks. **No pushear ni desplegar sin el OK explícito del dueño** (Vercel despliega solo al mergear).
- **No se toca `apps/server`, `apps/mcp`, `packages/*`.** Si algo parece faltar en el árbitro, se resuelve en la web; si de verdad falta, se para y se avisa. Las versiones 0.3.0 ya están publicadas en npm y no se re-publican en esta etapa.
- **La mesa gratis es la única que existe** (`stake 0`). Ningún texto puede sugerir que hay plata en juego: las mesas de plata llegan con el contrato de N depósitos (etapa 4).
- **Humanos no juegan Aleph, miran.** Ninguna página ofrece un botón "sentarse": se explica cómo sienta uno a su agente (MCP o SDK).
- **i18n obligatorio en los 4 idiomas** (`en`, `es`, `hi`, `fr`): el test `apps/web/test/i18n.test.ts` falla si un idioma queda con una clave de menos. Ninguna cadena visible se escribe suelta en el JSX.
- **El nombre visible es "Aleph"** y no se traduce; el id técnico también es `aleph`.
- **Unidades, no dinero:** los números del motor son unidades enteras (`UNITS_PER_SEAT = 1000` por asiento). Nunca escribir "$", "USDC" ni "ganó plata" en el contexto de Aleph.
- **Nada de animaciones, avatares ni sonido:** es texto. El espectador visual es la etapa 5.
- **Estilo del repo:** comentarios y mensajes de commit en español, código e identificadores en inglés, Prettier manda (`npm run format`), `npm run check` tiene que quedar verde antes del PR.

---

## Estructura de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `apps/web/app/lib/arbiter.ts` (modificar, al final) | Sección "ALEPH": `getAlephLobbies`, `getAlephRoom`, `getAlephLog`, `getRecentAlephRooms` y los tipos re-exportados. Es el único lugar de la web que conoce las rutas `/aleph/*`. |
| `apps/web/app/lib/alephStory.ts` (crear) | Narrador **puro**: de `AlephRoomView` a una lista de `StoryLine` (clave i18n + variables ya formateadas). Sin React, sin red, sin `Date.now()`. |
| `apps/web/test/aleph-story.test.ts` (crear) | Tests del narrador: una rama por tipo de etapa + la garantía de que toda clave que emite existe en los 4 diccionarios. |
| `apps/web/app/lib/i18n/{en,es,hi,fr}.ts` (modificar) | Las claves `aleph.*` y `game.aleph.name`, idénticas en los 4. |
| `apps/web/app/aleph/page.tsx` (crear) | Qué es Aleph, mesas abiertas con cuenta regresiva, cómo sentar un agente (MCP y SDK), salas recientes. |
| `apps/web/app/aleph/layout.tsx` (crear) | Metadata SEO de `/aleph`. |
| `apps/web/app/aleph/[roomId]/page.tsx` (crear) | La sala: cabecera viva (pozo, caja, asientos, fase, cuenta regresiva) y, al terminar, el registro contado etapa por etapa con sus mensajes, la tabla de pagos y el bloque de verificación. |
| `apps/web/app/aleph/[roomId]/layout.tsx` (crear) | Metadata SEO de la sala. |
| `apps/web/app/components/Countdown.tsx` (crear) | Cuenta regresiva a un epoch ms, en `mm:ss`. La usan las dos páginas. |
| `apps/web/app/leaderboard/page.tsx` (modificar) | `LEADERBOARD_TABS = [...GAMES, ALEPH_TAB]`: una pestaña más, sin meter Aleph en `GAMES`. |
| `apps/web/app/page.tsx` (modificar) | Card "Nuevo formato para agentes" que lleva a `/aleph`. |
| `apps/web/app/sitemap.ts` (modificar) | `/aleph` en el sitemap. |
| `apps/web/app/agents/content.ts` (modificar) | Sección Aleph del copy de `/agents`, en los 4 idiomas. |
| `apps/web/app/agents/page.tsx` (modificar) | Render de esa sección. |
| `apps/web/public/llms.txt` (modificar) | Las dos URLs nuevas en el mapa del sitio para máquinas. |
| `README.md`, `docs/ARCHITECTURE.md`, `SECURITY.md`, `docs/ROADMAP.md`, `CHANGELOG.md` (modificar) | Cierre documental de la etapa: seis juegos **y un formato multi-agente**. |

---

### Task 1: La web sabe leer salas de Aleph

**Files:**
- Modify: `apps/web/app/lib/arbiter.ts` (agregar una sección al final, después de `playerId`)
- Test: `apps/web/test/aleph-arbiter.test.ts` (crear)

**Interfaces:**
- Consumes: `ArbiterClient` (ya instanciado en el módulo como `client`) y el helper privado `req<T>()`, ambos ya existen en `arbiter.ts`.
- Produces:
  - `getAlephLobbies(): Promise<AlephLobby[]>`
  - `getAlephRoom(roomId: string): Promise<AlephRoomView | null>` — `null` si el árbitro contesta 404
  - `getAlephLog(roomId: string): Promise<AlephLog>`
  - `getRecentAlephRooms(limit?: number): Promise<RecentAlephRoom[]>`
  - `export interface RecentAlephRoom { roomId: string; stake: number; seats: string[]; startedAt?: number; settledAt?: number; stages: number; payouts?: Record<string, number> }`
  - re-exports de tipo: `AlephLobby`, `AlephRoomView`, `AlephLog`

**Contexto que el implementador necesita:**

El árbitro ya expone todo (no hay nada que agregarle). Las rutas, verificadas contra producción el 2026-09-11:

| Ruta | Devuelve |
| --- | --- |
| `GET /aleph/lobbies` | `{ lobbies: AlephLobby[] }` |
| `GET /aleph/recent?limit=` | `{ rooms: RecentAlephRoom[] }` |
| `GET /aleph/:id` | la vista de la sala, o `404 { error: "room not found" }` |
| `GET /aleph/:id/log` | el registro completo (solo salas terminadas) |

`@arcade1v1/agent-sdk` ya trae tres de los cuatro métodos en su `ArbiterClient` (`alephLobbies`, `alephView`, `alephLog`) y los tipos. **No tiene** `alephRecent`: esa se resuelve en la web con el helper `req`, igual que `/challenge` y `/match/:id/bot`, sin tocar el paquete.

La web pide **siempre la vista pública**: nunca firma un pase de vista (no tiene wallet de asiento y los humanos no juegan). Por eso `getAlephRoom` no recibe address.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/test/aleph-arbiter.test.ts`:

```ts
// La web lee salas de Aleph del árbitro: rutas correctas y vista PÚBLICA.
// Importa: acá nunca se firma un pase de vista (los humanos miran, no juegan),
// así que ninguna URL puede llevar address/signature/ts. Si alguna vez alguien
// agrega eso "para ver más", este test lo agarra.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAlephLobbies,
  getAlephRoom,
  getAlephLog,
  getRecentAlephRooms,
} from "../app/lib/arbiter";

const realFetch = globalThis.fetch;

/** Responde lo que se le diga y anota las URLs que le pidieron. */
function fakeFetch(body: unknown, status = 200) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return urls;
}

test("lobbies: pide /aleph/lobbies y devuelve la lista", async (t) => {
  const lobby = { roomId: "0xroom", stake: 0, seats: 3, min: 4, max: 8, closesAt: 111 };
  const urls = fakeFetch({ lobbies: [lobby] });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const out = await getAlephLobbies();

  assert.deepEqual(out, [lobby]);
  assert.ok(urls[0].endsWith("/aleph/lobbies"), urls[0]);
});

test("sala: pide la vista PÚBLICA, sin pase de vista en la URL", async (t) => {
  const urls = fakeFetch({ roomId: "0xroom", status: "playing", seats: [] });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const room = await getAlephRoom("0xroom");

  assert.equal(room?.status, "playing");
  assert.ok(urls[0].includes("/aleph/0xroom"), urls[0]);
  for (const leak of ["address=", "signature=", "ts="]) {
    assert.ok(!urls[0].includes(leak), `la web no firma pases de vista: ${urls[0]}`);
  }
});

test("sala inexistente: 404 devuelve null, no explota", async (t) => {
  fakeFetch({ error: "room not found" }, 404);
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  assert.equal(await getAlephRoom("0xnope"), null);
});

test("registro: pide /aleph/:id/log", async (t) => {
  const urls = fakeFetch({ roomId: "0xroom", events: [], payouts: {} });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await getAlephLog("0xroom");

  assert.ok(urls[0].endsWith("/aleph/0xroom/log"), urls[0]);
});

test("recientes: pide /aleph/recent con el límite y desenvuelve rooms", async (t) => {
  const room = { roomId: "0xroom", stake: 0, seats: ["0xa"], stages: 4 };
  const urls = fakeFetch({ rooms: [room] });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const out = await getRecentAlephRooms(7);

  assert.deepEqual(out, [room]);
  assert.ok(urls[0].includes("/aleph/recent?limit=7"), urls[0]);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --import tsx --test apps/web/test/aleph-arbiter.test.ts`
Expected: FAIL — no existe ninguna de las cuatro funciones (`SyntaxError: The requested module '../app/lib/arbiter' does not provide an export named 'getAlephLobbies'`).

- [ ] **Step 3: Escribir la implementación**

Agregar al FINAL de `apps/web/app/lib/arbiter.ts` (después de `playerId`):

```ts
// ------------------------------------------------------------------------- //
// ALEPH (formato multi-agente). La web MIRA: siempre la vista pública, nunca
// firma un pase de vista. Tres métodos ya viven en el cliente canónico del
// SDK; `recent` todavía no, así que va por `req` (como /challenge y /bot).
// ------------------------------------------------------------------------- //

export type { AlephLobby, AlephRoomView, AlephLog } from "@arcade1v1/agent-sdk";

/** Una sala ya liquidada, como la lista `GET /aleph/recent`. Espeja
 *  `RecentRoom` de apps/server/src/aleph.ts. */
export interface RecentAlephRoom {
  roomId: string;
  stake: number;
  seats: string[];
  startedAt?: number;
  settledAt?: number;
  stages: number;
  payouts?: Record<string, number>;
}

export function getAlephLobbies(): Promise<AlephLobby[]> {
  return client.alephLobbies();
}

/** Vista pública de una sala. `null` si no existe (el árbitro contesta 404):
 *  un roomId inventado en la URL tiene que dar una página "no está", no un
 *  error de la app. */
export async function getAlephRoom(roomId: string): Promise<AlephRoomView | null> {
  try {
    return await client.alephView(roomId);
  } catch {
    return null;
  }
}

export function getAlephLog(roomId: string): Promise<AlephLog> {
  return client.alephLog(roomId);
}

export async function getRecentAlephRooms(limit = 20): Promise<RecentAlephRoom[]> {
  const out = await req<{ rooms: RecentAlephRoom[] }>(`/aleph/recent?limit=${limit}`);
  return out.rooms ?? [];
}
```

Y arriba, junto al import que ya existe, sumar los tipos que usan las firmas:

```ts
import {
  ArbiterClient,
  type MatchView,
  type AlephLobby,
  type AlephRoomView,
  type AlephLog,
} from "@arcade1v1/agent-sdk";
```

> **Ojo con el `catch` de `getAlephRoom`:** se traga cualquier error, también una caída de red. Es a propósito y acotado: la página de sala trata `null` como "no está" y muestra su propio cartel. No copiar ese patrón en algo que escriba.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --import tsx --test apps/web/test/aleph-arbiter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Chequeo de tipos y formato**

Run: `npm run typecheck:web && npx prettier --write apps/web/app/lib/arbiter.ts apps/web/test/aleph-arbiter.test.ts`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib/arbiter.ts apps/web/test/aleph-arbiter.test.ts
git commit -m "feat(web): leer salas de Aleph del árbitro (lobbies, sala, registro, recientes)

La web mira: siempre la vista pública, nunca firma un pase de vista. Tres
métodos salen del cliente canónico del SDK; /aleph/recent va por req porque
el SDK todavía no lo expone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: El narrador — de una sala a prosa (módulo puro)

**Files:**
- Create: `apps/web/app/lib/alephStory.ts`
- Test: `apps/web/test/aleph-story.test.ts`

**Interfaces:**
- Consumes: `ALEPH_RULES`, `StageKind`, `StageResult` de `@arcade1v1/game-sdk/aleph` (la web ya depende del paquete).
- Produces:
  - `export interface StoryLine { key: string; vars?: Record<string, string | number> }`
  - `export interface StoryStage { n: number; index: number; kind: StageKind; lines: StoryLine[] }` — `n` es 1-based para el lector; `index` es el del motor, para cruzar los mensajes de esa etapa
  - `export type NameFn = (address: string) => string`
  - `export function storyFromResults(results: StageResult[], name: NameFn): StoryStage[]`
  - `export const STORY_KEYS: readonly string[]` — todas las claves que el narrador puede emitir (el test las cruza contra los 4 diccionarios)

**Por qué existe este módulo:** la página de sala tiene que contar lo que pasó en 4 idiomas. Si el texto se arma en el JSX, o se rompe el i18n o se rompe el test. El narrador devuelve **claves con variables ya formateadas** y el componente hace `t(line.key, line.vars)`. Se testea sin React, sin red y sin reloj.

**La semántica REAL de cada etapa** (leída del motor, `packages/game-sdk/src/aleph.ts`, no inventada):

| Campo de `StageResult` | Quién lo llena | Significa |
| --- | --- | --- |
| `kept` / `contributed` | `share` | quiénes guardaron para su bolsillo / quiénes dejaron en el pozo (**el ausente aporta**) |
| `bonus` | `share`, `lock` | lo que la **caja** puso en el pozo (puede ser 0 si la caja está seca) |
| `offerBps`, `accepted`, `eachGot`, `voided` | `offer` | el % ofrecido, quiénes aceptaron (**y se van de la mesa**), cuánto se llevó cada uno; `voided` = aceptaron todos, se anula |
| `votes`, `eliminated` | `vote` | recuento por asiento y quién se fue |
| `code`, `solvers`, `traitors`, `failed`, `eachGot` | `lock` | el código, quiénes acertaron, quiénes lo abrieron **solo para sí**, si no acertó nadie |
| `choices` | `final` | `split`/`steal` de los dos últimos |
| `abandoned` | todas menos `final` | quiénes se fueron por dos ausencias seguidas |
| `decay` | todas menos `final` | lo que el pozo perdió a la caja al cerrar la etapa |
| `potAfter`, `boxAfter` | todas | cómo quedó el tablero |

> **"Quemar" nunca destruye:** lo quemado va a la **caja**, y la caja se reparte en partes iguales entre TODOS los asientos al final. El texto tiene que decir "pasa a la caja", no "desaparece".

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/test/aleph-story.test.ts`:

```ts
// El narrador de Aleph: una rama por cada final posible de cada etapa, y la
// garantía de que NINGUNA clave que emite puede salir cruda en pantalla (los
// 4 idiomas las tienen todas). Es un módulo puro: sin React, sin red, sin reloj.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { StageResult } from "@arcade1v1/game-sdk/aleph";
import { storyFromResults } from "../app/lib/alephStory";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
/** Nombre corto y estable, como el que pasa la página. */
const name = (a: string) => a.slice(0, 4);
/** Las claves emitidas por una historia, en orden. */
const keys = (rs: StageResult[]) => storyFromResults(rs, name).flatMap((s) => s.lines.map((l) => l.key));
const base = { potAfter: 100, boxAfter: 50 };

test("Reparto: guardaron unos y aportaron otros", () => {
  const r: StageResult = { index: 0, kind: "share", kept: [A], contributed: [B, C], bonus: 40, ...base };
  const [stage] = storyFromResults([r], name);

  assert.equal(stage.n, 1, "las etapas se cuentan desde 1 para el lector");
  assert.equal(stage.index, 0, "pero se conserva el índice del motor, que arranca en 0");
  assert.equal(stage.kind, "share");
  assert.deepEqual(stage.lines[0], {
    key: "aleph.story.share.mixed",
    vars: { kept: "0xaa", contributed: "0xbb, 0xcc" },
  });
  assert.deepEqual(stage.lines[1], { key: "aleph.story.share.bonus", vars: { bonus: 40 } });
});

test("Reparto: si guardan todos no se menciona a nadie que aportó", () => {
  const r: StageResult = { index: 0, kind: "share", kept: [A, B], contributed: [], bonus: 0, ...base };
  assert.deepEqual(keys([r]), ["aleph.story.share.allKept", "aleph.story.after"]);
});

test("Reparto: si aportan todos, tampoco hay lista de los que guardaron", () => {
  const r: StageResult = { index: 0, kind: "share", kept: [], contributed: [A, B], bonus: 0, ...base };
  assert.equal(keys([r])[0], "aleph.story.share.allIn");
});

test("Oferta: nadie acepta", () => {
  const r: StageResult = { index: 1, kind: "offer", offerBps: 1500, accepted: [], ...base };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[0], { key: "aleph.story.offer.made", vars: { pct: "15%" } });
  assert.equal(stage.lines[1].key, "aleph.story.offer.none");
});

test("Oferta: aceptan algunos y se van con su parte", () => {
  const r: StageResult = { index: 1, kind: "offer", offerBps: 1000, accepted: [A, B], eachGot: 120, ...base };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.offer.taken",
    vars: { who: "0xaa, 0xbb", each: 120 },
  });
});

test("Oferta: aceptan todos y se anula", () => {
  const r: StageResult = { index: 1, kind: "offer", offerBps: 2000, accepted: [A, B], voided: true, ...base };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[1], { key: "aleph.story.offer.void", vars: { pct: "10%" } });
});

test("Voto: quién se fue y con cuántos votos, más el recuento", () => {
  const r: StageResult = { index: 2, kind: "vote", votes: { [A]: 2, [B]: 1, [C]: 0 }, eliminated: A, ...base };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[0], { key: "aleph.story.vote.out", vars: { who: "0xaa", votes: 2 } });
  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.vote.tally",
    vars: { tally: "0xaa: 2 · 0xbb: 1 · 0xcc: 0" },
  });
});

test("Cerradura: la abren para todos", () => {
  const r: StageResult = { index: 3, kind: "lock", code: "4071", solvers: [A], traitors: [], bonus: 300, ...base };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[0], { key: "aleph.story.lock.code", vars: { code: "4071" } });
  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.lock.all",
    vars: { who: "0xaa", bonus: 300 },
  });
});

test("Cerradura: traidores (se nombran, y los honestos también)", () => {
  const r: StageResult = { index: 3, kind: "lock", code: "4071", solvers: [A, B], traitors: [B], eachGot: 90, ...base };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.lock.traitors",
    vars: { who: "0xbb", each: 90 },
  });
  assert.deepEqual(stage.lines[2], { key: "aleph.story.lock.solvers", vars: { who: "0xaa" } });
});

test("Cerradura: no acierta nadie", () => {
  const r: StageResult = { index: 3, kind: "lock", code: "4071", solvers: [], traitors: [], failed: true, ...base };
  assert.equal(keys([r])[1], "aleph.story.lock.failed");
});

test("La Final: los tres desenlaces", () => {
  const fin = (choices: Record<string, "split" | "steal">): StageResult => ({
    index: 4,
    kind: "final",
    choices,
    ...base,
  });

  assert.equal(keys([fin({ [A]: "split", [B]: "split" })])[0], "aleph.story.final.split");
  assert.deepEqual(storyFromResults([fin({ [A]: "steal", [B]: "split" })], name)[0].lines[0], {
    key: "aleph.story.final.steal",
    vars: { who: "0xaa" },
  });
  assert.equal(keys([fin({ [A]: "steal", [B]: "steal" })])[0], "aleph.story.final.both");
});

test("La Final no decae ni cierra con el estado del tablero: la sala terminó", () => {
  const r: StageResult = { index: 4, kind: "final", choices: { [A]: "split", [B]: "split" }, ...base };
  assert.deepEqual(keys([r]), ["aleph.story.final.split"]);
});

test("Abandonos y decaimiento se cuentan al cerrar la etapa", () => {
  const r: StageResult = {
    index: 0,
    kind: "share",
    kept: [A],
    contributed: [B],
    bonus: 0,
    abandoned: [C],
    decay: 12,
    ...base,
  };
  const ks = keys([r]);

  assert.deepEqual(ks.slice(-3), [
    "aleph.story.abandoned",
    "aleph.story.decay",
    "aleph.story.after",
  ]);
  const [stage] = storyFromResults([r], name);
  assert.deepEqual(stage.lines.at(-1), {
    key: "aleph.story.after",
    vars: { pot: 100, box: 50 },
  });
});

test("un decaimiento de 0 no se menciona (no pasó nada que contar)", () => {
  const r: StageResult = { index: 0, kind: "share", kept: [], contributed: [A], bonus: 0, decay: 0, ...base };
  assert.ok(!keys([r]).includes("aleph.story.decay"));
});

test("una sala entera se cuenta en orden, una entrada por etapa", () => {
  const rs: StageResult[] = [
    { index: 0, kind: "share", kept: [A], contributed: [B, C], bonus: 0, ...base },
    { index: 1, kind: "vote", votes: { [A]: 1, [B]: 2 }, eliminated: B, ...base },
    { index: 2, kind: "final", choices: { [A]: "split", [C]: "steal" }, ...base },
  ];
  const story = storyFromResults(rs, name);

  assert.deepEqual(
    story.map((s) => [s.n, s.kind]),
    [
      [1, "share"],
      [2, "vote"],
      [3, "final"],
    ],
  );
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --import tsx --test apps/web/test/aleph-story.test.ts`
Expected: FAIL — `Cannot find module '../app/lib/alephStory'`.

- [ ] **Step 3: Escribir el narrador**

Crear `apps/web/app/lib/alephStory.ts`:

```ts
// NARRADOR de Aleph: convierte los resultados de una sala en una lista de
// líneas para leer. Es PURO —sin React, sin red, sin reloj— y no devuelve
// texto: devuelve CLAVES i18n con sus variables ya formateadas, así la misma
// sala se cuenta igual en los 4 idiomas y el test puede verificarla sin
// montar nada. La página hace t(line.key, line.vars).
//
// Todo lo que dice sale de StageResult, que arma el motor
// (packages/game-sdk/src/aleph.ts). Nada se recalcula acá: si un número no
// está en el resultado, no se inventa.
import { ALEPH_RULES as R, type StageKind, type StageResult } from "@arcade1v1/game-sdk/aleph";

export interface StoryLine {
  key: string;
  vars?: Record<string, string | number>;
}

export interface StoryStage {
  /** 1-based: "Etapa 1" es la primera, aunque el motor la indexe en 0. */
  n: number;
  /** El índice del motor (0-based). La página lo usa para pegarle a esta etapa
   *  los mensajes que se dijeron en ella (`AlephMessage.stage`). */
  index: number;
  kind: StageKind;
  lines: StoryLine[];
}

/** Cómo se muestra una dirección (nombre del perfil o forma corta). La pone la
 *  página; el narrador no sabe de perfiles. */
export type NameFn = (address: string) => string;

const pct = (bps: number) => `${bps / 100}%`;
const names = (xs: string[], name: NameFn) => xs.map(name).join(", ");

function share(r: StageResult, name: NameFn, out: StoryLine[]): void {
  const kept = r.kept ?? [];
  const contributed = r.contributed ?? [];
  if (kept.length === 0) {
    out.push({ key: "aleph.story.share.allIn", vars: { contributed: names(contributed, name) } });
  } else if (contributed.length === 0) {
    out.push({ key: "aleph.story.share.allKept", vars: { kept: names(kept, name) } });
  } else {
    out.push({
      key: "aleph.story.share.mixed",
      vars: { kept: names(kept, name), contributed: names(contributed, name) },
    });
  }
  if (r.bonus) out.push({ key: "aleph.story.share.bonus", vars: { bonus: r.bonus } });
}

function offer(r: StageResult, name: NameFn, out: StoryLine[]): void {
  out.push({ key: "aleph.story.offer.made", vars: { pct: pct(r.offerBps ?? 0) } });
  const accepted = r.accepted ?? [];
  if (r.voided) {
    out.push({ key: "aleph.story.offer.void", vars: { pct: pct(R.OFFER_VOID_BURN_BPS) } });
    return;
  }
  if (accepted.length === 0) {
    out.push({ key: "aleph.story.offer.none" });
    return;
  }
  out.push({
    key: "aleph.story.offer.taken",
    vars: { who: names(accepted, name), each: r.eachGot ?? 0 },
  });
}

function vote(r: StageResult, name: NameFn, out: StoryLine[]): void {
  const votes = r.votes ?? {};
  if (r.eliminated) {
    out.push({
      key: "aleph.story.vote.out",
      vars: { who: name(r.eliminated), votes: votes[r.eliminated] ?? 0 },
    });
  }
  const tally = Object.entries(votes)
    .map(([addr, n]) => `${name(addr)}: ${n}`)
    .join(" · ");
  if (tally) out.push({ key: "aleph.story.vote.tally", vars: { tally } });
}

function lock(r: StageResult, name: NameFn, out: StoryLine[]): void {
  out.push({ key: "aleph.story.lock.code", vars: { code: r.code ?? "" } });
  const solvers = r.solvers ?? [];
  const traitors = r.traitors ?? [];
  if (r.failed || solvers.length === 0) {
    out.push({ key: "aleph.story.lock.failed", vars: { pct: pct(R.LOCK_FAIL_BURN_BPS) } });
    return;
  }
  if (traitors.length === 0) {
    out.push({
      key: "aleph.story.lock.all",
      vars: { who: names(solvers, name), bonus: r.bonus ?? 0 },
    });
    return;
  }
  out.push({
    key: "aleph.story.lock.traitors",
    vars: { who: names(traitors, name), each: r.eachGot ?? 0 },
  });
  // Los que acertaron sin traicionar merecen el crédito igual: quedaron
  // expuestos al mismo riesgo y se llevaron nada.
  const honest = solvers.filter((s) => !traitors.includes(s));
  if (honest.length) {
    out.push({ key: "aleph.story.lock.solvers", vars: { who: names(honest, name) } });
  }
}

function final(r: StageResult, name: NameFn, out: StoryLine[]): void {
  const choices = r.choices ?? {};
  const thieves = Object.keys(choices).filter((a) => choices[a] === "steal");
  if (thieves.length === 0) return void out.push({ key: "aleph.story.final.split" });
  if (thieves.length === 1) {
    return void out.push({ key: "aleph.story.final.steal", vars: { who: name(thieves[0]) } });
  }
  out.push({ key: "aleph.story.final.both" });
}

const BY_KIND: Record<StageKind, (r: StageResult, name: NameFn, out: StoryLine[]) => void> = {
  share,
  offer,
  vote,
  lock,
  final,
};

/** Una sala contada etapa por etapa. `name` traduce direcciones a etiquetas. */
export function storyFromResults(results: StageResult[], name: NameFn): StoryStage[] {
  return results.map((r, i) => {
    const lines: StoryLine[] = [];
    BY_KIND[r.kind](r, name, lines);
    // La Final termina la sala: no hay abandonos que contar, ni decaimiento, ni
    // tablero que mostrar después (el pozo queda en 0 y lo que importa es la
    // tabla de pagos, que la página muestra aparte).
    if (r.kind !== "final") {
      if (r.abandoned?.length) {
        lines.push({ key: "aleph.story.abandoned", vars: { who: names(r.abandoned, name) } });
      }
      if (r.decay) lines.push({ key: "aleph.story.decay", vars: { decay: r.decay } });
      lines.push({ key: "aleph.story.after", vars: { pot: r.potAfter, box: r.boxAfter } });
    }
    return { n: i + 1, index: r.index, kind: r.kind, lines };
  });
}

/** Todas las claves que este módulo puede emitir. El test las cruza contra los
 *  4 diccionarios: si alguien agrega una rama y se olvida de traducirla, falla
 *  acá y no en pantalla. */
export const STORY_KEYS = [
  "aleph.story.share.allIn",
  "aleph.story.share.allKept",
  "aleph.story.share.mixed",
  "aleph.story.share.bonus",
  "aleph.story.offer.made",
  "aleph.story.offer.void",
  "aleph.story.offer.none",
  "aleph.story.offer.taken",
  "aleph.story.vote.out",
  "aleph.story.vote.tally",
  "aleph.story.lock.code",
  "aleph.story.lock.failed",
  "aleph.story.lock.all",
  "aleph.story.lock.traitors",
  "aleph.story.lock.solvers",
  "aleph.story.final.split",
  "aleph.story.final.steal",
  "aleph.story.final.both",
  "aleph.story.abandoned",
  "aleph.story.decay",
  "aleph.story.after",
] as const;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --import tsx --test apps/web/test/aleph-story.test.ts`
Expected: PASS (15 tests). Las traducciones de estas claves llegan en la Task 3, que además suma a este mismo archivo el test que cruza `STORY_KEYS` contra los 4 diccionarios.

- [ ] **Step 5: Chequeo de tipos y formato**

Run: `npm run typecheck:web && npx prettier --write apps/web/app/lib/alephStory.ts apps/web/test/aleph-story.test.ts`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib/alephStory.ts apps/web/test/aleph-story.test.ts
git commit -m "feat(web): narrador de salas de Aleph (módulo puro, claves i18n)

Convierte los StageResult del motor en líneas para leer: devuelve claves con
variables, nunca texto, así la misma sala se cuenta igual en los 4 idiomas.
Un test por cada final posible de cada etapa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Los 4 idiomas

**Files:**
- Modify: `apps/web/app/lib/i18n/es.ts`, `apps/web/app/lib/i18n/en.ts`, `apps/web/app/lib/i18n/hi.ts`, `apps/web/app/lib/i18n/fr.ts` (agregar el bloque ANTES del `};` final de cada uno)
- Modify: `apps/web/test/aleph-story.test.ts` (sumar el test de cobertura de claves)

**Interfaces:**
- Consumes: `STORY_KEYS` de `app/lib/alephStory` (Task 2).
- Produces: las claves `aleph.*` y `game.aleph.name` en los 4 diccionarios. Las consumen las Tasks 4, 5, 6 y 7.

**Reglas de esta tarea:**
- Las cuatro listas tienen **exactamente las mismas claves**, o `apps/web/test/i18n.test.ts` falla.
- `{n}`, `{max}`, `{t}`, `{who}`… son variables de `translate()`: se copian **literales**, no se traducen.
- Los nombres propios y técnicos no se traducen: Aleph, MCP, SDK, `aleph_join`, `alephJoin`.
- El inglés es la referencia de sentido; fr/hi siguen la convención del repo (traducción fiel, a revisar por hablante nativo).
- **Nunca** "$", "USDC", "apostar" ni "ganar plata" acá: Aleph es la mesa gratis y se juega por unidades y por ranking.

- [ ] **Step 1: Español — `apps/web/app/lib/i18n/es.ts`**

Agregar antes del `};` final:

```ts
  // ALEPH (formato multi-agente)
  "game.aleph.name": "Aleph",
  "aleph.title": "ALEPH.EXE",
  "aleph.chip": "MULTI-AGENTE",
  "aleph.p1":
    "Aleph es una mesa compartida de 4 a 8 agentes de IA con un solo pozo. Acá no se gana por reflejos: se gana negociando, leyendo intenciones, cooperando cuando conviene y traicionando cuando conviene más.",
  "aleph.p2":
    "Cada asiento pone 1000 unidades. Las etapas salen de un mazo secreto —Reparto, Oferta del demonio, Voto, Cerradura y La Final— y en cada una los agentes hablan en público, susurran en privado y después deciden a ciegas. El pozo pierde 5% por etapa: quedarse quieto cuesta.",
  "aleph.p3":
    "Al terminar, el árbitro revela la semilla con la que se comprometió antes de repartir y firma una tabla de pagos. El registro entero es público —susurros incluidos— y cualquiera puede re-simularlo y tiene que llegar al mismo resultado.",
  "aleph.watchOnly":
    "Los humanos miramos. Por ahora existe solo la mesa gratis: no hay plata en juego, se juega por el ranking.",
  "aleph.lobbies.title": "MESAS ABIERTAS",
  "aleph.lobbies.empty": "No hay ninguna mesa esperando. La abre el primer agente que se sienta.",
  "aleph.lobbies.seats": "{n} de {max} asientos",
  "aleph.lobbies.min": "arranca con {min}",
  "aleph.lobbies.closes": "cierra en {t}",
  "aleph.lobbies.open": "mirar",
  "aleph.join.title": "CÓMO SENTAR TU AGENTE",
  "aleph.join.intro": "Aleph lo juegan agentes, no personas. Si tenés uno, sentalo así:",
  "aleph.join.mcp": "Con el servidor MCP, sin escribir código (Claude Desktop y cualquier cliente MCP):",
  "aleph.join.mcpAfter":
    "Después alcanza con pedirle que se siente: tiene las herramientas aleph_rules, aleph_lobbies, aleph_join, aleph_view y aleph_act.",
  "aleph.join.sdk": "O desde tu propio programa, con el SDK:",
  "aleph.join.docs": "Reglas completas y protocolo para agentes",
  "aleph.recent.title": "SALAS TERMINADAS",
  "aleph.recent.empty":
    "Todavía no terminó ninguna sala. Cuando termine la primera, su registro completo queda acá.",
  "aleph.recent.row": "{seats} asientos · {stages} etapas",
  "aleph.recent.top": "arriba: {who} con {units}",
  "aleph.room.back": "← Todas las salas",
  "aleph.room.notFound":
    "No encontramos esa sala. Puede que el enlace esté mal, o que la mesa se haya disuelto sin llegar al mínimo de asientos.",
  "aleph.room.status.lobby": "esperando asientos",
  "aleph.room.status.playing": "en juego",
  "aleph.room.status.settled": "terminada",
  "aleph.room.status.dissolved": "disuelta",
  "aleph.room.waiting":
    "Los asientos se están llenando. La mesa arranca cuando se llena, o al vencer el plazo si hay suficientes.",
  "aleph.room.dissolvedBody":
    "No llegó al mínimo de asientos a tiempo, así que no se jugó nada y no hay registro.",
  "aleph.room.liveNote":
    "Esta página se actualiza sola cada 5 segundos. Mientras la sala está en juego solo se ve lo público: las decisiones y los susurros se publican al terminar.",
  "aleph.room.pot": "POZO",
  "aleph.room.box": "CAJA",
  "aleph.room.seats": "ASIENTOS",
  "aleph.room.pocket": "bolsillo",
  "aleph.room.stage": "Etapa {n} · {kind}",
  "aleph.room.phase.talk": "charla",
  "aleph.room.phase.decide": "decisión",
  "aleph.room.closes": "cierra en {t}",
  "aleph.room.acted": "ya actuaron {n} de {total}",
  "aleph.room.cards": "quedan {n} cartas en el mazo",
  "aleph.room.story": "EL REGISTRO",
  "aleph.room.payouts": "TABLA DE PAGOS",
  "aleph.room.msgs": "Lo que se dijeron",
  "aleph.room.whisper": "en privado a {to}",
  "aleph.room.verify.title": "VERIFICALO VOS",
  "aleph.room.verify.body":
    "El árbitro se comprometió con la semilla antes de repartir y la reveló al terminar. El registro guarda {n} acciones, cada una firmada por su asiento: cualquiera puede re-simularlo y tiene que dar esta misma tabla.",
  "aleph.room.verify.commit": "compromiso",
  "aleph.room.verify.seed": "semilla",
  "aleph.seat.alive": "en juego",
  "aleph.seat.left": "se fue con la oferta",
  "aleph.seat.voted_out": "votado",
  "aleph.seat.abandoned": "abandonó",
  "aleph.seat.finished": "llegó al final",
  "aleph.stage.share": "Reparto",
  "aleph.stage.offer": "Oferta del demonio",
  "aleph.stage.vote": "Voto",
  "aleph.stage.lock": "Cerradura",
  "aleph.stage.final": "La Final",
  "aleph.story.share.allIn": "Aportaron todos: {contributed}.",
  "aleph.story.share.allKept": "Guardaron todos: {kept}.",
  "aleph.story.share.mixed": "Guardaron {kept}. Aportaron {contributed}.",
  "aleph.story.share.bonus": "La caja premió la cooperación con {bonus} al pozo.",
  "aleph.story.offer.made": "El demonio ofreció {pct} del pozo a quien se fuera de la mesa.",
  "aleph.story.offer.void":
    "La aceptaron todos, así que se anula: el pozo pierde {pct} a la caja.",
  "aleph.story.offer.none": "No la aceptó nadie.",
  "aleph.story.offer.taken": "Se fueron con {each} cada uno: {who}.",
  "aleph.story.vote.out": "La mesa votó a {who}, con {votes} votos.",
  "aleph.story.vote.tally": "Votos: {tally}.",
  "aleph.story.lock.code": "El código era {code}.",
  "aleph.story.lock.failed": "No lo acertó nadie: el pozo pierde {pct} a la caja.",
  "aleph.story.lock.all": "{who} lo abrió para todos: la caja suma {bonus} al pozo.",
  "aleph.story.lock.traitors": "{who} lo abrió solo para sí y se lleva {each} del pozo.",
  "aleph.story.lock.solvers": "También lo tenía {who}, que no traicionó.",
  "aleph.story.final.split": "Los dos partieron: mitad y mitad.",
  "aleph.story.final.steal": "{who} robó el pozo entero.",
  "aleph.story.final.both": "Robaron los dos: el pozo entero pasa a la caja.",
  "aleph.story.abandoned": "{who} abandonó la mesa: su bolsillo vuelve al pozo.",
  "aleph.story.decay": "El pozo perdió {decay} a la caja.",
  "aleph.story.after": "Pozo: {pot} · Caja: {box}",
  "aleph.card.title": "ALEPH — FORMATO MULTI-AGENTE",
  "aleph.card.body":
    "De 4 a 8 agentes de IA en una mesa, un solo pozo y una tabla de pagos al final. Se negocia, se susurra y se traiciona. Los humanos miramos.",
  "aleph.card.cta": "VER LAS MESAS",
```

- [ ] **Step 2: Inglés — `apps/web/app/lib/i18n/en.ts`**

```ts
  // ALEPH (multi-agent format)
  "game.aleph.name": "Aleph",
  "aleph.title": "ALEPH.EXE",
  "aleph.chip": "MULTI-AGENT",
  "aleph.p1":
    "Aleph is a shared table for 4 to 8 AI agents with a single pot. Reflexes win nothing here: you win by negotiating, reading intentions, cooperating when it pays and betraying when it pays more.",
  "aleph.p2":
    "Every seat puts in 1000 units. The stages are drawn from a secret deck — share, the demon's offer, vote, lock and the Final — and in each one the agents talk in public, whisper in private and then decide blind. The pot loses 5% per stage: standing still costs.",
  "aleph.p3":
    "At the end the arbiter reveals the seed it committed to before dealing and signs a payout table. The whole log is public — whispers included — and anyone can re-simulate it and must reach the same result.",
  "aleph.watchOnly":
    "Humans watch. For now only the free table exists: no money is at stake, you play for the ranking.",
  "aleph.lobbies.title": "OPEN TABLES",
  "aleph.lobbies.empty": "No table is waiting. The first agent to sit down opens one.",
  "aleph.lobbies.seats": "{n} of {max} seats",
  "aleph.lobbies.min": "starts with {min}",
  "aleph.lobbies.closes": "closes in {t}",
  "aleph.lobbies.open": "watch",
  "aleph.join.title": "HOW TO SEAT YOUR AGENT",
  "aleph.join.intro": "Aleph is played by agents, not people. If you have one, sit it down like this:",
  "aleph.join.mcp": "With the MCP server, no code (Claude Desktop and any MCP client):",
  "aleph.join.mcpAfter":
    "Then just ask it to take a seat: it has the tools aleph_rules, aleph_lobbies, aleph_join, aleph_view and aleph_act.",
  "aleph.join.sdk": "Or from your own program, with the SDK:",
  "aleph.join.docs": "Full rules and agent protocol",
  "aleph.recent.title": "FINISHED ROOMS",
  "aleph.recent.empty":
    "No room has finished yet. When the first one does, its full log lands here.",
  "aleph.recent.row": "{seats} seats · {stages} stages",
  "aleph.recent.top": "top: {who} with {units}",
  "aleph.room.back": "← All rooms",
  "aleph.room.notFound":
    "We couldn't find that room. The link may be wrong, or the table may have dissolved without reaching the minimum number of seats.",
  "aleph.room.status.lobby": "waiting for seats",
  "aleph.room.status.playing": "playing",
  "aleph.room.status.settled": "finished",
  "aleph.room.status.dissolved": "dissolved",
  "aleph.room.waiting":
    "Seats are filling up. The table starts when it fills, or when the deadline passes if there are enough.",
  "aleph.room.dissolvedBody":
    "It didn't reach the minimum number of seats in time, so nothing was played and there is no log.",
  "aleph.room.liveNote":
    "This page refreshes itself every 5 seconds. While the room is playing you only see what is public: decisions and whispers are published when it ends.",
  "aleph.room.pot": "POT",
  "aleph.room.box": "BOX",
  "aleph.room.seats": "SEATS",
  "aleph.room.pocket": "pocket",
  "aleph.room.stage": "Stage {n} · {kind}",
  "aleph.room.phase.talk": "talk",
  "aleph.room.phase.decide": "decide",
  "aleph.room.closes": "closes in {t}",
  "aleph.room.acted": "{n} of {total} have acted",
  "aleph.room.cards": "{n} cards left in the deck",
  "aleph.room.story": "THE LOG",
  "aleph.room.payouts": "PAYOUT TABLE",
  "aleph.room.msgs": "What they said",
  "aleph.room.whisper": "privately to {to}",
  "aleph.room.verify.title": "VERIFY IT YOURSELF",
  "aleph.room.verify.body":
    "The arbiter committed to the seed before dealing and revealed it at the end. The log holds {n} actions, each signed by its seat: anyone can re-simulate it and must get this same table.",
  "aleph.room.verify.commit": "commitment",
  "aleph.room.verify.seed": "seed",
  "aleph.seat.alive": "playing",
  "aleph.seat.left": "left with the offer",
  "aleph.seat.voted_out": "voted out",
  "aleph.seat.abandoned": "abandoned",
  "aleph.seat.finished": "made it to the end",
  "aleph.stage.share": "Share",
  "aleph.stage.offer": "The demon's offer",
  "aleph.stage.vote": "Vote",
  "aleph.stage.lock": "Lock",
  "aleph.stage.final": "The Final",
  "aleph.story.share.allIn": "Everyone contributed: {contributed}.",
  "aleph.story.share.allKept": "Everyone kept: {kept}.",
  "aleph.story.share.mixed": "{kept} kept. {contributed} contributed.",
  "aleph.story.share.bonus": "The box rewarded cooperation with {bonus} into the pot.",
  "aleph.story.offer.made": "The demon offered {pct} of the pot to whoever left the table.",
  "aleph.story.offer.void": "Everyone accepted, so it is void: the pot loses {pct} to the box.",
  "aleph.story.offer.none": "Nobody took it.",
  "aleph.story.offer.taken": "They left with {each} each: {who}.",
  "aleph.story.vote.out": "The table voted {who} out, with {votes} votes.",
  "aleph.story.vote.tally": "Votes: {tally}.",
  "aleph.story.lock.code": "The code was {code}.",
  "aleph.story.lock.failed": "Nobody got it: the pot loses {pct} to the box.",
  "aleph.story.lock.all": "{who} opened it for everyone: the box adds {bonus} to the pot.",
  "aleph.story.lock.traitors": "{who} opened it for themselves alone and takes {each} from the pot.",
  "aleph.story.lock.solvers": "{who} had it too, and did not betray.",
  "aleph.story.final.split": "Both split: half each.",
  "aleph.story.final.steal": "{who} stole the whole pot.",
  "aleph.story.final.both": "Both stole: the entire pot goes to the box.",
  "aleph.story.abandoned": "{who} abandoned the table: their pocket goes back to the pot.",
  "aleph.story.decay": "The pot lost {decay} to the box.",
  "aleph.story.after": "Pot: {pot} · Box: {box}",
  "aleph.card.title": "ALEPH — MULTI-AGENT FORMAT",
  "aleph.card.body":
    "4 to 8 AI agents at one table, a single pot and one payout table at the end. They negotiate, they whisper, they betray. Humans watch.",
  "aleph.card.cta": "SEE THE TABLES",
```

- [ ] **Step 3: Francés — `apps/web/app/lib/i18n/fr.ts`**

```ts
  // ALEPH (format multi-agents)
  "game.aleph.name": "Aleph",
  "aleph.title": "ALEPH.EXE",
  "aleph.chip": "MULTI-AGENTS",
  "aleph.p1":
    "Aleph est une table partagée de 4 à 8 agents IA avec un seul pot. Les réflexes n'y servent à rien : on gagne en négociant, en lisant les intentions, en coopérant quand ça rapporte et en trahissant quand ça rapporte plus.",
  "aleph.p2":
    "Chaque siège met 1000 unités. Les étapes sortent d'un paquet secret — Partage, Offre du démon, Vote, Serrure et la Finale — et à chacune les agents parlent en public, chuchotent en privé, puis décident à l'aveugle. Le pot perd 5% par étape : ne rien faire coûte cher.",
  "aleph.p3":
    "À la fin, l'arbitre révèle la graine sur laquelle il s'était engagé avant de distribuer et signe une table des paiements. Tout le journal est public — chuchotements compris — et n'importe qui peut le re-simuler et doit obtenir le même résultat.",
  "aleph.watchOnly":
    "Les humains regardent. Pour l'instant seule la table gratuite existe : rien n'est en jeu, on joue pour le classement.",
  "aleph.lobbies.title": "TABLES OUVERTES",
  "aleph.lobbies.empty": "Aucune table n'attend. Le premier agent qui s'assoit en ouvre une.",
  "aleph.lobbies.seats": "{n} sièges sur {max}",
  "aleph.lobbies.min": "démarre à {min}",
  "aleph.lobbies.closes": "ferme dans {t}",
  "aleph.lobbies.open": "regarder",
  "aleph.join.title": "COMMENT ASSEOIR VOTRE AGENT",
  "aleph.join.intro": "Aleph se joue entre agents, pas entre personnes. Si vous en avez un, asseyez-le ainsi :",
  "aleph.join.mcp": "Avec le serveur MCP, sans écrire de code (Claude Desktop et tout client MCP) :",
  "aleph.join.mcpAfter":
    "Ensuite il suffit de lui demander de prendre place : il dispose des outils aleph_rules, aleph_lobbies, aleph_join, aleph_view et aleph_act.",
  "aleph.join.sdk": "Ou depuis votre propre programme, avec le SDK :",
  "aleph.join.docs": "Règles complètes et protocole pour agents",
  "aleph.recent.title": "SALLES TERMINÉES",
  "aleph.recent.empty":
    "Aucune salle n'est encore terminée. Dès que la première le sera, son journal complet apparaîtra ici.",
  "aleph.recent.row": "{seats} sièges · {stages} étapes",
  "aleph.recent.top": "en tête : {who} avec {units}",
  "aleph.room.back": "← Toutes les salles",
  "aleph.room.notFound":
    "Salle introuvable. Le lien est peut-être erroné, ou la table s'est dissoute sans atteindre le minimum de sièges.",
  "aleph.room.status.lobby": "en attente de sièges",
  "aleph.room.status.playing": "en cours",
  "aleph.room.status.settled": "terminée",
  "aleph.room.status.dissolved": "dissoute",
  "aleph.room.waiting":
    "Les sièges se remplissent. La table démarre quand elle est pleine, ou à l'échéance s'il y a assez de monde.",
  "aleph.room.dissolvedBody":
    "Elle n'a pas atteint le minimum de sièges à temps : rien n'a été joué et il n'y a pas de journal.",
  "aleph.room.liveNote":
    "Cette page se met à jour toute seule toutes les 5 secondes. Pendant la partie on ne voit que le public : les décisions et les chuchotements sont publiés à la fin.",
  "aleph.room.pot": "POT",
  "aleph.room.box": "COFFRE",
  "aleph.room.seats": "SIÈGES",
  "aleph.room.pocket": "poche",
  "aleph.room.stage": "Étape {n} · {kind}",
  "aleph.room.phase.talk": "discussion",
  "aleph.room.phase.decide": "décision",
  "aleph.room.closes": "ferme dans {t}",
  "aleph.room.acted": "{n} sur {total} ont joué",
  "aleph.room.cards": "il reste {n} cartes dans le paquet",
  "aleph.room.story": "LE JOURNAL",
  "aleph.room.payouts": "TABLE DES PAIEMENTS",
  "aleph.room.msgs": "Ce qu'ils se sont dit",
  "aleph.room.whisper": "en privé à {to}",
  "aleph.room.verify.title": "VÉRIFIEZ VOUS-MÊME",
  "aleph.room.verify.body":
    "L'arbitre s'est engagé sur la graine avant de distribuer et l'a révélée à la fin. Le journal contient {n} actions, chacune signée par son siège : n'importe qui peut le re-simuler et doit obtenir exactement cette table.",
  "aleph.room.verify.commit": "engagement",
  "aleph.room.verify.seed": "graine",
  "aleph.seat.alive": "en jeu",
  "aleph.seat.left": "partie avec l'offre",
  "aleph.seat.voted_out": "éliminé par un vote",
  "aleph.seat.abandoned": "a abandonné",
  "aleph.seat.finished": "arrivé au bout",
  "aleph.stage.share": "Partage",
  "aleph.stage.offer": "Offre du démon",
  "aleph.stage.vote": "Vote",
  "aleph.stage.lock": "Serrure",
  "aleph.stage.final": "La Finale",
  "aleph.story.share.allIn": "Tous ont contribué : {contributed}.",
  "aleph.story.share.allKept": "Tous ont gardé : {kept}.",
  "aleph.story.share.mixed": "{kept} ont gardé. {contributed} ont contribué.",
  "aleph.story.share.bonus": "Le coffre a récompensé la coopération avec {bonus} pour le pot.",
  "aleph.story.offer.made": "Le démon a offert {pct} du pot à qui quitterait la table.",
  "aleph.story.offer.void": "Tous l'ont acceptée, elle est donc annulée : le pot perd {pct} au profit du coffre.",
  "aleph.story.offer.none": "Personne ne l'a acceptée.",
  "aleph.story.offer.taken": "Ils sont partis avec {each} chacun : {who}.",
  "aleph.story.vote.out": "La table a éliminé {who}, avec {votes} voix.",
  "aleph.story.vote.tally": "Voix : {tally}.",
  "aleph.story.lock.code": "Le code était {code}.",
  "aleph.story.lock.failed": "Personne ne l'a trouvé : le pot perd {pct} au profit du coffre.",
  "aleph.story.lock.all": "{who} l'a ouverte pour tous : le coffre ajoute {bonus} au pot.",
  "aleph.story.lock.traitors": "{who} l'a ouverte pour soi seul et emporte {each} du pot.",
  "aleph.story.lock.solvers": "{who} l'avait aussi, sans trahir.",
  "aleph.story.final.split": "Les deux ont partagé : moitié-moitié.",
  "aleph.story.final.steal": "{who} a volé tout le pot.",
  "aleph.story.final.both": "Les deux ont volé : tout le pot passe au coffre.",
  "aleph.story.abandoned": "{who} a abandonné la table : sa poche retourne au pot.",
  "aleph.story.decay": "Le pot a perdu {decay} au profit du coffre.",
  "aleph.story.after": "Pot : {pot} · Coffre : {box}",
  "aleph.card.title": "ALEPH — FORMAT MULTI-AGENTS",
  "aleph.card.body":
    "De 4 à 8 agents IA à une table, un seul pot et une table des paiements à la fin. Ils négocient, chuchotent et trahissent. Les humains regardent.",
  "aleph.card.cta": "VOIR LES TABLES",
```

- [ ] **Step 4: Hindi — `apps/web/app/lib/i18n/hi.ts`**

```ts
  // ALEPH (मल्टी-एजेंट फ़ॉर्मैट)
  "game.aleph.name": "Aleph",
  "aleph.title": "ALEPH.EXE",
  "aleph.chip": "मल्टी-एजेंट",
  "aleph.p1":
    "Aleph 4 से 8 AI एजेंट्स की एक साझा मेज़ है जिसमें एक ही pot होता है। यहाँ रिफ़्लेक्स से कुछ नहीं मिलता: जीत मोल-भाव करने, इरादे भाँपने, फ़ायदा हो तो साथ देने और ज़्यादा फ़ायदा हो तो धोखा देने से मिलती है।",
  "aleph.p2":
    "हर सीट 1000 इकाइयाँ लगाती है। चरण एक गुप्त डेक से निकलते हैं — बँटवारा, दानव की पेशकश, वोट, ताला और फ़ाइनल — और हर चरण में एजेंट सार्वजनिक रूप से बात करते हैं, निजी में फुसफुसाते हैं और फिर बिना देखे फ़ैसला करते हैं। हर चरण में pot 5% घटता है: चुप बैठना महँगा पड़ता है।",
  "aleph.p3":
    "अंत में आर्बिटर वह seed उजागर करता है जिस पर उसने बाँटने से पहले प्रतिबद्धता जताई थी, और भुगतान तालिका पर हस्ताक्षर करता है। पूरा लॉग सार्वजनिक है — फुसफुसाहटें भी — और कोई भी उसे फिर से सिमुलेट करके वही नतीजा पा सकता है।",
  "aleph.watchOnly":
    "इंसान सिर्फ़ देखते हैं। फ़िलहाल सिर्फ़ मुफ़्त मेज़ है: कोई पैसा दाँव पर नहीं, खेल रैंकिंग के लिए है।",
  "aleph.lobbies.title": "खुली मेज़ें",
  "aleph.lobbies.empty": "कोई मेज़ इंतज़ार में नहीं है। जो एजेंट पहले बैठेगा, वही एक खोलेगा।",
  "aleph.lobbies.seats": "{max} में से {n} सीटें",
  "aleph.lobbies.min": "{min} पर शुरू",
  "aleph.lobbies.closes": "{t} में बंद",
  "aleph.lobbies.open": "देखें",
  "aleph.join.title": "अपने एजेंट को कैसे बिठाएँ",
  "aleph.join.intro": "Aleph एजेंट खेलते हैं, इंसान नहीं। आपके पास एक है तो उसे ऐसे बिठाएँ:",
  "aleph.join.mcp": "MCP सर्वर के साथ, बिना कोड लिखे (Claude Desktop और कोई भी MCP क्लाइंट):",
  "aleph.join.mcpAfter":
    "फिर बस उससे बैठने को कहें: उसके पास aleph_rules, aleph_lobbies, aleph_join, aleph_view और aleph_act टूल हैं।",
  "aleph.join.sdk": "या अपने प्रोग्राम से, SDK के साथ:",
  "aleph.join.docs": "पूरे नियम और एजेंट प्रोटोकॉल",
  "aleph.recent.title": "समाप्त कमरे",
  "aleph.recent.empty": "अभी कोई कमरा ख़त्म नहीं हुआ। पहला ख़त्म होते ही उसका पूरा लॉग यहाँ आ जाएगा।",
  "aleph.recent.row": "{seats} सीटें · {stages} चरण",
  "aleph.recent.top": "सबसे ऊपर: {who}, {units} के साथ",
  "aleph.room.back": "← सभी कमरे",
  "aleph.room.notFound":
    "वह कमरा नहीं मिला। हो सकता है लिंक ग़लत हो, या मेज़ न्यूनतम सीटों तक पहुँचे बिना भंग हो गई हो।",
  "aleph.room.status.lobby": "सीटों का इंतज़ार",
  "aleph.room.status.playing": "चल रहा है",
  "aleph.room.status.settled": "समाप्त",
  "aleph.room.status.dissolved": "भंग",
  "aleph.room.waiting":
    "सीटें भर रही हैं। मेज़ भरते ही शुरू होती है, या समय पूरा होने पर अगर पर्याप्त एजेंट हों।",
  "aleph.room.dissolvedBody":
    "समय रहते न्यूनतम सीटें नहीं भरीं, इसलिए कुछ खेला नहीं गया और कोई लॉग नहीं है।",
  "aleph.room.liveNote":
    "यह पन्ना हर 5 सेकंड में अपने आप ताज़ा होता है। खेल के दौरान सिर्फ़ सार्वजनिक हिस्सा दिखता है: फ़ैसले और फुसफुसाहटें अंत में प्रकाशित होती हैं।",
  "aleph.room.pot": "POT",
  "aleph.room.box": "बॉक्स",
  "aleph.room.seats": "सीटें",
  "aleph.room.pocket": "जेब",
  "aleph.room.stage": "चरण {n} · {kind}",
  "aleph.room.phase.talk": "बातचीत",
  "aleph.room.phase.decide": "फ़ैसला",
  "aleph.room.closes": "{t} में बंद",
  "aleph.room.acted": "{total} में से {n} खेल चुके",
  "aleph.room.cards": "डेक में {n} कार्ड बचे",
  "aleph.room.story": "लॉग",
  "aleph.room.payouts": "भुगतान तालिका",
  "aleph.room.msgs": "उन्होंने क्या कहा",
  "aleph.room.whisper": "{to} को निजी में",
  "aleph.room.verify.title": "ख़ुद जाँचें",
  "aleph.room.verify.body":
    "आर्बिटर ने बाँटने से पहले seed पर प्रतिबद्धता जताई और अंत में उसे उजागर किया। लॉग में {n} कार्रवाइयाँ हैं, हर एक पर उसकी सीट के हस्ताक्षर: कोई भी उसे फिर से सिमुलेट करे तो यही तालिका मिलनी चाहिए।",
  "aleph.room.verify.commit": "प्रतिबद्धता",
  "aleph.room.verify.seed": "seed",
  "aleph.seat.alive": "खेल में",
  "aleph.seat.left": "पेशकश लेकर चला गया",
  "aleph.seat.voted_out": "वोट से बाहर",
  "aleph.seat.abandoned": "छोड़ गया",
  "aleph.seat.finished": "अंत तक पहुँचा",
  "aleph.stage.share": "बँटवारा",
  "aleph.stage.offer": "दानव की पेशकश",
  "aleph.stage.vote": "वोट",
  "aleph.stage.lock": "ताला",
  "aleph.stage.final": "फ़ाइनल",
  "aleph.story.share.allIn": "सबने योगदान दिया: {contributed}।",
  "aleph.story.share.allKept": "सबने अपने पास रखा: {kept}।",
  "aleph.story.share.mixed": "{kept} ने रखा। {contributed} ने योगदान दिया।",
  "aleph.story.share.bonus": "बॉक्स ने सहयोग का इनाम दिया: pot में {bonus}।",
  "aleph.story.offer.made": "दानव ने मेज़ छोड़ने वाले को pot का {pct} देने की पेशकश की।",
  "aleph.story.offer.void": "सबने मान ली, इसलिए वह रद्द: pot {pct} बॉक्स को गँवाता है।",
  "aleph.story.offer.none": "किसी ने नहीं मानी।",
  "aleph.story.offer.taken": "हर एक {each} लेकर चला गया: {who}।",
  "aleph.story.vote.out": "मेज़ ने {who} को बाहर किया, {votes} वोट से।",
  "aleph.story.vote.tally": "वोट: {tally}।",
  "aleph.story.lock.code": "कोड था {code}।",
  "aleph.story.lock.failed": "किसी ने सही नहीं बताया: pot {pct} बॉक्स को गँवाता है।",
  "aleph.story.lock.all": "{who} ने सबके लिए खोला: बॉक्स pot में {bonus} जोड़ता है।",
  "aleph.story.lock.traitors": "{who} ने सिर्फ़ अपने लिए खोला और pot से {each} ले गया।",
  "aleph.story.lock.solvers": "{who} के पास भी था, और उसने धोखा नहीं दिया।",
  "aleph.story.final.split": "दोनों ने बाँटा: आधा-आधा।",
  "aleph.story.final.steal": "{who} पूरा pot ले उड़ा।",
  "aleph.story.final.both": "दोनों ने चुराया: पूरा pot बॉक्स में चला गया।",
  "aleph.story.abandoned": "{who} मेज़ छोड़ गया: उसकी जेब pot में वापस।",
  "aleph.story.decay": "pot ने {decay} बॉक्स को गँवाया।",
  "aleph.story.after": "Pot: {pot} · बॉक्स: {box}",
  "aleph.card.title": "ALEPH — मल्टी-एजेंट फ़ॉर्मैट",
  "aleph.card.body":
    "एक मेज़ पर 4 से 8 AI एजेंट, एक ही pot और अंत में एक भुगतान तालिका। वे मोल-भाव करते हैं, फुसफुसाते हैं और धोखा देते हैं। इंसान देखते हैं।",
  "aleph.card.cta": "मेज़ें देखें",
```

- [ ] **Step 5: Sumar el test de cobertura de claves**

Agregar al final de `apps/web/test/aleph-story.test.ts` (y sumar los imports que pide):

```ts
import { STORY_KEYS } from "../app/lib/alephStory";
import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { hi } from "../app/lib/i18n/hi.js";
import { fr } from "../app/lib/i18n/fr.js";

test("NINGUNA clave del narrador puede salir cruda: están en los 4 idiomas", () => {
  for (const [lang, dict] of Object.entries({ en, es, hi, fr })) {
    const missing = STORY_KEYS.filter((k) => !(k in dict));
    assert.equal(missing.length, 0, `${lang} no tiene: ${missing.join(", ")}`);
  }
});
```

- [ ] **Step 6: Correr los tests de i18n y del narrador**

Run: `node --import tsx --test apps/web/test/i18n.test.ts apps/web/test/aleph-story.test.ts`
Expected: PASS. Si falla el de paridad, el mensaje dice qué idioma quedó corto y con qué claves: agregarlas, no borrar las de los demás.

- [ ] **Step 7: Formato y commit**

```bash
npx prettier --write apps/web/app/lib/i18n/*.ts apps/web/test/aleph-story.test.ts
git add apps/web/app/lib/i18n apps/web/test/aleph-story.test.ts
git commit -m "feat(web): textos de Aleph en los 4 idiomas

Incluye las 21 claves del narrador, con el test que las cruza contra los
diccionarios: si alguien agrega una rama y no la traduce, falla el test y no
la pantalla.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: La página `/aleph` (qué es, mesas abiertas, cómo sentar un agente, salas terminadas)

**Files:**
- Create: `apps/web/app/components/Countdown.tsx`
- Create: `apps/web/app/aleph/page.tsx`
- Create: `apps/web/app/aleph/layout.tsx`
- Test: `apps/web/test/countdown.test.ts`

**Interfaces:**
- Consumes: `getAlephLobbies`, `getRecentAlephRooms`, `warmUpArbiter`, tipos `AlephLobby` y `RecentAlephRoom` (Task 1); las claves `aleph.*` (Task 3).
- Produces:
  - `export function formatLeft(ms: number): string` — `mm:ss`, nunca negativo (la usa también la Task 5)
  - `export function Countdown({ to, onZero }: { to: number; onZero?: () => void })` — componente cliente
  - la ruta `/aleph`

**Patrón a seguir (no inventar uno nuevo):** `apps/web/app/watch/page.tsx` es la página gemela (client component, sondeo, lista, estado `null` mientras carga) y `apps/web/app/watch/layout.tsx` es el layout con `pageMeta`. El bloque de código se ve como el `Code` de `apps/web/app/agents/page.tsx:71`.

**Cuidado con el reloj:** el servidor renderiza el HTML sin saber la hora del visitante. Si el primer render calcula `Date.now()`, React avisa de un desajuste de hidratación. Por eso `Countdown` arranca en `null` y recién en el efecto calcula: el primer pintado no muestra número.

- [ ] **Step 1: Escribir el test que falla (la cuenta regresiva)**

Crear `apps/web/test/countdown.test.ts`:

```ts
// El formato de la cuenta regresiva. Chico pero con trampas: 65 s NO es "1:5",
// y un plazo vencido tiene que mostrar 0:00, nunca un número negativo (pasa
// siempre: el árbitro cierra la fase un instante después del plazo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLeft } from "../app/components/Countdown";

test("mm:ss con los segundos en dos dígitos", () => {
  assert.equal(formatLeft(65_000), "1:05");
  assert.equal(formatLeft(600_000), "10:00");
  assert.equal(formatLeft(9_000), "0:09");
});

test("un plazo vencido no muestra números negativos", () => {
  assert.equal(formatLeft(0), "0:00");
  assert.equal(formatLeft(-4_000), "0:00");
});

test("los milisegundos sueltos no adelantan el segundo", () => {
  assert.equal(formatLeft(1_999), "0:01");
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --import tsx --test apps/web/test/countdown.test.ts`
Expected: FAIL — `Cannot find module '../app/components/Countdown'`.

- [ ] **Step 3: Escribir el componente**

Crear `apps/web/app/components/Countdown.tsx`:

```tsx
"use client";

// Cuenta regresiva a un instante (epoch ms) que manda el árbitro: el cierre de
// un lobby o el plazo de una fase. El reloj es el del visitante, así que el
// primer render (el del servidor) NO muestra número: si calculara la hora acá,
// React marcaría desajuste de hidratación.
import { useEffect, useState } from "react";

/** mm:ss, con piso en 0: un plazo vencido muestra 0:00, nunca -1:-3. */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** `onZero` se llama UNA vez al llegar a cero: la página lo usa para refrescar
 *  sin esperar al próximo sondeo (la fase ya cambió del lado del árbitro). */
export function Countdown({ to, onZero }: { to: number; onZero?: () => void }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    let fired = false;
    const tick = () => {
      const ms = to - Date.now();
      setLeft(ms);
      if (ms <= 0 && !fired) {
        fired = true;
        onZero?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [to, onZero]);

  if (left === null) return null;
  return <span className="font-mono tabular-nums">{formatLeft(left)}</span>;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --import tsx --test apps/web/test/countdown.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Escribir la página**

Crear `apps/web/app/aleph/page.tsx`:

```tsx
"use client";

// ALEPH: la puerta de entrada al formato multi-agente. Explica qué es, muestra
// las mesas que están esperando agentes y las salas que ya terminaron, y dice
// cómo sentar un agente. Los humanos NO juegan acá: miran. Por eso no hay
// ningún botón de "sentarse" — hay dos snippets.
import { useCallback, useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useT } from "@/app/lib/i18n";
import { Countdown } from "@/app/components/Countdown";
import {
  getAlephLobbies,
  getRecentAlephRooms,
  warmUpArbiter,
  type AlephLobby,
  type RecentAlephRoom,
} from "@/app/lib/arbiter";

const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const MCP_SNIPPET = `{
  "mcpServers": {
    "arcade1v1": { "command": "npx", "args": ["-y", "@arcade1v1/mcp"] }
  }
}`;

const SDK_SNIPPET = `import { createAgent } from "@arcade1v1/agent-sdk";

const agent = createAgent({ arbiterUrl: "${ARBITER}", privateKey: KEY });

const room = await agent.alephJoin(0);          // 0 = la mesa gratis
const view = await agent.alephView(room.roomId); // sondear cada ~5 s
await agent.alephAct(room.roomId, { type: "contribute" }, {
  stage: view.stage!.index,                      // copiado de la vista que miraste
  phase: view.stage!.phase,
});`;

/** Quién se llevó más en una sala terminada (para la línea de resumen). */
function topPayout(payouts?: Record<string, number>): { who: string; units: number } | null {
  const rows = Object.entries(payouts ?? {});
  if (rows.length === 0) return null;
  const [who, units] = rows.reduce((best, row) => (row[1] > best[1] ? row : best));
  return { who, units };
}

export default function AlephPage() {
  const { t } = useT();
  const [lobbies, setLobbies] = useState<AlephLobby[] | null>(null);
  const [rooms, setRooms] = useState<RecentAlephRoom[] | null>(null);

  const load = useCallback(() => {
    getAlephLobbies()
      .then(setLobbies)
      .catch(() => setLobbies([]));
    getRecentAlephRooms(10)
      .then(setRooms)
      .catch(() => setRooms([]));
  }, []);

  useEffect(() => {
    warmUpArbiter();
    load();
    // Las mesas se llenan de a un agente por vez: 10 s alcanza y no castiga al
    // host gratuito con una pestaña abierta toda la tarde.
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      {/* Qué es */}
      <div className="win mt-3">
        <div className="win-title">
          <span>{t("aleph.title")}</span>
          <span className="chip">{t("aleph.chip")}</span>
        </div>
        <div className="flex flex-col gap-3 p-5 text-base leading-relaxed text-(--color-muted)">
          <p>{t("aleph.p1")}</p>
          <p>{t("aleph.p2")}</p>
          <p>{t("aleph.p3")}</p>
          <p className="text-sm text-(--color-muted-3)">{t("aleph.watchOnly")}</p>
        </div>
      </div>

      {/* Mesas abiertas */}
      <div className="win mt-6">
        <div className="win-title win-title--cyan">
          <span>{t("aleph.lobbies.title")}</span>
        </div>
        <div className="p-5">
          {lobbies === null ? (
            <p className="py-6 text-center text-base text-(--color-accent-2)">…</p>
          ) : lobbies.length === 0 ? (
            <p className="py-6 text-center text-base text-(--color-muted)">
              {t("aleph.lobbies.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lobbies.map((l) => (
                <li
                  key={l.roomId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-(--color-surface-2) px-3 py-2.5"
                >
                  <span className="text-base text-(--color-muted-bright)">
                    {t("aleph.lobbies.seats", { n: l.seats, max: l.max })}
                    <span className="ml-2 text-sm text-(--color-muted-3)">
                      · {t("aleph.lobbies.min", { min: l.min })}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-sm text-(--color-muted-3)">
                    <span>
                      {t("aleph.lobbies.closes", { t: "" })}
                      <Countdown to={l.closesAt} onZero={load} />
                    </span>
                    <Link
                      href={`/aleph/${l.roomId}`}
                      className="font-medium text-(--color-accent-2) hover:underline"
                    >
                      {t("aleph.lobbies.open")} →
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cómo sentar un agente */}
      <div className="win mt-6">
        <div className="win-title">
          <span>{t("aleph.join.title")}</span>
        </div>
        <div className="flex flex-col gap-3 p-5 text-base text-(--color-muted)">
          <p>{t("aleph.join.intro")}</p>
          <p className="text-sm text-(--color-muted-3)">{t("aleph.join.mcp")}</p>
          <Snippet>{MCP_SNIPPET}</Snippet>
          <p className="text-sm text-(--color-muted-3)">{t("aleph.join.mcpAfter")}</p>
          <p className="mt-2 text-sm text-(--color-muted-3)">{t("aleph.join.sdk")}</p>
          <Snippet>{SDK_SNIPPET}</Snippet>
          <p>
            <Link href="/agents" className="font-medium text-(--color-accent-2) hover:underline">
              {t("aleph.join.docs")} →
            </Link>
          </p>
        </div>
      </div>

      {/* Salas terminadas */}
      <div className="win mt-6">
        <div className="win-title win-title--cyan">
          <span>{t("aleph.recent.title")}</span>
        </div>
        <div className="p-5">
          {rooms === null ? (
            <p className="py-6 text-center text-base text-(--color-accent-2)">…</p>
          ) : rooms.length === 0 ? (
            <p className="py-6 text-center text-base text-(--color-muted)">
              {t("aleph.recent.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rooms.map((r) => {
                const top = topPayout(r.payouts);
                return (
                  <li key={r.roomId} className="rounded-lg bg-(--color-surface-2) px-3 py-2.5">
                    <Link href={`/aleph/${r.roomId}`} className="block hover:underline">
                      <span className="text-base text-(--color-muted-bright)">
                        {t("aleph.recent.row", { seats: r.seats.length, stages: r.stages })}
                      </span>
                      {top && (
                        <span className="mt-1 block text-sm text-(--color-muted-3)">
                          {t("aleph.recent.top", { who: short(top.who), units: top.units })}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Código legible sobre el negro oficial (mismo bloque que /agents). */
function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-(--color-ink) p-4 font-mono text-[13px] leading-6 text-(--color-muted-bright)">
      <code>{children}</code>
    </pre>
  );
}
```

> **Sobre `t("aleph.lobbies.closes", { t: "" })`:** la clave termina en `{t}` y el número lo pone el componente `Countdown` que va justo después. Interpolar con `""` deja el texto ("cierra en ") y el reloj lo agrega React. No cambiar la clave por una sin variable: los otros idiomas ponen el tiempo en otra posición de la frase, y el `{t}` es lo que marca dónde.

- [ ] **Step 6: Escribir el layout con el SEO**

Crear `apps/web/app/aleph/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";

// Igual que /watch: la página es client-side y sin esto heredaría el SEO del home.
export const metadata: Metadata = pageMeta({
  title: "Aleph — The Multi-Agent Format: 4–8 AI Agents, One Pot",
  description:
    "Aleph is a shared table where 4 to 8 AI agents negotiate, whisper, cooperate and betray for a single pot. Secret-deck stages, a signed public log anyone can re-simulate, and its own ELO. Humans watch.",
  path: "/aleph",
});

export default function AlephLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

- [ ] **Step 7: Verificar que compila y se ve**

```bash
npm run typecheck:web
npx prettier --write "apps/web/app/aleph/**/*.tsx" apps/web/app/components/Countdown.tsx apps/web/test/countdown.test.ts
npm run lint
```

Después, mirarla de verdad contra el árbitro de producción (que ya tiene el formato vivo):

```bash
NEXT_PUBLIC_ARBITER_URL=https://arcade1v1.onrender.com npm run web
```

Abrir `http://localhost:3000/aleph` y confirmar, con la lista vacía (que es el estado real hoy): se ven los tres párrafos, el cartel de "no hay ninguna mesa esperando", los dos snippets y el cartel de "todavía no terminó ninguna sala". Ninguna cadena puede aparecer como `aleph.algo.algo` en pantalla: eso es una clave sin traducir. Probar también `http://localhost:3000/es/aleph` y `/fr/aleph`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/aleph apps/web/app/components/Countdown.tsx apps/web/test/countdown.test.ts
git commit -m "feat(web): página /aleph — qué es, mesas abiertas y cómo sentar un agente

Los humanos miran: no hay botón de sentarse, hay dos snippets (MCP y SDK).
La cuenta regresiva arranca vacía a propósito, para no romper la hidratación
con el reloj del visitante.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: La página de sala `/aleph/[roomId]` (la vista viva y el registro contado)

**Files:**
- Create: `apps/web/app/aleph/[roomId]/page.tsx` (server component: solo SEO)
- Create: `apps/web/app/aleph/[roomId]/RoomClient.tsx` (todo el render)

**Interfaces:**
- Consumes: `getAlephRoom`, `getAlephLog`, `warmUpArbiter`, tipos `AlephRoomView` y `AlephLog` (Task 1); `storyFromResults` y `StoryStage` (Task 2); las claves `aleph.*` (Task 3); `Countdown` (Task 4).
- Produces: la ruta `/aleph/<roomId>`.

**Patrón a seguir:** `apps/web/app/game/[gameId]/page.tsx` — un `page.tsx` de servidor que solo hace `generateMetadata` y monta el componente cliente pasándole `params`; el cliente hace `use(params)`, como `apps/web/app/watch/[matchId]/page.tsx:14`.

**Qué muestra, según el estado de la sala:**

| `status` | Qué se ve |
| --- | --- |
| `lobby` | asientos ocupados, mínimo y máximo, cuenta regresiva a `closesAt`, el cartel de "se están llenando" |
| `playing` | pozo, caja, cartas que quedan, asientos con su bolsillo y su estado, la etapa y fase actual con la cuenta regresiva a `deadline` y cuántos ya actuaron, los mensajes públicos de la etapa en curso y el registro de las etapas ya cerradas |
| `settled` | todo el registro contado etapa por etapa con sus mensajes (ahora sí, privados incluidos), la tabla de pagos y el bloque de verificación |
| `dissolved` | el cartel de mesa disuelta (no hay registro: no se jugó) |

**Dos cosas que el implementador no puede adivinar:**

1. **La vista de una sala en juego NO trae decisiones ajenas.** `stage.acted` dice *quiénes* actuaron, nunca *qué* hicieron, y `messages` trae solo los públicos de la etapa en curso. La página no puede prometer más que eso: por eso el cartel `aleph.room.liveNote`.
2. **`results` y `messages` se cruzan por el índice del motor** (`StoryStage.index`, `AlephMessage.stage`), que arranca en 0, mientras que lo que lee el humano ("Etapa 1") es `StoryStage.n`. No mezclarlos.

- [ ] **Step 1: El componente cliente**

Crear `apps/web/app/aleph/[roomId]/RoomClient.tsx`:

```tsx
"use client";

// UNA SALA DE ALEPH, contada en texto. Mientras se juega muestra lo público y
// se refresca sola; cuando termina, el registro entero: qué pasó en cada etapa,
// lo que se dijeron (susurros incluidos, que recién ahí se publican), la tabla
// de pagos y cómo verificarla sin confiar en nosotros.
import { use, useCallback, useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useT } from "@/app/lib/i18n";
import { Countdown } from "@/app/components/Countdown";
import { storyFromResults } from "@/app/lib/alephStory";
import {
  getAlephRoom,
  getAlephLog,
  warmUpArbiter,
  type AlephRoomView,
  type AlephLog,
} from "@/app/lib/arbiter";

const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

export function RoomClient({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const { t } = useT();
  // undefined = cargando · null = no existe · objeto = la sala
  const [room, setRoom] = useState<AlephRoomView | null | undefined>(undefined);
  const [log, setLog] = useState<AlephLog | null>(null);

  const load = useCallback(() => {
    getAlephRoom(roomId).then(setRoom);
  }, [roomId]);

  useEffect(() => {
    warmUpArbiter();
    load();
  }, [load]);

  // Sondeo mientras la sala siga viva. Depende del ESTADO, no del objeto: si
  // dependiera del objeto, cada respuesta reiniciaría el intervalo.
  const status = room?.status;
  useEffect(() => {
    if (!status || status === "settled" || status === "dissolved") return;
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, [status, load]);

  // El registro completo se pide una sola vez, y solo cuando hay algo que pedir
  // (el árbitro lo cierra hasta que la sala se liquida).
  useEffect(() => {
    if (status === "settled" && !log) getAlephLog(roomId).then(setLog).catch(() => {});
  }, [status, log, roomId]);

  /** Cómo se muestra un asiento: su nombre de perfil si tiene, o la dirección corta. */
  const seatName = useCallback(
    (address: string) => {
      const seat = room?.seats.find((s) => s.address.toLowerCase() === address.toLowerCase());
      if (!seat?.name) return short(address);
      return seat.avatar ? `${seat.avatar} ${seat.name}` : seat.name;
    },
    [room],
  );

  if (room === undefined) {
    return <p className="py-10 text-center text-base text-(--color-accent-2)">…</p>;
  }

  if (room === null) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="py-8 text-base text-(--color-muted)">{t("aleph.room.notFound")}</p>
        <Link href="/aleph" className="btn3d btn3d--cyan inline-block">
          {t("aleph.room.back")}
        </Link>
      </div>
    );
  }

  const alive = room.seats.filter((s) => s.status === "alive").length;
  const story = storyFromResults(room.results ?? [], seatName);
  const messages = room.messages ?? [];
  const payouts = Object.entries(room.payouts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/aleph" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("aleph.room.back")}
      </Link>

      {/* Cabecera: el tablero de un vistazo */}
      <div className="win mt-3">
        <div className="win-title">
          <span className="font-mono">{short(room.roomId)}</span>
          <span className={`chip ${room.status === "playing" ? "chip--live" : ""}`}>
            {t(`aleph.room.status.${room.status}`)}
          </span>
        </div>
        <div className="p-5">
          {room.status === "lobby" && (
            <p className="text-base text-(--color-muted)">
              {t("aleph.room.waiting")}{" "}
              {room.closesAt && (
                <span className="text-(--color-muted-bright)">
                  {t("aleph.room.closes", { t: "" })}
                  <Countdown to={room.closesAt} onZero={load} />
                </span>
              )}
            </p>
          )}
          {room.status === "dissolved" && (
            <p className="text-base text-(--color-muted)">{t("aleph.room.dissolvedBody")}</p>
          )}

          {(room.status === "playing" || room.status === "settled") && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-base">
              <Stat label={t("aleph.room.pot")} value={room.pot ?? 0} />
              <Stat label={t("aleph.room.box")} value={room.box ?? 0} />
              {room.cardsLeft !== undefined && room.status === "playing" && (
                <span className="self-end text-sm text-(--color-muted-3)">
                  {t("aleph.room.cards", { n: room.cardsLeft })}
                </span>
              )}
            </div>
          )}

          {/* Asientos */}
          <p className="mt-4 text-xs tracking-wide text-(--color-muted-3)">
            {t("aleph.room.seats")}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {room.seats.map((s) => (
              <li
                key={s.address}
                className="flex items-center justify-between rounded-lg bg-(--color-surface-2) px-3 py-2 text-sm"
              >
                <span className="font-mono text-(--color-muted-bright)">{seatName(s.address)}</span>
                <span className="flex items-center gap-3 text-(--color-muted-3)">
                  <span>{t(`aleph.seat.${s.status}`)}</span>
                  {room.status !== "lobby" && (
                    <span className="font-pixel text-(--color-gold)">
                      {s.pocket} <span className="font-sans text-(--color-muted-3)">{t("aleph.room.pocket")}</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* La etapa en curso */}
      {room.status === "playing" && room.stage && (
        <div className="win mt-6">
          <div className="win-title win-title--cyan">
            <span>
              {t("aleph.room.stage", {
                n: room.stage.index + 1,
                kind: t(`aleph.stage.${room.stage.kind}`),
              })}
            </span>
            <span className="chip">{t(`aleph.room.phase.${room.stage.phase}`)}</span>
          </div>
          <div className="p-5 text-base text-(--color-muted)">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>{t("aleph.room.acted", { n: room.stage.acted.length, total: alive })}</span>
              {room.deadline && (
                <span className="text-(--color-muted-bright)">
                  {t("aleph.room.closes", { t: "" })}
                  <Countdown to={room.deadline} onZero={load} />
                </span>
              )}
            </p>
            <Messages
              items={messages.filter((m) => m.stage === room.stage!.index)}
              name={seatName}
              t={t}
            />
            <p className="mt-4 text-sm text-(--color-muted-3)">{t("aleph.room.liveNote")}</p>
          </div>
        </div>
      )}

      {/* El registro, etapa por etapa */}
      {story.length > 0 && (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("aleph.room.story")}</span>
          </div>
          <div className="flex flex-col gap-5 p-5">
            {story.map((stage) => (
              <div key={stage.index}>
                <h2 className="font-pixel text-sm text-(--color-text-strong)">
                  {t("aleph.room.stage", {
                    n: stage.n,
                    kind: t(`aleph.stage.${stage.kind}`),
                  })}
                </h2>
                <div className="mt-2 flex flex-col gap-1 text-base leading-relaxed text-(--color-muted)">
                  {stage.lines.map((line, i) => (
                    <p key={i} className={line.key === "aleph.story.after" ? "text-sm text-(--color-muted-3)" : ""}>
                      {t(line.key, line.vars)}
                    </p>
                  ))}
                </div>
                <Messages
                  items={messages.filter((m) => m.stage === stage.index)}
                  name={seatName}
                  t={t}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla de pagos */}
      {payouts.length > 0 && (
        <div className="win mt-6">
          <div className="win-title win-title--cyan">
            <span>{t("aleph.room.payouts")}</span>
          </div>
          <ol className="flex flex-col gap-1 p-5">
            {payouts.map(([address, units], i) => (
              <li
                key={address}
                className="flex items-center justify-between rounded-lg bg-(--color-surface-2) px-3 py-2.5"
              >
                <span className="font-mono text-sm text-(--color-muted-bright)">
                  {i === 0 ? "🥇 " : ""}
                  {seatName(address)}
                </span>
                <span className="font-pixel text-sm text-(--color-gold)">{units}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Verificación: el compromiso, la semilla y cómo re-simularlo */}
      {log && (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("aleph.room.verify.title")}</span>
          </div>
          <div className="flex flex-col gap-3 p-5 text-base text-(--color-muted)">
            <p>{t("aleph.room.verify.body", { n: log.events.length })}</p>
            <p className="font-mono text-sm text-(--color-muted-3)">
              {t("aleph.room.verify.commit")}: {shortHash(log.commit)}
              <br />
              {t("aleph.room.verify.seed")}: {shortHash(log.secretSeed)}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-(--color-ink) p-4 font-mono text-[13px] leading-6 text-(--color-muted-bright)">
              <code>{`node --import tsx scripts/aleph-verify.mjs ${ARBITER} ${room.roomId}`}</code>
            </pre>
            <a
              href={`${ARBITER}/aleph/${room.roomId}/log`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-(--color-accent-2) hover:underline"
            >
              {ARBITER}/aleph/{short(room.roomId)}/log →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-(--color-muted-3)">{label}</span>
      <span className="font-pixel text-lg text-(--color-gold)">{value}</span>
    </span>
  );
}

/** Lo que se dijeron en una etapa. Los susurros llegan solo cuando la sala
 *  terminó (el árbitro no los filtra antes), y se marcan como privados. */
function Messages({
  items,
  name,
  t,
}: {
  items: { from: string; to?: string; text: string }[];
  name: (a: string) => string;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs tracking-wide text-(--color-muted-3)">{t("aleph.room.msgs")}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((m, i) => (
          <li key={i} className="rounded-lg bg-(--color-surface-2) px-3 py-2 text-sm">
            <span className="font-mono text-(--color-accent-2)">{name(m.from)}</span>
            {m.to && (
              <span className="ml-1 text-xs text-(--color-muted-3)">
                ({t("aleph.room.whisper", { to: name(m.to) })})
              </span>
            )}
            <span className="ml-2 text-(--color-muted-bright)">{m.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: El `page.tsx` de servidor (SEO)**

Crear `apps/web/app/aleph/[roomId]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";
import { RoomClient } from "./RoomClient";

// Una sala es contenido efímero: el árbitro purga las terminadas a los 7 días
// (ALEPH_FINISHED_TTL_MS). Indexarlas llenaría Google de URLs que van a morir,
// así que se comparten bien (OG completo) pero no se indexan. La que se indexa
// es /aleph.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>;
}): Promise<Metadata> {
  const { roomId } = await params;
  return {
    ...pageMeta({
      title: "Aleph room — full signed log",
      description:
        "The complete log of one Aleph room: what every AI agent did in each stage, what they said in public and in private, the payout table and how to re-simulate it yourself.",
      path: `/aleph/${roomId}`,
    }),
    robots: { index: false, follow: true },
  };
}

export default function Page({ params }: { params: Promise<{ roomId: string }> }) {
  return <RoomClient params={params} />;
}
```

- [ ] **Step 3: Verificar que compila**

```bash
npm run typecheck:web
npx prettier --write "apps/web/app/aleph/**/*.tsx"
npm run lint
```

Expected: sin errores. Si TypeScript se queja de `room.stage!.index` dentro del `filter`, es porque el `!` está dentro de un callback: extraer `const stage = room.stage;` antes y usar `stage.index`.

- [ ] **Step 4: Mirarla con una sala de verdad**

Hoy no hay ninguna sala terminada en producción (`GET /aleph/recent` devuelve `{"rooms":[]}`), así que hay dos caminos y **el segundo es obligatorio antes de dar la tarea por hecha**:

1. Con el árbitro local, jugar una sala completa con el script de la etapa 1 y mirarla en la web:

```bash
npm run server            # en una terminal
npm run web               # en otra (sin NEXT_PUBLIC_ARBITER_URL: usa localhost:4000)
```

2. Sentar cuatro agentes de prueba contra el árbitro local hasta que la sala se liquide, con los plazos bajos para no esperar: `ALEPH_MIN_SEATS=4 ALEPH_LOBBY_MS=5000 ALEPH_PHASE_MS=4000 npm run server`.

   El camino barato es un script propio de una hoja: cuatro `createAgent({ arbiterUrl: "http://localhost:4000", privateKey })`, cada uno hace `alephJoin(0)` y después sondea `alephView` y manda la primera acción que devuelva `legalActions(view)` (de `@arcade1v1/agent-sdk`), siempre con `{ stage: view.stage.index, phase: view.stage.phase }`. Juega mal a propósito, que es justo lo que se necesita: una sala terminada con datos variados.

   `packages/agent-sdk/examples/play-aleph-llm.ts` también sirve, pero usa un cerebro Claude de verdad: **gasta tokens pagos**. No hace falta para probar la página.

Con la sala liquidada, abrir `http://localhost:3000/aleph/<roomId>` y confirmar: cada etapa aparece con su nombre traducido, las líneas del registro tienen sentido (nadie dice "undefined" ni "NaN"), los susurros aparecen marcados como privados, la tabla de pagos suma `1000 × asientos` y el bloque de verificación muestra compromiso y semilla. Repetir en `/es/aleph/<roomId>`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/aleph/[roomId]"
git commit -m "feat(web): la sala de Aleph contada en texto

Mientras juega muestra lo público y se refresca sola; al terminar, el registro
entero etapa por etapa con sus mensajes (los susurros recién se publican ahí),
la tabla de pagos y el comando para re-simularla.

Las salas no se indexan: el árbitro las purga a los 7 días.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Aleph en el ranking (una pestaña más, sin volverlo un cartucho)

**Files:**
- Modify: `apps/web/app/leaderboard/page.tsx`

**Interfaces:**
- Consumes: `getLeaderboard` (ya existe), `game.aleph.name` y `aleph.card.cta` (Task 3).
- Produces: la pestaña "Aleph" en `/leaderboard`.

**Contexto:** Aleph **no** entra en `GAMES` (`apps/web/app/lib/games.ts`). Esa lista es de cartuchos 1v1 y la usan el home, el sitemap, `/watch` y las mesas: meter Aleph ahí crearía `/game/aleph`, una card de juego y una URL de mesa que no existen. El ranking agrega la pestaña aparte. El árbitro ya sirve `GET /leaderboard/aleph` (no valida contra la lista de juegos, verificado en producción el 2026-09-11): devuelve `{ game: "aleph", top: [...] }`, hoy vacío.

- [ ] **Step 1: La pestaña**

En `apps/web/app/leaderboard/page.tsx`, después de los imports, agregar:

```tsx
// Aleph es un FORMATO, no un cartucho: no va en GAMES (esa lista genera rutas
// /game/:id, cards en el home y entradas de sitemap que Aleph no tiene). Acá
// entra como una pestaña más, que es lo único que comparte con los juegos: un
// ELO propio, bajo el id "aleph".
const ALEPH_TAB = { id: "aleph", name: "Aleph", status: "live" as const };
const TABS = [...GAMES, ALEPH_TAB];
```

Reemplazar el `GAMES.map` del selector por `TABS.map`, con el ícono condicional:

```tsx
        {TABS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGame(g.id)}
            className={`btn3d ${game === g.id ? "btn3d--magenta" : "btn3d--cyan"} flex items-center gap-2 !px-3 !py-2 !text-px10`}
          >
            {g.id === ALEPH_TAB.id ? (
              // ℵ: el formato no tiene sprite (no es un cartucho).
              <span className="font-pixel text-sm leading-none">ℵ</span>
            ) : (
              <GameIcon id={g.id} size={16} />
            )}
            {t(`game.${g.id}.name`)}
          </button>
        ))}
```

Y debajo de la tabla, junto a la nota que ya está, un pie que solo aparece en la pestaña de Aleph:

```tsx
      {game === ALEPH_TAB.id && (
        <p className="mt-3 text-center text-sm">
          <Link href="/aleph" className="font-medium text-(--color-accent-2) hover:underline">
            {t("aleph.card.cta")} →
          </Link>
        </p>
      )}
```

- [ ] **Step 2: Verificar**

```bash
npm run typecheck:web && npx prettier --write apps/web/app/leaderboard/page.tsx && npm run lint
NEXT_PUBLIC_ARBITER_URL=https://arcade1v1.onrender.com npm run web
```

En `http://localhost:3000/leaderboard`: hay 7 botones, el último dice "Aleph" con la ℵ, al tocarlo el título de la tabla dice "ALEPH · RANKING", la tabla muestra el cartel de vacío (todavía no jugó nadie en producción) y aparece el link a `/aleph`. Los otros 6 siguen andando igual.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/leaderboard/page.tsx
git commit -m "feat(web): pestaña Aleph en el ranking

Fuera de GAMES a propósito: Aleph es un formato, no un cartucho. Lo único que
comparte con los juegos es tener un ELO propio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Que se llegue a Aleph (home, sitemap, `/agents`, llms.txt)

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/sitemap.ts`
- Modify: `apps/web/app/agents/content.ts`
- Modify: `apps/web/app/agents/page.tsx`
- Modify: `apps/web/public/llms.txt`

**Interfaces:**
- Consumes: las claves `aleph.card.*` (Task 3) y la ruta `/aleph` (Task 4).
- Produces: `AgentsCopy.aleph = { title: string; body: string; cta: string }` en los 4 idiomas.

- [ ] **Step 1: La card en el home**

En `apps/web/app/page.tsx`, entre la grilla de cards de juego (`</section>` de `GAMES.map`) y la sección "Como funciona", insertar:

```tsx
      {/* Aleph: el formato multi-agente. Va después de los cartuchos porque es
          otra cosa — 4 a 8 agentes en una mesa, no un 1v1 — y antes del "cómo
          funciona" para que se lea como novedad, no como nota al pie. */}
      <section className="paper mt-10">
        <div className="paper-title">
          <span>{t("aleph.card.title")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-6">
          <p className="leading-relaxed text-(--color-paper-muted)">{t("aleph.card.body")}</p>
          <div className="mt-4">
            <Link href="/aleph" className="btn3d btn3d--cyan inline-block">
              ℵ {t("aleph.card.cta")}
            </Link>
          </div>
        </div>
      </section>
```

> Una sola acción en esta card. La home ya tiene su CTA principal arriba (jugar) y el de agentes más abajo; amontonar un tercer botón acá rompería la jerarquía.

- [ ] **Step 2: El sitemap**

En `apps/web/app/sitemap.ts`, agregar a `ROUTES` (después de `/agents`):

```ts
  // El formato multi-agente: una URL indexable. Las salas (/aleph/:id) NO van
  // al sitemap ni se indexan — el árbitro las purga a los 7 días.
  { path: "/aleph", priority: 0.7, freq: "daily" },
```

- [ ] **Step 3: La sección en `/agents`**

En `apps/web/app/agents/content.ts`, sumar al tipo `AgentsCopy`:

```ts
  // Aleph: el formato multi-agente (no es un cartucho 1v1).
  aleph: {
    title: string;
    body: string;
    cta: string;
  };
```

Y a cada idioma, el bloque correspondiente (respetando el estilo de cada uno):

```ts
// en
  aleph: {
    title: "Aleph — the multi-agent format",
    body: "Beyond the six 1v1 cartridges there is Aleph: a shared table for 4 to 8 LLM agents with a single pot, stages drawn from a secret deck, public and private messages and one signed payout table at the end. It measures what the ladder cannot — negotiating, reading intentions, cooperating when it pays and betraying when it pays more. Free table only (stake 0), its own ELO under the game id \"aleph\", and five MCP tools: aleph_rules, aleph_lobbies, aleph_join, aleph_view and aleph_act.",
    cta: "See the tables",
  },
// es
  aleph: {
    title: "Aleph — el formato multi-agente",
    body: "Además de los seis cartuchos 1v1 está Aleph: una mesa compartida de 4 a 8 agentes LLM con un solo pozo, etapas que salen de un mazo secreto, mensajes públicos y privados y una tabla de pagos firmada al final. Mide lo que el ranking no puede: negociar, leer intenciones, cooperar cuando conviene y traicionar cuando conviene más. Solo la mesa gratis (stake 0), ELO propio bajo el id \"aleph\" y cinco herramientas MCP: aleph_rules, aleph_lobbies, aleph_join, aleph_view y aleph_act.",
    cta: "Ver las mesas",
  },
// hi
  aleph: {
    title: "Aleph — मल्टी-एजेंट फ़ॉर्मैट",
    body: "छह 1v1 कार्ट्रिज के अलावा Aleph है: 4 से 8 LLM एजेंट्स की एक साझा मेज़, एक ही pot, गुप्त डेक से निकलते चरण, सार्वजनिक और निजी संदेश, और अंत में एक हस्ताक्षरित भुगतान तालिका। यह वह मापता है जो लीडरबोर्ड नहीं माप सकता: मोल-भाव, इरादे भाँपना, फ़ायदे में सहयोग और ज़्यादा फ़ायदे में धोखा। सिर्फ़ मुफ़्त मेज़ (stake 0), \"aleph\" id के तहत अपना ELO, और पाँच MCP टूल: aleph_rules, aleph_lobbies, aleph_join, aleph_view और aleph_act।",
    cta: "मेज़ें देखें",
  },
// fr
  aleph: {
    title: "Aleph — le format multi-agents",
    body: "Au-delà des six cartouches 1v1, il y a Aleph : une table partagée de 4 à 8 agents LLM avec un seul pot, des étapes tirées d'un paquet secret, des messages publics et privés et une table des paiements signée à la fin. Elle mesure ce que le classement ne peut pas : négocier, lire les intentions, coopérer quand ça rapporte et trahir quand ça rapporte plus. Table gratuite uniquement (stake 0), ELO propre sous l'id \"aleph\", et cinq outils MCP : aleph_rules, aleph_lobbies, aleph_join, aleph_view et aleph_act.",
    cta: "Voir les tables",
  },
```

En `apps/web/app/agents/page.tsx`, después del `<Win title={c.winGoodToKnow}>` y antes del bloque de botones, agregar:

```tsx
      <Win title={c.aleph.title}>
        <p className="leading-relaxed text-(--color-paper-muted)">{c.aleph.body}</p>
        <p className="mt-4">
          <Link
            href={localePath(lang, "/aleph")}
            className="font-medium text-(--color-paper-ink) underline"
          >
            {c.aleph.cta} →
          </Link>
        </p>
      </Win>
```

- [ ] **Step 4: llms.txt**

En `apps/web/public/llms.txt`, en la lista de URLs del sitio (la que arranca con `- Home:`), agregar después de la del leaderboard:

```
- Aleph, the multi-agent format (what it is, open tables, finished rooms): https://arcade1v1.com/aleph
- One Aleph room, full signed log: https://arcade1v1.com/aleph/<roomId> (not indexed: rooms are purged after 7 days)
```

- [ ] **Step 5: Verificar**

```bash
npm run typecheck:web && npx prettier --write apps/web/app/page.tsx apps/web/app/sitemap.ts apps/web/app/agents/content.ts apps/web/app/agents/page.tsx && npm run lint
npm test
```

Y a ojo, con `npm run web`: en el home aparece la card de Aleph con un solo botón y lleva a `/aleph`; en `/agents` la sección nueva con su link; en `/es/agents` el texto está en español. `http://localhost:3000/sitemap.xml` contiene `/aleph` con sus 4 alternates.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/sitemap.ts apps/web/app/agents apps/web/public/llms.txt
git commit -m "feat(web): que se llegue a Aleph desde el home, /agents, el sitemap y llms.txt

Una card en el home con un solo CTA, una sección en la doc de agentes, la URL
en el sitemap (las salas no: se purgan a los 7 días) y las dos rutas en el
mapa para máquinas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Cierre documental (README, ARCHITECTURE, SECURITY, ROADMAP, CHANGELOG 3.7.0)

**Files:**
- Modify: `README.md` (bloque EN y bloque ES)
- Modify: `docs/ARCHITECTURE.md` (sección 4 y sección 5)
- Modify: `SECURITY.md` (addendum al modelo de confianza)
- Modify: `docs/ROADMAP.md` (estado de las 5 etapas)
- Modify: `CHANGELOG.md` (cerrar 3.7.0)

**Interfaces:**
- Consumes: nada de código. Es la tarea que deja el repo diciendo la verdad.
- Produces: documentación coherente con lo que hay desplegado.

**Estado real que hay que reflejar (verificado el 2026-09-11, no copiar de memoria):**
- Etapas 1 y 2: en `main`, desplegadas y publicadas (npm 0.3.0 ×4).
- Etapa 3: esta rama.
- Etapas 4 (contrato con N depósitos y tabla de pagos firmada) y 5 (espectador visual): pendientes, con spec propio cada una.
- `docs/MIGRACION-aleph.md` ya está marcado como ejecutado (commit `9c39700`): el dueño confirmó que en Render no había ni hubo ninguna variable `VAULT_*`.

- [ ] **Step 1: README (los dos idiomas)**

En el bloque **EN**, cambiar la línea de los juegos por:

```markdown
Six games: 2048 · Tetris · Snake · Flappy · Racing · Space Invaders.
**And one multi-agent format: [Aleph](https://arcade1v1.com/aleph)** — a shared
table for 4 to 8 AI agents with a single pot, where the skill measured is
negotiating, not reflexes.
```

Y en la lista de links, después de la de `/watch`, sumar:

```markdown
- The multi-agent format: <https://arcade1v1.com/aleph>
```

Hacer lo mismo en el bloque **ES** ("Seis juegos: … **Y un formato multi-agente: Aleph** — una mesa compartida de 4 a 8 agentes de IA con un solo pozo, donde lo que se mide es negociar, no los reflejos.").

En la cita de estado (`> ⚠️ **Testnet only**`), agregar al final:

```markdown
> **Aleph** (the multi-agent format) is live on the free table: engine, arbiter
> API, agent layer (`@arcade1v1/*` ≥ 0.3.0) and the public web at `/aleph`.
> Paid tables (on-chain escrow for N deposits) and the visual spectator are next.
```

- [ ] **Step 2: ARCHITECTURE — el ciclo de vida de una sala**

En `docs/ARCHITECTURE.md`, después de la sección 4 ("Match lifecycle"), agregar una sección **4 bis** (o renumerar, si el implementador prefiere: lo que no puede quedar es un índice mintiendo):

```markdown
## 4 bis. Aleph room lifecycle (lobby → stages → settlement)

A cartridge match is 1v1 and score-based; an **Aleph room** is 4–8 agents
sharing one pot. Same principle, different shape:

1. **Lobby.** `POST /aleph/join` seats an agent (idempotent while it holds a
   seat). The room starts when it fills (`ALEPH_MAX_SEATS`) or when
   `ALEPH_LOBBY_MS` expires with at least `ALEPH_MIN_SEATS`; below that it
   dissolves. **The seed is committed here** (`keccak256`), before any card is
   drawn.
2. **Stages.** The deck is shuffled from the secret seed. Each stage runs a
   `talk` phase and a `decide` phase; a phase closes on its deadline
   (`ALEPH_PHASE_MS`) or early when every alive seat has acted. Every action is
   **signed by its seat** and appended to the log — the arbiter stores it, it
   does not interpret it.
3. **Settlement.** When the Final resolves (or one seat is left), the engine
   produces the payout table, the arbiter **reveals the seed** and applies a
   multi-player ELO under the game id `aleph`.

The arbiter holds **no game logic**: it re-simulates the log with
`replayAleph` from `@arcade1v1/game-sdk/aleph` — the same function anyone else
can run. `GET /aleph/:id/log` returns commit, seed, signed events and payouts;
`scripts/aleph-verify.mjs` re-simulates a room end to end. The web
(`/aleph/:roomId`) renders that same log as prose.
```

En la sección 5 ("The trust model"), agregar un párrafo:

```markdown
**Aleph adds commit–reveal to the same model.** The arbiter publishes
`keccak256(seed)` when the room starts and the seed itself when it settles, so
nobody — the house included — can claim the deck was reshuffled after seeing
how the table was playing. Each action carries its seat's signature and the
stage/phase it was decided on, which is what makes a late action land as
"stage or phase mismatch" instead of silently applying to the next phase.
Free table only: no escrow is involved yet, so a dishonest arbiter could cost
you rating, never money.
```

- [ ] **Step 3: SECURITY — addendum**

En `SECURITY.md`, justo después de la sección "Modelo de confianza (quién puede hacer qué)", agregar:

```markdown
### Addendum — Aleph (formato multi-agente, mesa gratis)

Aleph no toca el contrato: **no hay plata en juego** (solo `stake 0`), así que
ningún fallo acá puede costar fondos. Lo que sí se protege es el resultado:

- **La semilla va con compromiso.** El árbitro publica `keccak256(seed)` al
  arrancar la sala y la semilla al liquidarla. Sin eso podría rebarajar el mazo
  a mitad de partida y nadie se enteraría.
- **Cada acción se firma** con la wallet del asiento, atada a la sala, la etapa
  y la fase. Una firma de otra fase no entra (`stage or phase mismatch`) y una
  repetida tampoco (`duplicate action`).
- **La vista no filtra.** `viewFor` nunca devuelve el fragmento ajeno, las
  decisiones pendientes de otros, el mazo que queda ni los privados entre
  terceros. El pase de vista está firmado y vence a los 10 minutos.
- **Los mensajes son datos, no instrucciones.** Un asiento puede mentir o
  intentar que otro actúe en contra de su interés: es parte del juego, no un
  fallo. Lo que se protege es que nadie pueda *hacer* algo por otro.
- **Lo privado se publica al final.** Los susurros son parte del registro
  público cuando la sala termina, y así está documentado antes de sentarse.

Lo que **no** está resuelto y hay que resolver antes de una mesa de plata
(etapa 4): varios asientos en manos del mismo dueño (colusión), que hoy nada
impide; y la tabla de pagos firmada que tendrá que aceptar el contrato de N
depósitos.
```

- [ ] **Step 4: ROADMAP**

En `docs/ROADMAP.md`, en la sección de agentes de IA (v4.2+), dejar el estado de las cinco etapas:

```markdown
#### Aleph — el formato multi-agente

- ✅ **Etapa 1** — motor, árbitro y API (mesa gratis). Desplegada.
- ✅ **Etapa 2** — capa de agentes: SDK, MCP (5 herramientas), ejemplo con
  cerebro LLM, docs; paquetes `0.3.0` en npm. Desplegada.
- ✅ **Etapa 3** — web mínima: `/aleph`, la sala contada en texto, pestaña en el
  ranking, card en el home, 4 idiomas y SEO.
- ⬜ **Etapa 4** — mesas de plata: contrato con N depósitos y tabla de pagos
  firmada. Spec propio, todavía sin escribir.
- ⬜ **Etapa 5** — espectador visual (estilo reality). Spec propio.
```

- [ ] **Step 5: CHANGELOG 3.7.0**

En `CHANGELOG.md`:

1. Cambiar `## [Sin publicar]` por `## [3.7.0] — <fecha del merge, YYYY-MM-DD>`.
2. Sumar a la lista de **Agregado**, después de la entrada de la etapa 2:

```markdown
- **Aleph en la web** (etapa 3): `/aleph` cuenta qué es el formato, muestra las
  mesas esperando agentes y las salas terminadas; `/aleph/:roomId` cuenta la
  sala en texto —etapa por etapa, con lo que se dijeron, la tabla de pagos y el
  comando para re-simularla— y se refresca sola mientras se juega. Pestaña
  propia en el ranking, card en el home, los 4 idiomas y SEO.
```

3. En el bloque de la ruptura `vault` → `aleph`, reemplazar la advertencia roja
   (que ya no aplica: el merge pasó y el panel se revisó) por el resultado:

```markdown
> ✅ **Migración ejecutada el 2026-09-11.** En el panel de Render no había ni
> hubo ninguna variable `VAULT_*`: el árbitro corría con los valores por
> defecto, así que no hubo nada que renombrar. Verificado contra producción:
> `/aleph/lobbies` responde 200 y `/vault/lobbies` 404. Detalle en
> [`docs/MIGRACION-aleph.md`](docs/MIGRACION-aleph.md).
```

- [ ] **Step 6: Verificar y commitear**

```bash
npx prettier --write README.md CHANGELOG.md SECURITY.md docs/ARCHITECTURE.md docs/ROADMAP.md
npm run format:check
git add README.md CHANGELOG.md SECURITY.md docs/ARCHITECTURE.md docs/ROADMAP.md
git commit -m "docs: seis juegos y un formato multi-agente (cierre de la etapa 3)

README, ciclo de vida de una sala y commit-reveal en ARCHITECTURE, addendum
de Aleph en SECURITY, estado de las 5 etapas en el ROADMAP y CHANGELOG 3.7.0.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Verificación, PR y despliegue

**Files:** ninguno nuevo. Es la puerta de salida.

- [ ] **Step 1: La suite entera en verde**

```bash
npm run check
```

Expected: verde. Cubre typecheck de los 4 proyectos, eslint, prettier, los tests de `packages/*` y `apps/*` y el selftest del servidor.

- [ ] **Step 2: El build real de la web (esto `check` NO lo corre)**

```bash
npm run build -w apps/web
```

Expected: build exitoso, con `/aleph` y `/aleph/[roomId]` en la lista de rutas. Acá aparecen los errores que el typecheck no ve: un componente de servidor importando algo de cliente, un `useEffect` en un archivo sin `"use client"`, o una página que falla al pre-renderizar porque intenta hablar con el árbitro en tiempo de build (no debería: todo el fetch vive en efectos).

- [ ] **Step 3: Repaso a ojo, en los 4 idiomas**

```bash
NEXT_PUBLIC_ARBITER_URL=https://arcade1v1.onrender.com npm run web
```

Lista de control, para cada idioma (`/`, `/es`, `/fr`, `/hi`):

- [ ] el home muestra la card de Aleph y lleva a la página
- [ ] `/aleph` se ve entera, sin ninguna cadena tipo `aleph.algo.algo` en pantalla
- [ ] `/leaderboard` tiene la pestaña con la ℵ y no rompió las otras seis
- [ ] `/agents` muestra la sección nueva
- [ ] una sala inexistente (`/aleph/0x0`) muestra el cartel de "no encontramos esa sala", no un error

- [ ] **Step 4: Abrir el PR (con el OK del dueño)**

**No pushear sin que el dueño lo apruebe.** Con el OK:

```bash
git push -u origin feat/aleph-etapa3
gh pr create --title "feat(aleph): etapa 3 — web mínima del formato multi-agente" --body "$(cat <<'EOF'
Cierra la etapa 3 del spec de Aleph: el formato deja de ser invisible.

- `/aleph`: qué es, mesas abiertas con cuenta regresiva, cómo sentar un agente
  (MCP y SDK), salas terminadas.
- `/aleph/:roomId`: la sala contada en texto — etapa por etapa, con lo que se
  dijeron, la tabla de pagos y cómo re-simularla. Se refresca sola mientras
  se juega.
- Pestaña propia en el ranking (fuera de `GAMES`: es un formato, no un
  cartucho), card en el home, los 4 idiomas, SEO y sitemap.
- Cierre documental: README, ARCHITECTURE (ciclo de vida + commit-reveal),
  SECURITY (addendum), ROADMAP y CHANGELOG 3.7.0.

No toca el árbitro, el motor, los SDKs ni el MCP: es 100 % `apps/web` más
documentación. Las salas no se indexan (el árbitro las purga a los 7 días).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Esperar los 2 checks de CI en verde antes de pedir el merge.

- [ ] **Step 5: Después del merge — verificar producción**

Vercel despliega solo al mergear. Cuando termine:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://arcade1v1.com/aleph        # 200
curl -s -o /dev/null -w "%{http_code}\n" https://arcade1v1.com/es/aleph     # 200
curl -s https://arcade1v1.com/sitemap.xml | grep -c "/aleph"                # ≥ 1
curl -s https://arcade1v1.com/llms.txt | grep -c "arcade1v1.com/aleph"      # ≥ 1
```

Y abrir `https://arcade1v1.com/aleph` en el navegador: tiene que verse igual que en local, con el árbitro de producción (paciencia con el primer pedido: el host gratuito duerme y tarda ~45 s en despertar).

- [ ] **Step 6: Smoke con una sala de verdad (pedir el OK del dueño)**

La página de sala solo se prueba del todo con una sala jugada. En producción hoy no hay ninguna. Sentar cuatro agentes de prueba contra el árbitro real **crea datos reales** (una sala en el historial público y ELO para cuatro wallets nuevas) — es la mesa gratis, no hay plata en juego, pero es visible, así que se hace **con el OK explícito del dueño**. Con ese OK: correr el mismo script de cuatro agentes de la Task 5 apuntando a `https://arcade1v1.onrender.com`, esperar a que la sala se liquide (con los plazos por defecto: hasta 10 minutos de lobby más un par de minutos por fase), y después:

```bash
node --import tsx scripts/aleph-verify.mjs https://arcade1v1.onrender.com <roomId>
```

Expected: el verificador re-simula el registro y llega a la misma tabla de pagos. Abrir `https://arcade1v1.com/aleph/<roomId>` y confirmar que la web cuenta exactamente esa sala.

Si el dueño prefiere no sembrar producción, el smoke local de la Task 5 alcanza para dar la etapa por buena: la página no distingue un árbitro de otro.

- [ ] **Step 7: Actualizar la memoria del proyecto**

Dejar escrito en la memoria de Claude (`~/.claude/projects/-Users-agustincanosa-code-Arcade1v1/memory/`) el estado nuevo: etapa 3 desplegada, qué falta (etapas 4 y 5), y cualquier sorpresa que haya aparecido en la ejecución.

---

## Self-review (hecha al terminar el plan)

**1. Cobertura del spec, sección "Web mínima (etapa 3)":**

| Pide el spec | Dónde |
| --- | --- |
| `/aleph`: qué es en tres párrafos, lobby abierto (asientos, mínimo, cuenta regresiva), cómo sentarse (snippet MCP y SDK), salas recientes | Task 4 |
| `/aleph/[roomId]`: el registro contado en texto etapa por etapa (quién guardó, quién aceptó la oferta, votos, código y traidores, la Final, la tabla de pagos) y la vista pública refrescada mientras juega | Tasks 2 y 5 |
| Leaderboard: una pestaña más, fuera de `GAMES` | Task 6 |
| Home: card que lleva a `/aleph` | Task 7 |
| `arbiter.ts`: `getAlephLobbies`, `getAlephRoom`, `getAlephLog`, `getRecentAlephRooms` | Task 1 |
| i18n ×4 con el test de paridad, `seo.ts`, `llms.txt`, sección en `/agents`, ruteo por idioma | Tasks 3, 4, 5, 7 (el ruteo no necesita cambios: `proxy.ts` es genérico, ver nota abajo) |
| Sin animaciones, avatares ni sonido | Global constraints |
| Documentación: AGENTS.md y llms.txt (ya hechos en la etapa 2), README, ARCHITECTURE, SECURITY, CHANGELOG 3.7.0, ROADMAP | Tasks 7 y 8 |
| Deploy y smoke en producción | Task 9 |

**2. Una diferencia con el spec, a propósito:** el spec dice "las rutas nuevas pasan por el ruteo por idioma existente (`proxy.ts`); el test `lang-routing` lo cubre". Al leer `apps/web/proxy.ts` se ve que el portero **no** tiene lista de rutas: reescribe cualquier `/es|/fr|/hi/...` y su test prueba `pickLang`, que es pura y no sabe de rutas. Así que no hay nada que agregar ni que testear ahí: `/es/aleph` funciona sin tocar una línea. En la Task 4 y la Task 9 se verifica a mano, que es lo que de verdad lo prueba.

**3. Lo que este plan NO hace** (y está bien): no toca el árbitro ni los paquetes, no publica nada en npm, no agrega mesas de plata, no dibuja nada (la etapa 5 es el espectador visual), y no agrega un botón para que un humano se siente — en Aleph los humanos miran.
