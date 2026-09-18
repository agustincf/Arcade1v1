// FlappyLiveSession: Flappy en vivo dentro de un bucle de tiempo real (la web).
// El bucle se simula cuadro a cuadro, con respuestas del árbitro que tardan
// varios cuadros en llegar: la sesión no avanza sin el azar que necesita,
// compromete en segundo plano, se resincroniza, reintenta los errores de red y
// termina con el mismo puntaje que la partida jugada de corrido.
//
// Correr: node --import tsx --test packages/game-sdk/test/flappy-live-session.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { SecretSource } from "@arcade1v1/game-sdk/live";
import {
  FlappyLiveSession,
  type FlappyLiveCommitFn,
  type FlappyLiveReply,
} from "@arcade1v1/game-sdk/flappy-live";
import { secretFor, flapPolicy, referenceArbiter, batch } from "./live-fixtures";

/** Un transporte cuyas respuestas llegan `delay` cuadros después. */
function delayed(commit: FlappyLiveCommitFn, delay: number) {
  const queue: { due: number; run: () => void }[] = [];
  let frame = 0;
  const fn: FlappyLiveCommitFn = (c) =>
    new Promise<FlappyLiveReply>((resolve, reject) => {
      queue.push({ due: frame + delay, run: () => void commit(c).then(resolve, reject) });
    });
  const nextFrame = () => {
    frame += 1;
    for (let i = 0; i < queue.length; ) {
      if (queue[i].due <= frame) queue.splice(i, 1)[0].run();
      else i += 1;
    }
  };
  return { fn, nextFrame };
}

const microtasks = () => new Promise((r) => setImmediate(r));

/** El bucle de la web: cada cuadro avanza hasta `speed` ticks mientras haya azar. */
async function loop(
  session: FlappyLiveSession,
  nextFrame: () => void,
  opts: { speed: number; onFrame?: () => void },
) {
  let stalledFrames = 0;
  for (let frame = 0; frame < 200_000; frame++) {
    for (let k = 0; k < opts.speed; k++) {
      if (!session.canStep()) {
        stalledFrames += 1;
        break;
      }
      session.step(flapPolicy(session.engine, session.tick));
    }
    session.pump();
    nextFrame();
    opts.onFrame?.();
    await microtasks();
    if (session.result || session.error) return { stalledFrames };
  }
  throw new Error("el bucle no terminó");
}

test("en tiempo real y con respuestas lentas, cierra con el mismo puntaje que de corrido", async () => {
  for (let n = 1; n <= 20; n++) {
    const arb = referenceArbiter(secretFor(n));
    const t = delayed(arb.commit, 6);
    const session = new FlappyLiveSession(arb.start, t.fn);
    await loop(session, t.nextFrame, { speed: n % 2 ? 1 : 3 });
    assert.equal(session.error, undefined, `secreto ${n}: ${session.error?.message}`);
    assert.deepEqual(session.result, batch(secretFor(n), 1_000_000), `secreto ${n}`);
  }
});

test("nunca avanza sin el azar: si la respuesta tarda, el bucle espera", async () => {
  const arb = referenceArbiter(secretFor(7));
  const t = delayed(arb.commit, 12);
  const session = new FlappyLiveSession(arb.start, t.fn);
  const { stalledFrames } = await loop(session, t.nextFrame, { speed: 3 });
  assert.ok(stalledFrames > 0, "hubo cuadros esperando al árbitro");
  assert.deepEqual(session.result, batch(secretFor(7), 1_000_000));
});

test("si el árbitro pierde compromisos, se resincroniza y termina igual", async () => {
  for (let n = 1; n <= 10; n++) {
    const arb = referenceArbiter(secretFor(n), 3);
    const t = delayed(arb.commit, 4);
    const session = new FlappyLiveSession(arb.start, t.fn);
    await loop(session, t.nextFrame, { speed: 2 });
    assert.deepEqual(session.result, batch(secretFor(n), 1_000_000), `secreto ${n}`);
  }
});

test("un error de red se reintenta pasado retryMs y la partida termina igual", async () => {
  const arb = referenceArbiter(secretFor(9));
  let clock = 0;
  let calls = 0;
  const flaky: FlappyLiveCommitFn = (c) => {
    calls += 1;
    return calls === 2 ? Promise.reject(new Error("network down")) : arb.commit(c);
  };
  const t = delayed(flaky, 2);
  const session = new FlappyLiveSession(arb.start, t.fn, { now: () => clock, retryMs: 1_000 });
  let sawWaiting = false;
  await loop(session, t.nextFrame, {
    speed: 1,
    onFrame: () => {
      clock += 16;
      if (session.waiting) sawWaiting = true;
    },
  });
  assert.ok(calls > 2, "reintentó");
  assert.ok(sawWaiting);
  assert.deepEqual(session.result, batch(secretFor(9), 1_000_000));
});

test("guarda todo lo revelado, en orden: es el comienzo de la fuente del secreto", async () => {
  const arb = referenceArbiter(secretFor(4));
  const t = delayed(arb.commit, 3);
  const session = new FlappyLiveSession(arb.start, t.fn);
  await loop(session, t.nextFrame, { speed: 1 });
  assert.ok(session.reveals.length > 1);
  assert.deepEqual(
    session.reveals,
    new SecretSource(secretFor(4)).slice(0, session.reveals.length),
  );
});

test("si el árbitro no revela lo que el motor necesita, falla con un error claro en vez de colgarse", async () => {
  const arb = referenceArbiter(secretFor(2));
  const t = delayed(async (c) => ({ ...(await arb.commit(c)), reveal: [] }), 1);
  const session = new FlappyLiveSession(arb.start, t.fn);
  await loop(session, t.nextFrame, { speed: 1 });
  assert.match(String(session.error?.message), /live desync/);
  assert.equal(session.result, undefined);
  assert.equal(session.canStep(), false);
});

test("step sin azar disponible tira en vez de inventarlo", () => {
  const arb = referenceArbiter(secretFor(3));
  const session = new FlappyLiveSession(arb.start, arb.commit);
  let t = 0;
  while (session.canStep()) {
    session.step(flapPolicy(session.engine, session.tick));
    t += 1;
    assert.ok(t < 100_000);
  }
  assert.throws(() => session.step(false), /no randomness/);
});

const rejectedWith = (status: number, message: string) =>
  Object.assign(new Error(`arbiter /live/commit ${status}: ${message}`), { status });

test("esperar antes del primer aleteo no suma ticks: arrancar un minuto después no rompe nada", async () => {
  const arb = referenceArbiter(secretFor(8));
  const t = delayed(arb.commit, 2);
  const session = new FlappyLiveSession(arb.start, t.fn);
  for (let i = 0; i < 5_000; i++) session.step(false); // el jugador mira sin tocar
  assert.equal(session.tick, 0, "sin arrancar, el reloj no corre");
  await loop(session, t.nextFrame, { speed: 1 });
  assert.equal(session.error, undefined);
  assert.deepEqual(session.result, batch(secretFor(8), 1_000_000));
});

test("un rechazo del árbitro (4xx) termina la sesión con su motivo, sin reintentar para siempre", async () => {
  const arb = referenceArbiter(secretFor(6));
  let calls = 0;
  const t = delayed(async () => {
    calls += 1;
    throw rejectedWith(400, "bad token");
  }, 1);
  const session = new FlappyLiveSession(arb.start, t.fn);
  await loop(session, t.nextFrame, { speed: 1 });
  assert.match(String(session.error?.message), /bad token/);
  assert.equal(calls, 1, "un rechazo no se reintenta");
});

test("un 429 o un 5xx del árbitro se reintentan y la partida termina igual", async () => {
  const arb = referenceArbiter(secretFor(10));
  let clock = 0;
  let calls = 0;
  const flaky: FlappyLiveCommitFn = (c) => {
    calls += 1;
    if (calls === 2) return Promise.reject(rejectedWith(429, "too many"));
    if (calls === 3) return Promise.reject(rejectedWith(503, "restarting"));
    return arb.commit(c);
  };
  const t = delayed(flaky, 1);
  const session = new FlappyLiveSession(arb.start, t.fn, { now: () => clock, retryMs: 100 });
  await loop(session, t.nextFrame, { speed: 1, onFrame: () => void (clock += 16) });
  assert.equal(session.error, undefined);
  assert.ok(calls > 3);
  assert.deepEqual(session.result, batch(secretFor(10), 1_000_000));
});
