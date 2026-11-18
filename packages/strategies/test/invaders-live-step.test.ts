// La estrategia de Space Invaders decide igual jugando con la semilla (`play`,
// las vistas previas del builder y el Invaders v1) que tick a tick EN VIVO
// (`step`, sin azar futuro). La caracterización fija que el refactor no cambió
// ni una partida con semilla.
// Diseño: docs/superpowers/specs/2026-11-18-invaders-en-vivo-design.md
//
// Correr: node --import tsx --test packages/strategies/test/invaders-live-step.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { InvadersEngine, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";
import { invadersLive } from "@arcade1v1/game-sdk/invaders-live";
import { liveActions } from "@arcade1v1/game-sdk/live";
import { getStrategy, defaultParams } from "../src/index.js";

const def = getStrategy("invaders.hunter")!;
const PARAMS = [defaultParams(def), { aggression: 0.2, dodge: 1 }];

test("invaders.hunter: caracterización, play da exactamente las mismas partidas que antes del cambio", () => {
  const h = createHash("sha256");
  for (let seed = 1; seed <= 30; seed++) {
    for (const params of PARAMS) {
      const r = def.play(seed, params);
      // El juego, sin la etiqueta de versión: subir las reglas (Invaders en
      // vivo es v2) no cambia ni una partida con semilla.
      const { v: _v, ...game } = r.replay as ReplayInvaders;
      h.update(JSON.stringify([r.score, game]));
    }
  }
  assert.equal(h.digest("hex"), "d15fc54efd83b71bfda67bcd0f3062148dec4172488e508b01657ca8a9806377");
});

test("invaders.hunter: step decide exactamente lo mismo que play, con los mismos estados", () => {
  assert.equal(typeof def.step, "function", "la estrategia de Invaders juega en vivo");
  for (let seed = 1; seed <= 30; seed++) {
    for (const params of PARAMS) {
      const batch = def.play(seed, params);
      const step = def.step!(params);
      const g = new InvadersEngine(seed);
      const inputs: { t: number; a: string }[] = [];
      for (let t = 0; t < step.maxTicks && !g.over; t++) {
        const acts = liveActions(invadersLive, step.decide(g, t));
        for (const a of acts) inputs.push({ t, a });
        invadersLive.step(g, acts);
      }
      assert.deepEqual(inputs, (batch.replay as ReplayInvaders).inputs, `seed ${seed}`);
      assert.equal(g.score, batch.score, `seed ${seed}`);
    }
  }
});

test("invaders.hunter: un step nuevo sobre un intento retomado lee las teclas del motor", () => {
  // Retomar (corte de red): el driver rehace lo comprometido y la estrategia
  // se crea de nuevo, con el motor ya con teclas apretadas. Cada jugada que
  // decide tiene que cambiar algo: si creyera que todo está suelto, mandaría
  // jugadas de más (o dejaría una tecla apretada sin saberlo).
  for (let seed = 1; seed <= 20; seed++) {
    const g = new InvadersEngine(seed);
    const first = def.step!(defaultParams(def));
    let t = 0;
    for (; t < 2_000 && !g.over; t++)
      invadersLive.step(g, liveActions(invadersLive, first.decide(g, t)));
    const resumed = def.step!(defaultParams(def));
    for (; t < 6_000 && !g.over; t++) {
      const acts = liveActions(invadersLive, resumed.decide(g, t));
      for (const a of acts) {
        const held = g.held;
        const was = a[0] === "l" ? held.left : a[0] === "r" ? held.right : held.fire;
        assert.notEqual(was, a[1] === "1", `seed ${seed}, tick ${t}: ${a} no cambia nada`);
        g.apply(a as "l1");
      }
      g.tick();
    }
  }
});
