// Carrera EN VIVO del lado del jugador: el driver genérico (SDK y agentes de la
// casa) y la sesión de tiempo real (web), contra un árbitro de referencia en
// memoria con las reglas de apps/server/src/live.ts. Jugar en vivo da lo mismo
// que jugar de corrido con la misma fuente, nada revelado nace más de
// LIVE_LEAD_TICKS después de lo comprometido, y los topes de jugadas recortan
// del lado del jugador, así un cliente honesto nunca recibe un rechazo.
//
// Correr: node --import tsx --test packages/game-sdk/test/racing-live-play.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { RacingEngine } from "@arcade1v1/game-sdk/racing";
import { LIVE_LEAD_TICKS, liveActions, type LiveDecision } from "@arcade1v1/game-sdk/live";
import {
  playLive,
  LiveSession,
  type LiveCommitFn,
  type LiveReply,
} from "@arcade1v1/game-sdk/live-play";
import {
  racingLive,
  verifyRacingLive,
  racingInputBudget,
  RACING_MAX_ACTIONS_PER_TICK,
} from "@arcade1v1/game-sdk/racing-live";
import { liveGameFor } from "@arcade1v1/game-sdk/live-games";
import { flappyLive } from "@arcade1v1/game-sdk/flappy-live";
import { secretFor, referenceLiveArbiter, batchLive } from "./live-fixtures";
import { oracleAction } from "./racing-oracle";

const oracle = (g: RacingEngine): LiveDecision => oracleAction(g);
/** El oráculo hasta `until`, y después suelta el volante: la partida termina. */
const oracleUntil =
  (until: number) =>
  (g: RacingEngine, t: number): LiveDecision =>
    t < until ? oracleAction(g) : null;

/** Filas que nacen antes de `tick`: el reloj de filas no depende del azar ni
 *  del auto, así que lo da un motor recién creado con cualquier semilla. */
const rowsBefore = (tick: number) => new RacingEngine(0).drawsWithin(tick);

test("jugar en vivo da el mismo puntaje y los mismos ticks que jugar de corrido", async () => {
  for (let n = 1; n <= 30; n++) {
    const arb = referenceLiveArbiter(racingLive, secretFor(n));
    const live = await playLive(racingLive, {
      start: arb.start,
      decide: oracleUntil(2_000),
      commit: arb.commit,
      maxTicks: 3_600,
    });
    assert.deepEqual(
      live,
      batchLive(racingLive, secretFor(n), oracleUntil(2_000), 3_600),
      `secreto ${n}`,
    );
  }
});

test("si el árbitro pierde compromisos, el driver reenvía desde donde quedó y termina igual", async () => {
  for (let n = 1; n <= 15; n++) {
    const arb = referenceLiveArbiter(racingLive, secretFor(n), 4);
    const live = await playLive(racingLive, {
      start: arb.start,
      decide: oracle,
      commit: arb.commit,
      maxTicks: 2_400,
    });
    assert.deepEqual(live, batchLive(racingLive, secretFor(n), oracle, 2_400), `secreto ${n}`);
  }
});

test("propiedad central: cada valor revelado es de una fila que nace antes de to + LIVE_LEAD_TICKS", async () => {
  for (let n = 1; n <= 20; n++) {
    const arb = referenceLiveArbiter(racingLive, secretFor(n));
    await playLive(racingLive, {
      start: arb.start,
      decide: oracle,
      commit: arb.commit,
      maxTicks: 3_600,
    });
    assert.ok(arb.log.length > 10, `secreto ${n}: tiene que haber varios compromisos`);
    for (const { to, revealed } of arb.log) {
      assert.ok(
        revealed <= rowsBefore(to + LIVE_LEAD_TICKS),
        `secreto ${n}: con to=${to} se revelaron ${revealed} valores`,
      );
    }
  }
});

test("al llegar a maxTicks vivo, cierra con final y el puntaje alcanzado; el secreto lo re-verifica", async () => {
  const arb = referenceLiveArbiter(racingLive, secretFor(5));
  const live = await playLive(racingLive, {
    start: arb.start,
    decide: oracle,
    commit: arb.commit,
    maxTicks: 1_800,
  });
  assert.equal(live.ticks, 1_800);
  assert.equal(
    verifyRacingLive(secretFor(5), { ticks: live.ticks, inputs: arb.inputs() }),
    live.score,
  );
});

test("decide puede ser asíncrono (un cerebro que piensa) y da lo mismo", async () => {
  const arb = referenceLiveArbiter(racingLive, secretFor(9));
  const live = await playLive(racingLive, {
    start: arb.start,
    decide: async (g, t) => {
      await new Promise((r) => setImmediate(r));
      return oracleUntil(900)(g, t);
    },
    commit: arb.commit,
    maxTicks: 3_600,
  });
  assert.deepEqual(live, batchLive(racingLive, secretFor(9), oracleUntil(900), 3_600));
});

test("topes: 10 acciones por tick se juegan de a 3 y el árbitro no rechaza nada", async () => {
  const arb = referenceLiveArbiter(racingLive, secretFor(3));
  const spam = ["l", "r", "l", "r", "l", "r", "l", "r", "l", "r"];
  const live = await playLive(racingLive, {
    start: arb.start,
    decide: (g, t) => (t < 300 ? spam : oracleAction(g)),
    commit: arb.commit,
    maxTicks: 1_200,
  });
  const perTick = new Map<number, number>();
  for (const i of arb.inputs()) perTick.set(i.t, (perTick.get(i.t) ?? 0) + 1);
  assert.equal(Math.max(...perTick.values()), RACING_MAX_ACTIONS_PER_TICK);
  assert.ok(arb.inputs().length <= racingInputBudget(live.ticks));
});

test("topes: una acción por tick para siempre se recorta al promedio permitido", async () => {
  const arb = referenceLiveArbiter(racingLive, secretFor(4));
  const live = await playLive(racingLive, {
    start: arb.start,
    // Saltar en cada tick: casi siempre no hace nada, pero cuenta como jugada.
    decide: (g, t) => (t % 2 === 0 ? "j" : oracleAction(g)),
    commit: arb.commit,
    maxTicks: 2_400,
  });
  assert.ok(arb.inputs().length <= racingInputBudget(live.ticks));
  assert.ok(arb.inputs().length >= racingInputBudget(live.ticks) - 3, "el tope se usa entero");
});

test("liveActions: Carrera no tiene una acción única (true tira) y no acepta acciones desconocidas", () => {
  assert.deepEqual(liveActions(racingLive, null), []);
  assert.deepEqual(liveActions(racingLive, "l"), ["l"]);
  assert.deepEqual(liveActions(racingLive, ["l", "j"]), ["l", "j"]);
  assert.throws(() => liveActions(racingLive, true), /racing/);
  assert.throws(() => liveActions(racingLive, "x"), /unknown action/);
  assert.deepEqual(liveActions(flappyLive, true), ["f"]);
  assert.deepEqual(liveActions(flappyLive, false), []);
});

test("cada juego en vivo tiene su definición; los que no se juegan en vivo, no", () => {
  assert.equal(liveGameFor("racing"), racingLive);
  assert.equal(liveGameFor("flappy"), flappyLive);
  assert.equal(liveGameFor("2048"), undefined);
});

// ---- La sesión de tiempo real (la web) --------------------------------------

/** Un transporte cuyas respuestas llegan `delay` cuadros después. */
function delayed(commit: LiveCommitFn, delay: number) {
  const queue: { due: number; run: () => void }[] = [];
  let frame = 0;
  const fn: LiveCommitFn = (c) =>
    new Promise<LiveReply>((resolve, reject) => {
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
  session: LiveSession<RacingEngine>,
  decide: (g: RacingEngine, t: number) => LiveDecision,
  nextFrame: () => void,
  speed: number,
) {
  let stalledFrames = 0;
  for (let frame = 0; frame < 200_000; frame++) {
    for (let k = 0; k < speed; k++) {
      if (!session.canStep()) {
        stalledFrames += 1;
        break;
      }
      session.step(liveActions(racingLive, decide(session.engine, session.tick)));
    }
    session.pump();
    nextFrame();
    await microtasks();
    if (session.result || session.error) return { stalledFrames };
  }
  throw new Error("el bucle no terminó");
}

test("sesión: en tiempo real y con respuestas lentas, cierra con el mismo puntaje que de corrido", async () => {
  for (let n = 1; n <= 8; n++) {
    const arb = referenceLiveArbiter(racingLive, secretFor(n));
    const t = delayed(arb.commit, 4);
    const session = new LiveSession(racingLive, arb.start, t.fn);
    await loop(session, oracleUntil(1_500), t.nextFrame, 2);
    assert.equal(session.error, undefined, `secreto ${n}`);
    const batch = batchLive(racingLive, secretFor(n), oracleUntil(1_500), 1_000_000);
    assert.deepEqual(session.result, batch, `secreto ${n}`);
  }
});

test("sesión: nunca avanza sin el azar; si la respuesta tarda, el bucle espera", async () => {
  const arb = referenceLiveArbiter(racingLive, secretFor(2));
  const t = delayed(arb.commit, 40);
  const session = new LiveSession(racingLive, arb.start, t.fn);
  const { stalledFrames } = await loop(session, oracleUntil(800), t.nextFrame, 3);
  assert.ok(stalledFrames > 0, "con 40 cuadros de demora el bucle tiene que esperar");
  assert.deepEqual(
    session.result,
    batchLive(racingLive, secretFor(2), oracleUntil(800), 1_000_000),
  );
});

test("sesión: las teclas de más se recortan antes de jugar y el árbitro no rechaza", async () => {
  const arb = referenceLiveArbiter(racingLive, secretFor(6));
  const t = delayed(arb.commit, 2);
  const session = new LiveSession(racingLive, arb.start, t.fn);
  const mash = (g: RacingEngine, tick: number): LiveDecision =>
    tick < 200 ? ["l", "l", "r", "r", "j", "j"] : oracleUntil(700)(g, tick);
  await loop(session, mash, t.nextFrame, 2);
  assert.equal(session.error, undefined);
  assert.ok(session.result);
  assert.ok(arb.inputs().length <= racingInputBudget(session.result!.ticks));
});

test("sesión: guarda todo lo revelado, en orden: es el comienzo de la fuente del secreto", async () => {
  const arb = referenceLiveArbiter(racingLive, secretFor(8));
  const t = delayed(arb.commit, 1);
  const session = new LiveSession(racingLive, arb.start, t.fn);
  await loop(session, oracleUntil(600), t.nextFrame, 2);
  const { SecretSource } = await import("@arcade1v1/game-sdk/live");
  const expected = new SecretSource(secretFor(8)).slice(0, session.reveals.length);
  assert.ok(session.reveals.length > 5);
  assert.deepEqual(session.reveals, expected);
});
