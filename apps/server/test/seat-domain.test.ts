// El asiento que firma el árbitro tiene que poder verificarse con el dominio y
// los tipos que publica el game-sdk: es lo que usan los agentes para comprobar,
// antes de pagar, que el asiento es para el contrato y la red que fijó su
// operador. Si el árbitro y el game-sdk se desvían, ningún agente deposita.
//
// Correr: node --import tsx --test apps/server/test/seat-domain.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Hex } from "viem";

// Todo ANTES de importar: sign.ts lee estas variables al cargarse. La clave es
// la cuenta #1 de anvil, pública y sin valor (la misma de offline-env.ts).
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "31337";
process.env.RPC_URL = "http://127.0.0.1:9";
process.env.ARBITER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const { signSeat, arbiterAddress } = await import("../src/sign.js");
const { SEAT_TYPES, seatDomain } = await import("@arcade1v1/game-sdk/escrow1v1");

test("el asiento que firma el árbitro se recupera con el dominio del game-sdk", async () => {
  const matchId = ("0x" + "a".repeat(64)) as Hex;
  const player = ("0x" + "1".repeat(40)) as Hex;
  const terms = { stake: 1_000_000n, fundDeadline: 1_800_000_000n, playDeadline: 1_800_003_000n };
  const sig = await signSeat(matchId, player, terms);
  const signer = await recoverTypedDataAddress({
    domain: seatDomain(31337, process.env.ESCROW_ADDRESS as Hex),
    types: SEAT_TYPES,
    primaryType: "Seat",
    message: { matchId, player, ...terms },
    signature: sig,
  });
  assert.equal(signer.toLowerCase(), arbiterAddress().toLowerCase());
});
