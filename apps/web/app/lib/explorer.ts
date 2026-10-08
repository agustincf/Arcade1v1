// Link a una transacción en el explorador de la red configurada. Una sola
// función para que el chainId no se re-declare en cada página.
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);

/** `chainId`: la red de la transacción, si no es la de la web. Las mesas de
 *  plata de Aleph pueden ir en otra (en mainnet siguen en testnet): su sala lo
 *  dice en `chainId`. */
export function txUrl(hash: string, chainId: number = CHAIN_ID): string {
  const host = chainId === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${host}/tx/${hash}`;
}
