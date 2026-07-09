// Tests de la librería de estrategias parametrizables.
//
// La garantía central: TODA estrategia, con CUALQUIER parámetro válido y
// cualquier semilla, produce un replay que el verificador del árbitro
// reproduce con el MISMO puntaje. Si esto se cumple, un agente del builder
// nunca puede ser rechazado por "score mismatch".
//
// Correr: node --import tsx --test packages/strategies/test/strategies.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { verifyTetris, type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { verifyFlappy, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { verifyRacing, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { verifySnake, type ReplaySnake } from "@arcade1v1/game-sdk/snake";
import { verifyInvaders, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";

import {
  STRATEGIES,
  strategiesFor,
  defaultParams,
  validateParams,
  runStrategy,
  type StrategyDef,
} from "../src/index.js";

const VERIFIERS: Record<string, (r: unknown) => number> = {
  "2048": (r) => verify2048(r as Replay2048),
  tetris: (r) => verifyTetris(r as ReplayTetris),
  flappy: (r) => verifyFlappy(r as ReplayFlappy),
  racing: (r) => verifyRacing(r as ReplayRacing),
  snake: (r) => verifySnake(r as ReplaySnake),
  invaders: (r) => verifyInvaders(r as ReplayInvaders),
};

const GAMES = ["2048", "tetris", "flappy", "racing", "snake", "invaders"];

/** Un segundo set de params distinto del default, moviendo cada perilla. */
function altParams(def: StrategyDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of def.params) {
    if (p.kind === "slider") out[p.key] = p.max;
    else if (p.kind === "choice") out[p.key] = p.options![p.options!.length - 1];
    else out[p.key] = (p.options ?? []).slice().reverse();
  }
  return out;
}

const SEEDS = [42, 987654, 20260709];

test("hay al menos una estrategia por juego", () => {
  for (const game of GAMES) {
    assert.ok(strategiesFor(game).length >= 1, `falta estrategia para ${game}`);
  }
});

for (const def of Object.values(STRATEGIES)) {
  const verify = VERIFIERS[def.game];

  test(`${def.id}: el verificador reproduce el puntaje exacto (default y alternativo)`, () => {
    for (const params of [defaultParams(def), altParams(def)]) {
      for (const seed of SEEDS) {
        const { score, replay } = def.play(seed, params);
        assert.equal(
          verify(replay),
          score,
          `${def.id} seed=${seed} params=${JSON.stringify(params)}`,
        );
      }
    }
  });

  test(`${def.id}: determinista (misma semilla + params => mismo replay)`, () => {
    const a = def.play(SEEDS[0], defaultParams(def));
    const b = def.play(SEEDS[0], defaultParams(def));
    assert.deepEqual(a.replay, b.replay);
    assert.equal(a.score, b.score);
  });

  test(`${def.id}: hace puntos con los params por defecto`, () => {
    // Sanidad de producto: el agente "recién salido del builder" no puede ser
    // un queso total. Al menos una de las semillas tiene que puntuar.
    const scores = SEEDS.map((s) => def.play(s, defaultParams(def)).score);
    assert.ok(
      scores.some((s) => s > 0),
      `${def.id} no hizo ni un punto: ${scores.join(",")}`,
    );
  });

  test(`${def.id}: el replay entra en el límite de 256kb del árbitro`, () => {
    for (const params of [defaultParams(def), altParams(def)]) {
      const { replay } = def.play(SEEDS[1], params);
      const bytes = JSON.stringify(replay).length;
      assert.ok(bytes < 200_000, `${def.id}: replay de ${bytes} bytes`);
    }
  });
}

test("validateParams: default-deny (basura afuera, números clampeados)", () => {
  const def = STRATEGIES["2048.priority"];
  const clean = validateParams(def, {
    greed: 999,
    priority: ["up", "up", "up", "up"],
    hack: "ignorame",
  } as Record<string, unknown>);
  assert.equal(clean.greed, 1, "clampea al máximo");
  assert.deepEqual(
    clean.priority,
    ["down", "left", "right", "up"],
    "permutación inválida => default",
  );
  assert.ok(!("hack" in clean), "clave desconocida afuera");

  const flappy = STRATEGIES["flappy.threshold"];
  const c2 = validateParams(flappy, { riskOffset: -1000, reaction: "x" } as Record<
    string,
    unknown
  >);
  assert.equal(c2.riskOffset, -40);
  assert.equal(c2.reaction, 2, "tipo inválido => default");
});

test("runStrategy: valida juego/estrategia y corre", () => {
  const res = runStrategy({ game: "snake", strategyId: "snake.greedy", params: {} }, 7);
  assert.ok(typeof res.score === "number");
  assert.throws(() => runStrategy({ game: "2048", strategyId: "snake.greedy", params: {} }, 7));
  assert.throws(() => runStrategy({ game: "2048", strategyId: "nope", params: {} }, 7));
});
