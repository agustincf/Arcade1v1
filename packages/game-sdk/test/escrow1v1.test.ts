// packages/game-sdk/test/escrow1v1.test.ts
// El contrato 1v1 (Escrow1v1) visto desde los agentes: el dominio EIP-712 del
// asiento, el ABI que usan para depositar y los estados de una partida. Si
// alguno de estos se desvía del contrato, el agente firmaría o leería otra
// cosa que la que el contrato verifica.
// Correr: node --import tsx --test packages/game-sdk/test/escrow1v1.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CIRCLE_USDC_BASE,
  ESCROW1V1_STATUS,
  SEAT_TYPES,
  escrow1v1Abi,
  escrow1v1MatchFeeAbi,
  seatDomain,
} from "@arcade1v1/game-sdk/escrow1v1";

const X = "0x8968dfcf16d9542320B6Fd7c857F9f2c5eE19938" as const;

test("seatDomain fija nombre y versión del contrato", () => {
  assert.deepEqual(seatDomain(84532, X), {
    name: "Arcade1v1Escrow",
    version: "2",
    chainId: 84532,
    verifyingContract: X,
  });
});

test("el ABI decodifica matches de 8 y de 9 salidas", () => {
  const eight = escrow1v1Abi.find((f) => f.type === "function" && f.name === "matches");
  assert.ok(eight && "outputs" in eight);
  assert.equal(eight.outputs.length, 8);
  const nine = escrow1v1MatchFeeAbi.find((f) => f.type === "function" && f.name === "matches");
  assert.ok(nine && "outputs" in nine);
  assert.equal(nine.outputs.length, 9);
  assert.equal(nine.outputs[8].type, "uint16");
  assert.equal(nine.outputs[8].name, "frozenFeeBps");
});

test("el ABI trae lo que usa un agente para depositar y cobrar", () => {
  const names = escrow1v1Abi.filter((f) => f.type === "function").map((f) => f.name);
  for (const n of [
    "open",
    "join",
    "matches",
    "arbiter",
    "usdc",
    "feeBps",
    "allowedStake",
    "owed",
    "withdraw",
  ]) {
    assert.ok(names.includes(n as never), `falta ${n}`);
  }
  const open = escrow1v1Abi.find((f) => f.type === "function" && f.name === "open");
  assert.ok(open && "inputs" in open);
  assert.deepEqual(
    open.inputs.map((i) => i.type),
    ["bytes32", "uint256", "uint64", "uint64", "bytes"],
  );
});

test("ESCROW1V1_STATUS sigue el enum del contrato", () => {
  assert.deepEqual(ESCROW1V1_STATUS, { None: 0, Open: 1, Funded: 2, Settled: 3, Refunded: 4 });
});

test("SEAT_TYPES ata partida, jugador, stake y plazos", () => {
  assert.deepEqual(
    SEAT_TYPES.Seat.map((f) => `${f.name}:${f.type}`),
    [
      "matchId:bytes32",
      "player:address",
      "stake:uint256",
      "fundDeadline:uint64",
      "playDeadline:uint64",
    ],
  );
});

test("CIRCLE_USDC_BASE es el USDC de Circle en Base", () => {
  assert.equal(CIRCLE_USDC_BASE, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
});
