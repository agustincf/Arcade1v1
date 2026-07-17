// CORTE SECO con dignidad: un replay de reglas viejas (sin `v` o con otra
// versión) se rechaza ANTES de re-simular, con un error que dice claramente
// que hay que actualizar el paquete — nunca un "score mismatch" críptico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchmake, submitScore } from "../src/matchmaking.js";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { SnakeEngine, SNAKE_RULES_V, type ReplaySnake } from "@arcade1v1/game-sdk/snake";

const P1 = "0x1111111111111111111111111111111111111111";

function playQuietSnake(seed: number): { score: number; replay: ReplaySnake } {
  const g = new SnakeEngine(seed);
  let t = 0;
  while (!g.over && t < 2000) {
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs: [], v: SNAKE_RULES_V } };
}

test("árbitro: replay sin versión (cliente viejo) => error claro de actualización", async () => {
  const m = await matchmake("snake", 0, P1);
  const { score, replay } = playQuietSnake(m.seed);
  const legacy = { seed: replay.seed, ticks: replay.ticks, inputs: replay.inputs }; // sin v
  await assert.rejects(
    () => submitScore(m.matchId, P1, score, legacy),
    (e: Error) => /rules version mismatch/.test(e.message) && /@arcade1v1\/mcp/.test(e.message),
  );
});

test("árbitro: replay con la versión vigente => se acepta y verifica", async () => {
  const m = await matchmake("snake", 0, P1);
  const { score, replay } = playQuietSnake(m.seed);
  const v = await submitScore(m.matchId, P1, score, replay);
  assert.equal(v.rulesV, RULES_V.snake, "la vista expone la versión de reglas de la partida");
  assert.equal(v.yourScore ?? v.scores[P1.toLowerCase()], score);
});
