// Estrategias de ejemplo: dada la semilla de la partida, juegan headless y
// devuelven el replay (semilla + inputs) listo para enviar al árbitro.
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";

export type PlayResult = { score: number; replay: unknown };
export type Strategy = (seed: number) => PlayResult;

export function strategy2048(
  seed: number,
  priority: Dir[] = ["down", "left", "right", "up"],
): PlayResult {
  const g = new Game2048(seed);
  const moves: Dir[] = [];
  let guard = 0;
  while (!g.over && guard < 5000) {
    let moved = false;
    for (const d of priority) {
      if (g.move(d)) {
        moves.push(d);
        moved = true;
        break;
      }
    }
    if (!moved) break;
    guard++;
  }
  return { score: g.score, replay: { seed, moves } };
}

export const DEFAULT_STRATEGIES: Record<string, Strategy> = {
  "2048": (seed) => strategy2048(seed),
};
