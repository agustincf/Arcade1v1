# La Bóveda — Etapa 1 (motor + árbitro + API) Implementation Plan

> **Nota (2026-09-06):** el formato se renombró a **Aleph**; este documento conserva el nombre original "La Bóveda" por ser un registro histórico de una etapa ya cerrada.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquier script pueda sentarse en una sala de La Bóveda (mesa gratis, 4–8 asientos), jugarla entera por HTTP contra el árbitro y terminar con una tabla de pagos verificable por re-simulación y un ELO propio.

**Architecture:** El motor es un módulo puro y determinístico del `game-sdk` (`vault.ts` + `vault-rules.ts`): estado + eventos → estado nuevo, sin relojes ni azar propio (todo sale de la semilla). El árbitro (`apps/server/src/vault.ts`) guarda salas con su registro de eventos, deriva el estado re-simulando, decide los cierres de fase con su reloj, verifica firmas y liquida (tabla de pagos + ELO multi-jugador). Las rutas (`vault-routes.ts`) son una capa fina sobre eso.

**Tech Stack:** TypeScript estricto, Node 24, `node:test` + `node:assert/strict` (corridos con `node --import tsx --test`), Express 5, viem (`keccak256`, `recoverMessageAddress`, cuentas de prueba), `mulberry32` del propio `game-sdk`.

**Spec:** `docs/superpowers/specs/2026-09-05-la-boveda-design.md` (leerlo entero antes de empezar; este plan implementa sus secciones "Reglas", "Verificación y confianza", "Motor", "Árbitro", "Vista por jugador", "Firma de acciones", "Knobs" y "Tests", restringido a la **etapa 1**).

## Global Constraints

- Rama: `feat/la-boveda` (ya existe, con el spec commiteado). **No pushear** sin OK del dueño; `main` solo recibe PRs.
- Cada tarea termina en verde: `npm run typecheck && npm run lint && npm run format:check` y los tests del archivo tocado. Antes del último commit: `npm run check` completo (incluye `npm test` y `npm run selftest`).
- Estilo del repo: comentarios y docs en **español**; mensajes de error de la API en **inglés** corto (como `match not found`, `bad signature`); addresses siempre normalizadas a minúsculas; imports relativos dentro del `game-sdk` sin extensión (`./replay`), en `apps/server` con `.js` (`./ratings.js`).
- El motor (`packages/game-sdk/src/vault*.ts`) **no** usa `Date.now`, `Math.random`, ni dependencias externas. Todas las constantes de reglas viven en `VAULT_RULES` (no en env). `VAULT_RULES_V = 1`.
- Los porcentajes se aplican sobre el pozo actual con `Math.floor(pot * bps / 10000)`.
- Invariante que todo test del motor verifica: `pot + box + Σ pocket === potInitial` después de cada evento; la tabla de pagos suma `potInitial`.
- Errores esperables del árbitro se lanzan como `VaultError` (→ HTTP 400); cualquier otro error es 500 y se loguea.
- En esta etapa **solo la mesa gratis** (stake 0): el árbitro rechaza cualquier otro stake; el knob `VAULT_STAKES` del spec llega con la etapa 4 (contrato).
- Commits chicos y frecuentes, mensajes en español con prefijo (`feat(vault): …`, `test(vault): …`) y el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Prettier formatea todo (`npm run format` antes de commitear si `format:check` falla).

## File structure

| Archivo                                           | Responsabilidad                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/game-sdk/src/vault-rules.ts` (nuevo)    | Vocabulario compartido: constantes `VAULT_RULES`, tipos de acción/evento, `actionLine`, `validateAction` |
| `packages/game-sdk/src/vault.ts` (nuevo)          | Motor: `createVault`, `applyEvent`, `phaseComplete`, `replayVault`, `viewFor`; re-exporta `vault-rules`  |
| `packages/game-sdk/src/auth.ts` (modificar)       | `vaultActionAuthMessage` (mensaje canónico que firma cada acción)                                        |
| `packages/game-sdk/src/rules.ts` (modificar)      | `RULES_V.vault`                                                                                          |
| `packages/game-sdk/package.json` (modificar)      | subpath `./vault`                                                                                        |
| `scripts/publish-sdk.mjs` (modificar)             | `ENTRIES["game-sdk"]` suma `"vault"` (la publicación real es etapa 2)                                    |
| `packages/game-sdk/test/vault-rules.test.ts`      | vocabulario + mensaje de firma                                                                           |
| `packages/game-sdk/test/vault.test.ts`            | motor: mazo, acciones, cada etapa, director, abandono                                                    |
| `packages/game-sdk/test/vault-invariants.test.ts` | propiedad (conservación + re-simulación) y anti-fuga de la vista                                         |
| `apps/server/src/ratings.ts` (modificar)          | `applyMultiResult` (ELO N jugadores, `K/(N−1)`)                                                          |
| `apps/server/src/vault.ts` (nuevo)                | Salas: lobby, arranque, acciones firmadas, cierres de fase, liquidación, persistencia, ticker            |
| `apps/server/src/vault-routes.ts` (nuevo)         | Rutas HTTP `/vault/*`                                                                                    |
| `apps/server/src/index.ts` (modificar)            | montar rutas, discovery, `restoreVault`, `startVaultTicker`                                              |
| `apps/server/test/ratings-multi.test.ts`          | ELO multi                                                                                                |
| `apps/server/test/vault-lobby.test.ts`            | lobby, límites, disolución, persistencia del lobby                                                       |
| `apps/server/test/vault-game.test.ts`             | sala completa in-process, firmas, plazos con reloj inyectado, persistencia a mitad, ELO, log             |
| `apps/server/test/vault-routes.test.ts`           | HTTP con `REQUIRE_AUTH=true`                                                                             |
| `scripts/vault-verify.mjs` (nuevo)                | Verificador público: compromiso, firmas y re-simulación de una sala                                      |
| `docs/CONFIGURATION.md` (modificar)               | Tabla de knobs `VAULT_*`                                                                                 |

---

### Task 1: Vocabulario compartido (`vault-rules.ts`) + mensaje de firma

**Files:**

- Create: `packages/game-sdk/src/vault-rules.ts`
- Modify: `packages/game-sdk/src/auth.ts` (agregar al final)
- Modify: `packages/game-sdk/src/rules.ts`
- Modify: `packages/game-sdk/package.json` (`exports`)
- Modify: `scripts/publish-sdk.mjs:17-27` (`ENTRIES["game-sdk"]`)
- Test: `packages/game-sdk/test/vault-rules.test.ts`

**Interfaces:**

- Produces: `VAULT_RULES`, `VAULT_RULES_V`, tipos `StageKind`, `Phase`, `SeatStatus`, `VaultAction`, `VaultEvent`, `PhaseEndReason`; `actionLine(a: VaultAction): string`; `validateAction(raw: unknown): VaultAction`; `vaultActionAuthMessage(roomId: string, stage: number, phase: string, line: string, ts: number): string`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/game-sdk/test/vault-rules.test.ts
// Vocabulario de La Bóveda: la forma canónica de cada acción (lo que se firma)
// tiene que ser estable byte a byte, y la validación tiene que rechazar todo lo
// que el motor no sabría aplicar. Correr:
//   node --import tsx --test packages/game-sdk/test/vault-rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionLine, validateAction, VAULT_RULES, VAULT_RULES_V } from "@arcade1v1/game-sdk/vault";
import { vaultActionAuthMessage } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";

const ADDR = "0xABCDef0000000000000000000000000000000001";

test("actionLine: forma canónica, addresses en minúsculas", () => {
  assert.equal(actionLine({ type: "keep" }), "keep");
  assert.equal(actionLine({ type: "vote", target: ADDR }), `vote:${ADDR.toLowerCase()}`);
  assert.equal(actionLine({ type: "submit", code: "0417", intent: "me" }), "submit:0417:me");
  assert.equal(actionLine({ type: "say", text: "hola" }), "say:hola");
  assert.equal(
    actionLine({ type: "whisper", to: ADDR, text: "te doy mi 7" }),
    `whisper:${ADDR.toLowerCase()}:te doy mi 7`,
  );
});

test("validateAction: acepta lo válido y normaliza addresses", () => {
  assert.deepEqual(validateAction({ type: "contribute" }), { type: "contribute" });
  assert.deepEqual(validateAction({ type: "vote", target: ADDR }), {
    type: "vote",
    target: ADDR.toLowerCase(),
  });
  assert.deepEqual(validateAction({ type: "submit", code: "12345678", intent: "all" }), {
    type: "submit",
    code: "12345678",
    intent: "all",
  });
  assert.deepEqual(validateAction({ type: "say", text: "x".repeat(VAULT_RULES.MAX_MSG_LEN) }), {
    type: "say",
    text: "x".repeat(VAULT_RULES.MAX_MSG_LEN),
  });
});

test("validateAction: rechaza forma inválida", () => {
  const bad: unknown[] = [
    null,
    "keep",
    { type: "explode" },
    { type: "vote", target: "0x123" },
    { type: "submit", code: "12a4", intent: "all" },
    { type: "submit", code: "123456789", intent: "all" },
    { type: "submit", code: "1234", intent: "maybe" },
    { type: "say", text: "" },
    { type: "say", text: "x".repeat(VAULT_RULES.MAX_MSG_LEN + 1) },
    { type: "say", text: "linea1\nlinea2" },
    { type: "whisper", to: ADDR, text: "tab\tno" },
    { type: "whisper", to: "nope", text: "hola" },
  ];
  for (const b of bad) assert.throws(() => validateAction(b), /invalid action/, JSON.stringify(b));
});

test("vaultActionAuthMessage: formato estable, room en minúsculas", () => {
  const room = "0xAB" + "cd".repeat(31);
  assert.equal(
    vaultActionAuthMessage(room, 3, "decide", "vote:0xabc", 1730000000000),
    [
      "Arcade1v1: actúo en la sala",
      `room: ${room.toLowerCase()}`,
      "stage: 3",
      "phase: decide",
      "action: vote:0xabc",
      "ts: 1730000000000",
    ].join("\n"),
  );
});

test("RULES_V conoce a vault y coincide con VAULT_RULES_V", () => {
  assert.equal(RULES_V.vault, VAULT_RULES_V);
  assert.equal(VAULT_RULES.MIN_SEATS, 4);
  assert.equal(VAULT_RULES.MAX_SEATS, 8);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --import tsx --test packages/game-sdk/test/vault-rules.test.ts`
Expected: FAIL (no resuelve `@arcade1v1/game-sdk/vault`).

- [ ] **Step 3: Crear `vault-rules.ts`**

```ts
// packages/game-sdk/src/vault-rules.ts
// VOCABULARIO de La Bóveda (formato multi-agente): constantes de reglas, tipos
// de acción/evento y la forma canónica que se FIRMA. Lo comparten el motor, el
// árbitro y los SDKs, así nadie deriva una línea distinta de la misma acción
// (sin drift = las firmas verifican). Sin dependencias, sin reloj, sin azar.

/** Versión de reglas. Cambiar cualquier constante de VAULT_RULES es cambiar de
 *  versión: el árbitro y los clientes la comparan como en RULES_V. */
export const VAULT_RULES_V = 1;

/** Reglas numéricas. NO son variables de entorno: son las reglas del juego. */
export const VAULT_RULES = {
  UNITS_PER_SEAT: 1000, // unidades que aporta cada asiento
  BOX_BPS: 2000, // caja del demonio inicial (20 % del total)
  DECAY_BPS: 500, // el pozo pierde 5 % por etapa (a la caja)
  SHARE_BPS: 500, // Reparto: la parte que se ofrece (5 % del pozo)
  SHARE_BONUS_BPS: 250, // Reparto: premio por cada uno que aporta (de la caja)
  OFFER_MIN_BPS: 1000, // Oferta del demonio: mínimo 10 %
  OFFER_MAX_BPS: 2500, // máximo 25 %
  OFFER_STEP_BPS: 100, // en pasos de 1 %
  OFFER_VOID_BURN_BPS: 1000, // si aceptan todos: se anula y se quema 10 %
  LOCK_BONUS_BPS: 2000, // Cerradura abierta para todos: +20 % (de la caja)
  LOCK_TRAITOR_BPS: 1000, // traidores: se reparten 10 % del pozo
  LOCK_FAIL_BURN_BPS: 1000, // nadie acierta: se quema 10 %
  MAX_MSG_LEN: 280, // caracteres por mensaje
  MAX_MSGS_PER_PHASE: 3, // mensajes por jugador por fase
  MAX_ABSENCES: 2, // ausencias seguidas antes de abandonar
  MIN_SEATS: 4,
  MAX_SEATS: 8,
} as const;

export type StageKind = "share" | "offer" | "vote" | "lock" | "final";
export type Phase = "talk" | "decide";
export type SeatStatus = "alive" | "left" | "voted_out" | "abandoned" | "finished";
export type PhaseEndReason = "deadline" | "all_acted" | "all_ready";

export type VaultAction =
  | { type: "keep" }
  | { type: "contribute" }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "vote"; target: string }
  | { type: "submit"; code: string; intent: "all" | "me" }
  | { type: "split" }
  | { type: "steal" }
  | { type: "ready" }
  | { type: "say"; text: string }
  | { type: "whisper"; to: string; text: string };

export type VaultEvent =
  | {
      type: "action";
      address: string;
      stage: number;
      phase: Phase;
      action: VaultAction;
      ts: number;
      signature?: string;
    }
  | { type: "phase_end"; stage: number; phase: Phase; at: number; reason: PhaseEndReason };

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const CODE_RE = /^[0-9]{1,8}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SIMPLE = new Set(["keep", "contribute", "accept", "decline", "split", "steal", "ready"]);

/** Forma canónica de una acción: la línea que se firma y se guarda. */
export function actionLine(a: VaultAction): string {
  switch (a.type) {
    case "vote":
      return `vote:${a.target.toLowerCase()}`;
    case "submit":
      return `submit:${a.code}:${a.intent}`;
    case "say":
      return `say:${a.text}`;
    case "whisper":
      return `whisper:${a.to.toLowerCase()}:${a.text}`;
    default:
      return a.type;
  }
}

function text(v: unknown): string {
  if (typeof v !== "string" || v.length < 1 || v.length > VAULT_RULES.MAX_MSG_LEN) {
    throw new Error(`invalid action: text must be 1..${VAULT_RULES.MAX_MSG_LEN} chars`);
  }
  if (CONTROL_RE.test(v)) throw new Error("invalid action: text has control characters");
  return v;
}

function address(v: unknown): string {
  const a = String(v ?? "").toLowerCase();
  if (!ADDRESS_RE.test(a)) throw new Error("invalid action: bad address");
  return a;
}

/** Valida la FORMA de una acción recibida de afuera (JSON) y la normaliza.
 *  Lo que depende del estado (¿está vivo el destino? ¿largo del código?) lo
 *  chequea el motor al aplicarla. */
export function validateAction(raw: unknown): VaultAction {
  if (!raw || typeof raw !== "object") throw new Error("invalid action: not an object");
  const r = raw as Record<string, unknown>;
  const type = String(r.type ?? "");
  if (SIMPLE.has(type)) return { type } as VaultAction;
  switch (type) {
    case "vote":
      return { type, target: address(r.target) };
    case "submit": {
      const code = String(r.code ?? "");
      if (!CODE_RE.test(code)) throw new Error("invalid action: code must be 1..8 digits");
      if (r.intent !== "all" && r.intent !== "me") {
        throw new Error("invalid action: intent must be all|me");
      }
      return { type, code, intent: r.intent };
    }
    case "say":
      return { type, text: text(r.text) };
    case "whisper":
      return { type, to: address(r.to), text: text(r.text) };
    default:
      throw new Error(`invalid action: unknown type "${type}"`);
  }
}
```

- [ ] **Step 4: Agregar el mensaje de firma a `auth.ts`** (al final del archivo)

```ts
/** Mensaje a firmar por cada ACCIÓN en una sala de La Bóveda (formato
 *  multi-agente). Ata: sala + etapa + fase + la línea canónica de la acción
 *  (`actionLine` del subpath /vault) + momento (ts, válido MATCHMAKE_AUTH_TTL_MS).
 *  Sin esto, cualquiera votaría o hablaría a nombre de otro asiento. */
export function vaultActionAuthMessage(
  roomId: string,
  stage: number,
  phase: string,
  line: string,
  ts: number,
): string {
  return [
    "Arcade1v1: actúo en la sala",
    `room: ${roomId.toLowerCase()}`,
    `stage: ${stage}`,
    `phase: ${phase}`,
    `action: ${line}`,
    `ts: ${ts}`,
  ].join("\n");
}
```

- [ ] **Step 5: Registrar la versión y el subpath**

En `packages/game-sdk/src/rules.ts`, agregar el import y la clave:

```ts
import { VAULT_RULES_V } from "./vault-rules";
// ...
export const RULES_V: Record<string, number> = {
  "2048": 1,
  tetris: 1,
  flappy: 1,
  racing: RACING_RULES_V,
  snake: SNAKE_RULES_V,
  invaders: 1,
  vault: VAULT_RULES_V, // formato multi-agente (no es cartucho 1v1)
};
```

En `packages/game-sdk/package.json`, dentro de `"exports"`, después de `"./rules"`:

```json
    "./vault": "./src/vault.ts"
```

En `scripts/publish-sdk.mjs`, agregar `"vault"` al final de la lista `ENTRIES["game-sdk"]` (después de `"rules"`).

Crear un `packages/game-sdk/src/vault.ts` mínimo para que el subpath resuelva (la Tarea 2 lo completa):

```ts
// packages/game-sdk/src/vault.ts
export * from "./vault-rules";
```

- [ ] **Step 6: Correr el test y el typecheck**

Run: `node --import tsx --test packages/game-sdk/test/vault-rules.test.ts && npm run typecheck:packages && npm run lint`
Expected: PASS (5 tests), typecheck y lint limpios.

- [ ] **Step 7: Commit**

```bash
npm run format
git add packages/game-sdk/src/vault-rules.ts packages/game-sdk/src/vault.ts packages/game-sdk/src/auth.ts packages/game-sdk/src/rules.ts packages/game-sdk/package.json scripts/publish-sdk.mjs packages/game-sdk/test/vault-rules.test.ts
git commit -m "feat(vault): vocabulario de La Bóveda — reglas, acciones canónicas y mensaje de firma

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Motor — estado inicial, mazo y arranque de etapas

**Files:**

- Modify: `packages/game-sdk/src/vault.ts` (reemplaza el archivo mínimo de la Tarea 1)
- Test: `packages/game-sdk/test/vault.test.ts` (parte 1)

**Interfaces:**

- Consumes: `VAULT_RULES`, tipos de `vault-rules.ts`; `mulberry32` de `./replay`.
- Produces: tipos `Seat`, `VaultMessage`, `Fragment`, `StageState`, `StageResult`, `VaultState`; `createVault(seed: string, seats: string[], opts?: { deck?: StageKind[] }): VaultState`; `buildDeck(n: number, rnd: () => number): StageKind[]`; `aliveSeats(s: VaultState): Seat[]`. Internos que usan las tareas siguientes: `beginStage(s, kind)`, `seatOf(s, address)`, `bps(x, b)`, `norm(a)`, `rngFor(seed, purpose, stageIndex)`.

- [ ] **Step 1: Crear los helpers compartidos de los tests del motor**

El archivo NO termina en `.test.ts` (así `npm test` no lo corre como suite) y lo
importan los tres tests del motor.

```ts
// packages/game-sdk/test/vault-helpers.ts
// Helpers compartidos por los tests del motor de La Bóveda.
import {
  applyEvent,
  type VaultAction,
  type VaultState,
  type PhaseEndReason,
} from "@arcade1v1/game-sdk/vault";

export const SEED = "0x" + "5eed".repeat(16);
export const A = (i: number) => "0x" + i.toString(16).padStart(40, "0");
export const seats = (n: number) => Array.from({ length: n }, (_, i) => A(i + 1));
/** Semillas variadas y reproducibles (64 hex). */
export const seedN = (i: number) =>
  "0x" +
  Array.from({ length: 64 }, (_, j) => ((i * 31 + j * 17 + i * j) % 16).toString(16)).join("");

/** Aplica una acción de `address` en la etapa/fase ACTUAL del estado. */
export function act(s: VaultState, address: string, action: VaultAction): VaultState {
  return applyEvent(s, {
    type: "action",
    address,
    stage: s.stage.index,
    phase: s.stage.phase,
    action,
    ts: 0,
  });
}

/** Cierra la fase actual (por defecto, por vencimiento del plazo). */
export function end(s: VaultState, reason: PhaseEndReason = "deadline"): VaultState {
  return applyEvent(s, {
    type: "phase_end",
    stage: s.stage.index,
    phase: s.stage.phase,
    at: 0,
    reason,
  });
}

/** Si la etapa está en charla, la cierra; devuelve el estado en `decide`. */
export function skipTalk(s: VaultState): VaultState {
  return s.stage.phase === "talk" ? end(s) : s;
}

/** Todos los vivos deciden lo mismo y se cierra la fase. */
export function allDecide(s: VaultState, action: VaultAction): VaultState {
  let cur = skipTalk(s);
  for (const seat of cur.seats) if (seat.status === "alive") cur = act(cur, seat.address, action);
  return end(cur, "all_acted");
}

/** Conservación: en todo momento pot + box + Σ pocket === potInitial, sin negativos. */
export function assertConserved(s: VaultState): void {
  const pockets = s.seats.reduce((acc, x) => acc + x.pocket, 0);
  if (s.pot + s.box + pockets !== s.potInitial) {
    throw new Error(
      `conservación rota: pot ${s.pot} + box ${s.box} + pockets ${pockets} != ${s.potInitial}`,
    );
  }
  if (s.pot < 0 || s.box < 0 || s.seats.some((x) => x.pocket < 0))
    throw new Error("valor negativo");
}
```

`applyEvent` recién existe en la Tarea 3: hasta entonces este archivo no compila
solo, pero `vault.test.ts` no lo necesita todavía más que por `SEED`, `A`,
`seats` y `seedN`. Para que la Tarea 2 quede en verde, creá el helper **sin**
las funciones `act`/`end`/`skipTalk`/`allDecide`/`assertConserved` ni el import
de `applyEvent`, y agregalas en la Tarea 3 (Step 3 de esa tarea lo repite).

- [ ] **Step 2: Escribir los tests que fallan**

```ts
// packages/game-sdk/test/vault.test.ts
// Motor de La Bóveda. Todo es determinístico por semilla: el árbitro y
// cualquiera que lea el registro público tienen que re-simular EXACTAMENTE lo
// mismo. Correr: node --import tsx --test packages/game-sdk/test/vault.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVault, aliveSeats, type StageKind } from "@arcade1v1/game-sdk/vault";
import { SEED, A, seats, seedN } from "./vault-helpers";

test("createVault: dinero inicial, primera etapa Reparto y asientos vivos", () => {
  const s = createVault(SEED, seats(4));
  assert.equal(s.potInitial, 4000);
  assert.equal(s.box, 800);
  assert.equal(s.pot, 3200);
  assert.equal(s.stage.kind, "share");
  assert.equal(s.stage.phase, "decide");
  assert.equal(s.stage.index, 0);
  assert.equal(s.stage.share, 160); // 5 % de 3200
  assert.equal(s.stage.shareBonus, 80); // 2,5 % de 3200
  assert.equal(aliveSeats(s).length, 4);
  assert.deepEqual([...s.tiebreak].sort(), seats(4));
  assert.equal(s.over, false);
  assert.deepEqual(s.results, []);
});

test("createVault: rechaza asientos o semilla inválidos", () => {
  assert.throws(() => createVault(SEED, seats(3)), /invalid seats/);
  assert.throws(() => createVault(SEED, seats(9)), /invalid seats/);
  assert.throws(() => createVault(SEED, [A(1), A(1), A(2), A(3)]), /invalid seats/);
  assert.throws(() => createVault(SEED, ["nope", A(2), A(3), A(4)]), /invalid seats/);
  assert.throws(() => createVault("0x1234", seats(4)), /invalid seed/);
});

test("mazo: composición por N, sin dos Ofertas seguidas, determinístico", () => {
  for (const n of [4, 5, 6, 7, 8]) {
    for (let i = 0; i < 60; i++) {
      const deck = createVault(seedN(i * 8 + n), seats(n)).deck;
      const count = (k: StageKind) => deck.filter((c) => c === k).length;
      assert.equal(deck.length, n + 2, `N=${n} seed=${i}`);
      assert.equal(count("offer"), 2);
      assert.equal(count("lock"), 1);
      assert.equal(count("share"), 1);
      assert.equal(count("vote"), n - 2);
      for (let j = 1; j < deck.length; j++) {
        assert.ok(
          !(deck[j] === "offer" && deck[j - 1] === "offer"),
          `ofertas seguidas: ${deck.join(",")}`,
        );
      }
    }
  }
  assert.deepEqual(createVault(SEED, seats(6)).deck, createVault(SEED, seats(6)).deck);
  const base = createVault(seedN(1), seats(8)).deck.join(",");
  const others = Array.from({ length: 20 }, (_, i) =>
    createVault(seedN(i + 2), seats(8)).deck.join(","),
  );
  assert.ok(
    others.some((d) => d !== base),
    "semillas distintas deberían barajar distinto",
  );
});

test("createVault con mazo forzado (para tests) lo respeta y valida", () => {
  const s = createVault(SEED, seats(4), { deck: ["offer", "lock"] });
  assert.deepEqual(s.deck, ["offer", "lock"]);
  assert.throws(() => createVault(SEED, seats(4), { deck: ["final"] }), /invalid deck/);
});
```

- [ ] **Step 3: Correr para verificar que falla**

Run: `node --import tsx --test packages/game-sdk/test/vault.test.ts`
Expected: FAIL (`createVault` no existe).

- [ ] **Step 4: Escribir `vault.ts` (estado, mazo, arranque de etapas)**

```ts
// packages/game-sdk/src/vault.ts
// MOTOR de La Bóveda (formato multi-agente): una sala compartida de 4 a 8
// asientos con pozo único, etapas sorteadas de un mazo y una tabla de pagos al
// final. Es PURO y DETERMINÍSTICO: el estado siguiente depende solo del estado
// anterior y del evento; todo el azar sale de la semilla secreta. Así el
// árbitro opera re-simulando el registro, y cualquiera puede verificarlo.
//
// Vocabulario (constantes, acciones, forma canónica): ./vault-rules.
import { mulberry32 } from "./replay";
import {
  VAULT_RULES as R,
  VAULT_RULES_V,
  type VaultAction,
  type VaultEvent,
  type StageKind,
  type Phase,
  type SeatStatus,
} from "./vault-rules";

export * from "./vault-rules";

export interface Seat {
  address: string;
  status: SeatStatus;
  pocket: number; // lo que ya aseguró (público)
  absences: number; // ausencias SEGUIDAS en decisiones
  votesReceived: number; // votos acumulados (criterio de desempate)
}

export interface VaultMessage {
  from: string;
  to?: string; // sin `to` = público
  text: string;
  stage: number;
  phase: Phase;
}

export interface Fragment {
  pos: number;
  digit: string;
}

export interface StageState {
  index: number;
  kind: StageKind;
  phase: Phase;
  // números públicos de la etapa
  share?: number;
  shareBonus?: number;
  offerBps?: number;
  offerTotal?: number;
  codeLength?: number;
  // secretos (la vista nunca los expone)
  code?: string;
  fragments?: Record<string, Fragment>;
  decisions: Record<string, VaultAction>; // decisiones pendientes de esta fase
  ready: string[]; // quiénes mandaron `ready` en esta fase
  msgCount: Record<string, number>; // mensajes por asiento en esta fase
}

/** Lo que se REVELA al cerrar cada etapa (público). Quién votó a quién no está
 *  acá a propósito: queda en el registro de eventos, que se abre al final. */
export interface StageResult {
  index: number;
  kind: StageKind;
  kept?: string[];
  contributed?: string[];
  bonus?: number;
  offerBps?: number;
  accepted?: string[];
  eachGot?: number;
  voided?: boolean;
  votes?: Record<string, number>;
  eliminated?: string;
  code?: string;
  solvers?: string[];
  traitors?: string[];
  failed?: boolean;
  choices?: Record<string, "split" | "steal">;
  abandoned?: string[];
  decay?: number;
  potAfter: number;
  boxAfter: number;
}

export interface VaultState {
  rulesV: number;
  seed: string; // secreta hasta el final (el árbitro la filtra)
  seats: Seat[];
  pot: number;
  box: number; // la caja del demonio
  potInitial: number;
  deck: StageKind[]; // cartas que faltan (secreto)
  tiebreak: string[]; // orden oculto de desempate
  stage: StageState;
  results: StageResult[];
  messages: VaultMessage[];
  over: boolean;
  payouts?: Record<string, number>;
}

export const bps = (x: number, b: number) => Math.floor((x * b) / 10000);
export const norm = (a: string) => a.toLowerCase();
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/** Trozo de 32 bits número `i` (0..7) de la semilla de 32 bytes. */
function chunk(seed: string, i: number): number {
  const h = seed.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("invalid seed: expected 32 bytes hex");
  return parseInt(h.slice(i * 8, i * 8 + 8), 16) >>> 0;
}

/** RNG por PROPÓSITO (0 mazo, 1 ofertas, 2 códigos, 3 desempate) y por etapa:
 *  misma semilla + misma etapa => misma secuencia, sin contadores en el estado. */
export function rngFor(seed: string, purpose: number, stageIndex: number): () => number {
  return mulberry32((chunk(seed, purpose) ^ Math.imul(stageIndex + 1, 0x9e3779b1)) >>> 0);
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** La bolsa: 2 Ofertas, 1 Cerradura, 1 Reparto y (N − 2) Votos, barajada.
 *  Regla de sanidad: nunca dos Ofertas seguidas (la segunda se mueve a la
 *  primera posición no adyacente a la primera Oferta). */
export function buildDeck(n: number, rnd: () => number): StageKind[] {
  const bag: StageKind[] = ["offer", "offer", "lock", "share"];
  for (let i = 0; i < n - 2; i++) bag.push("vote");
  const deck = shuffle(bag, rnd);
  const first = deck.indexOf("offer");
  const second = deck.indexOf("offer", first + 1);
  if (second === first + 1) {
    const q = deck.findIndex((c, idx) => c !== "offer" && Math.abs(idx - first) > 1);
    [deck[second], deck[q]] = [deck[q], deck[second]];
  }
  return deck;
}

export function aliveSeats(s: VaultState): Seat[] {
  return s.seats.filter((x) => x.status === "alive");
}

export function seatOf(s: VaultState, address: string): Seat | undefined {
  const a = norm(address);
  return s.seats.find((x) => x.address === a);
}

/** Arranca una etapa: calcula sus números con la semilla y el índice, y abre
 *  su primera fase (charla si la etapa la tiene, si no directo a decidir). */
export function beginStage(s: VaultState, kind: StageKind): void {
  const index = s.results.length;
  const st: StageState = {
    index,
    kind,
    phase: kind === "share" || kind === "offer" ? "decide" : "talk",
    decisions: {},
    ready: [],
    msgCount: {},
  };
  if (kind === "share") {
    st.share = bps(s.pot, R.SHARE_BPS);
    st.shareBonus = bps(s.pot, R.SHARE_BONUS_BPS);
  }
  if (kind === "offer") {
    const rnd = rngFor(s.seed, 1, index);
    const steps = (R.OFFER_MAX_BPS - R.OFFER_MIN_BPS) / R.OFFER_STEP_BPS + 1;
    st.offerBps = R.OFFER_MIN_BPS + R.OFFER_STEP_BPS * Math.floor(rnd() * steps);
    st.offerTotal = bps(s.pot, st.offerBps);
  }
  if (kind === "lock") {
    const rnd = rngFor(s.seed, 2, index);
    const fragments: Record<string, Fragment> = {};
    let code = "";
    aliveSeats(s).forEach((seat, pos) => {
      const digit = String(Math.floor(rnd() * 10));
      code += digit;
      fragments[seat.address] = { pos, digit };
    });
    st.fragments = fragments;
    st.code = code;
    st.codeLength = code.length;
  }
  s.stage = st;
}

const DECK_KINDS = new Set<StageKind>(["share", "offer", "vote", "lock"]);

/** Estado inicial de una sala. `opts.deck` fuerza el mazo (solo tests). */
export function createVault(
  seed: string,
  seats: string[],
  opts: { deck?: StageKind[] } = {},
): VaultState {
  const addrs = seats.map(norm);
  const unique = new Set(addrs).size === addrs.length;
  if (
    addrs.length < R.MIN_SEATS ||
    addrs.length > R.MAX_SEATS ||
    !unique ||
    addrs.some((a) => !ADDRESS_RE.test(a))
  ) {
    throw new Error(`invalid seats: ${R.MIN_SEATS}..${R.MAX_SEATS} unique addresses`);
  }
  if (opts.deck && opts.deck.some((k) => !DECK_KINDS.has(k))) throw new Error("invalid deck");
  const potInitial = R.UNITS_PER_SEAT * addrs.length;
  const box = bps(potInitial, R.BOX_BPS);
  const s: VaultState = {
    rulesV: VAULT_RULES_V,
    seed,
    seats: addrs.map((address) => ({
      address,
      status: "alive",
      pocket: 0,
      absences: 0,
      votesReceived: 0,
    })),
    pot: potInitial - box,
    box,
    potInitial,
    deck: opts.deck ? opts.deck.slice() : buildDeck(addrs.length, rngFor(seed, 0, -1)),
    tiebreak: shuffle(addrs, rngFor(seed, 3, -1)),
    stage: { index: 0, kind: "share", phase: "decide", decisions: {}, ready: [], msgCount: {} },
    results: [],
    messages: [],
    over: false,
  };
  beginStage(s, "share");
  return s;
}
```

- [ ] **Step 5: Correr tests + typecheck**

Run: `node --import tsx --test packages/game-sdk/test/vault.test.ts && npm run typecheck:packages && npm run lint`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
npm run format
git add packages/game-sdk/src/vault.ts packages/game-sdk/test/vault.test.ts packages/game-sdk/test/vault-helpers.ts
git commit -m "feat(vault): motor — estado inicial, caja del demonio, mazo sin Ofertas seguidas y arranque de etapas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Motor — acciones, cierre de fases, resolución de etapas y director

**Files:**

- Modify: `packages/game-sdk/src/vault.ts` (agregar al final)
- Modify: `packages/game-sdk/test/vault-helpers.ts` (completar)
- Test: `packages/game-sdk/test/vault.test.ts` (parte 2)

**Interfaces:**

- Consumes: todo lo de la Tarea 2.
- Produces: `applyEvent(prev: VaultState, ev: VaultEvent): VaultState` (lanza si el evento es inválido; nunca muta `prev`); `phaseComplete(s: VaultState): "all_acted" | "all_ready" | null`. Internos: `endPhase`, `resolveShare/Offer/Vote/Lock/Final`, `direct`, `finish`.

- [ ] **Step 1: Completar `vault-helpers.ts`** (versión final; reemplaza la de la Tarea 2)

```ts
// packages/game-sdk/test/vault-helpers.ts
// Helpers compartidos por los tests del motor de La Bóveda.
import {
  applyEvent,
  type VaultAction,
  type VaultState,
  type PhaseEndReason,
} from "@arcade1v1/game-sdk/vault";

export const SEED = "0x" + "5eed".repeat(16);
export const A = (i: number) => "0x" + i.toString(16).padStart(40, "0");
export const seats = (n: number) => Array.from({ length: n }, (_, i) => A(i + 1));
/** Semillas variadas y reproducibles (64 hex). */
export const seedN = (i: number) =>
  "0x" +
  Array.from({ length: 64 }, (_, j) => ((i * 31 + j * 17 + i * j) % 16).toString(16)).join("");

/** Aplica una acción de `address` en la etapa/fase ACTUAL del estado. */
export function act(s: VaultState, address: string, action: VaultAction): VaultState {
  return applyEvent(s, {
    type: "action",
    address,
    stage: s.stage.index,
    phase: s.stage.phase,
    action,
    ts: 0,
  });
}

/** Cierra la fase actual (por defecto, por vencimiento del plazo). */
export function end(s: VaultState, reason: PhaseEndReason = "deadline"): VaultState {
  return applyEvent(s, {
    type: "phase_end",
    stage: s.stage.index,
    phase: s.stage.phase,
    at: 0,
    reason,
  });
}

/** Si la etapa está en charla, la cierra; devuelve el estado en `decide`. */
export function skipTalk(s: VaultState): VaultState {
  return s.stage.phase === "talk" ? end(s) : s;
}

/** Todos los vivos deciden lo mismo y se cierra la fase. */
export function allDecide(s: VaultState, action: VaultAction): VaultState {
  let cur = skipTalk(s);
  for (const seat of cur.seats) if (seat.status === "alive") cur = act(cur, seat.address, action);
  return end(cur, "all_acted");
}

/** Conservación: en todo momento pot + box + Σ pocket === potInitial, sin negativos. */
export function assertConserved(s: VaultState): void {
  const pockets = s.seats.reduce((acc, x) => acc + x.pocket, 0);
  if (s.pot + s.box + pockets !== s.potInitial) {
    throw new Error(
      `conservación rota: pot ${s.pot} + box ${s.box} + pockets ${pockets} != ${s.potInitial}`,
    );
  }
  if (s.pot < 0 || s.box < 0 || s.seats.some((x) => x.pocket < 0)) {
    throw new Error("valor negativo");
  }
}
```

- [ ] **Step 2: Escribir los tests que fallan** (agregar a `vault.test.ts`; sumar al import de arriba `applyEvent, phaseComplete, seatOf, VAULT_RULES` y de los helpers `act, end, skipTalk, allDecide, assertConserved`)

```ts
test("acciones: decisión única y del tipo de la etapa; mensajes con tope; susurro válido", () => {
  let s = createVault(SEED, seats(4));
  s = act(s, A(1), { type: "keep" });
  assert.deepEqual(s.stage.decisions[A(1)], { type: "keep" });
  assert.throws(() => act(s, A(1), { type: "contribute" }), /already decided/);
  assert.throws(() => act(s, A(2), { type: "accept" }), /not allowed now/);
  assert.throws(() => act(s, A(2), { type: "ready" }), /ready not allowed/);
  assert.throws(() => act(s, A(9), { type: "keep" }), /not a seat/);
  for (let i = 0; i < VAULT_RULES.MAX_MSGS_PER_PHASE; i++) {
    s = act(s, A(2), { type: "say", text: `m${i}` });
  }
  assert.throws(() => act(s, A(2), { type: "say", text: "de más" }), /message limit/);
  assert.throws(
    () => act(s, A(3), { type: "whisper", to: A(3), text: "yo" }),
    /invalid whisper target/,
  );
  s = act(s, A(3), { type: "whisper", to: A(4), text: "psst" });
  assert.equal(s.messages.length, 4);
  assert.deepEqual(s.messages[3], {
    from: A(3),
    to: A(4),
    text: "psst",
    stage: 0,
    phase: "decide",
  });
});

test("applyEvent no muta el estado anterior", () => {
  const s0 = createVault(SEED, seats(4));
  const s1 = act(s0, A(1), { type: "keep" });
  assert.deepEqual(s0.stage.decisions, {});
  assert.deepEqual(s1.stage.decisions, { [A(1)]: { type: "keep" } });
});

test("phaseComplete: decide cierra cuando todos los vivos decidieron", () => {
  let s = createVault(SEED, seats(4));
  assert.equal(phaseComplete(s), null);
  for (const a of seats(4).slice(0, 3)) s = act(s, a, { type: "contribute" });
  assert.equal(phaseComplete(s), null);
  s = act(s, A(4), { type: "keep" });
  assert.equal(phaseComplete(s), "all_acted");
});

test("Reparto: guardar/aportar, ausente aporta, premio de la caja, decaimiento y siguiente etapa", () => {
  let s = createVault(SEED, seats(4), { deck: ["vote"] });
  s = act(s, A(1), { type: "keep" });
  s = act(s, A(2), { type: "keep" });
  s = act(s, A(3), { type: "contribute" });
  s = end(s); // A4 ausente => aporta y suma una ausencia
  const r = s.results[0];
  assert.deepEqual(r.kept, [A(1), A(2)]);
  assert.deepEqual(r.contributed, [A(3), A(4)]);
  assert.equal(r.bonus, 160); // 2 aportantes × 80
  // pot: 3200 − 2×160 + 160 = 3040; decaimiento 5 % = 152 → 2888; caja: 800 − 160 + 152 = 792
  assert.equal(r.decay, 152);
  assert.equal(s.pot, 2888);
  assert.equal(s.box, 792);
  assert.equal(r.potAfter, 2888);
  assert.equal(r.boxAfter, 792);
  assert.equal(seatOf(s, A(1))!.pocket, 160);
  assert.equal(seatOf(s, A(4))!.absences, 1);
  assert.equal(seatOf(s, A(3))!.absences, 0);
  assertConserved(s);
  assert.equal(s.stage.kind, "vote");
  assert.equal(s.stage.phase, "talk");
  assert.equal(s.stage.index, 1);
  assert.deepEqual(s.stage.decisions, {});
});

test("charla: ready de todos la cierra; en decide, ready solo vale en la Cerradura; fase vieja se rechaza", () => {
  let s = createVault(SEED, seats(4), { deck: ["vote"] });
  s = allDecide(s, { type: "contribute" }); // → Voto, fase de charla
  assert.throws(() => act(s, A(1), { type: "vote", target: A(2) }), /not allowed now/);
  for (const a of seats(4)) s = act(s, a, { type: "ready" });
  assert.equal(phaseComplete(s), "all_ready");
  assert.throws(() => act(s, A(1), { type: "ready" }), /already decided/);
  s = end(s, "all_ready");
  assert.equal(s.stage.phase, "decide");
  assert.deepEqual(s.stage.ready, []);
  assert.throws(() => act(s, A(1), { type: "ready" }), /ready not allowed/);
  assert.throws(
    () =>
      applyEvent(s, {
        type: "action",
        address: A(1),
        stage: 1,
        phase: "talk",
        action: { type: "ready" },
        ts: 0,
      }),
    /stage or phase mismatch/,
  );
  assert.throws(() => act(s, A(1), { type: "vote", target: A(1) }), /invalid vote target/);
  assert.throws(() => act(s, A(1), { type: "vote", target: A(9) }), /invalid vote target/);
});
```

- [ ] **Step 3: Correr para verificar que falla**

Run: `node --import tsx --test packages/game-sdk/test/vault.test.ts`
Expected: FAIL (`applyEvent`/`phaseComplete` no existen).

- [ ] **Step 4: Agregar al final de `vault.ts` los eventos, la resolución y el director**

```ts
// ---------------------------------------------------------------------------
// EVENTOS: acciones de los asientos y cierres de fase del árbitro.
// ---------------------------------------------------------------------------

/** Aplica un evento y devuelve el estado NUEVO (el anterior no se toca). Lanza
 *  si el evento no vale en este estado: el árbitro lo traduce a un 400 y NO lo
 *  agrega al registro. Re-simular es aplicar el registro en orden. */
export function applyEvent(prev: VaultState, ev: VaultEvent): VaultState {
  if (prev.over) throw new Error("room already over");
  if (ev.stage !== prev.stage.index || ev.phase !== prev.stage.phase) {
    throw new Error(`stage or phase mismatch (now ${prev.stage.index}/${prev.stage.phase})`);
  }
  const s = structuredClone(prev);
  if (ev.type === "action") applyAction(s, norm(ev.address), ev.action);
  else endPhase(s);
  return s;
}

/** Qué etapa admite cada decisión. */
const DECIDE_KIND: Partial<Record<VaultAction["type"], StageKind>> = {
  keep: "share",
  contribute: "share",
  accept: "offer",
  decline: "offer",
  vote: "vote",
  submit: "lock",
  split: "final",
  steal: "final",
};

function applyAction(s: VaultState, address: string, a: VaultAction): void {
  const seat = seatOf(s, address);
  if (!seat) throw new Error("not a seat of this room");
  if (seat.status !== "alive") throw new Error(`seat not alive (${seat.status})`);
  const st = s.stage;

  if (a.type === "say" || a.type === "whisper") {
    const n = st.msgCount[address] ?? 0;
    if (n >= R.MAX_MSGS_PER_PHASE) throw new Error("message limit reached for this phase");
    let to: string | undefined;
    if (a.type === "whisper") {
      const target = seatOf(s, a.to);
      if (!target || target.status !== "alive" || target.address === address) {
        throw new Error("invalid whisper target");
      }
      to = target.address;
    }
    st.msgCount[address] = n + 1;
    s.messages.push({
      from: address,
      ...(to ? { to } : {}),
      text: a.text,
      stage: st.index,
      phase: st.phase,
    });
    return;
  }

  if (a.type === "ready") {
    // `ready` = "terminé de hablar" en charla, o "paso" en la Cerradura (la
    // única decisión opcional). En cualquier otra fase de decisión no vale.
    if (st.phase !== "talk" && st.kind !== "lock")
      throw new Error("ready not allowed in this phase");
    if (st.ready.includes(address) || st.decisions[address]) throw new Error("already decided");
    st.ready.push(address);
    return;
  }

  if (st.phase !== "decide" || DECIDE_KIND[a.type] !== st.kind) {
    throw new Error(`action ${a.type} not allowed now (${st.kind}/${st.phase})`);
  }
  if (st.decisions[address] || st.ready.includes(address)) throw new Error("already decided");
  let decision: VaultAction = a;
  if (a.type === "vote") {
    const target = seatOf(s, a.target);
    if (!target || target.status !== "alive" || target.address === address) {
      throw new Error("invalid vote target");
    }
    decision = { type: "vote", target: target.address };
  }
  if (a.type === "submit" && a.code.length !== st.codeLength) {
    throw new Error(`invalid code length (expected ${st.codeLength})`);
  }
  st.decisions[address] = decision;
}

/** ¿La fase actual ya puede cerrarse antes del plazo? (todos los vivos
 *  decidieron / mandaron ready). El árbitro agrega el `phase_end` con este motivo. */
export function phaseComplete(s: VaultState): "all_acted" | "all_ready" | null {
  if (s.over) return null;
  const st = s.stage;
  const alive = aliveSeats(s);
  if (st.phase === "talk") {
    return alive.every((x) => st.ready.includes(x.address)) ? "all_ready" : null;
  }
  const done = (x: Seat) =>
    !!st.decisions[x.address] || (st.kind === "lock" && st.ready.includes(x.address));
  return alive.every(done) ? "all_acted" : null;
}

// ---------------------------------------------------------------------------
// CIERRE DE FASE: charla → decidir; decidir → resolver la etapa + director.
// ---------------------------------------------------------------------------

function endPhase(s: VaultState): void {
  const st = s.stage;
  if (st.phase === "talk") {
    st.phase = "decide";
    st.ready = [];
    st.msgCount = {};
    return;
  }
  const r: StageResult = { index: st.index, kind: st.kind, potAfter: 0, boxAfter: 0 };
  switch (st.kind) {
    case "share":
      resolveShare(s, r);
      break;
    case "offer":
      resolveOffer(s, r);
      break;
    case "vote":
      resolveVote(s, r);
      break;
    case "lock":
      resolveLock(s, r);
      break;
    case "final":
      resolveFinal(s, r);
      break;
  }
  if (st.kind !== "final") {
    // ABANDONO: dos ausencias seguidas en decisiones → fuera, bolsillo al pozo.
    const abandoned: string[] = [];
    for (const seat of aliveSeats(s)) {
      if (seat.absences >= R.MAX_ABSENCES) {
        seat.status = "abandoned";
        s.pot += seat.pocket;
        seat.pocket = 0;
        abandoned.push(seat.address);
      }
    }
    if (abandoned.length) r.abandoned = abandoned;
    // DECAIMIENTO: el pozo pierde 5 % por etapa (presión para cerrar trato).
    const decay = bps(s.pot, R.DECAY_BPS);
    s.pot -= decay;
    s.box += decay;
    r.decay = decay;
  }
  r.potAfter = s.pot;
  r.boxAfter = s.box;
  s.results.push(r);
  direct(s);
}

/** Marca ausencia (o la corta) según haya decisión en esta fase. */
function trackAbsence(seat: Seat, decided: boolean): void {
  seat.absences = decided ? 0 : seat.absences + 1;
}

function resolveShare(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const share = st.share!;
  const kept: string[] = [];
  const contributed: string[] = [];
  for (const seat of aliveSeats(s)) {
    const d = st.decisions[seat.address];
    trackAbsence(seat, !!d);
    if (d?.type === "keep") {
      s.pot -= share;
      seat.pocket += share;
      kept.push(seat.address);
    } else {
      contributed.push(seat.address); // ausente = aporta
    }
  }
  const bonus = Math.min(s.box, contributed.length * st.shareBonus!);
  s.box -= bonus;
  s.pot += bonus;
  r.kept = kept;
  r.contributed = contributed;
  r.bonus = bonus;
}

function resolveOffer(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const alive = aliveSeats(s);
  const accepted: string[] = [];
  for (const seat of alive) {
    const d = st.decisions[seat.address];
    trackAbsence(seat, !!d);
    if (d?.type === "accept") accepted.push(seat.address);
  }
  r.offerBps = st.offerBps;
  r.accepted = accepted;
  if (accepted.length === 0) return;
  if (accepted.length === alive.length) {
    // Aceptan todos: la oferta se anula y el pozo pierde 10 %.
    const burn = bps(s.pot, R.OFFER_VOID_BURN_BPS);
    s.pot -= burn;
    s.box += burn;
    r.voided = true;
    return;
  }
  const each = Math.floor(st.offerTotal! / accepted.length);
  for (const a of accepted) {
    const seat = seatOf(s, a)!;
    seat.pocket += each;
    seat.status = "left";
  }
  s.pot -= each * accepted.length;
  r.eachGot = each;
}

function resolveVote(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const alive = aliveSeats(s);
  const votes: Record<string, number> = {};
  for (const seat of alive) votes[seat.address] = 0;
  for (const seat of alive) {
    const d = st.decisions[seat.address];
    trackAbsence(seat, !!d);
    const target = d?.type === "vote" ? d.target : seat.address; // ausente: en contra propio
    votes[target] += 1;
  }
  const max = Math.max(...Object.values(votes));
  const tied = alive.filter((x) => votes[x.address] === max);
  // Desempate: bolsillo más grande → más votos acumulados ANTES de esta etapa
  // → orden oculto de la semilla. El azar es el último recurso.
  tied.sort(
    (a, b) =>
      b.pocket - a.pocket ||
      b.votesReceived - a.votesReceived ||
      s.tiebreak.indexOf(a.address) - s.tiebreak.indexOf(b.address),
  );
  const out = tied[0];
  out.status = "voted_out";
  for (const seat of alive) seat.votesReceived += votes[seat.address];
  r.votes = votes;
  r.eliminated = out.address;
}

function resolveLock(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const solvers: string[] = [];
  const traitors: string[] = [];
  for (const seat of aliveSeats(s)) {
    const d = st.decisions[seat.address];
    if (d?.type === "submit" && d.code === st.code) {
      solvers.push(seat.address);
      if (d.intent === "me") traitors.push(seat.address);
    }
  }
  r.code = st.code;
  r.solvers = solvers;
  r.traitors = traitors;
  if (solvers.length === 0) {
    const burn = bps(s.pot, R.LOCK_FAIL_BURN_BPS);
    s.pot -= burn;
    s.box += burn;
    r.failed = true;
    return;
  }
  if (traitors.length === 0) {
    const bonus = Math.min(s.box, bps(s.pot, R.LOCK_BONUS_BPS));
    s.box -= bonus;
    s.pot += bonus;
    r.bonus = bonus;
    return;
  }
  const total = bps(s.pot, R.LOCK_TRAITOR_BPS);
  const each = Math.floor(total / traitors.length);
  for (const t of traitors) seatOf(s, t)!.pocket += each;
  s.pot -= each * traitors.length;
  r.eachGot = each;
}

function resolveFinal(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const alive = aliveSeats(s);
  const choices: Record<string, "split" | "steal"> = {};
  for (const seat of alive) {
    choices[seat.address] = st.decisions[seat.address]?.type === "steal" ? "steal" : "split";
  }
  const thieves = alive.filter((x) => choices[x.address] === "steal");
  if (thieves.length === 0) {
    const half = Math.floor(s.pot / alive.length);
    for (const seat of alive) seat.pocket += half;
    s.box += s.pot - half * alive.length; // la unidad sobrante, si la hay
  } else if (thieves.length === 1) {
    thieves[0].pocket += s.pot;
  } else {
    s.box += s.pot; // roban los dos: el pozo se quema
  }
  s.pot = 0;
  for (const seat of alive) seat.status = "finished";
  r.choices = choices;
}

/** EL DIRECTOR: qué viene después de cada etapa. */
function direct(s: VaultState): void {
  if (s.stage.kind === "final") return finish(s);
  const alive = aliveSeats(s);
  if (alive.length === 0) {
    s.box += s.pot;
    s.pot = 0;
    return finish(s);
  }
  if (alive.length === 1) {
    alive[0].pocket += s.pot;
    s.pot = 0;
    alive[0].status = "finished";
    return finish(s);
  }
  if (alive.length === 2) return beginStage(s, "final");
  beginStage(s, s.deck.shift() ?? "vote");
}

/** Tabla de pagos: bolsillo + parte igual de la caja; el resto (menos de N
 *  unidades) al bolsillo más grande (empate: menor índice). Suma potInitial. */
function finish(s: VaultState): void {
  const n = s.seats.length;
  const each = Math.floor(s.box / n);
  const dust = s.box - each * n;
  const payouts: Record<string, number> = {};
  for (const seat of s.seats) payouts[seat.address] = seat.pocket + each;
  const richest = s.seats.reduce((best, x) => (x.pocket > best.pocket ? x : best), s.seats[0]);
  payouts[richest.address] += dust;
  s.payouts = payouts;
  s.over = true;
}
```

- [ ] **Step 5: Correr tests + typecheck**

Run: `node --import tsx --test packages/game-sdk/test/vault.test.ts && npm run typecheck:packages && npm run lint`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
npm run format
git add packages/game-sdk/src/vault.ts packages/game-sdk/test/vault.test.ts packages/game-sdk/test/vault-helpers.ts
git commit -m "feat(vault): motor — acciones firmables, cierre de fases, resolución de las cinco etapas y director

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Motor — tests de cada etapa, desempates, director y abandono

Sin código nuevo previsto: estos tests cierran el contrato de cada etapa del
spec. Si alguno falla, el error está en `vault.ts` (Tarea 3): arreglar ahí
hasta que todo pase.

**Files:**

- Test: `packages/game-sdk/test/vault.test.ts` (parte 3)

**Interfaces:**

- Consumes: `createVault`, `applyEvent`, `phaseComplete`, `seatOf`, `aliveSeats` y los helpers.

- [ ] **Step 1: Agregar los tests**

```ts
test("Oferta: los que aceptan se van con su parte y, con 2 vivos, viene la Final", () => {
  let s = createVault(SEED, seats(4), { deck: ["offer", "offer"] });
  s = allDecide(s, { type: "contribute" }); // pot 3520 → decaimiento 176 → 3344
  assert.equal(s.stage.kind, "offer");
  assert.equal(s.pot, 3344);
  const total = s.stage.offerTotal!;
  const offerBps = s.stage.offerBps!;
  assert.ok(offerBps >= 1000 && offerBps <= 2500 && offerBps % 100 === 0, `offerBps=${offerBps}`);
  assert.equal(total, Math.floor((3344 * offerBps) / 10000));
  s = act(s, A(1), { type: "accept" });
  s = act(s, A(2), { type: "accept" });
  s = act(s, A(3), { type: "decline" });
  s = end(s); // A4 ausente = rechaza
  const r = s.results[1];
  assert.deepEqual(r.accepted, [A(1), A(2)]);
  assert.equal(r.eachGot, Math.floor(total / 2));
  assert.equal(seatOf(s, A(1))!.status, "left");
  assert.equal(seatOf(s, A(1))!.pocket, Math.floor(total / 2));
  assert.equal(seatOf(s, A(4))!.absences, 1);
  assertConserved(s);
  assert.equal(s.stage.kind, "final");
  assert.equal(s.stage.phase, "talk");
});

test("Oferta anulada si aceptan todos: nadie se va, se quema 10 %, y con el mazo vacío sigue un Voto", () => {
  let s = createVault(SEED, seats(4), { deck: ["offer"] });
  s = allDecide(s, { type: "contribute" });
  const pot = s.pot;
  s = allDecide(s, { type: "accept" });
  const r = s.results[1];
  assert.equal(r.voided, true);
  assert.deepEqual(r.accepted, seats(4));
  assert.equal(aliveSeats(s).length, 4);
  const burn = Math.floor(pot * 0.1);
  assert.equal(r.potAfter, pot - burn - Math.floor((pot - burn) * 0.05));
  assertConserved(s);
  assert.equal(s.stage.kind, "vote"); // mazo agotado con 4 vivos → Voto
});

test("Voto: el más votado se va con su bolsillo; ausente = voto en contra propio; se publican conteos, no votantes", () => {
  let s = createVault(SEED, seats(4), { deck: ["vote"] });
  s = act(s, A(2), { type: "keep" }); // A2 guarda 160
  s = end(s);
  s = skipTalk(s);
  s = act(s, A(1), { type: "vote", target: A(2) });
  s = act(s, A(3), { type: "vote", target: A(2) });
  s = act(s, A(4), { type: "vote", target: A(1) });
  s = end(s); // A2 ausente → un voto en contra propio → 3
  const r = s.results[1];
  assert.deepEqual(r.votes, { [A(1)]: 1, [A(2)]: 3, [A(3)]: 0, [A(4)]: 0 });
  assert.equal(r.eliminated, A(2));
  assert.ok(!("voters" in r) && !("decisions" in r));
  assert.equal(seatOf(s, A(2))!.status, "voted_out");
  assert.equal(seatOf(s, A(2))!.pocket, 160);
  assertConserved(s);
  assert.equal(aliveSeats(s).length, 3);
});

test("Voto empatado: se va el de bolsillo más grande; después el que acumuló más votos", () => {
  let s = createVault(SEED, seats(4), { deck: ["vote", "vote", "vote"] });
  s = act(s, A(1), { type: "keep" });
  s = end(s);
  s = skipTalk(s);
  // 2-2 entre A1 y A2: A1 tiene bolsillo → se va A1.
  s = act(s, A(1), { type: "vote", target: A(2) });
  s = act(s, A(2), { type: "vote", target: A(1) });
  s = act(s, A(3), { type: "vote", target: A(1) });
  s = act(s, A(4), { type: "vote", target: A(2) });
  s = end(s);
  assert.equal(s.results[1].eliminated, A(1));
  // Quedan A2, A3, A4 con bolsillo 0. A2 acumula 2 votos previos; A3 y A4, 0.
  s = skipTalk(s);
  s = act(s, A(2), { type: "vote", target: A(3) });
  s = act(s, A(3), { type: "vote", target: A(4) });
  s = act(s, A(4), { type: "vote", target: A(2) });
  s = end(s); // 1-1-1 → se va el de más votos acumulados: A2
  assert.equal(s.results[2].eliminated, A(2));
  assert.equal(s.stage.kind, "final");
});

test("Voto empatado sin diferencias: decide el orden oculto de la semilla", () => {
  let s = createVault(SEED, seats(4), { deck: ["vote"] });
  s = allDecide(s, { type: "contribute" });
  s = skipTalk(s);
  s = act(s, A(1), { type: "vote", target: A(2) });
  s = act(s, A(2), { type: "vote", target: A(1) });
  s = act(s, A(3), { type: "vote", target: A(4) });
  s = act(s, A(4), { type: "vote", target: A(3) });
  s = end(s);
  assert.equal(s.results[1].eliminated, s.tiebreak[0]);
});

test("Cerradura: fragmentos secretos por asiento, un intento, pasar con ready, abrir para todos premia de la caja", () => {
  let s = createVault(SEED, seats(4), { deck: ["lock"] });
  s = allDecide(s, { type: "contribute" });
  assert.equal(s.stage.kind, "lock");
  assert.equal(s.stage.phase, "talk");
  assert.equal(s.stage.codeLength, 4);
  const frags = s.stage.fragments!;
  assert.deepEqual(Object.keys(frags).sort(), seats(4));
  assert.deepEqual(
    seats(4).map((a) => frags[a].pos),
    [0, 1, 2, 3],
  );
  const code = seats(4)
    .map((a) => frags[a].digit)
    .join("");
  assert.equal(code, s.stage.code);
  s = skipTalk(s);
  assert.throws(
    () => act(s, A(1), { type: "submit", code: "123", intent: "all" }),
    /invalid code length/,
  );
  s = act(s, A(1), { type: "submit", code, intent: "all" });
  assert.throws(() => act(s, A(1), { type: "submit", code, intent: "me" }), /already decided/);
  s = act(s, A(2), { type: "submit", code: code === "0000" ? "0001" : "0000", intent: "all" });
  s = act(s, A(3), { type: "ready" }); // pasa
  assert.equal(phaseComplete(s), null);
  s = act(s, A(4), { type: "ready" });
  assert.equal(phaseComplete(s), "all_acted");
  const pot = s.pot;
  const box = s.box;
  s = end(s, "all_acted");
  const r = s.results[1];
  assert.equal(r.code, code);
  assert.deepEqual(r.solvers, [A(1)]);
  assert.deepEqual(r.traitors, []);
  const bonus = Math.min(box, Math.floor(pot * 0.2));
  assert.equal(r.bonus, bonus);
  assert.equal(r.potAfter, pot + bonus - Math.floor((pot + bonus) * 0.05));
  assert.equal(seatOf(s, A(3))!.absences, 0, "pasar en la Cerradura no es ausencia");
  assertConserved(s);
});

test("Cerradura: los traidores se reparten el 10 %; si nadie acierta se quema 10 %", () => {
  let s = createVault(SEED, seats(4), { deck: ["lock", "lock"] });
  s = allDecide(s, { type: "contribute" });
  s = skipTalk(s);
  const code = s.stage.code!;
  const pot = s.pot;
  s = act(s, A(1), { type: "submit", code, intent: "me" });
  s = act(s, A(2), { type: "submit", code, intent: "me" });
  s = act(s, A(3), { type: "submit", code, intent: "all" });
  s = end(s);
  let r = s.results[1];
  assert.deepEqual(r.solvers, [A(1), A(2), A(3)]);
  assert.deepEqual(r.traitors, [A(1), A(2)]);
  assert.equal(r.bonus, undefined);
  const each = Math.floor(Math.floor(pot * 0.1) / 2);
  assert.equal(r.eachGot, each);
  assert.equal(seatOf(s, A(1))!.pocket, each);
  assert.equal(seatOf(s, A(3))!.pocket, 0);
  assertConserved(s);
  // Segunda Cerradura: nadie intenta (vence el plazo).
  s = skipTalk(s);
  const pot2 = s.pot;
  s = end(s);
  r = s.results[2];
  assert.equal(r.failed, true);
  const burned = Math.floor(pot2 * 0.1);
  assert.equal(r.potAfter, pot2 - burned - Math.floor((pot2 - burned) * 0.05));
  assertConserved(s);
});

test("Final: dividir/dividir, robar/dividir (ausente divide), robar/robar; sin decaimiento; tabla suma el total", () => {
  const setup = () => {
    let s = createVault(SEED, seats(4), { deck: ["offer"] });
    s = allDecide(s, { type: "contribute" });
    s = act(s, A(3), { type: "accept" });
    s = act(s, A(4), { type: "accept" });
    s = end(s); // quedan A1 y A2 → Final
    assert.equal(s.stage.kind, "final");
    return skipTalk(s);
  };
  let s = setup();
  const pot = s.pot;
  const box = s.box;
  s = act(s, A(1), { type: "split" });
  s = act(s, A(2), { type: "split" });
  s = end(s);
  assert.equal(s.over, true);
  assert.equal(s.pot, 0);
  assert.equal(seatOf(s, A(1))!.pocket, Math.floor(pot / 2));
  assert.equal(seatOf(s, A(1))!.status, "finished");
  assert.equal(s.results[s.results.length - 1].decay, undefined);
  assertConserved(s);
  assert.equal(
    Object.values(s.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
  assert.throws(() => act(s, A(1), { type: "say", text: "hola" }), /room already over/);

  s = setup();
  s = act(s, A(1), { type: "steal" });
  s = end(s); // A2 ausente → divide → A1 se lleva todo
  assert.equal(seatOf(s, A(1))!.pocket, pot);
  assert.equal(seatOf(s, A(2))!.pocket, 0);
  assert.deepEqual(s.results[s.results.length - 1].choices, { [A(1)]: "steal", [A(2)]: "split" });

  s = setup();
  s = act(s, A(1), { type: "steal" });
  s = act(s, A(2), { type: "steal" });
  s = end(s);
  assert.equal(s.box, box + pot);
  assert.equal(seatOf(s, A(1))!.pocket, 0);
  const each = Math.floor((box + pot) / 4);
  assert.equal(s.payouts![A(1)], each);
  assert.equal(
    Object.values(s.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
});

test("director: un solo vivo se lleva el pozo; sin vivos, el pozo va a la caja y se reparte", () => {
  let s = createVault(SEED, seats(4), { deck: ["offer"] });
  s = allDecide(s, { type: "contribute" });
  const pot = s.pot;
  const total = s.stage.offerTotal!;
  for (const a of [A(1), A(2), A(3)]) s = act(s, a, { type: "accept" });
  s = end(s);
  assert.equal(s.over, true);
  // Orden del director: efecto de la etapa → abandono → decaimiento → ¿vivos?
  // El sobreviviente cobra el pozo YA decaído (spec, "El director", pasos 1-4).
  const potLeft = pot - Math.floor(total / 3) * 3;
  const decay = Math.floor(potLeft * 0.05);
  assert.equal(s.results[1].decay, decay);
  assert.equal(seatOf(s, A(4))!.pocket, potLeft - decay);
  assert.equal(seatOf(s, A(4))!.status, "finished");
  assertConserved(s);

  s = createVault(SEED, seats(4), { deck: ["offer"] });
  s = end(s); // Reparto: todos ausentes (aportan; ausencia 1)
  s = end(s); // Oferta: todos ausentes (rechazan; ausencia 2) → abandonan todos
  assert.equal(s.over, true);
  assert.equal(s.pot, 0);
  assert.deepEqual(s.results[1].abandoned, seats(4));
  assert.equal(s.payouts![A(1)], 1000);
  assert.equal(
    Object.values(s.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
});

test("abandono: dos ausencias seguidas eliminan (bolsillo al pozo); decidir corta la racha; en la Final no se evalúa", () => {
  let s = createVault(SEED, seats(4), { deck: ["vote", "offer"] });
  // Reparto: A1 guarda; A2 y A3 aportan; A4 ausente (1).
  s = act(s, A(1), { type: "keep" });
  s = act(s, A(2), { type: "contribute" });
  s = act(s, A(3), { type: "contribute" });
  s = end(s);
  // Voto: A1 ausente (1); A4 vota (corta su racha). Sale A2.
  s = skipTalk(s);
  s = act(s, A(2), { type: "vote", target: A(3) });
  s = act(s, A(3), { type: "vote", target: A(2) });
  s = act(s, A(4), { type: "vote", target: A(2) });
  s = end(s);
  assert.equal(s.results[1].eliminated, A(2));
  assert.equal(seatOf(s, A(4))!.absences, 0);
  assert.equal(seatOf(s, A(1))!.absences, 1);
  // Oferta: A1 ausente (2) → abandona; A3 rechaza; A4 ausente (1).
  const potBefore = s.pot;
  s = act(s, A(3), { type: "decline" });
  s = end(s);
  const r = s.results[2];
  assert.deepEqual(r.abandoned, [A(1)]);
  assert.equal(seatOf(s, A(1))!.status, "abandoned");
  assert.equal(seatOf(s, A(1))!.pocket, 0);
  assert.equal(r.potAfter, potBefore + 160 - Math.floor((potBefore + 160) * 0.05));
  assert.equal(seatOf(s, A(4))!.absences, 1);
  assert.equal(seatOf(s, A(4))!.status, "alive");
  assertConserved(s);
  // Quedan A3 y A4 → Final. A3 ausente: divide por defecto y NO abandona.
  assert.equal(s.stage.kind, "final");
  s = skipTalk(s);
  s = act(s, A(4), { type: "split" });
  s = end(s);
  assert.equal(s.over, true);
  assert.equal(seatOf(s, A(3))!.status, "finished");
  assertConserved(s);
});
```

- [ ] **Step 2: Correr**

Run: `node --import tsx --test packages/game-sdk/test/vault.test.ts`
Expected: PASS (19 tests). Si algo falla, corregir `vault.ts` (no el test) hasta que pase, salvo que el test contradiga el spec.

- [ ] **Step 3: Commit**

```bash
npm run format
git add packages/game-sdk/src/vault.ts packages/game-sdk/test/vault.test.ts
git commit -m "test(vault): cada etapa, desempates del voto, director y abandono contra el spec

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Motor — vista por asiento, re-simulación y propiedades

**Files:**

- Modify: `packages/game-sdk/src/vault.ts` (agregar al final)
- Test: `packages/game-sdk/test/vault-invariants.test.ts`

**Interfaces:**

- Produces: `interface VaultView`; `viewFor(s: VaultState, address?: string): VaultView` (filtra secretos; sin `address` es la vista pública); `replayVault(seed: string, seats: string[], events: VaultEvent[], opts?: { deck?: StageKind[] }): VaultState`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// packages/game-sdk/test/vault-invariants.test.ts
// Propiedades del motor: (1) conservación del dinero después de CADA evento y
// tabla que suma el total; (2) re-simular el registro da EXACTAMENTE el estado
// vivo (es lo que hace verificable a la sala); (3) la vista no filtra secretos.
// Correr: node --import tsx --test packages/game-sdk/test/vault-invariants.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createVault,
  applyEvent,
  replayVault,
  viewFor,
  phaseComplete,
  aliveSeats,
  type VaultAction,
  type VaultEvent,
  type VaultState,
} from "@arcade1v1/game-sdk/vault";
import { mulberry32 } from "../src/replay";
import {
  SEED,
  A,
  seedN,
  seats,
  act,
  end,
  skipTalk,
  allDecide,
  assertConserved,
} from "./vault-helpers";

/** Un agente al azar (reproducible): decide algo válido, a veces falta, a veces habla. */
function randomAction(s: VaultState, me: string, rnd: () => number): VaultAction | null {
  const st = s.stage;
  if (st.phase === "talk") return rnd() < 0.8 ? { type: "ready" } : null;
  const others = aliveSeats(s).filter((x) => x.address !== me);
  switch (st.kind) {
    case "share":
      return { type: rnd() < 0.5 ? "keep" : "contribute" };
    case "offer":
      return { type: rnd() < 0.3 ? "accept" : "decline" };
    case "vote":
      return { type: "vote", target: others[Math.floor(rnd() * others.length)].address };
    case "lock": {
      if (rnd() < 0.3) return { type: "ready" };
      const code = rnd() < 0.5 ? st.code! : "0".repeat(st.codeLength!);
      return { type: "submit", code, intent: rnd() < 0.5 ? "all" : "me" };
    }
    case "final":
      return { type: rnd() < 0.5 ? "split" : "steal" };
  }
}

function playRandomRoom(seed: string, n: number, rnd: () => number) {
  const addrs = seats(n);
  let s = createVault(seed, addrs);
  const events: VaultEvent[] = [];
  const push = (ev: VaultEvent) => {
    s = applyEvent(s, ev);
    events.push(ev);
    assertConserved(s);
  };
  let guard = 0;
  while (!s.over) {
    if (++guard > 400) throw new Error("la sala no termina");
    const st = s.stage;
    for (const seat of aliveSeats(s)) {
      if (rnd() < 0.15) continue; // ausente
      if (rnd() < 0.3) {
        push({
          type: "action",
          address: seat.address,
          stage: st.index,
          phase: st.phase,
          action: { type: "say", text: "hola" },
          ts: 0,
        });
      }
      const a = randomAction(s, seat.address, rnd);
      if (a) {
        push({
          type: "action",
          address: seat.address,
          stage: st.index,
          phase: st.phase,
          action: a,
          ts: 0,
        });
      }
    }
    push({
      type: "phase_end",
      stage: st.index,
      phase: st.phase,
      at: 0,
      reason: phaseComplete(s) ?? "deadline",
    });
  }
  return { s, events, addrs };
}

test("propiedad: conservación en cada evento, tabla que suma el total y re-simulación exacta", () => {
  let played = 0;
  for (const n of [4, 5, 6, 8]) {
    for (let i = 0; i < 25; i++) {
      const seed = seedN(i * 10 + n);
      const { s, events, addrs } = playRandomRoom(seed, n, mulberry32(i * 1000 + n));
      const sum = Object.values(s.payouts!).reduce((a, b) => a + b, 0);
      assert.equal(sum, s.potInitial, `seed ${seed}`);
      assert.equal(Object.keys(s.payouts!).length, n);
      assert.deepEqual(replayVault(seed, addrs, events), s, `replay distinto para ${seed}`);
      played++;
    }
  }
  assert.equal(played, 100);
});

test("peor caso: 8 asientos sin Ofertas aceptadas ni abandonos — cantidad de etapas y fases acotada", () => {
  const deck0 = createVault(SEED, seats(8)).deck;
  let seen = 0;
  let idx = -1;
  deck0.forEach((c, i) => {
    if (c === "vote" && ++seen === 6) idx = i;
  });
  const played = deck0.slice(0, idx + 1);
  const expectedStages = 1 + played.length + 1; // Reparto inicial + cartas hasta el 6.º Voto + Final
  const expectedPhases =
    1 + played.reduce((acc, c) => acc + (c === "share" || c === "offer" ? 1 : 2), 0) + 2;
  let s = createVault(SEED, seats(8));
  let phases = 0;
  while (!s.over) {
    const st = s.stage;
    if (st.phase === "talk") {
      s = end(s);
      phases++;
      continue;
    }
    const alive = aliveSeats(s);
    for (const seat of alive) {
      const a: VaultAction =
        st.kind === "share"
          ? { type: "contribute" }
          : st.kind === "offer"
            ? { type: "decline" }
            : st.kind === "vote"
              ? { type: "vote", target: alive.find((x) => x.address !== seat.address)!.address }
              : st.kind === "lock"
                ? { type: "ready" }
                : { type: "split" };
      s = act(s, seat.address, a);
    }
    s = end(s, "all_acted");
    phases++;
  }
  assert.equal(s.results.length, expectedStages);
  assert.equal(phases, expectedPhases);
  assert.ok(expectedStages <= 12 && expectedPhases <= 20);
});

test("viewFor: sin fragmentos ajenos, decisiones, mazo ni semilla; privados solo para sus partes", () => {
  let s = createVault(SEED, seats(4), { deck: ["lock"] });
  s = allDecide(s, { type: "contribute" }); // → Cerradura, charla
  s = act(s, A(1), { type: "whisper", to: A(2), text: "mi dígito es 7" });
  s = act(s, A(3), { type: "say", text: "compartamos" });
  const v1 = viewFor(s, A(1));
  const v3 = viewFor(s, A(3));
  const pub = viewFor(s);
  assert.deepEqual(v1.you!.fragment, s.stage.fragments![A(1)]);
  const json1 = JSON.stringify(v1);
  for (const a of [A(2), A(3), A(4)]) {
    assert.ok(!json1.includes(JSON.stringify(s.stage.fragments![a])), `fragmento ajeno de ${a}`);
  }
  assert.ok(!json1.includes(s.seed.slice(2)));
  assert.ok(!("deck" in v1) && !("seed" in v1) && !("tiebreak" in v1));
  assert.ok(!("code" in v1.stage) && !("fragments" in v1.stage) && !("decisions" in v1.stage));
  assert.equal(v1.cardsLeft, 0);
  assert.equal(v1.stage.codeLength, 4);
  assert.equal(v1.messages.length, 2);
  assert.equal(v3.messages.length, 1, "A3 no ve el susurro de A1 a A2");
  assert.equal(viewFor(s, A(2)).messages.length, 2, "A2 sí ve el susurro que le mandaron");
  assert.equal(pub.messages.length, 1);
  assert.equal(pub.you, undefined);
  assert.deepEqual(
    pub.seats.map((x) => x.address),
    seats(4),
  );

  s = skipTalk(s);
  s = act(s, A(2), { type: "submit", code: s.stage.code!, intent: "me" });
  const v4 = viewFor(s, A(4));
  assert.deepEqual(v4.stage.acted, [A(2)], "se ve QUIÉN actuó, no qué");
  assert.ok(!JSON.stringify(v4).includes('"intent"'));
  assert.equal(viewFor(s, A(2)).you!.decided, true);
  assert.equal(v4.you!.decided, false);
  assert.equal(v4.you!.ready, false);

  // Al cerrar la etapa el código y el traidor se revelan en `results`.
  s = end(s);
  const after = viewFor(s, A(4));
  assert.equal(after.results[1].code, s.results[1].code);
  assert.deepEqual(after.results[1].traitors, [A(2)]);
});

test("viewFor al terminar: pagos y TODOS los mensajes (también privados)", () => {
  let s = createVault(SEED, seats(4), { deck: ["offer"] });
  s = act(s, A(1), { type: "whisper", to: A(2), text: "secreto" });
  s = allDecide(s, { type: "contribute" });
  for (const a of [A(1), A(2), A(3)]) s = act(s, a, { type: "accept" });
  s = end(s); // sobrevive A4 → termina
  assert.equal(s.over, true);
  const pub = viewFor(s);
  assert.equal(pub.over, true);
  assert.deepEqual(pub.payouts, s.payouts);
  assert.equal(pub.messages.length, 1);
  assert.equal(pub.messages[0].to, A(2));
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test packages/game-sdk/test/vault-invariants.test.ts`
Expected: FAIL (`viewFor`/`replayVault` no existen).

- [ ] **Step 3: Agregar al final de `vault.ts`**

```ts
// ---------------------------------------------------------------------------
// VISTA por asiento (filtra secretos) y RE-SIMULACIÓN del registro.
// ---------------------------------------------------------------------------

export interface VaultView {
  rulesV: number;
  over: boolean;
  pot: number;
  box: number;
  potInitial: number;
  cardsLeft: number;
  seats: { address: string; status: SeatStatus; pocket: number }[];
  stage: {
    index: number;
    kind: StageKind;
    phase: Phase;
    /** Quiénes ya actuaron en esta fase (no QUÉ hicieron). */
    acted: string[];
    share?: number;
    shareBonus?: number;
    offerBps?: number;
    offerTotal?: number;
    codeLength?: number;
  };
  results: StageResult[];
  you?: {
    status: SeatStatus;
    pocket: number;
    absences: number;
    decided: boolean;
    ready: boolean;
    fragment?: Fragment;
  };
  /** Públicos de la etapa actual + privados hacia/desde este asiento. Al
   *  terminar la sala: todos, también los privados (el registro es público). */
  messages: VaultMessage[];
  payouts?: Record<string, number>;
}

/** Lo que ESTE asiento puede saber. Sin `address`: la vista pública. Nunca:
 *  fragmentos ajenos, decisiones pendientes de otros, el mazo, la semilla,
 *  privados entre terceros. */
export function viewFor(s: VaultState, address?: string): VaultView {
  const me = address ? seatOf(s, address) : undefined;
  const st = s.stage;
  const messages = s.messages.filter(
    (m) =>
      s.over || (m.stage === st.index && (!m.to || m.to === me?.address || m.from === me?.address)),
  );
  const v: VaultView = {
    rulesV: s.rulesV,
    over: s.over,
    pot: s.pot,
    box: s.box,
    potInitial: s.potInitial,
    cardsLeft: s.deck.length,
    seats: s.seats.map(({ address, status, pocket }) => ({ address, status, pocket })),
    stage: {
      index: st.index,
      kind: st.kind,
      phase: st.phase,
      acted: [...Object.keys(st.decisions), ...st.ready],
      share: st.share,
      shareBonus: st.shareBonus,
      offerBps: st.offerBps,
      offerTotal: st.offerTotal,
      codeLength: st.codeLength,
    },
    results: s.results,
    messages,
  };
  if (me) {
    v.you = {
      status: me.status,
      pocket: me.pocket,
      absences: me.absences,
      decided: !!st.decisions[me.address],
      ready: st.ready.includes(me.address),
      fragment: st.fragments?.[me.address],
    };
  }
  if (s.payouts) v.payouts = s.payouts;
  return v;
}

/** Re-simula una sala desde su registro. Es lo que corre el árbitro para
 *  operar y lo que corre cualquiera para verificar la tabla de pagos. */
export function replayVault(
  seed: string,
  seats: string[],
  events: VaultEvent[],
  opts: { deck?: StageKind[] } = {},
): VaultState {
  let s = createVault(seed, seats, opts);
  for (const ev of events) s = applyEvent(s, ev);
  return s;
}
```

- [ ] **Step 4: Correr tests + typecheck**

Run: `node --import tsx --test packages/game-sdk/test/vault-invariants.test.ts packages/game-sdk/test/vault.test.ts packages/game-sdk/test/vault-rules.test.ts && npm run typecheck:packages && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add packages/game-sdk/src/vault.ts packages/game-sdk/test/vault-invariants.test.ts
git commit -m "feat(vault): vista por asiento sin secretos, re-simulación del registro y tests de propiedad

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: ELO multi-jugador (`applyMultiResult`)

**Files:**

- Modify: `apps/server/src/ratings.ts` (agregar después de `applyResult`)
- Test: `apps/server/test/ratings-multi.test.ts`

**Interfaces:**

- Consumes: `getRating`, `set`, `touch`, `save`, `K` (internos de `ratings.ts`).
- Produces: `applyMultiResult(game: string, entries: { address: string; score: number }[]): Record<string, RatingUpdate>`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/server/test/ratings-multi.test.ts
// ELO de N jugadores (La Bóveda): cada par se compara por lo cobrado y el
// factor K se divide por (N − 1), así una sala mueve tanto rating como una
// partida 1v1. Correr: node --import tsx --test apps/server/test/ratings-multi.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMultiResult, getRating } from "../src/ratings.js";

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "00ee");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

test("el que cobra más sube, el que cobra menos baja, empate no mueve; suma ~0", () => {
  const [a, b, c, d] = [addr(), addr(), addr(), addr()];
  const out = applyMultiResult("vault", [
    { address: a, score: 2500 },
    { address: b, score: 1000 },
    { address: c, score: 1000 },
    { address: d, score: 500 },
  ]);
  // Todos arrancan en 1000 (expectativa 0,5 contra cada rival); K/(N−1) = 32/3.
  // a: 3 victorias → 3 × 0,5 × 10,67 = +16; d: −16; b y c: 1 victoria, 1 empate, 1 derrota → 0.
  assert.equal(out[a].delta, 16);
  assert.equal(out[d].delta, -16);
  assert.equal(out[b].delta, 0);
  assert.equal(out[c].delta, 0);
  assert.equal(getRating(a, "vault"), 1016);
  assert.equal(getRating(d, "vault"), 984);
  assert.equal(getRating(a, "2048"), 1000, "no toca otros juegos");
  const total = Object.values(out).reduce((acc, u) => acc + u.delta, 0);
  assert.ok(Math.abs(total) <= 4);
});

test("usa los ratings PREVIOS de todos (sin dependencia del orden); con 1 jugador no hace nada", () => {
  const [a, b, c] = [addr(), addr(), addr()];
  const out1 = applyMultiResult("vault", [
    { address: a, score: 3 },
    { address: b, score: 2 },
    { address: c, score: 1 },
  ]);
  const [x, y, z] = [addr(), addr(), addr()];
  const out2 = applyMultiResult("vault", [
    { address: z, score: 1 },
    { address: y, score: 2 },
    { address: x, score: 3 },
  ]);
  assert.equal(out1[a].delta, out2[x].delta);
  assert.equal(out1[c].delta, out2[z].delta);
  assert.deepEqual(applyMultiResult("vault", [{ address: addr(), score: 1 }]), {});
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test apps/server/test/ratings-multi.test.ts`
Expected: FAIL (`applyMultiResult` no existe).

- [ ] **Step 3: Implementar en `ratings.ts`** (después de `applyResult`)

```ts
/** ELO de N jugadores (La Bóveda): cada par (i, j) se compara por `score`
 *  (más = gana; igual = empate) con las expectativas calculadas sobre los
 *  ratings PREVIOS de todos, y K se divide por (N − 1) para que una sala mueva
 *  tanto rating como una partida 1v1. Una sola actualización por jugador. */
export function applyMultiResult(
  game: string,
  entries: { address: string; score: number }[],
): Record<string, RatingUpdate> {
  const n = entries.length;
  if (n < 2) return {};
  const k = K / (n - 1);
  const before: Record<string, number> = {};
  for (const e of entries) before[e.address] = getRating(e.address, game);
  const out: Record<string, RatingUpdate> = {};
  for (const a of entries) {
    let sum = 0;
    for (const b of entries) {
      if (a.address === b.address) continue;
      const expected = 1 / (1 + Math.pow(10, (before[b.address] - before[a.address]) / 400));
      const actual = a.score > b.score ? 1 : a.score < b.score ? 0 : 0.5;
      sum += actual - expected;
    }
    const after = Math.round(before[a.address] + k * sum);
    out[a.address] = { before: before[a.address], after, delta: after - before[a.address] };
  }
  for (const [address, u] of Object.entries(out)) {
    set(address, game, u.after);
    touch(address);
  }
  save();
  return out;
}
```

- [ ] **Step 4: Correr test + typecheck**

Run: `node --import tsx --test apps/server/test/ratings-multi.test.ts && npm run typecheck:server`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/server/src/ratings.ts apps/server/test/ratings-multi.test.ts
git commit -m "feat(ratings): ELO de N jugadores con K/(N−1) para las salas de La Bóveda

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Árbitro — salas, lobby, arranque, disolución y persistencia

**Files:**

- Create: `apps/server/src/vault.ts`
- Test: `apps/server/test/vault-lobby.test.ts`

**Interfaces:**

- Consumes: `createVault`, `replayVault`, `viewFor`, `VAULT_RULES`, `VAULT_RULES_V` (`@arcade1v1/game-sdk/vault`); `matchmakeAuthMessage`, `MATCHMAKE_AUTH_TTL_MS` (`/auth`); `AUTH_REQUIRED` (`./matchmaking.js`); `jsonStore`; `recordMatchCreated`; `RatingUpdate`.
- Produces: `class VaultError`; knobs `VAULT_MIN_SEATS`, `VAULT_MAX_SEATS`, `VAULT_LOBBY_MS`, `VAULT_PHASE_MS`, `VAULT_TICK_MS`, `VAULT_MAX_ROOMS`, `VAULT_FINISHED_TTL_MS`, `vaultEnabled()`; tipos `RoomStatus`, `VaultRoom`, `VaultRoomView`, `VaultAuth`; `joinVault(stake, address, auth?, now?)`, `getVaultRoom(roomId, address?, now?)`, `listVaultLobbies(now?)`, `settleDue(now?)`, `roomView(room, address?)`, `stateOf(room)`, `serializeVault()`, `restoreVaultFrom(raw)`, `restoreVault()`, `__resetVaultForTest()`. La Tarea 8 agrega `actVault`, `vaultLog`, `recentVaultRooms`, `startVaultTicker` y extiende `settleDue`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// apps/server/test/vault-lobby.test.ts
// Lobby de La Bóveda: un lobby abierto por mesa, idempotente por address,
// arranca con 8 o al vencer con ≥4, se disuelve con <4, respeta el tope de
// salas y sobrevive a serializar/restaurar. Reloj SIEMPRE inyectado.
// Correr: node --import tsx --test apps/server/test/vault-lobby.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";

process.env.VAULT_MAX_ROOMS = "2";
const V = await import("../src/vault.js");

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0a00");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);
const T0 = 1_800_000_000_000;

test("un lobby por mesa, idempotente por address; arranca al vencer con ≥4", async () => {
  V.__resetVaultForTest();
  const a1 = addr();
  const v1 = await V.joinVault(0, a1, undefined, T0);
  assert.equal(v1.status, "lobby");
  assert.equal(v1.seats.length, 1);
  assert.equal(v1.closesAt, T0 + V.VAULT_LOBBY_MS);
  const again = await V.joinVault(0, a1.toUpperCase().replace("0X", "0x"), undefined, T0 + 1);
  assert.equal(again.roomId, v1.roomId);
  assert.equal(again.seats.length, 1);
  for (let i = 0; i < 3; i++) await V.joinVault(0, addr(), undefined, T0 + 2);
  assert.deepEqual(
    V.listVaultLobbies(T0 + 3).map((l) => [l.roomId, l.seats]),
    [[v1.roomId, 4]],
  );
  // No vence antes de tiempo.
  assert.equal(V.getVaultRoom(v1.roomId, a1, T0 + V.VAULT_LOBBY_MS - 1)!.status, "lobby");
  const started = V.getVaultRoom(v1.roomId, a1, T0 + V.VAULT_LOBBY_MS)!;
  assert.equal(started.status, "playing");
  assert.match(String(started.commit), /^0x[0-9a-f]{64}$/);
  assert.equal(started.secretSeed, undefined, "la semilla no se revela hasta el final");
  assert.equal(started.startedAt, T0 + V.VAULT_LOBBY_MS);
  assert.equal(started.deadline, T0 + V.VAULT_LOBBY_MS + V.VAULT_PHASE_MS);
  assert.equal(started.stage!.kind, "share");
  assert.equal(started.you!.status, "alive");
  assert.equal(started.pot, 3200);
  assert.deepEqual(V.listVaultLobbies(T0 + V.VAULT_LOBBY_MS), []);
  // Sentado en una sala viva: volver a pedir asiento devuelve ESA sala.
  const same = await V.joinVault(0, a1, undefined, T0 + V.VAULT_LOBBY_MS + 5);
  assert.equal(same.roomId, v1.roomId);
  assert.equal(same.status, "playing");
});

test("con menos de 4 al vencer, el lobby se disuelve y el próximo pedido crea otro", async () => {
  V.__resetVaultForTest();
  const a1 = addr();
  const v1 = await V.joinVault(0, a1, undefined, T0);
  await V.joinVault(0, addr(), undefined, T0);
  const gone = V.getVaultRoom(v1.roomId, a1, T0 + V.VAULT_LOBBY_MS)!;
  assert.equal(gone.status, "dissolved");
  const v2 = await V.joinVault(0, a1, undefined, T0 + V.VAULT_LOBBY_MS + 1);
  assert.notEqual(v2.roomId, v1.roomId);
  assert.equal(v2.status, "lobby");
});

test("con 8 asientos arranca en el acto; el tope de salas vivas corta", async () => {
  V.__resetVaultForTest();
  let last;
  for (let i = 0; i < 8; i++) last = await V.joinVault(0, addr(), undefined, T0);
  assert.equal(last!.status, "playing");
  assert.equal(last!.seats.length, 8);
  for (let i = 0; i < 8; i++) last = await V.joinVault(0, addr(), undefined, T0);
  assert.equal(last!.status, "playing");
  await assert.rejects(() => V.joinVault(0, addr(), undefined, T0), /room limit/);
});

test("validaciones: mesa, address, kill switch y firma", async () => {
  V.__resetVaultForTest();
  await assert.rejects(() => V.joinVault(1, addr(), undefined, T0), /stake not allowed/);
  await assert.rejects(() => V.joinVault(0, "0x123", undefined, T0), /invalid address/);
  process.env.VAULT_ENABLED = "false";
  await assert.rejects(() => V.joinVault(0, addr(), undefined, T0), /vault disabled/);
  delete process.env.VAULT_ENABLED;

  const acc = privateKeyToAccount(generatePrivateKey());
  const me = acc.address.toLowerCase();
  const ts = T0;
  const signature = await acc.signMessage({ message: matchmakeAuthMessage("vault", 0, me, ts) });
  const ok = await V.joinVault(0, me, { signature, ts }, T0);
  assert.equal(ok.status, "lobby");
  const other = privateKeyToAccount(generatePrivateKey());
  const bad = await other.signMessage({ message: matchmakeAuthMessage("vault", 0, me, ts) });
  await assert.rejects(() => V.joinVault(0, addr(), { signature: bad, ts }, T0), /bad signature/);
  await assert.rejects(
    () => V.joinVault(0, me, { signature, ts }, T0 + 11 * 60_000),
    /auth expired/,
  );
  await assert.rejects(() => V.joinVault(0, me, { signature: "0x1234", ts }, T0), /bad signature/);
});

test("persistencia: serializar y restaurar conserva el lobby abierto y una sala en juego", async () => {
  V.__resetVaultForTest();
  const a1 = addr();
  const lobby = await V.joinVault(0, a1, undefined, T0);
  const seats8 = Array.from({ length: 8 }, () => addr());
  // Segunda mesa no existe (solo stake 0), así que armamos la sala en juego
  // llenando el lobby con 7 más.
  let playing;
  for (const a of seats8.slice(0, 7)) playing = await V.joinVault(0, a, undefined, T0);
  assert.equal(playing!.status, "playing");
  const roomId = playing!.roomId;
  assert.equal(roomId, lobby.roomId);
  const lobby2 = await V.joinVault(0, seats8[7], undefined, T0 + 1);
  assert.equal(lobby2.status, "lobby");

  const raw = V.serializeVault();
  V.__resetVaultForTest();
  assert.equal(V.getVaultRoom(roomId, a1, T0 + 2), null);
  V.restoreVaultFrom(raw);
  const back = V.getVaultRoom(roomId, a1, T0 + 2)!;
  assert.equal(back.status, "playing");
  assert.equal(back.stage!.kind, "share");
  assert.equal(back.commit, playing!.commit);
  // El lobby restaurado vuelve a ser EL lobby abierto de la mesa: una address
  // NUEVA cae ahí (no crea otro lobby) y el asiento original sigue sentado.
  // (Re-unir a seats8[7] no probaría nada: la idempotencia por address lo
  // encuentra por pertenencia a la sala, sin pasar por el mapa de lobbies.)
  const newcomer = await V.joinVault(0, addr(), undefined, T0 + 3);
  assert.equal(newcomer.roomId, lobby2.roomId);
  assert.equal(newcomer.seats.length, 2);
  assert.deepEqual(
    V.listVaultLobbies(T0 + 4).map((l) => [l.roomId, l.seats]),
    [[lobby2.roomId, 2]],
  );
  assert.ok(!raw.includes('"states"'), "el estado no se persiste: se re-simula");
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test apps/server/test/vault-lobby.test.ts`
Expected: FAIL (`../src/vault.js` no existe).

- [ ] **Step 3: Crear `apps/server/src/vault.ts`**

```ts
// LA BÓVEDA — salas del formato multi-agente (4 a 8 asientos, pozo único).
//
// El árbitro NO tiene lógica de juego: guarda cada sala como un REGISTRO de
// eventos (acciones firmadas + cierres de fase) y deriva el estado con el motor
// puro del game-sdk (`replayVault`). Lo que sí decide el árbitro: cuándo cierra
// cada fase (su reloj), qué firma vale, y la liquidación (pagos + ELO).
//
// Confianza: la semilla secreta se sortea al arrancar, se publica su hash
// (`commit`) y se revela al terminar; con el registro público cualquiera
// re-simula la sala y tiene que obtener la misma tabla de pagos.
//
// Persistencia vía persist.ts (Redis o archivo; opt-in). El ESTADO no se
// persiste: se re-simula del registro al restaurar (mismo camino que usa
// cualquier verificador externo — si se rompe, se nota primero acá).

import { randomBytes } from "node:crypto";
import { keccak256, recoverMessageAddress, type Hex } from "viem";
import {
  createVault,
  replayVault,
  viewFor,
  VAULT_RULES,
  VAULT_RULES_V,
  type VaultEvent,
  type VaultState,
  type VaultView,
  type SeatStatus,
} from "@arcade1v1/game-sdk/vault";
import { matchmakeAuthMessage, MATCHMAKE_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { AUTH_REQUIRED } from "./matchmaking.js";
import type { RatingUpdate } from "./ratings.js";
import { jsonStore } from "./persist.js";
import { recordMatchCreated } from "./stats.js";

/** Error esperable (pedido inválido, sala cerrada, firma mala…): las rutas lo
 *  devuelven como 400. Cualquier otro error es un bug y va como 500 + log. */
export class VaultError extends Error {}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const envNum = (key: string, def: number) => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// Perillas de entorno (ver docs/CONFIGURATION.md). Los asientos se pueden
// achicar dentro de [4, 8], nunca agrandar: son reglas del motor.
export const VAULT_MIN_SEATS = clamp(
  envNum("VAULT_MIN_SEATS", VAULT_RULES.MIN_SEATS),
  VAULT_RULES.MIN_SEATS,
  VAULT_RULES.MAX_SEATS,
);
export const VAULT_MAX_SEATS = clamp(
  envNum("VAULT_MAX_SEATS", VAULT_RULES.MAX_SEATS),
  VAULT_MIN_SEATS,
  VAULT_RULES.MAX_SEATS,
);
export const VAULT_LOBBY_MS = envNum("VAULT_LOBBY_MS", 10 * 60_000);
export const VAULT_PHASE_MS = envNum("VAULT_PHASE_MS", 2 * 60_000);
export const VAULT_TICK_MS = envNum("VAULT_TICK_MS", 5_000);
export const VAULT_MAX_ROOMS = envNum("VAULT_MAX_ROOMS", 50);
export const VAULT_FINISHED_TTL_MS = envNum("VAULT_FINISHED_TTL_MS", 7 * 24 * 60 * 60_000);
// Etapa 1: SOLO la mesa gratis. Las mesas de plata llegan con el contrato de N
// depósitos (etapa 4); hasta entonces aceptar otro stake crearía salas sin escrow.
const STAKES_ALLOWED = [0];
/** Kill switch, leído por llamada. */
export const vaultEnabled = () => process.env.VAULT_ENABLED !== "false";

export type RoomStatus = "lobby" | "playing" | "settled" | "dissolved";

export interface VaultRoom {
  id: Hex;
  stake: number;
  status: RoomStatus;
  seats: string[]; // orden de llegada, minúsculas
  createdAt: number;
  startedAt?: number;
  settledAt?: number; // también para `dissolved` (fecha de cierre)
  commit?: Hex; // keccak256(secretSeed), público desde el arranque
  secretSeed?: Hex; // NUNCA sale en una vista hasta `settled`
  events: VaultEvent[]; // el registro: única fuente de verdad del juego
  phaseDeadline?: number;
  payouts?: Record<string, number>;
  eloUpdates?: Record<string, RatingUpdate>;
}

export type VaultRoomView = {
  roomId: Hex;
  stake: number;
  status: RoomStatus;
  rulesV: number;
  min: number;
  max: number;
  createdAt: number;
  closesAt?: number; // lobby: cuándo arranca o se disuelve
  startedAt?: number;
  settledAt?: number;
  commit?: Hex;
  secretSeed?: Hex; // solo `settled`
  deadline?: number; // fin de la fase actual
  rating?: RatingUpdate; // `settled`, para el asiento que consulta
  seats: { address: string; status: SeatStatus; pocket: number }[];
} & Partial<Omit<VaultView, "seats">>;

export interface VaultAuth {
  signature: string;
  ts: number;
}

export interface LobbySummary {
  roomId: Hex;
  stake: number;
  seats: number;
  min: number;
  max: number;
  closesAt: number;
}

const rooms = new Map<string, VaultRoom>();
const openLobby = new Map<number, string>(); // stake -> roomId del lobby abierto
const states = new Map<string, VaultState>(); // cache del estado derivado
const store$ = jsonStore("vault");
const normAddr = (a: string) => String(a).toLowerCase();
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const randomHex32 = () => ("0x" + randomBytes(32).toString("hex")) as Hex;

// ---- Persistencia ----------------------------------------------------------

export function serializeVault(): string {
  return JSON.stringify([...rooms.values()]);
}

export function restoreVaultFrom(raw: string): void {
  const arr = JSON.parse(raw) as VaultRoom[];
  for (const room of arr) {
    rooms.set(room.id, room);
    states.delete(room.id);
    if (room.status === "lobby") openLobby.set(room.stake, room.id);
  }
}

/** Restaura las salas guardadas. La llama index.ts ANTES de escuchar. */
export async function restoreVault(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    restoreVaultFrom(raw);
    console.log(`Salas de La Bóveda recuperadas: ${rooms.size}`);
  } catch (e) {
    console.error("vault restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}

function persist() {
  store$.save(serializeVault);
}

/** Estado del motor de una sala, derivado del registro (con cache). */
export function stateOf(room: VaultRoom): VaultState {
  let s = states.get(room.id);
  if (!s) {
    s = replayVault(room.secretSeed!, room.seats, room.events);
    states.set(room.id, s);
  }
  return s;
}

// ---- Lobby ------------------------------------------------------------------

function liveRoomOf(address: string): VaultRoom | undefined {
  for (const r of rooms.values()) {
    if ((r.status === "lobby" || r.status === "playing") && r.seats.includes(address)) return r;
  }
  return undefined;
}

function liveCount(): number {
  let n = 0;
  for (const r of rooms.values()) if (r.status === "lobby" || r.status === "playing") n++;
  return n;
}

/** Firma del asiento: mismo mensaje que cualquier emparejamiento, con game "vault". */
async function verifySeatAuth(
  stake: number,
  address: string,
  auth: VaultAuth | undefined,
  now: number,
): Promise<void> {
  if (auth?.signature) {
    const ts = Number(auth.ts);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > MATCHMAKE_AUTH_TTL_MS) {
      throw new VaultError("auth expired");
    }
    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: matchmakeAuthMessage("vault", stake, address, ts),
        signature: auth.signature as Hex,
      });
    } catch {
      throw new VaultError("bad signature");
    }
    if (signer.toLowerCase() !== address) throw new VaultError("bad signature");
  } else if (AUTH_REQUIRED) {
    throw new VaultError("signature required");
  }
}

/** Pedir asiento. Idempotente: si ya estás en una sala viva, la devuelve. */
export async function joinVault(
  stake: number,
  address: string,
  auth?: VaultAuth,
  now = Date.now(),
): Promise<VaultRoomView> {
  if (!vaultEnabled()) throw new VaultError("vault disabled");
  if (!STAKES_ALLOWED.includes(stake)) {
    throw new VaultError(`stake not allowed: ${stake} (mesas: ${STAKES_ALLOWED.join(", ")})`);
  }
  address = normAddr(address);
  if (!ADDRESS_RE.test(address)) throw new VaultError("invalid address");
  await verifySeatAuth(stake, address, auth, now);
  settleDue(now);
  const mine = liveRoomOf(address);
  if (mine) return roomView(mine, address);

  const openId = openLobby.get(stake);
  let room = openId ? rooms.get(openId) : undefined;
  if (!room || room.status !== "lobby") {
    openLobby.delete(stake);
    room = undefined;
  }
  if (!room) {
    if (liveCount() >= VAULT_MAX_ROOMS) throw new VaultError("room limit reached, try again later");
    room = { id: randomHex32(), stake, status: "lobby", seats: [], createdAt: now, events: [] };
    rooms.set(room.id, room);
    openLobby.set(stake, room.id);
  }
  room.seats.push(address);
  if (room.seats.length >= VAULT_MAX_SEATS) startRoom(room, now);
  persist();
  return roomView(room, address);
}

/** Cierra el lobby y arranca la sala: semilla secreta + compromiso público. */
function startRoom(room: VaultRoom, now: number): void {
  const secretSeed = randomHex32();
  room.secretSeed = secretSeed;
  room.commit = keccak256(secretSeed);
  room.status = "playing";
  room.startedAt = now;
  room.phaseDeadline = now + VAULT_PHASE_MS;
  states.set(room.id, createVault(secretSeed, room.seats));
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
  recordMatchCreated(now); // métrica: una sala cuenta como una partida
}

function dissolveRoom(room: VaultRoom, now: number): void {
  room.status = "dissolved";
  room.settledAt = now;
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
}

/** Vence lobbies (arranca con ≥ mínimo, disuelve si no) y purga salas viejas.
 *  Toda lectura/acción la llama primero con su reloj, así los tests no esperan. */
export function settleDue(now = Date.now()): void {
  let dirty = false;
  for (const room of rooms.values()) {
    if (room.status === "lobby" && now - room.createdAt >= VAULT_LOBBY_MS) {
      if (room.seats.length >= VAULT_MIN_SEATS) startRoom(room, now);
      else dissolveRoom(room, now);
      dirty = true;
    } else if (
      (room.status === "settled" || room.status === "dissolved") &&
      room.settledAt !== undefined &&
      now - room.settledAt > VAULT_FINISHED_TTL_MS
    ) {
      rooms.delete(room.id);
      states.delete(room.id);
      dirty = true;
    }
  }
  if (dirty) persist();
}

// ---- Vistas -------------------------------------------------------------------

export function roomView(room: VaultRoom, address?: string): VaultRoomView {
  const base = {
    roomId: room.id,
    stake: room.stake,
    status: room.status,
    rulesV: VAULT_RULES_V,
    min: VAULT_MIN_SEATS,
    max: VAULT_MAX_SEATS,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    settledAt: room.settledAt,
    commit: room.commit,
  };
  if (room.status === "lobby" || room.status === "dissolved") {
    return {
      ...base,
      closesAt: room.createdAt + VAULT_LOBBY_MS,
      seats: room.seats.map((a) => ({ address: a, status: "alive" as SeatStatus, pocket: 0 })),
    };
  }
  const v = viewFor(stateOf(room), address);
  const out: VaultRoomView = { ...base, ...v, deadline: room.phaseDeadline };
  if (room.status === "settled") {
    out.secretSeed = room.secretSeed;
    const a = address ? normAddr(address) : undefined;
    if (a && room.eloUpdates?.[a]) out.rating = room.eloUpdates[a];
  }
  return out;
}

export function getVaultRoom(
  roomId: string,
  address?: string,
  now = Date.now(),
): VaultRoomView | null {
  settleDue(now);
  const room = rooms.get(roomId);
  return room ? roomView(room, address) : null;
}

export function listVaultLobbies(now = Date.now()): LobbySummary[] {
  settleDue(now);
  const out: LobbySummary[] = [];
  for (const id of openLobby.values()) {
    const r = rooms.get(id);
    if (!r || r.status !== "lobby") continue;
    out.push({
      roomId: r.id,
      stake: r.stake,
      seats: r.seats.length,
      min: VAULT_MIN_SEATS,
      max: VAULT_MAX_SEATS,
      closesAt: r.createdAt + VAULT_LOBBY_MS,
    });
  }
  return out;
}

/** Tests: vaciar todo en memoria (no toca el store). */
export function __resetVaultForTest(): void {
  rooms.clear();
  openLobby.clear();
  states.clear();
}
```

- [ ] **Step 4: Correr tests + typecheck**

Run: `node --import tsx --test apps/server/test/vault-lobby.test.ts && npm run typecheck:server && npm run lint`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/server/src/vault.ts apps/server/test/vault-lobby.test.ts
git commit -m "feat(árbitro): salas de La Bóveda — lobby por mesa, arranque con compromiso de semilla, disolución y persistencia

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Árbitro — acciones firmadas, cierres de fase, liquidación, ELO, registro público y ticker

**Files:**

- Modify: `apps/server/src/vault.ts`
- Test: `apps/server/test/vault-game.test.ts`

**Interfaces:**

- Consumes: `applyEvent`, `phaseComplete`, `validateAction`, `actionLine`, tipos `VaultAction`, `PhaseEndReason` (`/vault`); `vaultActionAuthMessage` (`/auth`); `applyMultiResult`; `recordMatchSettled`.
- Produces: `interface ActBody { stage: number; phase: string; action: unknown; signature?: string; ts?: number }`; `actVault(roomId: string, address: string, body: ActBody, now?: number): Promise<VaultRoomView>`; `vaultLog(roomId: string, now?: number)`; `recentVaultRooms(limit?: number, now?: number): RecentRoom[]`; `startVaultTicker(): void`; `settleDue` ahora también vence fases.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// apps/server/test/vault-game.test.ts
// Una sala de La Bóveda de punta a punta, in-process: 4 agentes guionados con
// firmas reales juegan hasta `settled`; después se verifica lo mismo que
// verificaría un tercero (compromiso, firmas, re-simulación). Más: firmas
// inválidas, plazos con reloj inyectado y persistencia a mitad de sala.
// Correr: node --import tsx --test apps/server/test/vault-game.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { keccak256, recoverMessageAddress, type Hex } from "viem";
import { vaultActionAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  actionLine,
  replayVault,
  type VaultAction,
  type VaultEvent,
} from "@arcade1v1/game-sdk/vault";
import { getRating } from "../src/ratings.js";
import * as V from "../src/vault.js";

const T0 = 1_800_000_000_000;
const accounts = (n: number) =>
  Array.from({ length: n }, () => privateKeyToAccount(generatePrivateKey()));
const low = (a: PrivateKeyAccount) => a.address.toLowerCase();

async function actSigned(
  roomId: string,
  acc: PrivateKeyAccount,
  stage: number,
  phase: "talk" | "decide",
  action: VaultAction,
  opts: { signer?: PrivateKeyAccount; ts?: number; now?: number; address?: string } = {},
) {
  const ts = opts.ts ?? opts.now ?? Date.now();
  const signature = await (opts.signer ?? acc).signMessage({
    message: vaultActionAuthMessage(roomId, stage, phase, actionLine(action), ts),
  });
  return V.actVault(
    roomId,
    opts.address ?? low(acc),
    { stage, phase, action, signature, ts },
    opts.now,
  );
}

/** Sala de 4 que arranca "ahora" (el lobby nació hace más de VAULT_LOBBY_MS). */
async function startRoom(accs: PrivateKeyAccount[], now = Date.now()) {
  const born = now - V.VAULT_LOBBY_MS - 1;
  let v;
  for (const a of accs) v = await V.joinVault(0, low(a), undefined, born);
  V.settleDue(now);
  const started = V.getVaultRoom(v!.roomId, low(accs[0]), now)!;
  assert.equal(started.status, "playing");
  return started.roomId;
}

/** Política guionada y determinística: el primer vivo guarda, el resto aporta;
 *  nadie acepta ofertas; todos votan al primer vivo que no sean ellos; nadie
 *  intenta la Cerradura; en la Final dividen. */
function policy(v: V.VaultRoomView, me: string): VaultAction {
  const st = v.stage!;
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

async function playOut(roomId: string, accs: PrivateKeyAccount[]): Promise<V.VaultRoomView> {
  let said = false;
  for (let guard = 0; guard < 400; guard++) {
    const pub = V.getVaultRoom(roomId)!;
    if (pub.status === "settled") return pub;
    for (const acc of accs) {
      const v = V.getVaultRoom(roomId, low(acc))!;
      if (v.status !== "playing" || v.you!.status !== "alive" || v.you!.decided || v.you!.ready)
        continue;
      const { index, phase } = v.stage!;
      if (!said) {
        said = true;
        await actSigned(roomId, acc, index, phase, { type: "say", text: "arranquemos" });
      }
      await actSigned(roomId, acc, index, phase, policy(v, low(acc)));
    }
  }
  throw new Error("la sala no terminó");
}

test("sala completa: 4 agentes firmando hasta settled; pagos, ELO, semilla revelada y registro verificable", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  const done = await playOut(roomId, accs);
  assert.equal(done.status, "settled");
  assert.equal(done.over, true);
  const payouts = done.payouts!;
  assert.equal(
    Object.values(payouts).reduce((a, b) => a + b, 0),
    4000,
  );
  assert.match(String(done.secretSeed), /^0x[0-9a-f]{64}$/);
  assert.equal(keccak256(done.secretSeed as Hex), done.commit);

  // ELO propio de vault, aplicado a los 4, y visible en la vista de cada asiento.
  for (const a of accs) {
    const mine = V.getVaultRoom(roomId, low(a))!;
    assert.ok(mine.rating, "rating en la vista del asiento");
    assert.equal(mine.rating!.after, getRating(low(a), "vault"));
  }
  assert.ok(
    accs.some((a) => getRating(low(a), "vault") !== 1000),
    "alguien movió su ELO",
  );
  assert.ok(
    accs.every((a) => getRating(low(a), "2048") === 1000),
    "no toca otros juegos",
  );

  // Registro público: lo que verificaría un tercero.
  const log = V.vaultLog(roomId);
  assert.equal(log.commit, done.commit);
  assert.deepEqual(replayVault(log.secretSeed!, log.seats, log.events).payouts, payouts);
  const first = log.events.find(
    (e): e is Extract<VaultEvent, { type: "action" }> => e.type === "action",
  )!;
  const signer = await recoverMessageAddress({
    message: vaultActionAuthMessage(
      roomId,
      first.stage,
      first.phase,
      actionLine(first.action),
      first.ts,
    ),
    signature: first.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), first.address);
  assert.ok(log.events.some((e) => e.type === "phase_end" && e.reason === "all_acted"));
  assert.ok(log.events.some((e) => e.type === "action" && e.action.type === "say"));
  assert.equal(V.recentVaultRooms(5)[0].roomId, roomId);
  assert.equal(V.recentVaultRooms(5)[0].stages, done.results!.length);
  // Antes de terminar, el registro está cerrado (se prueba en la sala del test de plazos).
});

test("firmas y forma: firmante ajeno, ts vencido, etapa vieja, no asiento, acción inválida, cuerpo incompleto", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  const [a, b] = accs;
  await assert.rejects(
    () => actSigned(roomId, a, 0, "decide", { type: "keep" }, { signer: b }),
    /bad signature/,
  );
  await assert.rejects(
    () => actSigned(roomId, a, 0, "decide", { type: "keep" }, { ts: Date.now() - 11 * 60_000 }),
    /auth expired/,
  );
  await assert.rejects(
    () => actSigned(roomId, a, 5, "decide", { type: "keep" }),
    /stage or phase mismatch/,
  );
  await assert.rejects(
    () => actSigned(roomId, a, 0, "talk", { type: "ready" }),
    /stage or phase mismatch/,
  );
  const stranger = accounts(1)[0];
  await assert.rejects(
    () => actSigned(roomId, stranger, 0, "decide", { type: "keep" }),
    /not a seat/,
  );
  await assert.rejects(
    () => V.actVault(roomId, low(a), { stage: 0, phase: "decide", action: { type: "explode" } }),
    /invalid action/,
  );
  await assert.rejects(
    () => V.actVault(roomId, low(a), { stage: 0, phase: "later", action: { type: "keep" } }),
    /invalid phase/,
  );
  await assert.rejects(
    () => V.actVault("0xnope", low(a), { stage: 0, phase: "decide", action: { type: "keep" } }),
    /room not found/,
  );
  // Una acción válida sí entra, y el asiento la ve como decidida.
  const ok = await actSigned(roomId, a, 0, "decide", { type: "keep" });
  assert.equal(ok.you!.decided, true);
  assert.deepEqual(ok.stage!.acted, [low(a)]);
  await assert.rejects(
    () => actSigned(roomId, a, 0, "decide", { type: "keep" }),
    /already decided/,
  );
});

test("plazos: las fases vencen con el reloj del árbitro, los ausentes deciden por defecto y varias fases vencen de una", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const S = T0;
  const roomId = await startRoom(accs, S);
  const me = low(accs[0]);
  assert.throws(() => V.vaultLog(roomId, S), /not settled/);
  assert.equal(V.getVaultRoom(roomId, me, S + V.VAULT_PHASE_MS - 1)!.stage!.index, 0);
  const after = V.getVaultRoom(roomId, me, S + V.VAULT_PHASE_MS)!;
  assert.equal(after.stage!.index, 1);
  assert.deepEqual(after.results![0].contributed, accs.map(low));
  assert.equal(after.results![0].kept!.length, 0);
  assert.equal(after.deadline, S + 2 * V.VAULT_PHASE_MS);
  // Nadie juega nunca: al cabo de muchas fases todos abandonan y la caja se reparte.
  const end = V.getVaultRoom(roomId, me, S + 100 * V.VAULT_PHASE_MS)!;
  assert.equal(end.status, "settled");
  for (const a of accs) assert.equal(end.payouts![low(a)], 1000);
  const log = V.vaultLog(roomId, S + 100 * V.VAULT_PHASE_MS);
  const ends = log.events.filter(
    (e): e is Extract<VaultEvent, { type: "phase_end" }> => e.type === "phase_end",
  );
  assert.ok(ends.every((e) => e.reason === "deadline"));
  for (let i = 1; i < ends.length; i++)
    assert.equal(
      ends[i].at - ends[i - 1].at,
      V.VAULT_PHASE_MS,
      "cada cierre lleva la hora de su plazo",
    );
  assert.equal(ends[0].at, S + V.VAULT_PHASE_MS);
  await assert.rejects(
    () =>
      actSigned(
        roomId,
        accs[0],
        0,
        "decide",
        { type: "keep" },
        { now: S + 100 * V.VAULT_PHASE_MS },
      ),
    /room not open/,
  );
});

test("persistencia a mitad de sala: serializar, restaurar y seguir hasta el final", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  await actSigned(roomId, accs[0], 0, "decide", { type: "keep" });
  await actSigned(roomId, accs[1], 0, "decide", { type: "say", text: "hola" });
  const raw = V.serializeVault();
  V.__resetVaultForTest();
  V.restoreVaultFrom(raw);
  const back = V.getVaultRoom(roomId, low(accs[0]))!;
  assert.equal(back.you!.decided, true);
  assert.equal(back.messages!.length, 1);
  const done = await playOut(roomId, accs);
  assert.equal(done.status, "settled");
  assert.equal(
    Object.values(done.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test apps/server/test/vault-game.test.ts`
Expected: FAIL (`actVault`, `vaultLog`, `recentVaultRooms` no existen).

- [ ] **Step 3: Completar `apps/server/src/vault.ts`**

Ampliar los imports:

```ts
import {
  createVault,
  replayVault,
  viewFor,
  applyEvent,
  phaseComplete,
  validateAction,
  actionLine,
  VAULT_RULES,
  VAULT_RULES_V,
  type VaultAction,
  type VaultEvent,
  type VaultState,
  type VaultView,
  type SeatStatus,
  type PhaseEndReason,
} from "@arcade1v1/game-sdk/vault";
import {
  matchmakeAuthMessage,
  vaultActionAuthMessage,
  MATCHMAKE_AUTH_TTL_MS,
} from "@arcade1v1/game-sdk/auth";
import { applyMultiResult, type RatingUpdate } from "./ratings.js";
import { recordMatchCreated, recordMatchSettled } from "./stats.js";
```

Reemplazar `settleDue` por esta versión (suma el vencimiento de fases):

```ts
/** Vence lobbies (arranca con ≥ mínimo, disuelve si no), vence FASES con el
 *  reloj del árbitro y purga salas viejas. Toda lectura/acción la llama
 *  primero con su reloj, así los tests no esperan y el ticker es solo un
 *  respaldo para salas que nadie consulta. */
export function settleDue(now = Date.now()): void {
  let dirty = false;
  for (const room of rooms.values()) {
    if (room.status === "lobby" && now - room.createdAt >= VAULT_LOBBY_MS) {
      if (room.seats.length >= VAULT_MIN_SEATS) startRoom(room, now);
      else dissolveRoom(room, now);
      dirty = true;
    } else if (
      room.status === "playing" &&
      room.phaseDeadline !== undefined &&
      now >= room.phaseDeadline
    ) {
      // Pueden vencer varias fases si el proceso estuvo dormido: cada cierre
      // lleva la hora de SU plazo (no `now`), así el registro es fiel.
      while (
        room.status === "playing" &&
        room.phaseDeadline !== undefined &&
        now >= room.phaseDeadline
      ) {
        closePhase(room, "deadline", room.phaseDeadline);
      }
      dirty = true;
    } else if (
      (room.status === "settled" || room.status === "dissolved") &&
      room.settledAt !== undefined &&
      now - room.settledAt > VAULT_FINISHED_TTL_MS
    ) {
      rooms.delete(room.id);
      states.delete(room.id);
      dirty = true;
    }
  }
  if (dirty) persist();
}
```

Agregar (antes de la sección "Vistas"):

```ts
// ---- Juego --------------------------------------------------------------------

export interface ActBody {
  stage: number;
  phase: string;
  action: unknown;
  signature?: string;
  ts?: number;
}

/** Cierra la fase actual con el motivo dado; si la sala terminó, la liquida. */
function closePhase(room: VaultRoom, reason: PhaseEndReason, at: number): void {
  const s = stateOf(room);
  const ev: VaultEvent = {
    type: "phase_end",
    stage: s.stage.index,
    phase: s.stage.phase,
    at,
    reason,
  };
  const next = applyEvent(s, ev);
  room.events.push(ev);
  states.set(room.id, next);
  if (next.over) settleRoom(room, next, at);
  else room.phaseDeadline = at + VAULT_PHASE_MS;
}

/** Liquidación: tabla de pagos del motor + ELO multi-jugador + métrica. En la
 *  etapa 4 acá se firma la tabla para el contrato. */
function settleRoom(room: VaultRoom, s: VaultState, now: number): void {
  room.status = "settled";
  room.settledAt = now;
  room.phaseDeadline = undefined;
  room.payouts = s.payouts;
  room.eloUpdates = applyMultiResult(
    "vault",
    room.seats.map((a) => ({ address: a, score: s.payouts![a] })),
  );
  recordMatchSettled(0, now);
}

/** Una acción firmada de un asiento. La firma cubre sala + etapa + fase +
 *  línea canónica + ts; el motor valida el resto y la rechaza si no vale. */
export async function actVault(
  roomId: string,
  address: string,
  body: ActBody,
  now = Date.now(),
): Promise<VaultRoomView> {
  settleDue(now);
  const room = rooms.get(roomId);
  if (!room) throw new VaultError("room not found");
  address = normAddr(address);
  if (!room.seats.includes(address)) throw new VaultError("not a seat of this room");
  if (room.status !== "playing") throw new VaultError(`room not open (${room.status})`);
  if (body.phase !== "talk" && body.phase !== "decide") throw new VaultError("invalid phase");
  const stage = Number(body.stage);
  if (!Number.isInteger(stage)) throw new VaultError("invalid stage");
  let action: VaultAction;
  try {
    action = validateAction(body.action);
  } catch (e) {
    throw new VaultError((e as Error).message);
  }
  const line = actionLine(action);
  if (body.signature) {
    const ts = Number(body.ts);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > MATCHMAKE_AUTH_TTL_MS) {
      throw new VaultError("auth expired");
    }
    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: vaultActionAuthMessage(room.id, stage, body.phase, line, ts),
        signature: body.signature as Hex,
      });
    } catch {
      throw new VaultError("bad signature");
    }
    if (signer.toLowerCase() !== address) throw new VaultError("bad signature");
  } else if (AUTH_REQUIRED) {
    throw new VaultError("signature required");
  }
  // Después del await el estado pudo cambiar (otra acción cerró la fase): se
  // aplica sobre el estado ACTUAL. Si la etapa/fase ya no coinciden, el motor
  // lo rechaza con "stage or phase mismatch" y el agente refresca su vista.
  const fresh = rooms.get(roomId);
  if (!fresh || fresh.status !== "playing") throw new VaultError("room not open");
  const s = stateOf(fresh);
  const ev: VaultEvent = {
    type: "action",
    address,
    stage,
    phase: body.phase,
    action,
    ts: Number(body.ts ?? now),
    signature: body.signature,
  };
  let next: VaultState;
  try {
    next = applyEvent(s, ev);
  } catch (e) {
    throw new VaultError((e as Error).message);
  }
  fresh.events.push(ev);
  states.set(fresh.id, next);
  const done = phaseComplete(next);
  if (done) closePhase(fresh, done, now);
  persist();
  return roomView(fresh, address);
}

/** Registro completo de una sala TERMINADA: semilla, compromiso, eventos
 *  firmados y tabla de pagos. Es lo que re-simula cualquier verificador. */
export function vaultLog(roomId: string, now = Date.now()) {
  settleDue(now);
  const room = rooms.get(roomId);
  if (!room) throw new VaultError("room not found");
  if (room.status !== "settled") throw new VaultError("room not settled yet");
  return {
    roomId: room.id,
    stake: room.stake,
    rulesV: VAULT_RULES_V,
    seats: room.seats,
    commit: room.commit,
    secretSeed: room.secretSeed,
    startedAt: room.startedAt,
    settledAt: room.settledAt,
    events: room.events,
    payouts: room.payouts,
  };
}

export interface RecentRoom {
  roomId: Hex;
  stake: number;
  seats: string[];
  startedAt?: number;
  settledAt?: number;
  stages: number;
  payouts?: Record<string, number>;
}

/** Salas terminadas recientes (para la web y los agentes curiosos). */
export function recentVaultRooms(limit = 20, now = Date.now()): RecentRoom[] {
  settleDue(now);
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
  return [...rooms.values()]
    .filter((r) => r.status === "settled")
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
    .slice(0, lim)
    .map((r) => ({
      roomId: r.id,
      stake: r.stake,
      seats: r.seats,
      startedAt: r.startedAt,
      settledAt: r.settledAt,
      stages: stateOf(r).results.length,
      payouts: r.payouts,
    }));
}

// ---- Ticker -------------------------------------------------------------------

let ticker: NodeJS.Timeout | undefined;

/** Respaldo: vence lobbies y fases aunque nadie consulte la sala. Lo arranca
 *  index.ts (nunca al importar: los tests usan su propio reloj). */
export function startVaultTicker(): void {
  if (ticker || !vaultEnabled()) return;
  ticker = setInterval(() => {
    try {
      settleDue();
    } catch (e) {
      console.error("[vault] tick:", (e as Error).message);
    }
  }, VAULT_TICK_MS);
  ticker.unref?.();
}
```

- [ ] **Step 4: Correr tests + typecheck**

Run: `node --import tsx --test apps/server/test/vault-game.test.ts apps/server/test/vault-lobby.test.ts && npm run typecheck:server && npm run lint`
Expected: PASS (4 + 5 tests).

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/server/src/vault.ts apps/server/test/vault-game.test.ts
git commit -m "feat(árbitro): La Bóveda juega — acciones firmadas, cierres por reloj, liquidación con ELO multi y registro público

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rutas HTTP, cableado en `index.ts` y knobs documentados

**Files:**

- Create: `apps/server/src/vault-routes.ts`
- Modify: `apps/server/src/index.ts` (imports; después del bloque de `/challenge`; discovery en `GET /`; `Promise.all` de restores; después de `startGasMonitor()`)
- Modify: `docs/CONFIGURATION.md` (nueva subsección después de "Hosted agents")
- Test: `apps/server/test/vault-routes.test.ts`

**Interfaces:**

- Consumes: `joinVault`, `getVaultRoom`, `actVault`, `vaultLog`, `listVaultLobbies`, `recentVaultRooms`, `restoreVault`, `startVaultTicker`, `VaultError`; `resolveDisplay` (`./profiles.js`).
- Produces: `vaultRouter` (Express `Router`) con `POST /vault/join`, `GET /vault/lobbies`, `GET /vault/recent`, `GET /vault/:id`, `POST /vault/:id/act`, `GET /vault/:id/log`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/server/test/vault-routes.test.ts
// Rutas HTTP de La Bóveda con REQUIRE_AUTH activado como en producción.
// Correr: node --import tsx --test apps/server/test/vault-routes.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { matchmakeAuthMessage, vaultActionAuthMessage } from "@arcade1v1/game-sdk/auth";
import { actionLine, type VaultAction } from "@arcade1v1/game-sdk/vault";

process.env.REQUIRE_AUTH = "true";
const { vaultRouter } = await import("../src/vault-routes.js");
const V = await import("../src/vault.js");

const app = express();
app.use(express.json());
app.use(vaultRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}
async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}
const low = (a: PrivateKeyAccount) => a.address.toLowerCase();

async function join(acc: PrivateKeyAccount, signer = acc) {
  const ts = Date.now();
  const signature = await signer.signMessage({
    message: matchmakeAuthMessage("vault", 0, low(acc), ts),
  });
  return post("/vault/join", { stake: 0, address: low(acc), signature, ts });
}

async function act(
  roomId: string,
  acc: PrivateKeyAccount,
  stage: number,
  phase: string,
  action: VaultAction,
  signer = acc,
) {
  const ts = Date.now();
  const signature = await signer.signMessage({
    message: vaultActionAuthMessage(roomId, stage, phase, actionLine(action), ts),
  });
  return post(`/vault/${roomId}/act`, { address: low(acc), stage, phase, action, signature, ts });
}

test("join: exige firma propia; lobby visible; vista pública; log cerrado; act en lobby rechazado", async () => {
  V.__resetVaultForTest();
  const a = privateKeyToAccount(generatePrivateKey());
  const b = privateKeyToAccount(generatePrivateKey());
  let r = await post("/vault/join", { stake: 0, address: low(a) });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /signature required/);
  r = await join(a, b);
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /bad signature/);
  r = await post("/vault/join", { address: low(a) });
  assert.equal(r.status, 400);
  r = await join(a);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "lobby");
  const roomId = String(r.body.roomId);

  r = await get("/vault/lobbies");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.lobbies.map((l: any) => [l.roomId, l.seats, l.min, l.max]),
    [[roomId, 1, 4, 8]],
  );
  r = await get(`/vault/${roomId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.seats[0].address, low(a));
  r = await get("/vault/0xnope");
  assert.equal(r.status, 404);
  r = await get(`/vault/${roomId}/log`);
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /not settled/);
  r = await act(roomId, a, 0, "decide", { type: "keep" });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /room not open/);
});

test("act: con 8 asientos arranca; la acción firmada entra; la ajena y la incompleta no", async () => {
  V.__resetVaultForTest();
  const accs = Array.from({ length: 8 }, () => privateKeyToAccount(generatePrivateKey()));
  let r;
  for (const acc of accs) r = await join(acc);
  assert.equal(r!.body.status, "playing");
  const roomId = String(r!.body.roomId);
  r = await act(roomId, accs[0], 0, "decide", { type: "keep" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.you.decided, true);
  r = await act(roomId, accs[1], 0, "decide", { type: "keep" }, accs[2]);
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /bad signature/);
  r = await post(`/vault/${roomId}/act`, { address: low(accs[1]), action: { type: "keep" } });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /faltan/);
  r = await get(`/vault/${roomId}?address=${low(accs[1])}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.you.decided, false);
  assert.deepEqual(r.body.stage.acted, [low(accs[0])]);
  r = await get("/vault/recent");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rooms, []);
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test apps/server/test/vault-routes.test.ts`
Expected: FAIL (`../src/vault-routes.js` no existe).

- [ ] **Step 3: Crear `apps/server/src/vault-routes.ts`**

```ts
// Rutas HTTP de La Bóveda (formato multi-agente). Capa fina sobre vault.ts:
// valida presencia de campos, traduce VaultError a 400 y decora los asientos
// con nombre/avatar (resolveDisplay), como el resto de las vistas públicas.
import { Router, type Response } from "express";
import {
  joinVault,
  getVaultRoom,
  actVault,
  vaultLog,
  listVaultLobbies,
  recentVaultRooms,
  VaultError,
} from "./vault.js";
import { resolveDisplay } from "./profiles.js";

function fail(res: Response, e: unknown): void {
  if (e instanceof VaultError) {
    res.status(400).json({ error: e.message });
    return;
  }
  console.error("[vault]", (e as Error)?.stack ?? e);
  res.status(500).json({ error: "internal error" });
}

const withDisplay = <T extends { address: string }>(seats: T[]) =>
  seats.map((s) => ({ ...s, ...resolveDisplay(s.address) }));

export const vaultRouter = Router();

// Pedir asiento (firmado en producción: matchmakeAuthMessage("vault", stake, address, ts)).
vaultRouter.post("/vault/join", async (req, res) => {
  const { stake, address, signature, ts } = req.body ?? {};
  if (stake === undefined || stake === null || !address) {
    return res.status(400).json({ error: "faltan stake o address" });
  }
  try {
    const auth = signature ? { signature: String(signature), ts: Number(ts) } : undefined;
    const v = await joinVault(Number(stake), String(address), auth);
    res.json({ ...v, seats: withDisplay(v.seats) });
  } catch (e) {
    fail(res, e);
  }
});

// Lobbies abiertos (para que un agente sepa que hay mesa esperando).
vaultRouter.get("/vault/lobbies", (_req, res) => {
  res.json({ lobbies: listVaultLobbies() });
});

// Salas terminadas recientes (espectador).
vaultRouter.get("/vault/recent", (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  res.json({ rooms: recentVaultRooms(limit) });
});

// Vista de una sala: con ?address= es la vista de ESE asiento (sin autenticar,
// pero solo expone lo que ese asiento puede saber: su fragmento y sus
// privados; nunca decisiones ajenas ni la semilla antes del cierre).
vaultRouter.get("/vault/:id", (req, res) => {
  const v = getVaultRoom(String(req.params.id), req.query.address as string | undefined);
  if (!v) return res.status(404).json({ error: "room not found" });
  res.json({ ...v, seats: withDisplay(v.seats) });
});

// Una acción firmada: { address, stage, phase, action, signature, ts }.
vaultRouter.post("/vault/:id/act", async (req, res) => {
  const { address, stage, phase, action, signature, ts } = req.body ?? {};
  if (!address || stage === undefined || stage === null || !phase || !action) {
    return res.status(400).json({ error: "faltan address, stage, phase o action" });
  }
  try {
    const v = await actVault(String(req.params.id), String(address), {
      stage: Number(stage),
      phase: String(phase),
      action,
      signature: signature ? String(signature) : undefined,
      ts: ts === undefined || ts === null ? undefined : Number(ts),
    });
    res.json({ ...v, seats: withDisplay(v.seats) });
  } catch (e) {
    fail(res, e);
  }
});

// Registro completo (solo salas terminadas): semilla, eventos firmados, pagos.
vaultRouter.get("/vault/:id/log", (req, res) => {
  try {
    res.json(vaultLog(String(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});
```

- [ ] **Step 4: Cablear en `apps/server/src/index.ts`**

Imports (junto a los demás):

```ts
import { vaultRouter } from "./vault-routes.js";
import { restoreVault, startVaultTicker } from "./vault.js";
```

Después del bloque de `/challenge` (`app.use(challengeRouter);`):

```ts
// LA BÓVEDA (formato multi-agente): sentarse y actuar recuperan una firma ->
// límite estricto; las lecturas quedan con el límite global.
app.use("/vault", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(vaultRouter);
```

En el objeto `endpoints` del discovery (`GET /`), después de `"POST /challenge"`:

```ts
      "POST /vault/join":
        "{ stake: 0, address, signature, ts } -> a seat in La Bóveda, the 4–8 agent room (sign matchmakeAuthMessage('vault', stake, address, ts)). Rules: @arcade1v1/game-sdk/vault (VAULT_RULES, rulesV)",
      "GET /vault/lobbies": "open rooms waiting for seats",
      "GET /vault/:id?address=": "room view for that seat (stage, phase, deadline, pot, box, seats, your fragment, messages)",
      "POST /vault/:id/act":
        "{ address, stage, phase, action, signature, ts } -> one signed action (keep/contribute, accept/decline, vote, submit, split/steal, ready, say, whisper). Sign vaultActionAuthMessage(roomId, stage, phase, actionLine(action), ts)",
      "GET /vault/:id/log": "settled room: secret seed, commit, signed events, payouts (re-simulate with replayVault)",
      "GET /vault/recent?limit=": "recently settled rooms",
```

En el `Promise.all` de restores, agregar `restoreVault()` al final de la lista. Después de `startGasMonitor();`:

```ts
// La Bóveda: el ticker vence lobbies y fases aunque nadie consulte la sala.
startVaultTicker();
```

- [ ] **Step 5: Documentar los knobs en `docs/CONFIGURATION.md`** (nueva subsección después de "Hosted agents", mismo formato de tabla)

```markdown
### La Bóveda (multi-agent rooms)

| Variable                | Required | Default           | Description                                                                                                                                                                 |
| ----------------------- | -------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VAULT_ENABLED`         | Optional | `true`            | Kill switch for the multi-agent rooms: `"false"` rejects new seats and stops the ticker (rooms in progress are not touched until restart). Read per call in `src/vault.ts`. |
| `VAULT_MIN_SEATS`       | Optional | `4`               | Minimum seats for a lobby to start when its time runs out. Clamped to `[4, 8]` (the engine's rules). Read in `src/vault.ts`.                                                |
| `VAULT_MAX_SEATS`       | Optional | `8`               | Seats that start a room immediately. Clamped to `[VAULT_MIN_SEATS, 8]`. Read in `src/vault.ts`.                                                                             |
| `VAULT_LOBBY_MS`        | Optional | `600000` (10 min) | How long a lobby waits before starting (≥ min seats) or dissolving. Read in `src/vault.ts`.                                                                                 |
| `VAULT_PHASE_MS`        | Optional | `120000` (2 min)  | Deadline of every phase (talk / decide). A phase also closes early when every alive seat acted. Read in `src/vault.ts`.                                                     |
| `VAULT_TICK_MS`         | Optional | `5000` (5 s)      | Ticker cadence that expires lobbies and phases even when nobody polls the room. Read in `src/vault.ts`.                                                                     |
| `VAULT_MAX_ROOMS`       | Optional | `50`              | Cap on live rooms (lobby + playing) at once; beyond it, `POST /vault/join` answers `400 room limit`. Read in `src/vault.ts`.                                                |
| `VAULT_FINISHED_TTL_MS` | Optional | `604800000` (7 d) | How long settled/dissolved rooms (and their public logs) are kept before purge. Read in `src/vault.ts`.                                                                     |

Only the free table (stake 0) exists in this version: the `VAULT_STAKES` knob
from the design spec arrives with the N-deposit escrow (stage 4). The game
rules themselves (percentages, message caps, absences) are **not** env vars:
they live in `VAULT_RULES` (`packages/game-sdk/src/vault-rules.ts`) and are
versioned by `VAULT_RULES_V`.
```

- [ ] **Step 6: Correr tests + check parcial**

Run: `node --import tsx --test apps/server/test/vault-routes.test.ts && npm run typecheck && npm run lint && npm run format:check`
Expected: PASS (2 tests); todo limpio. Arrancar el servidor una vez (`npm run server`) y comprobar a mano `curl -s localhost:4000/ | grep -c vault` → `6`, y `curl -s localhost:4000/vault/lobbies` → `{"lobbies":[]}`. Parar el servidor.

- [ ] **Step 7: Commit**

```bash
npm run format
git add apps/server/src/vault-routes.ts apps/server/src/index.ts apps/server/test/vault-routes.test.ts docs/CONFIGURATION.md
git commit -m "feat(árbitro): rutas /vault/* con firma obligatoria en producción, discovery y knobs documentados

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Verificador público, chequeo completo y cierre de la etapa

**Files:**

- Create: `scripts/vault-verify.mjs`
- Modify: `apps/server/test/vault-game.test.ts` (un test más)
- Modify: `docs/CONFIGURATION.md` (fila en "Internal / dev-only scripts")
- Modify: `docs/superpowers/specs/2026-09-05-la-boveda-design.md` (corrección de la cuenta de etapas)

**Interfaces:**

- Produces: `verifyVaultLog(log): { ok: boolean; checks: { name: string; ok: boolean }[] }` (exportado del script, también usable como módulo) y el CLI `node --import tsx scripts/vault-verify.mjs <arbiterUrl> <roomId>`.

- [ ] **Step 1: Agregar el test que falla** (al final de `vault-game.test.ts`)

```ts
test("scripts/vault-verify: da OK con el registro real y detecta una tabla adulterada", async () => {
  const { verifyVaultLog } = await import("../../../scripts/vault-verify.mjs");
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  await playOut(roomId, accs);
  const log = JSON.parse(JSON.stringify(V.vaultLog(roomId))); // como llega por HTTP
  const good = await verifyVaultLog(log);
  assert.equal(good.ok, true, JSON.stringify(good.checks));
  const forged = {
    ...log,
    payouts: { ...log.payouts, [log.seats[0]]: log.payouts[log.seats[0]] + 1 },
  };
  const bad = await verifyVaultLog(forged);
  assert.equal(bad.ok, false);
  assert.ok(
    bad.checks.some((c: { name: string; ok: boolean }) => /re-simulación/.test(c.name) && !c.ok),
  );
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test apps/server/test/vault-game.test.ts`
Expected: FAIL (el script no existe).

- [ ] **Step 3: Crear `scripts/vault-verify.mjs`**

Importa `viem` igual que `apps/server`; con los workspaces de npm el paquete
queda hoisteado en el `node_modules` raíz y resuelve desde `scripts/` (como
`gap-check.mjs` resuelve `@arcade1v1/strategies`). Si al correr el test el
import de `viem` fallara, agregar `"viem": "^2.53.1"` a las `devDependencies`
del `package.json` raíz y correr `npm install`.

```js
#!/usr/bin/env node
// Verificador PÚBLICO de una sala de La Bóveda: cualquiera puede comprobar que
// el árbitro no hizo trampa, sin confiar en él. Tres chequeos sobre el
// registro que devuelve GET /vault/:id/log:
//   1) keccak256(secretSeed) == commit publicado al arrancar (el azar no cambió);
//   2) cada acción del registro está firmada por su asiento (nadie habló por otro);
//   3) re-simular el registro con el motor público da la MISMA tabla de pagos.
// Uso: node --import tsx scripts/vault-verify.mjs <arbiterUrl> <roomId>
import { pathToFileURL } from "node:url";
import { keccak256, recoverMessageAddress } from "viem";
import { replayVault, actionLine } from "@arcade1v1/game-sdk/vault";
import { vaultActionAuthMessage } from "@arcade1v1/game-sdk/auth";

/** Corre los tres chequeos sobre un registro ya descargado. */
export async function verifyVaultLog(log) {
  const checks = [];
  const check = (ok, name) => checks.push({ name, ok });

  check(keccak256(log.secretSeed) === log.commit, "compromiso: keccak256(secretSeed) == commit");

  let signed = 0;
  let unsigned = 0;
  let badSig = 0;
  for (const ev of log.events) {
    if (ev.type !== "action") continue;
    if (!ev.signature) {
      unsigned++;
      continue;
    }
    try {
      const signer = await recoverMessageAddress({
        message: vaultActionAuthMessage(
          log.roomId,
          ev.stage,
          ev.phase,
          actionLine(ev.action),
          ev.ts,
        ),
        signature: ev.signature,
      });
      if (signer.toLowerCase() === ev.address) signed++;
      else badSig++;
    } catch {
      badSig++;
    }
  }
  check(
    badSig === 0,
    `firmas: ${signed} válidas, ${badSig} inválidas, ${unsigned} sin firma (sin firma solo vale fuera de producción)`,
  );

  let payouts = null;
  let potInitial = 0;
  try {
    const s = replayVault(log.secretSeed, log.seats, log.events);
    payouts = s.payouts;
    potInitial = s.potInitial;
  } catch (e) {
    check(false, `re-simulación: el registro no se puede re-jugar (${e.message})`);
  }
  if (payouts) {
    check(
      JSON.stringify(payouts) === JSON.stringify(log.payouts),
      "re-simulación: la tabla de pagos coincide con la publicada",
    );
    const total = Object.values(payouts).reduce((a, b) => a + b, 0);
    check(total === potInitial, `la tabla suma el total (${total} de ${potInitial})`);
  }
  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const [url, roomId] = process.argv.slice(2);
  if (!url || !roomId) {
    console.error("uso: node --import tsx scripts/vault-verify.mjs <arbiterUrl> <roomId>");
    process.exit(2);
  }
  const r = await fetch(`${url.replace(/\/+$/, "")}/vault/${roomId}/log`);
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${await r.text()}`);
    process.exit(2);
  }
  const { ok, checks } = await verifyVaultLog(await r.json());
  for (const c of checks) console.log(`${c.ok ? "✔" : "✘"} ${c.name}`);
  console.log(ok ? "\nSala verificada." : "\nLA SALA NO VERIFICA.");
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [ ] **Step 4: Documentar el script y corregir la cuenta de etapas del spec**

En `docs/CONFIGURATION.md`, sección "Internal / dev-only scripts (not part of the running server)", agregar una fila con el mismo formato que las existentes:

```markdown
| `scripts/vault-verify.mjs` | `node --import tsx scripts/vault-verify.mjs <arbiterUrl> <roomId>` — verifies a settled La Bóveda room like any third party would: seed commitment, every action's signature, and that re-simulating the public log yields the published payout table. No env vars. |
```

En el spec (`docs/superpowers/specs/2026-09-05-la-boveda-design.md`), sección "Plazos y ausencias", reemplazar la viñeta "Duración" por:

```markdown
- Duración: 4 asientos ≈ 8 etapas y 12 fases (hasta ~25 min si todas las fases
  agotan el plazo); 8 asientos ≈ 12 etapas y 20 fases (hasta ~40 min). Es el
  peor caso, con nadie aceptando Ofertas; con agentes que responden rápido,
  bastante menos.
```

(La cuenta anterior olvidaba la Final: Reparto inicial + N + 2 cartas + Final.)

- [ ] **Step 5: Chequeo completo del repo**

Run: `npm run check`
Expected: typecheck, lint, prettier, TODOS los tests (los viejos y los nuevos) y el selftest en verde. Si `format:check` falla, `npm run format` y volver a correr.

- [ ] **Step 6: Commit y resumen para el dueño**

```bash
git add scripts/vault-verify.mjs apps/server/test/vault-game.test.ts docs/CONFIGURATION.md docs/superpowers/specs/2026-09-05-la-boveda-design.md
git commit -m "feat(vault): verificador público de salas (compromiso, firmas, re-simulación) y cierre de la etapa 1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline main..HEAD
```

Con eso la etapa 1 queda completa en la rama `feat/la-boveda`, sin pushear.
Reportar al dueño: qué se puede hacer ya (sentarse y jugar por HTTP con
cualquier script), qué no todavía (MCP/SDK/ejemplo LLM = etapa 2; web = etapa
3), y pedir el OK para abrir el PR a `main` (que exige los 2 checks de CI).
