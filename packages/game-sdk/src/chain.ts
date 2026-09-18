// packages/game-sdk/src/chain.ts
// Esperas de cadena compartidas por el agent-sdk y la web.

/** Lo único que la espera necesita del cliente: el número del último bloque
 *  SELLADO. Un PublicClient de viem sirve tal cual. */
export interface BlockNumberReader {
  getBlockNumber(args: { cacheTime: number }): Promise<bigint>;
}

/** Espera a que `latest` alcance `blockNumber`, el bloque de un recibo.
 *
 *  El RPC público de Base entrega el recibo apenas la transacción entra en el
 *  bloque que se está armando (preconfirmación), ~2 s antes de sellarlo, y viem
 *  lo da por minado. Pero las lecturas, las simulaciones y la estimación de gas
 *  van contra `latest`, donde la transacción todavía no está. Por eso un depósito
 *  simulado justo después de su approve revertía con ERC20InsufficientAllowance.
 *  En anvil el recibo ya es de un bloque minado y esto vuelve con una sola
 *  lectura.
 *
 *  Sondea sin caché, porque viem guarda el número de bloque un rato. Una lectura
 *  que falla cuenta como "todavía no". Devuelve false si se agotan las lecturas:
 *  quien llama sigue igual, y si algo falla la cadena da el motivo. */
export async function waitUntilSealed(
  client: BlockNumberReader,
  blockNumber: bigint,
  { polls = 60, intervalMs = 500 }: { polls?: number; intervalMs?: number } = {},
): Promise<boolean> {
  for (let i = 0; i < polls; i++) {
    const latest = await client.getBlockNumber({ cacheTime: 0 }).catch(() => undefined);
    if (latest !== undefined && latest >= blockNumber) return true;
    if (i < polls - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
