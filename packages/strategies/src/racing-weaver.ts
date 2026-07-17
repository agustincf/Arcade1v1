// Estrategia de la Carrera "Serpenteador": en vez de esquivar reactivo desde un
// carril fijo, encara siempre hacia el carril con más pista despejada por
// delante, de a un paso. Dos capas: si algo se viene cerca en el propio carril,
// escapa YA (los spawns "dobles" bloquean 2 de 3 carriles, hay que caer en el
// libre); si va tranquilo, solo deriva cuando otro carril es claramente mejor
// (`boldness`). Maneja el motor real, así el replay verifica idéntico.

import {
  RacingEngine,
  RACING_DT,
  RACING_CONST,
  RACING_RULES_V,
  LANES,
  type RaceAction,
} from "@arcade1v1/game-sdk/racing";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";

const MAX_TICKS = 36_000;
const CAR_Y = RACING_CONST.HEIGHT - 80; // igual que el motor (CAR_Y privado)
const CENTER = (LANES - 1) / 2; // carril "hogar": desde el centro se escapa cualquier doble
const CHANGE_COOLDOWN = 4; // anti-thrash; corto para reencadenar saltos y esquivar dobles
const CLEAR_CAP = RACING_CONST.HEIGHT; // holgura si el carril está limpio por delante
const HIT_BAND = 55; // px: un obstáculo hasta acá por debajo del auto todavía choca (colisión < 47)
const DANGER = 180; // px: obstáculo propio dentro de esta distancia => escapar ya
const CENTER_BIAS = 70; // px: preferencia por el centro (escapabilidad) en empates de holgura
const MARGIN_SCALE = 240; // px: boldness=0.3 => deriva si un carril es ~72px más despejado

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
  {
    key: "coinGreed",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.4,
    labelKey: "strat.racing.weaver.coinGreed",
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
    const coinGreed = num(params, PARAMS[1]);
    const g = new RacingEngine(seed);
    const inputs: { t: number; a: RaceAction }[] = [];
    let cooldown = 0;

    /** Holgura de un carril = hueco al obstáculo más cercano que todavía puede
     *  chocar (por delante o a la altura del auto, hasta HIT_BAND por debajo).
     *  Negativa si hay uno encima: así ese carril NO se elige para meterse. */
    const clearance = (lane: number): number => {
      let best = CLEAR_CAP;
      for (const o of g.obstacles) {
        if (o.lane !== lane || o.y >= CAR_Y + HIT_BAND) continue; // ya pasó de largo
        const gap = CAR_Y - o.y; // puede ser negativo (obstáculo a la altura del auto)
        if (gap < best) best = gap;
      }
      return best;
    };

    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0) {
        // Holgura con sesgo al centro: un extremo tiene que ser bastante más
        // despejado para ganarle al centro (que es escapable ante dobles). En
        // ruta abierta todos empatan en CAP y el sesgo devuelve al auto al medio.
        // Sesgo de monedas: empuja hacia un carril vecino con fila de monedas
        // a la vista, sin pisar el candado de seguridad (clearance sigue mandando).
        const coinBias = (lane: number): number =>
          coinGreed > 0 &&
          g.coins.some((c) => !c.taken && c.lane === lane && c.y < CAR_Y && c.y > CAR_Y - 300)
            ? coinGreed * 40
            : 0;
        const eff = (lane: number): number =>
          clearance(lane) - CENTER_BIAS * Math.abs(lane - CENTER) + coinBias(lane);
        let target = g.carLane;
        let bestEff = eff(g.carLane);
        for (let l = 0; l < LANES; l++) {
          const e = eff(l);
          if (e > bestEff) {
            bestEff = e;
            target = l;
          }
        }
        // Urgente (algo cerca en mi carril): encarar al mejor sin exigir margen.
        // Crucero: solo derivar si el mejor supera al actual por el margen.
        const urgent = clearance(g.carLane) < DANGER;
        const margin = urgent ? 0 : boldness * MARGIN_SCALE;
        if (target !== g.carLane && bestEff - eff(g.carLane) > margin) {
          const a: "l" | "r" = target < g.carLane ? "l" : "r"; // un carril hacia el objetivo
          if (a === "l") g.moveLeft();
          else g.moveRight();
          inputs.push({ t, a });
          cooldown = CHANGE_COOLDOWN;
        }
        // v2: si me quedé sin deriva y lo que tengo encima es una VALLA, saltar.
        if (!g.airborne && clearance(g.carLane) < DANGER) {
          const threat = g.obstacles
            .filter((o) => o.lane === g.carLane && o.y < CAR_Y + HIT_BAND)
            .sort((a, b) => b.y - a.y)[0];
          if (threat?.jumpable && CAR_Y - threat.y < 120) {
            g.jump();
            inputs.push({ t, a: "j" });
          }
        }
      }
      g.update(RACING_DT);
    }

    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs, v: RACING_RULES_V } };
  },
};
