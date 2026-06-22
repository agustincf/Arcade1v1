// Motor del Snake COMPARTIDO web/servidor. Determinístico por ticks: misma
// semilla + mismas direcciones en los mismos ticks = mismo resultado, así el
// servidor re-simula el replay y verifica el puntaje (anti-trampa).

export const GRID = 17; // celdas por lado
export const SNAKE_DT = 1 / 60;

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

interface Pt {
  x: number;
  y: number;
}

export type SnakeAction = "u" | "d" | "l" | "r";

const DIRS: Record<SnakeAction, Pt> = {
  u: { x: 0, y: -1 },
  d: { x: 0, y: 1 },
  l: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
};

export class SnakeEngine {
  body: Pt[];
  dir: Pt = { x: 1, y: 0 };
  food: Pt = { x: 0, y: 0 };
  score = 0;
  over = false;

  private rng: () => number;
  private pendingDir: Pt = { x: 1, y: 0 };
  private tickCount = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    const c = Math.floor(GRID / 2);
    this.body = [
      { x: c, y: c },
      { x: c - 1, y: c },
      { x: c - 2, y: c },
    ];
    this.spawnFood();
  }

  private spawnFood() {
    const empties: Pt[] = [];
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (!this.body.some((s) => s.x === x && s.y === y)) empties.push({ x, y });
      }
    if (empties.length === 0) {
      this.over = true;
      return;
    }
    this.food = empties[Math.floor(this.rng() * empties.length)];
  }

  apply(a: SnakeAction) {
    const d = DIRS[a];
    // No se puede ir en reversa directa.
    if (d.x === -this.dir.x && d.y === -this.dir.y) return;
    this.pendingDir = d;
  }

  /** Cuadros entre movimientos: arranca lento y acelera con el puntaje. */
  moveEvery(): number {
    return Math.max(3, 8 - Math.floor(this.score / 3));
  }

  tick() {
    if (this.over) return;
    this.tickCount += 1;
    if (this.tickCount % this.moveEvery() === 0) this.step();
  }

  private step() {
    this.dir = this.pendingDir;
    const head = { x: this.body[0].x + this.dir.x, y: this.body[0].y + this.dir.y };
    if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
      this.over = true;
      return;
    }
    for (const s of this.body) {
      if (s.x === head.x && s.y === head.y) {
        this.over = true;
        return;
      }
    }
    this.body.unshift(head);
    if (head.x === this.food.x && head.y === this.food.y) {
      this.score += 1;
      this.spawnFood();
    } else {
      this.body.pop();
    }
  }
}

export interface ReplaySnake {
  seed: number;
  ticks: number;
  inputs: { t: number; a: SnakeAction }[];
}

/** ANTI-TRAMPA: re-simula el replay y devuelve el puntaje real. */
export function verifySnake(r: ReplaySnake): number {
  const g = new SnakeEngine(r.seed);
  const byTick = new Map<number, SnakeAction[]>();
  for (const inp of r.inputs) {
    const arr = byTick.get(inp.t) ?? [];
    arr.push(inp.a);
    byTick.set(inp.t, arr);
  }
  for (let t = 0; t < r.ticks; t++) {
    const acts = byTick.get(t);
    if (acts) for (const a of acts) g.apply(a);
    g.tick();
    if (g.over) break;
  }
  return g.score;
}
