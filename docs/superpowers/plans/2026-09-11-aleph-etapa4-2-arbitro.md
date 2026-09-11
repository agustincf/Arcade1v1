# Aleph — Etapa 4, PR 2 de 3: el árbitro (fondeo, pases, conversión y liquidación on-chain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el árbitro sepa jugar una mesa de plata de punta a punta: un lobby con `stake > 0` que se cierra entra en una fase nueva, **`funding`**, donde cada asiento recibe su pase firmado y los datos para depositar; el árbitro mira la cadena hasta que están los N depósitos y recién ahí sortea la semilla y arranca; al liquidar convierte la tabla de unidades a USDC, la firma y la manda al contrato; y si el fondeo vence o la sala se rompe, cancela on-chain para que cada uno recupere lo suyo. Todo detrás de `ALEPH_STAKES`: mientras la única mesa sea la gratis (`"0"`, el default) nada de lo que hay hoy cambia.

**Architecture:** El motor no se toca (sigue en unidades: `1000 × N`). Lo compartido y puro va al `game-sdk` (subpath `/aleph`): la tabla de conversión `usdcPayoutTable` (floor por asiento, polvo aparte) y el ABI de `EscrowAleph`; sin agregar dependencias (el `game-sdk` no depende de `viem` y así se queda). En el servidor: `sign.ts` gana el dominio EIP-712 de Aleph y las dos firmas (pase y tabla); `onchain.ts` exporta sus clientes viem; un módulo nuevo `aleph-chain.ts` encapsula TODA la cadena detrás de una interfaz `AlephChain` inyectable (los tests corren con una cadena falsa, sin nodo); y `aleph.ts` suma el estado `funding`, un tick asíncrono `alephChainTick` que sincroniza depósitos, arranca salas fondeadas, liquida y reembolsa (con cola y backoff), y los campos nuevos de vista y registro. El cruce real árbitro ↔ contrato lo prueba un e2e en anvil que corre en CI.

**Tech Stack:** TypeScript estricto, Node ≥ 22, `node:test` + `node:assert/strict` (`node --import tsx --test`), viem 2.53 (`signTypedData`, `hashTypedData`, `encodeAbiParameters`, `recoverTypedDataAddress`), Express 5, Foundry/anvil para el e2e.

**Spec:** `docs/superpowers/specs/2026-09-10-aleph-etapa4-mesas-de-plata-design.md`, secciones "La fase de fondeo", "De unidades a USDC", "Los tres reembolsos", "La casa nunca se sienta", "Árbitro", "Seguridad" (el verificador) y "Tests › Árbitro / Propiedad / E2E". **Depende del PR 1** (`docs/superpowers/plans/2026-09-11-aleph-etapa4-1-contrato.md`, mergeado): el ABI, los nombres de funciones y la forma del pase salen de ahí. Desvíos deliberados:

1. El spec dice "`POST /aleph/join` para un stake > 0 devuelve el pase firmado y los datos del depósito, en vez de sentar directo". Se sienta igual que hoy (el lobby es gratis y fuera de la cadena, como dice el propio spec) y el pase aparece en la vista PRIVADA del asiento **cuando la sala ya está en `funding`**: en la respuesta de `join` (que va firmada) y en `GET /aleph/:id` con pase de vista válido. Antes de eso no hay lista congelada que firmar.
2. El árbitro **no espera un aviso del agente**: lee la cadena en cada tick (`roomOf` + `depositors`, dos lecturas por sala en fondeo cada 5 s) y también cuando alguien consulta la sala. Un agente deposita y sondea su vista; no hay endpoint nuevo de "ya deposité".
3. La liquidación on-chain la manda el árbitro (paga el gas, como en los `cancelMatch` del 1v1), pero **la firma de la tabla se publica** en la vista y en el registro: si la transacción del árbitro fallara, cualquiera puede presentar `settle` por su cuenta.
4. El test "la casa no se sienta en una mesa de plata" que el spec da por existente **no existe** (`aleph-house.test.ts` no tiene ningún caso con `stake > 0`): se agrega acá.

## Global Constraints

- Rama: `feat/aleph-etapa4-arbitro` desde `main` **después de mergear el PR 1**. **`main` no acepta push directo**: PR + 2 checks de CI.
- Cada tarea termina en verde: `npm run typecheck && npm run lint && npm run format:check` y los tests del archivo tocado; antes del último commit, `npm run check` completo.
- Estilo del repo: comentarios en **español** que explican el porqué; identificadores en inglés; mensajes de error en inglés corto; addresses normalizadas a minúsculas antes de comparar (`normAddr`); perillas con `envNum` (un valor inválido cae al default).
- Contrato de firmas del árbitro (de `apps/server/src/sign.ts`, NO redefinir en otro lado): dominio `{ name: "Arcade1v1EscrowAleph", version: "1", chainId: CHAIN_ID, verifyingContract: ALEPH_ESCROW_ADDRESS }`; pase `Seat(bytes32 roomId,bytes32 seatsHash,uint256 stake,uint64 fundDeadline,uint64 playDeadline,address player)`; tabla `Payout(bytes32 roomId,bytes32 tableHash)`; `seatsHash = keccak256(abi.encode(seats))`, `tableHash = keccak256(abi.encode(seats, amounts))` (viem: `encodeAbiParameters`). Deadlines en **segundos** on-chain, en **milisegundos** en el árbitro.
- Constantes del spec: plazo de fondeo **10 min** (`ALEPH_FUNDING_MS`, default `600000`); ventana de juego on-chain **3 h** (`ALEPH_PLAY_WINDOW_MS`, default `10800000`; el mazo tiene a lo sumo N+2 etapas ≈ 22 fases de 2 min, sobra); stake **2 USDC** (`ALEPH_STAKES="0,2"` en producción; la gratis siempre está); la comisión se **lee del contrato** (`feeBps()`) al liquidar, nunca del env.
- Variables de entorno nuevas del árbitro: `ALEPH_STAKES` (default `"0"`), `ALEPH_ESCROW_ADDRESS` (sin default; sin ella, toda mesa de plata se rechaza), `ALEPH_FUNDING_MS`, `ALEPH_PLAY_WINDOW_MS`. Reusa `RPC_URL`, `CHAIN_ID`, `ARBITER_PRIVATE_KEY` (misma llave que el 1v1; el contrato de Aleph se despliega con `ARBITER_ADDRESS` = esa misma address).
- Estado on-chain (de `EscrowAleph.Status`, PR 1): `None 0 · Funding 1 · Funded 2 · Settled 3 · Refunded 4`. Mensajes de revert que el árbitro interpreta: `"not funded"`, `"cant cancel"`, `"room exists"`.
- Los tests del servidor corren **sin nodo**: `setAlephChainForTest(fake)` antes de usar una mesa de plata. Nada de lo nuevo puede importar `onchain.ts` en el camino de un test sin `ALEPH_ESCROW_ADDRESS`.
- No escribir secuencias `\u` (backslash-u) en ningún archivo ni parámetro.
- Commits chicos, mensajes en español con prefijo (`feat(game-sdk): …`, `feat(server): …`, `test(server): …`, `chore(ci): …`, `docs: …`) y el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `npm run format` antes de commitear si `format:check` falla.

## File structure

| Archivo                                                      | Responsabilidad                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/game-sdk/src/aleph-escrow.ts` (nuevo)              | Puro y compartido: `ALEPH_ESCROW_STATUS`, `escrowAlephAbi`, `erc20MinimalAbi`, `stakeToUnits`, `usdcPayoutTable`                                                                             |
| `packages/game-sdk/src/aleph.ts` (modificar, 1 línea)        | `export * from "./aleph-escrow";`                                                                                                                                                            |
| `packages/game-sdk/test/aleph-usdc.test.ts` (nuevo)          | Propiedad: sobre salas aleatorias, `Σ amounts + fee + dust == pot` y `dust < N`; los números fijos de la suite Solidity                                                                      |
| `apps/server/src/sign.ts` (modificar)                        | `alephDomain`, `ALEPH_SEAT_TYPES`, `ALEPH_PAYOUT_TYPES`, `alephSeatsHash`, `alephTableHash`, `signAlephSeat`, `signAlephPayout`                                                              |
| `apps/server/test/aleph-sign.test.ts` (nuevo)                | Las firmas recuperan a la address del árbitro; el pase cambia con cada campo; addresses en minúsculas o checksummed firman igual                                                             |
| `apps/server/src/onchain.ts` (modificar)                     | Exportar `chain()`, `readClient()`, `writeClients()` (hoy privados) para que `aleph-chain.ts` no duplique clientes                                                                           |
| `apps/server/src/aleph-chain.ts` (nuevo)                     | `alephOnchainEnabled`, `alephEscrowAddress`, `alephChainId`, interfaz `AlephChain` (`readRoom`, `feeBps`, `usdcAddress`, `cancelRoom`, `settle`), impl real con viem, `setAlephChainForTest` |
| `apps/server/src/aleph.ts` (modificar)                       | Estado `funding`, perillas nuevas, `ALEPH_STAKES`, pases, `alephChainTick`, liquidación/reembolso on-chain con backoff, vistas/log/lobbies con los campos nuevos                             |
| `apps/server/src/aleph-routes.ts` (modificar)                | `GET /aleph/lobbies` devuelve `{ lobbies, stakes }`                                                                                                                                          |
| `apps/server/src/config-guard.ts` (modificar)                | `ALEPH_STAKES` con plata exige `ALEPH_ESCROW_ADDRESS` bien formada; los chequeos on-chain corren si CUALQUIERA de los dos escrows está activo                                                |
| `apps/server/src/index.ts` (modificar)                       | Índice de la API (`GET /`): las rutas de Aleph mencionan la mesa de plata; nada más (el ticker ya arranca)                                                                                   |
| `apps/server/test/aleph-funding.test.ts` (nuevo)             | Con cadena falsa: `lobby → funding → playing`, pase por asiento, fondeo incompleto disuelve y reembolsa, pase atado a la sala, liquidación firmada y enviada, reintento, persistencia        |
| `apps/server/test/aleph-house.test.ts` (modificar)           | "La casa nunca completa una mesa de plata"                                                                                                                                                   |
| `apps/server/test/config-guard.test.ts` (modificar)          | Los casos de `ALEPH_*`                                                                                                                                                                       |
| `apps/server/test/aleph-lobby.test.ts` (modificar, 1 assert) | El mensaje de `stake not allowed` ahora lista las mesas de `ALEPH_STAKES`                                                                                                                    |
| `scripts/aleph-verify.mjs` (modificar)                       | Si el registro trae `usdc`, recalcula la tabla en USDC y la compara                                                                                                                          |
| `apps/server/src/aleph-onchain-e2e.ts` (nuevo)               | E2E en anvil con el árbitro REAL: digests iguales, 4 wallets fondean, juegan y cobran; fondeo incompleto se cancela y devuelve                                                               |
| `packages/contracts/check-aleph-e2e.sh` (nuevo)              | Levanta anvil, despliega MockUSDC + EscrowAleph y corre el e2e                                                                                                                               |
| `.github/workflows/ci.yml` (modificar)                       | Paso `Pago de Aleph en cadena local (anvil)` en el job `contracts`                                                                                                                           |
| `docs/CONFIGURATION.md` (modificar)                          | Las 4 variables nuevas y el párrafo "Only the free table…" reescrito                                                                                                                         |

---

### Task 1: Lo puro y compartido en el `game-sdk`: tabla en USDC y ABI

**Files:**

- Create: `packages/game-sdk/src/aleph-escrow.ts`
- Modify: `packages/game-sdk/src/aleph.ts` (línea 20: junto a `export * from "./aleph-rules";`)
- Test: `packages/game-sdk/test/aleph-usdc.test.ts`

**Interfaces:**

- Consumes: nada (sin dependencias; NO importar `viem` en el `game-sdk`).
- Produces: `ALEPH_ESCROW_STATUS`, `stakeToUnits(stake: number): bigint`, `usdcPayoutTable(seats: string[], payouts: Record<string, number>, stakeUnits: bigint, feeBps: number): { pot: bigint; fee: bigint; net: bigint; amounts: bigint[]; dust: bigint }`, `escrowAlephAbi`, `erc20MinimalAbi`. Todo re-exportado desde `@arcade1v1/game-sdk/aleph`.

- [ ] **Step 0: Pararse en la rama**

```bash
git fetch origin && git checkout -b feat/aleph-etapa4-arbitro origin/main
git log --oneline -1 -- packages/contracts/src/EscrowAleph.sol   # tiene que existir (PR 1 mergeado)
```

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/game-sdk/test/aleph-usdc.test.ts
// La conversión de la tabla de unidades a USDC pasa SOLO en el borde y tiene
// que cerrar exacto con el contrato: Σ amounts + comisión + polvo == depositado,
// y el polvo es menor que N (el contrato exige `net - Σ < N`).
// Correr: node --import tsx --test packages/game-sdk/test/aleph-usdc.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { usdcPayoutTable, stakeToUnits, ALEPH_ESCROW_STATUS, ALEPH_RULES } from "../src/aleph.ts";

const seatsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));

/** Reparte 1000·N unidades entre N asientos al azar (enteros, suman exacto). */
function randomPayouts(seats: string[], rnd: () => number): Record<string, number> {
  const total = ALEPH_RULES.UNITS_PER_SEAT * seats.length;
  const cuts = Array.from({ length: seats.length - 1 }, () => Math.floor(rnd() * (total + 1))).sort(
    (a, b) => a - b,
  );
  const out: Record<string, number> = {};
  let prev = 0;
  seats.forEach((a, i) => {
    const next = i === seats.length - 1 ? total : cuts[i];
    out[a] = next - prev;
    prev = next;
  });
  return out;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("stakeToUnits: 2 USDC son 2_000_000 micro-USDC; 0 es 0n", () => {
  assert.equal(stakeToUnits(2), 2_000_000n);
  assert.equal(stakeToUnits(0), 0n);
  assert.equal(stakeToUnits(0.5), 500_000n);
});

test("los números de la suite Solidity: 1700/1100/700/500 con 15 % sobre 8 USDC", () => {
  const seats = seatsOf(4);
  const payouts = { [seats[0]]: 1700, [seats[1]]: 1100, [seats[2]]: 700, [seats[3]]: 500 };
  const t = usdcPayoutTable(seats, payouts, 2_000_000n, 1500);
  assert.equal(t.pot, 8_000_000n);
  assert.equal(t.fee, 1_200_000n);
  assert.equal(t.net, 6_800_000n);
  assert.deepEqual(t.amounts, [2_890_000n, 1_870_000n, 1_190_000n, 850_000n]);
  assert.equal(t.dust, 0n);
});

test("propiedad: Σ amounts + fee + dust == pot y dust < N, para 400 salas al azar", () => {
  const rnd = mulberry(20260911);
  for (let k = 0; k < 400; k++) {
    const n = 4 + Math.floor(rnd() * 5); // 4..8
    const seats = seatsOf(n);
    const payouts = randomPayouts(seats, rnd);
    const feeBps = [0, 1500, 2000][Math.floor(rnd() * 3)];
    const t = usdcPayoutTable(seats, payouts, 2_000_000n, feeBps);
    const paid = t.amounts.reduce((x, y) => x + y, 0n);
    assert.equal(paid + t.fee + t.dust, t.pot, `sala ${k}: la cuenta cierra exacta`);
    assert.ok(t.dust < BigInt(n), `sala ${k}: polvo ${t.dust} < N=${n}`);
    assert.ok(t.amounts.every((a) => a >= 0n && a <= t.net));
    // Monótona: más unidades nunca cobran menos USDC.
    const byUnits = seats
      .map((a, i) => [payouts[a], t.amounts[i]] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < byUnits.length; i++) assert.ok(byUnits[i][1] >= byUnits[i - 1][1]);
  }
});

test("las addresses se buscan en minúsculas y una tabla vacía se rechaza", () => {
  const seats = seatsOf(4).map((a) => a.toUpperCase().replace("0X", "0x"));
  const payouts = Object.fromEntries(seats.map((a) => [a.toLowerCase(), 1000]));
  const t = usdcPayoutTable(seats, payouts, 2_000_000n, 1500);
  assert.deepEqual(t.amounts, [1_700_000n, 1_700_000n, 1_700_000n, 1_700_000n]);
  assert.throws(() => usdcPayoutTable(seatsOf(4), {}, 2_000_000n, 1500), /empty payout table/);
});

test("el enum del contrato está copiado en orden", () => {
  assert.deepEqual(ALEPH_ESCROW_STATUS, {
    None: 0,
    Funding: 1,
    Funded: 2,
    Settled: 3,
    Refunded: 4,
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test packages/game-sdk/test/aleph-usdc.test.ts`
Expected: FAIL (`usdcPayoutTable` no se exporta de `../src/aleph.ts`).

- [ ] **Step 3: Implementar**

```ts
// packages/game-sdk/src/aleph-escrow.ts
// LA CADENA de las mesas de plata de Aleph, en su parte PURA y compartida: el
// estado del contrato, la conversión de la tabla de unidades a USDC y el ABI de
// EscrowAleph. Lo usan el árbitro (firma y liquida), el agent-sdk (deposita) y
// el verificador público. Sin dependencias: el game-sdk no trae viem.
//
// El motor sigue contando en unidades enteras (1000 por asiento): cambiar eso
// obligaría a subir ALEPH_RULES_V. La conversión pasa SOLO acá, al borde.

/** `EscrowAleph.Status` (packages/contracts/src/EscrowAleph.sol), en orden. */
export const ALEPH_ESCROW_STATUS = {
  None: 0,
  Funding: 1,
  Funded: 2,
  Settled: 3,
  Refunded: 4,
} as const;

/** USDC tiene 6 decimales: 2 USDC -> 2_000_000n. */
export function stakeToUnits(stake: number): bigint {
  return BigInt(Math.round(stake * 1_000_000));
}

export interface UsdcPayoutTable {
  pot: bigint; // stake × N
  fee: bigint; // pot × feeBps / 10000
  net: bigint; // pot − fee: lo que se reparte
  amounts: bigint[]; // en el MISMO orden que `seats`
  dust: bigint; // net − Σ amounts, siempre < N; va a la plataforma con la comisión
}

/** Tabla en micro-USDC a partir de la tabla en unidades del motor:
 *  `amounts[i] = floor(units[i] × net / Σ units)`. El polvo del redondeo (menos
 *  de N micro-USDC) queda aparte y el contrato lo manda a la plataforma; así
 *  `Σ amounts + fee + dust == pot` exacto, que es lo que el contrato exige
 *  (`Σ ≤ net` y `net − Σ < N`). Las addresses de `payouts` van en minúsculas
 *  (como las escribe el árbitro); `seats` se normaliza acá. */
export function usdcPayoutTable(
  seats: string[],
  payouts: Record<string, number>,
  stakeUnits: bigint,
  feeBps: number,
): UsdcPayoutTable {
  const n = BigInt(seats.length);
  const pot = stakeUnits * n;
  const fee = (pot * BigInt(feeBps)) / 10000n;
  const net = pot - fee;
  const units = seats.map((a) => BigInt(payouts[a.toLowerCase()] ?? 0));
  const total = units.reduce((x, y) => x + y, 0n);
  if (total <= 0n) throw new Error("empty payout table");
  const amounts = units.map((u) => (u * net) / total);
  const paid = amounts.reduce((x, y) => x + y, 0n);
  return { pot, fee, net, amounts, dust: net - paid };
}

/** ABI de EscrowAleph (solo lo que usan árbitro, SDK y e2e). `as const` alcanza
 *  para que viem infiera tipos; no hace falta `satisfies Abi`. */
export const escrowAlephAbi = [
  {
    type: "function",
    name: "open",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seats", type: "address[]" },
      { name: "stake", type: "uint256" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
      { name: "seatSig", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seatSig", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seats", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelRoom",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "refundUnfunded",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "refundExpired",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAllowedStake",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "ok", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "roomOf",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "seats", type: "address[]" },
      { name: "stake", type: "uint256" },
      { name: "paidCount", type: "uint8" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "depositors",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "out", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paid",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feeBps",
    inputs: [],
    outputs: [{ type: "uint16" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usdc",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "arbiter",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "seatDigest",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seatsHash", type: "bytes32" },
      { name: "stake", type: "uint256" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "payoutDigest",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "tableHash", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

/** Lo mínimo de un ERC-20 para depositar (más `mint`, que solo existe en el
 *  USDC de prueba). */
export const erc20MinimalAbi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
```

Y en `packages/game-sdk/src/aleph.ts`, debajo de `export * from "./aleph-rules";`:

```ts
export * from "./aleph-escrow";
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `node --import tsx --test packages/game-sdk/test/aleph-usdc.test.ts && npm run typecheck:packages`
Expected: 5 tests PASS; typecheck verde.

- [ ] **Step 5: Commit**

```bash
git add packages/game-sdk/src/aleph-escrow.ts packages/game-sdk/src/aleph.ts packages/game-sdk/test/aleph-usdc.test.ts
git commit -m "feat(game-sdk): tabla de pagos en USDC (floor por asiento, polvo aparte) y ABI de EscrowAleph

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Las dos firmas del árbitro: pase y tabla

**Files:**

- Modify: `apps/server/src/sign.ts`
- Test: `apps/server/test/aleph-sign.test.ts`

**Interfaces:**

- Consumes: `arbiterAccount()` (ya existe en `sign.ts`).
- Produces: `alephDomain()`, `ALEPH_SEAT_TYPES`, `ALEPH_PAYOUT_TYPES`, `alephSeatsHash(seats: Hex[]): Hex`, `alephTableHash(seats: Hex[], amounts: bigint[]): Hex`, `AlephSeatPass`, `signAlephSeat(p: AlephSeatPass): Promise<Hex>`, `signAlephPayout(roomId: Hex, tableHash: Hex): Promise<Hex>`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/server/test/aleph-sign.test.ts
// Las firmas del árbitro para EscrowAleph: recuperan a SU address con el mismo
// dominio y los mismos tipos que verifica el contrato; el pase cambia con cada
// campo (sala, lista, stake, plazos, jugador). La igualdad bit a bit con el
// contrato la prueba el e2e en anvil (aleph-onchain-e2e.ts).
// Correr: node --import tsx --test apps/server/test/aleph-sign.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Hex } from "viem";

process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";
const S = await import("../src/sign.js");

const ROOM = ("0x" + "ab".repeat(32)) as Hex;
const SEATS = [1, 2, 3, 4].map((i) => ("0x" + String(i).repeat(40)) as Hex);
const pass = {
  roomId: ROOM,
  seatsHash: S.alephSeatsHash(SEATS),
  stake: 2_000_000n,
  fundDeadline: 1_800_000_600n,
  playDeadline: 1_800_011_400n,
  player: SEATS[0],
};

test("el pase recupera a la address del árbitro con el dominio de Aleph", async () => {
  const sig = await S.signAlephSeat(pass);
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: pass,
    signature: sig,
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());
  assert.equal(S.alephDomain().name, "Arcade1v1EscrowAleph");
  assert.equal(S.alephDomain().verifyingContract, process.env.ALEPH_ESCROW_ADDRESS);
});

test("cada campo del pase cambia la firma; la capitalización del jugador no", async () => {
  const base = await S.signAlephSeat(pass);
  assert.notEqual(
    await S.signAlephSeat({ ...pass, roomId: ("0x" + "cd".repeat(32)) as Hex }),
    base,
  );
  assert.notEqual(
    await S.signAlephSeat({ ...pass, seatsHash: S.alephSeatsHash(SEATS.slice().reverse()) }),
    base,
  );
  assert.notEqual(await S.signAlephSeat({ ...pass, stake: 5_000_000n }), base);
  assert.notEqual(await S.signAlephSeat({ ...pass, playDeadline: pass.playDeadline + 1n }), base);
  assert.notEqual(await S.signAlephSeat({ ...pass, player: SEATS[1] }), base);
  assert.equal(
    await S.signAlephSeat({ ...pass, player: SEATS[0].toUpperCase().replace("0X", "0x") as Hex }),
    base,
  );
});

test("la tabla se firma por su hash y recupera al árbitro", async () => {
  const amounts = [2_890_000n, 1_870_000n, 1_190_000n, 850_000n];
  const tableHash = S.alephTableHash(SEATS, amounts);
  assert.match(tableHash, /^0x[0-9a-f]{64}$/);
  assert.notEqual(S.alephTableHash(SEATS, [...amounts].reverse()), tableHash);
  const sig = await S.signAlephPayout(ROOM, tableHash);
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId: ROOM, tableHash },
    signature: sig,
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test apps/server/test/aleph-sign.test.ts`
Expected: FAIL (`alephSeatsHash` no existe).

- [ ] **Step 3: Implementar en `sign.ts`**

Cambiar el import de viem por `import { keccak256, encodeAbiParameters, type Hex } from "viem";` y agregar al final del archivo:

```ts
// ---- Aleph: mesas de plata (EscrowAleph) ----------------------------------
// Dominio EIP-712 PROPIO, distinto del 1v1 a propósito: aunque el
// verifyingContract ya separa los dominios, el nombre lo deja explícito.

const ZERO = "0x0000000000000000000000000000000000000000";

export const ALEPH_SEAT_TYPES = {
  Seat: [
    { name: "roomId", type: "bytes32" },
    { name: "seatsHash", type: "bytes32" },
    { name: "stake", type: "uint256" },
    { name: "fundDeadline", type: "uint64" },
    { name: "playDeadline", type: "uint64" },
    { name: "player", type: "address" },
  ],
} as const;

export const ALEPH_PAYOUT_TYPES = {
  Payout: [
    { name: "roomId", type: "bytes32" },
    { name: "tableHash", type: "bytes32" },
  ],
} as const;

export function alephDomain() {
  return {
    name: "Arcade1v1EscrowAleph",
    version: "1",
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    verifyingContract: (process.env.ALEPH_ESCROW_ADDRESS ?? ZERO) as Hex,
  };
}

/** `keccak256(abi.encode(seats))`, lo que ata cada pase a la lista congelada. */
export function alephSeatsHash(seats: Hex[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "address[]" }], [seats]));
}

/** `keccak256(abi.encode(seats, amounts))`: el contrato lo recompone desde el
 *  calldata, así la firma no depende del largo de la tabla. */
export function alephTableHash(seats: Hex[], amounts: bigint[]): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address[]" }, { type: "uint256[]" }], [seats, amounts]),
  );
}

export interface AlephSeatPass {
  roomId: Hex;
  seatsHash: Hex;
  stake: bigint; // micro-USDC
  fundDeadline: bigint; // segundos (epoch)
  playDeadline: bigint; // segundos (epoch)
  player: Hex;
}

/** El PASE: autoriza a `player` a depositar en `roomId` con exactamente esa
 *  lista, ese stake y esos plazos. Como cubre todo, el que abre la sala no
 *  puede inventar la mesa. Sin gas del árbitro: cada asiento lo presenta. */
export async function signAlephSeat(p: AlephSeatPass): Promise<Hex> {
  return arbiterAccount().signTypedData({
    domain: alephDomain(),
    types: ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: { ...p, player: p.player.toLowerCase() as Hex },
  });
}

/** La TABLA: firma el hash; el contrato verifica y paga a todos de una vez. */
export async function signAlephPayout(roomId: Hex, tableHash: Hex): Promise<Hex> {
  return arbiterAccount().signTypedData({
    domain: alephDomain(),
    types: ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId, tableHash },
  });
}
```

- [ ] **Step 4: Correr para verificar que pasa**

Run: `node --import tsx --test apps/server/test/aleph-sign.test.ts && npm run typecheck:server`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sign.ts apps/server/test/aleph-sign.test.ts
git commit -m "feat(server): firmas EIP-712 del pase y la tabla de pagos de EscrowAleph

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `aleph-chain.ts`: la cadena detrás de una interfaz inyectable

**Files:**

- Modify: `apps/server/src/onchain.ts` (exportar `chain`, `readClient`; renombrar `clients` → `writeClients` y exportarla; actualizar sus 2 usos internos)
- Create: `apps/server/src/aleph-chain.ts`

**Interfaces:**

- Consumes: `enCola`, `chain()`, `readClient()`, `writeClients()` de `onchain.ts`; `escrowAlephAbi`, `ALEPH_ESCROW_STATUS` del `game-sdk`.
- Produces: `alephOnchainEnabled(): boolean`, `alephEscrowAddress(): Hex`, `alephChainId(): number`, `AlephOnchainRoom`, `AlephChain`, `alephChain(): AlephChain`, `setAlephChainForTest(c?: AlephChain)`.

- [ ] **Step 1: Exportar los clientes de `onchain.ts`**

En `apps/server/src/onchain.ts`: `function chain()` → `export function chain()`; `function readClient()` → `export function readClient()`; `function clients()` → `export function writeClients()` (y reemplazar las 2 llamadas `clients()` dentro de `cancelMatchOnchain` por `writeClients()`). Nada más cambia.

Run: `npm run typecheck:server && node --import tsx --test apps/server/test/cola-onchain.test.ts apps/server/test/deposito-onchain.test.ts`
Expected: verde.

- [ ] **Step 2: El módulo nuevo**

```ts
// apps/server/src/aleph-chain.ts
// LA CADENA de las mesas de plata, detrás de una interfaz. Todo lo que el
// árbitro de Aleph necesita del contrato entra por acá: leer una sala mientras
// fondea, leer la comisión al liquidar, cancelar y liquidar. Los tests inyectan
// una cadena falsa (`setAlephChainForTest`) y corren sin nodo; el e2e en anvil
// (aleph-onchain-e2e.ts) prueba la implementación real.
//
// Se activa con ALEPH_ESCROW_ADDRESS (contrato aparte del 1v1: ESCROW_ADDRESS).
// Reusa los clientes viem y la COLA de escrituras de onchain.ts: todas las
// transacciones del árbitro salen de la misma wallet y comparten el nonce.
import type { Hex } from "viem";
import { escrowAlephAbi } from "@arcade1v1/game-sdk/aleph";
import { chain, readClient, writeClients, enCola } from "./onchain.js";

const ESCROW = (process.env.ALEPH_ESCROW_ADDRESS || "") as Hex;
const ZERO = "0x0000000000000000000000000000000000000000";

export function alephOnchainEnabled(): boolean {
  return !!ESCROW && ESCROW.toLowerCase() !== ZERO;
}
export function alephEscrowAddress(): Hex {
  return ESCROW;
}
export function alephChainId(): number {
  return Number(process.env.CHAIN_ID ?? 84532);
}

export interface AlephOnchainRoom {
  /** `EscrowAleph.Status` (ALEPH_ESCROW_STATUS). */
  status: number;
  paidCount: number;
  /** Asientos que ya depositaron, en minúsculas. */
  depositors: string[];
}

export interface AlephChain {
  readRoom(roomId: Hex): Promise<AlephOnchainRoom>;
  feeBps(): Promise<number>;
  usdcAddress(): Promise<Hex>;
  /** Cancela (reembolsa a los que depositaron). Devuelve el hash. */
  cancelRoom(roomId: Hex): Promise<Hex>;
  /** Presenta la tabla firmada. Devuelve el hash. */
  settle(roomId: Hex, seats: Hex[], amounts: bigint[], signature: Hex): Promise<Hex>;
}

let impl: AlephChain | undefined;

export function alephChain(): AlephChain {
  return (impl ??= realAlephChain());
}

/** Tests: inyectar una cadena falsa (o `undefined` para volver a la real). */
export function setAlephChainForTest(c: AlephChain | undefined): void {
  impl = c;
}

function realAlephChain(): AlephChain {
  let usdc: Hex | undefined;
  // Toda escritura se SIMULA primero (un revert seguro no quema gas) y va por
  // la cola (nonce compartido). El reintento con backoff lo lleva aleph.ts, que
  // sabe si vale la pena volver a intentar.
  const write = (functionName: "cancelRoom" | "settle", args: readonly unknown[]) =>
    enCola(async () => {
      const { wallet: w, pub: p } = writeClients();
      const { request } = await p.simulateContract({
        address: ESCROW,
        abi: escrowAlephAbi,
        functionName,
        args: args as never,
        account: w.account!,
        chain: chain(),
      });
      const hash = await w.writeContract(request);
      await p.waitForTransactionReceipt({ hash });
      return hash;
    });

  return {
    async readRoom(roomId) {
      const p = readClient();
      const [r, dep] = await Promise.all([
        p.readContract({
          address: ESCROW,
          abi: escrowAlephAbi,
          functionName: "roomOf",
          args: [roomId],
        }),
        p.readContract({
          address: ESCROW,
          abi: escrowAlephAbi,
          functionName: "depositors",
          args: [roomId],
        }),
      ]);
      return {
        status: Number(r[5]),
        paidCount: Number(r[2]),
        depositors: (dep as readonly string[]).map((a) => a.toLowerCase()),
      };
    },
    async feeBps() {
      return Number(
        await readClient().readContract({
          address: ESCROW,
          abi: escrowAlephAbi,
          functionName: "feeBps",
        }),
      );
    },
    async usdcAddress() {
      usdc ??= (await readClient().readContract({
        address: ESCROW,
        abi: escrowAlephAbi,
        functionName: "usdc",
      })) as Hex;
      return usdc;
    },
    cancelRoom: (roomId) => write("cancelRoom", [roomId]),
    settle: (roomId, seats, amounts, signature) =>
      write("settle", [roomId, seats, amounts, signature]),
  };
}
```

- [ ] **Step 3: Typecheck y commit**

Run: `npm run typecheck:server && npm run lint`
Expected: verde (si viem se queja del tipo de `args`, dejar el `as never` que ya está: la simulación valida contra el ABI en runtime).

```bash
git add apps/server/src/onchain.ts apps/server/src/aleph-chain.ts
git commit -m "feat(server): aleph-chain, la cadena de las mesas de plata detrás de una interfaz inyectable

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: La fase de fondeo en `aleph.ts`: estado, pases, tick de cadena, liquidación y reembolso

**Files:**

- Modify: `apps/server/src/aleph.ts`
- Modify: `apps/server/src/aleph-routes.ts` (`GET /aleph/lobbies`)
- Modify: `apps/server/test/aleph-lobby.test.ts` (línea 78: el mensaje ahora lista `ALEPH_STAKES`)
- Test: `apps/server/test/aleph-funding.test.ts`

**Interfaces:**

- Consumes: `signAlephSeat`, `signAlephPayout`, `alephSeatsHash`, `alephTableHash` (Task 2); `alephChain`, `alephOnchainEnabled`, `alephEscrowAddress`, `alephChainId` (Task 3); `usdcPayoutTable`, `stakeToUnits`, `ALEPH_ESCROW_STATUS` (Task 1).
- Produces: `RoomStatus` con `"funding"`; `ALEPH_STAKES: number[]`, `ALEPH_FUNDING_MS`, `ALEPH_PLAY_WINDOW_MS`; `AlephDeposit`; `AlephRoomView` + `fundingDeadline?`, `deposited?`, `deposit?`, `payoutsUsdc?`, `payoutSig?`, `settleTx?`, `escrow?`; `LobbySummary` + `status`, `deposited?`; `alephChainTick(now?)`; `AlephRoom.chain?: AlephChainRecord`; `alephLog(...)` + `usdc?`; `RecentRoom.settleTx?`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/server/test/aleph-funding.test.ts
// La fase de FONDEO de una mesa de plata, con una cadena falsa (sin nodo):
// lobby → funding → playing, el pase por asiento, el fondeo incompleto que
// disuelve y reembolsa, la liquidación firmada y enviada, el reintento y la
// persistencia. Reloj SIEMPRE inyectado.
// Correr: node --import tsx --test apps/server/test/aleph-funding.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { alephViewAuthMessage } from "@arcade1v1/game-sdk/auth";
import { ALEPH_ESCROW_STATUS, usdcPayoutTable, type AlephAction } from "@arcade1v1/game-sdk/aleph";

process.env.ALEPH_STAKES = "0,2";
process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";
process.env.ALEPH_MAX_SEATS = "4";
const V = await import("../src/aleph.js");
const C = await import("../src/aleph-chain.js");
const S = await import("../src/sign.js");

const T0 = 1_800_000_000_000;
const wallets = () => {
  const pk = generatePrivateKey();
  return { pk, address: privateKeyToAccount(pk).address.toLowerCase() as Hex };
};

/** Cadena falsa: recuerda depósitos por sala y las escrituras que le pidieron. */
function fakeChain() {
  const rooms = new Map<string, { status: number; depositors: string[] }>();
  const calls: { fn: string; args: unknown[] }[] = [];
  let failSettle = 0;
  const f = {
    rooms,
    calls,
    failSettleTimes(n: number) {
      failSettle = n;
    },
    deposit(roomId: string, address: string, seatsTotal: number) {
      const r = rooms.get(roomId) ?? { status: ALEPH_ESCROW_STATUS.Funding, depositors: [] };
      r.depositors.push(address.toLowerCase());
      if (r.depositors.length >= seatsTotal) r.status = ALEPH_ESCROW_STATUS.Funded;
      rooms.set(roomId, r);
    },
    async readRoom(roomId: Hex) {
      const r = rooms.get(roomId);
      return r
        ? { status: r.status, paidCount: r.depositors.length, depositors: [...r.depositors] }
        : { status: ALEPH_ESCROW_STATUS.None, paidCount: 0, depositors: [] };
    },
    async feeBps() {
      return 1500;
    },
    async usdcAddress() {
      return ("0x" + "0".repeat(39) + "1") as Hex;
    },
    async cancelRoom(roomId: Hex) {
      calls.push({ fn: "cancelRoom", args: [roomId] });
      const r = rooms.get(roomId);
      if (!r) throw new Error("execution reverted: cant cancel");
      r.status = ALEPH_ESCROW_STATUS.Refunded;
      return ("0x" + "c".repeat(64)) as Hex;
    },
    async settle(roomId: Hex, seats: Hex[], amounts: bigint[], signature: Hex) {
      calls.push({ fn: "settle", args: [roomId, seats, amounts, signature] });
      if (failSettle > 0) {
        failSettle--;
        throw new Error("rpc down");
      }
      rooms.get(roomId)!.status = ALEPH_ESCROW_STATUS.Settled;
      return ("0x" + "5".repeat(64)) as Hex;
    },
  };
  return f;
}

async function seatView(roomId: string, w: { pk: Hex; address: Hex }, now: number) {
  const acc = privateKeyToAccount(w.pk);
  const ts = now;
  const signature = await acc.signMessage({ message: alephViewAuthMessage(roomId, w.address, ts) });
  return (await V.getAlephRoom(roomId, w.address, now, { signature, ts }))!;
}

/** Sienta 4 wallets en la mesa de 2: con ALEPH_MAX_SEATS=4 el lobby cierra al 4to. */
async function fundingRoom(now: number) {
  const ws = [wallets(), wallets(), wallets(), wallets()];
  let v;
  for (const w of ws) v = await V.joinAleph(2, w.address, undefined, now);
  assert.equal(v!.status, "funding");
  return { ws, roomId: v!.roomId };
}

test("la mesa de plata se rechaza sin escrow y con un stake fuera de la lista", async () => {
  V.__resetAlephForTest();
  await assert.rejects(
    () => V.joinAleph(5, wallets().address, undefined, T0),
    /stake not allowed: 5 \(mesas: 0, 2\)/,
  );
  assert.deepEqual(V.ALEPH_STAKES, [0, 2]);
});

test("al cerrar, el lobby de plata NO arranca: entra en funding con la lista congelada y un pase por asiento", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);

  const pub = (await V.getAlephRoom(roomId, undefined, T0 + 1))!;
  assert.equal(pub.status, "funding");
  assert.equal(pub.commit, undefined, "sin semilla hasta que esté fondeada");
  assert.equal(pub.fundingDeadline, T0 + V.ALEPH_FUNDING_MS);
  assert.equal(pub.closesAt, T0 + V.ALEPH_FUNDING_MS);
  assert.deepEqual(pub.deposited, []);
  assert.equal(pub.deposit, undefined, "la vista pública no trae el pase");

  const mine = await seatView(roomId, ws[1], T0 + 2);
  const d = mine.deposit!;
  assert.equal(d.escrow, process.env.ALEPH_ESCROW_ADDRESS);
  assert.equal(d.chainId, 84532);
  assert.equal(d.stake, "2000000");
  assert.deepEqual(
    d.seats,
    ws.map((w) => w.address),
  );
  assert.equal(d.fundDeadline, Math.floor((T0 + V.ALEPH_FUNDING_MS) / 1000));
  assert.equal(d.playDeadline, d.fundDeadline + Math.floor(V.ALEPH_PLAY_WINDOW_MS / 1000));
  assert.equal(d.seatsHash, S.alephSeatsHash(ws.map((w) => w.address)));
  // El pase verifica contra el árbitro con exactamente esos campos.
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: {
      roomId: roomId as Hex,
      seatsHash: d.seatsHash as Hex,
      stake: BigInt(d.stake),
      fundDeadline: BigInt(d.fundDeadline),
      playDeadline: BigInt(d.playDeadline),
      player: ws[1].address,
    },
    signature: d.seatSig as Hex,
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());
  // Un pase es de SU asiento: el de ws[1] no es el de ws[2].
  const other = await seatView(roomId, ws[2], T0 + 2);
  assert.notEqual(other.deposit!.seatSig, d.seatSig);
  // Volver a pedir asiento devuelve ESTA sala (ocupada mientras fondea), con el pase.
  const again = await V.joinAleph(2, ws[1].address, undefined, T0 + 3);
  assert.equal(again.roomId, roomId);
  assert.equal(again.deposit!.seatSig, d.seatSig);
  // No hay lobby abierto de 2 (la sala en fondeo se lista aparte, con su estado).
  const lobbies = V.listAlephLobbies(T0 + 3);
  assert.deepEqual(
    lobbies.map((l) => [l.stake, l.status, l.deposited]),
    [[2, "funding", 0]],
  );
  C.setAlephChainForTest(undefined);
});

test("con los N depósitos en la cadena, la sala arranca (semilla + compromiso) y la casa no toca nada", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws.slice(0, 3)) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 10_000);
  let v = (await V.getAlephRoom(roomId, undefined, T0 + 10_000))!;
  assert.equal(v.status, "funding");
  assert.deepEqual(
    v.deposited,
    ws.slice(0, 3).map((w) => w.address),
  );
  chain.deposit(roomId, ws[3].address, 4);
  await V.alephChainTick(T0 + 20_000);
  v = (await V.getAlephRoom(roomId, undefined, T0 + 20_000))!;
  assert.equal(v.status, "playing");
  assert.match(String(v.commit), /^0x[0-9a-f]{64}$/);
  assert.equal(v.startedAt, T0 + 20_000);
  assert.equal(v.stage!.kind, "share");
  assert.equal(v.pot, 3200, "el motor sigue en unidades");
  C.setAlephChainForTest(undefined);
});

test("si falta aunque sea un depósito al vencer el plazo, la sala se disuelve y el árbitro cancela on-chain", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws.slice(0, 3)) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS - 1);
  assert.equal(
    (await V.getAlephRoom(roomId, undefined, T0 + V.ALEPH_FUNDING_MS - 1))!.status,
    "funding",
  );
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS);
  const gone = (await V.getAlephRoom(roomId, undefined, T0 + V.ALEPH_FUNDING_MS))!;
  assert.equal(gone.status, "dissolved");
  // El reembolso sale en el mismo tick (o el siguiente): cancelRoom pedido una sola vez.
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS + 5_000);
  assert.deepEqual(
    chain.calls.map((c) => c.fn),
    ["cancelRoom"],
  );
  assert.equal(chain.rooms.get(roomId)!.status, ALEPH_ESCROW_STATUS.Refunded);
  // Los asientos quedan libres: pueden sentarse en otra mesa.
  const next = await V.joinAleph(2, ws[0].address, undefined, T0 + V.ALEPH_FUNDING_MS + 6_000);
  assert.notEqual(next.roomId, roomId);
  assert.equal(next.status, "lobby");
  C.setAlephChainForTest(undefined);
});

test("una sala en fondeo donde NADIE depositó se disuelve sin mandar transacción", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { roomId } = await fundingRoom(T0);
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS);
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS + 5_000);
  assert.equal(
    (await V.getAlephRoom(roomId, undefined, T0 + V.ALEPH_FUNDING_MS + 5_000))!.status,
    "dissolved",
  );
  assert.deepEqual(
    chain.calls,
    [],
    "cancelar una sala que no existe on-chain revertiría: no se manda",
  );
  C.setAlephChainForTest(undefined);
});

/** Política guionada (misma que aleph-game.test.ts) para llevar la sala al final. */
function policy(v: Awaited<ReturnType<typeof V.getAlephRoom>>, me: string): AlephAction {
  const st = v!.stage!;
  if (st.phase === "talk") return { type: "ready" };
  const alive = v!.seats.filter((s) => s.status === "alive");
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

async function playToSettled(roomId: string, ws: { pk: Hex; address: Hex }[], from: number) {
  let now = from;
  for (let guard = 0; guard < 400; guard++) {
    const probe = (await V.getAlephRoom(roomId, undefined, now))!;
    if (probe.status === "settled") return now;
    for (const w of ws) {
      const v = await seatView(roomId, w, now);
      const you = v.you;
      if (v.status !== "playing" || !you || you.status !== "alive" || you.decided || you.ready)
        continue;
      await V.actAleph(
        roomId,
        w.address,
        { stage: v.stage!.index, phase: v.stage!.phase, action: policy(v, w.address) },
        now,
      );
      now += 100;
    }
  }
  throw new Error("la sala no terminó");
}

test("al liquidar: tabla en USDC que cierra exacto, firma publicada, settle enviado; con reintento si la cadena falla", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  chain.failSettleTimes(1); // la primera transacción falla (RPC caído)
  const end = await playToSettled(roomId, ws, T0 + 2_000);

  await V.alephChainTick(end + 1);
  let v = (await V.getAlephRoom(roomId, undefined, end + 1))!;
  assert.equal(v.status, "settled");
  assert.ok(v.payoutsUsdc, "la tabla en USDC se publica aunque la transacción haya fallado");
  assert.ok(v.payoutSig, "y su firma también: cualquiera puede presentarla");
  assert.equal(v.settleTx, undefined);
  const expected = usdcPayoutTable(
    ws.map((w) => w.address),
    v.payouts!,
    2_000_000n,
    1500,
  );
  assert.deepEqual(
    ws.map((w) => BigInt(v.payoutsUsdc![w.address])),
    expected.amounts,
  );
  const paid = expected.amounts.reduce((x, y) => x + y, 0n);
  assert.equal(paid + expected.fee + expected.dust, 8_000_000n);
  assert.equal(chain.calls.filter((c) => c.fn === "settle").length, 1);

  // Backoff: en el tick siguiente todavía no reintenta; pasado el plazo, sí.
  await V.alephChainTick(end + 2);
  assert.equal(chain.calls.filter((c) => c.fn === "settle").length, 1);
  await V.alephChainTick(end + 60 * 60_000);
  v = (await V.getAlephRoom(roomId, undefined, end + 60 * 60_000))!;
  assert.equal(v.settleTx, "0x" + "5".repeat(64));
  assert.equal(chain.calls.filter((c) => c.fn === "settle").length, 2);
  // La firma que se mandó recupera al árbitro sobre la tabla exacta.
  const sent = chain.calls.filter((c) => c.fn === "settle").at(-1)!.args as [
    Hex,
    Hex[],
    bigint[],
    Hex,
  ];
  assert.deepEqual(
    sent[1],
    ws.map((w) => w.address),
  );
  assert.deepEqual(sent[2], expected.amounts);
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId: roomId as Hex, tableHash: S.alephTableHash(sent[1], sent[2]) },
    signature: sent[3],
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());

  // El registro público lleva la parte en USDC.
  const log = V.alephLog(roomId, end + 60 * 60_000 + 1);
  assert.equal(log.usdc!.escrow, process.env.ALEPH_ESCROW_ADDRESS);
  assert.equal(log.usdc!.feeBps, 1500);
  assert.deepEqual(log.usdc!.table, v.payoutsUsdc);
  assert.equal(log.usdc!.signature, v.payoutSig);
  assert.equal(log.usdc!.settleTx, v.settleTx);
  // Y las salas recientes también.
  assert.equal(V.recentAlephRooms(5, end + 60 * 60_000 + 1)[0].settleTx, v.settleTx);
  C.setAlephChainForTest(undefined);
});

test("la mesa gratis sigue exactamente igual: sin fondeo, sin cadena", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  let v;
  for (let i = 0; i < 4; i++) v = await V.joinAleph(0, wallets().address, undefined, T0);
  assert.equal(v!.status, "playing");
  await V.alephChainTick(T0 + 1);
  assert.deepEqual(chain.calls, []);
  assert.equal(v!.deposit, undefined);
  C.setAlephChainForTest(undefined);
});

test("persistencia: una sala en fondeo restaura con su plazo, sus depósitos y sus pases", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  chain.deposit(roomId, ws[0].address, 4);
  await V.alephChainTick(T0 + 1);
  const before = await seatView(roomId, ws[2], T0 + 2);
  const raw = V.serializeAleph();
  V.__resetAlephForTest();
  V.restoreAlephFrom(raw);
  const after = await seatView(roomId, ws[2], T0 + 3);
  assert.equal(after.status, "funding");
  assert.equal(after.fundingDeadline, before.fundingDeadline);
  assert.deepEqual(after.deposited, [ws[0].address]);
  assert.equal(after.deposit!.seatSig, before.deposit!.seatSig);
  C.setAlephChainForTest(undefined);
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --import tsx --test apps/server/test/aleph-funding.test.ts`
Expected: FAIL (`ALEPH_STAKES`, `alephChainTick` no existen; `joinAleph(2, …)` rechaza).

- [ ] **Step 3: Implementar en `aleph.ts`**

Cambios, en orden de aparición en el archivo:

**(a) Imports.** Agregar:

```ts
import { usdcPayoutTable, stakeToUnits, ALEPH_ESCROW_STATUS } from "@arcade1v1/game-sdk/aleph";
import { signAlephSeat, signAlephPayout, alephSeatsHash, alephTableHash } from "./sign.js";
import {
  alephChain,
  alephOnchainEnabled,
  alephEscrowAddress,
  alephChainId,
} from "./aleph-chain.js";
```

**(b) Perillas.** Reemplazar el bloque `// Etapa 1: SOLO la mesa gratis…` + `const STAKES_ALLOWED = [0];` por:

```ts
/** Plazo para que los N asientos depositen, una vez cerrado el lobby. */
export const ALEPH_FUNDING_MS = envNum("ALEPH_FUNDING_MS", 10 * 60_000);
/** Ventana de juego que lleva el pase (playDeadline on-chain). El mazo tiene a
 *  lo sumo N+2 etapas, ~22 fases de 2 min: 3 h sobra, y pasada esa ventana más
 *  la gracia del contrato cualquiera puede pedir el reembolso. */
export const ALEPH_PLAY_WINDOW_MS = envNum("ALEPH_PLAY_WINDOW_MS", 3 * 60 * 60_000);
/** Mesas permitidas, en USDC enteros. `ALEPH_STAKES` (default "0"); la gratis
 *  está SIEMPRE. Una mesa de plata solo se acepta con ALEPH_ESCROW_ADDRESS
 *  (se chequea por llamada en joinAleph, y config-guard lo exige en producción). */
export const ALEPH_STAKES: number[] = [
  ...new Set(
    ["0", ...(process.env.ALEPH_STAKES ?? "0").split(",")]
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0),
  ),
].sort((a, b) => a - b);
```

**(c) Tipos.** `RoomStatus`:

```ts
export type RoomStatus = "lobby" | "funding" | "playing" | "settled" | "dissolved";
```

En `AlephRoom`, después de `phaseDeadline?: number;`:

```ts
  // ---- Mesa de plata (stake > 0) ----
  fundingDeadline?: number; // ms: cuándo vence el fondeo
  playDeadline?: number; // ms: lo que lleva el pase como playDeadline (en segundos)
  deposited?: string[]; // quién depositó, según la última lectura de la cadena
  passes?: Record<string, Hex>; // pase firmado por asiento (determinístico; se cachea)
  chain?: AlephChainRecord; // liquidación / reembolso on-chain
```

Y nuevos tipos, antes de `AlephRoomView`:

```ts
/** Lo que un asiento necesita para depositar: lo lee de su vista privada
 *  mientras la sala está en `funding`. Deadlines en SEGUNDOS (como el contrato). */
export interface AlephDeposit {
  chainId: number;
  escrow: Hex;
  usdc: Hex;
  stake: string; // micro-USDC, como string (JSON no lleva bigint)
  seats: string[]; // la lista congelada, en orden
  seatsHash: Hex;
  fundDeadline: number;
  playDeadline: number;
  seatSig: Hex;
}

/** Rastro de la cadena en una sala de plata. Todo string: va al store. */
export interface AlephChainRecord {
  attempts: number;
  nextAttemptAt?: number;
  lastError?: string;
  feeBps?: number;
  payoutsUsdc?: Record<string, string>; // micro-USDC por asiento
  payoutSig?: Hex;
  settleTx?: string; // hash, o "external" si otro presentó la tabla
  refundTx?: string; // hash, "external" (reembolso permissionless) o "none" (nadie depositó)
}
```

En `AlephRoomView`, después de `rating?: RatingUpdate;`:

```ts
  // ---- Mesa de plata ----
  fundingDeadline?: number; // `funding`: cuándo vence el fondeo (ms)
  deposited?: string[]; // `funding`: quién ya depositó
  deposit?: AlephDeposit; // `funding`, SOLO en la vista privada del asiento
  escrow?: Hex; // stake > 0: el contrato
  payoutsUsdc?: Record<string, string>; // `settled`, stake > 0
  payoutSig?: Hex; // `settled`, stake > 0: cualquiera puede presentar la tabla
  settleTx?: string; // `settled`, stake > 0, cuando la transacción salió
```

En `LobbySummary`:

```ts
export interface LobbySummary {
  roomId: Hex;
  stake: number;
  status: "lobby" | "funding";
  seats: number;
  deposited?: number; // funding: cuántos ya depositaron
  min: number;
  max: number;
  closesAt: number; // lobby: cuándo arranca o se disuelve; funding: cuándo vence el fondeo
}
```

**(d) `liveRoomOf` y `liveCount`.** Un asiento en `funding` está ocupado; una sala en `funding` cuenta como viva:

```ts
if (r.status === "lobby" || r.status === "funding") return r;
```

```ts
for (const r of rooms.values()) {
  if (r.status === "lobby" || r.status === "funding" || r.status === "playing") n++;
}
```

**(e) `joinAleph`.** Reemplazar el chequeo de `STAKES_ALLOWED` y las dos salidas:

```ts
  if (!ALEPH_STAKES.includes(stake)) {
    throw new AlephError(`stake not allowed: ${stake} (mesas: ${ALEPH_STAKES.join(", ")})`);
  }
  if (stake > 0 && !alephOnchainEnabled()) {
    throw new AlephError("money tables are not enabled on this arbiter (ALEPH_ESCROW_ADDRESS)");
  }
  ...
  const mine = liveRoomOf(address);
  if (mine) return withDeposit(mine, roomView(mine, address), address);
  ...
  room.seats.push(address);
  if (room.seats.length >= ALEPH_MAX_SEATS) closeLobby(room, now);
  persist();
  return withDeposit(room, roomView(room, address), address);
```

**(f) Cierre del lobby.** Debajo de `startRoom`:

```ts
/** El lobby cierra: la gratis arranca; la de plata entra en FONDEO. */
function closeLobby(room: AlephRoom, now: number): void {
  if (room.stake === 0) startRoom(room, now);
  else enterFunding(room, now);
}

/** Congela la lista y abre el plazo de fondeo. La semilla NO se sortea acá:
 *  recién con los N depósitos (alephChainTick → startRoom). */
function enterFunding(room: AlephRoom, now: number): void {
  room.status = "funding";
  room.fundingDeadline = now + ALEPH_FUNDING_MS;
  room.playDeadline = room.fundingDeadline + ALEPH_PLAY_WINDOW_MS;
  room.deposited = [];
  room.passes = {};
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
}

/** El pase de UN asiento, firmado una vez y cacheado (la firma es
 *  determinística: RFC 6979). Solo mientras la sala fondea. */
async function seatDeposit(room: AlephRoom, address: string): Promise<AlephDeposit> {
  const seats = room.seats as Hex[];
  const seatsHash = alephSeatsHash(seats);
  const stake = stakeToUnits(room.stake);
  const fundDeadline = Math.floor(room.fundingDeadline! / 1000);
  const playDeadline = Math.floor(room.playDeadline! / 1000);
  room.passes ??= {};
  let seatSig = room.passes[address];
  if (!seatSig) {
    seatSig = await signAlephSeat({
      roomId: room.id,
      seatsHash,
      stake,
      fundDeadline: BigInt(fundDeadline),
      playDeadline: BigInt(playDeadline),
      player: address as Hex,
    });
    room.passes[address] = seatSig;
    persist();
  }
  return {
    chainId: alephChainId(),
    escrow: alephEscrowAddress(),
    usdc: await alephChain().usdcAddress(),
    stake: stake.toString(),
    seats: room.seats,
    seatsHash,
    fundDeadline,
    playDeadline,
    seatSig,
  };
}

/** Adjunta el bloque de depósito a la vista PRIVADA de un asiento en fondeo. */
async function withDeposit(
  room: AlephRoom,
  v: AlephRoomView,
  address: string,
): Promise<AlephRoomView> {
  if (room.status !== "funding" || !room.seats.includes(address)) return v;
  return { ...v, deposit: await seatDeposit(room, address) };
}
```

En `settleRoomDue`, el cierre del lobby por plazo pasa a `closeLobby`:

```ts
if (room.seats.length >= ALEPH_MIN_SEATS && alephEnabled()) closeLobby(room, now);
```

**(g) Liquidación.** En `settleRoom`, después de `room.eloUpdates = …;`:

```ts
// Mesa de plata: la tabla en USDC, su firma y la transacción las arma el tick
// de cadena (async, con reintento). Acá solo queda anotado que falta.
if (room.stake > 0) room.chain = { attempts: 0, nextAttemptAt: now };
```

Y `recordMatchSettled(0, now)` se queda igual.

**(h) Sala rota.** En el `catch` de `settleDue`, después de `dissolveRoom(room, now);`:

```ts
// Con plata de por medio, disolver no alcanza: hay que devolverla.
if (room.stake > 0) room.chain = { attempts: 0, nextAttemptAt: now };
```

**(i) El tick de cadena.** Nueva sección, antes de `// ---- Ticker ----`:

```ts
// ---- La cadena (mesas de plata) ----------------------------------------------
// Todo lo que toca el contrato pasa por acá, en un tick ASÍNCRONO aparte del
// reloj sincrónico (`settleDue`): leer depósitos, arrancar la sala fondeada,
// disolver y cancelar al vencer el fondeo, liquidar y reembolsar. Con backoff:
// un RPC caído no puede dejar una sala liquidada sin pagar, pero tampoco tiene
// sentido martillarlo cada 5 s.

let chainTicking = false;

function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 10_000 * 2 ** Math.min(attempts, 8));
}

/** Exportado para los tests (reloj inyectado). El ticker lo llama cada tick. */
export async function alephChainTick(now = Date.now()): Promise<void> {
  if (chainTicking || !alephOnchainEnabled()) return;
  chainTicking = true;
  let dirty = false;
  try {
    for (const room of [...rooms.values()]) {
      if (room.stake === 0) continue;
      try {
        if (room.status === "funding") {
          if (await syncFunding(room, now)) dirty = true;
        } else if (room.status === "settled" && room.chain && !room.chain.settleTx) {
          if (await settleOnchain(room, now)) dirty = true;
        } else if (room.status === "dissolved" && room.chain && !room.chain.refundTx) {
          if (await refundOnchain(room, now)) dirty = true;
        }
      } catch (e) {
        console.error("[aleph-chain]", room.id, (e as Error).message);
      }
    }
  } finally {
    chainTicking = false;
  }
  if (dirty) persist();
}

/** Lee la cadena para una sala en fondeo. Arranca si está Funded; disuelve (y
 *  deja pendiente el reembolso) si venció el plazo. Devuelve si cambió algo. */
async function syncFunding(room: AlephRoom, now: number): Promise<boolean> {
  const c = await alephChain().readRoom(room.id);
  let changed = false;
  const dep = c.depositors.map(normAddr);
  if (JSON.stringify(dep) !== JSON.stringify(room.deposited ?? [])) {
    room.deposited = dep;
    changed = true;
  }
  if (c.status === ALEPH_ESCROW_STATUS.Funded) {
    startRoom(room, now);
    return true;
  }
  if (c.status === ALEPH_ESCROW_STATUS.Refunded) {
    // Alguien llamó refundUnfunded por su cuenta: nada que cancelar.
    dissolveRoom(room, now);
    room.chain = { attempts: 0, refundTx: "external" };
    return true;
  }
  if (now >= room.fundingDeadline!) {
    dissolveRoom(room, now);
    room.chain = { attempts: 0, nextAttemptAt: now };
    return true;
  }
  return changed;
}

/** Tabla en USDC + firma (una vez) y `settle` (con reintento). */
async function settleOnchain(room: AlephRoom, now: number): Promise<boolean> {
  const rec = room.chain!;
  if (rec.nextAttemptAt !== undefined && now < rec.nextAttemptAt) return false;
  rec.attempts += 1;
  const seats = room.seats as Hex[];
  try {
    const chain = alephChain();
    if (!rec.payoutSig) {
      // La comisión se lee del CONTRATO: si difiriera del env, la suma no
      // cerraría y el settle revertiría.
      const feeBps = await chain.feeBps();
      const { amounts } = usdcPayoutTable(seats, room.payouts!, stakeToUnits(room.stake), feeBps);
      rec.feeBps = feeBps;
      rec.payoutsUsdc = Object.fromEntries(seats.map((a, i) => [a, amounts[i].toString()]));
      rec.payoutSig = await signAlephPayout(room.id, alephTableHash(seats, amounts));
    }
    const amounts = seats.map((a) => BigInt(rec.payoutsUsdc![a]));
    rec.settleTx = await chain.settle(room.id, seats, amounts, rec.payoutSig);
    rec.lastError = undefined;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/not funded/i.test(msg)) {
      // Ya no está Funded: o alguien presentó la tabla antes, o se reembolsó.
      const c = await alephChain().readRoom(room.id);
      rec.settleTx = c.status === ALEPH_ESCROW_STATUS.Settled ? "external" : `refunded:${c.status}`;
    } else {
      rec.lastError = msg;
      rec.nextAttemptAt = now + backoffMs(rec.attempts);
    }
  }
  return true;
}

/** `cancelRoom` para una sala disuelta con plata adentro (con reintento). */
async function refundOnchain(room: AlephRoom, now: number): Promise<boolean> {
  const rec = room.chain!;
  if (rec.nextAttemptAt !== undefined && now < rec.nextAttemptAt) return false;
  rec.attempts += 1;
  try {
    const chain = alephChain();
    const c = await chain.readRoom(room.id);
    if (c.status === ALEPH_ESCROW_STATUS.None) {
      rec.refundTx = "none"; // nadie depositó: cancelar revertiría
    } else if (c.status === ALEPH_ESCROW_STATUS.Refunded) {
      rec.refundTx = "external";
    } else if (c.status === ALEPH_ESCROW_STATUS.Settled) {
      rec.refundTx = "settled"; // no debería pasar: queda anotado, no se insiste
    } else {
      rec.refundTx = await chain.cancelRoom(room.id);
    }
    rec.lastError = undefined;
  } catch (e) {
    rec.lastError = (e as Error).message;
    rec.nextAttemptAt = now + backoffMs(rec.attempts);
  }
  return true;
}
```

**(j) Ticker.** En `startAlephTicker`, el callback pasa a:

```ts
ticker = setInterval(() => {
  try {
    settleDue();
  } catch (e) {
    console.error("[aleph] tick:", (e as Error).message);
  }
  alephChainTick().catch((e) => console.error("[aleph-chain] tick:", (e as Error).message));
}, ALEPH_TICK_MS);
```

**(k) Vistas.** En `roomView`, el `base` suma `escrow: room.stake > 0 ? alephEscrowAddress() : undefined`, y la rama de lobby/dissolved se extiende a `funding`:

```ts
if (room.status === "lobby" || room.status === "funding" || room.status === "dissolved") {
  const funding =
    room.status === "funding" ||
    (room.status === "dissolved" && room.fundingDeadline !== undefined);
  return {
    ...base,
    closesAt: funding ? room.fundingDeadline : room.createdAt + ALEPH_LOBBY_MS,
    fundingDeadline: funding ? room.fundingDeadline : undefined,
    deposited: funding ? (room.deposited ?? []) : undefined,
    seats: room.seats.map((a) => ({ address: a, status: "alive" as SeatStatus, pocket: 0 })),
  };
}
```

Y en la rama `settled`, después de `out.secretSeed = …`:

```ts
if (room.chain) {
  out.payoutsUsdc = room.chain.payoutsUsdc;
  out.payoutSig = room.chain.payoutSig;
  out.settleTx = room.chain.settleTx;
}
```

En `getAlephRoom`, la última línea pasa a `return withDeposit(room, roomView(room, seat), seat);` (solo con pase válido: la vista pública nunca trae el pase). La rama `AUTH_REQUIRED ? undefined : seat` (dev sin firma) también pasa por `withDeposit` cuando devuelve la privada.

**(l) Lobbies.** `listAlephLobbies` pasa a recorrer las salas:

```ts
export function listAlephLobbies(now = Date.now()): LobbySummary[] {
  settleDue(now);
  const out: LobbySummary[] = [];
  for (const r of rooms.values()) {
    if (r.status === "lobby" && openLobby.get(r.stake) === r.id) {
      out.push({
        roomId: r.id,
        stake: r.stake,
        status: "lobby",
        seats: r.seats.length,
        min: ALEPH_MIN_SEATS,
        max: ALEPH_MAX_SEATS,
        closesAt: r.createdAt + ALEPH_LOBBY_MS,
      });
    } else if (r.status === "funding") {
      out.push({
        roomId: r.id,
        stake: r.stake,
        status: "funding",
        seats: r.seats.length,
        deposited: r.deposited?.length ?? 0,
        min: ALEPH_MIN_SEATS,
        max: ALEPH_MAX_SEATS,
        closesAt: r.fundingDeadline!,
      });
    }
  }
  return out.sort((a, b) => a.stake - b.stake || a.closesAt - b.closesAt);
}
```

**(m) Registro y recientes.** En `alephLog`, agregar al objeto devuelto:

```ts
    usdc:
      room.stake > 0
        ? {
            escrow: alephEscrowAddress(),
            chainId: alephChainId(),
            feeBps: room.chain?.feeBps,
            table: room.chain?.payoutsUsdc,
            signature: room.chain?.payoutSig,
            settleTx: room.chain?.settleTx,
          }
        : undefined,
```

En `RecentRoom` agregar `settleTx?: string;` y en el `map` de `recentAlephRooms`: `settleTx: r.chain?.settleTx,`.

**(n) Persistencia.** Nada que hacer: los campos nuevos son JSON. `restoreAlephFrom` no cambia (una sala `funding` no va a `openLobby`).

**(o) La ruta de lobbies.** En `aleph-routes.ts`:

```ts
import { ..., ALEPH_STAKES } from "./aleph.js";
...
alephRouter.get("/aleph/lobbies", (_req, res) => {
  try {
    res.json({ lobbies: listAlephLobbies(), stakes: ALEPH_STAKES });
  } catch (e) {
    fail(res, e);
  }
});
```

**(p) El assert viejo.** En `apps/server/test/aleph-lobby.test.ts` línea 78, `/stake not allowed/` sigue matcheando: no hace falta tocarlo. Verificar que ese archivo sigue verde SIN `ALEPH_STAKES` (default `"0"`).

- [ ] **Step 4: Correr para verificar que pasa**

Run: `node --import tsx --test apps/server/test/aleph-funding.test.ts apps/server/test/aleph-lobby.test.ts apps/server/test/aleph-game.test.ts apps/server/test/aleph-routes.test.ts apps/server/test/aleph-sdk-e2e.test.ts apps/server/test/aleph-house.test.ts && npm run typecheck:server`
Expected: todo PASS. Los tests viejos (mesa gratis) no cambian de comportamiento.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/aleph.ts apps/server/src/aleph-routes.ts apps/server/test/aleph-funding.test.ts
git commit -m "feat(server): fase de fondeo de Aleph — pases por asiento, tick de cadena, liquidación y reembolso on-chain

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: La casa nunca completa una mesa de plata, y la guarda de configuración

**Files:**

- Modify: `apps/server/test/aleph-house.test.ts` (test nuevo al final)
- Modify: `apps/server/src/config-guard.ts`
- Modify: `apps/server/test/config-guard.test.ts`

- [ ] **Step 1: El test de la casa**

Al final de `apps/server/test/aleph-house.test.ts` (ese archivo ya importa `alephHouseTick`, `joinAleph`, `getAlephRoom`, `ALEPH_LOBBY_MS` y tiene su helper de addresses; usar los mismos nombres que allí):

```ts
test("la casa NUNCA completa una mesa de plata: el lobby de 2 USDC vence solo y se disuelve", async () => {
  // Decisión 6 del spec de la etapa 4: rellenar una mesa con plata sería la
  // casa jugando con plata de terceros contra terceros. La guarda
  // (`room.stake !== 0`) ya estaba en fillLobbies; este test la fija.
  process.env.ALEPH_STAKES = "0,2";
  process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);
  const { setAlephChainForTest } = await import("../src/aleph-chain.js");
  setAlephChainForTest({
    readRoom: async () => ({ status: 0, paidCount: 0, depositors: [] }),
    feeBps: async () => 1500,
    usdcAddress: async () => ("0x" + "1".padStart(40, "0")) as `0x${string}`,
    cancelRoom: async () => "0x" as `0x${string}`,
    settle: async () => "0x" as `0x${string}`,
  });
  try {
    V.__resetAlephForTest();
    const real = addr();
    const room = await V.joinAleph(2, real, undefined, T0);
    assert.equal(room.status, "lobby");
    // A 1 minuto del cierre, con un agente real esperando: en la gratis la
    // casa entraría; acá no.
    await alephHouseTick(T0 + ALEPH_LOBBY_MS - 60_000);
    const still = (await V.getAlephRoom(room.roomId, undefined, T0 + ALEPH_LOBBY_MS - 60_000))!;
    assert.equal(still.seats.length, 1, "la casa no se sentó");
    const gone = (await V.getAlephRoom(room.roomId, undefined, T0 + ALEPH_LOBBY_MS))!;
    assert.equal(gone.status, "dissolved");
  } finally {
    setAlephChainForTest(undefined);
    delete process.env.ALEPH_ESCROW_ADDRESS;
    delete process.env.ALEPH_STAKES;
  }
});
```

OJO: `ALEPH_STAKES` se lee al importar `aleph.js`. Si el archivo importa `aleph.js` arriba con `await import`, mover `process.env.ALEPH_STAKES = "0,2"` y `ALEPH_ESCROW_ADDRESS` a la cabecera del archivo (junto a los otros `process.env` que ya setea), y quitar del test los `delete`. Los tests de la mesa gratis del mismo archivo no se ven afectados: siguen con `stake 0`.

Run: `node --import tsx --test apps/server/test/aleph-house.test.ts`
Expected: PASS (la guarda ya existe en `fillLobbies`: `if (room.stake !== 0) continue;`).

- [ ] **Step 2: Los tests de config-guard que fallan**

Agregar a `apps/server/test/config-guard.test.ts`:

```ts
test("ALEPH_STAKES con una mesa de plata exige ALEPH_ESCROW_ADDRESS bien formada", () => {
  const sinEscrow = { ...OK, ESCROW_ADDRESS: undefined, ALEPH_STAKES: "0,2" } as NodeJS.ProcessEnv;
  const errs = productionConfigErrors(sinEscrow);
  assert.ok(
    errs.some((e) => /ALEPH_ESCROW_ADDRESS/.test(e)),
    errs.join("\n"),
  );

  const malFormada = {
    ...OK,
    ALEPH_STAKES: "0,2",
    ALEPH_ESCROW_ADDRESS: "0x123",
  } as NodeJS.ProcessEnv;
  assert.ok(
    productionConfigErrors(malFormada).some((e) => /ALEPH_ESCROW_ADDRESS mal formada/.test(e)),
  );

  const bien = {
    ...OK,
    ALEPH_STAKES: "0,2",
    ALEPH_ESCROW_ADDRESS: "0x" + "c".repeat(40),
  } as NodeJS.ProcessEnv;
  assert.deepEqual(productionConfigErrors(bien), []);
});

test("solo el escrow de Aleph activo (sin el 1v1) también exige CHAIN_ID, llave y RPC", () => {
  const soloAleph = {
    NODE_ENV: "production",
    ALEPH_STAKES: "0,2",
    ALEPH_ESCROW_ADDRESS: "0x" + "c".repeat(40),
    ALLOWED_ORIGIN: "https://arcade1v1.com",
  } as NodeJS.ProcessEnv;
  const errs = productionConfigErrors(soloAleph);
  assert.ok(errs.some((e) => /CHAIN_ID/.test(e)));
  assert.ok(errs.some((e) => /ARBITER_PRIVATE_KEY/.test(e)));
  assert.ok(errs.some((e) => /RPC_URL/.test(e)));
});

test("la mesa gratis sola (ALEPH_STAKES=0 o ausente) no exige nada de Aleph", () => {
  assert.deepEqual(
    productionConfigErrors({ NODE_ENV: "production", ALEPH_STAKES: "0" } as NodeJS.ProcessEnv),
    [],
  );
});
```

Run: `node --import tsx --test apps/server/test/config-guard.test.ts`
Expected: FAIL (los 2 primeros).

- [ ] **Step 3: Implementar en `config-guard.ts`**

Reemplazar desde `const escrowRaw = …` hasta `const errors: string[] = [];` por:

```ts
const escrowRaw = (env.ESCROW_ADDRESS || "").trim();
const escrow = escrowRaw.toLowerCase();
const onchain = !!escrow && escrow !== ZERO;

// Aleph (mesas de plata): su contrato es aparte. Si ALEPH_STAKES habilita una
// mesa con plata, el escrow de Aleph es obligatorio: sin él, joinAleph la
// rechaza por llamada, pero un despliegue así es un error de configuración y
// conviene que falle al arrancar, no cuando el primer agente pide asiento.
const alephRaw = (env.ALEPH_ESCROW_ADDRESS || "").trim();
const alephOn = !!alephRaw && alephRaw.toLowerCase() !== ZERO;
const moneyStakes = (env.ALEPH_STAKES || "0")
  .split(",")
  .map((s) => Number(s.trim()))
  .some((n) => Number.isFinite(n) && n > 0);

const errors: string[] = [];
if (moneyStakes && !alephOn) {
  errors.push(
    `ALEPH_STAKES ("${env.ALEPH_STAKES}") habilita una mesa de plata pero falta ALEPH_ESCROW_ADDRESS: ` +
      "sin el contrato de Aleph, toda mesa de plata se rechaza.",
  );
}
if (alephOn && !ADDRESS_RE.test(alephRaw)) {
  errors.push(
    `ALEPH_ESCROW_ADDRESS mal formada ("${alephRaw}"): debe ser una dirección 0x + 40 hex. ` +
      "Con la dirección equivocada, los pases y la tabla de pagos no verifican en el contrato.",
  );
}
if (!onchain && !alephOn) return errors; // sin ningún escrow no hay dinero on-chain
```

Y ajustar el mensaje del check de `ESCROW_ADDRESS` para que solo corra cuando `onchain` (envolver ese `if (!ADDRESS_RE.test(escrowRaw))` en `if (onchain && …)`). El resto (CHAIN_ID, llave, origen, RPC) queda igual y ahora corre si cualquiera de los dos escrows está activo.

Run: `node --import tsx --test apps/server/test/config-guard.test.ts`
Expected: todo PASS (los viejos y los 3 nuevos).

- [ ] **Step 4: Commit**

```bash
git add apps/server/test/aleph-house.test.ts apps/server/src/config-guard.ts apps/server/test/config-guard.test.ts
git commit -m "test(server): la casa nunca completa una mesa de plata; config-guard exige el escrow de Aleph

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: El verificador público chequea la tabla en USDC

**Files:**

- Modify: `scripts/aleph-verify.mjs`
- Modify: `apps/server/test/aleph-funding.test.ts` (un test más, al final)

- [ ] **Step 1: El test que falla**

```ts
test("el verificador público recalcula la tabla en USDC y la compara con la publicada", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  const end = await playToSettled(roomId, ws, T0 + 2_000);
  await V.alephChainTick(end + 1);
  const { verifyAlephLog } = await import("../../../scripts/aleph-verify.mjs");
  const log = V.alephLog(roomId, end + 2);
  const ok = await verifyAlephLog(log, V.ALEPH_PHASE_MS);
  assert.equal(ok.ok, true, JSON.stringify(ok.checks));
  assert.ok(ok.checks.some((c) => /USDC/.test(c.name) && c.ok));
  // Una tabla adulterada no verifica.
  const bad = structuredClone(log);
  bad.usdc.table[ws[0].address] = String(BigInt(bad.usdc.table[ws[0].address]) + 1n);
  const nok = await verifyAlephLog(bad, V.ALEPH_PHASE_MS);
  assert.equal(nok.ok, false);
  C.setAlephChainForTest(undefined);
});
```

Run: `node --import tsx --test apps/server/test/aleph-funding.test.ts`
Expected: FAIL en el `some(/USDC/)`.

- [ ] **Step 2: Implementar**

En `scripts/aleph-verify.mjs`: agregar `usdcPayoutTable, stakeToUnits` al import de `@arcade1v1/game-sdk/aleph`, agregar a la cabecera el chequeo 6, y antes de `return { ok: … }`:

```js
// 6) Mesa de plata: la tabla en USDC que se firmó sale de la tabla en
//    unidades con la comisión del contrato (floor por asiento, polvo aparte).
//    Es el borde donde el árbitro convierte, así que es el borde a vigilar.
if (log.usdc && payouts) {
  try {
    const t = usdcPayoutTable(log.seats, payouts, stakeToUnits(log.stake), log.usdc.feeBps);
    const published = log.seats.map((a) => String(log.usdc.table?.[a]));
    const expected = t.amounts.map(String);
    check(
      JSON.stringify(published) === JSON.stringify(expected),
      `USDC: la tabla firmada coincide con la conversión (comisión ${log.usdc.feeBps} bps, polvo ${t.dust})`,
    );
    check(
      !!log.usdc.settleTx,
      `USDC: la liquidación salió a la cadena (${log.usdc.settleTx ?? "todavía no: la firma está publicada, cualquiera puede presentarla"})`,
    );
  } catch (e) {
    check(false, `USDC: no se pudo recalcular la tabla (${e.message})`);
  }
}
```

Run: `node --import tsx --test apps/server/test/aleph-funding.test.ts apps/server/test/aleph-sdk-e2e.test.ts`
Expected: PASS (el e2e del SDK, mesa gratis, no trae `usdc` y no cambia).

- [ ] **Step 3: Commit**

```bash
git add scripts/aleph-verify.mjs apps/server/test/aleph-funding.test.ts
git commit -m "feat(scripts): aleph-verify recalcula la tabla en USDC de una mesa de plata

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: E2E en anvil con el árbitro real (y en CI)

**Files:**

- Create: `apps/server/src/aleph-onchain-e2e.ts`
- Create: `packages/contracts/check-aleph-e2e.sh`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: funciones in-process del árbitro (`joinAleph`, `getAlephRoom`, `actAleph`, `alephChainTick`, `alephLog`), `escrowAlephAbi`/`erc20MinimalAbi`, `hashTypedData` de viem para el cruce de digests.
- Produces: el script sale con código 0 solo si TODO cuadra (balances exactos).

- [ ] **Step 1: El script**

```ts
// apps/server/src/aleph-onchain-e2e.ts
// PAGO DE UNA MESA DE PLATA de punta a punta en cadena local (anvil), con el
// árbitro REAL (funciones in-process): 4 wallets se sientan, reciben su pase,
// abren/depositan en EscrowAleph, el árbitro ve los depósitos y arranca, juegan
// hasta liquidar, el árbitro firma la tabla en USDC y la manda, y cada uno cobra
// exactamente lo que dice la tabla. Después: un fondeo incompleto que vence y el
// árbitro cancela on-chain. Antes de todo: los digests EIP-712 del árbitro (viem)
// coinciden bit a bit con los del contrato.
//
// Variables (las pone check-aleph-e2e.sh): RPC_URL, CHAIN_ID=31337,
// ALEPH_ESCROW_ADDRESS, USDC_ADDR, ARBITER_PRIVATE_KEY, ALEPH_STAKES=0,2,
// ALEPH_MAX_SEATS=4, ALEPH_FUNDING_MS (corto, para el escenario de vencimiento).
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  hashTypedData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { escrowAlephAbi, erc20MinimalAbi, usdcPayoutTable } from "@arcade1v1/game-sdk/aleph";
import {
  matchmakeAuthMessage,
  alephViewAuthMessage,
  alephActionAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { actionLine, type AlephAction } from "@arcade1v1/game-sdk/aleph";
import {
  joinAleph,
  getAlephRoom,
  actAleph,
  alephChainTick,
  alephLog,
  ALEPH_FUNDING_MS,
} from "./aleph.js";
import {
  alephDomain,
  ALEPH_SEAT_TYPES,
  ALEPH_PAYOUT_TYPES,
  alephSeatsHash,
  alephTableHash,
} from "./sign.js";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const USDC = process.env.USDC_ADDR as Hex;
const ESCROW = process.env.ALEPH_ESCROW_ADDRESS as Hex;
const STAKE = 2_000_000n;

// Cuentas estándar de anvil (sin valor).
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SEAT_KEYS = [
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
] as const;
const PLATFORM = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Hex;

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (k: string) =>
  createWalletClient({
    account: privateKeyToAccount(k as Hex),
    chain: foundry,
    transport: http(RPC),
  });
const owner = wallet(OWNER_KEY);
const seats = SEAT_KEYS.map((k) => ({
  w: wallet(k),
  pk: k as Hex,
  address: privateKeyToAccount(k as Hex).address,
}));
const low = (a: string) => a.toLowerCase() as Hex;

async function send(
  c: ReturnType<typeof wallet>,
  address: Hex,
  abi: unknown,
  fn: string,
  args: unknown[],
) {
  const hash = await c.writeContract({
    address,
    abi,
    functionName: fn,
    args,
    account: c.account,
    chain: foundry,
  } as never);
  await pub.waitForTransactionReceipt({ hash });
}
const bal = (a: Hex) =>
  pub.readContract({
    address: USDC,
    abi: erc20MinimalAbi,
    functionName: "balanceOf",
    args: [a],
  }) as Promise<bigint>;
const usd = (x: bigint) => (Number(x) / 1e6).toFixed(6);

function fail(msg: string): never {
  console.log(`\n❌ ${msg}`);
  process.exit(1);
}

async function join(s: (typeof seats)[number], now: number) {
  const acc = privateKeyToAccount(s.pk);
  const signature = await acc.signMessage({
    message: matchmakeAuthMessage("aleph", 2, low(s.address), now),
  });
  return joinAleph(2, s.address, { signature, ts: now }, now);
}
async function view(roomId: string, s: (typeof seats)[number], now: number) {
  const acc = privateKeyToAccount(s.pk);
  const signature = await acc.signMessage({
    message: alephViewAuthMessage(roomId, low(s.address), now),
  });
  return (await getAlephRoom(roomId, s.address, now, { signature, ts: now }))!;
}
async function act(
  roomId: string,
  s: (typeof seats)[number],
  stage: number,
  phase: "talk" | "decide",
  action: AlephAction,
  now: number,
) {
  const acc = privateKeyToAccount(s.pk);
  const signature = await acc.signMessage({
    message: alephActionAuthMessage(roomId, stage, phase, actionLine(action), now),
  });
  return actAleph(roomId, s.address, { stage, phase, action, signature, ts: now }, now);
}

/** Misma política guionada que los tests: lleva la sala al final sin esperar plazos. */
function policy(v: Awaited<ReturnType<typeof view>>, me: string): AlephAction {
  const st = v.stage!;
  if (st.phase === "talk") return { type: "ready" };
  const alive = v.seats.filter((x) => x.status === "alive");
  switch (st.kind) {
    case "share":
      return { type: me === alive[0].address ? "keep" : "contribute" };
    case "offer":
      return { type: "decline" };
    case "vote":
      return { type: "vote", target: (alive.find((x) => x.address !== me) ?? alive[0]).address };
    case "lock":
      return { type: "ready" };
    default:
      return { type: "split" };
  }
}

async function digestCheck() {
  console.log("--- 0) Digests EIP-712: árbitro (viem) == contrato ---");
  const roomId = ("0x" + "11".repeat(32)) as Hex;
  const list = seats.map((s) => low(s.address));
  const msg = {
    roomId,
    seatsHash: alephSeatsHash(list),
    stake: STAKE,
    fundDeadline: 1_900_000_000n,
    playDeadline: 1_900_010_800n,
    player: list[0],
  };
  const ours = hashTypedData({
    domain: alephDomain(),
    types: ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: msg,
  });
  const theirs = (await pub.readContract({
    address: ESCROW,
    abi: escrowAlephAbi,
    functionName: "seatDigest",
    args: [roomId, msg.seatsHash, msg.stake, msg.fundDeadline, msg.playDeadline, msg.player],
  })) as Hex;
  if (ours.toLowerCase() !== theirs.toLowerCase())
    fail(`seatDigest difiere: viem ${ours} · contrato ${theirs}`);
  const amounts = [1n, 2n, 3n, 4n];
  const tableHash = alephTableHash(list, amounts);
  const onchainHash = (await pub.readContract({
    address: ESCROW,
    abi: escrowAlephAbi,
    functionName: "tableHashOf",
    args: [list, amounts],
  })) as Hex;
  if (tableHash.toLowerCase() !== onchainHash.toLowerCase())
    fail("tableHash difiere entre viem y el contrato");
  const oursP = hashTypedData({
    domain: alephDomain(),
    types: ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId, tableHash },
  });
  const theirsP = (await pub.readContract({
    address: ESCROW,
    abi: escrowAlephAbi,
    functionName: "payoutDigest",
    args: [roomId, tableHash],
  })) as Hex;
  if (oursP.toLowerCase() !== theirsP.toLowerCase())
    fail("payoutDigest difiere entre viem y el contrato");
  console.log("✓ seatDigest, tableHash y payoutDigest coinciden");
}

async function prepare() {
  await send(owner, ESCROW, escrowAlephAbi, "setAllowedStake", [STAKE, true]);
  await owner.sendTransaction({
    to: privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex).address,
    value: parseEther("1"),
    chain: foundry,
  });
  for (const s of seats) {
    await send(owner, USDC, erc20MinimalAbi, "mint", [s.address, STAKE]);
    await send(s.w, USDC, erc20MinimalAbi, "approve", [ESCROW, STAKE]);
  }
}

async function happyPath() {
  console.log("\n--- 1) Cuatro asientos fondean, juegan y cobran ---");
  let now = Date.now();
  let v;
  for (const s of seats) v = await join(s, now);
  if (v!.status !== "funding") fail(`esperaba funding, hay ${v!.status}`);
  const roomId = v!.roomId;

  // Cada asiento deposita con su pase: el primero abre, los demás depositan.
  for (let i = 0; i < seats.length; i++) {
    const mine = await view(roomId, seats[i], now);
    const d = mine.deposit;
    if (!d) fail(`el asiento ${i} no recibió su pase`);
    if (i === 0) {
      await send(seats[0].w, ESCROW, escrowAlephAbi, "open", [
        roomId,
        d.seats,
        BigInt(d.stake),
        BigInt(d.fundDeadline),
        BigInt(d.playDeadline),
        d.seatSig,
      ]);
    } else {
      await send(seats[i].w, ESCROW, escrowAlephAbi, "deposit", [roomId, d.seatSig]);
    }
  }
  console.log("✓ 4 depósitos · escrow:", usd(await bal(ESCROW)), "USDC (esperado 8)");

  await alephChainTick(now);
  v = (await getAlephRoom(roomId, undefined, now))!;
  if (v.status !== "playing") fail(`el árbitro no vio los depósitos: ${v.status}`);
  console.log("✓ la sala arrancó al ver los N depósitos · commit:", v.commit);

  // Jugar hasta el final.
  for (let guard = 0; guard < 400 && v.status !== "settled"; guard++) {
    for (const s of seats) {
      const mine = await view(roomId, s, now);
      const you = mine.you;
      if (mine.status !== "playing" || !you || you.status !== "alive" || you.decided || you.ready)
        continue;
      await act(roomId, s, mine.stage!.index, mine.stage!.phase, policy(mine, low(s.address)), now);
      now += 50;
    }
    v = (await getAlephRoom(roomId, undefined, now))!;
  }
  if (v.status !== "settled") fail("la sala no terminó");
  console.log("✓ liquidada en unidades:", JSON.stringify(v.payouts));

  await alephChainTick(now + 1);
  v = (await getAlephRoom(roomId, undefined, now + 1))!;
  if (!v.settleTx || !/^0x[0-9a-f]{64}$/i.test(v.settleTx)) fail(`sin settleTx: ${v.settleTx}`);
  console.log("✓ settle enviado:", v.settleTx);

  const feeBps = Number(
    await pub.readContract({ address: ESCROW, abi: escrowAlephAbi, functionName: "feeBps" }),
  );
  const t = usdcPayoutTable(
    seats.map((s) => low(s.address)),
    v.payouts!,
    STAKE,
    feeBps,
  );
  for (let i = 0; i < seats.length; i++) {
    const b = await bal(seats[i].address);
    if (b !== t.amounts[i]) fail(`asiento ${i}: cobró ${usd(b)}, esperaba ${usd(t.amounts[i])}`);
  }
  const p = await bal(PLATFORM);
  if (p !== t.fee + t.dust)
    fail(`plataforma: ${usd(p)}, esperaba ${usd(t.fee + t.dust)} (comisión + polvo)`);
  if ((await bal(ESCROW)) !== 0n) fail("el escrow no quedó en cero");
  console.log("✓ cada asiento cobró su fila; plataforma =", usd(p), "(comisión + polvo); escrow 0");

  const log = alephLog(roomId, now + 2);
  if (!log.usdc?.signature || !log.usdc.table)
    fail("el registro no publica la tabla en USDC ni su firma");
  console.log("\nPAGO DE UNA MESA DE PLATA VERIFICADO ✅");
}

async function unfundedScenario() {
  console.log(
    "\n--- 2) Fondeo incompleto: vence, el árbitro cancela, cada uno recupera lo suyo ---",
  );
  // Los mismos 4 asientos (ya liberados). Solo dos depositan.
  for (const s of seats.slice(0, 2)) {
    await send(owner, USDC, erc20MinimalAbi, "mint", [s.address, STAKE]);
    await send(s.w, USDC, erc20MinimalAbi, "approve", [ESCROW, STAKE]);
  }
  const before = await Promise.all(seats.map((s) => bal(s.address)));
  let now = Date.now();
  let v;
  for (const s of seats) v = await join(s, now);
  if (v!.status !== "funding") fail(`esperaba funding, hay ${v!.status}`);
  const roomId = v!.roomId;
  const d0 = (await view(roomId, seats[0], now)).deposit!;
  await send(seats[0].w, ESCROW, escrowAlephAbi, "open", [
    roomId,
    d0.seats,
    BigInt(d0.stake),
    BigInt(d0.fundDeadline),
    BigInt(d0.playDeadline),
    d0.seatSig,
  ]);
  const d1 = (await view(roomId, seats[1], now)).deposit!;
  await send(seats[1].w, ESCROW, escrowAlephAbi, "deposit", [roomId, d1.seatSig]);
  if ((await bal(ESCROW)) !== STAKE * 2n) fail("esperaba 2 stakes en el escrow");

  await alephChainTick(now);
  v = (await getAlephRoom(roomId, undefined, now))!;
  if (v.status !== "funding" || v.deposited?.length !== 2)
    fail(`el árbitro no vio los 2 depósitos: ${JSON.stringify(v.deposited)}`);

  // Vence el plazo del ÁRBITRO (reloj inyectado): disuelve y cancela on-chain.
  now += ALEPH_FUNDING_MS + 1;
  await alephChainTick(now);
  await alephChainTick(now + 1);
  v = (await getAlephRoom(roomId, undefined, now + 1))!;
  if (v.status !== "dissolved") fail(`esperaba dissolved, hay ${v.status}`);
  const after = await Promise.all(seats.map((s) => bal(s.address)));
  for (let i = 0; i < seats.length; i++) {
    if (after[i] !== before[i]) fail(`asiento ${i}: ${usd(after[i])} vs ${usd(before[i])} antes`);
  }
  if ((await bal(ESCROW)) !== 0n) fail("el escrow no devolvió todo");
  console.log("✓ los dos que depositaron recuperaron su stake; los otros no perdieron nada");
  console.log("\nREEMBOLSO POR FONDEO INCOMPLETO VERIFICADO ✅");
}

async function main() {
  await digestCheck();
  await prepare();
  await happyPath();
  await unfundedScenario();
}

main().catch((e) => {
  console.error("Error:", (e as { shortMessage?: string }).shortMessage || (e as Error).message);
  process.exit(1);
});
```

- [ ] **Step 2: El wrapper de anvil**

```bash
#!/usr/bin/env bash
# packages/contracts/check-aleph-e2e.sh
# Prueba el PAGO de una mesa de plata de Aleph en cadena local (anvil) con el
# árbitro real: despliega MockUSDC + EscrowAleph, 4 wallets fondean y juegan, el
# árbitro firma la tabla y el contrato paga a todos; después, un fondeo
# incompleto que el árbitro cancela. Requiere Foundry y el monorepo instalado.
# Uso:  bash packages/contracts/check-aleph-e2e.sh
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

pkill -f anvil 2>/dev/null || true
sleep 1
anvil >/tmp/anvil-aleph.log 2>&1 &
ANVIL_PID=$!
for i in $(seq 1 15); do cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1 && break; sleep 1; done

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
PLATFORM=0x90F79bf6EB2c4f870365E785982E1f101E93b906
ARB_KEY=$(grep '^ARBITER_PRIVATE_KEY=' "$ROOT/apps/server/.env" | cut -d= -f2)
ARB_ADDR=$(cast wallet address --private-key "$ARB_KEY")

cd "$ROOT/packages/contracts"
USDC=$(forge create test/MockUSDC.sol:MockUSDC --rpc-url http://localhost:8545 \
  --private-key $KEY0 --broadcast 2>/dev/null | grep "Deployed to:" | awk '{print $3}')
ESCROW=$(forge create src/EscrowAleph.sol:EscrowAleph --rpc-url http://localhost:8545 \
  --private-key $KEY0 --broadcast \
  --constructor-args "$USDC" "$ARB_ADDR" "$PLATFORM" 1500 "$OWNER" 2>/dev/null \
  | grep "Deployed to:" | awk '{print $3}')

# ALEPH_FUNDING_MS corto: el escenario 2 vence el plazo del árbitro con reloj
# inyectado, pero los pases llevan fundDeadline real y anvil sigue el reloj de
# pared; 60 s alcanza para que los depósitos entren antes de vencer.
USDC_ADDR=$USDC CHAIN_ID=31337 ALEPH_ESCROW_ADDRESS=$ESCROW ALEPH_STAKES=0,2 \
  ALEPH_MAX_SEATS=4 ALEPH_FUNDING_MS=60000 ALEPH_HOUSE_ENABLED=false \
  ARBITER_PRIVATE_KEY=$ARB_KEY RPC_URL=http://localhost:8545 \
  "$ROOT/node_modules/.bin/tsx" "$ROOT/apps/server/src/aleph-onchain-e2e.ts"
CODE=$?

kill $ANVIL_PID 2>/dev/null || true
exit $CODE
```

- [ ] **Step 3: Correr localmente**

Run: `bash packages/contracts/check-aleph-e2e.sh`
Expected: termina con `REEMBOLSO POR FONDEO INCOMPLETO VERIFICADO ✅` y código 0. Fallas típicas y qué significan: `seatDigest difiere` = los tipos de `sign.ts` no coinciden con el typehash del contrato (revisar orden y nombres de campos); `bad seat` en `open` = `seatsHash` distinto (el árbitro debe firmar con las addresses en minúsculas, que es como las guarda, y el contrato compara por valor de 20 bytes, así que da igual); `bad sum` = la comisión que usó el árbitro no es la del contrato.

- [ ] **Step 4: El paso de CI**

En `.github/workflows/ci.yml`, job `contracts`, después de `Pago completo en cadena local (anvil)`:

```yaml
- name: Pago de una mesa de plata de Aleph en cadena local (anvil)
  run: bash packages/contracts/check-aleph-e2e.sh
```

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/server/src/aleph-onchain-e2e.ts packages/contracts/check-aleph-e2e.sh .github/workflows/ci.yml
git commit -m "test(server): e2e en anvil de una mesa de plata con el árbitro real, y su paso en CI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Configuración documentada, índice de la API y PR

**Files:**

- Modify: `docs/CONFIGURATION.md`
- Modify: `apps/server/src/index.ts` (índice `GET /`, líneas ~189-198)

- [ ] **Step 1: `docs/CONFIGURATION.md`**

En la tabla "Aleph (multi-agent rooms)", agregar cuatro filas (mismo formato que las existentes):

```markdown
| `ALEPH_STAKES` | Optional | `0` | Tables allowed, in whole USDC, comma-separated. The free table (`0`) is always on. Any stake `> 0` needs `ALEPH_ESCROW_ADDRESS` (rejected per call without it; a production start fails without it). Stage 4 ships with `0,2`. Read at startup in `src/aleph.ts`. |
| `ALEPH_ESCROW_ADDRESS` | Optional | — | Address of `EscrowAleph` (the N-seat escrow, separate from the 1v1 `ESCROW_ADDRESS`). Enables money tables: passes are signed for it, deposits are read from it, the payout table is settled on it. Reuses `RPC_URL`, `CHAIN_ID` and `ARBITER_PRIVATE_KEY`. Read in `src/aleph-chain.ts`. |
| `ALEPH_FUNDING_MS` | Optional | `600000` (10 min) | How long the N seats have to deposit once the lobby closes. If one is missing when it runs out, the room dissolves and the arbiter cancels on-chain (everyone who deposited gets their stake back). Read in `src/aleph.ts`. |
| `ALEPH_PLAY_WINDOW_MS` | Optional | `10800000` (3 h) | Play window written into every pass as the on-chain `playDeadline`. After it plus the contract's 30-minute grace, anyone can call `refundExpired`. A room has at most N+2 stages (~22 phases of 2 min), so 3 h is generous. Read in `src/aleph.ts`. |
```

Y reemplazar el párrafo `Only the free table (stake 0) exists in this version: the ALEPH_STAKES knob…` por:

```markdown
Money tables (stage 4): with `ALEPH_STAKES=0,2` and `ALEPH_ESCROW_ADDRESS` set, a
lobby of the 2 USDC table that closes enters a **funding** phase instead of
starting: every seat gets a signed pass in its private view (`deposit` block:
escrow, USDC, stake, frozen seat list, deadlines, `seatSig`), deposits by itself
(`open` for the first, `deposit` for the rest), and the arbiter starts the room
only when the contract reports all N deposits. The house never fills a money
table. The game rules themselves (percentages, message caps, absences) are
**not** env vars: they live in `ALEPH_RULES`
(`packages/game-sdk/src/aleph-rules.ts`) and are versioned by `ALEPH_RULES_V`.
```

En la tabla de scripts, la fila de `scripts/aleph-verify.mjs` suma al final: `For a money table it also recomputes the USDC payout table from the units table and the contract's fee, and reports whether the settle transaction went out.`

- [ ] **Step 2: Índice de la API en `index.ts`**

Reemplazar la línea de `POST /aleph/join` por:

```ts
      "POST /aleph/join":
        "{ stake, address, signature, ts } -> a seat in Aleph, the 4–8 agent room (sign matchmakeAuthMessage('aleph', stake, address, ts)). stake 0 = free table; a money table (see GET /aleph/lobbies `stakes`) closes into a `funding` phase: your private view then carries `deposit` (escrow, pass, deadlines) and the room starts once every seat deposited on-chain",
```

Y la de `GET /aleph/lobbies` por:

```ts
      "GET /aleph/lobbies": "{ lobbies, stakes }: rooms waiting for seats or funding (status lobby|funding, deposited), and the stakes this arbiter accepts",
```

- [ ] **Step 3: Verificación final completa**

```bash
npm run check
bash packages/contracts/check-aleph-e2e.sh
```

Expected: todo verde.

- [ ] **Step 4: Commit y PR**

```bash
git add docs/CONFIGURATION.md apps/server/src/index.ts
git commit -m "docs(server): las perillas de las mesas de plata de Aleph y el índice de la API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/aleph-etapa4-arbitro
gh pr create --title "feat(aleph): etapa 4, PR 2 — el árbitro: fondeo, pases, conversión a USDC y liquidación on-chain" --body "$(cat <<'EOF'
## Qué hay

La fase `funding` en el árbitro, detrás de `ALEPH_STAKES` (default `0`: nada cambia hoy). Con `0,2` y `ALEPH_ESCROW_ADDRESS`: el lobby de 2 USDC que cierra congela la lista y firma un pase por asiento (en la vista privada), el árbitro lee la cadena cada tick y arranca con los N depósitos, al liquidar convierte la tabla a USDC (comisión leída del contrato, polvo aparte), la firma, la publica y la manda; si el fondeo vence o la sala se rompe, cancela on-chain. Todo con cadena inyectable (tests sin nodo) y un e2e en anvil con el árbitro real en CI.

Spec: docs/superpowers/specs/2026-09-10-aleph-etapa4-mesas-de-plata-design.md
Plan: docs/superpowers/plans/2026-09-11-aleph-etapa4-2-arbitro.md
Depende de: PR 1 (EscrowAleph), ya en main.

## Desvíos del spec (en el plan)

1. El pase llega en la vista privada cuando la sala ya está en `funding` (antes no hay lista que firmar).
2. El árbitro lee la cadena; no hay endpoint de "ya deposité".
3. La firma de la tabla se publica: si la tx del árbitro fallara, cualquiera presenta `settle`.
4. El test "la casa no rellena mesas de plata" no existía: se agrega.

## Qué NO hay todavía

SDK/MCP/web (PR 3) y el despliegue en Sepolia (PR 3, con OK).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec:** `lobby → funding → playing → settled` ✔ (Task 4, tests 2-3); lista congelada + pase por address atado al `roomId` ✔ (Task 2 + Task 4 test "pase atado"); plazo de fondeo 10 min ✔ (`ALEPH_FUNDING_MS`); "con los N depósitos arranca, recién ahí se sortea la semilla" ✔ (`startRoom` desde `syncFunding`); "si falta uno al vencer, se disuelve y todos recuperan" ✔ (`syncFunding` + `refundOnchain` + e2e escenario 2); sin sanción al que no depositó ✔ (nada lo penaliza); conversión solo en el borde, motor intacto ✔ (Task 1, `ALEPH_RULES_V` no cambia); polvo con la comisión ✔; comisión del contrato ✔ (`feeBps()`); tres reembolsos: vencido → el árbitro cancela (el permissionless lo da el contrato), no liquidó → `refundExpired` del contrato tras `playDeadline` + gracia (el pase lleva el `playDeadline`), disputa/rota → `settleDue` catch + `refundOnchain` ✔; la casa nunca se sienta ✔ (Task 5); `GET /aleph/:id` expone quién depositó ✔ (`deposited`); firma la tabla en USDC y la manda ✔ (`settleOnchain`); `aleph-verify` grita si la tabla no cierra ✔ (Task 6); tests del árbitro (transición, fondeo incompleto, pase en otra sala, conversión que suma en N de 4 a 8 → Task 1 propiedad) ✔; E2E con 4 wallets ✔ (Task 7).
- **Placeholders:** ninguno.
- **Consistencia de nombres:** `roomOf` devuelve `status` en el índice 5 y `paidCount` en el 2 (Task 3 lee `r[5]`, `r[2]`; coincide con el orden del contrato del PR 1); `AlephDeposit.stake` es string y el e2e hace `BigInt(d.stake)`; `settleTx`/`refundTx` son `string` en `AlephChainRecord` y en la vista; `LobbySummary.status` es `"lobby" | "funding"` y la ruta devuelve `{ lobbies, stakes }` (el PR 3 lo consume así).
