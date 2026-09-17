// PARTIDAS EN VIVO: lo que comparten el árbitro, el SDK y la web para que nadie
// vea más adelante de lo que vería un humano mirando la pantalla. El árbitro
// guarda la semilla. El jugador compromete sus jugadas hasta un tick y recibe
// los valores al azar que el juego va a consumir en los próximos
// LIVE_LEAD_TICKS; con esos valores el motor corre igual que siempre.
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { mulberry32, type RandomSource } from "./replay";

export type { RandomSource };

/** Cuántos ticks antes de usarse se revela cada valor al azar (0,25 s a 60
 *  ticks por segundo): lo justo para que la red no trabe el juego. */
export const LIVE_LEAD_TICKS = 15;

/** Tope de ticks por compromiso (un minuto de juego): acota el trabajo de cada pedido. */
export const MAX_COMMIT_TICKS = 3_600;

/** Desde qué versión de reglas se juega en vivo cada juego. El interruptor de
 *  Flappy es `RULES_V.flappy = 2` (rules.ts). */
export const LIVE_SINCE_RULES_V: Record<string, number> = { flappy: 2 };

/** ¿Una partida de `game` nacida con las reglas `rulesV` se juega en vivo? */
export function isLiveMatch(game: string, rulesV: number | undefined): boolean {
  const since = LIVE_SINCE_RULES_V[game];
  return since !== undefined && (rulesV ?? 1) >= since;
}

/** Se pidió un valor al azar que todavía no se reveló. Jugando bien no pasa:
 *  antes de cada tick se chequea que `drawsWithin(1)` no supere `available`. */
export class NeedsReveal extends Error {
  readonly index: number;
  constructor(index: number) {
    super(`live: random value #${index} was not revealed yet`);
    this.index = index;
  }
}

/** Fuente de azar del JUGADOR: los valores que reveló el árbitro, en orden. */
export class BufferedRandom implements RandomSource {
  private readonly values: number[] = [];
  private used = 0;

  push(values: readonly number[]): void {
    for (const v of values) this.values.push(v);
  }

  /** Valores recibidos en total: es el `have` del próximo compromiso. */
  get received(): number {
    return this.values.length;
  }

  /** Valores recibidos que el motor todavía no usó. */
  get available(): number {
    return this.values.length - this.used;
  }

  next(): number {
    if (this.used >= this.values.length) throw new NeedsReveal(this.used);
    return this.values[this.used++];
  }
}

/** Fuente de azar del ÁRBITRO: la secuencia de la semilla. Puede adelantar
 *  valores para revelarlos sin consumirlos. */
export class SeededSource implements RandomSource {
  private readonly rng: () => number;
  private readonly values: number[] = [];
  private used = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  /** Cuántos valores consumió el motor. */
  get consumed(): number {
    return this.used;
  }

  next(): number {
    this.fill(this.used + 1);
    return this.values[this.used++];
  }

  /** Los valores `[from, to)` de la secuencia, generándolos si hace falta. */
  slice(from: number, to: number): number[] {
    this.fill(to);
    return this.values.slice(from, to);
  }

  private fill(n: number): void {
    while (this.values.length < n) this.values.push(this.rng());
  }
}
