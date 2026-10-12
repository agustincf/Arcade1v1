// El protocolo EN VIVO del árbitro con Carrera (reglas v3; en producción sigue
// apagado hasta el PR 2): las jugadas viajan como `inputs`, cada fila se revela
// LIVE_LEAD_TICKS antes de nacer, los topes de jugadas se respetan y el puntaje
// re-verifica con el secreto publicado.
// Diseño: docs/superpowers/specs/2026-10-10-carrera-en-vivo-design.md
//
// Correr: node --import tsx --test apps/server/test/live-racing.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { RacingEngine } from "@arcade1v1/game-sdk/racing";
import { LIVE_LEAD_TICKS, SecretSource, liveSecretHash } from "@arcade1v1/game-sdk/live";
import { playLive, type LiveReply } from "@arcade1v1/game-sdk/live-play";
import { racingLive, verifyRacingLive } from "@arcade1v1/game-sdk/racing-live";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";
import { matchmake, submitScore, getMatch, matchRecord } from "../src/matchmaking.js";
import {
  liveStart,
  liveCommit,
  __clearLiveEnginesForTest,
  type LiveCommitBody,
  type LiveStartView,
} from "../src/live.js";

RULES_V.racing = 3;

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

async function racingPair() {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake("racing", 0, p1);
  await matchmake("racing", 0, p2);
  return { id: m1.matchId, p1, p2 };
}

function opened(s: LiveStartView) {
  assert.equal(s.over, false);
  return s as Extract<LiveStartView, { over: false }>;
}

/** Filas que nacen antes de `tick`: el reloj de filas no depende del azar ni
 *  del auto, así que lo da un motor recién creado con cualquier semilla. */
const rowsBefore = (tick: number) => new RacingEngine(0).drawsWithin(tick);
let FIRST_ROW = 0;
while (rowsBefore(FIRST_ROW + 1) === 0) FIRST_ROW += 1;

/** Juega el intento entero con el driver y la estrategia de la casa; registra
 *  (to, revealed) de cada compromiso. */
async function playRace(id: string, address: string, maxTicks: number) {
  const s = opened(await liveStart(id, address));
  const log: { to: number; revealed: number }[] = [{ to: s.tick, revealed: s.revealed }];
  const def = getStrategy("racing.dodger")!;
  const step = def.step!(defaultParams(def));
  const result = await playLive(racingLive, {
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

test("emparejar Carrera v3 no da semilla: da live y el hash del secreto", async () => {
  const v = await matchmake("racing", 0, addr());
  await matchmake("racing", 0, addr()); // sin dejar a nadie esperando en la cola
  assert.equal(v.live, true);
  assert.equal(v.seed, undefined);
  assert.equal(v.rulesV, 3);
  assert.match(String(v.secretHash), /^[0-9a-f]{64}$/);
});

test("abrir: nada revelado hasta que la primera fila esté cerca; las jugadas viajan como inputs", async () => {
  const { id, p1 } = await racingPair();
  const s = opened(await liveStart(id, p1));
  assert.deepEqual([s.tick, s.inputs, s.flaps, s.revealed, s.reveal], [0, [], undefined, 0, []]);
  await assert.rejects(liveStart(id, addr()), /not a player/);
});

test("cada fila se revela LIVE_LEAD_TICKS antes de nacer, con el valor del secreto", async () => {
  const { id, p1 } = await racingPair();
  const m = matchRecord(id)!;
  const s = opened(await liveStart(id, p1));
  const before = FIRST_ROW - LIVE_LEAD_TICKS;
  const a = await liveCommit(id, p1, { token: s.token, from: 0, to: before, inputs: [], have: 0 });
  assert.equal(a.revealed, 0, "la primera fila todavía está a más de 15 ticks");
  const b = await liveCommit(id, p1, {
    token: s.token,
    from: before,
    to: before + 1,
    inputs: [],
    have: 0,
  });
  assert.equal(b.revealed, 1);
  assert.deepEqual(b.reveal, new SecretSource(m.liveSecret!).slice(0, 1));
});

test("ni el secreto ni la semilla aparecen en ninguna respuesta antes de decidir", async () => {
  const { id, p1 } = await racingPair();
  const m = matchRecord(id)!;
  const seed = String(m.seed);
  const secret = String(m.liveSecret);
  assert.match(secret, /^[0-9a-f]{64}$/, "la partida en vivo nace con su secreto");
  const s = opened(await liveStart(id, p1));
  const c = await liveCommit(id, p1, { token: s.token, from: 0, to: 90, inputs: [], have: 0 });
  for (const out of [s, c, getMatch(id, p1), getMatch(id)]) {
    assert.ok(!JSON.stringify(out).includes(seed), "la semilla se filtró");
    assert.ok(!JSON.stringify(out).includes(secret), "el secreto se filtró");
  }
});

test("un segundo abrir no reinicia: devuelve el progreso con sus jugadas en inputs", async () => {
  const { id, p1 } = await racingPair();
  const s1 = opened(await liveStart(id, p1));
  const inputs = [
    { t: 3, a: "l" },
    { t: 20, a: "r" },
    { t: 20, a: "j" },
  ];
  await liveCommit(id, p1, { token: s1.token, from: 0, to: 30, inputs, have: 0 });
  const s2 = opened(await liveStart(id, p1));
  assert.deepEqual([s2.tick, s2.inputs], [30, inputs], "retoma, no reinicia");
  assert.notEqual(s2.token, s1.token);
});

test("topes: jugadas de más, desconocidas, fuera del tramo o en flaps se rechazan sin avanzar", async () => {
  const { id, p1 } = await racingPair();
  const s = opened(await liveStart(id, p1));
  const bad = (body: Partial<LiveCommitBody>) =>
    liveCommit(id, p1, { token: s.token, from: 0, to: 10, inputs: [], have: 0, ...body });
  const at = (t: number, ...acts: string[]) => acts.map((a) => ({ t, a }));
  await assert.rejects(bad({ inputs: at(3, "l", "r", "l", "r") }), /invalid inputs/);
  await assert.rejects(bad({ inputs: at(3, "x") }), /invalid inputs/);
  await assert.rejects(bad({ inputs: at(10, "l") }), /invalid inputs/);
  await assert.rejects(bad({ inputs: [...at(5, "l"), ...at(4, "r")] }), /invalid inputs/);
  await assert.rejects(bad({ inputs: at(1.5, "l") }), /invalid inputs/);
  await assert.rejects(bad({ inputs: undefined, flaps: [0] }), /invalid inputs/);
  // 3 por tick durante 40 ticks son 120 jugadas: el tope a esa altura es 74.
  const flood = Array.from({ length: 40 }, (_, t) => at(t, "l", "r", "j")).flat();
  await assert.rejects(bad({ to: 40, inputs: flood }), /too many inputs/);
  const ok = await bad({ inputs: at(2, "l", "j") });
  assert.equal(ok.tick, 10, "después de los rechazos el intento sigue en 0 y avanza bien");
});

test("jugar en vivo contra el árbitro da el puntaje que verifica el secreto publicado, y liquida al terminar los dos", async () => {
  const { id, p1, p2 } = await racingPair();
  const a = await playRace(id, p1, 3_000);
  const b = await playRace(id, p2, 3_000);
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
    assert.equal(replay.v, 3);
    assert.equal(run.score, verifyRacingLive(view.secret!, replay), "re-verifica con el secreto");
  }
});

test("propiedad central: cada valor revelado es de una fila que nace antes de to + LIVE_LEAD_TICKS", async () => {
  for (let i = 0; i < 4; i++) {
    const { id, p1 } = await racingPair();
    const run = await playRace(id, p1, 3_000);
    assert.ok(run.log.length > 5, "varios compromisos");
    for (const { to, revealed } of run.log) {
      assert.ok(
        revealed <= rowsBefore(to + LIVE_LEAD_TICKS),
        `con to=${to} se revelaron ${revealed} valores`,
      );
    }
  }
});

test("rendirse cierra con 0 con el replay vacío de Carrera; el de Flappy o uno con semilla se rechazan", async () => {
  const { id, p1 } = await racingPair();
  const s = opened(await liveStart(id, p1));
  await liveCommit(id, p1, { token: s.token, from: 0, to: 30, inputs: [], have: 0 });
  await assert.rejects(submitScore(id, p1, 0, { ticks: 0, flaps: [], v: 3 }), /replay not allowed/);
  await assert.rejects(
    submitScore(id, p1, 5, { seed: 1, ticks: 100, inputs: [], v: 3 }),
    /replay not allowed/,
  );
  await submitScore(id, p1, 0, { ticks: 0, inputs: [], v: 3 });
  const after = await liveCommit(id, p1, { token: s.token, from: 30, to: 40, inputs: [], have: 0 });
  assert.deepEqual([after.over, after.score], [true, 0]);
  assert.deepEqual(matchRecord(id)!.replays[p1], { ticks: 0, inputs: [], v: 3 });
});

test("sin el caché de motores (un reinicio) el intento sigue exactamente igual", async () => {
  const { id, p1 } = await racingPair();
  const m = matchRecord(id)!;
  const s = opened(await liveStart(id, p1));
  const first = await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: FIRST_ROW,
    inputs: [{ t: 5, a: "l" }],
    have: 0,
  });
  assert.equal(first.over, false);
  __clearLiveEnginesForTest();
  const second = await liveCommit(id, p1, {
    token: s.token,
    from: FIRST_ROW,
    to: FIRST_ROW + 1,
    inputs: [],
    have: 0,
  });
  assert.equal(second.conflict, undefined);
  assert.equal(second.tick, FIRST_ROW + 1);
  assert.deepEqual(
    second.reveal,
    new SecretSource(m.liveSecret!).slice(0, second.revealed),
    "el motor reconstruido revela exactamente los mismos valores",
  );
});
