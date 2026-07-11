// Estrategia de 2048 "Esquinero": ordena el tablero hacia una esquina en vez de
// fusionar apenas puede. Anticipa 1 jugada sobre una copia PURA del tablero
// (reusa applyDir de g2048) y puntúa la calidad resultante: celdas vacías +
// monotonía hacia la esquina, con un toque de fusión modulado por `patience`.
// Aplica la dirección elegida al motor real, así el replay verifica idéntico.

import { Game2048, SIZE, type Dir } from "@arcade1v1/game-sdk/g2048";
import type { StrategyDef, PlayResult } from "./types";
import { num, choice } from "./params";
import { applyDir } from "./g2048";

const DIRS: Dir[] = ["down", "left", "right", "up"];
const MAX_MOVES = 5000;

type Corner = "down-left" | "down-right" | "up-left" | "up-right";

function log2v(v: number): number {
  return v > 0 ? Math.log2(v) : 0;
}

/** Cantidad de celdas vacías (más = mejor: supervivencia). */
function empties(board: number[][]): number {
  let n = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] === 0) n++;
  return n;
}

/** Penalización por romper el gradiente hacia la esquina (0 = perfecto, <0 peor).
 *  Para "*-left" queremos las fichas grandes a la izquierda; para "down-*",
 *  abajo. Usa log2 de los valores para que la escala sea sana. */
function monotonicity(board: number[][], corner: Corner): number {
  const wantLeftBig = corner.endsWith("left");
  const wantBottomBig = corner.startsWith("down");
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c + 1 < SIZE; c++) {
      const a = log2v(board[r][c]);
      const b = log2v(board[r][c + 1]);
      score -= wantLeftBig ? Math.max(0, b - a) : Math.max(0, a - b);
    }
  }
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r + 1 < SIZE; r++) {
      const a = log2v(board[r][c]);
      const b = log2v(board[r + 1][c]);
      score -= wantBottomBig ? Math.max(0, a - b) : Math.max(0, b - a);
    }
  }
  return score;
}

const PARAMS = [
  {
    key: "corner",
    kind: "choice" as const,
    options: ["down-left", "down-right", "up-left", "up-right"],
    def: "down-left",
    labelKey: "strat.2048.corner.corner",
  },
  {
    key: "patience",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.7,
    labelKey: "strat.2048.corner.patience",
  },
];

export const strategy2048Corner: StrategyDef = {
  id: "2048.corner",
  game: "2048",
  labelKey: "strat.2048.corner.name",
  descKey: "strat.2048.corner.desc",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const corner = choice(params, PARAMS[0]) as Corner;
    const patience = num(params, PARAMS[1]);
    const g = new Game2048(seed);
    const moves: Dir[] = [];
    let guard = 0;
    while (!g.over && guard < MAX_MOVES) {
      let best: Dir | null = null;
      let bestValue = -Infinity;
      for (const d of DIRS) {
        const { board: nb, gained, changed } = applyDir(g.board, d);
        if (!changed) continue;
        // Orden (vacíos + monotonía) pesado por paciencia; fusión inmediata por
        // lo que reste. Paciente (0.7) => prioriza dejar el tablero ordenado.
        const order = empties(nb) + monotonicity(nb, corner);
        const value = patience * order + (1 - patience) * (gained * 0.25);
        if (value > bestValue) {
          bestValue = value;
          best = d;
        }
      }
      if (best === null) break;
      if (!g.move(best)) break;
      moves.push(best);
      guard++;
    }
    return { score: g.score, replay: { seed, moves } };
  },
};
