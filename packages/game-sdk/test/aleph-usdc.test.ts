// La conversión de la tabla de unidades a USDC pasa SOLO en el borde y tiene
// que cerrar exacto con el contrato: Σ amounts + comisión + polvo == depositado,
// y el polvo es menor que N (el contrato exige `net - Σ < N`).
// Correr: node --import tsx --test packages/game-sdk/test/aleph-usdc.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { usdcPayoutTable, stakeToUnits, ALEPH_ESCROW_STATUS, ALEPH_RULES } from "../src/aleph";

const seatsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));

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

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("stakeToUnits: 2 USDC son 2_000_000 micro-USDC; 0 es 0n", () => {
  assert.equal(stakeToUnits(2), 2_000_000n);
  assert.equal(stakeToUnits(0), 0n);
  assert.equal(stakeToUnits(0.5), 500_000n);
});

test("los números de la suite Solidity: 1700/1100/700/500 con 15 % sobre 8 USDC", () => {
  const seats = seatsOf(4);
  const payouts = { [seats[0]]: 1700, [seats[1]]: 1100, [seats[2]]: 700, [seats[3]]: 500 };
  const t = usdcPayoutTable(seats, payouts, 2_000_000n, 1500);
  assert.equal(t.pot, 8_000_000n);
  assert.equal(t.fee, 1_200_000n);
  assert.equal(t.net, 6_800_000n);
  assert.deepEqual(t.amounts, [2_890_000n, 1_870_000n, 1_190_000n, 850_000n]);
  assert.equal(t.dust, 0n);
});

test("propiedad: Σ amounts + fee + dust == pot y dust < N, para 400 salas al azar", () => {
  const rnd = mulberry(20260911);
  for (let k = 0; k < 400; k++) {
    const n = 4 + Math.floor(rnd() * 5); // 4..8
    const seats = seatsOf(n);
    const payouts = randomPayouts(seats, rnd);
    const feeBps = [0, 1500, 2000][Math.floor(rnd() * 3)];
    const t = usdcPayoutTable(seats, payouts, 2_000_000n, feeBps);
    const paid = t.amounts.reduce((x, y) => x + y, 0n);
    assert.equal(paid + t.fee + t.dust, t.pot, `sala ${k}: la cuenta cierra exacta`);
    assert.ok(t.dust < BigInt(n), `sala ${k}: polvo ${t.dust} < N=${n}`);
    assert.ok(t.amounts.every((a) => a >= 0n && a <= t.net));
    // Monótona: más unidades nunca cobran menos USDC.
    const byUnits = seats
      .map((a, i) => [payouts[a], t.amounts[i]] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < byUnits.length; i++) assert.ok(byUnits[i][1] >= byUnits[i - 1][1]);
  }
});

test("las addresses se buscan en minúsculas y una tabla vacía se rechaza", () => {
  const seats = seatsOf(4).map((a) => a.toUpperCase().replace("0X", "0x"));
  const payouts = Object.fromEntries(seats.map((a) => [a.toLowerCase(), 1000]));
  const t = usdcPayoutTable(seats, payouts, 2_000_000n, 1500);
  assert.deepEqual(t.amounts, [1_700_000n, 1_700_000n, 1_700_000n, 1_700_000n]);
  assert.throws(() => usdcPayoutTable(seatsOf(4), {}, 2_000_000n, 1500), /empty payout table/);
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
