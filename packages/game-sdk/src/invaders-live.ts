// Space Invaders EN VIVO (reglas v2): su definición para el modo en vivo
// genérico (live-play.ts). Cada bloque de INVADERS_LIVE_BLOCK ticks sale de UN
// valor al azar (ver el constructor de InvadersEngine), así que el árbitro
// revela cada bloque LIVE_LEAD_TICKS antes de que empiece: una bomba o el OVNI
// se conocen como mucho un bloque y LIVE_LEAD_TICKS antes.
// Diseño: docs/superpowers/specs/2026-11-18-invaders-en-vivo-design.md

import { InvadersEngine, type InvaderAction } from "./invaders";
import type { LiveGame, LiveInput } from "./live";
import { verifyLive } from "./live-play";

/** A lo sumo tantas acciones por tick: cada tecla (izquierda, derecha,
 *  disparo), una vez apretar y una vez soltar. */
export const INVADERS_MAX_ACTIONS_PER_TICK = 6;

/** Cuántas jugadas puede tener un intento con `ticks` ticks jugados: en
 *  promedio una cada 3 ticks, con un margen para empezar. Hay jugadas que no
 *  cambian nada (soltar una tecla suelta) y el registro se guarda en cada
 *  compromiso: sin tope, quien sobrevive podría inflarlo. La estrategia de la
 *  casa llega a una cada 6,9 ticks en el peor caso medido; una persona que toca
 *  el disparo sin parar, a una cada 4 o 5. */
export function invadersInputBudget(ticks: number): number {
  return Math.floor(ticks / 3) + 64;
}

const ACTIONS: readonly InvaderAction[] = ["l1", "l0", "r1", "r0", "f1", "f0"];

/** Space Invaders para el modo en vivo: las teclas de siempre (apretar y
 *  soltar), aplicadas en orden antes de avanzar el tick, como en
 *  `verifyInvaders`. */
export const invadersLive: LiveGame<InvadersEngine> = {
  id: "invaders",
  create: (src) => new InvadersEngine(src),
  step(engine, actions) {
    for (const a of actions) engine.apply(a as InvaderAction);
    engine.tick();
  },
  over: (engine) => engine.over,
  score: (engine) => engine.score,
  drawsWithin: (engine, ticks) => engine.drawsWithin(ticks),
  wire: "inputs",
  actions: ACTIONS,
  maxActionsPerTick: INVADERS_MAX_ACTIONS_PER_TICK,
  inputBudget: invadersInputBudget,
};

/** Re-verifica un intento de Invaders en vivo con el secreto que el árbitro
 *  publica al decidirse la partida. Misma semántica que `verifyInvaders` (en
 *  cada tick, sus acciones en orden y después `tick`; al terminar se corta).
 *  Devuelve el puntaje. */
export function verifyInvadersLive(
  secret: string,
  replay: { ticks: number; inputs: LiveInput[] },
): number {
  return verifyLive(invadersLive, secret, replay);
}
