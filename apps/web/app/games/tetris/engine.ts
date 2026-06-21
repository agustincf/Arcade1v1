// Motor del Tetris: toda la logica del juego, SIN nada de pantalla.
// Asi la logica se puede probar y re-verificar (anti-trampa) por separado.
//
// Modelo: tablero de 10 columnas x 20 filas. 7 piezas clasicas. La dificultad
// sube por niveles cada 10 lineas (las piezas caen mas rapido). Puntaje clasico.

export const COLS = 10;
export const ROWS = 20;

// Las 7 piezas (tetrominos) en su orientacion inicial. 1 = bloque lleno.
const BASE_SHAPES: number[][][] = [
  // I
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  // O
  [
    [1, 1],
    [1, 1],
  ],
  // T
  [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  // S
  [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  // Z
  [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  // J
  [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  // L
  [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
];

/** Color (id 1..7) de cada pieza (paleta neon, a tono con la plataforma). */
export const PIECE_COLORS = [
  "#27e8ff", // I - cyan
  "#ffd23d", // O - dorado
  "#c06bff", // T - violeta
  "#39ff7a", // S - verde lima
  "#ff4d6d", // Z - rojo-rosa
  "#4d8bff", // J - azul
  "#ff9f1c", // L - naranja
];

/** Rota una matriz cuadrada 90 grados en sentido horario. */
function rotateCW(m: number[][]): number[][] {
  const n = m.length;
  const res = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      res[c][n - 1 - r] = m[r][c];
    }
  }
  return res;
}

// Para cada pieza, sus 4 rotaciones ya calculadas.
const ROTATIONS: number[][][][] = BASE_SHAPES.map((shape) => {
  const rots = [shape];
  let cur = shape;
  for (let i = 0; i < 3; i++) {
    cur = rotateCW(cur);
    rots.push(cur);
  }
  return rots;
});

/** Generador de numeros al azar CON semilla (mulberry32).
 *  Misma semilla = misma secuencia. Asi los dos jugadores reciben las piezas
 *  en el mismo orden y el juego es justo (por habilidad, no por suerte). */
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
  type: number; // 0..6
  rot: number; // 0..3
  x: number; // columna del borde izquierdo de la matriz
  y: number; // fila del borde superior de la matriz
}

const LINE_SCORE = [0, 40, 100, 300, 1200]; // puntos segun lineas hechas a la vez

export class TetrisEngine {
  board: number[][];
  cur: ActivePiece | null = null;
  score = 0;
  lines = 0;
  level = 0;
  over = false;

  private rng: () => number;
  private queue: number[] = [];

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.spawnNext();
  }

  // --- Generador de piezas con "bolsa de 7" (cada 7 piezas, las 7 mezcladas) ---
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

  /** Tipo de la proxima pieza (para la vista previa). */
  peekNextType(): number {
    if (this.queue.length === 0) this.refillBag();
    return this.queue[0];
  }

  private cellsOf(type: number, rot: number): [number, number][] {
    const m = ROTATIONS[type][rot];
    const out: [number, number][] = [];
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m.length; c++) {
        if (m[r][c]) out.push([r, c]);
      }
    }
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
      // No hay lugar para la pieza nueva: se acabo.
      this.over = true;
      this.cur = null;
      return;
    }
    this.cur = piece;
  }

  // --- Acciones ---

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
    // "Wall kicks" simples: si choca, probar correr la pieza al costado.
    for (const k of [0, -1, 1, -2, 2]) {
      if (!this.collides(type, newRot, x + k, y)) {
        this.cur.rot = newRot;
        this.cur.x = x + k;
        return true;
      }
    }
    return false;
  }

  /** Baja una fila por gravedad. Si no puede, fija la pieza. */
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

  /** Tick de gravedad (lo llama el reloj del juego). */
  gravityTick() {
    this.stepDown();
  }

  /** Bajada manual del jugador (suma 1 punto si baja). */
  softDrop() {
    if (this.stepDown()) this.score += 1;
  }

  /** Caida instantanea hasta el fondo (suma 2 puntos por fila). */
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
        r += 1; // volver a revisar la misma fila (ahora con lo de arriba bajado)
      }
    }
    if (cleared > 0) {
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10);
      this.score += LINE_SCORE[cleared] * (this.level + 1);
    }
  }

  /** Milisegundos entre cada caida automatica.
   *  Velocidad CLASICA del Tetris de arcade (tabla NES): la dificultad sube
   *  SOLO por nivel (cada 10 lineas), no por tiempo. Asi no es frustrante. */
  gravityMs(): number {
    // Cuadros (a 60fps) que tarda en bajar una fila, por nivel 0..28.
    const FRAMES = [
      48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2,
      2, 2, 2, 2, 2, 2, 2,
    ];
    const f = this.level <= 28 ? FRAMES[this.level] : 1;
    return f * (1000 / 60);
  }

  /** Devuelve el tablero con la pieza actual "dibujada" encima, para mostrarlo. */
  render(): number[][] {
    const b = this.board.map((row) => row.slice());
    if (this.cur) {
      const color = this.cur.type + 1;
      for (const [r, c] of this.cellsOf(this.cur.type, this.cur.rot)) {
        const br = this.cur.y + r;
        const bc = this.cur.x + c;
        if (br >= 0 && br < ROWS && bc >= 0 && bc < COLS) {
          b[br][bc] = color;
        }
      }
    }
    return b;
  }

  /** Matriz de la proxima pieza (para la vista previa). */
  nextPieceMatrix(): number[][] {
    return ROTATIONS[this.peekNextType()][0];
  }
}
