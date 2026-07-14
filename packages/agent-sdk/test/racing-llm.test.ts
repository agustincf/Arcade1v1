import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyRacing,
  RacingEngine,
  RACING_CONST,
  type ReplayRacing,
} from "@arcade1v1/game-sdk/racing";
import {
  playRacingWithBrain,
  parseAction,
  describeState,
  type Action,
  type Brain,
} from "../examples/play-racing-llm.js";

const CAR_Y = RACING_CONST.HEIGHT - 80; // el motor mantiene CAR_Y privado; misma fórmula

test("parseAction: toma la letra y cae a S ante basura", () => {
  assert.equal(parseAction("L"), "L");
  assert.equal(parseAction("R"), "R");
  assert.equal(parseAction("S"), "S");
  assert.equal(parseAction(" r \n"), "R"); // whitespace alrededor
  assert.equal(parseAction("l"), "L"); // minúscula
  assert.equal(parseAction("me muevo a la izquierda"), "S"); // frase → default seguro
  assert.equal(parseAction(""), "S"); // vacío → default
});

test("playRacingWithBrain: el replay del cerebro pasa la verificación del árbitro", async () => {
  const seed = 987654;
  // Cerebro falso DETERMINISTA (alterna L/R/S). No toca la red ni el LLM: prueba
  // la propiedad central sin API key. El juego es determinista, así que el orden
  // de decisiones es fijo y el replay es reproducible.
  let i = 0;
  const cycle: Action[] = ["L", "R", "S"];
  const brain: Brain = async () => cycle[i++ % cycle.length];

  const { score, replay } = await playRacingWithBrain(seed, brain);

  // El árbitro re-simula seed + inputs; el puntaje declarado DEBE coincidir.
  assert.equal(verifyRacing(replay as ReplayRacing), score);
  assert.equal(replay.seed, seed, "el replay usa la semilla de la partida");
  assert.ok(replay.inputs.length > 0, "un cerebro que se mueve deja inputs en el replay");
});

test("playRacingWithBrain: un cerebro que siempre sigue también verifica", async () => {
  const seed = 424242;
  const brain: Brain = async () => "S";
  const { score, replay } = await playRacingWithBrain(seed, brain);
  assert.equal(verifyRacing(replay as ReplayRacing), score);
  assert.equal(replay.inputs.length, 0, "seguir de largo no registra movimientos");
});

test("describeState: describe el carril actual y qué carriles están despejados", () => {
  const g = new RacingEngine(1);
  g.carLane = 1;
  g.obstacles.length = 0;
  // Obstáculo por delante en el carril 0, y a la ALTURA del auto en el carril 2:
  // el motor choca en una ventana simétrica, así que el carril 2 NO está despejado.
  g.obstacles.push({ lane: 0, y: CAR_Y - 120, kind: 0, passed: false });
  g.obstacles.push({ lane: 2, y: CAR_Y, kind: 0, passed: false });

  const state = describeState(g);
  assert.match(state, /carril 1 de 3/, "reporta el carril actual");
  assert.match(
    state,
    /carril 0: obstáculo a 120px/,
    "reporta la distancia al obstáculo de adelante",
  );
  // Regresión del fix de ventana de peligro: un obstáculo a la altura del auto
  // es peligro inmediato (0px), no 'despejado'.
  assert.match(state, /carril 2: obstáculo a 0px/, "un obstáculo a la altura no es 'despejado'");
});
