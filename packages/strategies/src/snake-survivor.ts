// Estrategia de Snake "Superviviente": el espacio libre alcanzable MANDA; solo
// se acerca a la comida cuando no sacrifica aire. Invierte los pesos del cazador
// (que deja mandar a la distancia), así serpentea y sobrevive más. Como el flood
// fill se satura (cap) en tablero abierto, ahí todos los movimientos empatan en
// espacio y la comida decide: come cuando es seguro, cuida el cuerpo cuando no.

import { SnakeEngine, GRID, SNAKE_RULES_V, type SnakeAction } from "@arcade1v1/game-sdk/snake";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";
import { ACTS, DELTA, wrapDist, freeSpace } from "./snake";

const MAX_TICKS = 36_000;
const SPACE_CAP = 80; // saturación del flood fill: en tablero abierto empatan

const PARAMS = [
  {
    key: "foodPull",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.05,
    def: 0.35,
    labelKey: "strat.snake.survivor.foodPull",
  },
  {
    key: "coinGreed",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.35,
    labelKey: "strat.snake.survivor.coinGreed",
  },
];

export const strategySnakeSurvivor: StrategyDef = {
  id: "snake.survivor",
  game: "snake",
  labelKey: "strat.snake.survivor.name",
  descKey: "strat.snake.survivor.desc",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const foodPull = num(params, PARAMS[0]);
    const coinGreed = num(params, PARAMS[1]);
    const g = new SnakeEngine(seed);
    const inputs: { t: number; a: SnakeAction }[] = [];
    let lastApplied: SnakeAction | null = null;

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      const head = g.body[0];
      const occupied = new Set<number>();
      for (const s of g.body) occupied.add(s.y * GRID + s.x);

      // v2: perseguir la moneda solo si es alcanzable ANTES de que venza y
      // está dentro del radio que la codicia habilita.
      const head0 = g.body[0];
      const coinDist = g.coin ? wrapDist(head0.x, head0.y, g.coin.x, g.coin.y) : Infinity;
      const chaseCoin = g.coin !== null && coinDist <= g.coinSteps && coinDist <= coinGreed * GRID;
      const target = chaseCoin ? g.coin! : g.food;

      let best: SnakeAction | null = null;
      let bestValue = -Infinity;
      for (const a of ACTS) {
        const d = DELTA[a];
        if (d.x === -g.dir.x && d.y === -g.dir.y) continue; // el motor ignora la reversa
        const nx = (head.x + d.x + GRID) % GRID;
        const ny = (head.y + d.y + GRID) % GRID;
        if (occupied.has(ny * GRID + nx)) continue;
        // El espacio DOMINA (0..cap); la comida entra con peso chico y solo
        // desempata cuando el espacio se satura (tablero abierto = seguro).
        const space = freeSpace(occupied, nx, ny, SPACE_CAP);
        const dist = wrapDist(nx, ny, target.x, target.y);
        const value = space + foodPull * -dist * 0.3;
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

    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs, v: SNAKE_RULES_V } };
  },
};
