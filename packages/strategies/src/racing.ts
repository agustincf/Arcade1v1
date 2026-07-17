// Estrategia de la Carrera: seguir en el carril hasta que un obstáculo entre
// en la distancia de mirada, y ahí esquivar hacia el carril libre más cercano
// (con preferencia configurable). v2: si no hay carril limpio y lo que viene
// es una VALLA, la salta con timing; con `coinGreed`, deriva hacia filas de
// monedas cuando el desvío es seguro. Histéresis con cooldown anti-zigzag.

import {
  RacingEngine,
  RACING_DT,
  RACING_CONST,
  RACING_RULES_V,
  LANES,
  type RaceAction,
} from "@arcade1v1/game-sdk/racing";
import type { StrategyDef, PlayResult } from "./types";
import { num, choice } from "./params";

const MAX_TICKS = 36_000;
const CAR_Y = RACING_CONST.HEIGHT - 80; // igual que el motor (CAR_Y privado)
const CHANGE_COOLDOWN = 8; // ticks mínimos entre cambios de carril
const JUMP_LEAD = 120; // px: saltar cuando la valla entra en esta distancia
const COIN_SIGHT = 360; // px: hasta dónde "ve" monedas la codicia

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
  {
    key: "coinGreed",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.5,
    labelKey: "strat.racing.dodger.coinGreed",
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
    const coinGreed = num(params, PARAMS[2]);
    const g = new RacingEngine(seed);
    const inputs: { t: number; a: RaceAction }[] = [];
    let cooldown = 0;

    /** ¿Hay peligro en `lane` dentro de `dist` px? (una valla también lo es:
     *  solo deja de serlo en el instante del salto). */
    const danger = (lane: number, dist: number, solidOnly = false): boolean =>
      g.obstacles.some(
        (o) =>
          o.lane === lane &&
          (!solidOnly || !o.jumpable) &&
          o.y > CAR_Y - dist &&
          o.y < CAR_Y + RACING_CONST.CAR_H,
      );

    /** Valla más cercana por delante en `lane`, o null. */
    const nextBarrier = (lane: number) =>
      g.obstacles
        .filter((o) => o.lane === lane && o.jumpable && o.y < CAR_Y && o.y > CAR_Y - lookahead * 2)
        .sort((a, b) => b.y - a.y)[0] ?? null;

    /** ¿Hay monedas sin tomar en `lane` a la vista? */
    const coinsAhead = (lane: number): boolean =>
      g.coins.some((c) => !c.taken && c.lane === lane && c.y < CAR_Y && c.y > CAR_Y - COIN_SIGHT);

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0 && !g.airborne) {
        // OJO determinismo: este loop hace SIEMPRE un g.update() por tick
        // (nunca `continue` antes del update) — si no, el replay que graba no
        // coincide con la re-simulación del árbitro.
        let target = g.carLane;
        let jumped = false;
        if (danger(g.carLane, lookahead)) {
          // Elegir el carril vecino seguro; si hay dos, el más cercano al
          // preferido (con margen extra para no esquivar hacia otro peligro).
          const candidates = [g.carLane - 1, g.carLane + 1].filter(
            (l) => l >= 0 && l < LANES && !danger(l, lookahead + 40),
          );
          if (candidates.length > 0) {
            candidates.sort((a, b) => Math.abs(a - homeLane) - Math.abs(b - homeLane));
            target = candidates[0];
          } else {
            // Sin carril limpio: si lo mío es valla, saltarla con timing.
            const b = nextBarrier(g.carLane);
            if (b && CAR_Y - b.y < JUMP_LEAD) {
              g.jump();
              inputs.push({ t, a: "j" });
              jumped = true;
            } else {
              // Sólido en el mío y vecinos con valla: mejor pararse en la valla
              // (saltable, la salto después) que en el sólido.
              const softSide = [g.carLane - 1, g.carLane + 1].filter(
                (l) => l >= 0 && l < LANES && !danger(l, lookahead + 40, true),
              );
              if (softSide.length > 0) target = softSide[0];
            }
          }
        } else if (coinGreed > 0) {
          // Codicia: derivar hacia un carril vecino con monedas si está limpio.
          const sides = [g.carLane - 1, g.carLane + 1].filter(
            (l) => l >= 0 && l < LANES && coinsAhead(l) && !danger(l, lookahead * (2 - coinGreed)),
          );
          if (sides.length > 0) target = sides[0];
          else if (
            g.carLane !== homeLane &&
            !coinsAhead(g.carLane) &&
            !danger(homeLane, lookahead * 1.5) &&
            !danger(g.carLane + Math.sign(homeLane - g.carLane), lookahead * 1.5)
          ) {
            // Volver de a un carril al preferido cuando el camino está despejado.
            target = g.carLane + Math.sign(homeLane - g.carLane);
          }
        }
        if (!jumped && target !== g.carLane) {
          const a: RaceAction = target < g.carLane ? "l" : "r";
          if (a === "l") g.moveLeft();
          else g.moveRight();
          inputs.push({ t, a });
          cooldown = CHANGE_COOLDOWN;
        }
      }
      g.update(RACING_DT);
    }

    return {
      score: g.score,
      replay: { seed, ticks: MAX_TICKS, inputs, v: RACING_RULES_V },
    };
  },
};
