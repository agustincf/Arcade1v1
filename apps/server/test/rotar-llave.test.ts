// W8 (pre-auditoría F5 / RT3-04): rotar la llave del árbitro. Después de
// `setArbiter(nueva)` el contrato rechaza todo lo firmado con la vieja: una
// partida decidida y sin liquidar quedaba sin cobrar, y un asiento entregado
// antes de rotar ya no servía para depositar. Ahora el árbitro vuelve a firmar
// con la llave actual el MISMO resultado (mismo ganador y plazo) antes de
// liquidar, y el p2 que vuelve a preguntar recibe su misma partida con un
// asiento firmado de nuevo. Runbook: docs/ROTAR-LLAVE-ARBITRO.md.
//
// Correr: node --import tsx --test apps/server/test/rotar-llave.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
const S = await import("../src/sign.js");
const { ONCHAIN_STATUS: ST } = OC;

// La llave VIEJA: la cuenta #2 de anvil, pública y sin valor.
const OLD = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

const ZERO = "0x" + "0".repeat(40);
const chain = new Map<string, { p1: string; p2: string; status: number }>();
const settled: { id: string; signature: Hex }[] = [];
OC.setEscrowChainForTest({
  async read(id) {
    const c = chain.get(id);
    return c ? { ...c, stake: 1_000_000n } : { p1: ZERO, p2: ZERO, stake: 0n, status: ST.None };
  },
  async cancel() {},
  async settle(id, _winner, _deadline, signature) {
    settled.push({ id, signature });
    chain.get(id)!.status = ST.Settled;
    return ("0x" + "5".repeat(64)) as Hex;
  },
});

function play2048(seed: number | undefined, maxMoves: number) {
  const g = new Game2048(seed!);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  for (let i = 0; !g.over && moves.length < maxMoves && i < 4000; i++) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
  }
  return { score: g.score, replay: { seed: seed!, moves } };
}

test("una decisión firmada con la llave anterior se vuelve a firmar con la actual antes de liquidar", async () => {
  // La primera firma sale con la llave vieja (la decisión se tomó antes de rotar).
  let calls = 0;
  MM.setResultSignerForTest(async (matchId, winner, deadline) => {
    if (calls++ > 0) return S.signResult(matchId, winner, deadline);
    return OLD.signTypedData({
      domain: S.resultDomain(),
      types: S.RESULT_TYPES,
      primaryType: "Result",
      message: { matchId, winner: winner.toLowerCase() as Hex, deadline },
    });
  });
  const A = "0x" + "1".repeat(40);
  const B = "0x" + "2".repeat(40);
  const a = await MM.matchmake("2048", 1, A);
  chain.set(a.matchId, { p1: A, p2: ZERO, status: ST.Open });
  await MM.matchmake("2048", 1, B);
  Object.assign(chain.get(a.matchId)!, { p2: B, status: ST.Funded });
  const ra = play2048(a.seed, 300);
  const rb = play2048(a.seed, 5);
  await MM.submitScore(a.matchId, A, ra.score, ra.replay);
  await MM.submitScore(a.matchId, B, rb.score, rb.replay);
  await MM.onchainSettled(a.matchId);
  MM.setResultSignerForTest(undefined);

  const s = settled.find((x) => x.id === a.matchId);
  assert.ok(s, "liquidada");
  const m = MM.matchRecord(a.matchId)!;
  assert.equal(
    await S.resultSignedByArbiter(m.id, A as Hex, BigInt(m.signatureDeadline!), s.signature),
    true,
    "con la firma de la llave actual",
  );
  assert.equal(m.winner, A, "el mismo ganador");
  assert.equal(MM.getMatch(a.matchId, A)!.signature, s.signature, "la vista muestra la nueva");
});

test("el p2 que vuelve a preguntar antes de unirse recibe su misma partida y un asiento nuevo", async () => {
  const A = "0x" + "3".repeat(40);
  const B = "0x" + "4".repeat(40);
  const a = await MM.matchmake("2048", 2, A);
  chain.set(a.matchId, { p1: A, p2: ZERO, status: ST.Open });
  const b = await MM.matchmake("2048", 2, B);
  assert.equal(b.matchId, a.matchId);
  const again = await MM.matchmake("2048", 2, B);
  assert.equal(again.matchId, a.matchId, "no lo sienta en otra partida");
  assert.equal(again.role, "p2");
  assert.ok(again.seatSig);
});

test("resultSignedByArbiter: la llave actual sí, otra no, una firma rota tampoco", async () => {
  const id = ("0x" + "9".repeat(64)) as Hex;
  const w = ("0x" + "1".repeat(40)) as Hex;
  const mine = await S.signResult(id, w, 123n);
  const other = await OLD.signTypedData({
    domain: S.resultDomain(),
    types: S.RESULT_TYPES,
    primaryType: "Result",
    message: { matchId: id, winner: w, deadline: 123n },
  });
  assert.equal(await S.resultSignedByArbiter(id, w, 123n, mine), true);
  assert.equal(await S.resultSignedByArbiter(id, w, 123n, other), false);
  assert.equal(await S.resultSignedByArbiter(id, w, 124n, mine), false, "otro plazo");
  assert.equal(await S.resultSignedByArbiter(id, w, 123n, "0x1234"), false);
});
