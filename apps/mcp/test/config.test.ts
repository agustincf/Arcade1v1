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

test("walletFromEnv: el pin de escrow tiene que ser una address y el tope un decimal positivo liso", () => {
  const PIN = "0x" + "e".repeat(40);
  const w = walletFromEnv({ ARCADE_ALEPH_ESCROW_ADDRESS: PIN, ARCADE_ALEPH_MAX_STAKE: "2" });
  assert.equal(w.escrow, PIN);
  assert.equal(w.maxStake, 2);
  assert.throws(
    () => walletFromEnv({ ARCADE_ALEPH_ESCROW_ADDRESS: "0x1234" }),
    /ARCADE_ALEPH_ESCROW_ADDRESS must be a 0x address/,
  );
  for (const [good, value] of [
    ["2.5", 2.5],
    ["10", 10],
    ["0.5", 0.5],
  ] as const) {
    assert.equal(walletFromEnv({ ARCADE_ALEPH_MAX_STAKE: good }).maxStake, value, good);
  }
  // `Number()` convertía en silencio las dos primeras: "0x10" eran 16 USDC y
  // "1e3" eran 1000. Un error de tipeo tiene que frenar el arranque, no mover
  // el tope. Lo mismo con signo, espacios, separadores o decimales a medias.
  for (const bad of [
    "0x10",
    "1e3",
    "+2",
    " 2",
    "2 ",
    "2.",
    ".5",
    "1_000",
    "1,5",
    "abc",
    "0",
    "0.0",
    "-2",
    "Infinity",
    "NaN",
  ]) {
    assert.throws(
      () => walletFromEnv({ ARCADE_ALEPH_MAX_STAKE: bad }),
      /ARCADE_ALEPH_MAX_STAKE must be a plain positive decimal/,
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

test("walletFromEnv: la dirección cero no es un pin: no arranca, con el mensaje textual y sin repetir el valor", () => {
  const ZERO = "0x" + "0".repeat(40);
  // La cero no tiene letras hexa: pasada a mayúsculas solo cambia la x.
  for (const pin of [ZERO, ZERO.toUpperCase()]) {
    assert.throws(
      () => walletFromEnv({ ARCADE_ALEPH_ESCROW_ADDRESS: pin }),
      (e: Error) =>
        e.message ===
          "ARCADE_ALEPH_ESCROW_ADDRESS must be a 0x address (40 hex digits), not the zero address" &&
        !e.message.includes(pin),
      pin,
    );
  }
});

test("walletFromEnv: un tope que Number() lee como Infinity no arranca", () => {
  // Decimales lisos más grandes que Number.MAX_VALUE. Con ese tope, aleph_join se
  // sentaba a cualquier mesa y cada aleph_deposit fallaba. Los 310 dígitos son el
  // caso del re-review.
  for (const huge of ["9".repeat(400), "1" + "0".repeat(309)]) {
    assert.throws(
      () => walletFromEnv({ ARCADE_ALEPH_MAX_STAKE: huge }),
      (e: Error) =>
        e.message ===
        "ARCADE_ALEPH_MAX_STAKE must be a plain positive decimal number of USDC, like 2 or 2.5",
      `${huge.length} dígitos`,
    );
  }
});

// ---- Mesas 1v1 de plata (ARCADE_1V1_*) ----------------------------------------

const KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const ONE_V_ONE = {
  ARCADE_1V1_ESCROW_ADDRESS: "0x8968dfcf16d9542320B6Fd7c857F9f2c5eE19938",
  ARCADE_1V1_RPC_URL: `https://base-sepolia.g.alchemy.com/v2/${SECRET}`,
  ARCADE_1V1_CHAIN_ID: "84532",
  ARCADE_1V1_MAX_STAKE: "2",
};

test("ARCADE_1V1_* completas arman la mesa de plata del 1v1", () => {
  const w = walletFromEnv({ ARCADE_PRIVATE_KEY: KEY, ...ONE_V_ONE });
  assert.deepEqual(w.paid1v1, {
    escrow: ONE_V_ONE.ARCADE_1V1_ESCROW_ADDRESS,
    rpcUrl: ONE_V_ONE.ARCADE_1V1_RPC_URL,
    chainId: 84532,
    maxStake: 2,
  });
});

test("ARCADE_1V1_* van todas o ninguna", () => {
  const { ARCADE_1V1_MAX_STAKE: _m, ARCADE_1V1_CHAIN_ID: _c, ...partial } = ONE_V_ONE;
  assert.throws(
    () => walletFromEnv({ ARCADE_PRIVATE_KEY: KEY, ...partial }),
    (e: Error) =>
      /ARCADE_1V1_CHAIN_ID/.test(e.message) &&
      /ARCADE_1V1_MAX_STAKE/.test(e.message) &&
      !e.message.includes(SECRET),
  );
});

test("ARCADE_1V1_* sin ARCADE_PRIVATE_KEY no arranca", () => {
  assert.throws(() => walletFromEnv({ ...ONE_V_ONE }), /ARCADE_PRIVATE_KEY/);
});

test("ARCADE_PRIVATE_KEY sola sigue valiendo", () => {
  const w = walletFromEnv({ ARCADE_PRIVATE_KEY: KEY });
  assert.equal(w.paid1v1, undefined);
});

test("ARCADE_1V1_* con valores inválidos no arranca y no repite el valor", () => {
  for (const [k, v] of [
    ["ARCADE_1V1_CHAIN_ID", "1"],
    ["ARCADE_1V1_CHAIN_ID", "84532abc"],
    ["ARCADE_1V1_MAX_STAKE", "1e3"],
    ["ARCADE_1V1_MAX_STAKE", "0"],
    ["ARCADE_1V1_ESCROW_ADDRESS", "0x" + "0".repeat(40)],
    ["ARCADE_1V1_RPC_URL", `base-sepolia.g.alchemy.com/v2/${SECRET}`],
  ]) {
    assert.throws(
      () => walletFromEnv({ ARCADE_PRIVATE_KEY: KEY, ...ONE_V_ONE, [k]: v }),
      (e: Error) => e.message.includes(k) && !e.message.includes(SECRET),
      `${k}=${v}`,
    );
  }
});
