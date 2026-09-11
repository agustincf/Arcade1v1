// El formato de la cuenta regresiva. Chico pero con trampas: 65 s NO es "1:5",
// y un plazo vencido tiene que mostrar 0:00, nunca un número negativo (pasa
// siempre: el árbitro cierra la fase un instante después del plazo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLeft } from "../app/components/Countdown";

test("mm:ss con los segundos en dos dígitos", () => {
  assert.equal(formatLeft(65_000), "1:05");
  assert.equal(formatLeft(600_000), "10:00");
  assert.equal(formatLeft(9_000), "0:09");
});

test("un plazo vencido no muestra números negativos", () => {
  assert.equal(formatLeft(0), "0:00");
  assert.equal(formatLeft(-4_000), "0:00");
});

test("los milisegundos sueltos no adelantan el segundo", () => {
  assert.equal(formatLeft(1_999), "0:01");
});
