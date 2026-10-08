// Quién no presentó su intento a tiempo (W2), desde el lado de quien mira la
// partida: la pantalla de la partida explica así una victoria o una derrota
// que no salió de comparar puntajes.
//
// Correr: node --import tsx --test apps/web/test/result.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { noShowSide } from "../app/lib/result.js";

test("quién no presentó: el rival, vos, o nadie", () => {
  assert.equal(noShowSide({ opponent: "0xb", noShow: "0xb" }), "rival");
  assert.equal(noShowSide({ opponent: "0xb", noShow: "0xa" }), "you");
  assert.equal(noShowSide({ opponent: "0xb" }), null);
  assert.equal(noShowSide({ opponent: "0xB", noShow: "0xb" }), "rival", "sin importar mayúsculas");
});

test("¿ya deposité?: mira la dirección, no el rol (F4)", async () => {
  const { depositedBy } = await import("../app/lib/result.js");
  const base = { p1: "0xA", p2: "0xB", p1Paid: true, p2Paid: true };
  assert.equal(depositedBy(base, "0xa"), true, "p1, sin importar mayúsculas");
  assert.equal(depositedBy(base, "0xb"), true);
  assert.equal(
    depositedBy(base, "0xc"),
    false,
    "el p2 que perdió el lugar no queda como pagado por el depósito de otro",
  );
  assert.equal(depositedBy({ ...base, p2Paid: false }, "0xb"), false);
});
