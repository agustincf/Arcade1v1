// W5 (pre-auditoría INT-1): una firma del resultado que falla se reintenta. La
// partida se marca decidida antes de firmar (el candado contra una doble
// decisión), así que si la firma fallaba una vez quedaba decidida y sin firma
// para siempre, y al vencer el ganador terminaba reembolsado. Ahora el
// barrendero vuelve a firmar con backoff, y con la firma guarda y liquida.
//
// Corre en su propio proceso: escrow "activo", persistencia contra un Upstash
// falso y una cadena falsa.
// Correr: node --import tsx --test apps/server/test/firma-reintento.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { startFakeUpstash } from "./fake-upstash.js";

const upstash = await startFakeUpstash();
after(() => upstash.close());

process.env.ARCADE_PERSIST = "1";
process.env.UPSTASH_REDIS_REST_URL = upstash.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-mentira";
process.env.PERSIST_DEBOUNCE_MS = "3600000";
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";

const MM = await import("../src/matchmaking.js");
await (await import("./escrow-ok.js")).escrowVerified();
const OC = await import("../src/onchain.js");
const { signResult } = await import("../src/sign.js");
const { ONCHAIN_STATUS: ST } = OC;

const ZERO = "0x" + "0".repeat(40);
const chain = new Map<string, { p1: string; p2: string; status: number }>();
const settles: string[] = [];
const cancels: string[] = [];
OC.setEscrowChainForTest({
  async read(id) {
    const c = chain.get(id);
    return c ? { ...c, stake: 1_000_000n } : { p1: ZERO, p2: ZERO, stake: 0n, status: ST.None };
  },
  async cancel(id) {
    cancels.push(id);
    chain.get(id)!.status = ST.Refunded;
  },
  async settle(id) {
    settles.push(id);
    chain.get(id)!.status = ST.Settled;
    return ("0x" + "5".repeat(64)) as Hex;
  },
});

/** Un firmante que falla las próximas `n` veces (un KMS que no contesta). */
let failures = 0;
MM.setResultSignerForTest(async (...args) => {
  if (failures > 0) {
    failures--;
    throw new Error("KMS timeout");
  }
  return signResult(...args);
});

let next = 1;
const addr = () => "0x" + (next++).toString(16).padStart(40, "f");

function play2048(seed: number | undefined, maxMoves: number) {
  const g = new Game2048(seed!);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  for (let i = 0; !g.over && moves.length < maxMoves && i < 4000; i++) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
  }
  return { score: g.score, replay: { seed: seed!, moves } };
}

/** A abre, B se une, A juega largo y B corto: gana A. Devuelve tras el envío de B. */
async function decidedWhileSignerFails(stake: number, n: number) {
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake("2048", stake, A);
  chain.set(a.matchId, { p1: A, p2: ZERO, status: ST.Open });
  await MM.matchmake("2048", stake, B);
  Object.assign(chain.get(a.matchId)!, { p2: B, status: ST.Funded });
  const ra = play2048(a.seed, 300);
  const rb = play2048(a.seed, 5);
  await MM.submitScore(a.matchId, A, ra.score, ra.replay);
  failures = n;
  const v = await MM.submitScore(a.matchId, B, rb.score, rb.replay);
  return { id: a.matchId, A, B, v };
}

test("la firma falla una vez: el envío no revienta y el barrendero la vuelve a pedir y liquida", async () => {
  const { id, A, v } = await decidedWhileSignerFails(1, 1);
  assert.equal(v.status, "settled", "el que envió ve la partida decidida");
  await MM.onchainSettled(id);
  assert.equal(MM.getMatch(id, A)!.signature, undefined, "todavía sin firma");
  assert.equal(settles.includes(id), false, "sin firma no se liquida");

  const m = MM.matchRecord(id)!;
  assert.equal(m.signAttempts, 1);
  await MM.sweepMatches(m.nextSignAt! - 1);
  await MM.onchainSettled(id);
  assert.equal(MM.getMatch(id, A)!.signature, undefined, "respeta el backoff");

  await MM.sweepMatches(m.nextSignAt!);
  await MM.onchainSettled(id);
  const va = MM.getMatch(id, A)!;
  assert.ok(va.signature, "firmada");
  assert.equal(va.winner, A);
  assert.ok(settles.includes(id), "y el árbitro liquidó");
  assert.equal(MM.matchRecord(id)!.signAttempts, undefined);
});

test("si la firma no sale hasta que ya no llegaría a cobrarse, se reembolsa", async () => {
  const { id, A } = await decidedWhileSignerFails(2, 1000);
  await MM.onchainSettled(id);
  const deadline = MM.matchRecord(id)!.signatureDeadline!;
  await MM.sweepMatches(deadline * 1000);
  await MM.onchainSettled(id);
  const va = MM.getMatch(id, A)!;
  assert.equal(va.settleOutcome, "expired");
  assert.ok(cancels.includes(id), "reembolso");
  assert.equal(va.refund, "done");
  failures = 0;
});

test("la ladder gratis también recupera la firma", async () => {
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake("2048", 0, A);
  await MM.matchmake("2048", 0, B);
  const ra = play2048(a.seed, 300);
  const rb = play2048(a.seed, 5);
  await MM.submitScore(a.matchId, A, ra.score, ra.replay);
  failures = 1;
  await MM.submitScore(a.matchId, B, rb.score, rb.replay);
  const m = MM.matchRecord(a.matchId)!;
  assert.equal(m.signature, undefined);
  await MM.sweepMatches(m.nextSignAt!);
  await MM.onchainSettled(a.matchId);
  assert.ok(MM.getMatch(a.matchId, A)!.signature);
});
