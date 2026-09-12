// La conversión de la tabla de unidades a USDC pasa SOLO en el borde y tiene
// que cerrar exacto con el contrato: Σ amounts + comisión + polvo == depositado,
// y el polvo es menor que N (el contrato exige `net - Σ < N`).
// Correr: node --import tsx --test packages/game-sdk/test/aleph-usdc.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { usdcPayoutTable, stakeToUnits, ALEPH_ESCROW_STATUS, ALEPH_RULES } from "../src/aleph";
import { mulberry32 } from "../src/replay";
import { A, seats } from "./aleph-helpers";

/** Reparte 1000·N unidades entre N asientos al azar (enteros, suman exacto). */
function randomPayouts(seats: string[], rnd: () => number): Record<string, number> {
  const total = ALEPH_RULES.UNITS_PER_SEAT * seats.length;
  const cuts = Array.from({ length: seats.length - 1 }, () => Math.floor(rnd() * (total + 1))).sort(
    (a, b) => a - b,
  );
  const out: Record<string, number> = {};
  let prev = 0;
  seats.forEach((a, i) => {
    const next = i === seats.length - 1 ? total : cuts[i];
    out[a] = next - prev;
    prev = next;
  });
  return out;
}

test("stakeToUnits: 2 USDC son 2_000_000 micro-USDC; 0 es 0n", () => {
  assert.equal(stakeToUnits(2), 2_000_000n);
  assert.equal(stakeToUnits(0), 0n);
  assert.equal(stakeToUnits(0.5), 500_000n);
});

test("los números de la suite Solidity: 1700/1100/700/500 con 15 % sobre 8 USDC", () => {
  const roomSeats = seats(4);
  const payouts = {
    [roomSeats[0]]: 1700,
    [roomSeats[1]]: 1100,
    [roomSeats[2]]: 700,
    [roomSeats[3]]: 500,
  };
  const t = usdcPayoutTable(roomSeats, payouts, 2_000_000n, 1500);
  assert.equal(t.pot, 8_000_000n);
  assert.equal(t.fee, 1_200_000n);
  assert.equal(t.net, 6_800_000n);
  assert.deepEqual(t.amounts, [2_890_000n, 1_870_000n, 1_190_000n, 850_000n]);
  assert.equal(t.dust, 0n);
});

test("propiedad: Σ amounts + fee + dust == pot y dust < N, para 400 salas al azar", () => {
  const rnd = mulberry32(20260911);
  for (let k = 0; k < 400; k++) {
    const n = 4 + Math.floor(rnd() * 5); // 4..8
    const roomSeats = seats(n);
    const payouts = randomPayouts(roomSeats, rnd);
    const feeBps = [0, 1500, 2000][Math.floor(rnd() * 3)];
    const t = usdcPayoutTable(roomSeats, payouts, 2_000_000n, feeBps);
    const paid = t.amounts.reduce((x, y) => x + y, 0n);
    assert.equal(paid + t.fee + t.dust, t.pot, `sala ${k}: la cuenta cierra exacta`);
    assert.ok(t.dust < BigInt(n), `sala ${k}: polvo ${t.dust} < N=${n}`);
    assert.ok(t.amounts.every((a) => a >= 0n && a <= t.net));
    // Monótona: más unidades nunca cobran menos USDC.
    const byUnits = roomSeats
      .map((a, i) => [payouts[a], t.amounts[i]] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < byUnits.length; i++) assert.ok(byUnits[i][1] >= byUnits[i - 1][1]);
  }
});

test("las addresses se buscan en minúsculas y una tabla vacía se rechaza", () => {
  // A(10..13) trae dígitos a-f a propósito: con los índices 1..4 que arma
  // `seats` (todo 0-9) .toUpperCase() solo afecta la "x" del prefijo, que el
  // .replace("0X","0x") deshace enseguida — el round-trip de mayúsculas
  // quedaba en verde aunque se borrara el .toLowerCase() de usdcPayoutTable.
  const lower = [A(10), A(11), A(12), A(13)];
  const mixedCase = lower.map((a) => a.toUpperCase().replace("0X", "0x"));
  const payouts = Object.fromEntries(lower.map((a) => [a, 1000]));
  const t = usdcPayoutTable(mixedCase, payouts, 2_000_000n, 1500);
  assert.deepEqual(t.amounts, [1_700_000n, 1_700_000n, 1_700_000n, 1_700_000n]);
  assert.throws(() => usdcPayoutTable(seats(4), {}, 2_000_000n, 1500), /empty payout table/);
});

test("el enum del contrato está copiado en orden", () => {
  assert.deepEqual(ALEPH_ESCROW_STATUS, {
    None: 0,
    Funding: 1,
    Funded: 2,
    Settled: 3,
    Refunded: 4,
  });
});
