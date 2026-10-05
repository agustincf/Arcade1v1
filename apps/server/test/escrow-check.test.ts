// W6 (pre-auditoría INT-2 y F13): el árbitro comprueba contra la cadena que el
// escrow es el que cree —red, contrato, su propio rol, comisión y mesas— antes
// de firmar asientos de mesas pagas. Si algo no coincide, o todavía no lo pudo
// leer, cierra las mesas pagas (no el servidor: la ladder gratis sigue) y lo
// vuelve a mirar solo, así que un arreglo on-chain (p. ej. rotar el árbitro con
// setArbiter) las reabre sin reiniciar.
//
// Correr: node --import tsx --test apps/server/test/escrow-check.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareEscrow,
  verifyEscrow,
  paidTableClosed,
  escrowGate,
  startEscrowCheck,
  stopEscrowCheck,
  type EscrowExpect,
  type EscrowFacts,
} from "../src/escrow-check.js";

const EXPECT: EscrowExpect = {
  chainId: 8453,
  escrow: "0x" + "e".repeat(40),
  arbiter: "0x" + "a".repeat(40),
  feeBps: 1500,
  stakes: [1, 2, 5, 10],
};

/** Lo que la cadena contesta cuando todo coincide. */
const GOOD: EscrowFacts = {
  chainId: 8453,
  hasCode: true,
  arbiter: "0x" + "A".repeat(40), // la cadena devuelve checksum: se compara sin mayúsculas
  feeBps: 1500,
  allowedStakes: [1, 2, 5, 10],
};

test("todo coincide: ningún problema ni mesa cerrada", () => {
  assert.deepEqual(compareEscrow(EXPECT, GOOD), { blocking: [], closedStakes: [] });
});

test("otra red, sin código, otro árbitro u otra comisión: bloquean todas las mesas pagas", () => {
  const cases: [Partial<EscrowFacts>, RegExp][] = [
    [{ chainId: 84532 }, /84532/],
    [{ hasCode: false }, /no contract/],
    [{ arbiter: "0x" + "b".repeat(40) }, /arbiter/],
    [{ feeBps: 1000 }, /fee/],
  ];
  for (const [patch, why] of cases) {
    const r = compareEscrow(EXPECT, { ...GOOD, ...patch });
    assert.equal(r.blocking.length, 1, JSON.stringify(patch));
    assert.match(r.blocking[0], why);
  }
});

test("una mesa que el contrato no permite se cierra sola; las demás siguen", () => {
  const r = compareEscrow(EXPECT, { ...GOOD, allowedStakes: [1, 2, 10] });
  assert.deepEqual(r, { blocking: [], closedStakes: [5] });
});

test("antes del primer chequeo, o si el nodo no contesta, las mesas pagas están cerradas", async () => {
  assert.equal(escrowGate().status, "unverified");
  assert.match(paidTableClosed(1) ?? "", /disabled/);

  await verifyEscrow(EXPECT, async () => {
    throw new Error("fetch failed");
  });
  assert.equal(escrowGate().status, "unverified");
  assert.match(paidTableClosed(1) ?? "", /disabled.*could not read/);
});

test("chequeo OK abre las mesas; una mesa no permitida queda cerrada con su motivo", async () => {
  await verifyEscrow(EXPECT, async () => ({ ...GOOD, allowedStakes: [1, 2, 10] }));
  assert.equal(escrowGate().status, "ok");
  assert.equal(paidTableClosed(1), null);
  assert.equal(paidTableClosed(10), null);
  assert.match(paidTableClosed(5) ?? "", /disabled.*5/);
});

test("si no coincide, cierra todo; cuando la cadena se arregla, reabre sin reiniciar", async () => {
  await verifyEscrow(EXPECT, async () => ({ ...GOOD, arbiter: "0x" + "b".repeat(40) }));
  assert.equal(escrowGate().status, "blocked");
  assert.match(paidTableClosed(1) ?? "", /disabled.*arbiter/);

  // El dueño corrió setArbiter: el próximo chequeo periódico lo ve.
  await verifyEscrow(EXPECT, async () => GOOD);
  assert.equal(escrowGate().status, "ok");
  assert.equal(paidTableClosed(1), null);
});

test("un corte del nodo después de verificar no cambia el veredicto", async () => {
  // Red, contrato y rol no cambian en un minuto: un parpadeo del RPC no tiene
  // por qué cerrar y reabrir las mesas.
  await verifyEscrow(EXPECT, async () => GOOD);
  await verifyEscrow(EXPECT, async () => {
    throw new Error("fetch failed");
  });
  assert.equal(escrowGate().status, "ok");
  assert.equal(paidTableClosed(1), null);
});

test("el reloj chequea al arrancar, repite, y solo avisa en el log cuando cambia", async () => {
  let calls = 0;
  let arbiter = GOOD.arbiter;
  const logs: string[] = [];
  startEscrowCheck(() => EXPECT, {
    everyMs: 5,
    read: async () => {
      calls++;
      return { ...GOOD, arbiter };
    },
    log: (m) => logs.push(m),
  });
  await new Promise((r) => setTimeout(r, 40));
  arbiter = "0x" + "b".repeat(40); // alguien cambió el árbitro on-chain
  await new Promise((r) => setTimeout(r, 40));
  await stopEscrowCheck();
  const after = calls;
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(after >= 3, `chequeó varias veces (${after})`);
  assert.equal(calls, after, "frenado, no vuelve a leer");
  assert.equal(logs.length, 2, logs.join("\n"));
  assert.match(logs[0], /ok/);
  assert.match(logs[1], /arbiter/);
  assert.equal(escrowGate().status, "blocked");
});
