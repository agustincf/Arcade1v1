// Motor del 2048: grilla 4x4. Deslizas y las fichas iguales se combinan.
// Puntaje = suma de las combinaciones (asincronico: gana el de mas puntos).

export const SIZE = 4;
export type Dir = "left" | "right" | "up" | "down";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game2048 {
  board: number[][];
  score = 0;
  over = false;

  private rng: () => number;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    this.addRandom();
    this.addRandom();
  }

  private empties(): [number, number][] {
    const e: [number, number][] = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (this.board[r][c] === 0) e.push([r, c]);
    return e;
  }

  private addRandom() {
    const e = this.empties();
    if (!e.length) return;
    const [r, c] = e[Math.floor(this.rng() * e.length)];
    this.board[r][c] = this.rng() < 0.9 ? 2 : 4;
  }

  /** Desliza una fila a la izquierda combinando iguales. */
  private slide(row: number[]): { row: number[]; gained: number; changed: boolean } {
    const arr = row.filter((v) => v !== 0);
    const out: number[] = [];
    let gained = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
        const merged = arr[i] * 2;
        out.push(merged);
        gained += merged;
        i++;
      } else {
        out.push(arr[i]);
      }
    }
    while (out.length < SIZE) out.push(0);
    const changed = out.some((v, i) => v !== row[i]);
    return { row: out, gained, changed };
  }

  private cols(b: number[][]): number[][] {
    const out: number[][] = [];
    for (let c = 0; c < SIZE; c++) {
      const col: number[] = [];
      for (let r = 0; r < SIZE; r++) col.push(b[r][c]);
      out.push(col);
    }
    return out;
  }

  private fromCols(cols: number[][]): number[][] {
    const out = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    for (let c = 0; c < SIZE; c++)
      for (let r = 0; r < SIZE; r++) out[r][c] = cols[c][r];
    return out;
  }

  /** Mueve en una direccion. Devuelve true si algo cambio. */
  move(dir: Dir): boolean {
    const b = this.board;
    let rows: number[][];
    if (dir === "left") rows = b.map((r) => r.slice());
    else if (dir === "right") rows = b.map((r) => r.slice().reverse());
    else if (dir === "up") rows = this.cols(b);
    else rows = this.cols(b).map((r) => r.reverse());

    let changed = false;
    let gained = 0;
    const moved = rows.map((row) => {
      const res = this.slide(row);
      gained += res.gained;
      if (res.changed) changed = true;
      return res.row;
    });

    let nb: number[][];
    if (dir === "left") nb = moved;
    else if (dir === "right") nb = moved.map((r) => r.reverse());
    else if (dir === "up") nb = this.fromCols(moved);
    else nb = this.fromCols(moved.map((r) => r.reverse()));

    if (changed) {
      this.board = nb;
      this.score += gained;
      this.addRandom();
      if (!this.canMove()) this.over = true;
    }
    return changed;
  }

  private canMove(): boolean {
    if (this.empties().length) return true;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const v = this.board[r][c];
        if (c + 1 < SIZE && this.board[r][c + 1] === v) return true;
        if (r + 1 < SIZE && this.board[r + 1][c] === v) return true;
      }
    return false;
  }
}
