// El driver de Flappy en vivo contra un árbitro de referencia en memoria (las
// mismas reglas que apps/server/src/live.ts, sin HTTP ni firmas). Prueba que
// jugar en vivo da exactamente lo mismo que jugar de corrido con la misma fuente
// de azar, que se recupera si el árbitro pierde compromisos, y la propiedad
// central: nunca se revela un valor que el juego vaya a usar más de
// LIVE_LEAD_TICKS después de lo comprometido.
//
// Correr: node --import tsx --test packages/game-sdk/test/flappy-live-driver.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { SecretSource, LIVE_LEAD_TICKS, MAX_COMMIT_TICKS } from "@arcade1v1/game-sdk/live";
import { playFlappyLive, verifyFlappyLive } from "@arcade1v1/game-sdk/flappy-live";
import { secretFor, flapPolicy, referenceArbiter, batch } from "./live-fixtures";

test("jugar en vivo da el mismo puntaje y los mismos ticks que jugar de corrido", async () => {
  for (let n = 1; n <= 40; n++) {
    const arb = referenceArbiter(secretFor(n));
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    assert.deepEqual(live, batch(secretFor(n), 3_000), `secreto ${n}`);
  }
});

test("si el árbitro pierde compromisos, el driver reenvía desde donde quedó y termina igual", async () => {
  for (let n = 1; n <= 20; n++) {
    const arb = referenceArbiter(secretFor(n), 4);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    assert.deepEqual(live, batch(secretFor(n), 3_000), `secreto ${n}`);
  }
});

test("si se pierde una respuesta ya aplicada, el reintento se resuelve con el conflicto", async () => {
  const arb = referenceArbiter(secretFor(5));
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
  assert.deepEqual(live, batch(secretFor(5), 3_000));
});

test("propiedad central: ningún valor revelado se usa más de LIVE_LEAD_TICKS después de lo comprometido", async () => {
  for (let n = 1; n <= 30; n++) {
    const arb = referenceArbiter(secretFor(n), n % 3 === 0 ? 4 : undefined);
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    // En qué tick se consume cada valor en la partida real (-1: al construir el motor).
    const src = new SecretSource(secretFor(n));
    const consumedAt: number[] = [];
    let now = -1;
    const g = new FlappyEngine({
      next: () => {
        consumedAt.push(now);
        return src.next();
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
          `secreto ${n}: valor ${i} usado en el tick ${consumedAt[i]} y revelado con to=${entry.to}`,
        );
      }
    }
  }
});

test("al llegar a maxTicks vivo, cierra con final y el puntaje alcanzado", async () => {
  const arb = referenceArbiter(secretFor(39));
  const live = await playFlappyLive({
    start: arb.start,
    decide: flapPolicy,
    commit: arb.commit,
    maxTicks: 400,
  });
  assert.deepEqual(live, batch(secretFor(39), 400));
  assert.equal(live.ticks, 400, "llegó vivo al tope: cerró con final");
});

test("si el árbitro no revela lo que el motor necesita, corta con un error claro en vez de colgarse", async () => {
  const arb = referenceArbiter(secretFor(2));
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

test("verifyFlappyLive: con el secreto publicado, cualquiera re-verifica el intento", async () => {
  for (let n = 1; n <= 20; n++) {
    const arb = referenceArbiter(secretFor(n));
    const live = await playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      commit: arb.commit,
      maxTicks: 3_000,
    });
    const replay = { ticks: live.ticks, flaps: arb.flaps() };
    assert.equal(verifyFlappyLive(secretFor(n), replay), live.score, `secreto ${n}`);
  }
  assert.throws(() => verifyFlappyLive("nope", { ticks: 10, flaps: [] }), /invalid live secret/);
});

const failWith = (status: number | undefined, message: string) =>
  Object.assign(new Error(message), status === undefined ? {} : { status });

test("reintenta los errores pasajeros (red, 429, 5xx) y termina igual", async () => {
  const arb = referenceArbiter(secretFor(12));
  let calls = 0;
  const live = await playFlappyLive({
    start: arb.start,
    decide: flapPolicy,
    maxTicks: 3_000,
    retryDelaysMs: [1, 1, 1],
    commit: async (c) => {
      calls += 1;
      if (calls === 2) throw failWith(429, "too many requests");
      if (calls === 3) throw failWith(undefined, "fetch failed");
      if (calls === 4) throw failWith(503, "restarting");
      return arb.commit(c);
    },
  });
  assert.deepEqual(live, batch(secretFor(12), 3_000));
});

test("un rechazo del árbitro (4xx) corta enseguida con su motivo", async () => {
  const arb = referenceArbiter(secretFor(13));
  let calls = 0;
  await assert.rejects(
    playFlappyLive({
      start: arb.start,
      decide: flapPolicy,
      maxTicks: 3_000,
      retryDelaysMs: [1, 1, 1],
      commit: async () => {
        calls += 1;
        throw failWith(400, "match expired");
      },
    }),
    /match expired/,
  );
  assert.equal(calls, 1);
});

test("sin aletear nunca, el cierre se compromete en tramos de a lo sumo MAX_COMMIT_TICKS", async () => {
  const arb = referenceArbiter(secretFor(14));
  const sizes: number[] = [];
  const live = await playFlappyLive({
    start: arb.start,
    decide: () => false,
    maxTicks: 8_000,
    commit: async (c) => {
      sizes.push(c.to - c.from);
      return arb.commit(c);
    },
  });
  assert.ok(sizes.length >= 3, `tramos: ${sizes.join(", ")}`);
  assert.ok(sizes.every((n) => n <= MAX_COMMIT_TICKS));
  assert.deepEqual(live, { score: 0, ticks: 8_000 });
});
