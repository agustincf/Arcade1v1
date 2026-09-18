// confirmTx: la web da una transacción por hecha recién cuando Base selló su
// bloque, no con el recibo preconfirmado. Sin esto, después del approve la
// wallet estimaba el open/join sobre `latest`, donde el approve todavía no
// estaba, y revertía con ERC20InsufficientAllowance (MetaMask lo marcaba como
// "probablemente va a fallar"). Y el faucet mostraba el saldo viejo.

import { test } from "node:test";
import assert from "node:assert/strict";

import { confirmTx } from "../app/lib/confirm-tx.js";

test("confirmTx: con el recibo preconfirmado (bloque 17, latest en 16) no vuelve hasta que latest llega a 17", async () => {
  const seen: string[] = [];
  let latest = 16n;
  const client = {
    async waitForTransactionReceipt({ hash }: { hash: `0x${string}` }) {
      seen.push(`receipt ${hash}`);
      return { blockNumber: 17n };
    },
    async getBlockNumber() {
      seen.push(`blockNumber ${latest}`);
      const now = latest;
      latest = 17n; // el bloque se sella entre el primer sondeo y el segundo
      return now;
    },
  };
  await confirmTx(client, "0xabc");
  assert.deepEqual(seen, ["receipt 0xabc", "blockNumber 16", "blockNumber 17"]);
});
