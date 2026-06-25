// Motor del Tetris COMPARTIDO entre la web y el servidor (árbitro).
// Es DETERMINISTICO: avanza por "ticks" (paso fijo), no por reloj. Así, dados
// la misma semilla + las mismas teclas en los mismos ticks, el resultado es
// idéntico → el servidor puede re-simular el "replay" y verificar el puntaje.

export const COLS = 10;
export const ROWS = 20;

const BASE_SHAPES: number[][][] = [
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ], // I
  [
    [1, 1],
    [1, 1],
  ], // O
  [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ], // T
  [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ], // S
  [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ], // Z
  [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ], // J
  [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ], // L
];

export const PIECE_COLORS = [
  "#27e8ff",
  "#ffd23d",
  "#c06bff",
  "#39ff7a",
  "#ff4d6d",
  "#4d8bff",
  "#ff9f1c",
];

function rotateCW(m: number[][]): number[][] {
  const n = m.length;
  const res = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) res[c][n - 1 - r] = m[r][c];
  return res;
}

const ROTATIONS: number[][][][] = BASE_SHAPES.map((shape) => {
  const rots = [shape];
  let cur = shape;
  for (let i = 0; i < 3; i++) {
    cur = rotateCW(cur);
    rots.push(cur);
  }
  return rots;
});

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

interface ActivePiece {
  type: number;
  rot: number;
  x: number;
  y: number;
}

const LINE_SCORE = [0, 40, 100, 300, 1200];
// Cuadros (a 60 ticks/seg) por caida, segun nivel 0..28 (tabla clasica NES).
const FRAMES = [
  48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
];

/** Acciones que puede hacer el jugador (codificadas para el replay). */
export type TetrisAction = "l" | "r" | "cw" | "ccw" | "s" | "h";

export interface ReplayTetris {
  seed: number;
  ticks: number;
  inputs: { t: number; a: TetrisAction }[];
}

export class TetrisEngine {
  board: number[][];
  cur: ActivePiece | null = null;
  score = 0;
  lines = 0;
  level = 0;
  over = false;

  private rng: () => number;
  private queue: number[] = [];
  private dropTimer = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.spawnNext();
  }

  private refillBag() {
    const bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.queue.push(...bag);
  }

  private takeNextType(): number {
    if (this.queue.length === 0) this.refillBag();
    return this.queue.shift() as number;
  }

  peekNextType(): number {
    if (this.queue.length === 0) this.refillBag();
    return this.queue[0];
  }

  private cellsOf(type: number, rot: number): [number, number][] {
    const m = ROTATIONS[type][rot];
    const out: [number, number][] = [];
    for (let r = 0; r < m.length; r++)
      for (let c = 0; c < m.length; c++) if (m[r][c]) out.push([r, c]);
    return out;
  }

  private collides(type: number, rot: number, x: number, y: number): boolean {
    for (const [r, c] of this.cellsOf(type, rot)) {
      const br = y + r;
      const bc = x + c;
      if (bc < 0 || bc >= COLS || br >= ROWS) return true;
      if (br >= 0 && this.board[br][bc] !== 0) return true;
    }
    return false;
  }

  private spawnNext() {
    const type = this.takeNextType();
    const size = ROTATIONS[type][0].length;
    const x = Math.floor((COLS - size) / 2);
    const piece: ActivePiece = { type, rot: 0, x, y: 0 };
    if (this.collides(piece.type, piece.rot, piece.x, piece.y)) {
      this.over = true;
      this.cur = null;
      return;
    }
    this.cur = piece;
  }

  move(dx: number): boolean {
    if (!this.cur || this.over) return false;
    const { type, rot, x, y } = this.cur;
    if (!this.collides(type, rot, x + dx, y)) {
      this.cur.x += dx;
      return true;
    }
    return false;
  }

  rotate(dir: number): boolean {
    if (!this.cur || this.over) return false;
    const { type, x, y } = this.cur;
    const newRot = (this.cur.rot + dir + 4) % 4;
    for (const k of [0, -1, 1, -2, 2]) {
      if (!this.collides(type, newRot, x + k, y)) {
        this.cur.rot = newRot;
        this.cur.x = x + k;
        return true;
      }
    }
    return false;
  }

  private stepDown(): boolean {
    if (!this.cur || this.over) return false;
    const { type, rot, x, y } = this.cur;
    if (!this.collides(type, rot, x, y + 1)) {
      this.cur.y += 1;
      return true;
    }
    this.lock();
    return false;
  }

  softDrop() {
    if (this.stepDown()) this.score += 1;
  }

  hardDrop() {
    if (!this.cur || this.over) return;
    let dropped = 0;
    while (!this.collides(this.cur.type, this.cur.rot, this.cur.x, this.cur.y + 1)) {
      this.cur.y += 1;
      dropped += 1;
    }
    this.score += dropped * 2;
    this.lock();
  }

  private lock() {
    if (!this.cur) return;
    const color = this.cur.type + 1;
    let topOut = false;
    for (const [r, c] of this.cellsOf(this.cur.type, this.cur.rot)) {
      const br = this.cur.y + r;
      const bc = this.cur.x + c;
      if (br < 0) {
        topOut = true;
        continue;
      }
      this.board[br][bc] = color;
    }
    this.clearLines();
    if (topOut) {
      this.over = true;
      this.cur = null;
      return;
    }
    this.spawnNext();
  }

  private clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every((v) => v !== 0)) {
        this.board.splice(r, 1);
        this.board.unshift(Array(COLS).fill(0));
        cleared += 1;
        r += 1;
      }
    }
    if (cleared > 0) {
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10);
      this.score += LINE_SCORE[cleared] * (this.level + 1);
    }
  }

  /** Cuadros por caida segun el nivel (mas alto = mas rapido). */
  framesPerDrop(): number {
    return this.level <= 28 ? FRAMES[this.level] : 1;
  }

  /** Un "tick" de juego (paso fijo). La gravedad cae cada framesPerDrop ticks. */
  tick() {
    if (this.over) return;
    this.dropTimer += 1;
    if (this.dropTimer >= this.framesPerDrop()) {
      this.dropTimer = 0;
      this.stepDown();
    }
  }

  /** Aplica una accion del jugador. */
  apply(a: TetrisAction) {
    if (a === "l") this.move(-1);
    else if (a === "r") this.move(1);
    else if (a === "cw") this.rotate(1);
    else if (a === "ccw") this.rotate(-1);
    else if (a === "s") this.softDrop();
    else if (a === "h") this.hardDrop();
  }

  render(): number[][] {
    const b = this.board.map((row) => row.slice());
    if (this.cur) {
      const color = this.cur.type + 1;
      for (const [r, c] of this.cellsOf(this.cur.type, this.cur.rot)) {
        const br = this.cur.y + r;
        const bc = this.cur.x + c;
        if (br >= 0 && br < ROWS && bc >= 0 && bc < COLS) b[br][bc] = color;
      }
    }
    return b;
  }

  nextPieceMatrix(): number[][] {
    return ROTATIONS[this.peekNextType()][0];
  }

  ghost(): { cells: [number, number][]; color: string } | null {
    if (!this.cur) return null;
    let gy = this.cur.y;
    while (!this.collides(this.cur.type, this.cur.rot, this.cur.x, gy + 1)) gy++;
    const cells: [number, number][] = [];
    for (const [r, c] of this.cellsOf(this.cur.type, this.cur.rot))
      cells.push([gy + r, this.cur.x + c]);
    return { cells, color: PIECE_COLORS[this.cur.type] };
  }
}

/** ANTI-TRAMPA: re-simula el replay tick por tick y devuelve el puntaje real. */
export function verifyTetris(replay: ReplayTetris): number {
  const g = new TetrisEngine(replay.seed);
  const byTick = new Map<number, TetrisAction[]>();
  for (const inp of replay.inputs) {
    const arr = byTick.get(inp.t) ?? [];
    arr.push(inp.a);
    byTick.set(inp.t, arr);
  }
  for (let t = 0; t < replay.ticks; t++) {
    const acts = byTick.get(t);
    if (acts) for (const a of acts) g.apply(a);
    g.tick();
    if (g.over) break;
  }
  return g.score;
}
