// Estrategia de Space Invaders: perseguir la columna de aliens más cercana
// (o el OVNI bonus), disparar cuando está alineado y esquivar bombas. Las
// acciones son toggles de "mantener apretado": solo se registran las
// transiciones, así el replay queda chico.
// La misma decisión juega con semilla (`play`) y EN VIVO (`step`): mira el motor
// del tick, sin azar futuro, y devuelve las teclas a cambiar sin tocarlo.

import {
  InvadersEngine,
  INVADERS_CONST,
  ALIEN_W,
  type InvaderAction,
} from "@arcade1v1/game-sdk/invaders";
import type { StrategyDef, PlayResult, LiveStep } from "./types";
import { num } from "./params";

const MAX_TICKS = 36_000;
const MOVE_DEADZONE = 6; // px: no perseguir diferencias mínimas (evita thrashing)
const DECIDE_EVERY = 3; // ticks entre decisiones (reacción humana-ish)
const MIN_HOLD = 6; // ticks mínimos antes de volver a togglear una tecla
const MAX_INPUTS = 8000; // el replay tiene que entrar en el límite de 256kb del árbitro

const PARAMS = [
  {
    key: "aggression",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.7,
    labelKey: "strat.invaders.hunter.aggression",
  },
  {
    key: "dodge",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.5,
    labelKey: "strat.invaders.hunter.dodge",
  },
];

/** La decisión del cazador para un tick: las teclas a cambiar, sin tocar el
 *  motor. Qué teclas están apretadas lo dice el motor (`held`), así un recorte
 *  o un intento retomado no la confunden; la histéresis y el tope de jugadas
 *  son su memoria. Se crea una por partida. */
function hunter(
  params: Record<string, unknown>,
): (g: InvadersEngine, t: number) => InvaderAction[] {
  const aggression = num(params, PARAMS[0]);
  const dodge = num(params, PARAMS[1]);
  const dodgeRadius = dodge * 40;
  const fireTolerance = 4 + aggression * 40;
  const lastChange: Record<"l" | "r" | "f", number> = {
    l: -MIN_HOLD,
    r: -MIN_HOLD,
    f: -MIN_HOLD,
  };
  let emitted = 0;
  let coasting = false;

  return (g, t) => {
    const out: InvaderAction[] = [];
    const held = g.held;
    const state = { l: held.left, r: held.right, f: held.fire };
    const set = (key: "l" | "r" | "f", on: boolean, force = false) => {
      if (state[key] === on) return;
      // Histéresis temporal: sin esto, perseguir un blanco que oscila genera
      // miles de toggles y el replay explota el límite de tamaño.
      if (!force && t - lastChange[key] < MIN_HOLD) return;
      state[key] = on;
      lastChange[key] = t;
      out.push(`${key}${on ? 1 : 0}` as InvaderAction);
      emitted += 1;
    };

    // Cerca del tope de inputs: "modo crucero" determinista (quieto y
    // disparando) para que el replay nunca supere el límite del árbitro.
    if (!coasting && emitted >= MAX_INPUTS - 3) {
      set("l", false, true);
      set("r", false, true);
      set("f", true, true);
      coasting = true;
    }
    if (coasting || t % DECIDE_EVERY !== 0) return out;

    // Blanco: el OVNI si está (vale 100), si no la columna viva más cercana.
    let targetX: number;
    if (g.ufo) {
      targetX = g.ufo.x + INVADERS_CONST.UFO_W / 2;
    } else {
      const aliens = g.aliveAliens();
      if (aliens.length === 0) {
        targetX = g.playerX; // entre oleadas: quedarse quieto
      } else {
        let best = aliens[0];
        let bestD = Infinity;
        for (const a of aliens) {
          const d = Math.abs(a.x + ALIEN_W / 2 - g.playerX);
          if (d < bestD) {
            bestD = d;
            best = a;
          }
        }
        targetX = best.x + ALIEN_W / 2;
      }
    }

    // Esquivar: si una bomba viene cayendo cerca, correrse pesa más que apuntar.
    if (dodgeRadius > 0) {
      const threat = g.bombs.find(
        (b) => Math.abs(b.x - g.playerX) < dodgeRadius && b.y > INVADERS_CONST.PLAYER_Y - 140,
      );
      if (threat) {
        targetX = threat.x < g.playerX ? g.playerX + 60 : g.playerX - 60;
      }
    }

    const diff = targetX - g.playerX;
    set("l", diff < -MOVE_DEADZONE);
    set("r", diff > MOVE_DEADZONE);
    // Agresividad = tolerancia de puntería: alta dispara casi siempre.
    set("f", Math.abs(diff) < fireTolerance);
    return out;
  };
}

export const strategyInvadersHunter: StrategyDef = {
  id: "invaders.hunter",
  game: "invaders",
  labelKey: "strat.invaders.hunter.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const decide = hunter(params);
    const g = new InvadersEngine(seed);
    const inputs: { t: number; a: InvaderAction }[] = [];
    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      for (const a of decide(g, t)) {
        g.apply(a);
        inputs.push({ t, a });
      }
      g.tick();
    }
    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs } };
  },
  step(params: Record<string, unknown>): LiveStep {
    const decide = hunter(params);
    return {
      decide: (engine, tick) => decide(engine as InvadersEngine, tick),
      maxTicks: MAX_TICKS,
    };
  },
};
