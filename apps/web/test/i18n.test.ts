// Garantías de i18n: (1) los 4 idiomas exponen EXACTAMENTE las mismas claves
// (ningún idioma sale incompleto — habilita servir solo el activo sin mostrar
// claves crudas); (2) translate es puro (interpola vars; clave cruda si falta).

import { test } from "node:test";
import assert from "node:assert/strict";

import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { hi } from "../app/lib/i18n/hi.js";
import { fr } from "../app/lib/i18n/fr.js";
import { translate } from "../app/lib/i18n-dict.js";

const DICTS = { en, es, hi, fr };

test("los 4 idiomas tienen exactamente las mismas claves", () => {
  const keys = Object.fromEntries(
    Object.entries(DICTS).map(([l, d]) => [l, new Set(Object.keys(d))]),
  );
  const all = new Set(Object.values(keys).flatMap((s) => [...s]));
  for (const [lang, set] of Object.entries(keys)) {
    const missing = [...all].filter((k) => !set.has(k));
    assert.equal(missing.length, 0, `${lang} le faltan ${missing.length}: ${missing.slice(0, 5)}`);
  }
});

test("translate: interpola vars y cae a la clave cruda si no existe", () => {
  assert.equal(translate({ hi: "Hola {name}" }, "hi", { name: "Ada" }), "Hola Ada");
  assert.equal(translate({}, "no.existe"), "no.existe");
  assert.equal(translate({ a: "{n}+{n}" }, "a", { n: 2 }), "2+2");
});
