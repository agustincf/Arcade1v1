// apps/web/app/lib/confirm-tx.ts
// Cuándo la web da por hecha una transacción de la wallet.

import { waitUntilSealed, type BlockNumberReader } from "@arcade1v1/game-sdk/chain";

/** Lo que `confirmTx` usa del PublicClient de wagmi/viem. */
export interface ReceiptReader extends BlockNumberReader {
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ blockNumber: bigint }>;
}

/** Espera el recibo de `hash` y, además, a que Base selle su bloque. El RPC
 *  público de Base entrega el recibo antes de sellarlo (preconfirmación), y la
 *  wallet estima el paso siguiente sobre `latest`. Sin esta espera, el open/join
 *  que sigue a un approve revertía con ERC20InsufficientAllowance, y el saldo
 *  que se lee después de acuñar salía viejo. En Base el sellado tarda ~2 s; en
 *  una cadena local, nada. */
export async function confirmTx(client: ReceiptReader, hash: `0x${string}`): Promise<void> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  await waitUntilSealed(client, receipt.blockNumber);
}
