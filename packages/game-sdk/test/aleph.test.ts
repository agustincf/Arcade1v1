// Motor de Aleph. Todo es determinístico por semilla: el árbitro y
// cualquiera que lea el registro público tienen que re-simular EXACTAMENTE lo
// mismo. Correr: node --import tsx --test packages/game-sdk/test/aleph.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeck,
  createAleph,
  aliveSeats,
  applyEvent,
  phaseComplete,
  seatOf,
  ALEPH_RULES,
  type StageKind,
} from "@arcade1v1/game-sdk/aleph";
import {
  SEED,
  A,
  seats,
  seedN,
  act,
  end,
  skipTalk,
  allDecide,
  assertConserved,
} from "./aleph-helpers";

test("createAleph: dinero inicial, primera etapa Reparto y asientos vivos", () => {
  const s = createAleph(SEED, seats(4));
  assert.equal(s.potInitial, 4000);
  assert.equal(s.box, 800);
  assert.equal(s.pot, 3200);
  assert.equal(s.stage.kind, "share");
  assert.equal(s.stage.phase, "decide");
  assert.equal(s.stage.index, 0);
  assert.equal(s.stage.share, 160); // 5 % de 3200
  assert.equal(s.stage.shareBonus, 80); // 2,5 % de 3200
  assert.equal(aliveSeats(s).length, 4);
  assert.deepEqual([...s.tiebreak].sort(), seats(4));
  assert.equal(s.over, false);
  assert.deepEqual(s.results, []);
});

test("createAleph: rechaza asientos o semilla inválidos", () => {
  assert.throws(() => createAleph(SEED, seats(3)), /invalid seats/);
  assert.throws(() => createAleph(SEED, seats(9)), /invalid seats/);
  assert.throws(() => createAleph(SEED, [A(1), A(1), A(2), A(3)]), /invalid seats/);
  assert.throws(() => createAleph(SEED, ["nope", A(2), A(3), A(4)]), /invalid seats/);
  assert.throws(() => createAleph("0x1234", seats(4)), /invalid seed/);
});

test("mazo: composición por N, sin dos Ofertas seguidas, determinístico", () => {
  for (const n of [4, 5, 6, 7, 8]) {
    for (let i = 0; i < 60; i++) {
      const deck = createAleph(seedN(i * 8 + n), seats(n)).deck;
      const count = (k: StageKind) => deck.filter((c) => c === k).length;
      assert.equal(deck.length, n + 2, `N=${n} seed=${i}`);
      assert.equal(count("offer"), 2);
      assert.equal(count("lock"), 1);
      assert.equal(count("share"), 1);
      assert.equal(count("vote"), n - 2);
      for (let j = 1; j < deck.length; j++) {
        assert.ok(
          !(deck[j] === "offer" && deck[j - 1] === "offer"),
          `ofertas seguidas: ${deck.join(",")}`,
        );
      }
    }
  }
  assert.deepEqual(createAleph(SEED, seats(6)).deck, createAleph(SEED, seats(6)).deck);
  const base = createAleph(seedN(1), seats(8)).deck.join(",");
  const others = Array.from({ length: 20 }, (_, i) =>
    createAleph(seedN(i + 2), seats(8)).deck.join(","),
  );
  assert.ok(
    others.some((d) => d !== base),
    "semillas distintas deberían barajar distinto",
  );
});

test("mazo: la regla de adyacencia intercambia con la primera no-Oferta no adyacente", () => {
  // `rnd` guionado (j = floor(rnd * (i + 1)) en el barajado) para forzar el
  // caso borde: la bolsa queda [vote, lock, share, vote, offer, offer], con las
  // dos Ofertas juntas AL FINAL. La regla no busca "la siguiente" no-Oferta
  // (no hay ninguna después): intercambia con la PRIMERA carta no-Oferta que no
  // quede adyacente a la primera Oferta, que acá cae ANTES (índice 0).
  const vals = [0, 0.2, 0, 0, 0];
  let i = 0;
  const deck = buildDeck(4, () => vals[i++]);
  assert.deepEqual(deck, ["offer", "lock", "share", "vote", "offer", "vote"]);
  assert.equal(i, vals.length, "el barajado consume exactamente n-1 números");
});

test("createAleph con mazo forzado (para tests) lo respeta y valida", () => {
  const s = createAleph(SEED, seats(4), { deck: ["offer", "lock"] });
  assert.deepEqual(s.deck, ["offer", "lock"]);
  assert.throws(() => createAleph(SEED, seats(4), { deck: ["final"] }), /invalid deck/);
});

test("acciones: decisión única y del tipo de la etapa; mensajes con tope; susurro válido", () => {
  let s = createAleph(SEED, seats(4));
  s = act(s, A(1), { type: "keep" });
  assert.deepEqual(s.stage.decisions[A(1)], { type: "keep" });
  assert.throws(() => act(s, A(1), { type: "contribute" }), /already decided/);
  assert.throws(() => act(s, A(2), { type: "accept" }), /not allowed now/);
  assert.throws(() => act(s, A(2), { type: "ready" }), /ready not allowed/);
  assert.throws(() => act(s, A(9), { type: "keep" }), /not a seat/);
  for (let i = 0; i < ALEPH_RULES.MAX_MSGS_PER_PHASE; i++) {
    s = act(s, A(2), { type: "say", text: `m${i}` });
  }
  assert.throws(() => act(s, A(2), { type: "say", text: "de más" }), /message limit/);
  assert.throws(
    () => act(s, A(3), { type: "whisper", to: A(3), text: "yo" }),
    /invalid whisper target/,
  );
  // Los topes de TEXTO también los aplica el motor, no solo la validación de
  // forma del árbitro: un registro con un mensaje fuera de tope no re-simula.
  assert.throws(
    () => act(s, A(3), { type: "say", text: "x".repeat(ALEPH_RULES.MAX_MSG_LEN + 1) }),
    /1\.\.280 chars/,
  );
  assert.throws(() => act(s, A(3), { type: "say", text: "" }), /1\.\.280 chars/);
  assert.throws(
    () => act(s, A(3), { type: "whisper", to: A(4), text: "salto\nde linea" }),
    /control characters/,
  );
  s = act(s, A(3), { type: "whisper", to: A(4), text: "psst" });
  assert.equal(s.messages.length, 4);
  assert.deepEqual(s.messages[3], {
    from: A(3),
    to: A(4),
    text: "psst",
    stage: 0,
    phase: "decide",
  });
});

test("applyEvent no muta el estado anterior", () => {
  const s0 = createAleph(SEED, seats(4));
  const s1 = act(s0, A(1), { type: "keep" });
  assert.deepEqual(s0.stage.decisions, {});
  assert.deepEqual(s1.stage.decisions, { [A(1)]: { type: "keep" } });
});

test("phaseComplete: decide cierra cuando todos los vivos decidieron", () => {
  let s = createAleph(SEED, seats(4));
  assert.equal(phaseComplete(s), null);
  for (const a of seats(4).slice(0, 3)) s = act(s, a, { type: "contribute" });
  assert.equal(phaseComplete(s), null);
  s = act(s, A(4), { type: "keep" });
  assert.equal(phaseComplete(s), "all_acted");
});

test("Reparto: guardar/aportar, ausente aporta, premio de la caja, decaimiento y siguiente etapa", () => {
  let s = createAleph(SEED, seats(4), { deck: ["vote"] });
  s = act(s, A(1), { type: "keep" });
  s = act(s, A(2), { type: "keep" });
  s = act(s, A(3), { type: "contribute" });
  s = end(s); // A4 ausente => aporta y suma una ausencia
  const r = s.results[0];
  assert.deepEqual(r.kept, [A(1), A(2)]);
  assert.deepEqual(r.contributed, [A(3), A(4)]);
  assert.equal(r.bonus, 160); // 2 aportantes × 80
  // pot: 3200 − 2×160 + 160 = 3040; decaimiento 5 % = 152 → 2888; caja: 800 − 160 + 152 = 792
  assert.equal(r.decay, 152);
  assert.equal(s.pot, 2888);
  assert.equal(s.box, 792);
  assert.equal(r.potAfter, 2888);
  assert.equal(r.boxAfter, 792);
  assert.equal(seatOf(s, A(1))!.pocket, 160);
  assert.equal(seatOf(s, A(4))!.absences, 1);
  assert.equal(seatOf(s, A(3))!.absences, 0);
  assertConserved(s);
  assert.equal(s.stage.kind, "vote");
  assert.equal(s.stage.phase, "talk");
  assert.equal(s.stage.index, 1);
  assert.deepEqual(s.stage.decisions, {});
});

test("charla: ready de todos la cierra; en decide, ready solo vale en la Cerradura; fase vieja se rechaza", () => {
  let s = createAleph(SEED, seats(4), { deck: ["vote"] });
  s = allDecide(s, { type: "contribute" }); // → Voto, fase de charla
  assert.throws(() => act(s, A(1), { type: "vote", target: A(2) }), /not allowed now/);
  for (const a of seats(4)) s = act(s, a, { type: "ready" });
  assert.equal(phaseComplete(s), "all_ready");
  assert.throws(() => act(s, A(1), { type: "ready" }), /already decided/);
  s = end(s, "all_ready");
  assert.equal(s.stage.phase, "decide");
  assert.deepEqual(s.stage.ready, []);
  assert.throws(() => act(s, A(1), { type: "ready" }), /ready not allowed/);
  assert.throws(
    () =>
      applyEvent(s, {
        type: "action",
        address: A(1),
        stage: 1,
        phase: "talk",
        action: { type: "ready" },
        ts: 0,
      }),
    /stage or phase mismatch/,
  );
  assert.throws(() => act(s, A(1), { type: "vote", target: A(1) }), /invalid vote target/);
  assert.throws(() => act(s, A(1), { type: "vote", target: A(9) }), /invalid vote target/);
});

test("Oferta: los que aceptan se van con su parte y, con 2 vivos, viene la Final", () => {
  let s = createAleph(SEED, seats(4), { deck: ["offer", "offer"] });
  s = allDecide(s, { type: "contribute" }); // pot 3520 → decaimiento 176 → 3344
  assert.equal(s.stage.kind, "offer");
  assert.equal(s.pot, 3344);
  const total = s.stage.offerTotal!;
  const offerBps = s.stage.offerBps!;
  assert.ok(offerBps >= 1000 && offerBps <= 2500 && offerBps % 100 === 0, `offerBps=${offerBps}`);
  assert.equal(total, Math.floor((3344 * offerBps) / 10000));
  s = act(s, A(1), { type: "accept" });
  s = act(s, A(2), { type: "accept" });
  s = act(s, A(3), { type: "decline" });
  s = end(s); // A4 ausente = rechaza
  const r = s.results[1];
  assert.deepEqual(r.accepted, [A(1), A(2)]);
  assert.equal(r.eachGot, Math.floor(total / 2));
  assert.equal(seatOf(s, A(1))!.status, "left");
  assert.equal(seatOf(s, A(1))!.pocket, Math.floor(total / 2));
  assert.equal(seatOf(s, A(4))!.absences, 1);
  assertConserved(s);
  assert.equal(s.stage.kind, "final");
  assert.equal(s.stage.phase, "talk");
});

test("Oferta anulada si aceptan todos: nadie se va, se quema 10 %, y con el mazo vacío sigue un Voto", () => {
  let s = createAleph(SEED, seats(4), { deck: ["offer"] });
  s = allDecide(s, { type: "contribute" });
  const pot = s.pot;
  s = allDecide(s, { type: "accept" });
  const r = s.results[1];
  assert.equal(r.voided, true);
  assert.deepEqual(r.accepted, seats(4));
  assert.equal(aliveSeats(s).length, 4);
  const burn = Math.floor(pot * 0.1);
  assert.equal(r.potAfter, pot - burn - Math.floor((pot - burn) * 0.05));
  assertConserved(s);
  assert.equal(s.stage.kind, "vote"); // mazo agotado con 4 vivos → Voto
});

test("Voto: el más votado se va con su bolsillo; ausente = voto en contra propio; se publican conteos, no votantes", () => {
  let s = createAleph(SEED, seats(4), { deck: ["vote"] });
  s = act(s, A(2), { type: "keep" }); // A2 guarda 160
  s = end(s);
  s = skipTalk(s);
  s = act(s, A(1), { type: "vote", target: A(2) });
  s = act(s, A(3), { type: "vote", target: A(2) });
  s = act(s, A(4), { type: "vote", target: A(1) });
  s = end(s); // A2 ausente → un voto en contra propio → 3
  const r = s.results[1];
  assert.deepEqual(r.votes, { [A(1)]: 1, [A(2)]: 3, [A(3)]: 0, [A(4)]: 0 });
  assert.equal(r.eliminated, A(2));
  assert.ok(!("voters" in r) && !("decisions" in r));
  assert.equal(seatOf(s, A(2))!.status, "voted_out");
  assert.equal(seatOf(s, A(2))!.pocket, 160);
  assertConserved(s);
  assert.equal(aliveSeats(s).length, 3);
});

test("Voto empatado: se va el de bolsillo más grande; después el que acumuló más votos", () => {
  let s = createAleph(SEED, seats(4), { deck: ["vote", "vote", "vote"] });
  s = act(s, A(1), { type: "keep" });
  s = end(s);
  s = skipTalk(s);
  // 2-2 entre A1 y A2: A1 tiene bolsillo → se va A1.
  s = act(s, A(1), { type: "vote", target: A(2) });
  s = act(s, A(2), { type: "vote", target: A(1) });
  s = act(s, A(3), { type: "vote", target: A(1) });
  s = act(s, A(4), { type: "vote", target: A(2) });
  s = end(s);
  assert.equal(s.results[1].eliminated, A(1));
  // Quedan A2, A3, A4 con bolsillo 0. A2 acumula 2 votos previos; A3 y A4, 0.
  s = skipTalk(s);
  s = act(s, A(2), { type: "vote", target: A(3) });
  s = act(s, A(3), { type: "vote", target: A(4) });
  s = act(s, A(4), { type: "vote", target: A(2) });
  s = end(s); // 1-1-1 → se va el de más votos acumulados: A2
  assert.equal(s.results[2].eliminated, A(2));
  assert.equal(s.stage.kind, "final");
});

test("Voto empatado sin diferencias: decide el orden oculto de la semilla", () => {
  let s = createAleph(SEED, seats(4), { deck: ["vote"] });
  s = allDecide(s, { type: "contribute" });
  s = skipTalk(s);
  s = act(s, A(1), { type: "vote", target: A(2) });
  s = act(s, A(2), { type: "vote", target: A(1) });
  s = act(s, A(3), { type: "vote", target: A(4) });
  s = act(s, A(4), { type: "vote", target: A(3) });
  s = end(s);
  assert.equal(s.results[1].eliminated, s.tiebreak[0]);
});

test("Cerradura: fragmentos secretos por asiento, un intento, pasar con ready, abrir para todos premia de la caja", () => {
  let s = createAleph(SEED, seats(4), { deck: ["lock"] });
  s = allDecide(s, { type: "contribute" });
  assert.equal(s.stage.kind, "lock");
  assert.equal(s.stage.phase, "talk");
  assert.equal(s.stage.codeLength, 4);
  const frags = s.stage.fragments!;
  assert.deepEqual(Object.keys(frags).sort(), seats(4));
  assert.deepEqual(
    seats(4).map((a) => frags[a].pos),
    [0, 1, 2, 3],
  );
  const code = seats(4)
    .map((a) => frags[a].digit)
    .join("");
  assert.equal(code, s.stage.code);
  s = skipTalk(s);
  assert.throws(
    () => act(s, A(1), { type: "submit", code: "123", intent: "all" }),
    /invalid code length/,
  );
  s = act(s, A(1), { type: "submit", code, intent: "all" });
  assert.throws(() => act(s, A(1), { type: "submit", code, intent: "me" }), /already decided/);
  s = act(s, A(2), { type: "submit", code: code === "0000" ? "0001" : "0000", intent: "all" });
  s = act(s, A(3), { type: "ready" }); // pasa
  assert.equal(phaseComplete(s), null);
  s = act(s, A(4), { type: "ready" });
  assert.equal(phaseComplete(s), "all_acted");
  const pot = s.pot;
  const box = s.box;
  s = end(s, "all_acted");
  const r = s.results[1];
  assert.equal(r.code, code);
  assert.deepEqual(r.solvers, [A(1)]);
  assert.deepEqual(r.traitors, []);
  const bonus = Math.min(box, Math.floor(pot * 0.2));
  assert.equal(r.bonus, bonus);
  assert.equal(r.potAfter, pot + bonus - Math.floor((pot + bonus) * 0.05));
  assert.equal(seatOf(s, A(3))!.absences, 0, "pasar en la Cerradura no es ausencia");
  assertConserved(s);
});

test("Cerradura: los traidores se reparten el 10 %; si nadie acierta se quema 10 %", () => {
  let s = createAleph(SEED, seats(4), { deck: ["lock", "lock"] });
  s = allDecide(s, { type: "contribute" });
  s = skipTalk(s);
  const code = s.stage.code!;
  const pot = s.pot;
  s = act(s, A(1), { type: "submit", code, intent: "me" });
  s = act(s, A(2), { type: "submit", code, intent: "me" });
  s = act(s, A(3), { type: "submit", code, intent: "all" });
  s = end(s);
  let r = s.results[1];
  assert.deepEqual(r.solvers, [A(1), A(2), A(3)]);
  assert.deepEqual(r.traitors, [A(1), A(2)]);
  assert.equal(r.bonus, undefined);
  const each = Math.floor(Math.floor(pot * 0.1) / 2);
  assert.equal(r.eachGot, each);
  assert.equal(seatOf(s, A(1))!.pocket, each);
  assert.equal(seatOf(s, A(3))!.pocket, 0);
  assertConserved(s);
  // Segunda Cerradura: nadie intenta (vence el plazo).
  s = skipTalk(s);
  const pot2 = s.pot;
  s = end(s);
  r = s.results[2];
  assert.equal(r.failed, true);
  const burned = Math.floor(pot2 * 0.1);
  assert.equal(r.potAfter, pot2 - burned - Math.floor((pot2 - burned) * 0.05));
  assertConserved(s);
});

test("Final: dividir/dividir, robar/dividir (ausente divide), robar/robar; sin decaimiento; tabla suma el total", () => {
  const setup = () => {
    let s = createAleph(SEED, seats(4), { deck: ["offer"] });
    s = allDecide(s, { type: "contribute" });
    s = act(s, A(3), { type: "accept" });
    s = act(s, A(4), { type: "accept" });
    s = end(s); // quedan A1 y A2 → Final
    assert.equal(s.stage.kind, "final");
    return skipTalk(s);
  };
  let s = setup();
  const pot = s.pot;
  const box = s.box;
  s = act(s, A(1), { type: "split" });
  s = act(s, A(2), { type: "split" });
  s = end(s);
  assert.equal(s.over, true);
  assert.equal(s.pot, 0);
  assert.equal(seatOf(s, A(1))!.pocket, Math.floor(pot / 2));
  assert.equal(seatOf(s, A(1))!.status, "finished");
  assert.equal(s.results[s.results.length - 1].decay, undefined);
  assertConserved(s);
  assert.equal(
    Object.values(s.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
  assert.throws(() => act(s, A(1), { type: "say", text: "hola" }), /room already over/);

  s = setup();
  s = act(s, A(1), { type: "steal" });
  s = end(s); // A2 ausente → divide → A1 se lleva todo
  assert.equal(seatOf(s, A(1))!.pocket, pot);
  assert.equal(seatOf(s, A(2))!.pocket, 0);
  assert.deepEqual(s.results[s.results.length - 1].choices, { [A(1)]: "steal", [A(2)]: "split" });

  s = setup();
  s = act(s, A(1), { type: "steal" });
  s = act(s, A(2), { type: "steal" });
  s = end(s);
  assert.equal(s.box, box + pot);
  assert.equal(seatOf(s, A(1))!.pocket, 0);
  const each = Math.floor((box + pot) / 4);
  assert.equal(s.payouts![A(1)], each);
  assert.equal(
    Object.values(s.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
});

test("director: un solo vivo se lleva el pozo; sin vivos, el pozo va a la caja y se reparte", () => {
  let s = createAleph(SEED, seats(4), { deck: ["offer"] });
  s = allDecide(s, { type: "contribute" });
  const pot = s.pot;
  const total = s.stage.offerTotal!;
  for (const a of [A(1), A(2), A(3)]) s = act(s, a, { type: "accept" });
  s = end(s);
  assert.equal(s.over, true);
  // Orden del director: efecto de la etapa → abandono → decaimiento → ¿vivos?
  // El sobreviviente cobra el pozo YA decaído (spec, "El director", pasos 1-4).
  const potLeft = pot - Math.floor(total / 3) * 3;
  const decay = Math.floor(potLeft * 0.05);
  assert.equal(s.results[1].decay, decay);
  assert.equal(seatOf(s, A(4))!.pocket, potLeft - decay);
  assert.equal(seatOf(s, A(4))!.status, "finished");
  assertConserved(s);

  s = createAleph(SEED, seats(4), { deck: ["offer"] });
  s = end(s); // Reparto: todos ausentes (aportan; ausencia 1)
  s = end(s); // Oferta: todos ausentes (rechazan; ausencia 2) → abandonan todos
  assert.equal(s.over, true);
  assert.equal(s.pot, 0);
  assert.deepEqual(s.results[1].abandoned, seats(4));
  assert.equal(s.payouts![A(1)], 1000);
  assert.equal(
    Object.values(s.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
});

test("abandono: dos ausencias seguidas eliminan (bolsillo al pozo); decidir corta la racha; en la Final no se evalúa", () => {
  let s = createAleph(SEED, seats(4), { deck: ["vote", "offer"] });
  // Reparto: A1 guarda; A2 y A3 aportan; A4 ausente (1).
  s = act(s, A(1), { type: "keep" });
  s = act(s, A(2), { type: "contribute" });
  s = act(s, A(3), { type: "contribute" });
  s = end(s);
  // Voto: A1 ausente (1); A4 vota (corta su racha). Sale A2.
  s = skipTalk(s);
  s = act(s, A(2), { type: "vote", target: A(3) });
  s = act(s, A(3), { type: "vote", target: A(2) });
  s = act(s, A(4), { type: "vote", target: A(2) });
  s = end(s);
  assert.equal(s.results[1].eliminated, A(2));
  assert.equal(seatOf(s, A(4))!.absences, 0);
  assert.equal(seatOf(s, A(1))!.absences, 1);
  // Oferta: A1 ausente (2) → abandona; A3 rechaza; A4 ausente (1).
  const potBefore = s.pot;
  s = act(s, A(3), { type: "decline" });
  s = end(s);
  const r = s.results[2];
  assert.deepEqual(r.abandoned, [A(1)]);
  assert.equal(seatOf(s, A(1))!.status, "abandoned");
  assert.equal(seatOf(s, A(1))!.pocket, 0);
  assert.equal(r.potAfter, potBefore + 160 - Math.floor((potBefore + 160) * 0.05));
  assert.equal(seatOf(s, A(4))!.absences, 1);
  assert.equal(seatOf(s, A(4))!.status, "alive");
  assertConserved(s);
  // Quedan A3 y A4 → Final. A3 ausente: divide por defecto y NO abandona.
  assert.equal(s.stage.kind, "final");
  s = skipTalk(s);
  s = act(s, A(4), { type: "split" });
  s = end(s);
  assert.equal(s.over, true);
  assert.equal(seatOf(s, A(3))!.status, "finished");
  assertConserved(s);
});
