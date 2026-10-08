// W3 (pre-auditoría F1): el rival fantasma en las mesas de plata. Firmar el
// emparejamiento es gratis, así que:
//  - una wallet que nunca abría en la cadena quedaba primera en la fila, y el
//    que llegaba se sentaba con ella: su `join` revertía ("not open");
//  - una que se sentaba como p2 y nunca se unía trababa el stake del que abrió
//    hasta el reembolso, con su intento ya jugado.
// Ahora solo se empareja con quien ya abrió, y un p2 que no se une en
// `JOIN_WINDOW_MS` pierde el lugar: la partida vuelve a la fila. Su asiento no
// se puede revocar en el contrato, así que si se une igual, la cadena manda.
//
// Corre en su propio proceso: escrow "activo" y una cadena falsa con el estado
// de cada partida (quién abrió, quién se unió).
// Correr: node --import tsx --test apps/server/test/rival-fantasma.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
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

// ---- Cadena falsa: lo que abrió y se unió en cada partida ---------------------------
const ZERO = "0x" + "0".repeat(40);
const chain = new Map<string, { p1: string; p2: string; status: number }>();
const unreadable = new Set<string>();
const cancels: string[] = [];
let reads = 0;
const readsOf = new Map<string, number>();
OC.setEscrowChainForTest({
  async read(id) {
    reads++;
    readsOf.set(id, (readsOf.get(id) ?? 0) + 1);
    if (unreadable.has(id)) throw new Error("fetch failed");
    const c = chain.get(id);
    return c ? { ...c, stake: 1_000_000n } : { p1: ZERO, p2: ZERO, stake: 0n, status: ST.None };
  },
  async cancel(id) {
    cancels.push(id);
    const c = chain.get(id);
    if (c) c.status = ST.Refunded;
  },
  async settle() {
    return ("0x" + "5".repeat(64)) as Hex;
  },
});

/** `who` abre la partida en la cadena (deposita como p1). */
const open = (id: string, who: string) => chain.set(id, { p1: who, p2: ZERO, status: ST.Open });
/** `who` se une en la cadena (deposita como p2). */
const join = (id: string, who: string) => {
  const c = chain.get(id)!;
  c.p2 = who;
  c.status = ST.Funded;
};

let next = 1;
const addr = () => "0x" + (next++).toString(16).padStart(40, "c");

/** Cada prueba en su propia mesa (juego, stake): nadie queda en la fila de otra. */
const tables = (["2048", "tetris", "snake", "racing", "invaders"] as const).flatMap((g) =>
  [1, 2, 5, 10].map((s) => ({ game: g, stake: s })),
);
let t = 0;
const table = () => tables[t++];

// ---- Emparejar solo con quien abrió --------------------------------------------------

test("el que llega no se sienta con alguien que todavía no abrió en la cadena", async () => {
  const { game, stake } = table();
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake(game, stake, A);
  const b = await MM.matchmake(game, stake, B);
  assert.notEqual(b.matchId, a.matchId, "B no queda sentado en la partida sin abrir");
  assert.equal(b.role, "p1", "B espera en su propia partida");
  assert.ok(b.seatSig, "con su asiento para abrir");
  assert.equal(MM.matchRecord(a.matchId)!.p2, undefined, "A sigue esperando");
});

test("cuando el primero abre, el próximo se sienta con él (el más viejo primero)", async () => {
  const { game, stake } = table();
  const [A, B, C] = [addr(), addr(), addr()];
  const a = await MM.matchmake(game, stake, A);
  const b = await MM.matchmake(game, stake, B); // A sin abrir: B espera aparte
  open(a.matchId, A);
  open(b.matchId, B);
  const c = await MM.matchmake(game, stake, C);
  assert.equal(c.matchId, a.matchId, "C con A, que llegó primero");
  assert.equal(c.role, "p2");
  assert.ok(c.seatSig, "con su asiento para unirse");
  assert.ok(MM.matchRecord(a.matchId)!.pairedAt, "se anota cuándo se sentó");
  const d = await MM.matchmake(game, stake, addr());
  assert.equal(d.matchId, b.matchId, "el siguiente, con B");
});

test("dos que llegan casi a la vez: el segundo, antes de abrir, pasa a la partida del primero", async () => {
  const { game, stake } = table();
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake(game, stake, A);
  const b = await MM.matchmake(game, stake, B);
  assert.notEqual(b.matchId, a.matchId);
  open(a.matchId, A);
  // La web vuelve a preguntar justo antes de depositar.
  const again = await MM.matchmake(game, stake, B);
  assert.equal(again.matchId, a.matchId, "B se sienta con A en vez de abrir la suya");
  assert.equal(again.role, "p2");
  // La espera de B sale de la fila: el próximo no cae ahí.
  const c = await MM.matchmake(game, stake, addr());
  assert.notEqual(c.matchId, b.matchId);
  assert.equal(c.role, "p1");
});

test("el que ya abrió y vuelve a preguntar recibe su misma partida", async () => {
  const { game, stake } = table();
  const A = addr();
  const a = await MM.matchmake(game, stake, A);
  open(a.matchId, A);
  const again = await MM.matchmake(game, stake, A);
  assert.equal(again.matchId, a.matchId);
  assert.equal(again.role, "p1");
});

test("una espera que no abrió en OPEN_GRACE_MS sale de la fila", async () => {
  const { game, stake } = table();
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake(game, stake, A);
  MM.matchRecord(a.matchId)!.createdAt -= MM.OPEN_GRACE_MS + 1;
  const b = await MM.matchmake(game, stake, B);
  assert.equal(b.role, "p1");
  open(a.matchId, A); // abre tarde: ya no está en la fila
  open(b.matchId, B);
  const c = await MM.matchmake(game, stake, addr());
  assert.equal(c.matchId, b.matchId, "C cae en la espera de B, no en la de A");
  assert.ok(MM.matchRecord(a.matchId), "no se borra: el barrendero la reembolsa al vencer");
});

test("si la cadena no contesta, no se sienta a nadie a ciegas", async () => {
  const { game, stake } = table();
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake(game, stake, A);
  open(a.matchId, A);
  unreadable.add(a.matchId);
  const b = await MM.matchmake(game, stake, B);
  assert.notEqual(b.matchId, a.matchId);
  unreadable.delete(a.matchId);
});

test("la ladder gratis empareja como siempre, sin mirar la cadena", async () => {
  const before = reads;
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake("flappy", 0, A);
  const b = await MM.matchmake("flappy", 0, B);
  assert.equal(b.matchId, a.matchId);
  assert.equal(b.role, "p2");
  assert.equal(reads, before, "ni una lectura");
});

// ---- Liberar al que abrió ----------------------------------------------------------

/** A abre y juega; B se sienta. Devuelve la partida y cuándo vence el plazo de B. */
async function seated() {
  const { game, stake } = table();
  const [A, B] = [addr(), addr()];
  const a = await MM.matchmake(game, stake, A);
  open(a.matchId, A);
  await MM.matchmake(game, stake, B);
  const m = MM.matchRecord(a.matchId)!;
  return { id: a.matchId, A, B, game, stake, late: m.pairedAt! + MM.JOIN_WINDOW_MS + 1 };
}

test("un p2 que no se une a tiempo pierde el lugar y la partida vuelve a la fila", async () => {
  const { id, A, B, game, stake, late } = await seated();
  await MM.sweepMatches(late - 60_000);
  assert.equal(MM.matchRecord(id)!.p2, B, "antes del plazo, nada");

  await MM.sweepMatches(late);
  const m = MM.matchRecord(id)!;
  assert.equal(m.p2, undefined, "B perdió el lugar");
  assert.equal(m.status, "waiting");
  assert.deepEqual(m.revokedSeats, [B]);
  assert.equal(MM.getMatch(id, B)!.role, undefined, "B ya no es jugador");
  assert.equal(MM.getMatch(id, A)!.role, "p1", "A sigue en su partida");

  const C = addr();
  const c = await MM.matchmake(game, stake, C);
  assert.equal(c.matchId, id, "el próximo se sienta en la partida de A");
  assert.equal(c.role, "p2");
  assert.equal(cancels.includes(id), false, "no se canceló nada: A sigue jugando");
});

test("un p2 que se unió a tiempo queda confirmado y no se toca", async () => {
  const { id, B, late } = await seated();
  join(id, B);
  await MM.sweepMatches(late);
  const m = MM.matchRecord(id)!;
  assert.equal(m.p2, B);
  assert.equal(m.joinConfirmed, true);
  const r = readsOf.get(id);
  await MM.sweepMatches(late + 60_000);
  assert.equal(readsOf.get(id), r, "confirmado: no se vuelve a leer");
});

test("si el que perdió el lugar se une igual, la cadena manda: vuelve a ser el p2", async () => {
  const { id, B, game, stake, late } = await seated();
  await MM.sweepMatches(late); // B pierde el lugar
  const C = addr();
  await MM.matchmake(game, stake, C); // C se sienta, pero no llega a unirse
  join(id, B); // B se une con su asiento (que el contrato no deja revocar)

  // B presenta: el árbitro mira la cadena y le devuelve el lugar (el envío de
  // mentira lo rechaza después, por el replay: ya no por "not a player").
  await assert.rejects(MM.submitScore(id, B, 0, {}), (e: Error) => !/not a player/.test(e.message));
  const m = MM.matchRecord(id)!;
  assert.equal(m.p2, B, "B volvió a ser el p2");
  assert.equal(m.joinConfirmed, true);
  await assert.rejects(MM.submitScore(id, C, 0, {}), /not a player/, "C ya no está sentado");
});

test("el barrendero también lo ve: se unió el que perdió el lugar y nadie más estaba sentado", async () => {
  const { id, B, late } = await seated();
  await MM.sweepMatches(late);
  join(id, B);
  await MM.sweepMatches(late + 60_000);
  const m = MM.matchRecord(id)!;
  assert.equal(m.p2, B);
  assert.equal(m.status, "ready");
  assert.equal(cancels.includes(id), false, "no se canceló: está fondeada");
});

test("una partida liberada que nadie retoma se reembolsa al vencer el fondeo", async () => {
  const { id, late } = await seated();
  await MM.sweepMatches(late);
  const fundDeadline = MM.matchRecord(id)!.fundDeadline!;
  await MM.sweepMatches(fundDeadline * 1000 + 1_000);
  await MM.onchainSettled(id);
  assert.ok(cancels.includes(id), "el árbitro la cancela: A recupera su stake");
  assert.equal(MM.matchRecord(id), undefined);
});
