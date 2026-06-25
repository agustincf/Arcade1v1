// Motor de la Carrera COMPARTIDO entre web y servidor. Determinístico con dt
// fijo: misma semilla + mismos cambios de carril en los mismos ticks = mismo
// resultado, así el servidor re-simula el replay y verifica el puntaje.

export const WIDTH = 320;
export const HEIGHT = 480;
export const LANES = 3;
export const RACING_DT = 1 / 60; // paso fijo de fisica (segundos por tick)

export const CAR_W = 42;
export const CAR_H = 66;
const CAR_Y = HEIGHT - 80;
const OBST_W = 44;
const OBST_H = 44;

export function laneX(lane: number): number {
  return WIDTH * ((lane * 2 + 1) / (LANES * 2));
}

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

export interface Obstacle {
  lane: number;
  y: number;
  kind: number;
  passed: boolean;
}

export class RacingEngine {
  carLane = 1;
  obstacles: Obstacle[] = [];
  score = 0;
  over = false;
  elapsedMs = 0;
  roadOffset = 0;

  private rng: () => number;
  private spawnTimer = 0;
  private lastLane = -1;
  private lastFree = -1;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  get carY() {
    return CAR_Y;
  }

  moveLeft() {
    if (this.over) return;
    if (this.carLane > 0) this.carLane -= 1;
  }

  moveRight() {
    if (this.over) return;
    if (this.carLane < LANES - 1) this.carLane += 1;
  }

  private level(): number {
    return Math.floor(this.elapsedMs / 8000);
  }

  speed(): number {
    return Math.min(480, 190 + this.level() * 35 + this.score * 2);
  }

  private spawnInterval(): number {
    return Math.max(0.5, 1.15 - this.level() * 0.07);
  }

  private addObstacle(lane: number) {
    this.obstacles.push({
      lane,
      y: -OBST_H,
      kind: Math.floor(this.rng() * 3),
      passed: false,
    });
  }

  private spawn() {
    const doubleChance = Math.min(0.5, 0.14 + this.level() * 0.06);
    if (this.rng() < doubleChance) {
      let free = Math.floor(this.rng() * LANES);
      if (free === this.lastFree) free = (free + 1) % LANES;
      this.lastFree = free;
      this.lastLane = -1;
      for (let lane = 0; lane < LANES; lane++) {
        if (lane !== free) this.addObstacle(lane);
      }
    } else {
      let lane = Math.floor(this.rng() * LANES);
      if (lane === this.lastLane) lane = (lane + 1) % LANES;
      this.lastLane = lane;
      this.lastFree = -1;
      this.addObstacle(lane);
    }
  }

  update(dt: number) {
    if (this.over) return;
    this.elapsedMs += dt * 1000;

    const v = this.speed();
    this.roadOffset = (this.roadOffset + v * dt) % 40;

    for (const o of this.obstacles) o.y += v * dt;

    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval()) {
      this.spawnTimer = 0;
      this.spawn();
    }

    for (const o of this.obstacles) {
      if (
        o.lane === this.carLane &&
        Math.abs(o.y - CAR_Y) < OBST_H / 2 + CAR_H / 2 - 8
      ) {
        this.over = true;
        return;
      }
      if (!o.passed && o.y > CAR_Y + CAR_H / 2) {
        o.passed = true;
        this.score += 1;
      }
    }

    this.obstacles = this.obstacles.filter((o) => o.y < HEIGHT + OBST_H);
  }
}

export const RACING_CONST = { WIDTH, HEIGHT, LANES, CAR_W, CAR_H, OBST_W, OBST_H };

export type RaceAction = "l" | "r";

export interface ReplayRacing {
  seed: number;
  ticks: number;
  inputs: { t: number; a: RaceAction }[];
}

/** ANTI-TRAMPA: re-simula el replay con dt fijo y devuelve el puntaje real. */
export function verifyRacing(r: ReplayRacing): number {
  const g = new RacingEngine(r.seed);
  const byTick = new Map<number, RaceAction[]>();
  for (const inp of r.inputs) {
    const arr = byTick.get(inp.t) ?? [];
    arr.push(inp.a);
    byTick.set(inp.t, arr);
  }
  for (let t = 0; t < r.ticks; t++) {
    const acts = byTick.get(t);
    if (acts) {
      for (const a of acts) {
        if (a === "l") g.moveLeft();
        else g.moveRight();
      }
    }
    g.update(RACING_DT);
    if (g.over) break;
  }
  return g.score;
}
