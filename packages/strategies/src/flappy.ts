// Estrategia de Flappy: aletear cuando el pájaro cae por debajo del centro del
// próximo hueco (con un offset de riesgo ajustable). El slider de reacción
// espacia las decisiones, como un jugador más o menos atento.

import {
  FlappyEngine,
  FLAPPY_DT,
  FLAPPY_CONST,
  type ReplayFlappy,
} from "@arcade1v1/game-sdk/flappy";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";

const MAX_TICKS = 36_000;

const PARAMS = [
  {
    key: "riskOffset",
    kind: "slider" as const,
    min: -40,
    max: 40,
    step: 5,
    def: 15,
    labelKey: "strat.flappy.threshold.riskOffset",
  },
  {
    key: "reaction",
    kind: "slider" as const,
    min: 1,
    max: 8,
    step: 1,
    def: 2,
    labelKey: "strat.flappy.threshold.reaction",
  },
];

export const strategyFlappyThreshold: StrategyDef = {
  id: "flappy.threshold",
  game: "flappy",
  labelKey: "strat.flappy.threshold.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const riskOffset = num(params, PARAMS[0]);
    const reaction = Math.round(num(params, PARAMS[1]));
    const g = new FlappyEngine(seed);
    const flaps: number[] = [];

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      // Primer aleteo en t=0 para arrancar la física (el motor espera started).
      const decide = t === 0 || t % reaction === 0;
      if (decide) {
        // Próximo caño que todavía no pasamos (el hueco a apuntar).
        const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
        const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + riskOffset;
        // Aletear solo cayendo (vy >= 0 tras el pico del aleteo) y por debajo
        // del objetivo: el clásico control por umbral.
        if (t === 0 || (g.birdY > target && g.birdVy > 0)) {
          g.flap();
          flaps.push(t);
        }
      }
      g.update(FLAPPY_DT);
    }

    const replay: ReplayFlappy = { seed, ticks: MAX_TICKS, flaps };
    return { score: g.score, replay };
  },
};
