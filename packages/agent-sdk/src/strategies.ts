// Estrategias por defecto del SDK: ahora viven en @arcade1v1/strategies (la
// misma librería parametrizable que usa el builder no-code de la web y el
// runner de agentes hosteados). Acá solo se adaptan a la firma simple del SDK
// y se cubren LOS 6 JUEGOS con sus parámetros por defecto.

import type { Dir } from "@arcade1v1/game-sdk/g2048";
import type { FlappyEngine } from "@arcade1v1/game-sdk/flappy";
import {
  STRATEGIES,
  strategiesFor,
  getStrategy,
  defaultParams,
  validateParams,
  runStrategy,
  type StrategyDef,
  type ParamSpec,
  type AgentStrategyConfig,
  type LiveStep,
} from "@arcade1v1/strategies";

export { STRATEGIES, strategiesFor, getStrategy, defaultParams, validateParams, runStrategy };
export type { StrategyDef, ParamSpec, AgentStrategyConfig, LiveStep };

export type PlayResult = { score: number; replay: unknown };
export type Strategy = (seed: number) => PlayResult;

/** Compat: la estrategia clásica de 2048 por prioridad de movimientos. */
export function strategy2048(
  seed: number,
  priority: Dir[] = ["down", "left", "right", "up"],
): PlayResult {
  const def = getStrategy("2048.priority")!;
  return def.play(seed, { ...defaultParams(def), priority, greed: 0 });
}

/** Una estrategia lista para cada juego (los params por defecto del registro). */
export const DEFAULT_STRATEGIES: Record<string, Strategy> = Object.fromEntries(
  Object.values(STRATEGIES).map((def) => [
    def.game,
    (seed: number) => def.play(seed, defaultParams(def)),
  ]),
);

/** Estrategia EN VIVO: decide tick a tick mirando el motor, sin azar futuro. */
export interface LiveStrategy {
  decide: (engine: FlappyEngine, tick: number) => boolean;
  /** Si llega vivo a este tick, el intento se cierra con lo alcanzado. */
  maxTicks: number;
}

/** La estrategia en vivo por defecto de un juego (con los params por defecto
 *  del registro), o `undefined` si ese juego no se juega en vivo. Se crea UNA
 *  POR PARTIDA: una estrategia puede guardar estado entre ticks. */
export function defaultLiveStrategy(game: string): LiveStrategy | undefined {
  const def = strategiesFor(game).find((d) => d.step);
  return def?.step?.(defaultParams(def));
}
