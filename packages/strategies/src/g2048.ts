// Estrategia de 2048: prioridad de movimientos + "codicia" (peso del puntaje
// inmediato de fusión). Evalúa cada dirección con una copia PURA del tablero
// (sin tocar el motor) y aplica la elegida al motor real, así el replay
// verifica idéntico en el árbitro.

import { Game2048, SIZE, type Dir } from "@arcade1v1/game-sdk/g2048";
import type { StrategyDef, PlayResult } from "./types";
import { num, priority } from "./params";

const DIRS: Dir[] = ["down", "left", "right", "up"];
const MAX_MOVES = 5000; // tope de seguridad (una partida real termina mucho antes)

/** Desliza una fila hacia la izquierda (misma regla que el motor) sin RNG. */
function slide(row: number[]): { row: number[]; gained: number; changed: boolean } {
  const arr = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
      out.push(arr[i] * 2);
      gained += arr[i] * 2;
      i++;
    } else {
      out.push(arr[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  const changed = out.some((v, i) => v !== row[i]);
  return { row: out, gained, changed };
}

/** ¿Cuánto puntaje daría mover en `dir`? (y si cambia algo el tablero). */
function evalMove(board: number[][], dir: Dir): { gained: number; changed: boolean } {
  let rows: number[][];
  if (dir === "left") rows = board.map((r) => r.slice());
  else if (dir === "right") rows = board.map((r) => r.slice().reverse());
  else {
    const cols: number[][] = [];
    for (let c = 0; c < SIZE; c++) {
      const col: number[] = [];
      for (let r = 0; r < SIZE; r++) col.push(board[r][c]);
      cols.push(dir === "down" ? col.reverse() : col);
    }
    rows = cols;
  }
  let gained = 0;
  let changed = false;
  for (const row of rows) {
    const res = slide(row);
    gained += res.gained;
    if (res.changed) changed = true;
  }
  return { gained, changed };
}

const PARAMS = [
  {
    key: "priority",
    kind: "priority" as const,
    options: DIRS as string[],
    def: ["down", "left", "right", "up"],
    labelKey: "strat.2048.priority.priority",
  },
  {
    key: "greed",
    kind: "slider" as const,
    min: 0,
    max: 1,
    step: 0.1,
    def: 0.5,
    labelKey: "strat.2048.priority.greed",
  },
];

export const strategy2048Priority: StrategyDef = {
  id: "2048.priority",
  game: "2048",
  labelKey: "strat.2048.priority.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const order = priority(params, PARAMS[0]) as Dir[];
    const greed = num(params, PARAMS[1]);
    const g = new Game2048(seed);
    const moves: Dir[] = [];
    let guard = 0;
    while (!g.over && guard < MAX_MOVES) {
      // Valor de cada dirección: puntaje inmediato (pesado por greed) + bono
      // por posición en la prioridad (pesado por 1-greed). Escala del bono ~8
      // para que compita con las fusiones chicas típicas (4-32).
      let best: Dir | null = null;
      let bestValue = -Infinity;
      for (const d of order) {
        const { gained, changed } = evalMove(g.board, d);
        if (!changed) continue;
        const bonus = (order.length - order.indexOf(d)) * 8 * (1 - greed);
        const value = gained * greed + bonus;
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
