// El cambio de red del 1v1 (testnet → mainnet) sin partidas de plata colgadas
// (network-switch.ts): el árbitro anota la red con la que trabaja, y si arranca
// con otra mientras quedan mesas de plata de la anterior sin cerrar, no abre
// mesas de plata en la nueva hasta que terminen. /health lo dice.
//
// Correr: node --import tsx --test apps/server/test/cambio-de-red.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

// Escrow "activo", todo ANTES de importar (onchain.ts y sign.ts leen estas
// variables al cargarse). La clave es la cuenta #1 de anvil, pública y sin valor.
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "31337";
process.env.RPC_URL = "http://127.0.0.1:9";
process.env.ARBITER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const { matchmake, openPaidMatches } = await import("../src/matchmaking.js");
const { escrowVerified } = await import("./escrow-ok.js");
const { healthBody } = await import("../src/health.js");
const ns = await import("../src/network-switch.js");

const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);
const VIEJA = ns.networkTag(84532, "0x" + "a".repeat(40));
const NUEVA = ns.networkTag(8453, "0x" + "B".repeat(40));

/** Un Redis de juguete y lo que se escribió en el log. */
function deps(stored: string | null, openPaid: () => string[]) {
  const kv = new Map<string, string>();
  if (stored !== null) kv.set(ns.NETWORK_KEY, stored);
  const logs: string[] = [];
  const writes: string[] = [];
  return {
    kv,
    logs,
    writes,
    d: {
      current: NUEVA,
      read: async (k: string) => kv.get(k) ?? null,
      write: async (k: string, v: string) => {
        kv.set(k, v);
        writes.push(v);
      },
      openPaid,
      log: (m: string) => void logs.push(m),
    },
  };
}

test("networkTag: cadena y contrato, con el contrato en minúsculas", () => {
  assert.equal(NUEVA, `8453:0x${"b".repeat(40)}`);
});

test("primer arranque (nada anotado): anota la red y no frena nada", async () => {
  ns.resetNetworkSwitchForTest();
  const t = deps(null, () => ["0xviejo"]);
  await ns.reviewNetworkSwitch(t.d);
  assert.equal(t.kv.get(ns.NETWORK_KEY), NUEVA);
  assert.equal(ns.networkSwitchPending(), null);
});

test("misma red: no escribe ni frena", async () => {
  ns.resetNetworkSwitchForTest();
  const t = deps(NUEVA, () => ["0xabierta"]);
  await ns.reviewNetworkSwitch(t.d);
  assert.deepEqual(t.writes, []);
  assert.equal(ns.networkSwitchPending(), null);
});

test("otra red y nada abierto: anota la nueva y abre", async () => {
  ns.resetNetworkSwitchForTest();
  const t = deps(VIEJA, () => []);
  await ns.reviewNetworkSwitch(t.d);
  assert.equal(t.kv.get(ns.NETWORK_KEY), NUEVA);
  assert.equal(ns.networkSwitchPending(), null);
  assert.match(t.logs[0], /completo/);
});

test("otra red con partidas abiertas: frena, avisa una vez con cuáles, y abre cuando terminan", async () => {
  ns.resetNetworkSwitchForTest();
  let abiertas = ["0xuno", "0xdos"];
  const t = deps(VIEJA, () => abiertas);
  await ns.reviewNetworkSwitch(t.d);
  assert.deepEqual(ns.networkSwitchPending(), { from: VIEJA, to: NUEVA, open: 2 });
  assert.deepEqual(t.writes, [], "la red vieja sigue anotada");
  assert.match(t.logs[0], /0xuno, 0xdos/);
  assert.match(t.logs[0], /refundUnfunded\/refundExpired/);

  await ns.reviewNetworkSwitch(t.d); // misma situación: no repite el aviso
  assert.equal(t.logs.length, 1);

  abiertas = [];
  await ns.reviewNetworkSwitch(t.d);
  assert.equal(ns.networkSwitchPending(), null);
  assert.equal(t.kv.get(ns.NETWORK_KEY), NUEVA);
  assert.match(t.logs.at(-1)!, /completo/);
});

test("árbitro: paidOpen cuenta las mesas de plata abiertas; durante el cambio no abre mesas de plata y la gratis sigue", async () => {
  ns.resetNetworkSwitchForTest();
  await escrowVerified();
  const v = await matchmake("2048", 1, A);
  assert.ok(openPaidMatches().includes(v.matchId), "la mesa esperando rival cuenta");
  const h = healthBody();
  assert.equal(h.escrow, "ok");
  assert.equal(h.paidOpen, openPaidMatches().length);
  assert.equal(h.networkSwitch, undefined);

  const t = deps(VIEJA, () => ["0xviejo"]);
  await ns.reviewNetworkSwitch(t.d);
  await assert.rejects(matchmake("2048", 2, B), /previous network/);
  const free = await matchmake("2048", 0, B);
  assert.equal(free.stake, 0);
  const h2 = healthBody();
  assert.equal(h2.escrow, "blocked");
  assert.deepEqual(h2.networkSwitch, { from: VIEJA, to: NUEVA, open: 1 });

  t.d.openPaid = () => [];
  await ns.reviewNetworkSwitch(t.d);
  assert.equal(healthBody().escrow, "ok");
  const pagada = await matchmake("2048", 2, B);
  assert.equal(pagada.stake, 2);
});

test("paidStillOpen: qué cuenta como mesa de plata sin cerrar en la cadena", async () => {
  const { paidStillOpen } = await import("../src/matchmaking.js");
  const base = { stake: 1, winner: A } as Parameters<typeof paidStillOpen>[0];
  const caso = (x: object) => paidStillOpen({ ...base, ...x } as typeof base);
  assert.equal(caso({ stake: 0, status: "waiting" }), false, "la gratis nunca");
  assert.equal(caso({ status: "waiting" }), true, "esperando rival");
  assert.equal(caso({ status: "ready" }), true, "jugándose");
  assert.equal(caso({ status: "draw", refund: "pending" }), true, "reembolso sin confirmar");
  assert.equal(caso({ status: "draw", refund: "done" }), false);
  assert.equal(caso({ status: "draw", refund: "none" }), false);
  assert.equal(caso({ status: "settled" }), true, "decidida y sin firmar");
  assert.equal(
    caso({ status: "settled", signature: "0x1", signatureDeadline: 1 }),
    true,
    "falta liquidar",
  );
  assert.equal(
    caso({ status: "settled", signature: "0x1", signatureDeadline: 1, settleTx: "0x2" }),
    false,
  );
  assert.equal(
    caso({ status: "settled", signature: "0x1", signatureDeadline: 1, settleOutcome: "external" }),
    false,
  );
  assert.equal(
    caso({ status: "settled", signature: "0x1" }),
    false,
    "firma de la v1: la cobró el ganador",
  );
});
