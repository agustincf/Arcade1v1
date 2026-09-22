// Driver de una partida de Flappy EN VIVO para quien juega sin bucle de tiempo
// real: el SDK y los agentes de la casa. La web tiene su propio bucle
// (requestAnimationFrame) y usa las mismas piezas: BufferedRandom y drawsWithin.
// Protocolo: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { FlappyEngine, FLAPPY_DT } from "./flappy";
import { BufferedRandom, LIVE_LEAD_TICKS, MAX_COMMIT_TICKS, SecretSource } from "./live";

/** Lo que devolvió abrir el intento (sin el token, que es del transporte). */
export interface FlappyLiveStart {
  tick: number;
  flaps: number[];
  reveal: number[];
}

/** Un compromiso: los aleteos en `[from, to)` y cuántos valores tengo (`have`). */
export interface FlappyLiveCommit {
  from: number;
  to: number;
  flaps: number[];
  have: number;
  final?: boolean;
}

/** Respuesta a un compromiso. `conflict`: el árbitro está en otro tick (perdió
 *  compromisos, o se perdió una respuesta ya aplicada); hay que seguir desde
 *  `tick`. En los dos casos `reveal` trae los valores desde `have`. */
export type FlappyLiveReply =
  | {
      conflict?: undefined;
      tick: number;
      over: boolean;
      score?: number;
      reveal: number[];
      revealed: number;
    }
  | { conflict: true; tick: number; reveal: number[]; revealed: number };

export interface PlayFlappyLiveOptions {
  start: FlappyLiveStart;
  /** ¿Aletear en este tick? Recibe el motor ANTES de aplicar el tick. */
  decide: (engine: FlappyEngine, tick: number) => boolean;
  commit: (c: FlappyLiveCommit) => Promise<FlappyLiveReply>;
  /** Si el pájaro llega vivo a este tick, se cierra con `final`. */
  maxTicks: number;
  /** Esperas entre reintentos de un compromiso ante un error pasajero (ver
   *  `isRetriableLiveError`); cuando se acaban, el error sale. */
  retryDelaysMs?: number[];
}

/** Cuántas veces seguidas se acepta un conflicto antes de rendirse. */
const MAX_CONFLICTS = 5;

/** Reintentos por defecto de un compromiso: ~15 s en total, suficiente para
 *  pasar un 429 del limitador o un reinicio del árbitro. */
const DEFAULT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

/** ¿Vale la pena reintentar este error al comprometer? Sí si no hubo respuesta
 *  (red caída, timeout) o si fue 408, 429 o 5xx: son pasajeros. El resto de
 *  los 4xx es un rechazo del árbitro (token viejo, partida vencida, reglas
 *  distintas) y reintentarlo solo gira en falso. El cliente del SDK pone el
 *  código HTTP en `status`. */
export function isRetriableLiveError(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true;
  return status === 408 || status === 429 || status >= 500;
}

/** Juega una partida en vivo de punta a punta. Devuelve lo que confirmó el árbitro. */
export async function playFlappyLive(
  opts: PlayFlappyLiveOptions,
): Promise<{ score: number; ticks: number }> {
  const buffer = new BufferedRandom();
  buffer.push(opts.start.reveal);
  const engine = new FlappyEngine(buffer);
  const flaps = [...opts.start.flaps];

  // Retomar: rehacer lo ya comprometido con los valores que ya llegaron.
  const done = new Set(flaps);
  let tick = 0;
  for (; tick < opts.start.tick && !engine.over; tick++) {
    if (done.has(tick)) engine.flap();
    engine.update(FLAPPY_DT);
  }
  let committed = opts.start.tick;
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  // Un compromiso con reintentos: lo pasajero se reintenta con espera
  // creciente; un rechazo del árbitro sale enseguida.
  const commitWithRetry = async (c: FlappyLiveCommit): Promise<FlappyLiveReply> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await opts.commit(c);
      } catch (e) {
        const delay = retryDelays[attempt];
        if (delay === undefined || !isRetriableLiveError(e)) throw e;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  };

  // El árbitro no acepta más de MAX_COMMIT_TICKS por compromiso: lo largo (una
  // partida que nunca arrancó y cierra en maxTicks) va en tramos.
  const send = async (to: number, final: boolean) => {
    for (;;) {
      const end = Math.min(to, committed + MAX_COMMIT_TICKS);
      const reply = await sendOnce(end, final && end === to);
      if (end === to || reply.over) return reply;
    }
  };

  const sendOnce = async (to: number, final: boolean) => {
    for (let i = 0; i < MAX_CONFLICTS; i++) {
      const reply = await commitWithRetry({
        from: committed,
        to,
        flaps: flaps.filter((f) => f >= committed && f < to),
        have: buffer.received,
        ...(final ? { final: true } : {}),
      });
      buffer.push(reply.reveal);
      if (!reply.conflict) {
        committed = reply.tick;
        return reply;
      }
      if (reply.tick > to) {
        throw new Error(`live desync: arbiter at tick ${reply.tick}, player at ${to}`);
      }
      committed = reply.tick;
      // El árbitro ya tenía todo hasta `to` (se perdió la respuesta): listo.
      if (committed === to && !final) {
        return { tick: to, over: false, reveal: [], revealed: reply.revealed };
      }
    }
    throw new Error("live: too many commit conflicts");
  };

  while (!engine.over && tick < opts.maxTicks) {
    if (engine.drawsWithin(LIVE_LEAD_TICKS) > buffer.available) {
      if (tick === committed) {
        // Ya está todo comprometido y aun así falta azar: seguir sería inventarlo.
        throw new Error(
          `live desync at tick ${tick}: the arbiter revealed only ${buffer.received} values`,
        );
      }
      const reply = await send(tick, false);
      if (reply.over) return { score: reply.score ?? 0, ticks: reply.tick };
      continue;
    }
    if (opts.decide(engine, tick)) {
      engine.flap();
      flaps.push(tick);
    }
    engine.update(FLAPPY_DT);
    tick += 1;
  }

  const last = await send(tick, !engine.over);
  if (!last.over) throw new Error("live: the arbiter did not close the attempt");
  return { score: last.score ?? 0, ticks: last.tick };
}

/** Cómo se compromete: la web lo hace por HTTP con su token; los tests, contra
 *  un árbitro en memoria. */
export type FlappyLiveCommitFn = (c: FlappyLiveCommit) => Promise<FlappyLiveReply>;

/** Una partida EN VIVO dentro de un bucle de tiempo real (la web). El bucle
 *  pregunta `canStep()` antes de cada tick (si falta azar, espera: no inventa)
 *  y llama a `pump()` en cada cuadro. La sesión compromete en segundo plano
 *  cuando el motor va a necesitar azar, se resincroniza si el árbitro está en
 *  otro tick y reintenta los errores de red. Guarda todo lo revelado para
 *  comprobar el secreto cuando la partida se decida (`checkLiveReveals`).
 *  Para quien juega sin bucle de tiempo real está `playFlappyLive`. */
export class FlappyLiveSession {
  readonly engine: FlappyEngine;
  /** Todo lo revelado, en orden. */
  readonly reveals: number[] = [];
  private readonly buffer = new BufferedRandom();
  private readonly flaps: number[];
  private readonly commitFn: FlappyLiveCommitFn;
  private readonly now: () => number;
  private readonly retryMs: number;
  private current: number;
  private committed: number;
  private inFlight = false;
  private retryAt = 0;
  private conflicts = 0;
  private closed?: { score: number; ticks: number };
  private failure?: Error;

  constructor(
    start: FlappyLiveStart,
    commit: FlappyLiveCommitFn,
    opts: { now?: () => number; retryMs?: number } = {},
  ) {
    this.commitFn = commit;
    this.now = opts.now ?? Date.now;
    this.retryMs = opts.retryMs ?? 1_000;
    this.receive(start.reveal);
    this.engine = new FlappyEngine(this.buffer);
    // Retomar: rehacer lo ya comprometido con los valores que ya llegaron.
    this.flaps = [...start.flaps];
    const done = new Set(this.flaps);
    let t = 0;
    for (; t < start.tick && !this.engine.over; t++) {
      if (done.has(t)) this.engine.flap();
      this.engine.update(FLAPPY_DT);
    }
    this.current = t;
    this.committed = start.tick;
  }

  /** Ticks jugados. */
  get tick(): number {
    return this.current;
  }

  /** El cierre que confirmó el árbitro (su puntaje manda), cuando llega. */
  get result(): { score: number; ticks: number } | undefined {
    return this.closed;
  }

  /** La sesión no puede seguir: el árbitro y el jugador no coinciden. */
  get error(): Error | undefined {
    return this.failure;
  }

  /** ¿Está esperando al árbitro (un compromiso en vuelo o un reintento)? */
  get waiting(): boolean {
    return this.inFlight || this.now() < this.retryAt;
  }

  /** ¿Hay azar para el próximo tick? Sin él, el bucle espera. */
  canStep(): boolean {
    return (
      !this.closed &&
      !this.failure &&
      !this.engine.over &&
      this.engine.drawsWithin(1) <= this.buffer.available
    );
  }

  /** Avanza un tick; `flap`: aletear en este tick. Solo con `canStep()`. Antes
   *  del primer aleteo el motor no se mueve, así que esos ticks no cuentan:
   *  mirar un minuto sin tocar no puede armar un primer compromiso más largo
   *  de lo que acepta el árbitro. */
  step(flap: boolean): void {
    if (!this.canStep()) throw new Error("live: no randomness for the next tick yet");
    if (!flap && !this.engine.started) return;
    if (flap) {
      this.engine.flap();
      this.flaps.push(this.current);
    }
    this.engine.update(FLAPPY_DT);
    this.current += 1;
  }

  /** Cada cuadro: compromete si hace falta azar (o si el pájaro murió) y no hay
   *  otro compromiso en vuelo. Nunca bloquea. */
  pump(): void {
    if (this.inFlight || this.closed || this.failure || this.now() < this.retryAt) return;
    const over = this.engine.over;
    if (!over && this.engine.drawsWithin(LIVE_LEAD_TICKS) <= this.buffer.available) return;
    if (this.current === this.committed) {
      // Todo comprometido y aun así falta azar, o el pájaro murió y el árbitro
      // no cerró: seguir sería inventar.
      this.failure = new Error(
        over
          ? `live desync: the bird died at tick ${this.current} but the arbiter did not close the attempt`
          : `live desync at tick ${this.current}: the arbiter revealed only ${this.buffer.received} values`,
      );
      return;
    }
    const from = this.committed;
    const to = Math.min(this.current, from + MAX_COMMIT_TICKS);
    this.inFlight = true;
    this.commitFn({
      from,
      to,
      flaps: this.flaps.filter((f) => f >= from && f < to),
      have: this.buffer.received,
    })
      .then(
        (reply) => this.onReply(reply),
        (e: unknown) => {
          if (isRetriableLiveError(e)) {
            // Pasajero (red, 429, 5xx): se reintenta más tarde; el bucle espera.
            this.retryAt = this.now() + this.retryMs;
          } else {
            // Un rechazo del árbitro no se arregla reintentando: se corta con
            // el motivo, para mostrarlo en vez de quedar "conectando" siempre.
            this.failure = new Error(
              `live: the arbiter rejected the commit: ${(e as Error)?.message ?? String(e)}`,
            );
          }
        },
      )
      .finally(() => {
        this.inFlight = false;
      });
  }

  private onReply(reply: FlappyLiveReply): void {
    this.receive(reply.reveal);
    if (reply.conflict) {
      // El árbitro está en otro tick: perdió compromisos, o se perdió una
      // respuesta que ya había aplicado. Se sigue desde su tick.
      if (reply.tick > this.current) {
        this.failure = new Error(
          `live desync: arbiter at tick ${reply.tick}, player at ${this.current}`,
        );
      } else if (++this.conflicts > MAX_CONFLICTS) {
        this.failure = new Error("live: too many commit conflicts");
      } else {
        this.committed = reply.tick;
      }
      return;
    }
    this.conflicts = 0;
    this.committed = reply.tick;
    if (reply.over) this.closed = { score: reply.score ?? 0, ticks: reply.tick };
  }

  private receive(values: readonly number[]): void {
    this.buffer.push(values);
    this.reveals.push(...values);
  }
}

/** Re-verifica un intento en vivo con el secreto que el árbitro publica al
 *  decidirse la partida: el motor corre con la misma fuente de azar que usó el
 *  árbitro. Misma semántica que `verifyFlappy` (en cada tick, si está en
 *  `flaps` aletea, después `update`; al morir se corta). Devuelve el puntaje. */
export function verifyFlappyLive(
  secret: string,
  replay: { ticks: number; flaps: number[] },
): number {
  const g = new FlappyEngine(new SecretSource(secret));
  const flapSet = new Set(replay.flaps);
  for (let t = 0; t < replay.ticks; t++) {
    if (flapSet.has(t)) g.flap();
    g.update(FLAPPY_DT);
    if (g.over) break;
  }
  return g.score;
}
