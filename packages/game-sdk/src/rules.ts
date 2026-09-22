// Versión de REGLAS de cada juego. La fuente de verdad vive en cada motor
// (SNAKE_RULES_V, RACING_RULES_V…): acá solo se agregan en un mapa para el
// árbitro y los SDKs. Si un juego no figura o no exporta versión, es v1.
// Al evolucionar un juego NUNCA se lo renombra: cambia su versión, no su id.
import { SNAKE_RULES_V } from "./snake";
import { RACING_RULES_V } from "./racing";
import { ALEPH_RULES_V } from "./aleph-rules";

// Cuántas acciones puede declarar un replay dentro de un mismo tick. Es una
// regla del formato de replay, no de un juego puntual, así que se re-exporta
// acá: `replay.ts` es interno del paquete y no tiene subpath público.
export { MAX_ACTIONS_PER_TICK } from "./replay";

export const RULES_V: Record<string, number> = {
  "2048": 1,
  tetris: 1,
  // v2: se juega EN VIVO. La partida no tiene semilla; el azar sale de un
  // secreto que se revela de a poco a medida que el jugador compromete sus
  // aleteos (spec: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md).
  flappy: 2,
  racing: RACING_RULES_V,
  snake: SNAKE_RULES_V,
  invaders: 1,
  aleph: ALEPH_RULES_V, // formato multi-agente (no es cartucho 1v1)
};
