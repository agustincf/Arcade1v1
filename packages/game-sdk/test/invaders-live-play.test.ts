// Space Invaders EN VIVO del lado del jugador: el driver genérico (SDK y agentes
// de la casa) y la sesión de tiempo real (web), contra el árbitro de referencia
// en memoria. Jugar en vivo da lo mismo que jugar de corrido con la misma
// fuente, nada revelado es de un bloque que empiece después de
// to + LIVE_LEAD_TICKS, y los topes recortan del lado del jugador.
// Diseño: docs/superpowers/specs/2026-11-18-invaders-en-vivo-design.md
//
// Correr: node --import tsx --test packages/game-sdk/test/invaders-live-play.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InvadersEngine,
  INVADERS_CONST,
  ALIEN_W,
  type InvaderAction,
} from "@arcade1v1/game-sdk/invaders";
import {
  LIVE_LEAD_TICKS,
  SecretSource,
  isLiveMatch,
  liveActions,
  type LiveDecision,
} from "@arcade1v1/game-sdk/live";
import {
  playLive,
  LiveSession,
  type LiveCommitFn,
  type LiveReply,
} from "@arcade1v1/game-sdk/live-play";
import {
  invadersLive,
  verifyInvadersLive,
  invadersInputBudget,
  INVADERS_MAX_ACTIONS_PER_TICK,
} from "@arcade1v1/game-sdk/invaders-live";
import { liveGameFor } from "@arcade1v1/game-sdk/live-games";
import { secretFor, referenceLiveArbiter, batchLive } from "./live-fixtures";

/** Una política que solo mira el motor: dispara siempre, persigue el OVNI o el
 *  alien más cercano y esquiva la bomba que tiene encima. Manda solo cambios. */
function hunt(g: InvadersEngine): InvaderAction[] {
  let target = g.playerX;
  if (g.ufo) target = g.ufo.x + INVADERS_CONST.UFO_W / 2;
  else {
    let best = Infinity;
    for (const a of g.aliveAliens()) {
      const d = Math.abs(a.x + ALIEN_W / 2 - g.playerX);
      if (d < best) {
        best = d;
        target = a.x + ALIEN_W / 2;
      }
    }
  }
  const threat = g.bombs.find(
    (b) => Math.abs(b.x - g.playerX) < 20 && b.y > INVADERS_CONST.PLAYER_Y - 120,
  );
  if (threat) target = threat.x < g.playerX ? g.playerX + 60 : g.playerX - 60;
  const want = { left: target < g.playerX - 6, right: target > g.playerX + 6, fire: true };
  const out: InvaderAction[] = [];
  if (want.left !== g.held.left) out.push(want.left ? "l1" : "l0");
  if (want.right !== g.held.right) out.push(want.right ? "r1" : "r0");
  if (want.fire !== g.held.fire) out.push(want.fire ? "f1" : "f0");
  return out;
}

/** La política hasta `until`; después suelta todo y la partida termina sola. */
const huntUntil =
  (until: number) =>
  (g: InvadersEngine, t: number): LiveDecision => {
    if (t < until) return hunt(g);
    const out: InvaderAction[] = [];
    if (g.held.left) out.push("l0");
    if (g.held.right) out.push("r0");
    if (g.held.fire) out.push("f0");
    return out;
  };

/** Bloques que empiezan antes de `tick`: no depende del azar ni del jugador. */
const blocksBefore = (tick: number) =>
  new InvadersEngine(new SecretSource(secretFor(0))).drawsWithin(tick);

test("cada juego en vivo tiene su definición: Invaders, desde las reglas v2", () => {
  assert.equal(liveGameFor("invaders"), invadersLive);
  assert.equal(isLiveMatch("invaders", 1), false);
  assert.equal(isLiveMatch("invaders", 2), true);
  assert.deepEqual(invadersLive.actions, ["l1", "l0", "r1", "r0", "f1", "f0"]);
  assert.equal(INVADERS_MAX_ACTIONS_PER_TICK, 6);
  assert.equal(invadersInputBudget(0), 64);
  assert.equal(invadersInputBudget(300), 164);
});

test("jugar en vivo da el mismo puntaje y los mismos ticks que jugar de corrido", async () => {
  for (let n = 1; n <= 12; n++) {
    const arb = referenceLiveArbiter(invadersLive, secretFor(n));
    const live = await playLive(invadersLive, {
      start: arb.start,
      decide: huntUntil(2_500),
      commit: arb.commit,
      maxTicks: 20_000,
    });
    assert.deepEqual(
      live,
      batchLive(invadersLive, secretFor(n), huntUntil(2_500), 20_000),
      `secreto ${n}`,
    );
    assert.equal(
      verifyInvadersLive(secretFor(n), { ticks: live.ticks, inputs: arb.inputs() }),
      live.score,
      `secreto ${n}: el secreto re-verifica el puntaje`,
    );
  }
});

test("si el árbitro pierde compromisos, el driver reenvía desde donde quedó y termina igual", async () => {
  for (let n = 1; n <= 8; n++) {
    const arb = referenceLiveArbiter(invadersLive, secretFor(n), 4);
    const live = await playLive(invadersLive, {
      start: arb.start,
      decide: huntUntil(2_000),
      commit: arb.commit,
      maxTicks: 20_000,
    });
    assert.deepEqual(
      live,
      batchLive(invadersLive, secretFor(n), huntUntil(2_000), 20_000),
      `secreto ${n}`,
    );
  }
});

test("propiedad central: cada valor revelado es de un bloque que empieza antes de to + LIVE_LEAD_TICKS", async () => {
  for (let n = 1; n <= 10; n++) {
    const arb = referenceLiveArbiter(invadersLive, secretFor(n));
    await playLive(invadersLive, {
      start: arb.start,
      decide: huntUntil(3_000),
      commit: arb.commit,
      maxTicks: 20_000,
    });
    assert.ok(arb.log.length > 20, `secreto ${n}: tiene que haber varios compromisos`);
    for (const { to, revealed } of arb.log) {
      assert.ok(
        revealed <= blocksBefore(to + LIVE_LEAD_TICKS),
        `secreto ${n}: con to=${to} se revelaron ${revealed} valores`,
      );
    }
  }
});

test("al llegar a maxTicks vivo, cierra con final y el puntaje alcanzado", async () => {
  const arb = referenceLiveArbiter(invadersLive, secretFor(5));
  const live = await playLive(invadersLive, {
    start: arb.start,
    decide: (g) => hunt(g),
    commit: arb.commit,
    maxTicks: 1_000,
  });
  assert.equal(live.ticks, 1_000);
  assert.equal(
    verifyInvadersLive(secretFor(5), { ticks: live.ticks, inputs: arb.inputs() }),
    live.score,
  );
});

test("topes: 8 acciones por tick se juegan de a 6 y el árbitro no rechaza nada", async () => {
  const arb = referenceLiveArbiter(invadersLive, secretFor(3));
  const spam: InvaderAction[] = ["l1", "l0", "r1", "r0", "f1", "f0", "l1", "l0"];
  const live = await playLive(invadersLive, {
    start: arb.start,
    decide: (g, t) => (t < 10 ? spam : huntUntil(1_500)(g, t)),
    commit: arb.commit,
    maxTicks: 20_000,
  });
  const perTick = new Map<number, number>();
  for (const i of arb.inputs()) perTick.set(i.t, (perTick.get(i.t) ?? 0) + 1);
  assert.equal(Math.max(...perTick.values()), INVADERS_MAX_ACTIONS_PER_TICK);
  assert.ok(arb.inputs().length <= invadersInputBudget(live.ticks));
});

test("topes: apretar y soltar en cada tick se recorta al promedio permitido", async () => {
  const arb = referenceLiveArbiter(invadersLive, secretFor(4));
  const live = await playLive(invadersLive, {
    start: arb.start,
    decide: (g, t) => (t % 2 === 0 ? ["f1"] : ["f0"]),
    commit: arb.commit,
    maxTicks: 1_200,
  });
  assert.ok(arb.inputs().length <= invadersInputBudget(live.ticks));
  assert.ok(arb.inputs().length >= invadersInputBudget(live.ticks) - 3, "el tope se usa entero");
});

test("liveActions: Invaders no tiene una acción única (true tira) ni acepta acciones desconocidas", () => {
  assert.deepEqual(liveActions(invadersLive, ["l1", "f1"]), ["l1", "f1"]);
  assert.throws(() => liveActions(invadersLive, true), /invaders/);
  assert.throws(() => liveActions(invadersLive, "x"), /unknown action/);
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

test("sesión: en tiempo real y con respuestas lentas, cierra con el mismo puntaje que de corrido", async () => {
  for (let n = 1; n <= 4; n++) {
    const arb = referenceLiveArbiter(invadersLive, secretFor(n));
    const t = delayed(arb.commit, 6);
    const session = new LiveSession(invadersLive, arb.start, t.fn);
    let stalled = 0;
    for (let frame = 0; frame < 100_000 && !session.result && !session.error; frame++) {
      if (session.canStep()) {
        session.step(liveActions(invadersLive, huntUntil(2_000)(session.engine, session.tick)));
      } else if (!session.engine.over) stalled += 1; // terminada, espera el cierre
      session.pump();
      t.nextFrame();
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(session.error, undefined, `secreto ${n}`);
    assert.equal(stalled, 0, `secreto ${n}: con 6 cuadros de demora el bloque llega a tiempo`);
    assert.deepEqual(
      session.result,
      batchLive(invadersLive, secretFor(n), huntUntil(2_000), 1_000_000),
      `secreto ${n}`,
    );
  }
});
