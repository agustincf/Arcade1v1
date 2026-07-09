// Estrategia de Space Invaders: perseguir la columna de aliens más cercana
// (o el OVNI bonus), disparar cuando está alineado y esquivar bombas. Las
// acciones son toggles de "mantener apretado": solo se registran las
// transiciones, así el replay queda chico.

import {
  InvadersEngine,
  INVADERS_CONST,
  ALIEN_W,
  type InvaderAction,
} from "@arcade1v1/game-sdk/invaders";
import type { StrategyDef, PlayResult } from "./types";
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

export const strategyInvadersHunter: StrategyDef = {
  id: "invaders.hunter",
  game: "invaders",
  labelKey: "strat.invaders.hunter.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const aggression = num(params, PARAMS[0]);
    const dodge = num(params, PARAMS[1]);
    const g = new InvadersEngine(seed);
    const inputs: { t: number; a: InvaderAction }[] = [];

    // Estado de teclas "apretadas" que nosotros creemos tener (para emitir
    // solo transiciones l1/l0, r1/r0, f1/f0).
    let left = false;
    let right = false;
    let fire = false;
    const lastChange: Record<"l" | "r" | "f", number> = {
      l: -MIN_HOLD,
      r: -MIN_HOLD,
      f: -MIN_HOLD,
    };
    const set = (t: number, key: "l" | "r" | "f", on: boolean, force = false) => {
      const cur = key === "l" ? left : key === "r" ? right : fire;
      if (cur === on) return;
      // Histéresis temporal: sin esto, perseguir un blanco que oscila genera
      // miles de toggles y el replay explota el límite de tamaño.
      if (!force && t - lastChange[key] < MIN_HOLD) return;
      if (key === "l") left = on;
      else if (key === "r") right = on;
      else fire = on;
      lastChange[key] = t;
      const a = `${key}${on ? 1 : 0}` as InvaderAction;
      g.apply(a);
      inputs.push({ t, a });
    };

    const dodgeRadius = dodge * 40;
    const fireTolerance = 4 + aggression * 40;

    let coasting = false;
    for (let t = 0; t < MAX_TICKS && !g.over; t++) {
      // Cerca del tope de inputs: "modo crucero" determinista (quieto y
      // disparando) para que el replay nunca supere el límite del árbitro.
      if (!coasting && inputs.length >= MAX_INPUTS - 3) {
        set(t, "l", false, true);
        set(t, "r", false, true);
        set(t, "f", true, true);
        coasting = true;
      }
      if (coasting) {
        g.tick();
        continue;
      }
      if (t % DECIDE_EVERY !== 0) {
        g.tick();
        continue;
      }
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
      set(t, "l", diff < -MOVE_DEADZONE);
      set(t, "r", diff > MOVE_DEADZONE);
      // Agresividad = tolerancia de puntería: alta dispara casi siempre.
      set(t, "f", Math.abs(diff) < fireTolerance);

      g.tick();
    }

    return { score: g.score, replay: { seed, ticks: MAX_TICKS, inputs } };
  },
};
