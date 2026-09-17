// El driver de Flappy en vivo contra un árbitro de referencia en memoria (las
// mismas reglas que apps/server/src/live.ts, sin HTTP ni firmas). Prueba que
// jugar en vivo da exactamente lo mismo que jugar con la semilla, que se
// recupera si el árbitro pierde compromisos, y la propiedad central: nunca se
// revela un valor que el juego vaya a usar más de LIVE_LEAD_TICKS después de lo
// comprometido.
//
// Correr: node --import tsx --test packages/game-sdk/test/flappy-live-driver.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { FlappyEngine, FLAPPY_DT, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";
import { SeededSource, LIVE_LEAD_TICKS } from "@arcade1v1/game-sdk/live";
import {
  playFlappyLive,
  type FlappyLiveCommit,
  type FlappyLiveReply,
} from "@arcade1v1/game-sdk/flappy-live";
import { mulberry32 } from "../src/replay";

function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

/** Árbitro de referencia. `rollbackOnCommit`: en ese compromiso "se cae" y
 *  pierde los últimos 40 ticks comprometidos, como una caída dura. */
function referenceArbiter(seed: number, rollbackOnCommit?: number) {
  let src = new SeededSource(seed);
  let eng = new FlappyEngine(src);
  let tick = 0;
  let revealed = 0;
  let over = false;
  let seen = 0;
  let flaps: number[] = [];
  const log: { to: number; revealed: number }[] = [];
  const reveal = (have: number) => {
    revealed = Math.max(revealed, src.consumed + eng.drawsWithin(LIVE_LEAD_TICKS));
    return { reveal: src.slice(Math.min(Math.max(0, have), revealed), revealed), revealed };
  };
  const start = { tick: 0, flaps: [] as number[], ...reveal(0) };
  log.push({ to: 0, revealed });
  const commit = async (c: FlappyLiveCommit): Promise<FlappyLiveReply> => {
    seen += 1;
    if (seen === rollbackOnCommit && tick > 0) {
      const back = Math.max(0, tick - 40);
      flaps = flaps.filter((f) => f < back);
      src = new SeededSource(seed);
      eng = new FlappyEngine(src);
      const set = new Set(flaps);
      for (let t = 0; t < back; t++) {
        if (set.has(t)) eng.flap();
        eng.update(FLAPPY_DT);
      }
      tick = back;
    }
    if (over) return { tick, over: true, score: eng.score, reveal: [], revealed };
    if (c.from !== tick) return { conflict: true, tick, ...reveal(c.have) };
    const set = new Set(c.flaps);
    let t = c.from;
    for (; t < c.to && !eng.over; t++) {
      if (set.has(t)) eng.flap();
      eng.update(FLAPPY_DT);
    }
    for (const f of c.flaps) if (f < t) flaps.push(f);
    tick = t;
    const r = reveal(c.have);
    log.push({ to: tick, revealed });
    if (eng.over || c.final) {
      over = true;
      return { tick, over: true, score: eng.score, ...r };
    }
    return { tick, over: false, ...r };
  };
  return { start, commit, log, flaps: () => flaps };
}

/** La misma partida jugada con la semilla, de corrido. */
function batch(seed: number, maxTicks: number) {
  const g = new FlappyEngine(seed);
  let t = 0;
  for (; t < maxTicks && !g.over; t++) {
    if (flapPolicy(g, t)) g.flap();
    g.update(FLAPPY_DT);
  }
  return { score: g.score, ticks: t };
}

test("jugar en vivo da el mismo puntaje y los mismos ticks que jugar con la semilla", async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const arb = referenceArbiter(seed);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    assert.deepEqual(live, batch(seed, 3_000), `seed ${seed}`);
  }
});

test("si el árbitro pierde compromisos, el driver reenvía desde donde quedó y termina igual", async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const arb = referenceArbiter(seed, 4);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    assert.deepEqual(live, batch(seed, 3_000), `seed ${seed}`);
  }
});

test("si se pierde una respuesta ya aplicada, el reintento se resuelve con el conflicto", async () => {
  const arb = referenceArbiter(5);
  let dropped = false;
  const live = await playFlappyLive({
    start: arb.start,
    decide: flapPolicy,
    maxTicks: 3_000,
    // Transporte que reintenta: la primera respuesta "se pierde" después de
    // aplicarse en el árbitro, y el reintento llega con el `from` viejo.
    commit: async (c) => {
      const reply = await arb.commit(c);
      if (!dropped && !reply.conflict && !reply.over) {
        dropped = true;
        return arb.commit(c);
      }
      return reply;
    },
  });
  assert.equal(dropped, true);
  assert.deepEqual(live, batch(5, 3_000));
});

test("propiedad central: ningún valor revelado se usa más de LIVE_LEAD_TICKS después de lo comprometido", async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const arb = referenceArbiter(seed, seed % 3 === 0 ? 4 : undefined);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    // En qué tick se consume cada valor en la partida real (-1: al construir el motor).
    const rng = mulberry32(seed);
    const consumedAt: number[] = [];
    let now = -1;
    const g = new FlappyEngine({
      next: () => {
        consumedAt.push(now);
        return rng();
      },
    });
    const set = new Set(arb.flaps());
    for (now = 0; now < live.ticks && !g.over; now++) {
      if (set.has(now)) g.flap();
      g.update(FLAPPY_DT);
    }
    for (const entry of arb.log) {
      for (let i = 0; i < entry.revealed && i < consumedAt.length; i++) {
        assert.ok(
          consumedAt[i] <= entry.to + LIVE_LEAD_TICKS,
          `seed ${seed}: valor ${i} usado en el tick ${consumedAt[i]} y revelado con to=${entry.to}`,
        );
      }
    }
  }
});

test("al llegar a maxTicks vivo, cierra con final y el puntaje alcanzado", async () => {
  const arb = referenceArbiter(39);
  const live = await playFlappyLive({
    start: arb.start,
    decide: flapPolicy,
    commit: arb.commit,
    maxTicks: 400,
  });
  assert.deepEqual(live, batch(39, 400));
  assert.equal(live.ticks, 400, "llegó vivo al tope: cerró con final");
});

test("si el árbitro no revela lo que el motor necesita, corta con un error claro en vez de colgarse", async () => {
  const arb = referenceArbiter(2);
  await assert.rejects(
    playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      maxTicks: 3_000,
      commit: async (c) => ({ ...(await arb.commit(c)), reveal: [] }),
    }),
    /live desync/,
  );
});
