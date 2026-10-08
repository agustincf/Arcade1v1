// W4 (pre-auditoría F2): los reembolsos del árbitro se reintentan hasta que la
// cadena diga Refunded. Antes eran un solo intento (el cancel con sus 3
// reintentos de 2 s): si el RPC fallaba unos segundos, nadie lo volvía a
// intentar y la web igual decía "reembolsado". La vista dice `refund: "done"`
// recién cuando la cadena lo confirma. Y una partida gratis no manda ningún
// cancel (F11).
//
// Corre en su propio proceso: escrow "activo", persistencia contra un Upstash
// falso y una cadena falsa que puede fallar los cancels a pedido.
// Correr: node --import tsx --test apps/server/test/reembolsos.test.ts
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

// ---- Cadena falsa ------------------------------------------------------------------
const ZERO = "0x" + "0".repeat(40);
const chain = new Map<string, { p1: string; p2: string; status: number }>();
/** Cuántos cancels más van a fallar, por partida (RPC caído). */
const failing = new Map<string, number>();
const cancels: string[] = [];
OC.setEscrowChainForTest({
  async read(id) {
    const c = chain.get(id);
    return c ? { ...c, stake: 1_000_000n } : { p1: ZERO, p2: ZERO, stake: 0n, status: ST.None };
  },
  async cancel(id) {
    cancels.push(id);
    const left = failing.get(id) ?? 0;
    if (left > 0) {
      failing.set(id, left - 1);
      throw new Error("fetch failed");
    }
    const c = chain.get(id);
    if (!c || (c.status !== ST.Open && c.status !== ST.Funded)) throw new Error("cant cancel");
    c.status = ST.Refunded;
  },
  async settle() {
    return ("0x" + "5".repeat(64)) as Hex;
  },
});

let next = 1;
const addr = () => "0x" + (next++).toString(16).padStart(40, "d");
const cancelsOf = (id: string) => cancels.filter((c) => c === id).length;

/** El mismo juego para los dos: empate seguro. */
function play2048(seed: number | undefined) {
  const g = new Game2048(seed!);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  for (let i = 0; !g.over && moves.length < 40 && i < 4000; i++) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
  }
  return { score: g.score, replay: { seed: seed!, moves } };
}

/** A abre, B se sienta y se une, y empatan. */
async function paidDraw(stake: number) {
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake("2048", stake, A);
  chain.set(a.matchId, { p1: A, p2: ZERO, status: ST.Open });
  await MM.matchmake("2048", stake, B);
  chain.get(a.matchId)!.p2 = B;
  chain.get(a.matchId)!.status = ST.Funded;
  const run = play2048(a.seed);
  return { id: a.matchId, A, B, run };
}

test("un reembolso que falla se reintenta con backoff hasta que la cadena lo confirma", async () => {
  const { id, A, B, run } = await paidDraw(1);
  failing.set(id, 1);
  await MM.submitScore(id, A, run.score, run.replay);
  await MM.submitScore(id, B, run.score, run.replay);
  await MM.onchainSettled(id);

  const v = MM.getMatch(id, A)!;
  assert.equal(v.status, "draw");
  assert.equal(v.refund, "pending", "no dice reembolsado mientras la cadena no lo confirme");
  assert.equal(cancelsOf(id), 1);

  const m = MM.matchRecord(id)!;
  await MM.sweepMatches(m.nextRefundAt! - 1);
  await MM.onchainSettled(id);
  assert.equal(cancelsOf(id), 1, "respeta el backoff");

  await MM.sweepMatches(m.nextRefundAt!);
  await MM.onchainSettled(id);
  assert.equal(cancelsOf(id), 2, "lo reintenta el barrendero");
  assert.equal(MM.getMatch(id, A)!.refund, "done");
  assert.equal(chain.get(id)!.status, ST.Refunded);

  await MM.sweepMatches(Date.now() + 60 * 60_000);
  assert.equal(cancelsOf(id), 2, "hecho: no se vuelve a mandar");
});

test("si el cancel falla pero la partida ya se reembolsó (lo pidió otro), queda hecho", async () => {
  const { id, A, B, run } = await paidDraw(2);
  await MM.submitScore(id, A, run.score, run.replay);
  // Mientras B presenta, un jugador pide el reembolso desde /recover: el cancel
  // del árbitro ya no tiene qué cancelar y falla.
  failing.set(id, 1);
  const late = MM.submitScore(id, B, run.score, run.replay);
  chain.get(id)!.status = ST.Refunded;
  await late;
  await MM.onchainSettled(id);
  assert.equal(MM.getMatch(id, A)!.refund, "done");
  assert.equal(MM.matchRecord(id)!.refundAttempts, undefined);
});

test("una partida gratis no manda ningún cancel (F11)", async () => {
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake("2048", 0, A);
  await MM.matchmake("2048", 0, B);
  const run = play2048(a.seed);
  await MM.submitScore(a.matchId, A, run.score, run.replay);
  const v = await MM.submitScore(a.matchId, B, run.score, run.replay);
  await MM.onchainSettled(a.matchId);
  assert.equal(v.status, "draw");
  assert.equal(cancelsOf(a.matchId), 0);
  assert.equal(v.refund, undefined);
});

test("sin rival: la partida queda (no 404) hasta que la cadena confirme el reembolso", async () => {
  const A = addr();
  const a = await MM.matchmake("2048", 5, A);
  chain.set(a.matchId, { p1: A, p2: ZERO, status: ST.Open });
  failing.set(a.matchId, 1);
  const created = MM.matchRecord(a.matchId)!.createdAt;
  await MM.sweepMatches(created + 60 * 60_000 + 1);
  await MM.onchainSettled(a.matchId);

  const v = MM.getMatch(a.matchId, A)!;
  assert.equal(v.status, "draw", "la ve terminada en vez de 404");
  assert.equal(v.refund, "pending");

  const m = MM.matchRecord(a.matchId)!;
  await MM.sweepMatches(m.nextRefundAt!);
  await MM.onchainSettled(a.matchId);
  assert.equal(MM.getMatch(a.matchId, A)!.refund, "done");
});

test("sin rival y sin depósito: se espera al fondeo (puede abrir tarde) y recién ahí no hay nada que devolver", async () => {
  const A = addr();
  const a = await MM.matchmake("2048", 10, A); // todavía no abrió
  const m = MM.matchRecord(a.matchId)!;
  await MM.sweepMatches(m.createdAt + 60 * 60_000 + 1);
  await MM.onchainSettled(a.matchId);
  assert.equal(MM.getMatch(a.matchId, A)!.refund, "pending", "su asiento todavía sirve (F9)");
  assert.equal(
    m.nextRefundAt,
    (m.fundDeadline! + 1) * 1000,
    "se vuelve a mirar al vencer el fondeo",
  );

  // Abre tarde, con el asiento que todavía vale: el árbitro lo reembolsa igual.
  chain.set(a.matchId, { p1: A, p2: ZERO, status: ST.Open });
  await MM.sweepMatches(m.nextRefundAt!);
  await MM.onchainSettled(a.matchId);
  assert.equal(MM.getMatch(a.matchId, A)!.refund, "done");
});

test("sin rival y sin depósito al vencer el fondeo: no hay nada que devolver", async () => {
  const A = addr();
  const a = await MM.matchmake("2048", 5, A); // nunca abre
  const m = MM.matchRecord(a.matchId)!;
  await MM.sweepMatches(m.createdAt + 60 * 60_000 + 1);
  await MM.onchainSettled(a.matchId);
  await MM.sweepMatches(m.nextRefundAt!);
  await MM.onchainSettled(a.matchId);
  assert.equal(MM.getMatch(a.matchId, A)!.refund, "none");
  assert.equal(m.refundAttempts, undefined, "no se reintenta");
});
