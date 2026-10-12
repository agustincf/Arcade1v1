// Motor de la Carrera COMPARTIDO entre web y servidor. Determinístico con dt
// fijo: misma semilla + mismos cambios de carril en los mismos ticks = mismo
// resultado, así el servidor re-simula el replay y verifica el puntaje.
// EN VIVO (reglas v3) no hay semilla: cada fila de obstáculos sale de UN valor
// que revela el árbitro (ver `./racing-live` y `./live`).

import { mulberry32, groupByTick, type RandomSource } from "./replay";

export const WIDTH = 320;
export const HEIGHT = 480;
export const LANES = 3;
export const RACING_DT = 1 / 60; // paso fijo de fisica (segundos por tick)

export const CAR_W = 42;
export const CAR_H = 66;
const CAR_Y = HEIGHT - 80;
const OBST_W = 44;
const OBST_H = 44;

// ---- Reglas v2: salto, vallas saltables y monedas ---------------------------
// Saltar COMPROMETE: en el aire no se cambia de carril, y al aterrizar hay un
// cooldown. Las vallas (jumpable) se esquivan O se saltan; los sólidos, solo
// esquivar. Las monedas suman puntaje pero NO velocidad (passedCount manda).
// ---- Reglas v3: se juega EN VIVO --------------------------------------------
// Sin semilla: cada fila sale de un valor que el árbitro revela 0,25 s antes de
// que nazca (ver el constructor y ./racing-live). La física no cambia.
export const RACING_RULES_V = 3;
export const JUMP_TICKS = 30; // ~0,5 s en el aire a 60 ticks/s
export const JUMP_COOLDOWN = 10; // ticks tras aterrizar antes de re-saltar
const COIN_ROW_CHANCE = 0.35; // prob. de fila de monedas por spawn simple
const COIN_GAP_Y = 52; // separación vertical entre monedas de una fila

export function laneX(lane: number): number {
  return WIDTH * ((lane * 2 + 1) / (LANES * 2));
}

// El RELOJ DE FILAS: el nivel sale del tiempo de carrera, y cada cuánto nace una
// fila, del nivel. Lo usan el juego (`update`) y la predicción (`drawsWithin`)
// con exactamente las mismas operaciones: si no, por redondeo podrían diferir
// en un tick sobre cuándo nace una fila.
const levelAt = (elapsedMs: number) => Math.floor(elapsedMs / 8000);
const spawnDue = (elapsedMs: number, spawnTimer: number) =>
  spawnTimer >= Math.max(0.5, 1.15 - levelAt(elapsedMs) * 0.07);

export interface Obstacle {
  lane: number;
  y: number;
  kind: number;
  jumpable: boolean; // valla/bache bajo: se salta o se esquiva
  passed: boolean;
}

export class RacingEngine {
  carLane = 1;
  obstacles: Obstacle[] = [];
  score = 0;
  over = false;
  elapsedMs = 0;
  roadOffset = 0;
  coins: { lane: number; y: number; taken: boolean }[] = [];
  passedCount = 0; // obstáculos superados: SOLO esto acelera el juego

  private rng: () => number;
  /** En vivo: de dónde sale el valor de cada fila. */
  private readonly rows?: RandomSource;
  private spawnTimer = 0;
  private lastLane = -1;
  private lastFree = -1;
  private jumpTicks = 0;
  private jumpCooldown = 0;
  private lastWallJump = false;

  /** Con una semilla, el azar de siempre (v2), valor por valor. Con una fuente
   *  (en vivo), cada fila sale de UN valor: la fila lo expande con su propio
   *  mulberry32 para sortear carriles, vallas y monedas con las mismas
   *  probabilidades. Así cuánto azar consume el juego no depende del azar. */
  constructor(source: number | RandomSource) {
    if (typeof source === "number") {
      this.rng = mulberry32(source);
    } else {
      this.rows = source;
      this.rng = () => {
        throw new Error("racing: in live play each row draws from its own value");
      };
    }
  }

  get carY() {
    return CAR_Y;
  }

  moveLeft() {
    if (this.over || this.airborne) return;
    if (this.carLane > 0) this.carLane -= 1;
  }

  moveRight() {
    if (this.over || this.airborne) return;
    if (this.carLane < LANES - 1) this.carLane += 1;
  }

  jump() {
    if (this.over || this.jumpTicks > 0 || this.jumpCooldown > 0) return;
    this.jumpTicks = JUMP_TICKS;
  }

  get airborne(): boolean {
    return this.jumpTicks > 0;
  }

  /** 0..1: qué tan avanzado va el salto (0 al despegar, 1 al aterrizar). */
  jumpProgress(): number {
    return this.airborne ? 1 - this.jumpTicks / JUMP_TICKS : 0;
  }

  private level(): number {
    return levelAt(this.elapsedMs);
  }

  speed(): number {
    return Math.min(480, 190 + this.level() * 35 + this.passedCount * 2);
  }

  /** Cuántos valores al azar consumirían los próximos `ticks` pasos de
   *  RACING_DT (en vivo, uno por fila): las filas que nacen en ese lapso.
   *  Simula solo el reloj de filas, sin tocar el motor y sin mirar el auto: un
   *  choque no cambia el reloj, así que mientras el auto viva es exacto, y no
   *  depende de las jugadas. Con la partida terminada no se consume nada. Lo
   *  usan el árbitro para revelar y el cliente para saber cuándo comprometer. */
  drawsWithin(ticks: number): number {
    if (this.over) return 0;
    let elapsedMs = this.elapsedMs;
    let spawnTimer = this.spawnTimer;
    let rows = 0;
    for (let i = 0; i < ticks; i++) {
      elapsedMs += RACING_DT * 1000;
      spawnTimer += RACING_DT;
      if (spawnDue(elapsedMs, spawnTimer)) {
        rows += 1;
        spawnTimer = 0;
      }
    }
    return rows;
  }

  private addObstacle(lane: number, jumpable: boolean) {
    this.obstacles.push({
      lane,
      y: -OBST_H,
      kind: Math.floor(this.rng() * 3),
      jumpable,
      passed: false,
    });
  }

  private spawn() {
    // En vivo, la fila entera sale de UN valor de la fuente (ver constructor).
    if (this.rows) this.rng = mulberry32(Math.floor(this.rows.next() * 4294967296));
    const lvl = this.level();
    // Proporción de vallas: sube con el nivel (25% -> 45%).
    const jumpChance = Math.min(0.45, 0.25 + lvl * 0.05);
    const doubleChance = Math.min(0.5, 0.14 + lvl * 0.06);
    if (this.rng() < doubleChance) {
      let free = Math.floor(this.rng() * LANES);
      if (free === this.lastFree) free = (free + 1) % LANES;
      this.lastFree = free;
      this.lastLane = -1;
      // Pared con escape SALTABLE: la única salida es saltar en el carril
      // correcto. Solo desde el nivel 2 y NUNCA dos paredes-salto seguidas:
      // el cooldown del salto no llega a recargarse entre filas consecutivas.
      const wallJump =
        lvl >= 2 && !this.lastWallJump && this.rng() < Math.min(0.4, (lvl - 1) * 0.08);
      for (let lane = 0; lane < LANES; lane++) {
        if (lane !== free) this.addObstacle(lane, this.rng() < jumpChance);
        else if (wallJump) this.addObstacle(lane, true);
      }
      this.lastWallJump = wallJump;
    } else {
      let lane = Math.floor(this.rng() * LANES);
      if (lane === this.lastLane) lane = (lane + 1) % LANES;
      this.lastLane = lane;
      this.lastFree = -1;
      this.addObstacle(lane, this.rng() < jumpChance);
      this.lastWallJump = false;
      // A veces, una fila de 3-5 monedas en OTRO carril: la jugada de riesgo
      // emerge sola cuando filas siguientes le cruzan una valla.
      if (this.rng() < COIN_ROW_CHANCE) {
        let coinLane = Math.floor(this.rng() * LANES);
        if (coinLane === lane) coinLane = (coinLane + 1) % LANES;
        const n = 3 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) {
          this.coins.push({ lane: coinLane, y: -OBST_H - i * COIN_GAP_Y, taken: false });
        }
      }
    }
  }

  update(dt: number) {
    if (this.over) return;
    this.elapsedMs += dt * 1000;

    const v = this.speed();
    this.roadOffset = (this.roadOffset + v * dt) % 40;

    for (const o of this.obstacles) o.y += v * dt;
    for (const c of this.coins) c.y += v * dt;

    this.spawnTimer += dt;
    if (spawnDue(this.elapsedMs, this.spawnTimer)) {
      this.spawnTimer = 0;
      this.spawn();
    }

    // Monedas: se recogen al pasar por la banda del auto (también en el aire:
    // habilita la jugada "junto todo y salto la valla del final").
    for (const c of this.coins) {
      if (!c.taken && c.lane === this.carLane && Math.abs(c.y - CAR_Y) < CAR_H / 2) {
        c.taken = true;
        this.score += 1;
      }
    }
    this.coins = this.coins.filter((c) => !c.taken && c.y < HEIGHT + OBST_H);

    for (const o of this.obstacles) {
      const overlaps =
        o.lane === this.carLane && Math.abs(o.y - CAR_Y) < OBST_H / 2 + CAR_H / 2 - 8;
      // Una valla NO choca si el auto está en el aire; un sólido choca siempre.
      if (overlaps && !(o.jumpable && this.airborne)) {
        this.over = true;
        return;
      }
      if (!o.passed && o.y > CAR_Y + CAR_H / 2) {
        o.passed = true;
        this.score += 1;
        this.passedCount += 1;
      }
    }

    this.obstacles = this.obstacles.filter((o) => o.y < HEIGHT + OBST_H);

    // Arco del salto y cooldown de aterrizaje (por tick, determinista).
    // Sucede DESPUÉS de la colisión para que airborne sea true durante el frame.
    if (this.jumpTicks > 0) {
      this.jumpTicks -= 1;
      if (this.jumpTicks === 0) this.jumpCooldown = JUMP_COOLDOWN;
    } else if (this.jumpCooldown > 0) {
      this.jumpCooldown -= 1;
    }
  }
}

export const RACING_CONST = { WIDTH, HEIGHT, LANES, CAR_W, CAR_H, OBST_W, OBST_H };

export type RaceAction = "l" | "r" | "j";

export interface ReplayRacing {
  seed: number;
  ticks: number;
  inputs: { t: number; a: RaceAction }[];
  /** Versión de reglas con la que se jugó (v2+ la declaran; ausente = v1). */
  v?: number;
}

/** ANTI-TRAMPA: re-simula el replay con dt fijo y devuelve el puntaje real. */
export function verifyRacing(r: ReplayRacing): number {
  const g = new RacingEngine(r.seed);
  const byTick = groupByTick(r.inputs);
  for (let t = 0; t < r.ticks; t++) {
    const acts = byTick.get(t);
    if (acts) {
      for (const a of acts) {
        if (a === "l") g.moveLeft();
        else if (a === "r") g.moveRight();
        else g.jump();
      }
    }
    g.update(RACING_DT);
    if (g.over) break;
  }
  return g.score;
}
