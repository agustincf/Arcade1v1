// W2 (pre-auditoría F3): no presentar el puntaje ya no es gratis. Antes, al
// vencer la ventana de envío la partida se cancelaba y los dos recuperaban su
// stake: el que jugó mal no presentaba. Ahora, si solo uno presentó, gana ese
// (y el otro pierde rating). Con plata, solo si los dos depositaron (Funded) y
// todavía da el tiempo para que el árbitro cobre; si el rival nunca depositó,
// o ya no da el tiempo, se reembolsa como antes.
//
// Corre en su propio proceso: escrow "activo", persistencia contra un Upstash
// falso (la decisión de una mesa de plata se guarda antes de firmar) y una
// cadena falsa con el estado de cada partida.
// Correr: node --import tsx --test apps/server/test/no-presentar.test.ts
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

// ---- Cadena falsa: cada partida con su estado ----------------------------------
const status = new Map<string, number>();
const unreadable = new Set<string>();
const settles: { id: string; winner: string; deadline: bigint }[] = [];
const cancels: string[] = [];
OC.setEscrowChainForTest({
  async read(id) {
    if (unreadable.has(id)) throw new Error("fetch failed");
    const m = MM.matchRecord(id);
    const st = status.get(id) ?? ST.Funded;
    // Open: solo depositó el que abrió (p1).
    const p2 = st === ST.Open ? "0x" + "0".repeat(40) : (m?.p2 ?? "");
    return { p1: m?.p1 ?? "", p2, stake: 1_000_000n, status: st };
  },
  async cancel(id) {
    cancels.push(id);
    status.set(id, ST.Refunded);
  },
  async settle(id, winner, deadline) {
    settles.push({ id, winner, deadline });
    status.set(id, ST.Settled);
    return ("0x" + "5".repeat(64)) as Hex;
  },
});

// ---- Ayudas ------------------------------------------------------------------------
let next = 1;
/** Dos jugadores nuevos por prueba: nadie queda en la cola de otra. */
const pair = () => {
  const a = "0x" + (next++).toString(16).padStart(40, "a");
  const b = "0x" + (next++).toString(16).padStart(40, "b");
  return [a, b];
};

function play2048(seed: number | undefined, maxMoves: number) {
  if (seed === undefined) throw new Error("2048 sin semilla");
  const g = new Game2048(seed);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  for (let i = 0; !g.over && moves.length < maxMoves && i < 4000; i++) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
  }
  return { score: g.score, replay: { seed, moves } };
}

/** Empareja a A y B en `stake` y A presenta (B no). */
async function onlyAPlays(stake: number) {
  const [A, B] = pair();
  const v = await MM.matchmake("2048", stake, A);
  await MM.matchmake("2048", stake, B);
  const a = play2048(v.seed, 200);
  await MM.submitScore(v.matchId, A, a.score, a.replay);
  return { id: v.matchId, A, B, score: a.score, createdAt: MM.matchRecord(v.matchId)!.createdAt };
}

/** Cuando vence: la ventana de envío más el margen del barrendero (15 min). */
const expiry = (createdAt: number) => createdAt + MM.SUBMIT_WINDOW_MS + 15 * 60_000 + 1;

// ---- Mesa gratis -------------------------------------------------------------------

test("gratis: si solo uno presentó, al vencer gana ese y el otro pierde rating", async () => {
  const { id, A, B, score, createdAt } = await onlyAPlays(0);

  await MM.sweepMatches(expiry(createdAt) - 60_000);
  assert.equal(MM.getMatch(id, A)!.status, "ready", "antes de vencer, nada");

  await MM.sweepMatches(expiry(createdAt));
  const va = MM.getMatch(id, A)!;
  assert.equal(va.status, "settled");
  assert.equal(va.winner, A);
  assert.equal(va.noShow, B, "dice quién no presentó");
  assert.equal(va.yourScore, score);
  assert.equal(va.rivalScore, undefined, "el que no presentó no tiene puntaje");
  assert.ok(va.ratingDelta! > 0, "el que presentó sube");
  const vb = MM.getMatch(id, B)!;
  assert.equal(vb.outcome, "p1");
  assert.ok(
    vb.ratingDelta! < 0,
    "el que no presentó baja: ya no le conviene esconder una mala corrida",
  );
});

test("gratis: si nadie presentó, empate sin cambio de rating", async () => {
  const [A, B] = pair();
  const v = await MM.matchmake("2048", 0, A);
  await MM.matchmake("2048", 0, B);
  await MM.sweepMatches(expiry(MM.matchRecord(v.matchId)!.createdAt));
  const va = MM.getMatch(v.matchId, A)!;
  assert.equal(va.status, "draw");
  assert.equal(va.noShow, undefined);
  assert.equal(va.ratingDelta, undefined);
});

// ---- Mesa de plata -----------------------------------------------------------------

test("plata: depositaron los dos y solo uno presentó: gana ese y el árbitro cobra por él", async () => {
  const { id, A, B, createdAt } = await onlyAPlays(1);
  status.set(id, ST.Funded);
  await MM.sweepMatches(expiry(createdAt));
  await MM.onchainSettled(id);

  const va = MM.getMatch(id, A)!;
  assert.equal(va.status, "settled");
  assert.equal(va.winner, A);
  assert.equal(va.noShow, B);
  assert.ok(va.signature, "firmada y guardada");
  const s = settles.filter((c) => c.id === id);
  assert.equal(s.length, 1, "el árbitro liquida");
  assert.equal(s[0].winner.toLowerCase(), A);
  assert.equal(
    Number(s[0].deadline),
    va.signatureDeadline,
    "con la firma que vence al abrirse el reembolso",
  );
  assert.ok(!cancels.includes(id), "no se reembolsa");
  assert.ok(va.netPnl! > 0, "y gana el pozo");
});

test("plata: el rival nunca depositó: se le devuelve al que sí, y nadie gana", async () => {
  const { id, A, createdAt } = await onlyAPlays(1);
  status.set(id, ST.Open);
  await MM.sweepMatches(expiry(createdAt));
  await MM.onchainSettled(id);
  const va = MM.getMatch(id, A)!;
  assert.equal(va.status, "draw");
  assert.equal(va.noShow, undefined);
  assert.ok(cancels.includes(id), "reembolso");
  assert.equal(settles.filter((c) => c.id === id).length, 0);
});

test("plata: si ya no da el tiempo para cobrar antes del reembolso, se reembolsa", async () => {
  const { id, A } = await onlyAPlays(1);
  status.set(id, ST.Funded);
  // El árbitro estuvo caído: el barrido llega cuando faltan menos de 5 min
  // para que venza la firma (playDeadline + 30 min).
  const playDeadline = MM.getMatch(id, A)!.playDeadline!;
  await MM.sweepMatches((playDeadline + 30 * 60 - 60) * 1000);
  await MM.onchainSettled(id);
  const va = MM.getMatch(id, A)!;
  assert.equal(va.status, "draw");
  assert.equal(va.signature, undefined, "no firma algo que no llega a cobrarse");
  assert.ok(cancels.includes(id));
});

test("plata: si la cadena no contesta, no decide y espera al próximo barrido", async () => {
  const { id, A, B, createdAt } = await onlyAPlays(1);
  status.set(id, ST.Funded);
  unreadable.add(id);
  await MM.sweepMatches(expiry(createdAt));
  await MM.onchainSettled(id);
  assert.equal(MM.getMatch(id, A)!.status, "ready", "sin saber si depositaron, no decide");
  assert.ok(!cancels.includes(id));

  unreadable.delete(id);
  await MM.sweepMatches(expiry(createdAt) + 60_000);
  await MM.onchainSettled(id);
  const va = MM.getMatch(id, A)!;
  assert.equal(va.winner, A);
  assert.equal(va.noShow, B);
});
