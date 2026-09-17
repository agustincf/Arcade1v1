// Las piezas compartidas de las partidas en vivo: el interruptor por versión de
// reglas y las dos fuentes de azar, la del jugador y la del árbitro.
//
// Correr: node --import tsx --test packages/game-sdk/test/live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BufferedRandom,
  SeededSource,
  NeedsReveal,
  isLiveMatch,
  LIVE_LEAD_TICKS,
  MAX_COMMIT_TICKS,
  LIVE_SINCE_RULES_V,
} from "@arcade1v1/game-sdk/live";
import { mulberry32 } from "../src/replay";

test("el interruptor: Flappy se juega en vivo desde las reglas v2, y nada más", () => {
  assert.equal(isLiveMatch("flappy", 1), false);
  assert.equal(isLiveMatch("flappy", undefined), false, "sin versión es v1");
  assert.equal(isLiveMatch("flappy", 2), true);
  assert.equal(isLiveMatch("flappy", 3), true);
  assert.equal(isLiveMatch("2048", 9), false);
  assert.deepEqual(LIVE_SINCE_RULES_V, { flappy: 2 });
});

test("constantes del protocolo", () => {
  assert.equal(LIVE_LEAD_TICKS, 15);
  assert.equal(MAX_COMMIT_TICKS, 3_600);
});

test("SeededSource: la misma secuencia que la semilla, y adelantar valores no los consume", () => {
  const src = new SeededSource(42);
  const rng = mulberry32(42);
  const expected = Array.from({ length: 10 }, () => rng());
  assert.deepEqual(src.slice(0, 10), expected, "adelanta sin consumir");
  assert.equal(src.consumed, 0);
  assert.equal(src.next(), expected[0]);
  assert.equal(src.next(), expected[1]);
  assert.equal(src.consumed, 2);
  assert.deepEqual(src.slice(2, 4), expected.slice(2, 4));
});

test("BufferedRandom: entrega en orden y avisa qué valor falta", () => {
  const b = new BufferedRandom();
  assert.throws(
    () => b.next(),
    (e: unknown) => e instanceof NeedsReveal && e.index === 0,
  );
  b.push([0.25, 0.5]);
  assert.equal(b.received, 2);
  assert.equal(b.available, 2);
  assert.equal(b.next(), 0.25);
  assert.equal(b.available, 1);
  b.push([0.75]);
  assert.equal(b.next(), 0.5);
  assert.equal(b.next(), 0.75);
  assert.equal(b.received, 3);
  assert.equal(b.available, 0);
  assert.throws(
    () => b.next(),
    (e: unknown) => e instanceof NeedsReveal && e.index === 3,
  );
});
