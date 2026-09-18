// La estrategia de Flappy decide igual jugando con la semilla (`play`, las
// vistas previas del builder) que tick a tick EN VIVO (`step`, sin azar futuro).
// La caracterización fija que el refactor no cambió ni una partida.
//
// Correr: node --import tsx --test packages/strategies/test/live-step.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FlappyEngine, FLAPPY_DT, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { getStrategy, defaultParams } from "../src/index.js";

const def = getStrategy("flappy.threshold")!;
const PARAMS = [defaultParams(def), { riskOffset: -40, reaction: 5 }];

test("caracterización: play da exactamente las mismas partidas que antes del cambio", () => {
  const h = createHash("sha256");
  for (let seed = 1; seed <= 40; seed++) {
    for (const params of PARAMS) {
      const r = def.play(seed, params);
      h.update(JSON.stringify([r.score, r.replay]));
    }
  }
  assert.equal(h.digest("hex"), "764be5962acd315e7305ed804d3cea61ce3844fd5a704d6b25ff3461abfcfd7a");
});

test("step decide exactamente lo mismo que play, con los mismos estados", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const params of PARAMS) {
      const batch = def.play(seed, params);
      const step = def.step!(params);
      const g = new FlappyEngine(seed);
      const flaps: number[] = [];
      for (let t = 0; t < step.maxTicks && !g.over; t++) {
        if (step.decide(g, t)) {
          g.flap();
          flaps.push(t);
        }
        g.update(FLAPPY_DT);
      }
      assert.deepEqual(flaps, (batch.replay as ReplayFlappy).flaps, `seed ${seed}`);
      assert.equal(g.score, batch.score, `seed ${seed}`);
    }
  }
});

test("step existe solo en los juegos que se juegan en vivo", () => {
  assert.equal(typeof def.step, "function");
  assert.equal(getStrategy("2048.priority")!.step, undefined);
});
