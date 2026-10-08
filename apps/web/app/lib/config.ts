// Configuracion central de la plataforma.

/** Mesas de apuesta fijas, en USDC. */
export const BET_AMOUNTS = [1, 2, 5, 10] as const;
export type BetAmount = (typeof BET_AMOUNTS)[number];

/** Comision de la plataforma: 15% del pozo. */
export const PLATFORM_FEE = 0.15;

/** Calcula como se reparte el pozo de una mesa. */
export function getPayout(bet: number) {
  const pot = bet * 2; // los dos jugadores ponen lo mismo
  const fee = pot * PLATFORM_FEE; // comision de la plataforma
  const prize = pot - fee; // lo que se lleva el ganador
  return { pot, fee, prize };
}

/** Red activa: Base mainnet (dinero real) o Base Sepolia (test). Se elige con
 *  NEXT_PUBLIC_CHAIN_ID=8453 para mainnet; por defecto = testnet (seguro). */
export const IS_MAINNET = process.env.NEXT_PUBLIC_CHAIN_ID === "8453";
export const NETWORK_LABEL = IS_MAINNET ? "Base" : "Base Sepolia · TEST";

/** Los textos que en testnet dicen "testnet" tienen su versión para mainnet
 *  (`<clave>.mainnet`): en la red real no pueden quedar a la vista. */
const MAINNET_TEXTS = new Set(["marquee", "footer.demo", "faq.a6"]);
export function netKey(key: string): string {
  return IS_MAINNET && MAINNET_TEXTS.has(key) ? `${key}.mainnet` : key;
}

/** Mesa pre-seleccionada por defecto. */
export const DEFAULT_BET = 5;

/** Mesa de apuesta máxima: se etiqueta VIP. */
export const VIP_BET = 10;

/** Agentes hosteados (los de /build, los de la casa y los BYO por webhook):
 *  el árbitro los tuvo apagados (`AGENTS_ENABLED=false`) del 2026-09-08 al
 *  2026-09-29 para ahorrar infra, y se volvieron a prender para el outreach.
 *  Mientras sea `true`, /build y /my-agents avisan que están en pausa: si se
 *  vuelven a apagar en el árbitro, pasar esto a `true` en el mismo movimiento. */
export const HOSTED_AGENTS_PAUSED = false;
