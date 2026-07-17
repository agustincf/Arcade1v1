// Motor del Snake COMPARTIDO web/servidor. Determinístico por ticks: misma
// semilla + mismas direcciones en los mismos ticks = mismo resultado, así el
// servidor re-simula el replay y verifica el puntaje (anti-trampa).

import { mulberry32, groupByTick } from "./replay";

export const GRID = 17; // celdas por lado
export const SNAKE_DT = 1 / 60;

// ---- Reglas v2: la moneda que vence -----------------------------------------
// Vale más que la fruta pero desaparece sola: perseguirla es una DECISIÓN
// (desvío + más cuerpo = más riesgo). La vida se mide en PASOS de la víbora,
// así la ventana en celdas no cambia cuando el juego acelera.
export const SNAKE_RULES_V = 2;
export const COIN_VALUE = 3;
export const COIN_LIFE_STEPS = 28;
export const COIN_BLINK_STEPS = 8; // últimos pasos: la UI la hace parpadear
const COIN_CHANCE = 0.025; // probabilidad de aparición por paso sin moneda

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
  coin: Pt | null = null;
  coinSteps = 0; // pasos de vida que le quedan a la moneda
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
        if (this.body.some((s) => s.x === x && s.y === y)) continue;
        if (this.coin && this.coin.x === x && this.coin.y === y) continue;
        empties.push({ x, y });
      }
    if (empties.length === 0) {
      this.over = true;
      return;
    }
    this.food = empties[Math.floor(this.rng() * empties.length)];
  }

  private spawnCoin() {
    const empties: Pt[] = [];
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (this.body.some((s) => s.x === x && s.y === y)) continue;
        if (this.food.x === x && this.food.y === y) continue;
        empties.push({ x, y });
      }
    if (empties.length === 0) return;
    this.coin = empties[Math.floor(this.rng() * empties.length)];
    this.coinSteps = COIN_LIFE_STEPS;
  }

  apply(a: SnakeAction) {
    const d = DIRS[a];
    // No se puede ir en reversa directa.
    if (d.x === -this.dir.x && d.y === -this.dir.y) return;
    this.pendingDir = d;
  }

  /** Cuadros entre movimientos: arranca BIEN tranquilo y acelera de a poco. */
  moveEvery(): number {
    return Math.max(6, 12 - Math.floor(this.score / 6));
  }

  /** ¿La moneda está por vencer? (la UI la dibuja parpadeando). */
  coinBlinking(): boolean {
    return this.coin !== null && this.coinSteps <= COIN_BLINK_STEPS;
  }

  tick() {
    if (this.over) return;
    this.tickCount += 1;
    if (this.tickCount % this.moveEvery() === 0) this.step();
  }

  private step() {
    this.dir = this.pendingDir;
    // Las paredes NO penalizan: la vibora reaparece del lado opuesto (wrap).
    const head = {
      x: (this.body[0].x + this.dir.x + GRID) % GRID,
      y: (this.body[0].y + this.dir.y + GRID) % GRID,
    };
    for (const s of this.body) {
      if (s.x === head.x && s.y === head.y) {
        this.over = true;
        return;
      }
    }
    this.body.unshift(head);
    const ateFood = head.x === this.food.x && head.y === this.food.y;
    const ateCoin = this.coin !== null && head.x === this.coin.x && head.y === this.coin.y;
    if (ateFood) {
      this.score += 1;
      this.spawnFood();
    }
    if (ateCoin) {
      this.score += COIN_VALUE;
      this.coin = null;
    }
    // Fruta y moneda alargan por igual: comer nunca es gratis.
    if (!ateFood && !ateCoin) this.body.pop();

    // Vida y aparición de la moneda — SIEMPRE en este orden y con el mismo
    // consumo de rng, para que el árbitro re-simule idéntico.
    if (this.coin) {
      this.coinSteps -= 1;
      if (this.coinSteps <= 0) this.coin = null;
    } else if (this.rng() < COIN_CHANCE) {
      this.spawnCoin();
    }
  }
}

export interface ReplaySnake {
  seed: number;
  ticks: number;
  inputs: { t: number; a: SnakeAction }[];
  /** Versión de reglas con la que se jugó (v2+ la declaran; ausente = v1). */
  v?: number;
}

/** ANTI-TRAMPA: re-simula el replay y devuelve el puntaje real. */
export function verifySnake(r: ReplaySnake): number {
  const g = new SnakeEngine(r.seed);
  const byTick = groupByTick(r.inputs);
  for (let t = 0; t < r.ticks; t++) {
    const acts = byTick.get(t);
    if (acts) for (const a of acts) g.apply(a);
    g.tick();
    if (g.over) break;
  }
  return g.score;
}
