// PARTIDAS EN VIVO: lo que comparten el árbitro, el SDK y la web para que nadie
// vea más adelante de lo que vería un humano mirando la pantalla. El árbitro
// guarda un secreto de 32 bytes y publica su hash. El jugador compromete sus
// jugadas hasta un tick y recibe los valores al azar que el juego va a consumir
// en los próximos LIVE_LEAD_TICKS; con esos valores el motor corre igual que
// siempre. Al decidirse la partida se publica el secreto y cualquiera
// re-verifica (verifyFlappyLive, verifyRacingLive).
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { sha256, sha256Hex, hexToBytes } from "./sha256";
import type { RandomSource } from "./replay";

export type { RandomSource };

/** Cuántos ticks antes de usarse se revela cada valor al azar (0,25 s a 60
 *  ticks por segundo): lo justo para que la red no trabe el juego. */
export const LIVE_LEAD_TICKS = 15;

/** Tope de ticks por compromiso (un minuto de juego): acota el trabajo de cada pedido. */
export const MAX_COMMIT_TICKS = 3_600;

/** Desde qué versión de reglas se juega en vivo cada juego. El interruptor de
 *  cada uno es su `RULES_V` (rules.ts): Flappy está en vivo desde la v2;
 *  Carrera, desde la v3 (mientras `RULES_V.racing` siga en 2, con semilla). */
export const LIVE_SINCE_RULES_V: Record<string, number> = { flappy: 2, racing: 3 };

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

const LIVE_SECRET_RE = /^[0-9a-f]{64}$/;

function secretBytes(secret: string): Uint8Array {
  if (typeof secret !== "string" || !LIVE_SECRET_RE.test(secret)) {
    throw new Error("invalid live secret: expected 32 bytes as 64 lowercase hex characters");
  }
  return hexToBytes(secret);
}

/** El hash (SHA-256, en hex) que el árbitro publica al emparejar. Al decidirse
 *  la partida se publica el secreto, y cualquiera comprueba que es el mismo que
 *  se usó desde el principio. */
export function liveSecretHash(secret: string): string {
  return sha256Hex(secretBytes(secret));
}

/** Fuente de azar del ÁRBITRO (y de quien re-verifica con el secreto ya
 *  publicado). El valor número `i` son los primeros 4 bytes, big-endian, de
 *  SHA-256(secreto ‖ i como uint32 big-endian), divididos por 2^32. Con 256 bits
 *  de secreto, los valores ya revelados no dicen nada de los que siguen. Con
 *  mulberry32 no alcanzaba: su estado es de 32 bits, y con el primer valor
 *  revelado la semilla se recuperaba por fuerza bruta en unos 3 segundos.
 *  Puede adelantar valores para revelarlos sin consumirlos. */
export class SecretSource implements RandomSource {
  private readonly key: Uint8Array;
  private readonly values: number[] = [];
  private used = 0;

  constructor(secret: string) {
    this.key = secretBytes(secret);
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
    const msg = new Uint8Array(36);
    msg.set(this.key);
    const index = new DataView(msg.buffer);
    while (this.values.length < n) {
      index.setUint32(32, this.values.length);
      const h = sha256(msg);
      this.values.push(new DataView(h.buffer, h.byteOffset, 4).getUint32(0) / 4294967296);
    }
  }
}

/** Lo que comprueba el jugador cuando la partida se decide: que el secreto
 *  publicado es el que el árbitro comprometió al emparejar (`secretHash`) y
 *  que todo lo que le reveló salió de ese secreto, en orden. Sin esto, el hash
 *  no prueba nada: el árbitro podría haber mandado otros valores. Un secreto
 *  mal formado da `false`, no tira. */
export function checkLiveReveals(
  secret: string,
  secretHash: string,
  reveals: readonly number[],
): boolean {
  try {
    if (liveSecretHash(secret) !== secretHash) return false;
    const expected = new SecretSource(secret).slice(0, reveals.length);
    return reveals.every((v, i) => v === expected[i]);
  } catch {
    return false;
  }
}

// ---- Cualquier juego en vivo ----------------------------------------------------
// El driver, la sesión de la web, el árbitro y la re-verificación no saben de
// aleteos ni de carriles: trabajan con la DEFINICIÓN de cada juego en vivo
// (flappy-live.ts, racing-live.ts) y con sus jugadas como `{ t, a }`.

/** Una jugada: la acción `a` en el tick `t` (absoluto). En Flappy, `a` es "f". */
export interface LiveInput {
  t: number;
  a: string;
}

/** Lo que devuelve una decisión por tick: `true`/`false` en un juego de una
 *  sola acción (Flappy: aletear o no), una acción, varias, o nada. */
export type LiveDecision = boolean | string | readonly string[] | null | undefined;

/** Un juego que se juega EN VIVO: cómo se arma su motor con la fuente de azar,
 *  cómo avanza un tick y cuánto azar va a consumir. */
export interface LiveGame<E> {
  id: string;
  create(src: RandomSource): E;
  /** Aplica las acciones de este tick, en orden, y avanza un tick. */
  step(engine: E, actions: readonly string[]): void;
  over(engine: E): boolean;
  score(engine: E): number;
  /** Cuántos valores al azar consumirían los próximos `ticks` ticks, sin
   *  tocar el motor. Exacto mientras se juega: no depende de las jugadas. */
  drawsWithin(engine: E, ticks: number): number;
  /** Ticks que no cuentan (Flappy: sin aletear, antes del primer aleteo). */
  idle?(engine: E, actions: readonly string[]): boolean;
  /** Cómo viajan las jugadas: Flappy manda `flaps` (los ticks de sus
   *  aleteos); los demás, `inputs`. */
  wire: "flaps" | "inputs";
  actions: readonly string[];
  maxActionsPerTick: number;
  /** Cuántas jugadas puede tener un intento con `ticks` ticks jugados. */
  inputBudget(ticks: number): number;
}

/** Las jugadas como viajan en `game`. */
export function encodeLiveInputs(
  game: LiveGame<unknown>,
  inputs: readonly LiveInput[],
): { flaps: number[] } | { inputs: LiveInput[] } {
  return game.wire === "flaps"
    ? { flaps: inputs.map((i) => i.t) }
    : { inputs: inputs.map((i) => ({ t: i.t, a: i.a })) };
}

/** Las jugadas que llegaron por el cable, como `{ t, a }`. No valida: el
 *  árbitro valida aparte, con sus mensajes. Sin la lista del juego, ninguna. */
export function decodeLiveInputs(
  game: LiveGame<unknown>,
  wire: { flaps?: unknown; inputs?: unknown },
): LiveInput[] {
  if (game.wire === "flaps") {
    return Array.isArray(wire.flaps)
      ? wire.flaps.map((t) => ({ t: Number(t), a: game.actions[0] }))
      : [];
  }
  return Array.isArray(wire.inputs)
    ? wire.inputs.map((i: { t?: unknown; a?: unknown } | null) => ({
        t: Number(i?.t),
        a: String(i?.a),
      }))
    : [];
}

/** Las jugadas agrupadas por tick, en orden. */
export function liveInputsByTick(inputs: readonly LiveInput[]): Map<number, string[]> {
  const byTick = new Map<number, string[]>();
  for (const i of inputs) {
    const acts = byTick.get(i.t);
    if (acts) acts.push(i.a);
    else byTick.set(i.t, [i.a]);
  }
  return byTick;
}

/** Las acciones de una decisión. `true` vale solo en un juego de una acción
 *  (Flappy); una acción que el juego no tiene es un error de quien decide. */
export function liveActions(game: LiveGame<unknown>, decision: LiveDecision): string[] {
  if (decision === null || decision === undefined || decision === false) return [];
  if (decision === true) {
    if (game.actions.length !== 1) {
      throw new Error(
        `live ${game.id}: decide must return actions (${game.actions.join(", ")}), not true`,
      );
    }
    return [game.actions[0]];
  }
  const list = typeof decision === "string" ? [decision] : [...decision];
  for (const a of list) {
    if (!game.actions.includes(a)) {
      throw new Error(`live ${game.id}: unknown action "${a}" (use ${game.actions.join(", ")})`);
    }
  }
  return list;
}

/** Recorta las acciones de un tick a los topes del juego: a lo sumo
 *  `maxActionsPerTick`, y sin que el intento pase `inputBudget(tick + 1)` con
 *  `played` jugadas hechas. Lo hacen el driver y la sesión ANTES de jugar el
 *  tick, así un cliente honesto nunca manda algo que el árbitro rechace. */
export function capLiveActions(
  game: LiveGame<unknown>,
  actions: readonly string[],
  played: number,
  tick: number,
): string[] {
  const room = Math.max(0, game.inputBudget(tick + 1) - played);
  return actions.slice(0, Math.min(game.maxActionsPerTick, room));
}
