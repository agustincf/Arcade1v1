// Flappy EN VIVO: su definición para el modo en vivo genérico (live-play.ts) y
// las piezas con nombre de Flappy que ya usaban el SDK, la web y los agentes de
// la casa (`playFlappyLive`, `FlappyLiveSession`, `verifyFlappyLive`), con las
// mismas firmas de siempre. En el cable, Flappy manda sus aleteos (`flaps`).
// Protocolo: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { FlappyEngine, FLAPPY_DT } from "./flappy";
import type { LiveGame } from "./live";
import { LiveSession, playLive, verifyLive, type LiveCommit, type LiveReply } from "./live-play";

export { isRetriableLiveError } from "./live-play";

/** Flappy para el modo en vivo: una sola acción (aletear, "f"), a lo sumo una
 *  por tick, y antes del primer aleteo el motor no corre. */
export const flappyLive: LiveGame<FlappyEngine> = {
  id: "flappy",
  create: (src) => new FlappyEngine(src),
  step(engine, actions) {
    if (actions.length > 0) engine.flap();
    engine.update(FLAPPY_DT);
  },
  over: (engine) => engine.over,
  score: (engine) => engine.score,
  drawsWithin: (engine, ticks) => engine.drawsWithin(ticks),
  idle: (engine, actions) => !engine.started && actions.length === 0,
  wire: "flaps",
  actions: ["f"],
  maxActionsPerTick: 1,
  inputBudget: () => Infinity,
};

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

/** Respuesta a un compromiso (ver `LiveReply`). */
export type FlappyLiveReply = LiveReply;

/** Cómo se compromete un intento de Flappy. */
export type FlappyLiveCommitFn = (c: FlappyLiveCommit) => Promise<FlappyLiveReply>;

export interface PlayFlappyLiveOptions {
  start: FlappyLiveStart;
  /** ¿Aletear en este tick? Recibe el motor ANTES de aplicar el tick. */
  decide: (engine: FlappyEngine, tick: number) => boolean;
  commit: FlappyLiveCommitFn;
  /** Si el pájaro llega vivo a este tick, se cierra con `final`. */
  maxTicks: number;
  /** Esperas entre reintentos de un compromiso ante un error pasajero. */
  retryDelaysMs?: number[];
}

/** Un compromiso genérico de Flappy, con sus aleteos siempre presentes. */
const asFlappyCommit = (c: LiveCommit): FlappyLiveCommit => ({
  from: c.from,
  to: c.to,
  flaps: c.flaps ?? [],
  have: c.have,
  ...(c.final ? { final: true } : {}),
});

/** Juega una partida de Flappy en vivo de punta a punta (ver `playLive`). */
export function playFlappyLive(
  opts: PlayFlappyLiveOptions,
): Promise<{ score: number; ticks: number }> {
  return playLive(flappyLive, {
    start: opts.start,
    decide: opts.decide,
    commit: (c) => opts.commit(asFlappyCommit(c)),
    maxTicks: opts.maxTicks,
    retryDelaysMs: opts.retryDelaysMs,
  });
}

/** Flappy en vivo dentro de un bucle de tiempo real (la web): una
 *  `LiveSession` de Flappy, que avanza con `step(flap)`. */
export class FlappyLiveSession {
  private readonly session: LiveSession<FlappyEngine>;

  constructor(
    start: FlappyLiveStart,
    commit: FlappyLiveCommitFn,
    opts: { now?: () => number; retryMs?: number } = {},
  ) {
    this.session = new LiveSession(flappyLive, start, (c) => commit(asFlappyCommit(c)), opts);
  }

  get engine(): FlappyEngine {
    return this.session.engine;
  }

  /** Todo lo revelado, en orden. */
  get reveals(): number[] {
    return this.session.reveals;
  }

  /** Ticks jugados. */
  get tick(): number {
    return this.session.tick;
  }

  /** El cierre que confirmó el árbitro (su puntaje manda), cuando llega. */
  get result(): { score: number; ticks: number } | undefined {
    return this.session.result;
  }

  /** La sesión no puede seguir: el árbitro y el jugador no coinciden. */
  get error(): Error | undefined {
    return this.session.error;
  }

  /** ¿Está esperando al árbitro (un compromiso en vuelo o un reintento)? */
  get waiting(): boolean {
    return this.session.waiting;
  }

  /** ¿Hay azar para el próximo tick? Sin él, el bucle espera. */
  canStep(): boolean {
    return this.session.canStep();
  }

  /** Avanza un tick; `flap`: aletear en este tick. Solo con `canStep()`. Antes
   *  del primer aleteo el motor no se mueve, así que esos ticks no cuentan. */
  step(flap: boolean): void {
    this.session.step(flap ? ["f"] : []);
  }

  /** Cada cuadro: compromete si hace falta azar (o si el pájaro murió). */
  pump(): void {
    this.session.pump();
  }
}

/** Re-verifica un intento de Flappy en vivo con el secreto que el árbitro
 *  publica al decidirse la partida. Misma semántica que `verifyFlappy` (en cada
 *  tick, si está en `flaps` aletea, después `update`; al morir se corta).
 *  Devuelve el puntaje. */
export function verifyFlappyLive(
  secret: string,
  replay: { ticks: number; flaps: number[] },
): number {
  return verifyLive(flappyLive, secret, replay);
}
