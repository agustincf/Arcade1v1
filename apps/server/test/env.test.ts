// Las variables con las que el árbitro firma, leídas igual que las valida la
// guarda de arranque (pre-auditoría INT-3): recortadas, y un CHAIN_ID vacío o
// raro cae en testnet en TODOS lados (antes el dominio EIP-712 quedaba en 0).
//
// Correr: node --import tsx --test apps/server/test/env.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chainIdFromEnv, envValue } from "../src/env.js";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

test("envValue recorta espacios y saltos de línea", () => {
  assert.equal(envValue("X", env({ X: "  0xabc\n" })), "0xabc");
  assert.equal(envValue("X", env({})), "");
});

test("chainIdFromEnv: el entero, o testnet si falta o no sirve", () => {
  assert.equal(chainIdFromEnv(env({ CHAIN_ID: " 8453\n" })), 8453);
  assert.equal(chainIdFromEnv(env({ CHAIN_ID: "" })), 84532);
  assert.equal(chainIdFromEnv(env({})), 84532);
  assert.equal(chainIdFromEnv(env({ CHAIN_ID: "base" })), 84532);
  assert.equal(chainIdFromEnv(env({ CHAIN_ID: "-1" })), 84532);
});
