// Carrera EN VIVO (reglas v3): su definición para el modo en vivo genérico
// (live-play.ts). Cada fila de obstáculos sale de UN valor al azar (ver el
// constructor de RacingEngine), así que el árbitro revela cada fila
// LIVE_LEAD_TICKS antes de que nazca, igual que los tubos de Flappy.
// Diseño: docs/superpowers/specs/2026-10-10-carrera-en-vivo-design.md

import { RacingEngine, RACING_DT } from "./racing";
import type { LiveGame, LiveInput } from "./live";
import { verifyLive } from "./live-play";

/** A lo sumo tantas acciones por tick (izquierda, derecha, saltar). */
export const RACING_MAX_ACTIONS_PER_TICK = 3;

/** Cuántas jugadas puede tener un intento con `ticks` ticks jugados: en
 *  promedio una cada 4 ticks, con un margen para empezar. En Carrera hay
 *  jugadas que no cambian nada (ir a la izquierda en el carril izquierdo,
 *  saltar en el aire): sin este tope, quien sobrevive podría inflar su registro,
 *  que se reescribe entero en cada compromiso. Una persona o una estrategia
 *  razonable no se acercan (las de la casa cambian de carril cada 8 ticks como
 *  mucho). */
export function racingInputBudget(ticks: number): number {
  return Math.floor(ticks / 4) + 64;
}

/** Carrera para el modo en vivo: acciones `l`, `r` y `j`, aplicadas en orden
 *  antes de avanzar el tick, como en `verifyRacing`. */
export const racingLive: LiveGame<RacingEngine> = {
  id: "racing",
  create: (src) => new RacingEngine(src),
  step(engine, actions) {
    for (const a of actions) {
      if (a === "l") engine.moveLeft();
      else if (a === "r") engine.moveRight();
      else if (a === "j") engine.jump();
    }
    engine.update(RACING_DT);
  },
  over: (engine) => engine.over,
  score: (engine) => engine.score,
  drawsWithin: (engine, ticks) => engine.drawsWithin(ticks),
  wire: "inputs",
  actions: ["l", "r", "j"],
  maxActionsPerTick: RACING_MAX_ACTIONS_PER_TICK,
  inputBudget: racingInputBudget,
};

/** Re-verifica un intento de Carrera en vivo con el secreto que el árbitro
 *  publica al decidirse la partida. Misma semántica que `verifyRacing` (en
 *  cada tick, sus acciones en orden y después `update`; al chocar se corta).
 *  Devuelve el puntaje. */
export function verifyRacingLive(
  secret: string,
  replay: { ticks: number; inputs: LiveInput[] },
): number {
  return verifyLive(racingLive, secret, replay);
}
