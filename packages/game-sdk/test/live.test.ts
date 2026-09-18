// Las piezas compartidas de las partidas en vivo: el interruptor por versión de
// reglas y las dos fuentes de azar, la del jugador y la del árbitro. La del
// árbitro sale de un secreto de 256 bits: con mulberry32 y una semilla de 32
// bits, el primer valor revelado alcanzaba para recuperar la semilla por fuerza
// bruta en unos 3 segundos y simular la partida entera.
//
// Correr: node --import tsx --test packages/game-sdk/test/live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BufferedRandom,
  SecretSource,
  liveSecretHash,
  NeedsReveal,
  isLiveMatch,
  LIVE_LEAD_TICKS,
  MAX_COMMIT_TICKS,
  LIVE_SINCE_RULES_V,
} from "@arcade1v1/game-sdk/live";

/** Referencia independiente de la librería: el SHA-256 de node:crypto. */
function reference(secret: string, i: number): number {
  const msg = Buffer.alloc(36);
  Buffer.from(secret, "hex").copy(msg, 0);
  msg.writeUInt32BE(i, 32);
  return createHash("sha256").update(msg).digest().readUInt32BE(0) / 2 ** 32;
}

const SECRET = "7f".repeat(32);

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

test("SecretSource: cada valor es SHA-256(secreto ‖ índice) / 2^32, y adelantar valores no los consume", () => {
  const src = new SecretSource(SECRET);
  const expected = Array.from({ length: 300 }, (_, i) => reference(SECRET, i));
  assert.deepEqual(src.slice(0, 300), expected, "adelanta sin consumir");
  assert.equal(src.consumed, 0);
  assert.equal(src.next(), expected[0]);
  assert.equal(src.next(), expected[1]);
  assert.equal(src.consumed, 2);
  assert.deepEqual(src.slice(2, 4), expected.slice(2, 4));
  assert.ok(expected.every((v) => v >= 0 && v < 1));
});

test("SecretSource: otro secreto da otra secuencia, y un secreto mal formado no se acepta", () => {
  assert.notDeepEqual(
    new SecretSource("80".repeat(32)).slice(0, 5),
    new SecretSource(SECRET).slice(0, 5),
  );
  for (const bad of ["", "7f", "zz".repeat(32), "7F".repeat(32), "7f".repeat(33), 42]) {
    assert.throws(() => new SecretSource(bad as string), /invalid live secret/);
  }
});

test("liveSecretHash: el SHA-256 del secreto, que el árbitro publica al emparejar", () => {
  assert.equal(
    liveSecretHash(SECRET),
    createHash("sha256").update(Buffer.from(SECRET, "hex")).digest("hex"),
  );
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
