// El protocolo EN VIVO del árbitro con Space Invaders (reglas v2; en producción
// sigue apagado hasta el PR 2): las jugadas viajan como `inputs`, cada bloque
// de 60 ticks se revela LIVE_LEAD_TICKS antes de empezar, los topes de jugadas
// se respetan y el puntaje re-verifica con el secreto publicado.
// Diseño: docs/superpowers/specs/2026-11-18-invaders-en-vivo-design.md
//
// Correr: node --import tsx --test apps/server/test/live-invaders.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { InvadersEngine, INVADERS_LIVE_BLOCK } from "@arcade1v1/game-sdk/invaders";
import { LIVE_LEAD_TICKS, SecretSource, liveSecretHash } from "@arcade1v1/game-sdk/live";
import { playLive, type LiveReply } from "@arcade1v1/game-sdk/live-play";
import { invadersLive, verifyInvadersLive } from "@arcade1v1/game-sdk/invaders-live";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";
import { matchmake, submitScore, getMatch, matchRecord } from "../src/matchmaking.js";
import {
  liveStart,
  liveCommit,
  __clearLiveEnginesForTest,
  type LiveCommitBody,
  type LiveStartView,
} from "../src/live.js";

// Invaders se juega en vivo desde las reglas v2, las vigentes: no hace falta
// prenderlo acá (si alguien lo apagara, la primera prueba lo avisa).
assert.equal(RULES_V.invaders, 2);

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

async function invadersPair() {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake("invaders", 0, p1);
  await matchmake("invaders", 0, p2);
  return { id: m1.matchId, p1, p2 };
}

function opened(s: LiveStartView) {
  assert.equal(s.over, false);
  return s as Extract<LiveStartView, { over: false }>;
}

/** Bloques que empiezan antes de `tick`: no dependen del azar ni del jugador. */
const blocksBefore = (tick: number) =>
  new InvadersEngine(new SecretSource("0".repeat(64))).drawsWithin(tick);

/** Juega el intento entero con el driver y la estrategia de la casa; registra
 *  (to, revealed) de cada compromiso. */
async function playInvaders(id: string, address: string, maxTicks: number) {
  const s = opened(await liveStart(id, address));
  const log: { to: number; revealed: number }[] = [{ to: s.tick, revealed: s.revealed }];
  const def = getStrategy("invaders.hunter")!;
  const step = def.step!(defaultParams(def));
  const result = await playLive(invadersLive, {
    start: s,
    decide: step.decide,
    maxTicks,
    commit: async (c) => {
      const reply = (await liveCommit(id, address, { token: s.token, ...c })) as LiveReply;
      if (!reply.conflict) log.push({ to: reply.tick, revealed: reply.revealed });
      return reply;
    },
  });
  return { ...result, log, token: s.token };
}

test("emparejar Invaders v2 no da semilla: da live y el hash del secreto", async () => {
  const v = await matchmake("invaders", 0, addr());
  await matchmake("invaders", 0, addr()); // sin dejar a nadie esperando en la cola
  assert.equal(v.live, true);
  assert.equal(v.seed, undefined);
  assert.equal(v.rulesV, 2);
  assert.match(String(v.secretHash), /^[0-9a-f]{64}$/);
});

test("abrir revela solo el primer bloque, con el valor del secreto; las jugadas viajan como inputs", async () => {
  const { id, p1 } = await invadersPair();
  const m = matchRecord(id)!;
  const s = opened(await liveStart(id, p1));
  assert.deepEqual([s.tick, s.inputs, s.flaps, s.revealed], [0, [], undefined, 1]);
  assert.deepEqual(s.reveal, new SecretSource(m.liveSecret!).slice(0, 1));
  await assert.rejects(liveStart(id, addr()), /not a player/);
});

test("cada bloque se revela LIVE_LEAD_TICKS antes de empezar", async () => {
  const { id, p1 } = await invadersPair();
  const m = matchRecord(id)!;
  const s = opened(await liveStart(id, p1));
  const before = INVADERS_LIVE_BLOCK - LIVE_LEAD_TICKS;
  const a = await liveCommit(id, p1, { token: s.token, from: 0, to: before, inputs: [], have: 1 });
  assert.deepEqual([a.revealed, a.reveal], [1, []], "el segundo bloque está a 15 ticks");
  const b = await liveCommit(id, p1, {
    token: s.token,
    from: before,
    to: before + 1,
    inputs: [],
    have: 1,
  });
  assert.equal(b.revealed, 2);
  assert.deepEqual(b.reveal, new SecretSource(m.liveSecret!).slice(1, 2));
});

test("ni el secreto ni la semilla aparecen en ninguna respuesta antes de decidir", async () => {
  const { id, p1 } = await invadersPair();
  const m = matchRecord(id)!;
  const seed = String(m.seed);
  const secret = String(m.liveSecret);
  assert.match(secret, /^[0-9a-f]{64}$/, "la partida en vivo nace con su secreto");
  const s = opened(await liveStart(id, p1));
  const c = await liveCommit(id, p1, { token: s.token, from: 0, to: 200, inputs: [], have: 1 });
  for (const out of [s, c, getMatch(id, p1), getMatch(id)]) {
    assert.ok(!JSON.stringify(out).includes(seed), "la semilla se filtró");
    assert.ok(!JSON.stringify(out).includes(secret), "el secreto se filtró");
  }
});

test("un segundo abrir no reinicia: devuelve el progreso con sus jugadas en inputs", async () => {
  const { id, p1 } = await invadersPair();
  const s1 = opened(await liveStart(id, p1));
  const inputs = [
    { t: 0, a: "f1" },
    { t: 3, a: "l1" },
    { t: 20, a: "l0" },
    { t: 20, a: "r1" },
  ];
  await liveCommit(id, p1, { token: s1.token, from: 0, to: 30, inputs, have: 1 });
  const s2 = opened(await liveStart(id, p1));
  assert.deepEqual([s2.tick, s2.inputs], [30, inputs], "retoma, no reinicia");
  assert.notEqual(s2.token, s1.token);
});

test("topes: jugadas de más, desconocidas, fuera del tramo o en flaps se rechazan sin avanzar", async () => {
  const { id, p1 } = await invadersPair();
  const s = opened(await liveStart(id, p1));
  const bad = (body: Partial<LiveCommitBody>) =>
    liveCommit(id, p1, { token: s.token, from: 0, to: 10, inputs: [], have: 1, ...body });
  const at = (t: number, ...acts: string[]) => acts.map((a) => ({ t, a }));
  await assert.rejects(
    bad({ inputs: at(3, "l1", "l0", "r1", "r0", "f1", "f0", "l1") }),
    /invalid inputs/,
  );
  await assert.rejects(bad({ inputs: at(3, "l") }), /invalid inputs/);
  await assert.rejects(bad({ inputs: at(10, "l1") }), /invalid inputs/);
  await assert.rejects(bad({ inputs: [...at(5, "l1"), ...at(4, "r1")] }), /invalid inputs/);
  await assert.rejects(bad({ inputs: undefined, flaps: [0] }), /invalid inputs/);
  // 6 por tick durante 40 ticks son 240 jugadas: el tope a esa altura es 77.
  const flood = Array.from({ length: 40 }, (_, t) =>
    at(t, "l1", "l0", "r1", "r0", "f1", "f0"),
  ).flat();
  await assert.rejects(bad({ to: 40, inputs: flood }), /too many inputs/);
  const ok = await bad({ inputs: at(2, "f1", "l1") });
  assert.equal(ok.tick, 10, "después de los rechazos el intento sigue en 0 y avanza bien");
});

test("jugar en vivo contra el árbitro da el puntaje que verifica el secreto publicado, y liquida al terminar los dos", async () => {
  const { id, p1, p2 } = await invadersPair();
  const a = await playInvaders(id, p1, 36_000);
  const b = await playInvaders(id, p2, 36_000);
  const m = matchRecord(id)!;
  const view = getMatch(id, p1)!;
  assert.ok(view.status === "settled" || view.status === "draw");
  assert.equal(view.secret, m.liveSecret, "decidida: ya se puede ver el secreto");
  assert.equal(liveSecretHash(view.secret!), view.secretHash);
  for (const [player, run] of [
    [p1, a],
    [p2, b],
  ] as const) {
    const replay = m.replays[player.toLowerCase()] as {
      ticks: number;
      inputs: { t: number; a: string }[];
      v: number;
    };
    assert.equal(replay.v, 2);
    assert.ok(run.score > 0, "la estrategia de la casa suma puntos");
    assert.equal(run.score, verifyInvadersLive(view.secret!, replay), "re-verifica con el secreto");
  }
});

test("propiedad central: cada valor revelado es de un bloque que empieza antes de to + LIVE_LEAD_TICKS", async () => {
  for (let i = 0; i < 3; i++) {
    const { id, p1 } = await invadersPair();
    const run = await playInvaders(id, p1, 36_000);
    assert.ok(run.log.length > 10, "varios compromisos");
    for (const { to, revealed } of run.log) {
      assert.ok(
        revealed <= blocksBefore(to + LIVE_LEAD_TICKS),
        `con to=${to} se revelaron ${revealed} valores`,
      );
    }
  }
});

test("cerrar con final a mitad de un bloque cuenta lo alcanzado", async () => {
  const { id, p1 } = await invadersPair();
  const s = opened(await liveStart(id, p1));
  const inputs = [{ t: 0, a: "f1" }];
  const c = await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: 90,
    inputs,
    have: 1,
    final: true,
  });
  assert.equal(c.over, true);
  const replay = matchRecord(id)!.replays[p1] as { ticks: number; inputs: typeof inputs };
  assert.equal(replay.ticks, 90);
  assert.equal(c.score, verifyInvadersLive(matchRecord(id)!.liveSecret!, replay));
});

test("rendirse cierra con 0 con el replay vacío de Invaders; el de Flappy o uno con semilla se rechazan", async () => {
  const { id, p1 } = await invadersPair();
  const s = opened(await liveStart(id, p1));
  await liveCommit(id, p1, { token: s.token, from: 0, to: 30, inputs: [], have: 1 });
  await assert.rejects(submitScore(id, p1, 0, { ticks: 0, flaps: [], v: 2 }), /replay not allowed/);
  await assert.rejects(
    submitScore(id, p1, 5, { seed: 1, ticks: 100, inputs: [], v: 2 }),
    /replay not allowed/,
  );
  await submitScore(id, p1, 0, { ticks: 0, inputs: [], v: 2 });
  const after = await liveCommit(id, p1, { token: s.token, from: 30, to: 40, inputs: [], have: 1 });
  assert.deepEqual([after.over, after.score], [true, 0]);
  assert.deepEqual(matchRecord(id)!.replays[p1], { ticks: 0, inputs: [], v: 2 });
});

test("sin el caché de motores (un reinicio) el intento sigue exactamente igual", async () => {
  const { id, p1 } = await invadersPair();
  const m = matchRecord(id)!;
  const s = opened(await liveStart(id, p1));
  const first = await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: 100,
    inputs: [
      { t: 0, a: "f1" },
      { t: 5, a: "l1" },
    ],
    have: 1,
  });
  assert.equal(first.over, false);
  __clearLiveEnginesForTest();
  const second = await liveCommit(id, p1, {
    token: s.token,
    from: 100,
    to: 110,
    inputs: [],
    have: 0,
  });
  assert.equal(second.conflict, undefined);
  assert.equal(second.tick, 110);
  assert.deepEqual(
    second.reveal,
    new SecretSource(m.liveSecret!).slice(0, second.revealed),
    "el motor reconstruido revela exactamente los mismos valores",
  );
});
