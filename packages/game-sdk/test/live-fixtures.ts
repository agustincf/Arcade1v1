// Piezas compartidas por los tests en vivo de Flappy: un secreto por número, una
// política de aleteo, un árbitro de referencia en memoria (las mismas reglas que
// apps/server/src/live.ts, sin HTTP ni firmas) y la partida jugada de corrido.

import { FlappyEngine, FLAPPY_DT, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";
import { SecretSource, LIVE_LEAD_TICKS } from "@arcade1v1/game-sdk/live";
import type { FlappyLiveCommit, FlappyLiveReply } from "@arcade1v1/game-sdk/flappy-live";

/** Un secreto de prueba por número (el árbitro sortea 32 bytes al azar). */
export const secretFor = (n: number) => n.toString(16).padStart(64, "0");

export function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

/** Árbitro de referencia. `rollbackOnCommit`: en ese compromiso "se cae" y
 *  pierde los últimos 40 ticks comprometidos, como una caída dura. */
export function referenceArbiter(secret: string, rollbackOnCommit?: number) {
  let src = new SecretSource(secret);
  let eng = new FlappyEngine(src);
  let tick = 0;
  let revealed = 0;
  let over = false;
  let seen = 0;
  let flaps: number[] = [];
  const log: { to: number; revealed: number }[] = [];
  const reveal = (have: number) => {
    revealed = Math.max(revealed, src.consumed + eng.drawsWithin(LIVE_LEAD_TICKS));
    return { reveal: src.slice(Math.min(Math.max(0, have), revealed), revealed), revealed };
  };
  const start = { tick: 0, flaps: [] as number[], ...reveal(0) };
  log.push({ to: 0, revealed });
  const commit = async (c: FlappyLiveCommit): Promise<FlappyLiveReply> => {
    seen += 1;
    if (seen === rollbackOnCommit && tick > 0) {
      const back = Math.max(0, tick - 40);
      flaps = flaps.filter((f) => f < back);
      src = new SecretSource(secret);
      eng = new FlappyEngine(src);
      const set = new Set(flaps);
      for (let t = 0; t < back; t++) {
        if (set.has(t)) eng.flap();
        eng.update(FLAPPY_DT);
      }
      tick = back;
    }
    if (over) return { tick, over: true, score: eng.score, reveal: [], revealed };
    if (c.from !== tick) return { conflict: true, tick, ...reveal(c.have) };
    const set = new Set(c.flaps);
    let t = c.from;
    for (; t < c.to && !eng.over; t++) {
      if (set.has(t)) eng.flap();
      eng.update(FLAPPY_DT);
    }
    for (const f of c.flaps) if (f < t) flaps.push(f);
    tick = t;
    const r = reveal(c.have);
    log.push({ to: tick, revealed });
    if (eng.over || c.final) {
      over = true;
      return { tick, over: true, score: eng.score, ...r };
    }
    return { tick, over: false, ...r };
  };
  return { start, commit, log, flaps: () => flaps };
}

/** La misma partida jugada de corrido, con la fuente de azar completa. */
export function batch(secret: string, maxTicks: number) {
  const g = new FlappyEngine(new SecretSource(secret));
  let t = 0;
  for (; t < maxTicks && !g.over; t++) {
    if (flapPolicy(g, t)) g.flap();
    g.update(FLAPPY_DT);
  }
  return { score: g.score, ticks: t };
}
