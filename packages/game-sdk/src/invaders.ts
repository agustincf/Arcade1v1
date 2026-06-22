// Motor de SPACE INVADERS, COMPARTIDO web/servidor. Determinístico por ticks:
// la formacion baja y acelera, los aliens tiran bombas (rng con semilla), el
// jugador dispara. Misma semilla + mismas entradas = mismo resultado -> el
// servidor re-simula el replay y verifica el puntaje (anti-trampa).

export const WIDTH = 320;
export const HEIGHT = 440;
export const INVADERS_DT = 1 / 60;

export const COLS = 6;
export const ROWS = 4;
export const ALIEN_W = 18;
export const ALIEN_H = 14;
const CELL_X = 30; // separacion horizontal entre aliens
const ROW_H = 26;
const START_X = 26;
const START_Y = 46;
const STEP_DOWN = 14;

export const PLAYER_W = 28;
export const PLAYER_H = 12;
const PLAYER_Y = HEIGHT - 28;
const PLAYER_SPEED = 2.6;

const BULLET_H = 10;
const BULLET_SPEED = 5.2;
const BOMB_H = 10;
const BOMB_SPEED = 2.6;
const MAX_BULLETS = 3;

const ROW_VALUE = [30, 20, 15, 10]; // puntos por fila (arriba vale mas)
const SB = 5; // tamaño de bloque de escudo (bunker)
const UFO_W = 22;
const UFO_H = 9;
const UFO_Y = 24;
const UFO_SPEED = 1.6;
const UFO_BONUS = 100;
const UFO_CHANCE = 0.0016; // probabilidad por tick de que aparezca el OVNI

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

export type InvaderAction = "l1" | "l0" | "r1" | "r0" | "f";

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

  private rng: () => number;
  private movingLeft = false;
  private movingRight = false;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
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

  apply(a: InvaderAction) {
    if (this.over) return;
    if (a === "l1") this.movingLeft = true;
    else if (a === "l0") this.movingLeft = false;
    else if (a === "r1") this.movingRight = true;
    else if (a === "r0") this.movingRight = false;
    else if (a === "f") {
      if (this.bullets.length < MAX_BULLETS)
        this.bullets.push({ x: this.playerX, y: PLAYER_Y - PLAYER_H });
    }
  }

  private formationSpeed(): number {
    const total = ROWS * COLS;
    const destroyed = total - this.aliveCount();
    return (0.3 + (destroyed / total) * 1.9) * (1 + (this.wave - 1) * 0.25);
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
    for (let c = 0; c < COLS; c++)
      if (this.alive.some((row) => row[c])) cols.push(c);
    if (!cols.length) return;
    const col = cols[Math.floor(this.rng() * cols.length)];
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) if (this.alive[r][col]) { row = r; break; }
    if (row < 0) return;
    const p = this.alienPos(row, col);
    this.bombs.push({ x: p.x + ALIEN_W / 2, y: p.y + ALIEN_H });
  }

  tick() {
    if (this.over) return;

    // Jugador
    if (this.movingLeft) this.playerX -= PLAYER_SPEED;
    if (this.movingRight) this.playerX += PLAYER_SPEED;
    const half = PLAYER_W / 2;
    if (this.playerX < half) this.playerX = half;
    if (this.playerX > WIDTH - half) this.playerX = WIDTH - half;

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
    const chance = 0.012 + (this.wave - 1) * 0.004;
    if (this.rng() < chance) this.dropBomb();

    // OVNI bonus: aparece de a ratos y cruza la pantalla.
    if (this.ufo) {
      this.ufo.x += this.ufo.dir * UFO_SPEED;
      if (this.ufo.x < -UFO_W || this.ufo.x > WIDTH) this.ufo = null;
    } else if (this.rng() < UFO_CHANCE) {
      const dir = this.rng() < 0.5 ? 1 : -1;
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
          if (
            b.x >= p.x &&
            b.x <= p.x + ALIEN_W &&
            b.y <= p.y + ALIEN_H &&
            b.y >= p.y
          ) {
            this.alive[r][c] = false;
            this.score += ROW_VALUE[r];
            usedBullets.add(bi);
            hit = true;
          }
        }
    }
    if (usedBullets.size)
      this.bullets = this.bullets.filter((_, i) => !usedBullets.has(i));

    // Colision: bombas vs escudo y vs jugador
    const px = this.playerX - PLAYER_W / 2;
    const remaining: Shot[] = [];
    for (const bomb of this.bombs) {
      const si = this.shields.findIndex(
        (s) =>
          bomb.x >= s.x &&
          bomb.x <= s.x + SB &&
          bomb.y + BOMB_H >= s.y &&
          bomb.y <= s.y + SB,
      );
      if (si >= 0) {
        this.shields.splice(si, 1);
        continue; // la bomba se consume en el escudo
      }
      const hit =
        bomb.y + BOMB_H >= PLAYER_Y && bomb.x >= px && bomb.x <= px + PLAYER_W;
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
}

/** ANTI-TRAMPA: re-simula el replay y devuelve el puntaje real. */
export function verifyInvaders(r: ReplayInvaders): number {
  const g = new InvadersEngine(r.seed);
  const byTick = new Map<number, InvaderAction[]>();
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
