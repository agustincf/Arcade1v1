// Space Invaders EN VIVO (reglas v2): con una fuente de azar, cada bloque de
// INVADERS_LIVE_BLOCK ticks sale de UN valor, y cada tick saca del bloque
// siempre 4 sub-valores (bomba, columna, OVNI, sentido), se usen o no. Así
// cuánto azar consume el juego en los próximos ticks se sabe sin conocerlo
// (`drawsWithin`). Con semilla, el motor sigue dando exactamente lo mismo que en
// v1.
// Diseño: docs/superpowers/specs/2026-11-18-invaders-en-vivo-design.md
//
// Correr: node --import tsx --test packages/game-sdk/test/invaders-live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  InvadersEngine,
  INVADERS_CONST,
  INVADERS_LIVE_BLOCK,
  ALIEN_W,
  type InvaderAction,
} from "@arcade1v1/game-sdk/invaders";
import {
  BufferedRandom,
  NeedsReveal,
  SecretSource,
  LIVE_LEAD_TICKS,
} from "@arcade1v1/game-sdk/live";
import { secretFor } from "./live-fixtures";

/** La política de la foto de caracterización: dispara siempre y cada 30 ticks
 *  se mueve hacia el alien más cercano (o el OVNI). Solo manda cambios. */
function chase(g: InvadersEngine, t: number, keys: { l: boolean; r: boolean }): InvaderAction[] {
  const out: InvaderAction[] = [];
  if (t === 0) out.push("f1");
  if (t % 30 !== 0) return out;
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
  const wantL = target < g.playerX - 6;
  const wantR = target > g.playerX + 6;
  if (wantL !== keys.l) out.push(wantL ? "l1" : "l0");
  if (wantR !== keys.r) out.push(wantR ? "r1" : "r0");
  keys.l = wantL;
  keys.r = wantR;
  return out;
}

/** Una partida con semilla, fotografiada cada 250 ticks. */
function trace(seed: number): string {
  const g = new InvadersEngine(seed);
  const keys = { l: false, r: false };
  const snaps: unknown[] = [];
  for (let t = 0; t < 6000 && !g.over; t++) {
    for (const a of chase(g, t, keys)) g.apply(a);
    g.tick();
    if (t % 250 === 0) {
      snaps.push([
        t,
        g.score,
        g.lives,
        g.wave,
        g.playerX,
        g.offsetX,
        g.offsetY,
        g.bombs.map((b) => [b.x, b.y]),
        g.bullets.length,
        g.ufo ? [g.ufo.x, g.ufo.dir] : null,
        g.aliveAliens().length,
        g.shields.length,
      ]);
    }
  }
  snaps.push(["end", g.score, g.lives, g.wave, g.over]);
  return JSON.stringify(snaps);
}

test("caracterización: con semilla, el motor da exactamente lo mismo que en v1", () => {
  const h = createHash("sha256");
  for (let seed = 1; seed <= 12; seed++) h.update(trace(seed));
  assert.equal(h.digest("hex"), "b5c3be5890822108852a59f3de141f2dfbf5e7c7cce59a666b6854da1e68054e");
});

/** Un motor en vivo con la fuente completa del secreto `n`. */
function liveEngine(n: number) {
  const src = new SecretSource(secretFor(n));
  return { src, g: new InvadersEngine(src) };
}

test("en vivo, cada bloque de 60 ticks sale de un solo valor", () => {
  assert.equal(INVADERS_LIVE_BLOCK, 60);
  const buf = new BufferedRandom();
  buf.push(new SecretSource(secretFor(7)).slice(0, 3));
  const g = new InvadersEngine(buf);
  for (let t = 0; t < 3 * INVADERS_LIVE_BLOCK; t++) g.tick();
  assert.equal(g.tickCount, 180);
  assert.equal(buf.available, 0);
  assert.throws(() => g.tick(), NeedsReveal);
});

test("drawsWithin cuenta los bloques que empiezan en la ventana", () => {
  const { g } = liveEngine(1);
  assert.equal(g.drawsWithin(0), 0);
  assert.equal(g.drawsWithin(1), 1);
  assert.equal(g.drawsWithin(LIVE_LEAD_TICKS), 1);
  assert.equal(g.drawsWithin(60), 1);
  assert.equal(g.drawsWithin(61), 2);
  g.tick();
  assert.equal(g.drawsWithin(59), 0);
  assert.equal(g.drawsWithin(60), 1);
  assert.equal(g.drawsWithin(120), 2);
});

test("drawsWithin es exacto mientras se juega y no toca el motor", () => {
  for (let n = 1; n <= 5; n++) {
    const { src, g } = liveEngine(n);
    const keys = { l: false, r: false };
    for (let t = 0; t < 20_000 && !g.over; t++) {
      const before = src.consumed;
      const snap = JSON.stringify([g.tickCount, g.score, g.bombs, g.ufo, src.consumed]);
      const d1 = g.drawsWithin(1);
      g.drawsWithin(LIVE_LEAD_TICKS);
      assert.equal(JSON.stringify([g.tickCount, g.score, g.bombs, g.ufo, src.consumed]), snap);
      for (const a of chase(g, t, keys)) g.apply(a);
      g.tick();
      assert.equal(src.consumed - before, d1, `secreto ${n}, tick ${t}`);
    }
    assert.ok(g.over, "la partida termina");
    assert.equal(g.drawsWithin(LIVE_LEAD_TICKS), 0, "terminada no consume nada");
  }
});

test("una oleada despejada consume igual sus sub-valores: el OVNI no se corre", () => {
  // Un secreto cuyo primer OVNI sale dentro del primer bloque, sin jugadas.
  const ufoTick = (g: InvadersEngine) => {
    for (let t = 0; t < INVADERS_LIVE_BLOCK; t++) {
      g.tick();
      if (g.ufo) return { t, dir: g.ufo.dir };
    }
    return null;
  };
  let n = 1;
  let ref = ufoTick(liveEngine(n).g);
  while (!ref || ref.t === 0) ref = ufoTick(liveEngine(++n).g);
  // Mismo secreto, pero la oleada se despeja en el primer tick (sale antes de
  // tirar la bomba y el OVNI): el OVNI tiene que salir en el mismo tick.
  const { g } = liveEngine(n);
  for (const row of g.alive) row.fill(false);
  assert.deepEqual(ufoTick(g), ref);
  assert.equal(g.wave, 2);
});

test("held dice qué teclas tiene apretadas el motor", () => {
  const g = new InvadersEngine(3);
  assert.deepEqual(g.held, { left: false, right: false, fire: false });
  g.apply("l1");
  g.apply("f1");
  assert.deepEqual(g.held, { left: true, right: false, fire: true });
  g.apply("l0");
  g.apply("r1");
  assert.deepEqual(g.held, { left: false, right: true, fire: true });
});
