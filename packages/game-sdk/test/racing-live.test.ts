// Carrera EN VIVO (reglas v3): con una fuente de azar, cada fila de obstáculos
// sale de UN valor, así que cuánto azar consume el juego en los próximos ticks
// se sabe sin conocerlo (`drawsWithin`). Con semilla, el motor sigue dando
// exactamente lo mismo que en v2.
// Diseño: docs/superpowers/specs/2026-10-10-carrera-en-vivo-design.md
//
// Correr: node --import tsx --test packages/game-sdk/test/racing-live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  RacingEngine,
  RACING_DT,
  RACING_CONST,
  LANES,
  type RaceAction,
} from "@arcade1v1/game-sdk/racing";
import {
  BufferedRandom,
  NeedsReveal,
  SecretSource,
  LIVE_LEAD_TICKS,
  type RandomSource,
} from "@arcade1v1/game-sdk/live";
import { secretFor } from "./live-fixtures";
import { oracleStep } from "./racing-oracle";

const CAR_Y = RACING_CONST.HEIGHT - 80;

/** La política de la foto de caracterización: esquiva lo que tiene cerca. */
function dodge(g: RacingEngine): RaceAction | null {
  const danger = (lane: number) =>
    g.obstacles.some(
      (o) => o.lane === lane && o.y > CAR_Y - 170 && o.y < CAR_Y + RACING_CONST.CAR_H,
    );
  if (!danger(g.carLane)) return null;
  for (const l of [g.carLane - 1, g.carLane + 1]) {
    if (l >= 0 && l < LANES && !danger(l)) return l < g.carLane ? "l" : "r";
  }
  const b = g.obstacles.find(
    (o) => o.lane === g.carLane && o.jumpable && CAR_Y - o.y < 120 && CAR_Y - o.y > 0,
  );
  return b ? "j" : null;
}

function apply(g: RacingEngine, a: RaceAction) {
  if (a === "l") g.moveLeft();
  else if (a === "r") g.moveRight();
  else g.jump();
}

/** Una partida con semilla, fotografiada cada 250 ticks. */
function trace(seed: number): string {
  const g = new RacingEngine(seed);
  const snaps: unknown[] = [];
  for (let t = 0; t < 6000 && !g.over; t++) {
    const a = dodge(g);
    if (a) apply(g, a);
    g.update(RACING_DT);
    if (t % 250 === 0) {
      snaps.push([
        t,
        g.score,
        g.carLane,
        g.obstacles.map((o) => [o.lane, o.y, o.kind, o.jumpable]),
        g.coins.map((c) => [c.lane, c.y, c.taken]),
      ]);
    }
  }
  snaps.push([g.score, g.over, g.elapsedMs]);
  return JSON.stringify(snaps);
}

/** Una fuente que cuenta cuántos valores entregó. */
class Counting implements RandomSource {
  count = 0;
  constructor(private readonly inner: RandomSource) {}
  next(): number {
    this.count += 1;
    return this.inner.next();
  }
}

/** ¿Nació una fila en el último tick? Una fila nueva queda en y = -OBST_H. */
const rowBorn = (g: RacingEngine) => g.obstacles.some((o) => o.y === -RACING_CONST.OBST_H);

test("caracterización: con semilla el motor da exactamente lo mismo que en v2", () => {
  const h = createHash("sha256");
  for (let seed = 1; seed <= 50; seed++) h.update(trace(seed));
  assert.equal(h.digest("hex"), "d62153c4531372e7a791dd5d9c969bac0dc4a5c56ed0fffb940c8c62773074f9");
});

test("en vivo, cada fila consume exactamente un valor de la fuente", () => {
  for (let n = 1; n <= 20; n++) {
    const src = new Counting(new SecretSource(secretFor(n)));
    const g = new RacingEngine(src);
    let rows = 0;
    for (let t = 0; t < 3600 && !g.over; t++) {
      oracleStep(g);
      g.update(RACING_DT);
      if (rowBorn(g)) rows += 1;
    }
    assert.ok(rows > 20, `secreto ${n}: la partida tiene que llegar a varias filas`);
    assert.equal(src.count, rows, `secreto ${n}`);
  }
});

test("drawsWithin predice exacto cuántos valores consume el juego en los próximos ticks", () => {
  for (let n = 1; n <= 30; n++) {
    const src = new Counting(new SecretSource(secretFor(n)));
    const g = new RacingEngine(src);
    const predicted: { t: number; ticks: number; draws: number }[] = [];
    const consumedAt: number[] = []; // consumo acumulado al empezar cada tick
    for (let t = 0; t < 2400 && !g.over; t++) {
      consumedAt.push(src.count);
      for (const ticks of [1, LIVE_LEAD_TICKS, 200]) {
        predicted.push({ t, ticks, draws: g.drawsWithin(ticks) });
      }
      oracleStep(g);
      g.update(RACING_DT);
    }
    const played = consumedAt.length;
    consumedAt.push(src.count);
    for (const p of predicted) {
      // Lo que nace en el tick del choque se consume igual; después, nada.
      if (p.t + p.ticks > played) continue;
      assert.equal(
        consumedAt[p.t + p.ticks] - consumedAt[p.t],
        p.draws,
        `secreto ${n}, t=${p.t}, ${p.ticks} ticks`,
      );
    }
  }
});

test("drawsWithin no toca el motor, y con la partida terminada da 0", () => {
  const g = new RacingEngine(new SecretSource(secretFor(7)));
  for (let t = 0; t < 200; t++) {
    oracleStep(g);
    g.update(RACING_DT);
  }
  const before = JSON.stringify(g);
  assert.ok(g.drawsWithin(600) > 0);
  assert.equal(JSON.stringify(g), before);
  // Sin manejar, el auto choca enseguida.
  for (let i = 0; i < 100_000 && !g.over; i++) g.update(RACING_DT);
  assert.equal(g.over, true);
  assert.equal(g.drawsWithin(600), 0);
});

test("en vivo alcanza con un valor por fila: revelando lo justo se juega igual que con el secreto", () => {
  const secret = secretFor(11);
  const full = new RacingEngine(new SecretSource(secret));
  const reveal = new SecretSource(secret);
  const buf = new BufferedRandom();
  const live = new RacingEngine(buf);
  for (let t = 0; t < 3000 && !full.over; t++) {
    const need = live.drawsWithin(1) - buf.available;
    if (need > 0) buf.push(reveal.slice(buf.received, buf.received + need));
    oracleStep(full);
    oracleStep(live);
    full.update(RACING_DT);
    live.update(RACING_DT);
    assert.equal(live.over, full.over, `t=${t}`);
  }
  assert.equal(live.score, full.score);
  assert.deepEqual(live.obstacles, full.obstacles);
  assert.deepEqual(live.coins, full.coins);
});

test("sin el valor de una fila, el motor avisa cuál falta en vez de inventarlo", () => {
  const g = new RacingEngine(new BufferedRandom());
  // Los ticks sin fila no piden azar; la primera fila pide el suyo.
  let t = 0;
  while (g.drawsWithin(1) === 0) {
    g.update(RACING_DT);
    t += 1;
  }
  assert.ok(t > 30, "la primera fila nace pasado el primer segundo");
  assert.throws(() => g.update(RACING_DT), NeedsReveal);
});

test("en vivo las filas siguen las mismas reglas: siempre hay salida y el oráculo sobrevive", () => {
  for (let n = 1; n <= 60; n++) {
    const src = new Counting(new SecretSource(secretFor(n)));
    const g = new RacingEngine(src);
    let t = 0;
    let rows = 0;
    for (; t < 3600 && !g.over; t++) {
      oracleStep(g);
      g.update(RACING_DT);
      const born = g.obstacles.filter((o) => o.y === -RACING_CONST.OBST_H);
      if (born.length) {
        rows += 1;
        const solid = new Set(born.filter((o) => !o.jumpable).map((o) => o.lane));
        assert.ok(solid.size < LANES, `secreto ${n}, t=${t}: fila sin salida`);
      }
    }
    assert.ok(t >= 15 * 60, `secreto ${n}: el oráculo chocó a los ${(t / 60).toFixed(1)} s`);
    assert.equal(src.count, rows, `secreto ${n}: las filas salen de la fuente, una por valor`);
  }
});
