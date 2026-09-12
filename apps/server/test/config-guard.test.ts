// Guarda de configuración de producción: no solo PRESENCIA de variables, también
// FORMATO. Un CHAIN_ID no numérico o una clave truncada arrancaban "OK" pero
// rompían los pagos en silencio — este test fija ese contrato.
//
// Correr: node --import tsx --test apps/server/test/config-guard.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { productionConfigErrors, parseTrustProxy } from "../src/config-guard.js";

const OK = {
  NODE_ENV: "production",
  ESCROW_ADDRESS: "0x" + "a".repeat(40),
  CHAIN_ID: "8453",
  ARBITER_PRIVATE_KEY: "0x" + "b".repeat(64),
  ALLOWED_ORIGIN: "https://arcade1v1.com",
  RPC_URL: "https://mainnet.base.org",
} as unknown as NodeJS.ProcessEnv;

test("fuera de producción no valida nada", () => {
  assert.deepEqual(productionConfigErrors({ NODE_ENV: "development" } as NodeJS.ProcessEnv), []);
});

test("producción sin escrow (demo) no exige config on-chain", () => {
  assert.deepEqual(productionConfigErrors({ NODE_ENV: "production" } as NodeJS.ProcessEnv), []);
  assert.deepEqual(
    productionConfigErrors({
      NODE_ENV: "production",
      ESCROW_ADDRESS: "0x" + "0".repeat(40),
    } as NodeJS.ProcessEnv),
    [],
  );
});

test("config on-chain completa y bien formada: sin errores", () => {
  assert.deepEqual(productionConfigErrors(OK), []);
});

test("faltan variables on-chain: un error por cada una", () => {
  const errs = productionConfigErrors({
    NODE_ENV: "production",
    ESCROW_ADDRESS: "0x" + "a".repeat(40),
  } as NodeJS.ProcessEnv);
  assert.ok(errs.some((e) => e.includes("CHAIN_ID")));
  assert.ok(errs.some((e) => e.includes("ARBITER_PRIVATE_KEY")));
  assert.ok(errs.some((e) => e.includes("ALLOWED_ORIGIN")));
  assert.ok(errs.some((e) => e.includes("RPC_URL")));
});

test("CHAIN_ID no numérico se rechaza (típico: 'base-sepolia' o con espacios)", () => {
  const errs = productionConfigErrors({ ...OK, CHAIN_ID: "base-sepolia" } as NodeJS.ProcessEnv);
  assert.ok(errs.some((e) => e.includes("CHAIN_ID inválido")));
  assert.equal(productionConfigErrors({ ...OK, CHAIN_ID: "0" } as NodeJS.ProcessEnv).length, 1);
});

test("ARBITER_PRIVATE_KEY mal formada se rechaza (truncada / sin 0x)", () => {
  assert.ok(
    productionConfigErrors({ ...OK, ARBITER_PRIVATE_KEY: "0xabc" } as NodeJS.ProcessEnv).some((e) =>
      e.includes("ARBITER_PRIVATE_KEY mal formada"),
    ),
  );
  // Una clave con salto de línea pegado (error de copiar/pegar) se normaliza y valida.
  assert.deepEqual(
    productionConfigErrors({
      ...OK,
      ARBITER_PRIVATE_KEY: OK.ARBITER_PRIVATE_KEY + "\n",
    } as NodeJS.ProcessEnv),
    [],
  );
});

test("ESCROW_ADDRESS mal formada se rechaza", () => {
  assert.ok(
    productionConfigErrors({ ...OK, ESCROW_ADDRESS: "0xNOPE" } as NodeJS.ProcessEnv).some((e) =>
      e.includes("ESCROW_ADDRESS mal formada"),
    ),
  );
});

test("ALEPH_STAKES con una mesa de plata exige ALEPH_ESCROW_ADDRESS bien formada", () => {
  const sinEscrow = { ...OK, ESCROW_ADDRESS: undefined, ALEPH_STAKES: "0,2" } as NodeJS.ProcessEnv;
  const errs = productionConfigErrors(sinEscrow);
  assert.ok(
    errs.some((e) => /ALEPH_ESCROW_ADDRESS/.test(e)),
    errs.join("\n"),
  );

  const malFormada = {
    ...OK,
    ALEPH_STAKES: "0,2",
    ALEPH_ESCROW_ADDRESS: "0x123",
  } as NodeJS.ProcessEnv;
  assert.ok(
    productionConfigErrors(malFormada).some((e) => /ALEPH_ESCROW_ADDRESS mal formada/.test(e)),
  );

  const bien = {
    ...OK,
    ALEPH_STAKES: "0,2",
    ALEPH_ESCROW_ADDRESS: "0x" + "c".repeat(40),
  } as NodeJS.ProcessEnv;
  assert.deepEqual(productionConfigErrors(bien), []);
});

test("solo el escrow de Aleph activo (sin el 1v1) también exige CHAIN_ID, llave y RPC", () => {
  const soloAleph = {
    NODE_ENV: "production",
    ALEPH_STAKES: "0,2",
    ALEPH_ESCROW_ADDRESS: "0x" + "c".repeat(40),
    ALLOWED_ORIGIN: "https://arcade1v1.com",
  } as NodeJS.ProcessEnv;
  const errs = productionConfigErrors(soloAleph);
  assert.ok(errs.some((e) => /CHAIN_ID/.test(e)));
  assert.ok(errs.some((e) => /ARBITER_PRIVATE_KEY/.test(e)));
  assert.ok(errs.some((e) => /RPC_URL/.test(e)));
});

test("la mesa gratis sola (ALEPH_STAKES=0 o ausente) no exige nada de Aleph", () => {
  assert.deepEqual(
    productionConfigErrors({ NODE_ENV: "production", ALEPH_STAKES: "0" } as NodeJS.ProcessEnv),
    [],
  );
});

test("parseTrustProxy: saltos, booleanos, IP y basura", () => {
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("10.0.0.0/8"), "10.0.0.0/8");
  assert.equal(parseTrustProxy("basura"), undefined);
  assert.equal(parseTrustProxy(""), undefined);
});
