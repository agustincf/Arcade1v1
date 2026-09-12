// Link a una transacción en el explorador de la red configurada. Una sola
// función para que el chainId no se re-declare en cada página.
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);

export function txUrl(hash: string): string {
  const host = CHAIN_ID === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${host}/tx/${hash}`;
}
