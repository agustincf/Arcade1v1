// Estrategia de la Carrera "Serpenteador": en vez de esquivar reactivo, busca
// proactivamente el carril con más pista despejada por delante y fluye hacia él,
// un carril por vez. `boldness` = cuánta ventaja de holgura exige para cambiar:
// baja serpentea seguido, alta solo cambia cuando es claramente mejor. Maneja el
// motor real, así el replay verifica idéntico.

import { RacingEngine, RACING_DT, RACING_CONST, LANES } from "@arcade1v1/game-sdk/racing";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";

const MAX_TICKS = 36_000;
const CAR_Y = RACING_CONST.HEIGHT - 80; // igual que el motor (CAR_Y privado)
const CHANGE_COOLDOWN = 8; // ticks mínimos entre cambios de carril (anti-vibración)
const CLEAR_CAP = RACING_CONST.HEIGHT; // holgura si el carril está limpio por delante
const MARGIN_SCALE = 240; // px: boldness=0.3 => exige ~72px de ventaja para cambiar

const PARAMS = [
  {
    key: "boldness",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.05,
    def: 0.3,
    labelKey: "strat.racing.weaver.boldness",
  },
];

export const strategyRacingWeaver: StrategyDef = {
  id: "racing.weaver",
  game: "racing",
  labelKey: "strat.racing.weaver.name",
  descKey: "strat.racing.weaver.desc",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const boldness = num(params, PARAMS[0]);
    const g = new RacingEngine(seed);
    const inputs: { t: number; a: "l" | "r" }[] = [];
    let cooldown = 0;

    /** Distancia al obstáculo más cercano por delante (arriba del auto) en
     *  `lane`; CLEAR_CAP si no hay ninguno. Más holgura = más seguro. */
    const clearance = (lane: number): number => {
      let best = CLEAR_CAP;
      for (const o of g.obstacles) {
        if (o.lane !== lane || o.y >= CAR_Y) continue; // solo lo que viene por delante
        const d = CAR_Y - o.y;
        if (d < best) best = d;
      }
      return best;
    };

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0) {
        const here = clearance(g.carLane);
        let bestLane = g.carLane;
        let bestClear = here;
        for (const l of [g.carLane - 1, g.carLane + 1]) {
          if (l < 0 || l >= LANES) continue;
          const c = clearance(l);
          if (c > bestClear) {
            bestClear = c;
            bestLane = l;
          }
        }
        const margin = boldness * MARGIN_SCALE;
        if (bestLane !== g.carLane && bestClear - here > margin) {
          const a: "l" | "r" = bestLane < g.carLane ? "l" : "r";
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
