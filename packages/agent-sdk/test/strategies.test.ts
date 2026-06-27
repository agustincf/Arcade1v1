import { test } from "node:test";
import assert from "node:assert/strict";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { strategy2048 } from "../src/strategies.js";

test("strategy2048 produce un replay que el verificador reproduce exacto", () => {
  const seed = 123456;
  const { score, replay } = strategy2048(seed);
  // El árbitro re-juega el replay; el puntaje declarado debe coincidir.
  assert.equal(verify2048(replay as Replay2048), score);
  assert.ok(score > 0, "una corrida normal de 2048 hace puntos");
  assert.equal((replay as Replay2048).seed, seed, "el replay usa la semilla de la partida");
});
