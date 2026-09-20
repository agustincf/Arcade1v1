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

test("las 19 claves de la etapa 5 (PR1) están en los 4 idiomas", () => {
  const nuevas = [
    // Estados que no existían (7)
    "aleph.state.esperando",
    "aleph.state.decidio",
    "aleph.state.listo",
    "aleph.state.hablando",
    "aleph.state.traidor",
    "aleph.state.ganador",
    "aleph.seat.dissolved",
    // Charla (9)
    "aleph.chat.title",
    "aleph.chat.empty",
    "aleph.chat.private",
    "aleph.chat.onlyThisStage",
    "aleph.chat.caps",
    "aleph.chat.declassified",
    "aleph.chat.whisper",
    "aleph.chat.whisperTo",
    "aleph.chat.stageSep",
    // Accesibilidad (1) y el contador (2)
    "aleph.a11y.criatura",
    "aleph.scene.acted",
    "aleph.scene.ready",
  ];
  assert.equal(nuevas.length, 19);
  for (const [lang, dict] of Object.entries(DICTS)) {
    for (const k of nuevas) {
      assert.ok(dict[k], `${lang} no tiene ${k}`);
      assert.ok(dict[k].trim().length > 0, `${lang} tiene ${k} vacía`);
    }
  }
  // Las que llevan variable tienen que llevarla en los 4 idiomas: si una
  // traducción se come el {k}, el número desaparece sin que nadie se entere.
  const conVariables: Record<string, string[]> = {
    "aleph.chat.whisperTo": ["{who}"],
    "aleph.chat.stageSep": ["{n}", "{kind}"],
    "aleph.a11y.criatura": ["{wallet}", "{estado}"],
    "aleph.scene.acted": ["{k}", "{n}"],
    "aleph.scene.ready": ["{k}", "{n}"],
  };
  for (const [lang, dict] of Object.entries(DICTS))
    for (const [k, vars] of Object.entries(conVariables))
      for (const v of vars) assert.ok(dict[k].includes(v), `${lang}: ${k} perdió ${v}`);
});

test("los ocho estados de la criatura se leen distinto en los 4 idiomas", () => {
  // Es la mitad de texto del test 8 del spec ("los ocho textos son distintos
  // entre sí"). Va acá y no en `aleph-criatura.test.ts` porque el que puede
  // romperla es el DICCIONARIO, no el generador: dos estados que compartan
  // texto dejan al lector de pantalla sin forma de distinguirlos, y el
  // `aria-label` de la criatura interpola justamente estos ocho. El orden es el
  // de `ESTADOS`: base, hablando, esperando, sellado, se_fue, votado, abandono,
  // ganador — cada uno con la clave que le da `chipDeAsiento`.
  const OCHO = [
    "aleph.seat.alive",
    "aleph.state.hablando",
    "aleph.state.esperando",
    "aleph.state.decidio",
    "aleph.seat.left",
    "aleph.seat.voted_out",
    "aleph.seat.abandoned",
    "aleph.state.ganador",
  ];
  for (const [lang, dict] of Object.entries(DICTS)) {
    const textos = OCHO.map((k) => dict[k]);
    assert.equal(new Set(textos).size, 8, `${lang}: dos estados dicen lo mismo · ${textos}`);
  }
});
