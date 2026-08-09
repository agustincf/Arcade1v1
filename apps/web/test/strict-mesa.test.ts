// Reglas estrictas de mesa de plata.
//
// Los cinco juegos de tiempo real topeaban el delta del bucle en 100 ms, y eso
// era una trampa gratis: cambiabas de pestaña justo antes de un obstáculo, el
// motor no avanzaba UN SOLO TICK, pensabas con calma y volvías. El replay solo
// graba ticks, así que el árbitro no tenía forma de verlo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dtCap, CATCHUP_MAX_MS, DT_CAP_MS } from "../app/games/_shared/strict";

test("en la ladder gratis el tope no cambia: los agentes headless no tienen pestañas", () => {
  assert.equal(dtCap(false), DT_CAP_MS);
});

test("en mesa de plata el bucle se pone al día tras una ausencia", () => {
  assert.equal(dtCap(true), CATCHUP_MAX_MS);
  assert.ok(CATCHUP_MAX_MS > DT_CAP_MS, "estricto tiene que dejar avanzar MÁS, no menos");
});

test("la puesta al día está acotada: sin tope, volver a los 10 minutos cuelga la pestaña", () => {
  // A 60 pasos por segundo, el tope define cuántos pasos se ejecutan de golpe.
  const pasosDeGolpe = (CATCHUP_MAX_MS / 1000) * 60;
  assert.ok(pasosDeGolpe <= 200, `${pasosDeGolpe} pasos en un cuadro es demasiado`);
  assert.ok(pasosDeGolpe >= 60, "menos de un segundo de puesta al día no disuade nada");
});

test("un alt-tab largo cuesta segundos de juego sin control", () => {
  // Es el punto: en Flappy o Racing, un segundo sin tocar nada te mata. Con el
  // tope viejo costaba 100 ms (nada); ahora cuesta hasta 3 s.
  const segundosSinControl = CATCHUP_MAX_MS / 1000;
  assert.ok(segundosSinControl >= 1, "tiene que doler de verdad");
});
