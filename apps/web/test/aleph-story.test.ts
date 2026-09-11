// El narrador de Aleph: una rama por cada final posible de cada etapa, y la
// garantía de que NINGUNA clave que emite puede salir cruda en pantalla (los
// 4 idiomas las tienen todas). Es un módulo puro: sin React, sin red, sin reloj.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { StageResult } from "@arcade1v1/game-sdk/aleph";
import { storyFromResults } from "../app/lib/alephStory";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
/** Nombre corto y estable, como el que pasa la página. */
const name = (a: string) => a.slice(0, 4);
/** Las claves emitidas por una historia, en orden. */
const keys = (rs: StageResult[]) =>
  storyFromResults(rs, name).flatMap((s) => s.lines.map((l) => l.key));
const base = { potAfter: 100, boxAfter: 50 };

test("Reparto: guardaron unos y aportaron otros", () => {
  const r: StageResult = {
    index: 0,
    kind: "share",
    kept: [A],
    contributed: [B, C],
    bonus: 40,
    ...base,
  };
  const [stage] = storyFromResults([r], name);

  assert.equal(stage.n, 1, "las etapas se cuentan desde 1 para el lector");
  assert.equal(stage.index, 0, "pero se conserva el índice del motor, que arranca en 0");
  assert.equal(stage.kind, "share");
  assert.deepEqual(stage.lines[0], {
    key: "aleph.story.share.mixed",
    vars: { kept: "0xaa", contributed: "0xbb, 0xcc" },
  });
  assert.deepEqual(stage.lines[1], { key: "aleph.story.share.bonus", vars: { bonus: 40 } });
});

test("Reparto: si guardan todos no se menciona a nadie que aportó", () => {
  const r: StageResult = {
    index: 0,
    kind: "share",
    kept: [A, B],
    contributed: [],
    bonus: 0,
    ...base,
  };
  assert.deepEqual(keys([r]), ["aleph.story.share.allKept", "aleph.story.after"]);
});

test("Reparto: si aportan todos, tampoco hay lista de los que guardaron", () => {
  const r: StageResult = {
    index: 0,
    kind: "share",
    kept: [],
    contributed: [A, B],
    bonus: 0,
    ...base,
  };
  assert.equal(keys([r])[0], "aleph.story.share.allIn");
});

test("Oferta: nadie acepta", () => {
  const r: StageResult = { index: 1, kind: "offer", offerBps: 1500, accepted: [], ...base };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[0], { key: "aleph.story.offer.made", vars: { pct: "15%" } });
  assert.equal(stage.lines[1].key, "aleph.story.offer.none");
});

test("Oferta: aceptan algunos y se van con su parte", () => {
  const r: StageResult = {
    index: 1,
    kind: "offer",
    offerBps: 1000,
    accepted: [A, B],
    eachGot: 120,
    ...base,
  };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.offer.taken",
    vars: { who: "0xaa, 0xbb", each: 120 },
  });
});

test("Oferta: aceptan todos y se anula", () => {
  const r: StageResult = {
    index: 1,
    kind: "offer",
    offerBps: 2000,
    accepted: [A, B],
    voided: true,
    ...base,
  };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[1], { key: "aleph.story.offer.void", vars: { pct: "10%" } });
});

test("Voto: quién se fue y con cuántos votos, más el recuento", () => {
  const r: StageResult = {
    index: 2,
    kind: "vote",
    votes: { [A]: 2, [B]: 1, [C]: 0 },
    eliminated: A,
    ...base,
  };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[0], {
    key: "aleph.story.vote.out",
    vars: { who: "0xaa", votes: 2 },
  });
  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.vote.tally",
    vars: { tally: "0xaa: 2 · 0xbb: 1 · 0xcc: 0" },
  });
});

test("Cerradura: la abren para todos", () => {
  const r: StageResult = {
    index: 3,
    kind: "lock",
    code: "4071",
    solvers: [A],
    traitors: [],
    bonus: 300,
    ...base,
  };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[0], { key: "aleph.story.lock.code", vars: { code: "4071" } });
  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.lock.all",
    vars: { who: "0xaa", bonus: 300 },
  });
});

test("Cerradura: traidores (se nombran, y los honestos también)", () => {
  const r: StageResult = {
    index: 3,
    kind: "lock",
    code: "4071",
    solvers: [A, B],
    traitors: [B],
    eachGot: 90,
    ...base,
  };
  const [stage] = storyFromResults([r], name);

  assert.deepEqual(stage.lines[1], {
    key: "aleph.story.lock.traitors",
    vars: { who: "0xbb", each: 90 },
  });
  assert.deepEqual(stage.lines[2], { key: "aleph.story.lock.solvers", vars: { who: "0xaa" } });
});

test("Cerradura: no acierta nadie", () => {
  const r: StageResult = {
    index: 3,
    kind: "lock",
    code: "4071",
    solvers: [],
    traitors: [],
    failed: true,
    ...base,
  };
  assert.equal(keys([r])[1], "aleph.story.lock.failed");
});

test("La Final: los tres desenlaces", () => {
  const fin = (choices: Record<string, "split" | "steal">): StageResult => ({
    index: 4,
    kind: "final",
    choices,
    ...base,
  });

  assert.equal(keys([fin({ [A]: "split", [B]: "split" })])[0], "aleph.story.final.split");
  assert.deepEqual(storyFromResults([fin({ [A]: "steal", [B]: "split" })], name)[0].lines[0], {
    key: "aleph.story.final.steal",
    vars: { who: "0xaa" },
  });
  assert.equal(keys([fin({ [A]: "steal", [B]: "steal" })])[0], "aleph.story.final.both");
});

test("La Final no decae ni cierra con el estado del tablero: la sala terminó", () => {
  const r: StageResult = {
    index: 4,
    kind: "final",
    choices: { [A]: "split", [B]: "split" },
    ...base,
  };
  assert.deepEqual(keys([r]), ["aleph.story.final.split"]);
});

test("Abandonos y decaimiento se cuentan al cerrar la etapa", () => {
  const r: StageResult = {
    index: 0,
    kind: "share",
    kept: [A],
    contributed: [B],
    bonus: 0,
    abandoned: [C],
    decay: 12,
    ...base,
  };
  const ks = keys([r]);

  assert.deepEqual(ks.slice(-3), [
    "aleph.story.abandoned",
    "aleph.story.decay",
    "aleph.story.after",
  ]);
  const [stage] = storyFromResults([r], name);
  assert.deepEqual(stage.lines.at(-1), {
    key: "aleph.story.after",
    vars: { pot: 100, box: 50 },
  });
});

test("un decaimiento de 0 no se menciona (no pasó nada que contar)", () => {
  const r: StageResult = {
    index: 0,
    kind: "share",
    kept: [],
    contributed: [A],
    bonus: 0,
    decay: 0,
    ...base,
  };
  assert.ok(!keys([r]).includes("aleph.story.decay"));
});

test("una sala entera se cuenta en orden, una entrada por etapa", () => {
  const rs: StageResult[] = [
    { index: 0, kind: "share", kept: [A], contributed: [B, C], bonus: 0, ...base },
    { index: 1, kind: "vote", votes: { [A]: 1, [B]: 2 }, eliminated: B, ...base },
    { index: 2, kind: "final", choices: { [A]: "split", [C]: "steal" }, ...base },
  ];
  const story = storyFromResults(rs, name);

  assert.deepEqual(
    story.map((s) => [s.n, s.kind]),
    [
      [1, "share"],
      [2, "vote"],
      [3, "final"],
    ],
  );
});

import { STORY_KEYS } from "../app/lib/alephStory";
import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { hi } from "../app/lib/i18n/hi.js";
import { fr } from "../app/lib/i18n/fr.js";

test("NINGUNA clave del narrador puede salir cruda: están en los 4 idiomas", () => {
  for (const [lang, dict] of Object.entries({ en, es, hi, fr })) {
    const missing = STORY_KEYS.filter((k) => !(k in dict));
    assert.equal(missing.length, 0, `${lang} no tiene: ${missing.join(", ")}`);
  }
});
