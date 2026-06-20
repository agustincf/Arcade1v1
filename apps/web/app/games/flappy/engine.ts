// Motor del Flappy 1v1: toda la fisica del juego, SIN pantalla.
// El pajaro cae por gravedad; al "aletear" sube. Pasar un tubo = +1 punto.
// Chocar un tubo, el techo o el piso = fin. Gana el de mayor puntaje.

export const WIDTH = 320;
export const HEIGHT = 480;

const BIRD_X = 70;
const BIRD_R = 12; // radio del pajaro

const GRAVITY = 1500; // px por segundo al cuadrado
const FLAP_VY = -430; // impulso hacia arriba al aletear

const PIPE_W = 56;
const GAP = 140; // hueco entre tubo de arriba y de abajo
const PIPE_SPACING = 200; // distancia horizontal entre tubos
const MARGIN = 60; // margen para que el hueco no quede pegado a los bordes

/** Numeros al azar con semilla: misma semilla = mismos tubos para los dos. */
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
  x: number; // posicion horizontal del tubo
  gapY: number; // centro del hueco
  passed: boolean; // si el pajaro ya lo paso (para no contar dos veces)
}

export class FlappyEngine {
  birdY = HEIGHT / 2;
  birdVy = 0;
  pipes: Pipe[] = [];
  score = 0;
  over = false;
  started = false; // hasta el primer aleteo, el pajaro flota

  private rng: () => number;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    // Primer tubo bien a la derecha.
    this.addPipe(WIDTH + 80);
  }

  private randomGapY(): number {
    return MARGIN + this.rng() * (HEIGHT - 2 * MARGIN);
  }

  private addPipe(x: number) {
    this.pipes.push({ x, gapY: this.randomGapY(), passed: false });
  }

  /** El jugador aletea. */
  flap() {
    if (this.over) return;
    this.started = true;
    this.birdVy = FLAP_VY;
  }

  /** Velocidad horizontal de los tubos (sube un poco con el puntaje). */
  private pipeSpeed(): number {
    return 130 + this.score * 4;
  }

  /** Avanza la fisica. dt en segundos. */
  update(dt: number) {
    if (this.over || !this.started) return;

    // Gravedad
    this.birdVy += GRAVITY * dt;
    this.birdY += this.birdVy * dt;

    // Mover tubos hacia la izquierda
    const speed = this.pipeSpeed();
    for (const p of this.pipes) p.x -= speed * dt;

    // Sacar tubos que salieron de pantalla y agregar nuevos
    if (this.pipes.length && this.pipes[0].x < -PIPE_W) this.pipes.shift();
    const last = this.pipes[this.pipes.length - 1];
    if (last && last.x < WIDTH - PIPE_SPACING) {
      this.addPipe(last.x + PIPE_SPACING);
    }

    // Puntaje: cuando el pajaro pasa el tubo
    for (const p of this.pipes) {
      if (!p.passed && p.x + PIPE_W < BIRD_X) {
        p.passed = true;
        this.score += 1;
      }
    }

    // Choque con techo o piso
    if (this.birdY - BIRD_R < 0 || this.birdY + BIRD_R > HEIGHT) {
      this.over = true;
      return;
    }

    // Choque con un tubo
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

export const FLAPPY_CONST = { WIDTH, HEIGHT, BIRD_X, BIRD_R, PIPE_W, GAP };
