// Motor del Flappy COMPARTIDO entre web y servidor. Determinístico con dt fijo:
// dadas la misma semilla + los mismos aleteos en los mismos ticks, el resultado
// es idéntico, así el servidor re-simula el replay y verifica el puntaje.
//
// El azar sale de una semilla o de una FUENTE inyectada: en una partida en vivo
// el árbitro guarda la semilla y revela los valores de a poco (ver ./live).

import { mulberry32, type RandomSource } from "./replay";

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

export interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

/** Velocidad de los tubos (px/s) para un puntaje. */
function pipeSpeedFor(score: number): number {
  return 120 + score * 3;
}

/** Un paso del horario de tubos: moverlos, sacar el que salió de pantalla,
 *  agregar uno nuevo cuando hace falta y marcar los que el pájaro pasó.
 *  Devuelve cuántos puntos sumó. No mira al pájaro: por eso el horario de tubos
 *  no depende de los aleteos, y el árbitro sabe cuándo va a nacer cada tubo sin
 *  conocer las jugadas futuras. `spawn` agrega el tubo nuevo en `x` (el motor
 *  lo hace consumiendo azar; `drawsWithin` solo lo cuenta). */
function stepPipes(
  pipes: { x: number; passed: boolean }[],
  score: number,
  dt: number,
  spawn: (x: number) => void,
): number {
  const speed = pipeSpeedFor(score);
  for (const p of pipes) p.x -= speed * dt;

  if (pipes.length && pipes[0].x < -PIPE_W) pipes.shift();
  const last = pipes[pipes.length - 1];
  if (last && last.x < WIDTH - PIPE_SPACING) spawn(last.x + PIPE_SPACING);

  let gained = 0;
  for (const p of pipes) {
    if (!p.passed && p.x + PIPE_W < BIRD_X) {
      p.passed = true;
      gained += 1;
    }
  }
  return gained;
}

export class FlappyEngine {
  birdY = HEIGHT / 2;
  birdVy = 0;
  pipes: Pipe[] = [];
  score = 0;
  over = false;
  started = false;

  private rng: () => number;

  constructor(source: number | RandomSource) {
    if (typeof source === "number") {
      this.rng = mulberry32(source);
    } else {
      this.rng = () => source.next();
    }
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
    return pipeSpeedFor(this.score);
  }

  /** Cuántos valores al azar consumirían los próximos `ticks` pasos de
   *  FLAPPY_DT sin aleteos. Simula solo el horario de tubos sobre una copia: el
   *  motor no cambia. Sin el primer aleteo los tubos no se mueven (da 0), y con
   *  la partida terminada no se consume nada. Mientras el pájaro viva es exacto,
   *  porque el horario de tubos no depende de los aleteos. Lo usan el árbitro
   *  para revelar y el cliente para saber cuándo comprometer. */
  drawsWithin(ticks: number): number {
    if (this.over || !this.started) return 0;
    const pipes = this.pipes.map((p) => ({ x: p.x, passed: p.passed }));
    let score = this.score;
    let draws = 0;
    for (let i = 0; i < ticks; i++) {
      score += stepPipes(pipes, score, FLAPPY_DT, (x) => {
        pipes.push({ x, passed: false });
        draws += 1;
      });
    }
    return draws;
  }

  update(dt: number) {
    if (this.over || !this.started) return;

    this.birdVy += GRAVITY * dt;
    this.birdY += this.birdVy * dt;

    this.score += stepPipes(this.pipes, this.score, dt, (x) => this.addPipe(x));

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
