// Motor de La Bóveda. Todo es determinístico por semilla: el árbitro y
// cualquiera que lea el registro público tienen que re-simular EXACTAMENTE lo
// mismo. Correr: node --import tsx --test packages/game-sdk/test/vault.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createVault,
  aliveSeats,
  applyEvent,
  phaseComplete,
  seatOf,
  VAULT_RULES,
  type StageKind,
} from "@arcade1v1/game-sdk/vault";
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
} from "./vault-helpers";

test("createVault: dinero inicial, primera etapa Reparto y asientos vivos", () => {
  const s = createVault(SEED, seats(4));
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

test("createVault: rechaza asientos o semilla inválidos", () => {
  assert.throws(() => createVault(SEED, seats(3)), /invalid seats/);
  assert.throws(() => createVault(SEED, seats(9)), /invalid seats/);
  assert.throws(() => createVault(SEED, [A(1), A(1), A(2), A(3)]), /invalid seats/);
  assert.throws(() => createVault(SEED, ["nope", A(2), A(3), A(4)]), /invalid seats/);
  assert.throws(() => createVault("0x1234", seats(4)), /invalid seed/);
});

test("mazo: composición por N, sin dos Ofertas seguidas, determinístico", () => {
  for (const n of [4, 5, 6, 7, 8]) {
    for (let i = 0; i < 60; i++) {
      const deck = createVault(seedN(i * 8 + n), seats(n)).deck;
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
  assert.deepEqual(createVault(SEED, seats(6)).deck, createVault(SEED, seats(6)).deck);
  const base = createVault(seedN(1), seats(8)).deck.join(",");
  const others = Array.from({ length: 20 }, (_, i) =>
    createVault(seedN(i + 2), seats(8)).deck.join(","),
  );
  assert.ok(
    others.some((d) => d !== base),
    "semillas distintas deberían barajar distinto",
  );
});

test("createVault con mazo forzado (para tests) lo respeta y valida", () => {
  const s = createVault(SEED, seats(4), { deck: ["offer", "lock"] });
  assert.deepEqual(s.deck, ["offer", "lock"]);
  assert.throws(() => createVault(SEED, seats(4), { deck: ["final"] }), /invalid deck/);
});

test("acciones: decisión única y del tipo de la etapa; mensajes con tope; susurro válido", () => {
  let s = createVault(SEED, seats(4));
  s = act(s, A(1), { type: "keep" });
  assert.deepEqual(s.stage.decisions[A(1)], { type: "keep" });
  assert.throws(() => act(s, A(1), { type: "contribute" }), /already decided/);
  assert.throws(() => act(s, A(2), { type: "accept" }), /not allowed now/);
  assert.throws(() => act(s, A(2), { type: "ready" }), /ready not allowed/);
  assert.throws(() => act(s, A(9), { type: "keep" }), /not a seat/);
  for (let i = 0; i < VAULT_RULES.MAX_MSGS_PER_PHASE; i++) {
    s = act(s, A(2), { type: "say", text: `m${i}` });
  }
  assert.throws(() => act(s, A(2), { type: "say", text: "de más" }), /message limit/);
  assert.throws(
    () => act(s, A(3), { type: "whisper", to: A(3), text: "yo" }),
    /invalid whisper target/,
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
  const s0 = createVault(SEED, seats(4));
  const s1 = act(s0, A(1), { type: "keep" });
  assert.deepEqual(s0.stage.decisions, {});
  assert.deepEqual(s1.stage.decisions, { [A(1)]: { type: "keep" } });
});

test("phaseComplete: decide cierra cuando todos los vivos decidieron", () => {
  let s = createVault(SEED, seats(4));
  assert.equal(phaseComplete(s), null);
  for (const a of seats(4).slice(0, 3)) s = act(s, a, { type: "contribute" });
  assert.equal(phaseComplete(s), null);
  s = act(s, A(4), { type: "keep" });
  assert.equal(phaseComplete(s), "all_acted");
});

test("Reparto: guardar/aportar, ausente aporta, premio de la caja, decaimiento y siguiente etapa", () => {
  let s = createVault(SEED, seats(4), { deck: ["vote"] });
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
  let s = createVault(SEED, seats(4), { deck: ["vote"] });
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
