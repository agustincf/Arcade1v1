// Abrir un intento en vivo en una mesa de plata exige el depósito on-chain, como
// el envío de puntaje. Si el nodo no contesta, se rechaza (falla cerrado) en vez
// de dejar jugar sin saber si hay plata adentro.
//
// Correr: node --import tsx --test apps/server/test/live-deposit.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

// Escrow "activo" apuntando a un RPC que no contesta. Todo ANTES de importar:
// onchain.ts y sign.ts leen estas variables al cargarse. La clave es la cuenta
// #1 de anvil, pública y sin valor (la misma de offline-env.ts).
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "31337";
process.env.RPC_URL = "http://127.0.0.1:9";
process.env.ARBITER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const { RULES_V } = await import("@arcade1v1/game-sdk/rules");
RULES_V.flappy = 2;
const { matchmake } = await import("../src/matchmaking.js");
const { liveStart } = await import("../src/live.js");

test("mesa de plata: sin poder leer el depósito on-chain no se abre el intento", async () => {
  const p1 = "0x" + "1".repeat(40);
  const m = await matchmake("flappy", 1, p1);
  await matchmake("flappy", 1, "0x" + "2".repeat(40));
  await assert.rejects(liveStart(m.matchId, p1), /could not verify your deposit on-chain/);
});
