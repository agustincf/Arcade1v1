// La configuración de las mesas 1v1 de plata (`paid1v1` en createAgent) se
// valida al crear el agente, sin tocar la red, y es todo o nada: un campo mal
// puesto haría que el agente se sentara a una mesa que no puede pagar, o que
// aprobara USDC a un contrato que nadie eligió. Los errores nombran el campo y
// NUNCA repiten su valor (en esos campos se puede pegar una clave por error).
// Correr: node --import tsx --test packages/agent-sdk/test/paid1v1-config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePaid1v1 } from "../src/paid1v1-config.ts";

const OK = {
  rpcUrl: "https://sepolia.base.org",
  escrow: "0x8968dfcf16d9542320B6Fd7c857F9f2c5eE19938",
  chainId: 84532,
  maxStake: 2,
} as const;

/** Tira, nombra el campo y no repite el valor que se le pasó. */
function rejects(cfg: unknown, field: RegExp, value: string, hasKey = true) {
  assert.throws(
    () => validatePaid1v1(cfg, hasKey),
    (e: Error) => {
      assert.match(e.message, field);
      if (value) assert.ok(!e.message.includes(value), `el error repite el valor: ${e.message}`);
      return true;
    },
  );
}

test("sin paid1v1 no hay configuración", () => {
  assert.equal(validatePaid1v1(undefined, false), undefined);
});

test("una configuración válida se devuelve", () => {
  assert.deepEqual(validatePaid1v1(OK, true), OK);
  assert.deepEqual(validatePaid1v1({ ...OK, maxFeeBps: 1500 }, true), { ...OK, maxFeeBps: 1500 });
});

test("escrow cero", () => {
  const zero = "0x" + "0".repeat(40);
  rejects({ ...OK, escrow: zero }, /paid1v1\.escrow/, zero);
});

test("escrow corto", () => {
  rejects({ ...OK, escrow: "0x1234" }, /paid1v1\.escrow/, "0x1234");
});

test("escrow con una clave privada pegada por error", () => {
  const key = "0x" + "ab".repeat(32);
  rejects({ ...OK, escrow: key }, /paid1v1\.escrow/, key);
});

test("rpcUrl sin esquema", () => {
  const url = "eth-sepolia.g.alchemy.com/v2/secreto123";
  rejects({ ...OK, rpcUrl: url }, /paid1v1\.rpcUrl/, "secreto123");
});

test("chainId 1", () => {
  rejects({ ...OK, chainId: 1 }, /paid1v1\.chainId/, "");
});

test("maxStake 0", () => {
  rejects({ ...OK, maxStake: 0 }, /paid1v1\.maxStake/, "");
});

test("maxStake Infinity", () => {
  rejects({ ...OK, maxStake: Infinity }, /paid1v1\.maxStake/, "");
});

test("maxStake ausente", () => {
  const { maxStake: _ignored, ...rest } = OK;
  rejects(rest, /paid1v1\.maxStake/, "");
});

test("maxFeeBps 2001", () => {
  rejects({ ...OK, maxFeeBps: 2001 }, /paid1v1\.maxFeeBps/, "");
});

test("sin privateKey", () => {
  rejects(OK, /paid1v1 needs privateKey/, "", false);
});
