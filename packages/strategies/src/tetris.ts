// Estrategia de Tetris: para cada pieza enumera (rotación, columna), simula la
// caída sobre una copia del tablero y elige con una heurística clásica de 4
// pesos (huecos, altura, rugosidad, líneas). Aplica TODA la secuencia de la
// pieza (rotar, mover, hard drop) en un mismo tick sobre el motor real: el
// verificador aplica los inputs de un tick en orden, así que replay y juego
// quedan idénticos por construcción.

import {
  TetrisEngine,
  COLS,
  ROWS,
  pieceCells,
  type TetrisAction,
} from "@arcade1v1/game-sdk/tetris";
import type { StrategyDef, PlayResult } from "./types";
import { num } from "./params";

const MAX_PIECES = 600; // tope: mantiene el replay bien abajo del límite de 256kb
const BUDGET_PER_PIECE = 24; // tope de acciones por pieza (rotar + mover + drop)

function collides(board: number[][], cells: [number, number][], x: number, y: number): boolean {
  for (const [r, c] of cells) {
    const br = y + r;
    const bc = x + c;
    if (bc < 0 || bc >= COLS || br >= ROWS) return true;
    if (br >= 0 && board[br][bc] !== 0) return true;
  }
  return false;
}

interface Weights {
  holes: number;
  height: number;
  bump: number;
  lines: number;
}

/** Puntúa el tablero resultante de fijar la pieza en (rot, x) cayendo desde
 *  (fromY). Devuelve -Infinity si la colocación no es alcanzable. */
function scorePlacement(
  board: number[][],
  type: number,
  rot: number,
  x: number,
  fromY: number,
  w: Weights,
): number {
  const cells = pieceCells(type, rot);
  if (collides(board, cells, x, fromY)) return -Infinity;
  let y = fromY;
  while (!collides(board, cells, x, y + 1)) y++;

  // Fijar en una copia y contar líneas completas.
  const b = board.map((row) => row.slice());
  for (const [r, c] of cells) {
    const br = y + r;
    if (br < 0) return -Infinity; // quedaría fuera de la pantalla (top out)
    b[br][x + c] = 1;
  }
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (b[r].every((v) => v !== 0)) {
      b.splice(r, 1);
      b.unshift(Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }

  // Rasgos clásicos: altura agregada, huecos (celda vacía bajo el techo de su
  // columna) y rugosidad (diferencia de alturas entre columnas vecinas).
  const heights: number[] = [];
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let top = ROWS;
    for (let r = 0; r < ROWS; r++) {
      if (b[r][c] !== 0) {
        top = r;
        break;
      }
    }
    heights.push(ROWS - top);
    for (let r = top + 1; r < ROWS; r++) if (b[r][c] === 0) holes++;
  }
  let bump = 0;
  for (let c = 0; c + 1 < COLS; c++) bump += Math.abs(heights[c] - heights[c + 1]);
  const aggHeight = heights.reduce((a, h) => a + h, 0);

  return w.lines * cleared * cleared * 10 - w.holes * holes - w.height * aggHeight - w.bump * bump;
}

const PARAMS = [
  {
    key: "holes",
    kind: "slider" as const,
    min: 0,
    max: 10,
    step: 0.5,
    def: 7,
    labelKey: "strat.tetris.heuristic.holes",
  },
  {
    key: "height",
    kind: "slider" as const,
    min: 0,
    max: 10,
    step: 0.5,
    def: 5,
    labelKey: "strat.tetris.heuristic.height",
  },
  {
    key: "bumpiness",
    kind: "slider" as const,
    min: 0,
    max: 10,
    step: 0.5,
    def: 2,
    labelKey: "strat.tetris.heuristic.bumpiness",
  },
  {
    key: "lines",
    kind: "slider" as const,
    min: 0,
    max: 10,
    step: 0.5,
    def: 8,
    labelKey: "strat.tetris.heuristic.lines",
  },
];

export const strategyTetrisHeuristic: StrategyDef = {
  id: "tetris.heuristic",
  game: "tetris",
  labelKey: "strat.tetris.heuristic.name",
  params: PARAMS,
  play(seed: number, params: Record<string, unknown>): PlayResult {
    const w: Weights = {
      holes: num(params, PARAMS[0]),
      height: num(params, PARAMS[1]),
      bump: num(params, PARAMS[2]),
      lines: num(params, PARAMS[3]),
    };
    const g = new TetrisEngine(seed);
    const inputs: { t: number; a: TetrisAction }[] = [];
    const act = (t: number, a: TetrisAction) => {
      g.apply(a);
      inputs.push({ t, a });
    };

    let t = 0;
    for (let piece = 0; piece < MAX_PIECES && !g.over && g.cur; piece++) {
      const cur = g.cur;

      // Mejor (rotación, columna) alcanzable cayendo desde la posición actual.
      let bestRot = cur.rot;
      let bestX = cur.x;
      let bestValue = -Infinity;
      for (let rot = 0; rot < 4; rot++) {
        for (let x = -2; x < COLS; x++) {
          const value = scorePlacement(g.board, cur.type, rot, x, cur.y, w);
          if (value > bestValue) {
            bestValue = value;
            bestRot = rot;
            bestX = x;
          }
        }
      }

      // Ejecutar sobre el motor real leyendo el estado después de cada acción:
      // si una rotación no entra (con sus kicks) o un movimiento choca, se
      // adapta al estado logrado en vez de asumir el plan.
      let budget = BUDGET_PER_PIECE;
      while (g.cur === cur && cur.rot !== bestRot && budget-- > 0) {
        const before = cur.rot;
        act(t, "cw");
        if (cur.rot === before) {
          // Rotación bloqueada: recalcular la mejor columna para la rotación real.
          let v = -Infinity;
          for (let x = -2; x < COLS; x++) {
            const value = scorePlacement(g.board, cur.type, cur.rot, x, cur.y, w);
            if (value > v) {
              v = value;
              bestX = x;
            }
          }
          break;
        }
      }
      while (g.cur === cur && cur.x !== bestX && budget-- > 0) {
        const before = cur.x;
        act(t, cur.x > bestX ? "l" : "r");
        if (cur.x === before) break; // bloqueado contra la pila/pared
      }
      if (g.cur === cur) act(t, "h");

      g.tick();
      t++;
    }

    return { score: g.score, replay: { seed, ticks: t, inputs } };
  },
};
