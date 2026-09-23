// CORTE SECO con dignidad: un replay de reglas viejas (sin `v` o con otra
// versión) se rechaza ANTES de re-simular, con un error que dice claramente
// que hay que actualizar el paquete — nunca un "score mismatch" críptico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchmake, submitScore, getMatch } from "../src/matchmaking.js";
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

test("una partida que esperaba rival con reglas VIEJAS no empareja a nadie: sale de la cola y queda para el barrendero", async () => {
  const OLD = "0x2222222222222222222222222222222222222222";
  const NEW = "0x3333333333333333333333333333333333333333";
  // Una partida nacida con las reglas de antes, como las que el árbitro
  // restaura en el deploy que sube la versión de un juego. El árbitro ya no
  // acepta puntajes de esas reglas: quien se emparejara con ella jugaría una
  // partida entera para que le rechacen el envío.
  const current = RULES_V.snake;
  RULES_V.snake = current - 1;
  let old;
  try {
    old = await matchmake("snake", 1, OLD);
  } finally {
    RULES_V.snake = current;
  }
  assert.equal(old.rulesV, current - 1);
  const fresh = await matchmake("snake", 1, NEW);
  assert.notEqual(fresh.matchId, old.matchId, "no la empareja con la partida vieja");
  assert.equal(fresh.status, "waiting");
  assert.equal(fresh.rulesV, current);
  // No se borra: el barrendero la vence al WAIT_TTL y, con plata, la reembolsa.
  assert.equal(getMatch(old.matchId, OLD)?.status, "waiting");
});
