// Registro único de estrategias. Es la lista default-deny que comparten el
// builder de la web (para dibujar los controles), el servidor (para validar y
// correr agentes hosteados) y el agent-sdk (estrategias por defecto).

import type { AgentStrategyConfig, ParamSpec, PlayResult, StrategyDef } from "./types";
import { strategy2048Priority } from "./g2048";
import { strategy2048Corner } from "./g2048-corner";
import { strategySnakeGreedy } from "./snake";
import { strategySnakeSurvivor } from "./snake-survivor";
import { strategyFlappyThreshold } from "./flappy";
import { strategyRacingDodger } from "./racing";
import { strategyInvadersHunter } from "./invaders";
import { strategyTetrisHeuristic } from "./tetris";

const ALL: StrategyDef[] = [
  strategyInvadersHunter,
  strategyFlappyThreshold,
  strategy2048Priority,
  strategy2048Corner,
  strategySnakeGreedy,
  strategySnakeSurvivor,
  strategyTetrisHeuristic,
  strategyRacingDodger,
];

export const STRATEGIES: Record<string, StrategyDef> = Object.fromEntries(
  ALL.map((s) => [s.id, s]),
);

export function strategiesFor(game: string): StrategyDef[] {
  return ALL.filter((s) => s.game === game);
}

export function getStrategy(id: string): StrategyDef | undefined {
  return STRATEGIES[id];
}

/** Valores por defecto de una estrategia (para precargar el builder). */
export function defaultParams(def: StrategyDef): Record<string, unknown> {
  return Object.fromEntries(
    def.params.map((p) => [p.key, Array.isArray(p.def) ? p.def.slice() : p.def]),
  );
}

function validateOne(spec: ParamSpec, raw: unknown): unknown {
  if (spec.kind === "slider") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return spec.def;
    return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, raw));
  }
  if (spec.kind === "choice") {
    return typeof raw === "string" && spec.options?.includes(raw) ? raw : spec.def;
  }
  // priority: tiene que ser una permutación exacta de las opciones.
  const opts = spec.options ?? [];
  if (Array.isArray(raw) && raw.length === opts.length && opts.every((o) => raw.includes(o))) {
    return raw;
  }
  return Array.isArray(spec.def) ? (spec.def as string[]).slice() : spec.def;
}

/** Sanea parámetros crudos (default-deny): claves desconocidas afuera, números
 *  clampeados, prioridades como permutación exacta. El SERVIDOR la corre en
 *  cada alta/edición, así un cliente hostil no puede persistir basura. */
export function validateParams(
  def: StrategyDef,
  raw: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const src = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(def.params.map((p) => [p.key, validateOne(p, src[p.key])]));
}

/** Corre una config completa (juego + estrategia + params) sobre una semilla. */
export function runStrategy(config: AgentStrategyConfig, seed: number): PlayResult {
  const def = getStrategy(config.strategyId);
  if (!def) throw new Error(`estrategia desconocida: ${config.strategyId}`);
  if (def.game !== config.game) {
    throw new Error(`la estrategia ${config.strategyId} no es del juego ${config.game}`);
  }
  return def.play(seed, validateParams(def, config.params));
}
