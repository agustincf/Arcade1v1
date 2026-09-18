// Driver de una partida de Flappy EN VIVO para quien juega sin bucle de tiempo
// real: el SDK y los agentes de la casa. La web tiene su propio bucle
// (requestAnimationFrame) y usa las mismas piezas: BufferedRandom y drawsWithin.
// Protocolo: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { FlappyEngine, FLAPPY_DT } from "./flappy";
import { BufferedRandom, LIVE_LEAD_TICKS, SecretSource } from "./live";

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
}

/** Cuántas veces seguidas se acepta un conflicto antes de rendirse. */
const MAX_CONFLICTS = 5;

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

  const send = async (to: number, final: boolean) => {
    for (let i = 0; i < MAX_CONFLICTS; i++) {
      const reply = await opts.commit({
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
