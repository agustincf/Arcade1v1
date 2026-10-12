// Las estrategias de la Carrera deciden igual jugando con la semilla (`play`,
// las vistas previas del builder y la Carrera v2) que tick a tick EN VIVO
// (`step`, sin azar futuro). La caracterización fija que el refactor no cambió
// ni una partida.
//
// Correr: node --import tsx --test packages/strategies/test/racing-live-step.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RacingEngine, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { racingLive } from "@arcade1v1/game-sdk/racing-live";
import { liveActions } from "@arcade1v1/game-sdk/live";
import { getStrategy, defaultParams } from "../src/index.js";

const CASES: Record<string, { hash: string; params: Record<string, unknown>[] }> = {
  "racing.dodger": {
    hash: "c1391f97ceb6c552d91f029711e8d20a952a8f9ee730d2ce4c48c6a34c9c5b92",
    params: [
      defaultParams(getStrategy("racing.dodger")!),
      { lookahead: 240, preferredLane: "left", coinGreed: 0 },
    ],
  },
  "racing.weaver": {
    hash: "87e9f285d8f55029bebe9caee47f9916a929012664bdd30394b3af3aa90dc4d3",
    params: [defaultParams(getStrategy("racing.weaver")!), { boldness: 0.9, coinGreed: 0 }],
  },
};

for (const [id, c] of Object.entries(CASES)) {
  const def = getStrategy(id)!;

  test(`${id}: caracterización, play da exactamente las mismas partidas que antes del cambio`, () => {
    const h = createHash("sha256");
    for (let seed = 1; seed <= 40; seed++) {
      for (const params of c.params) {
        const r = def.play(seed, params);
        h.update(JSON.stringify([r.score, r.replay]));
      }
    }
    assert.equal(h.digest("hex"), c.hash);
  });

  test(`${id}: step decide exactamente lo mismo que play, con los mismos estados`, () => {
    assert.equal(typeof def.step, "function", "las estrategias de Carrera juegan en vivo");
    for (let seed = 1; seed <= 40; seed++) {
      for (const params of c.params) {
        const batch = def.play(seed, params);
        const step = def.step!(params);
        const g = new RacingEngine(seed);
        const inputs: { t: number; a: string }[] = [];
        for (let t = 0; t < step.maxTicks && !g.over; t++) {
          const acts = liveActions(racingLive, step.decide(g, t));
          for (const a of acts) inputs.push({ t, a });
          racingLive.step(g, acts);
        }
        assert.deepEqual(inputs, (batch.replay as ReplayRacing).inputs, `seed ${seed}`);
        assert.equal(g.score, batch.score, `seed ${seed}`);
      }
    }
  });
}
