// EL AZAR DE ALEPH: de dónde sale y por qué no se puede adivinar. Correr:
//   node --import tsx --test packages/game-sdk/test/aleph-azar.test.ts
//
// Reglas v1 sembraban `mulberry32` con un trozo de 32 bits del secreto por
// propósito. 32 bits se recorren enteros en un minuto, así que la única
// defensa era que el juego mostrara muy poca información — un margen prestado:
// una segunda Cerradura en el mazo alcanzaba para adivinar su código 1 en 48 en
// vez de 1 en 10^8. Desde v2 cada valor sale de SHA-256 del secreto ENTERO.
//
// v1 no se borra: las partidas ya jugadas tienen que seguir verificando con el
// mismo resultado, que es lo que promete `replayAleph`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAleph,
  replayAleph,
  rngFor,
  buildDeck,
  ALEPH_RULES_V,
} from "@arcade1v1/game-sdk/aleph";
import { seats, seedN } from "./aleph-helpers";
import golden from "./aleph-v1-golden.json" with { type: "json" };

const draws = (rnd: () => number, n = 4) => Array.from({ length: n }, () => rnd());

test("v2 es la versión vigente", () => {
  assert.equal(ALEPH_RULES_V, 2);
});

// ---------------------------------------------------------------------------
// Lo que arregla v2: que el azar dependa de los 32 bytes del secreto.
// ---------------------------------------------------------------------------

test("v2: cambiar CUALQUIER byte del secreto cambia los cuatro sorteos", () => {
  const base = "0x" + "ab".repeat(32);
  for (let byte = 0; byte < 32; byte++) {
    const otro =
      "0x" +
      base
        .slice(2)
        .replace(new RegExp(`^(.{${byte * 2}})..`), (_, pre) => pre + (byte % 2 ? "cd" : "77"));
    assert.notEqual(otro, base, `byte ${byte}: la semilla de prueba no cambió`);
    for (const purpose of [0, 1, 2, 3]) {
      assert.notDeepEqual(
        draws(rngFor(otro, purpose, 3, 2)),
        draws(rngFor(base, purpose, 3, 2)),
        `byte ${byte}, propósito ${purpose}: el azar no se movió`,
      );
    }
  }
});

test("v1 SOLO miraba 16 de los 32 bytes (la debilidad que v2 cierra)", () => {
  // Documenta el bug viejo: los bytes 16..31 no entraban en ningún sorteo.
  const base = "0x" + "ab".repeat(32);
  const cola = "0x" + "ab".repeat(16) + "99".repeat(16);
  for (const purpose of [0, 1, 2, 3]) {
    assert.deepEqual(
      draws(rngFor(cola, purpose, 3, 1)),
      draws(rngFor(base, purpose, 3, 1)),
      `v1 sí miraba el byte 16+ en el propósito ${purpose}`,
    );
    assert.notDeepEqual(
      draws(rngFor(cola, purpose, 3, 2)),
      draws(rngFor(base, purpose, 3, 2)),
      `v2 no mira el byte 16+ en el propósito ${purpose}`,
    );
  }
});

test("v2: el estado del sorteo ya no se puede recorrer entero (no es de 32 bits)", () => {
  // En v1, el estado de un propósito era un trozo de 32 bits: probando las
  // 2^32 posibilidades se lo encontraba. La prueba de que v2 no funciona así:
  // dos semillas que comparten ese trozo de 32 bits ahora sortean distinto.
  const a = "0x" + "11".repeat(4) + "00".repeat(28);
  const b = "0x" + "11".repeat(4) + "ff".repeat(28);
  assert.deepEqual(
    draws(rngFor(a, 0, -1, 1)),
    draws(rngFor(b, 0, -1, 1)),
    "v1: mismo trozo, mismo azar",
  );
  assert.notDeepEqual(
    draws(rngFor(a, 0, -1, 2)),
    draws(rngFor(b, 0, -1, 2)),
    "v2 sigue atado a 32 bits",
  );
});

test("v2: cada propósito y cada etapa sortean distinto, y siempre igual a sí mismos", () => {
  const seed = seedN(7);
  const visto = new Set<string>();
  for (const purpose of [0, 1, 2, 3]) {
    for (const stage of [-1, 0, 1, 5, 12]) {
      const secuencia = draws(rngFor(seed, purpose, stage, 2), 6).join(",");
      assert.ok(!visto.has(secuencia), `se repite el azar en ${purpose}/${stage}`);
      visto.add(secuencia);
      assert.equal(
        secuencia,
        draws(rngFor(seed, purpose, stage, 2), 6).join(","),
        "no es determinístico",
      );
    }
  }
});

test("v2: los valores caen en [0,1) y se reparten parejo", () => {
  const cubos = new Array(10).fill(0);
  const rnd = rngFor(seedN(3), 2, 0, 2);
  for (let i = 0; i < 20000; i++) {
    const x = rnd();
    assert.ok(x >= 0 && x < 1, `fuera de rango: ${x}`);
    cubos[Math.floor(x * 10)]++;
  }
  for (const [i, c] of cubos.entries()) {
    assert.ok(c > 1700 && c < 2300, `el décimo ${i} salió ${c} veces de 20000`);
  }
});

// ---------------------------------------------------------------------------
// Lo que NO puede romperse: las partidas viejas.
// ---------------------------------------------------------------------------

test("v1: los sorteos de las partidas ya jugadas no se movieron ni un pelo", () => {
  for (const g of golden.sorteos) {
    const s = createAleph(g.seed, seats(g.n), { rulesV: 1 });
    assert.deepEqual(s.deck, g.deck, `mazo distinto con ${g.seed}`);
    assert.deepEqual(s.tiebreak, g.tiebreak, `desempate distinto con ${g.seed}`);
  }
});

test("v1: re-simular una partida vieja da la MISMA tabla de pagos", () => {
  // Es la promesa pública: cualquiera baja el registro y verifica al árbitro.
  for (const p of golden.partidas) {
    const s = replayAleph(p.seed, seats(p.n), p.events as never, { rulesV: 1 });
    assert.ok(s.over, `la partida ${p.seed} no terminó`);
    assert.deepEqual(s.payouts, p.payouts, `pagos distintos en ${p.seed}`);
    assert.deepEqual(
      s.results.map((r) => r.kind),
      p.stages,
      `etapas distintas en ${p.seed}`,
    );
  }
});

test("una sala nueva nace en v2 y sortea distinto que la misma semilla en v1", () => {
  const g = golden.sorteos[0];
  const nueva = createAleph(g.seed, seats(g.n));
  assert.equal(nueva.rulesV, 2);
  assert.notDeepEqual(nueva.deck, g.deck, "v2 sortea igual que v1");
});

// ---------------------------------------------------------------------------
// El mazo, ahora parejo (era un sesgo aparte, de la regla de las Ofertas).
// ---------------------------------------------------------------------------

test("el mazo nunca trae dos Ofertas seguidas, en las dos versiones", () => {
  for (const v of [1, 2] as const) {
    for (let i = 0; i < 400; i++) {
      const n = 4 + (i % 5);
      const deck = buildDeck(n, rngFor(seedN(i), 0, -1, v), v);
      assert.equal(deck.length, n + 2);
      assert.equal(deck.filter((c) => c === "offer").length, 2);
      assert.equal(deck.filter((c) => c === "lock").length, 1);
      assert.equal(deck.filter((c) => c === "share").length, 1);
      for (let j = 1; j < deck.length; j++) {
        assert.ok(!(deck[j] === "offer" && deck[j - 1] === "offer"), `v${v} dejó Ofertas pegadas`);
      }
    }
  }
});

test("v2: el mazo sale parejo; v1 favorecía unos órdenes sobre otros", () => {
  // v1 corregía las Ofertas pegadas con un intercambio, y eso amontonaba
  // probabilidad en ciertos órdenes. Medido sobre los 2^32 estados de v1: de
  // los 840 órdenes de una mesa de 6, los 210 con Ofertas pegadas quedaban
  // vacíos y su masa caía sobre los otros 630, así que el más frecuente salía
  // 2,25× el promedio. v2 vuelve a barajar, que reparte parejo.
  //
  // Se mide con mesa de 4 (120 órdenes posibles) y 120.000 mazos: ~1000 por
  // orden, donde el ruido estadístico es ±3 % y un sesgo de 2× no se disimula.
  const pico = (v: 1 | 2) => {
    const cuenta = new Map<string, number>();
    for (let i = 0; i < 120000; i++) {
      const deck = buildDeck(4, rngFor(seedN(i), 0, -1, v), v).join(",");
      cuenta.set(deck, (cuenta.get(deck) ?? 0) + 1);
    }
    const vistos = [...cuenta.values()];
    const promedio = vistos.reduce((a, b) => a + b, 0) / vistos.length;
    return Math.max(...vistos) / promedio;
  };
  const picoV1 = pico(1);
  const picoV2 = pico(2);
  assert.ok(
    picoV1 > 1.5,
    `el sesgo de v1 no se reprodujo (pico ${picoV1.toFixed(2)}×): el test no prueba nada`,
  );
  assert.ok(
    picoV2 < 1.3,
    `v2 sigue desparejo: el orden más frecuente sale ${picoV2.toFixed(2)}× el promedio`,
  );
});
