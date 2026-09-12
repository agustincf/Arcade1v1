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

/** Persistencia DURABLE (Redis), como la que exige una mesa de plata. En el
 *  servidor real `ARCADE_PERSIST` lo pone persist-on.ts al importarse. */
const REDIS = {
  ARCADE_PERSIST: "1",
  UPSTASH_REDIS_REST_URL: "https://ejemplo.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "un-token",
};

/** Una mesa de plata bien configurada de punta a punta. */
const MONEY = {
  ...OK,
  ...REDIS,
  ALEPH_STAKES: "0,2",
  ALEPH_ESCROW_ADDRESS: "0x" + "c".repeat(40),
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
  const sinEscrow = {
    ...OK,
    ...REDIS,
    ESCROW_ADDRESS: undefined,
    ALEPH_STAKES: "0,2",
  } as unknown as NodeJS.ProcessEnv;
  const errs = productionConfigErrors(sinEscrow);
  assert.ok(
    errs.some((e) => /ALEPH_ESCROW_ADDRESS/.test(e)),
    errs.join("\n"),
  );

  const malFormada = { ...MONEY, ALEPH_ESCROW_ADDRESS: "0x123" } as NodeJS.ProcessEnv;
  assert.ok(
    productionConfigErrors(malFormada).some((e) => /ALEPH_ESCROW_ADDRESS mal formada/.test(e)),
  );

  assert.deepEqual(productionConfigErrors(MONEY), []);
});

// Una mesa de plata NO puede correr con la persistencia en archivo: en Render el
// disco se borra en cada deploy, y ahí se van las salas en fondeo (los depósitos
// quedan trabados hasta que cada asiento pida su reembolso) y las liquidadas que
// todavía no se presentaron (la tabla firmada se pierde: partida pagada, anulada).
test("una mesa de plata sin Redis no arranca: la persistencia en archivo se borra en cada deploy", () => {
  const sinRedis = {
    ...OK,
    ARCADE_PERSIST: "1", // como lo deja persist-on.ts en el servidor real
    ALEPH_STAKES: "0,2",
    ALEPH_ESCROW_ADDRESS: "0x" + "c".repeat(40),
  } as unknown as NodeJS.ProcessEnv;
  const errs = productionConfigErrors(sinRedis);
  assert.ok(
    errs.some((e) => /UPSTASH_REDIS_REST_URL/.test(e) && /"file"/.test(e)),
    errs.join("\n"),
  );

  // Con la persistencia directamente apagada, igual (o peor).
  const sinPersistencia = { ...sinRedis, ARCADE_PERSIST: undefined } as NodeJS.ProcessEnv;
  assert.ok(productionConfigErrors(sinPersistencia).some((e) => /"off"/.test(e)));

  // Media configuración de Redis (solo la URL, sin token) sigue siendo archivo.
  const aMedias = {
    ...sinRedis,
    UPSTASH_REDIS_REST_URL: "https://ejemplo.upstash.io",
  } as unknown as NodeJS.ProcessEnv;
  assert.ok(productionConfigErrors(aMedias).some((e) => /"file"/.test(e)));

  // Y con Redis completo, ningún error.
  assert.deepEqual(productionConfigErrors(MONEY), []);
});

// La mesa gratis no toca plata: su persistencia sigue siendo la de siempre y
// este chequeo no se le aplica. Con ALEPH_STAKES en su default, nada cambia.
test("la mesa gratis no exige Redis (ni con el escrow del 1v1 activo)", () => {
  assert.deepEqual(
    productionConfigErrors({ ...OK, ARCADE_PERSIST: "1" } as unknown as NodeJS.ProcessEnv),
    [],
  );
  assert.deepEqual(
    productionConfigErrors({
      ...OK,
      ARCADE_PERSIST: "1",
      ALEPH_STAKES: "0",
    } as unknown as NodeJS.ProcessEnv),
    [],
  );
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
