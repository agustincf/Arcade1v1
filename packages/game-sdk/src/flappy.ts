// Motor del Flappy COMPARTIDO entre web y servidor. Determinístico con dt fijo:
// dadas la misma semilla + los mismos aleteos en los mismos ticks, el resultado
// es idéntico, así el servidor re-simula el replay y verifica el puntaje.

export const WIDTH = 320;
export const HEIGHT = 480;
export const FLAPPY_DT = 1 / 60; // paso fijo de fisica (segundos por tick)

const BIRD_X = 70;
const BIRD_R = 12;
const GRAVITY = 1350;
const FLAP_VY = -400;
const PIPE_W = 58;
const GAP = 158;
const PIPE_SPACING = 215;
const MARGIN = 72;
const GROUND_H = 36;

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

export interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

export class FlappyEngine {
  birdY = HEIGHT / 2;
  birdVy = 0;
  pipes: Pipe[] = [];
  score = 0;
  over = false;
  started = false;

  private rng: () => number;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.addPipe(WIDTH + 80);
  }

  private randomGapY(): number {
    const usable = HEIGHT - GROUND_H - 2 * MARGIN;
    return MARGIN + this.rng() * usable;
  }

  private addPipe(x: number) {
    this.pipes.push({ x, gapY: this.randomGapY(), passed: false });
  }

  flap() {
    if (this.over) return;
    this.started = true;
    this.birdVy = FLAP_VY;
  }

  pipeSpeed(): number {
    return 120 + this.score * 3;
  }

  update(dt: number) {
    if (this.over || !this.started) return;

    this.birdVy += GRAVITY * dt;
    this.birdY += this.birdVy * dt;

    const speed = this.pipeSpeed();
    for (const p of this.pipes) p.x -= speed * dt;

    if (this.pipes.length && this.pipes[0].x < -PIPE_W) this.pipes.shift();
    const last = this.pipes[this.pipes.length - 1];
    if (last && last.x < WIDTH - PIPE_SPACING) this.addPipe(last.x + PIPE_SPACING);

    for (const p of this.pipes) {
      if (!p.passed && p.x + PIPE_W < BIRD_X) {
        p.passed = true;
        this.score += 1;
      }
    }

    if (this.birdY - BIRD_R < 0 || this.birdY + BIRD_R > HEIGHT - GROUND_H) {
      this.over = true;
      return;
    }

    for (const p of this.pipes) {
      const inX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
      if (!inX) continue;
      const topGap = p.gapY - GAP / 2;
      const bottomGap = p.gapY + GAP / 2;
      if (this.birdY - BIRD_R < topGap || this.birdY + BIRD_R > bottomGap) {
        this.over = true;
        return;
      }
    }
  }
}

export const FLAPPY_CONST = { WIDTH, HEIGHT, BIRD_X, BIRD_R, PIPE_W, GAP, GROUND_H };

/** Replay: semilla + ticks totales + los ticks en los que se aleteo. */
export interface ReplayFlappy {
  seed: number;
  ticks: number;
  flaps: number[];
}

/** ANTI-TRAMPA: re-simula el replay con dt fijo y devuelve el puntaje real. */
export function verifyFlappy(r: ReplayFlappy): number {
  const g = new FlappyEngine(r.seed);
  const flapSet = new Set(r.flaps);
  for (let t = 0; t < r.ticks; t++) {
    if (flapSet.has(t)) g.flap();
    g.update(FLAPPY_DT);
    if (g.over) break;
  }
  return g.score;
}
