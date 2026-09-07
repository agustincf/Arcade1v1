// ELO de N jugadores (Aleph): cada par se compara por lo cobrado y el
// factor K se divide por (N − 1), así una sala mueve tanto rating como una
// partida 1v1. Correr: node --import tsx --test apps/server/test/ratings-multi.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMultiResult, getRating } from "../src/ratings.js";

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "00ee");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

test("el que cobra más sube, el que cobra menos baja, empate no mueve; suma ~0", () => {
  const [a, b, c, d] = [addr(), addr(), addr(), addr()];
  const out = applyMultiResult("aleph", [
    { address: a, score: 2500 },
    { address: b, score: 1000 },
    { address: c, score: 1000 },
    { address: d, score: 500 },
  ]);
  // Todos arrancan en 1000 (expectativa 0,5 contra cada rival); K/(N−1) = 32/3.
  // a: 3 victorias → 3 × 0,5 × 10,67 = +16; d: −16; b y c: 1 victoria, 1 empate, 1 derrota → 0.
  assert.equal(out[a].delta, 16);
  assert.equal(out[d].delta, -16);
  assert.equal(out[b].delta, 0);
  assert.equal(out[c].delta, 0);
  assert.equal(getRating(a, "aleph"), 1016);
  assert.equal(getRating(d, "aleph"), 984);
  assert.equal(getRating(a, "2048"), 1000, "no toca otros juegos");
  const total = Object.values(out).reduce((acc, u) => acc + u.delta, 0);
  assert.ok(Math.abs(total) <= 4);
});

test("usa los ratings PREVIOS de todos (sin dependencia del orden); con 1 jugador no hace nada", () => {
  const [a, b, c] = [addr(), addr(), addr()];
  const out1 = applyMultiResult("aleph", [
    { address: a, score: 3 },
    { address: b, score: 2 },
    { address: c, score: 1 },
  ]);
  const [x, y, z] = [addr(), addr(), addr()];
  const out2 = applyMultiResult("aleph", [
    { address: z, score: 1 },
    { address: y, score: 2 },
    { address: x, score: 3 },
  ]);
  assert.equal(out1[a].delta, out2[x].delta);
  assert.equal(out1[c].delta, out2[z].delta);
  assert.deepEqual(applyMultiResult("aleph", [{ address: addr(), score: 1 }]), {});
});
