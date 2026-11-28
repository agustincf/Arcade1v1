// El candado por wallet: dos transacciones de la MISMA wallet (un depósito 1v1
// y uno de Aleph, o dos del 1v1) no se mandan a la vez, porque chocarían en el
// nonce. Cubre solo el envío, el recibo y el sellado, nunca una partida entera.
// Correr: node --import tsx --test packages/agent-sdk/test/tx-lock.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTxLock, txLockFor } from "../src/tx-lock.ts";

test("dos envíos concurrentes se serializan", async () => {
  const lock = createTxLock();
  const log: string[] = [];
  let release!: () => void;
  const first = lock(async () => {
    log.push("1:start");
    await new Promise<void>((r) => (release = r));
    log.push("1:end");
    return 1;
  });
  const second = lock(async () => {
    log.push("2:start");
    return 2;
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, ["1:start"], "el segundo no arranca mientras el primero sigue");
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(log, ["1:start", "1:end", "2:start"]);
});

test("un error libera el candado", async () => {
  const lock = createTxLock();
  await assert.rejects(
    lock(async () => {
      throw new Error("revirtió");
    }),
    /revirtió/,
  );
  assert.equal(await lock(async () => "sigue"), "sigue");
});

test("el candado es por wallet: la misma dirección comparte candado", () => {
  const a = "0x" + "ab".repeat(20);
  assert.equal(txLockFor(a), txLockFor(a.toUpperCase().replace("0X", "0x")));
  assert.notEqual(txLockFor(a), txLockFor("0x" + "cd".repeat(20)));
});
