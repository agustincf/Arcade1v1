// Plazos de una partida de plata (W9 de docs/MAINNET.md):
//  - F10: la ventana de envío queda CONGELADA al crear la partida. Antes salía
//    de la variable SUBMIT_WINDOW_MS del momento: si cambiaba, la partida ya no
//    coincidía con el `playDeadline` que ató en la cadena.
//  - RT3-05: "¿venció la firma?" lo dice la hora de la CADENA, no el reloj del
//    servidor: adelantado, el árbitro reembolsaba una partida que el contrato
//    todavía dejaba cobrar.
//
// Correr: node --import tsx --test apps/server/test/plazos.test.ts
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
const { ONCHAIN_STATUS: ST } = OC;

const ZERO = "0x" + "0".repeat(40);
const chain = new Map<string, { p1: string; p2: string; status: number }>();
const settles: string[] = [];
const cancels: string[] = [];
let settleFails = 0;
let chainNow = 0; // segundos; 0 = la hora del servidor
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
    if (settleFails > 0) {
      settleFails--;
      throw new Error("fetch failed");
    }
    settles.push(id);
    chain.get(id)!.status = ST.Settled;
    return ("0x" + "5".repeat(64)) as Hex;
  },
  async time() {
    return chainNow || Math.floor(Date.now() / 1000);
  },
});

let next = 1;
const addr = () => "0x" + (next++).toString(16).padStart(40, "9");

function play2048(seed: number | undefined, maxMoves: number) {
  const g = new Game2048(seed!);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  for (let i = 0; !g.over && moves.length < maxMoves && i < 4000; i++) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
  }
  return { score: g.score, replay: { seed: seed!, moves } };
}

async function paired(stake: number) {
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake("2048", stake, A);
  chain.set(a.matchId, { p1: A, p2: ZERO, status: ST.Open });
  await MM.matchmake("2048", stake, B);
  Object.assign(chain.get(a.matchId)!, { p2: B, status: ST.Funded });
  return { id: a.matchId, A, B, seed: a.seed };
}

test("F10: la ventana de envío es la que la partida trae congelada", async () => {
  const { id, A, seed } = await paired(1);
  const m = MM.matchRecord(id)!;
  assert.equal(m.submitDeadline, m.createdAt + MM.SUBMIT_WINDOW_MS, "se congela al nacer");
  m.submitDeadline = Date.now() - 1; // como si hubiera nacido con otra ventana
  const r = play2048(seed, 50);
  await assert.rejects(MM.submitScore(id, A, r.score, r.replay), /match expired/);
});

test("RT3-05: con el reloj del servidor adelantado, si la cadena todavía acepta la firma, se cobra", async () => {
  const { id, A, B, seed } = await paired(2);
  const ra = play2048(seed, 300);
  const rb = play2048(seed, 5);
  await MM.submitScore(id, A, ra.score, ra.replay);
  settleFails = 1; // el primer settle falla: queda para el reintento
  await MM.submitScore(id, B, rb.score, rb.replay);
  await MM.onchainSettled(id);
  const m = MM.matchRecord(id)!;
  assert.equal(settles.includes(id), false);

  // El servidor cree que la firma ya venció; la cadena va 2 minutos atrás.
  const deadline = m.signatureDeadline!;
  chainNow = deadline - 120;
  await MM.sweepMatches((deadline + 60) * 1000);
  await MM.onchainSettled(id);
  assert.ok(settles.includes(id), "el árbitro cobró: la cadena todavía la aceptaba");
  assert.equal(cancels.includes(id), false, "no se reembolsó");
  assert.equal(MM.getMatch(id, A)!.settleOutcome, undefined);
  chainNow = 0;
});

test("RT3-05: si la cadena también la da por vencida, se reembolsa", async () => {
  const { id, A, B, seed } = await paired(5);
  const ra = play2048(seed, 300);
  const rb = play2048(seed, 5);
  await MM.submitScore(id, A, ra.score, ra.replay);
  settleFails = 1;
  await MM.submitScore(id, B, rb.score, rb.replay);
  await MM.onchainSettled(id);
  const deadline = MM.matchRecord(id)!.signatureDeadline!;
  chainNow = deadline + 1;
  await MM.sweepMatches((deadline + 60) * 1000);
  await MM.onchainSettled(id);
  assert.equal(MM.getMatch(id, A)!.settleOutcome, "expired");
  assert.ok(cancels.includes(id));
  chainNow = 0;
});

test("F12: el bot de prueba no se sienta en una mesa de plata", async () => {
  const A = addr();
  const a = await MM.matchmake("2048", 10, A);
  await assert.rejects(MM.addBot(a.matchId), /not allowed on a paid table/);
  assert.equal(MM.matchRecord(a.matchId)!.p2, undefined);
});
