// packages/game-sdk/test/chain.test.ts
// waitUntilSealed: el RPC público de Base da el recibo de una transacción antes
// de sellar su bloque (preconfirmación), y lo que se lee en `latest` todavía no
// la incluye. La espera sondea el número de bloque hasta que `latest` alcanza el
// del recibo.
// Correr: node --import tsx --test packages/game-sdk/test/chain.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitUntilSealed } from "@arcade1v1/game-sdk/chain";

/** Un cliente que en cada llamada devuelve el siguiente número de la lista (el
 *  último se repite). Un `Error` en la lista es una lectura que falla. */
function client(seq: (bigint | Error)[]) {
  const calls: { cacheTime: number }[] = [];
  return {
    calls,
    async getBlockNumber(args: { cacheTime: number }) {
      calls.push(args);
      const v = seq[Math.min(calls.length - 1, seq.length - 1)];
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

test("waitUntilSealed: si latest ya llegó al bloque del recibo, vuelve con una sola lectura y sin dormir", async () => {
  const c = client([17n]);
  const t0 = Date.now();
  assert.equal(await waitUntilSealed(c, 17n, { intervalMs: 1_000 }), true);
  assert.equal(c.calls.length, 1);
  assert.ok(Date.now() - t0 < 500, "no esperó el intervalo");
});

test("waitUntilSealed: sondea hasta que latest alcanza el bloque del recibo", async () => {
  const c = client([16n, 16n, 17n]);
  assert.equal(await waitUntilSealed(c, 17n, { intervalMs: 1 }), true);
  assert.equal(c.calls.length, 3);
});

test("waitUntilSealed: cada sondeo pide el número de bloque sin caché (viem lo guarda un rato)", async () => {
  const c = client([16n, 17n]);
  await waitUntilSealed(c, 17n, { intervalMs: 1 });
  assert.deepEqual(c.calls, [{ cacheTime: 0 }, { cacheTime: 0 }]);
});

test("waitUntilSealed: una lectura que falla cuenta como 'todavía no' y se sigue sondeando", async () => {
  const c = client([new Error("rpc caído"), 17n]);
  assert.equal(await waitUntilSealed(c, 17n, { intervalMs: 1 }), true);
  assert.equal(c.calls.length, 2);
});

test("waitUntilSealed: si el bloque nunca llega, devuelve false al vencer timeoutMs", async () => {
  const c = client([16n]);
  const t0 = Date.now();
  assert.equal(await waitUntilSealed(c, 17n, { intervalMs: 5, timeoutMs: 60 }), false);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 55 && elapsed < 260, `tardó ${elapsed} ms`);
  assert.ok(c.calls.length >= 2, "sondeó más de una vez");
});

// Cada lectura de viem hereda sus reintentos (3) y su timeout (10 s): con un RPC
// colgado, un tope por CANTIDAD de lecturas se estiraba a decenas de minutos, y
// alephDeposit quedaba trabado en vez de fallar con el motivo real.
test(
  "waitUntilSealed: con un RPC que no contesta, igual devuelve false al vencer timeoutMs",
  { timeout: 2_000 },
  async () => {
    const hung = { getBlockNumber: () => new Promise<bigint>(() => {}) };
    const t0 = Date.now();
    assert.equal(await waitUntilSealed(hung, 17n, { intervalMs: 5, timeoutMs: 80 }), false);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 280, `tardó ${elapsed} ms`);
  },
);
