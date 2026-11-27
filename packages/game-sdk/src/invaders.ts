// Motor de SPACE INVADERS, COMPARTIDO web/servidor. Determinístico por ticks:
// la formacion baja y acelera, los aliens tiran bombas (rng con semilla), el
// jugador dispara. Misma semilla + mismas entradas = mismo resultado -> el
// servidor re-simula el replay y verifica el puntaje (anti-trampa).
// EN VIVO (reglas v2) no hay semilla: cada bloque de INVADERS_LIVE_BLOCK ticks
// sale de UN valor que revela el árbitro (ver `./invaders-live` y `./live`).

import { mulberry32, groupByTick, type RandomSource } from "./replay";

// ---- Reglas -----------------------------------------------------------------
// v1: con semilla. v2: se juega EN VIVO, sin semilla: cada bloque de
// INVADERS_LIVE_BLOCK ticks sale de un valor que el árbitro revela 15 ticks
// antes de que empiece (ver el constructor y ./invaders-live). La física no
// cambia: con una semilla (la práctica de la web y las vistas previas de las
// estrategias) el motor juega exactamente igual que en v1.
export const INVADERS_RULES_V = 2;

/** En vivo: cada cuántos ticks llega un valor nuevo del árbitro (un segundo a
 *  60 ticks por segundo). Los aliens tiran los dados en cada tick; un valor por
 *  tick obligaría a comprometer en cada tick. El bloque se revela
 *  LIVE_LEAD_TICKS antes de empezar: una bomba se conoce como mucho
 *  INVADERS_LIVE_BLOCK + LIVE_LEAD_TICKS - 1 ticks antes de caer. */
export const INVADERS_LIVE_BLOCK = 60;

export const WIDTH = 320;
export const HEIGHT = 440;
export const INVADERS_DT = 1 / 60;

export const COLS = 5;
export const ROWS = 4;
export const ALIEN_W = 24;
export const ALIEN_H = 18;
const CELL_X = 40; // separacion horizontal entre aliens
const ROW_H = 28;
const START_X = 30;
const START_Y = 46;
// Cuanto baja la formacion al rebotar en un borde (mas chico = mas gradual).
const STEP_DOWN = 9;

export const PLAYER_W = 28;
export const PLAYER_H = 12;
const PLAYER_Y = HEIGHT - 28;
const PLAYER_SPEED = 2.6;

const BULLET_H = 10;
const BULLET_SPEED = 5.2;
const BOMB_H = 10;
const BOMB_SPEED = 2.6;
const MAX_BULLETS = 5; // varias balas en pantalla
const FIRE_RATE = 8; // ticks entre disparos al mantener apretado (~7/seg)

const ROW_VALUE = [30, 20, 15, 10]; // puntos por fila (arriba vale mas)
const SB = 5; // tamaño de bloque de escudo (bunker)
const UFO_W = 22;
const UFO_H = 9;
const UFO_Y = 24;
const UFO_SPEED = 1.6;
const UFO_BONUS = 100;
const UFO_CHANCE = 0.0016; // probabilidad por tick de que aparezca el OVNI

export type InvaderAction = "l1" | "l0" | "r1" | "r0" | "f1" | "f0";

interface Shot {
  x: number;
  y: number;
}
export interface AlienView {
  x: number;
  y: number;
  row: number;
}

export class InvadersEngine {
  playerX = WIDTH / 2;
  bullets: Shot[] = [];
  bombs: Shot[] = [];
  score = 0;
  lives = 3;
  wave = 1;
  over = false;

  // Formacion
  alive: boolean[][];
  offsetX = START_X;
  offsetY = START_Y;
  dir = 1;

  // Escudos (bunkers) y OVNI bonus
  shields: { x: number; y: number }[] = [];
  ufo: { x: number; dir: number } | null = null;

  /** Ticks jugados. */
  tickCount = 0;

  private rng: () => number;
  /** En vivo: de dónde sale el valor de cada bloque. */
  private readonly blocks?: RandomSource;
  /** En vivo: el azar del bloque y los 4 sub-valores del tick (bomba,
   *  columna, OVNI, sentido). */
  private block: () => number = () => 0;
  private dice: [number, number, number, number] = [0, 0, 0, 0];
  private movingLeft = false;
  private movingRight = false;
  private firing = false;
  private fireCooldown = 0;

  /** Con una semilla, el azar de siempre (v1), valor por valor. Con una fuente
   *  (en vivo), cada bloque de INVADERS_LIVE_BLOCK ticks sale de UN valor: el
   *  bloque lo expande con su propio mulberry32 y cada tick saca 4 sub-valores,
   *  se usen o no. Así cuánto azar consume el juego no depende del azar ni de
   *  las jugadas, y ninguna jugada corre el azar de los ticks siguientes. */
  constructor(source: number | RandomSource) {
    if (typeof source === "number") {
      this.rng = mulberry32(source);
    } else {
      this.blocks = source;
      this.rng = () => {
        throw new Error("invaders: in live play each tick draws from its block");
      };
    }
    this.alive = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
    this.shields = this.buildShields();
  }

  private buildShields(): { x: number; y: number }[] {
    const blocks: { x: number; y: number }[] = [];
    const cols = 6;
    const rows = 4;
    const bw = cols * SB;
    const n = 3;
    const gap = (WIDTH - n * bw) / (n + 1);
    const by = PLAYER_Y - 58;
    for (let b = 0; b < n; b++) {
      const bx = gap + b * (bw + gap);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (r === rows - 1 && (c === 2 || c === 3)) continue; // arco
          blocks.push({ x: bx + c * SB, y: by + r * SB });
        }
    }
    return blocks;
  }

  private alienPos(row: number, col: number) {
    return { x: this.offsetX + col * CELL_X, y: this.offsetY + row * ROW_H };
  }

  private aliveCount(): number {
    let n = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (this.alive[r][c]) n++;
    return n;
  }

  /** Aliens vivos con su posicion (para dibujar). */
  aliveAliens(): AlienView[] {
    const out: AlienView[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (this.alive[r][c]) {
          const p = this.alienPos(r, c);
          out.push({ x: p.x, y: p.y, row: r });
        }
    return out;
  }

  /** Qué teclas tiene apretadas el motor (lo que dejaron las jugadas). */
  get held(): { left: boolean; right: boolean; fire: boolean } {
    return { left: this.movingLeft, right: this.movingRight, fire: this.firing };
  }

  /** Cuántos valores al azar consumirían los próximos `ticks` ticks (en vivo,
   *  uno por bloque): los bloques que empiezan en esos ticks. No toca el motor
   *  ni depende de las jugadas; con la partida terminada no se consume nada. Lo
   *  usan el árbitro para revelar y el cliente para saber cuándo comprometer. */
  drawsWithin(ticks: number): number {
    if (this.over || !(ticks > 0)) return 0;
    const first = Math.ceil(this.tickCount / INVADERS_LIVE_BLOCK) * INVADERS_LIVE_BLOCK;
    const end = this.tickCount + ticks;
    return first >= end ? 0 : Math.floor((end - 1 - first) / INVADERS_LIVE_BLOCK) + 1;
  }

  /** La tirada `i` del tick (0 bomba, 1 columna, 2 OVNI, 3 sentido). Con
   *  semilla, el `rng()` de siempre, en el mismo lugar; en vivo, el sub-valor ya
   *  sacado al empezar el tick. */
  private roll(i: 0 | 1 | 2 | 3): number {
    return this.blocks ? this.dice[i] : this.rng();
  }

  apply(a: InvaderAction) {
    if (this.over) return;
    if (a === "l1") this.movingLeft = true;
    else if (a === "l0") this.movingLeft = false;
    else if (a === "r1") this.movingRight = true;
    else if (a === "r0") this.movingRight = false;
    else if (a === "f1") this.firing = true;
    else if (a === "f0") this.firing = false;
  }

  private formationSpeed(): number {
    const total = ROWS * COLS;
    const destroyed = total - this.aliveCount();
    // Arranca lento, acelera de a poco al limpiar y solo un poco por oleada.
    return (0.22 + (destroyed / total) * 1.1) * (1 + (this.wave - 1) * 0.1);
  }

  private nextWave() {
    this.wave += 1;
    this.alive = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
    this.offsetX = START_X;
    this.offsetY = START_Y;
    this.dir = 1;
    this.bullets = [];
    this.bombs = [];
    this.shields = this.buildShields(); // escudos nuevos cada oleada
  }

  private dropBomb() {
    const cols: number[] = [];
    for (let c = 0; c < COLS; c++) if (this.alive.some((row) => row[c])) cols.push(c);
    if (!cols.length) return;
    const col = cols[Math.floor(this.roll(1) * cols.length)];
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--)
      if (this.alive[r][col]) {
        row = r;
        break;
      }
    if (row < 0) return;
    const p = this.alienPos(row, col);
    this.bombs.push({ x: p.x + ALIEN_W / 2, y: p.y + ALIEN_H });
  }

  tick() {
    if (this.over) return;
    if (this.blocks) {
      // En vivo: el valor del bloque al empezarlo, y los 4 sub-valores de este
      // tick ANTES de cualquier salida temprana (oleada despejada).
      if (this.tickCount % INVADERS_LIVE_BLOCK === 0) {
        this.block = mulberry32(Math.floor(this.blocks.next() * 4294967296));
      }
      this.dice = [this.block(), this.block(), this.block(), this.block()];
    }
    this.tickCount += 1;

    // Jugador
    if (this.movingLeft) this.playerX -= PLAYER_SPEED;
    if (this.movingRight) this.playerX += PLAYER_SPEED;
    const half = PLAYER_W / 2;
    if (this.playerX < half) this.playerX = half;
    if (this.playerX > WIDTH - half) this.playerX = WIDTH - half;

    // Disparo automatico mientras se mantiene apretado
    if (this.fireCooldown > 0) this.fireCooldown -= 1;
    if (this.firing && this.fireCooldown === 0 && this.bullets.length < MAX_BULLETS) {
      this.bullets.push({ x: this.playerX, y: PLAYER_Y - PLAYER_H });
      this.fireCooldown = FIRE_RATE;
    }

    // Disparos y bombas
    for (const b of this.bullets) b.y -= BULLET_SPEED;
    this.bullets = this.bullets.filter((b) => b.y > -BULLET_H);
    for (const b of this.bombs) b.y += BOMB_SPEED;
    this.bombs = this.bombs.filter((b) => b.y < HEIGHT);

    // Oleada despejada
    if (this.aliveCount() === 0) {
      this.nextWave();
      return;
    }

    // Mover formacion + rebote en los bordes
    this.offsetX += this.dir * this.formationSpeed();
    let minX = Infinity;
    let maxX = -Infinity;
    let maxBottom = -Infinity;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (this.alive[r][c]) {
          const p = this.alienPos(r, c);
          if (p.x < minX) minX = p.x;
          if (p.x + ALIEN_W > maxX) maxX = p.x + ALIEN_W;
          if (p.y + ALIEN_H > maxBottom) maxBottom = p.y + ALIEN_H;
        }
    if (this.dir > 0 && maxX >= WIDTH - 6) {
      this.dir = -1;
      this.offsetY += STEP_DOWN;
    } else if (this.dir < 0 && minX <= 6) {
      this.dir = 1;
      this.offsetY += STEP_DOWN;
    }

    // Invasion: los aliens llegaron al jugador
    if (maxBottom >= PLAYER_Y - 4) {
      this.over = true;
      this.lives = 0;
      return;
    }

    // Bombas de los aliens (rng con semilla)
    const chance = 0.01 + (this.wave - 1) * 0.0025;
    if (this.roll(0) < chance) this.dropBomb();

    // OVNI bonus: aparece de a ratos y cruza la pantalla.
    if (this.ufo) {
      this.ufo.x += this.ufo.dir * UFO_SPEED;
      if (this.ufo.x < -UFO_W || this.ufo.x > WIDTH) this.ufo = null;
    } else if (this.roll(2) < UFO_CHANCE) {
      const dir = this.roll(3) < 0.5 ? 1 : -1;
      this.ufo = { x: dir > 0 ? -UFO_W : WIDTH, dir };
    }

    // Colision: balas del jugador (OVNI -> escudo -> aliens)
    const usedBullets = new Set<number>();
    for (let bi = 0; bi < this.bullets.length; bi++) {
      const b = this.bullets[bi];
      if (
        this.ufo &&
        b.x >= this.ufo.x &&
        b.x <= this.ufo.x + UFO_W &&
        b.y <= UFO_Y + UFO_H &&
        b.y >= UFO_Y
      ) {
        this.score += UFO_BONUS;
        this.ufo = null;
        usedBullets.add(bi);
        continue;
      }
      const si = this.shields.findIndex(
        (s) => b.x >= s.x && b.x <= s.x + SB && b.y <= s.y + SB && b.y >= s.y,
      );
      if (si >= 0) {
        this.shields.splice(si, 1);
        usedBullets.add(bi);
        continue;
      }
      let hit = false;
      for (let r = 0; r < ROWS && !hit; r++)
        for (let c = 0; c < COLS && !hit; c++) {
          if (!this.alive[r][c]) continue;
          const p = this.alienPos(r, c);
          if (b.x >= p.x && b.x <= p.x + ALIEN_W && b.y <= p.y + ALIEN_H && b.y >= p.y) {
            this.alive[r][c] = false;
            this.score += ROW_VALUE[r];
            usedBullets.add(bi);
            hit = true;
          }
        }
    }
    if (usedBullets.size) this.bullets = this.bullets.filter((_, i) => !usedBullets.has(i));

    // Colision: bombas vs escudo y vs jugador
    const px = this.playerX - PLAYER_W / 2;
    const remaining: Shot[] = [];
    for (const bomb of this.bombs) {
      const si = this.shields.findIndex(
        (s) => bomb.x >= s.x && bomb.x <= s.x + SB && bomb.y + BOMB_H >= s.y && bomb.y <= s.y + SB,
      );
      if (si >= 0) {
        this.shields.splice(si, 1);
        continue; // la bomba se consume en el escudo
      }
      const hit = bomb.y + BOMB_H >= PLAYER_Y && bomb.x >= px && bomb.x <= px + PLAYER_W;
      if (hit) {
        this.lives -= 1;
        if (this.lives <= 0) {
          this.over = true;
          return;
        }
      } else {
        remaining.push(bomb);
      }
    }
    this.bombs = remaining;
  }
}

export const INVADERS_CONST = {
  WIDTH,
  HEIGHT,
  COLS,
  ROWS,
  ALIEN_W,
  ALIEN_H,
  PLAYER_W,
  PLAYER_H,
  PLAYER_Y,
  BULLET_H,
  BOMB_H,
  SB,
  UFO_W,
  UFO_H,
  UFO_Y,
};

export interface ReplayInvaders {
  seed: number;
  ticks: number;
  inputs: { t: number; a: InvaderAction }[];
  /** Versión de reglas con la que se jugó (v2+ la declaran; ausente = v1). */
  v?: number;
}

/** ANTI-TRAMPA: re-simula el replay y devuelve el puntaje real. */
export function verifyInvaders(r: ReplayInvaders): number {
  const g = new InvadersEngine(r.seed);
  const byTick = groupByTick(r.inputs);
  for (let t = 0; t < r.ticks; t++) {
    const acts = byTick.get(t);
    if (acts) for (const a of acts) g.apply(a);
    g.tick();
    if (g.over) break;
  }
  return g.score;
}
