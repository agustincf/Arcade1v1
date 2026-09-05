// Motor de La Bóveda. Todo es determinístico por semilla: el árbitro y
// cualquiera que lea el registro público tienen que re-simular EXACTAMENTE lo
// mismo. Correr: node --import tsx --test packages/game-sdk/test/vault.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVault, aliveSeats, type StageKind } from "@arcade1v1/game-sdk/vault";
import { SEED, A, seats, seedN } from "./vault-helpers";

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
