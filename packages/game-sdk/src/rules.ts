// Versión de REGLAS de cada juego. La fuente de verdad vive en cada motor
// (SNAKE_RULES_V, RACING_RULES_V…): acá solo se agregan en un mapa para el
// árbitro y los SDKs. Si un juego no figura o no exporta versión, es v1.
// Al evolucionar un juego NUNCA se lo renombra: cambia su versión, no su id.
import { SNAKE_RULES_V } from "./snake";
import { RACING_RULES_V } from "./racing";

// Cuántas acciones puede declarar un replay dentro de un mismo tick. Es una
// regla del formato de replay, no de un juego puntual, así que se re-exporta
// acá: `replay.ts` es interno del paquete y no tiene subpath público.
export { MAX_ACTIONS_PER_TICK } from "./replay";

export const RULES_V: Record<string, number> = {
  "2048": 1,
  tetris: 1,
  flappy: 1,
  racing: RACING_RULES_V,
  snake: SNAKE_RULES_V,
  invaders: 1,
};
