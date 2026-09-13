// apps/mcp/test/config.test.ts
// La wallet del MCP se valida al arrancar (config.ts). Una RPC_URL que el
// transporte http de viem no puede usar, o que la máscara de aleph_deposit no
// reconoce como URL, frena el arranque con un mensaje que NO repite el valor:
// puede traer la API key del proveedor en el path.
// Correr: node --import tsx --test apps/mcp/test/config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { walletFromEnv } from "../src/config";

const SECRET = "SECRETKEY123";

test("walletFromEnv: una RPC_URL sin esquema, o que no es http(s), no arranca y no repite la key", () => {
  for (const RPC_URL of [
    // La prueba del review: así escrita, la key salía dos veces en el error de
    // aleph_deposit, porque la máscara solo reconoce "esquema://".
    `eth-sepolia.g.alchemy.com/v2/${SECRET}`,
    `localhost:8545/${SECRET}`, // `new URL` lo lee como el esquema "localhost:"
    `wss://eth-sepolia.g.alchemy.com/v2/${SECRET}`, // el transporte http de viem no abre wss
    `ftp://example.com/${SECRET}`,
  ]) {
    assert.throws(
      () => walletFromEnv({ RPC_URL }),
      (e: Error) =>
        /RPC_URL must be a full URL starting with http:\/\/ or https:\/\//.test(e.message) &&
        !e.message.includes(SECRET),
      RPC_URL,
    );
  }
});

test("walletFromEnv: http y https pasan tal cual; vacío o ausente es 'sin RPC'", () => {
  const https = `https://eth-sepolia.g.alchemy.com/v2/${SECRET}`;
  assert.equal(walletFromEnv({ RPC_URL: https }).rpcUrl, https);
  assert.equal(walletFromEnv({ RPC_URL: "http://127.0.0.1:8545" }).rpcUrl, "http://127.0.0.1:8545");
  assert.equal(walletFromEnv({ RPC_URL: "" }).rpcUrl, undefined);
  assert.equal(walletFromEnv({}).rpcUrl, undefined);
});

test("walletFromEnv: el pin de escrow tiene que ser una address y el tope un número positivo", () => {
  const PIN = "0x" + "e".repeat(40);
  const w = walletFromEnv({ ARCADE_ALEPH_ESCROW_ADDRESS: PIN, ARCADE_ALEPH_MAX_STAKE: "2" });
  assert.equal(w.escrow, PIN);
  assert.equal(w.maxStake, 2);
  assert.throws(
    () => walletFromEnv({ ARCADE_ALEPH_ESCROW_ADDRESS: "0x1234" }),
    /ARCADE_ALEPH_ESCROW_ADDRESS must be a 0x address/,
  );
  for (const bad of ["abc", "0", "-2", "Infinity"]) {
    assert.throws(
      () => walletFromEnv({ ARCADE_ALEPH_MAX_STAKE: bad }),
      /ARCADE_ALEPH_MAX_STAKE must be a positive number/,
      bad,
    );
  }
  // Sin nada configurado: ni wallet, ni pin, ni tope (mesas de plata apagadas).
  assert.deepEqual(walletFromEnv({}), {
    privateKey: undefined,
    rpcUrl: undefined,
    escrow: undefined,
    maxStake: undefined,
  });
});
