// Motor del juego de carreras: un auto esquiva obstaculos en 3 carriles.
// Asincronico y por puntaje: +1 por cada obstaculo esquivado. Acelera con el
// tiempo. Chocar = fin. Misma semilla = mismos obstaculos para los dos.

export const WIDTH = 320;
export const HEIGHT = 480;
export const LANES = 3;

export const CAR_W = 42;
export const CAR_H = 66;
const CAR_Y = HEIGHT - 80; // posicion vertical fija del auto
const OBST_W = 44;
const OBST_H = 44;

/** Centro horizontal de cada carril. */
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
  kind: number; // variante visual (0..2)
  passed: boolean;
}

export class RacingEngine {
  carLane = 1; // empieza en el carril del medio
  obstacles: Obstacle[] = [];
  score = 0;
  over = false;
  elapsedMs = 0;
  roadOffset = 0; // para animar las lineas del asfalto

  private rng: () => number;
  private spawnTimer = 0;
  private lastLane = -1;

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

  /** Nivel de velocidad: sube con el tiempo. */
  private level(): number {
    return Math.floor(this.elapsedMs / 8000);
  }

  /** Velocidad de avance (px/s). */
  speed(): number {
    return Math.min(480, 190 + this.level() * 35 + this.score * 2);
  }

  private spawnInterval(): number {
    return Math.max(0.5, 1.15 - this.level() * 0.07); // segundos
  }

  private spawn() {
    // Elegir un carril distinto al ultimo (para que sea esquivable).
    let lane = Math.floor(this.rng() * LANES);
    if (lane === this.lastLane) lane = (lane + 1) % LANES;
    this.lastLane = lane;
    this.obstacles.push({
      lane,
      y: -OBST_H,
      kind: Math.floor(this.rng() * 3),
      passed: false,
    });
  }

  update(dt: number) {
    if (this.over) return;
    this.elapsedMs += dt * 1000;

    const v = this.speed();
    this.roadOffset = (this.roadOffset + v * dt) % 40;

    // Mover obstaculos
    for (const o of this.obstacles) o.y += v * dt;

    // Spawnear
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval()) {
      this.spawnTimer = 0;
      this.spawn();
    }

    // Puntaje + colision
    for (const o of this.obstacles) {
      // Colision: mismo carril y se superponen verticalmente con el auto
      if (
        o.lane === this.carLane &&
        Math.abs(o.y - CAR_Y) < OBST_H / 2 + CAR_H / 2 - 8
      ) {
        this.over = true;
        return;
      }
      // Esquivado: paso al auto
      if (!o.passed && o.y > CAR_Y + CAR_H / 2) {
        o.passed = true;
        this.score += 1;
      }
    }

    // Limpiar los que salieron
    this.obstacles = this.obstacles.filter((o) => o.y < HEIGHT + OBST_H);
  }
}

export const RACING_CONST = { WIDTH, HEIGHT, LANES, CAR_W, CAR_H, OBST_W, OBST_H };
