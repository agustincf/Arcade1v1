// Configuracion central de la plataforma (datos de mentira por ahora).

/** Mesas de apuesta fijas, en USDC. */
export const BET_AMOUNTS = [1, 5, 10, 20] as const;
export type BetAmount = (typeof BET_AMOUNTS)[number];

/** Comision de la plataforma: 10% del pozo. */
export const PLATFORM_FEE = 0.1;

/** Calcula como se reparte el pozo de una mesa. */
export function getPayout(bet: number) {
  const pot = bet * 2; // los dos jugadores ponen lo mismo
  const fee = pot * PLATFORM_FEE; // comision de la plataforma
  const prize = pot - fee; // lo que se lleva el ganador
  return { pot, fee, prize };
}

/** Estamos en testnet (dinero de prueba). */
export const NETWORK_LABEL = "Base Sepolia (testnet)";
