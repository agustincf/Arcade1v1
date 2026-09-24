// LA PLATA DE UNA PARTIDA 1v1 DECIDIDA (Escrow1v1 v2), del lado del árbitro:
//
//  1. El ASIENTO ata las condiciones: los dos jugadores reciben los mismos
//     plazos, fijados al crear la partida, y la firma los cubre.
//  2. La FIRMA DEL GANADOR no sale —ni en la vista ni en una transacción—
//     hasta que la decisión quedó guardada. Si el store falla, espera.
//  3. LIQUIDA EL ÁRBITRO, con reintentos: si otro presentó la firma antes (el
//     ganador) o la partida se reembolsó, lo lee de la cadena y no insiste; si
//     la firma vence sin presentarse, reembolsa.
//
// Corre en su propio proceso: necesita el escrow "activo", la persistencia
// PRENDIDA contra un Upstash falso (persist.ts captura las variables al
// importarse) y una cadena falsa inyectada (setEscrowChainForTest). Nada toca
// un nodo de verdad; el e2e contra anvil (onchain-e2e.ts) prueba la cadena real.
// Correr: node --import tsx --test apps/server/test/paid-settle.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Hex } from "viem";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { startFakeUpstash } from "./fake-upstash.js";

const upstash = await startFakeUpstash();
after(() => upstash.close());

process.env.ARCADE_PERSIST = "1";
process.env.UPSTASH_REDIS_REST_URL = upstash.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-mentira";
// Una hora de debounce: lo que llegue al Upstash falso salió de un flush.
process.env.PERSIST_DEBOUNCE_MS = "3600000";
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";

const MM = await import("../src/matchmaking.js");
const OC = await import("../src/onchain.js");
const S = await import("../src/sign.js");
const { ONCHAIN_STATUS: ST } = OC;

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const ARBITER = S.arbiterAddress().toLowerCase();

// ---- Cadena falsa ------------------------------------------------------------
interface Call {
  id: string;
  winner: string;
  deadline: bigint;
  signature: Hex;
  /** El blob de partidas guardado en el momento del settle. */
  savedBlob: string | undefined;
}
const chainState = new Map<string, number>();
const settles: Call[] = [];
const cancels: string[] = [];
/** Qué hace el próximo settle: por defecto, se mina y la deja Settled. */
let onSettle: (id: string) => Promise<Hex> = async (id) => {
  chainState.set(id, ST.Settled);
  return ("0x" + "5".repeat(64)) as Hex;
};

OC.setEscrowChainForTest({
  async read(id) {
    // A y B depositaron (la guarda de depósito lo exige para aceptar puntajes).
    return { p1: A, p2: B, stake: 1_000_000n, status: chainState.get(id) ?? ST.Funded };
  },
  async cancel(id) {
    cancels.push(id);
    chainState.set(id, ST.Refunded);
  },
  async settle(id, winner, deadline, signature) {
    settles.push({ id, winner, deadline, signature, savedBlob: upstash.kv.get("arcade:matches") });
    return onSettle(id);
  },
});

// ---- Ayudas ----------------------------------------------------------------------
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

/** Una partida de 1 USDC entre A y B, decidida: A juega entero, B casi nada. */
async function decidedMatch() {
  const v1 = await MM.matchmake("2048", 1, A);
  const v2 = await MM.matchmake("2048", 1, B);
  assert.equal(v1.matchId, v2.matchId, "emparejados");
  const a = play2048(v1.seed, 500);
  await MM.submitScore(v1.matchId, A, a.score, a.replay);
  const b = play2048(v2.seed, 3);
  const res = await MM.submitScore(v2.matchId, B, b.score, b.replay);
  assert.equal(res.status, "settled");
  assert.equal(res.winner, A);
  return { id: v1.matchId, v1, v2, res };
}

const settlesOf = (id: string) => settles.filter((c) => c.id === id);

// ---- 1. El asiento -----------------------------------------------------------------

test("mesa de plata: los dos asientos atan las MISMAS condiciones, firmadas por el árbitro", async () => {
  const before = Math.floor(Date.now() / 1000);
  const v1 = await MM.matchmake("2048", 1, A);
  const v2 = await MM.matchmake("2048", 1, B);
  const after = Math.floor(Date.now() / 1000);
  assert.ok(v1.fundDeadline && v1.playDeadline && v1.seatSig && v2.seatSig);
  assert.equal(v2.fundDeadline, v1.fundDeadline, "el que se une ve los plazos del que abrió");
  assert.equal(v2.playDeadline, v1.playDeadline);
  // Fondeo: la espera de rival (1 h) + 10 min. Juego: la ventana de envío (2 h).
  assert.ok(v1.fundDeadline >= before + 70 * 60 && v1.fundDeadline <= after + 70 * 60);
  assert.equal(v1.playDeadline - v1.fundDeadline, 50 * 60);

  for (const [v, player] of [
    [v1, A],
    [v2, B],
  ] as const) {
    const signer = await recoverTypedDataAddress({
      domain: S.resultDomain(),
      types: S.SEAT_TYPES,
      primaryType: "Seat",
      message: {
        matchId: v.matchId as Hex,
        player: player as Hex,
        stake: 1_000_000n,
        fundDeadline: BigInt(v.fundDeadline!),
        playDeadline: BigInt(v.playDeadline!),
      },
      signature: v.seatSig as Hex,
    });
    assert.equal(signer.toLowerCase(), ARBITER, "el asiento cubre stake y plazos");
  }
  // Se deja la partida decidida para no ensuciar la cola de los tests siguientes.
  const a = play2048(v1.seed, 500);
  await MM.submitScore(v1.matchId, A, a.score, a.replay);
  const b = play2048(v2.seed, 3);
  await MM.submitScore(v2.matchId, B, b.score, b.replay);
  await MM.onchainSettled(v1.matchId);
});

// ---- 2 y 3. La firma y la liquidación ----------------------------------------------

test("liquida el árbitro: la firma vence al abrirse el reembolso y el pago queda en la vista", async () => {
  const { id, v1, res } = await decidedMatch();
  assert.equal(res.signatureDeadline, v1.playDeadline! + OC.ESCROW_REFUND_GRACE_S);
  const signer = await recoverTypedDataAddress({
    domain: S.resultDomain(),
    types: S.RESULT_TYPES,
    primaryType: "Result",
    message: { matchId: id as Hex, winner: A as Hex, deadline: BigInt(res.signatureDeadline!) },
    signature: res.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), ARBITER);

  await MM.onchainSettled(id);
  const calls = settlesOf(id);
  assert.equal(calls.length, 1, "un solo settle");
  assert.equal(calls[0].winner, A);
  assert.equal(calls[0].deadline, BigInt(res.signatureDeadline!));
  assert.equal(calls[0].signature, res.signature);
  assert.ok(
    calls[0].savedBlob?.includes(res.signature!),
    "la decisión ya estaba guardada cuando salió la transacción",
  );
  const v = MM.getMatch(id, A)!;
  assert.equal(v.settleTx, "0x" + "5".repeat(64));
  assert.equal(v.settleOutcome, undefined);
});

test("la firma no sale —ni en la vista ni en una transacción— hasta que la decisión quedó guardada", async () => {
  upstash.failKeys.add("arcade:matches");
  let id: string;
  try {
    const d = await decidedMatch();
    id = d.id;
    assert.equal(d.res.signature, undefined, "la respuesta del que cerró no trae la firma");
    assert.equal(d.res.signatureDeadline, undefined);
    assert.equal(MM.getMatch(id, A)!.signature, undefined, "tampoco la vista del ganador");
    await MM.onchainSettled(id);
    assert.equal(settlesOf(id).length, 0, "ninguna transacción con una firma sin guardar");
  } finally {
    upstash.failKeys.delete("arcade:matches");
  }

  // El store vuelve: el barrendero guarda, recién entonces muestra y liquida
  // (después del backoff del intento fallido).
  const now = Date.now();
  MM.sweepMatches(now + 1_000);
  await MM.onchainSettled(id);
  assert.equal(settlesOf(id).length, 0, "respeta el backoff");
  MM.sweepMatches(now + 16_000);
  await MM.onchainSettled(id);
  const v = MM.getMatch(id, A)!;
  assert.ok(v.signature, "guardada, la firma aparece");
  assert.equal(settlesOf(id).length, 1);
  assert.ok(settlesOf(id)[0].savedBlob?.includes(v.signature!), "guardada ANTES del settle");
  assert.ok(v.settleTx);
});

test("si el ganador presentó la firma antes, el árbitro lo lee de la cadena y no insiste", async () => {
  onSettle = async (id) => {
    chainState.set(id, ST.Settled); // se le adelantaron con la misma firma
    throw new Error('The contract function "settle" reverted: not funded');
  };
  try {
    const { id } = await decidedMatch();
    await MM.onchainSettled(id);
    const v = MM.getMatch(id, A)!;
    assert.equal(v.settleOutcome, "external");
    assert.equal(v.settleTx, undefined);
    MM.sweepMatches(Date.now() + 10 * 60_000);
    await MM.onchainSettled(id);
    assert.equal(settlesOf(id).length, 1, "cerrada: no se vuelve a mandar");
  } finally {
    onSettle = async (id) => {
      chainState.set(id, ST.Settled);
      return ("0x" + "5".repeat(64)) as Hex;
    };
  }
});

test("si la partida ya se reembolsó, queda como reembolsada y no se insiste", async () => {
  const saved = onSettle;
  onSettle = async (id) => {
    chainState.set(id, ST.Refunded);
    throw new Error("not funded");
  };
  try {
    const { id } = await decidedMatch();
    await MM.onchainSettled(id);
    assert.equal(MM.getMatch(id, A)!.settleOutcome, "refunded");
  } finally {
    onSettle = saved;
  }
});

test("RPC caído: la partida sigue Funded y el árbitro reintenta con backoff hasta pagar", async () => {
  const saved = onSettle;
  onSettle = async () => {
    throw new Error("fetch failed");
  };
  let id: string;
  try {
    ({ id } = await decidedMatch());
    await MM.onchainSettled(id);
    assert.equal(settlesOf(id).length, 1);
    const now = Date.now();
    MM.sweepMatches(now + 5_000); // antes del backoff (15 s): no reintenta
    await MM.onchainSettled(id);
    assert.equal(settlesOf(id).length, 1);
  } finally {
    onSettle = saved;
  }
  MM.sweepMatches(Date.now() + 16_000);
  await MM.onchainSettled(id);
  assert.equal(settlesOf(id).length, 2, "reintentó");
  assert.ok(MM.getMatch(id, A)!.settleTx, "y pagó");
});

test("la firma venció sin presentarse: el árbitro reembolsa, no la manda vencida", async () => {
  const saved = onSettle;
  onSettle = async () => {
    throw new Error("fetch failed");
  };
  try {
    const { id, res } = await decidedMatch();
    await MM.onchainSettled(id);
    const tries = settlesOf(id).length;
    MM.sweepMatches((res.signatureDeadline! + 1) * 1000);
    await MM.onchainSettled(id);
    assert.equal(settlesOf(id).length, tries, "vencida, no se presenta");
    assert.equal(MM.getMatch(id, A)!.settleOutcome, "expired");
    assert.ok(cancels.includes(id), "la canceló: los dos recuperan su stake");
  } finally {
    onSettle = saved;
  }
});

test("partida gratis: sin condiciones on-chain, la firma sale enseguida y no hay liquidación", async () => {
  const v1 = await MM.matchmake("2048", 0, A);
  const v2 = await MM.matchmake("2048", 0, B);
  assert.equal(v1.fundDeadline, undefined);
  assert.equal(v1.seatSig, undefined);
  const a = play2048(v1.seed, 500);
  await MM.submitScore(v1.matchId, A, a.score, a.replay);
  const b = play2048(v2.seed, 3);
  const res = await MM.submitScore(v2.matchId, B, b.score, b.replay);
  assert.ok(res.signature, "sin plata, no hay nada que esperar");
  assert.ok(res.signatureDeadline);
  await MM.onchainSettled(v1.matchId);
  assert.equal(settlesOf(v1.matchId).length, 0);
  assert.equal(MM.getMatch(v1.matchId, A)!.settleTx, undefined);
});

test("una partida pagada que decidió el árbitro anterior (firma v1) no se liquida contra el contrato nuevo", async () => {
  // Así vuelve del store, en el primer arranque del árbitro nuevo, una partida
  // de plata decidida por la versión anterior: firma sin vencimiento, y la
  // cobró el ganador desde la web (el árbitro no se enteró).
  const id = ("0x" + "0d".repeat(32)) as Hex;
  const createdAt = Date.now() - 60 * 60_000;
  upstash.kv.set(
    "arcade:matches",
    JSON.stringify([
      {
        id,
        game: "2048",
        stake: 1,
        seed: 1,
        rulesV: 1,
        p1: A,
        p2: B,
        scores: { [A]: 10, [B]: 5 },
        replays: {},
        createdAt,
        status: "settled",
        winner: A,
        outcome: "p1",
        signature: "0x" + "ab".repeat(65),
      },
    ]),
  );
  await MM.restoreMatches();
  MM.sweepMatches(Date.now());
  MM.sweepMatches(Date.now() + 3 * 60 * 60_000); // pasado cualquier plazo
  await MM.onchainSettled(id);
  assert.equal(settlesOf(id).length, 0, "no se manda un settle con una firma v1");
  assert.ok(!cancels.includes(id), "ni se cancela: esa partida vive en el contrato viejo");
  const v = MM.getMatch(id, A)!;
  assert.equal(v.settleOutcome, undefined, "y la vista no inventa un reembolso");
  assert.equal(v.signatureDeadline, undefined);
});
