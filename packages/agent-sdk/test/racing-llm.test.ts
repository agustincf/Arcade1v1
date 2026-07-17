import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyRacing,
  RacingEngine,
  RACING_CONST,
  RACING_RULES_V,
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
  assert.equal(parseAction("J"), "J");
  assert.equal(parseAction("S"), "S");
  assert.equal(parseAction(" r \n"), "R"); // whitespace alrededor
  assert.equal(parseAction("l"), "L"); // minúscula
  assert.equal(parseAction("j"), "J"); // minúscula
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
  // Sin esto el árbitro rechaza el envío ANTES de re-simular (versión de reglas).
  assert.equal(replay.v, RACING_RULES_V, "el replay declara la versión de reglas vigente");
});

test("playRacingWithBrain: un cerebro que siempre sigue también verifica", async () => {
  const seed = 424242;
  const brain: Brain = async () => "S";
  const { score, replay } = await playRacingWithBrain(seed, brain);
  assert.equal(verifyRacing(replay as ReplayRacing), score);
  assert.equal(replay.inputs.length, 0, "seguir de largo no registra movimientos");
});

test("playRacingWithBrain: un cerebro que decide J salta y el replay igual verifica", async () => {
  const seed = 13;
  // Cerebro que siempre pide saltar: alcanza para probar que "J" se traduce en
  // g.jump() + un input {a:"j"} grabado, y que el replay resultante (con vallas
  // saltadas y quizás algún choque contra un sólido) re-simula el MISMO puntaje.
  const brain: Brain = async () => "J";
  const { score, replay } = await playRacingWithBrain(seed, brain, { maxTicks: 3000 });

  assert.ok(
    replay.inputs.some((inp) => inp.a === "j"),
    "un cerebro que siempre salta deja al menos un input 'j' en el replay",
  );
  assert.equal(
    verifyRacing(replay as ReplayRacing),
    score,
    "el árbitro re-simula el mismo puntaje",
  );
});

test("describeState: describe el carril actual y qué carriles están despejados", () => {
  const g = new RacingEngine(1);
  g.carLane = 1;
  g.obstacles.length = 0;
  // Obstáculo por delante en el carril 0, y a la ALTURA del auto en el carril 2:
  // el motor choca en una ventana simétrica, así que el carril 2 NO está despejado.
  g.obstacles.push({ lane: 0, y: CAR_Y - 120, kind: 0, jumpable: false, passed: false });
  g.obstacles.push({ lane: 2, y: CAR_Y, kind: 0, jumpable: false, passed: false });

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

test("describeState: distingue una valla saltable de un obstáculo sólido, y ofrece J", () => {
  const g = new RacingEngine(1);
  g.carLane = 1;
  g.obstacles.length = 0;
  g.obstacles.push({ lane: 0, y: CAR_Y - 90, kind: 0, jumpable: true, passed: false });
  g.obstacles.push({ lane: 2, y: CAR_Y - 90, kind: 0, jumpable: false, passed: false });

  const state = describeState(g);
  assert.match(
    state,
    /carril 0: valla saltable a 90px/,
    "una valla se describe distinta de un sólido",
  );
  assert.match(state, /carril 2: obstáculo a 90px/, "un sólido sigue siendo 'obstáculo'");
  assert.match(state, /Podés: L R J S/, "puede saltar: no está en el aire");
});

test("describeState: en el aire no ofrece J ni cambiar de carril", () => {
  const g = new RacingEngine(1);
  g.carLane = 1;
  g.jump(); // motor real: jumpTicks>0 => airborne
  assert.ok(g.airborne, "precondición: el salto arrancó");

  const state = describeState(g);
  assert.match(state, /Podés: S\b/, "en el aire, J no está entre las opciones");
  assert.doesNotMatch(state, /Podés:.*J/, "en el aire no se ofrece J");
  assert.match(state, /en el aire/, "explica por qué no puede actuar");
});

test("describeState: reporta monedas sueltas por delante en su carril", () => {
  const g = new RacingEngine(1);
  g.carLane = 1;
  g.obstacles.length = 0;
  g.coins.length = 0;
  g.coins.push({ lane: 2, y: CAR_Y - 80, taken: false });
  g.coins.push({ lane: 0, y: CAR_Y - 200, taken: true }); // ya tomada: no cuenta

  const state = describeState(g);
  assert.match(state, /Monedas: carril 2 a 80px/, "reporta la moneda suelta más cercana");
  assert.doesNotMatch(state, /carril 0 a/, "una moneda ya tomada no se reporta");
});
