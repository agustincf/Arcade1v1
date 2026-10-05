// W6: el emparejamiento de una mesa paga respeta el chequeo del escrow. Antes
// del primer chequeo (o con el escrow que no coincide) no se firma ningún
// asiento: la mesa paga se rechaza con el motivo, y la ladder gratis sigue.
//
// Correr: node --import tsx --test apps/server/test/escrow-gate-matchmake.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

// Escrow "activo", todo ANTES de importar (onchain.ts y sign.ts leen estas
// variables al cargarse). La clave es la cuenta #1 de anvil, pública y sin valor.
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "31337";
process.env.RPC_URL = "http://127.0.0.1:9";
process.env.ARBITER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const { matchmake } = await import("../src/matchmaking.js");
const { escrowVerified } = await import("./escrow-ok.js");

const A = "0x" + "1".repeat(40);

test("sin chequear el escrow, la mesa paga se rechaza y la gratis anda", async () => {
  await assert.rejects(matchmake("2048", 1, A), /paid tables disabled/);
  const free = await matchmake("2048", 0, A);
  assert.equal(free.stake, 0);
});

test("con el escrow verificado, la mesa paga empareja y trae el asiento firmado", async () => {
  await escrowVerified();
  const v = await matchmake("2048", 1, A);
  assert.equal(v.stake, 1);
  assert.ok(v.seatSig, "el asiento viene firmado");
});
