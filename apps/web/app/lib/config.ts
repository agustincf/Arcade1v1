// Configuracion central de la plataforma (datos de mentira por ahora).

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

/** Estamos en testnet (dinero de prueba). */
export const NETWORK_LABEL = "Base Sepolia (testnet)";

/** Mesa pre-seleccionada por defecto. */
export const DEFAULT_BET = 5;

/** Velocidad de emparejamiento de una mesa (para los indicadores de CRO). */
export type MatchSpeed = "rapido" | "medio" | "lento";

/** Metadatos por mesa para los empujones de conversion (CRO).
 *  La de 20 es la mas popular: mas gente buscando = empareja mas rapido. */
export const TABLE_META: Record<
  number,
  {
    playersWaiting: number;
    speed: MatchSpeed;
    premium?: boolean;
  }
> = {
  // La actividad escala con la apuesta (a mas plata, mas accion). La de 10 es VIP.
  1: { playersWaiting: 17, speed: "medio" },
  2: { playersWaiting: 24, speed: "rapido" },
  5: { playersWaiting: 31, speed: "rapido" },
  10: { playersWaiting: 39, speed: "rapido", premium: true },
};

/** Barras de señal segun la velocidad de emparejamiento (1 a 3). */
export function matchBars(speed: MatchSpeed): number {
  return speed === "rapido" ? 3 : speed === "medio" ? 2 : 1;
}

/** "Jugadores en linea" (prueba social). Varia un poco para sentirse vivo. */
export function onlinePlayers(): number {
  const base = 128;
  const wave = Math.floor((Date.now() / 60000) % 40);
  return base + wave;
}
