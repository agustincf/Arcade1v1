// Las estrategias incluidas son la VARA del benchmark: sus replays tienen que
// declarar la versión y verificar idéntico contra el motor v2. Y la codicia
// tiene que notarse: con coinGreed alto se ganan MÁS puntos promedio que con 0
// (en snake, donde la moneda vale 3 y perseguirla es decisión pura).
import { test } from "node:test";
import assert from "node:assert/strict";
import { getStrategy, defaultParams } from "../src/index";
import { verifyRacing, RACING_RULES_V, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { verifySnake, SNAKE_RULES_V, type ReplaySnake } from "@arcade1v1/game-sdk/snake";

const RACING_IDS = ["racing.dodger", "racing.weaver"];
const SNAKE_IDS = ["snake.greedy", "snake.survivor"];

for (const id of RACING_IDS) {
  test(`${id}: replay v2 válido que verifica idéntico`, () => {
    const def = getStrategy(id)!;
    const { score, replay } = def.play(1234, defaultParams(def));
    const r = replay as ReplayRacing;
    assert.equal(r.v, RACING_RULES_V, "el replay declara la versión de reglas");
    assert.equal(verifyRacing(r), score);
  });
}

for (const id of SNAKE_IDS) {
  test(`${id}: replay v2 válido que verifica idéntico`, () => {
    const def = getStrategy(id)!;
    const { score, replay } = def.play(1234, defaultParams(def));
    const r = replay as ReplaySnake;
    assert.equal(r.v, SNAKE_RULES_V, "el replay declara la versión de reglas");
    assert.equal(verifySnake(r), score);
  });
}

test("snake.greedy: la codicia rinde — coinGreed alto gana más que 0 en promedio", () => {
  const def = getStrategy("snake.greedy")!;
  let withGreed = 0;
  let without = 0;
  for (let seed = 1; seed <= 25; seed++) {
    withGreed += def.play(seed, { ...defaultParams(def), coinGreed: 0.8 }).score;
    without += def.play(seed, { ...defaultParams(def), coinGreed: 0 }).score;
  }
  assert.ok(
    withGreed > without,
    `coinGreed 0.8 (${withGreed}) debe superar a 0 (${without}) sobre 25 semillas`,
  );
});

test("racing.dodger: sabe saltar — sobrevive/puntúa más que ignorando vallas", () => {
  const def = getStrategy("racing.dodger")!;
  let total = 0;
  for (let seed = 1; seed <= 15; seed++) {
    total += def.play(seed, defaultParams(def)).score;
  }
  // Umbral suave: con vallas presentes desde el arranque (25%), una estrategia
  // que NO salta muere temprano seguido. 15 semillas deben promediar > 12.
  assert.ok(total / 15 > 12, `promedio muy bajo: ${(total / 15).toFixed(1)}`);
});
