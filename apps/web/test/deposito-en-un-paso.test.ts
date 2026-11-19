// Depositar en UNA confirmación: aprobar el USDC y abrir (o unirse a) la
// partida, mandados juntos a la wallet como un lote atómico (EIP-5792,
// `wallet_sendCalls`). Antes eran dos pedidos seguidos: con el QR, el segundo
// quedaba trabado en el celular y la mesa se colgaba en "Entrando a la
// partida…".
//
// Acá se prueban las dos piezas puras: cuándo la wallet sabe hacer un lote
// atómico (según lo que declara en `wallet_getCapabilities`) y qué llamadas
// lleva el lote.
//
// Correr: node --import tsx --test apps/web/test/deposito-en-un-paso.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { canBatchAtomically, fundCalls } from "../app/lib/deposito-en-un-paso.js";
import { escrowAbi, erc20Abi } from "../app/lib/escrow.js";

const CHAIN = 84532;
const USDC = "0xBE3A57a90548b336F5EBF997E6DA6d3DC64EE137" as const;
const ESCROW = "0x8968dfcf16d9542320B6Fd7c857F9f2c5eE19938" as const;
const MATCH = `0x${"ab".repeat(32)}` as const;
const SEAT = `0x${"cd".repeat(65)}` as const;
const TERMS = { fundDeadline: 1_800_000_000, playDeadline: 1_800_009_000 };

test("lote atómico: la wallet lo declara soportado o listo (EIP-5792 v2)", () => {
  assert.equal(canBatchAtomically({ atomic: { status: "supported" } }, CHAIN), true);
  // "ready": la cuenta puede pasar a cuenta inteligente en el mismo pedido
  // (MetaMask con EIP-7702); también vale.
  assert.equal(canBatchAtomically({ atomic: { status: "ready" } }, CHAIN), true);
  assert.equal(canBatchAtomically({ atomic: { status: "unsupported" } }, CHAIN), false);
});

test("lote atómico: también con las capacidades agrupadas por red", () => {
  assert.equal(canBatchAtomically({ [CHAIN]: { atomic: { status: "supported" } } }, CHAIN), true);
  // Algunas wallets usan la red en hexa como clave.
  assert.equal(canBatchAtomically({ "0x14a34": { atomic: { status: "ready" } } }, CHAIN), true);
  // Soportado en OTRA red no sirve.
  assert.equal(canBatchAtomically({ 1: { atomic: { status: "supported" } } }, CHAIN), false);
});

test("lote atómico: la forma vieja (atomicBatch) todavía se entiende", () => {
  assert.equal(canBatchAtomically({ atomicBatch: { supported: true } }, CHAIN), true);
  assert.equal(canBatchAtomically({ atomicBatch: { supported: false } }, CHAIN), false);
});

test("lote atómico: sin capacidades declaradas, dos pasos como siempre", () => {
  assert.equal(canBatchAtomically(undefined, CHAIN), false);
  assert.equal(canBatchAtomically(null, CHAIN), false);
  assert.equal(canBatchAtomically({}, CHAIN), false);
  assert.equal(canBatchAtomically("basura", CHAIN), false);
});

test("el lote del que abre: aprobar el monto EXACTO y después abrir", () => {
  const calls = fundCalls({
    usdc: USDC,
    escrow: ESCROW,
    betUsdc: 1,
    needApprove: true,
    role: "p1",
    matchId: MATCH,
    seatSig: SEAT,
    terms: TERMS,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].to, USDC);
  const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
  assert.equal(approve.functionName, "approve");
  assert.deepEqual(approve.args, [ESCROW, 1_000_000n]);
  assert.equal(calls[1].to, ESCROW);
  const open = decodeFunctionData({ abi: escrowAbi, data: calls[1].data });
  assert.equal(open.functionName, "open");
  assert.deepEqual(open.args, [
    MATCH,
    1_000_000n,
    BigInt(TERMS.fundDeadline),
    BigInt(TERMS.playDeadline),
    SEAT,
  ]);
});

test("el lote del que se une: aprobar y después unirse", () => {
  const calls = fundCalls({
    usdc: USDC,
    escrow: ESCROW,
    betUsdc: 5,
    needApprove: true,
    role: "p2",
    matchId: MATCH,
    seatSig: SEAT,
  });
  assert.equal(calls.length, 2);
  const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
  assert.deepEqual(approve.args, [ESCROW, 5_000_000n]);
  const join = decodeFunctionData({ abi: escrowAbi, data: calls[1].data });
  assert.equal(join.functionName, "join");
  assert.deepEqual(join.args, [MATCH, SEAT]);
});

test("con la aprobación ya hecha, el lote es solo el depósito", () => {
  const calls = fundCalls({
    usdc: USDC,
    escrow: ESCROW,
    betUsdc: 1,
    needApprove: false,
    role: "p1",
    matchId: MATCH,
    seatSig: SEAT,
    terms: TERMS,
  });
  assert.equal(calls.length, 1);
  assert.equal(decodeFunctionData({ abi: escrowAbi, data: calls[0].data }).functionName, "open");
});

test("el que abre sin plazos firmados no arma lote", () => {
  assert.throws(() =>
    fundCalls({
      usdc: USDC,
      escrow: ESCROW,
      betUsdc: 1,
      needApprove: true,
      role: "p1",
      matchId: MATCH,
      seatSig: SEAT,
    }),
  );
});
