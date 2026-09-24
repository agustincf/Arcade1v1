// Garantías de i18n: (1) los 3 idiomas exponen EXACTAMENTE las mismas claves
// (ningún idioma sale incompleto — habilita servir solo el activo sin mostrar
// claves crudas); (2) translate es puro (interpola vars; clave cruda si falta).

import { test } from "node:test";
import assert from "node:assert/strict";

import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { fr } from "../app/lib/i18n/fr.js";
import { translate } from "../app/lib/i18n-dict.js";
import { ALEPH_RULES } from "@arcade1v1/game-sdk/aleph";

const DICTS = { en, es, fr };

test("los 3 idiomas tienen exactamente las mismas claves", () => {
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
  assert.equal(translate({ hola: "Hola {name}" }, "hola", { name: "Ada" }), "Hola Ada");
  assert.equal(translate({}, "no.existe"), "no.existe");
  assert.equal(translate({ a: "{n}+{n}" }, "a", { n: 2 }), "2+2");
});

test("las 19 claves de la etapa 5 (PR1) están en los 3 idiomas", () => {
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
  // Las que llevan variable tienen que llevarla en los 3 idiomas: si una
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

test("los ocho estados de la criatura se leen distinto en los 3 idiomas", () => {
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

test("el cartel de topes de la charla dice FASE, no etapa, en los 3 idiomas", () => {
  // `aleph.chat.caps` es el ÚNICO lugar donde se le explica al lector el tope
  // de mensajes, y el motor lo cuenta por FASE (ALEPH_RULES.MAX_MSGS_PER_PHASE):
  // cada etapa tiene dos fases, así que decir "por etapa" publica la mitad del
  // tope real.
  const PALABRAS: Record<string, { fase: string; etapa: string }> = {
    en: { fase: "phase", etapa: "stage" },
    es: { fase: "fase", etapa: "etapa" },
    fr: { fase: "phase", etapa: "étape" },
  };
  for (const [lang, dict] of Object.entries(DICTS)) {
    const caps = dict["aleph.chat.caps"].toLowerCase();
    const { fase, etapa } = PALABRAS[lang];
    assert.ok(caps.includes(fase.toLowerCase()), `${lang}: el cartel no dice "${fase}"`);
    assert.ok(
      !caps.includes(etapa.toLowerCase()),
      `${lang}: el cartel dice "${etapa}" (es por fase)`,
    );
    // Y los dos números son los del motor, no otros.
    assert.ok(
      caps.includes(String(ALEPH_RULES.MAX_MSGS_PER_PHASE)),
      `${lang}: el cartel perdió el tope de mensajes`,
    );
    assert.ok(caps.includes(String(ALEPH_RULES.MAX_MSG_LEN)), `${lang}: el cartel perdió el largo`);
  }
});

test("las 31 claves de la etapa 5 (PR2) están en los 3 idiomas", () => {
  const nuevas = [
    // Escena (11; `acted` y `ready` ya entraron con PR1)
    "aleph.scene.title",
    "aleph.scene.invariant",
    "aleph.scene.deck",
    "aleph.scene.deckLeft",
    "aleph.scene.deckNote",
    "aleph.scene.emptySeat",
    "aleph.scene.settledTitle",
    "aleph.scene.settledNoFinal",
    "aleph.scene.settledSplit",
    "aleph.scene.pause",
    "aleph.scene.resume",
    // La regla de cada etapa (5)
    "aleph.rule.share",
    "aleph.rule.offer",
    "aleph.rule.vote",
    "aleph.rule.lock",
    "aleph.rule.final",
    // Friso (6)
    "aleph.frieze.title",
    "aleph.frieze.played",
    "aleph.frieze.current",
    "aleph.frieze.back",
    "aleph.frieze.left",
    "aleph.frieze.bonus",
    // Liquidación (5)
    "aleph.votes.title",
    "aleph.votes.line",
    "aleph.votes.implied",
    "aleph.votes.empty",
    "aleph.votes.unavailable",
    // Probador (4)
    "aleph.probe.title",
    "aleph.probe.label",
    "aleph.probe.bad",
    "aleph.probe.intro",
  ];
  assert.equal(nuevas.length, 31);
  for (const [lang, dict] of Object.entries(DICTS))
    for (const k of nuevas) {
      assert.ok(dict[k], `${lang} no tiene ${k}`);
      assert.ok(dict[k].trim().length > 0, `${lang} tiene ${k} vacía`);
    }

  // Las que llevan variable tienen que llevarla en los 3 idiomas: si una
  // traducción se come el {each}, el número desaparece sin que nadie se entere.
  const conVariables: Record<string, string[]> = {
    "aleph.scene.invariant": ["{pot}", "{box}", "{pockets}", "{total}"],
    "aleph.scene.deckLeft": ["{n}"],
    "aleph.scene.settledSplit": ["{each}"],
    "aleph.frieze.played": ["{n}", "{kind}"],
    "aleph.frieze.current": ["{n}", "{kind}"],
    "aleph.votes.line": ["{voter}", "{target}"],
    "aleph.votes.implied": ["{who}"],
  };
  for (const [lang, dict] of Object.entries(DICTS))
    for (const [k, vars] of Object.entries(conVariables))
      for (const v of vars) assert.ok(dict[k].includes(v), `${lang}: ${k} perdió ${v}`);
});

test("las cuatro claves huérfanas de la sala ya no están en ningún idioma", () => {
  // Las cuatro tenían UN solo uso cada una y los cuatro se fueron con los
  // bloques que la escena reemplaza (los tres Money del encabezado, la línea
  // de etapa con su mm:ss y la barra de la ventana ASIENTOS). El test de
  // paridad no avisa de esto: compara claves ENTRE idiomas, no uso.
  for (const k of [
    "aleph.room.potInitial",
    "aleph.room.nowPlaying",
    "aleph.room.deadline",
    "aleph.room.seats",
  ])
    for (const [lang, dict] of Object.entries(DICTS))
      assert.equal(dict[k], undefined, `${lang} todavía tiene ${k}`);
});
