// Contrato de las estrategias parametrizables. Es la pieza que une el builder
// no-code de la web, el runner de agentes del servidor y el agent-sdk: una
// estrategia se describe con un id + parámetros JSON-serializables, y su
// `play()` maneja el MOTOR REAL de game-sdk tick a tick, así el replay que
// produce pasa la verificación del árbitro por construcción.

/** Descripción de un parámetro ajustable. Mapea 1:1 a un control del builder:
 *  slider -> input range, priority -> lista reordenable, choice -> select. */
export interface ParamSpec {
  key: string;
  kind: "slider" | "priority" | "choice";
  /** Solo para slider. */
  min?: number;
  max?: number;
  step?: number;
  /** Para priority (opciones a ordenar) y choice (opciones a elegir). */
  options?: string[];
  /** Valor por defecto (número para slider, string[] para priority, string para choice). */
  def: unknown;
  /** Clave i18n del nombre del parámetro (la resuelve la web). */
  labelKey: string;
}

export interface PlayResult {
  score: number;
  replay: unknown;
}

export interface StrategyDef {
  /** Id estable, p. ej. "snake.greedy". Es lo que se persiste. */
  id: string;
  game: string;
  /** Clave i18n del nombre de la estrategia. */
  labelKey: string;
  /** Clave i18n de una descripción en una línea (para el selector del builder). */
  descKey?: string;
  params: ParamSpec[];
  /** Juega una partida completa headless con el motor real y devuelve el replay. */
  play(seed: number, params: Record<string, unknown>): PlayResult;
}

/** La config de un agente creado en el builder: es JSON puro (lo guarda el
 *  servidor y lo re-valida en cada edición). */
export interface AgentStrategyConfig {
  game: string;
  strategyId: string;
  params: Record<string, unknown>;
}
