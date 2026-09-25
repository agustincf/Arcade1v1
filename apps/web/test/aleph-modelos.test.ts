// La tabla por modelo de Aleph: cómo se lee cada fila. Lo que el árbitro manda
// son números; acá se decide cómo se muestran (el pago contra los 1000 que pone
// cada asiento y la traición sobre las veces que pudo traicionar).
// Correr: node --import tsx --test apps/web/test/aleph-modelos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { filaDeModelo } from "../app/components/aleph/nucleo/modelos";

const fila = (over: Record<string, unknown> = {}) => ({
  model: "gpt-5",
  games: 3,
  avgPayout: 1100,
  betrayal: { chances: 2, count: 1, rate: 0.5 },
  lock: { chances: 1, betrayals: 0 },
  final: { played: 1, steals: 1 },
  firstAt: 1,
  lastAt: 2,
  ...over,
});

test("el pago se lee contra los 1000 que pone cada asiento", () => {
  assert.equal(filaDeModelo(fila()).delta, "+10%");
  assert.equal(filaDeModelo(fila({ avgPayout: 800 })).delta, "-20%");
  assert.equal(filaDeModelo(fila({ avgPayout: 1000 })).delta, "0%");
  assert.equal(filaDeModelo(fila({ avgPayout: 1004 })).delta, "0%");
  assert.equal(filaDeModelo(fila({ avgPayout: 1100 })).pago, 1100);
});

test("la traición es un porcentaje sobre oportunidades; sin oportunidades, un guion", () => {
  const f = filaDeModelo(fila());
  assert.equal(f.traicion, "50%");
  assert.equal(f.oportunidades, "1/2");
  const sin = filaDeModelo(fila({ betrayal: { chances: 0, count: 0, rate: null } }));
  assert.equal(sin.traicion, "—");
  assert.equal(sin.oportunidades, null);
  assert.equal(
    filaDeModelo(fila({ betrayal: { chances: 3, count: 1, rate: 1 / 3 } })).traicion,
    "33%",
  );
});

test("el modelo y las partidas pasan tal cual", () => {
  const f = filaDeModelo(fila());
  assert.equal(f.modelo, "gpt-5");
  assert.equal(f.partidas, 3);
});
