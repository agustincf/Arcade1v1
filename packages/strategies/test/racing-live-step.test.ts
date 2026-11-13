// Las estrategias de la Carrera deciden igual jugando con la semilla (`play`,
// las vistas previas del builder y la Carrera v2) que tick a tick EN VIVO
// (`step`, sin azar futuro). La caracterización fija que ni el refactor ni el
// cambio de reglas (v3, en vivo) cambiaron una partida con semilla.
//
// Correr: node --import tsx --test packages/strategies/test/racing-live-step.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RacingEngine, RACING_RULES_V, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { racingLive } from "@arcade1v1/game-sdk/racing-live";
import { liveActions } from "@arcade1v1/game-sdk/live";
import { getStrategy, defaultParams } from "../src/index.js";

const CASES: Record<string, { hash: string; params: Record<string, unknown>[] }> = {
  "racing.dodger": {
    hash: "d09d6134ecc78ca790b983657263e1ef7f8c1500b8f6ef4afbc3ab51b91692c0",
    params: [
      defaultParams(getStrategy("racing.dodger")!),
      { lookahead: 240, preferredLane: "left", coinGreed: 0 },
    ],
  },
  "racing.weaver": {
    hash: "b13bb6128cb9c14565e1f9018c45437bb684176934d8cd9de21062060db3c13f",
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
        // El juego, sin la etiqueta de versión: subir las reglas (Carrera en
        // vivo es v3) no cambia ni una partida con semilla.
        const { v, ...game } = r.replay as ReplayRacing;
        assert.equal(v, RACING_RULES_V, "el replay declara la versión de reglas vigente");
        h.update(JSON.stringify([r.score, game]));
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
