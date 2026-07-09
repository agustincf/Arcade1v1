// Estrategia de la Carrera: seguir en el carril hasta que un obstáculo entre
// en la distancia de mirada, y ahí esquivar hacia el carril libre más cercano
// (con preferencia configurable). Histéresis con cooldown para no zigzaguear.

import { RacingEngine, RACING_DT, RACING_CONST, LANES } from "@arcade1v1/game-sdk/racing";
import type { StrategyDef, PlayResult } from "./types";
import { num, choice } from "./params";

const MAX_TICKS = 36_000;
const CAR_Y = RACING_CONST.HEIGHT - 80; // igual que el motor (CAR_Y privado)
const CHANGE_COOLDOWN = 8; // ticks mínimos entre cambios de carril

const PARAMS = [
  {
    key: "lookahead",
    kind: "slider" as const,
    min: 80,
    max: 240,
    step: 20,
    def: 160,
    labelKey: "strat.racing.dodger.lookahead",
  },
  {
    key: "preferredLane",
    kind: "choice" as const,
    options: ["left", "center", "right"],
    def: "center",
    labelKey: "strat.racing.dodger.preferredLane",
  },
];

const LANE_INDEX: Record<string, number> = { left: 0, center: 1, right: 2 };

export const strategyRacingDodger: StrategyDef = {
  id: "racing.dodger",
  game: "racing",
  labelKey: "strat.racing.dodger.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const lookahead = num(params, PARAMS[0]);
    const homeLane = LANE_INDEX[choice(params, PARAMS[1])] ?? 1;
    const g = new RacingEngine(seed);
    const inputs: { t: number; a: "l" | "r" }[] = [];
    let cooldown = 0;

    /** ¿Hay peligro en `lane` dentro de `dist` px por delante del auto? */
    const danger = (lane: number, dist: number): boolean =>
      g.obstacles.some(
        (o) => o.lane === lane && o.y > CAR_Y - dist && o.y < CAR_Y + RACING_CONST.CAR_H,
      );

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0) {
        let target = g.carLane;
        if (danger(g.carLane, lookahead)) {
          // Elegir el carril vecino seguro; si hay dos, el más cercano al
          // preferido (con margen extra para no esquivar hacia otro peligro).
          const candidates = [g.carLane - 1, g.carLane + 1].filter(
            (l) => l >= 0 && l < LANES && !danger(l, lookahead + 40),
          );
          if (candidates.length > 0) {
            candidates.sort((a, b) => Math.abs(a - homeLane) - Math.abs(b - homeLane));
            target = candidates[0];
          }
        } else if (
          g.carLane !== homeLane &&
          !danger(homeLane, lookahead * 1.5) &&
          !danger(g.carLane + Math.sign(homeLane - g.carLane), lookahead * 1.5)
        ) {
          // Volver de a un carril al preferido cuando el camino está despejado.
          target = g.carLane + Math.sign(homeLane - g.carLane);
        }
        if (target !== g.carLane) {
          const a = target < g.carLane ? "l" : "r";
          if (a === "l") g.moveLeft();
          else g.moveRight();
          inputs.push({ t, a });
          cooldown = CHANGE_COOLDOWN;
        }
      }
      g.update(RACING_DT);
    }

    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs } };
  },
};
