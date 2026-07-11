// Estrategia de Snake: perseguir la comida (distancia con wrap) evitando el
// cuerpo, con un slider de "cautela" que pesa cuánto espacio libre queda
// después de cada movimiento (flood fill acotado). Decide cada tick sobre el
// motor real; solo registra el input cuando la dirección cambia (el replay
// tiene que entrar en el límite de 256kb del árbitro).

import { SnakeEngine, GRID, type SnakeAction } from "@arcade1v1/game-sdk/snake";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";

const MAX_TICKS = 36_000; // ~10 min a 60 ticks/seg
export const ACTS: SnakeAction[] = ["u", "d", "l", "r"];
export const DELTA: Record<SnakeAction, { x: number; y: number }> = {
  u: { x: 0, y: -1 },
  d: { x: 0, y: 1 },
  l: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
};

/** Distancia Manhattan con wrap (las paredes no existen: la víbora reaparece). */
export function wrapDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.min(dx, GRID - dx) + Math.min(dy, GRID - dy);
}

/** Cuántas celdas libres se alcanzan desde (x,y), acotado a `cap` (barato). */
export function freeSpace(occupied: Set<number>, x: number, y: number, cap: number): number {
  const seen = new Set<number>();
  const stack = [y * GRID + x];
  while (stack.length && seen.size < cap) {
    const k = stack.pop()!;
    if (seen.has(k) || occupied.has(k)) continue;
    seen.add(k);
    const cx = k % GRID;
    const cy = Math.floor(k / GRID);
    for (const a of ACTS) {
      const nx = (cx + DELTA[a].x + GRID) % GRID;
      const ny = (cy + DELTA[a].y + GRID) % GRID;
      stack.push(ny * GRID + nx);
    }
  }
  return seen.size;
}

const PARAMS = [
  {
    key: "caution",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.5,
    labelKey: "strat.snake.greedy.caution",
  },
];

export const strategySnakeGreedy: StrategyDef = {
  id: "snake.greedy",
  game: "snake",
  labelKey: "strat.snake.greedy.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const caution = num(params, PARAMS[0]);
    const g = new SnakeEngine(seed);
    const inputs: { t: number; a: SnakeAction }[] = [];
    let lastApplied: SnakeAction | null = null;

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      const head = g.body[0];
      const occupied = new Set<number>();
      for (const s of g.body) occupied.add(s.y * GRID + s.x);

      let best: SnakeAction | null = null;
      let bestValue = -Infinity;
      for (const a of ACTS) {
        const d = DELTA[a];
        // El motor ignora la reversa directa: ni la consideramos.
        if (d.x === -g.dir.x && d.y === -g.dir.y) continue;
        const nx = (head.x + d.x + GRID) % GRID;
        const ny = (head.y + d.y + GRID) % GRID;
        if (occupied.has(ny * GRID + nx)) continue;
        const dist = wrapDist(nx, ny, g.food.x, g.food.y);
        // Cautela: premiar salidas con más espacio libre alcanzable (evita
        // meterse en bolsillos). Flood fill acotado para que sea barato.
        const space = caution > 0 ? freeSpace(occupied, nx, ny, 60) : 0;
        const value = -dist + caution * space * 0.5;
        if (value > bestValue) {
          bestValue = value;
          best = a;
        }
      }
      if (best !== null && best !== lastApplied) {
        g.apply(best);
        inputs.push({ t, a: best });
        lastApplied = best;
      }
      g.tick();
    }

    // ticks reales consumidos: si murió antes, el replay corta ahí igual que
    // el verificador (que frena en `over`).
    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs } };
  },
};
