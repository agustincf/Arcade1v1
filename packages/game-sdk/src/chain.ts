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
 *  Sondea cada `intervalMs` y sin caché, porque viem guarda el número de bloque
 *  un rato. Una lectura que falla, o que no contesta a tiempo, cuenta como
 *  "todavía no". El tope es de TIEMPO (`timeoutMs`, 30 s), no de lecturas: cada
 *  lectura de viem hereda sus reintentos y su timeout, y con un RPC colgado un
 *  tope por cantidad se estiraba a decenas de minutos. Al vencer devuelve false:
 *  quien llama sigue igual, y si algo falla la cadena da el motivo. */
export async function waitUntilSealed(
  client: BlockNumberReader,
  blockNumber: bigint,
  { intervalMs = 500, timeoutMs = 30_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = await within(client.getBlockNumber({ cacheTime: 0 }), deadline - Date.now());
    if (latest !== undefined && latest >= blockNumber) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, left)));
  }
}

/** Lo que resuelve `p`, o undefined si falla o si no contesta en `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}
