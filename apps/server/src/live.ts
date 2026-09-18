// PARTIDAS EN VIVO del 1v1 (piloto: Flappy). El jugador abre un intento con su
// firma, compromete sus jugadas por tramos y recibe el azar que el juego va a
// consumir en los próximos LIVE_LEAD_TICKS. El azar sale del secreto de la
// partida (SecretSource), que no sale de acá hasta que la partida se decide.
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import {
  isLiveMatch,
  SecretSource,
  LIVE_LEAD_TICKS,
  MAX_COMMIT_TICKS,
} from "@arcade1v1/game-sdk/live";
import { liveStartAuthMessage, MATCHMAKE_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import {
  AUTH_REQUIRED,
  MAX_REPLAY_TICKS,
  SUBMIT_WINDOW_MS,
  assertDepositOnchain,
  finishLiveAttempt,
  matchRecord,
  persistMatches,
  type LiveAttempt,
  type Match,
} from "./matchmaking.js";

/** Un error esperable del protocolo: las rutas lo devuelven como 400. */
export class LiveError extends Error {}

export type LiveStartView =
  | {
      over: false;
      token: string;
      tick: number;
      flaps: number[];
      reveal: number[];
      revealed: number;
    }
  | { over: true; score: number; tick: number };

export type LiveCommitView =
  | {
      conflict?: undefined;
      over: boolean;
      score?: number;
      tick: number;
      reveal: number[];
      revealed: number;
    }
  | { conflict: true; tick: number; reveal: number[]; revealed: number };

export interface LiveCommitBody {
  token: string;
  from: number;
  to: number;
  flaps: number[];
  have: number;
  final?: boolean;
}

// Motores del árbitro por intento, en memoria. Se reconstruyen repitiendo el
// registro (después de un reinicio, o si quedaron desfasados). El tope evita que
// los intentos abandonados acumulen memoria.
const MAX_CACHED_ENGINES = 500;
const engines = new Map<string, { eng: FlappyEngine; src: SecretSource; tick: number }>();

/** Tests: simula un reinicio del árbitro (se pierde el caché, no el intento). */
export function __clearLiveEnginesForTest(): void {
  engines.clear();
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function engineFor(m: Match, address: string, a: LiveAttempt) {
  const key = `${m.id}:${address}`;
  const cached = engines.get(key);
  if (cached && cached.tick === a.tick) return cached;
  const src = new SecretSource(m.liveSecret!);
  const eng = new FlappyEngine(src);
  const flapSet = new Set(a.flaps);
  for (let t = 0; t < a.tick && !eng.over; t++) {
    if (flapSet.has(t)) eng.flap();
    eng.update(FLAPPY_DT);
  }
  const entry = { eng, src, tick: a.tick };
  engines.delete(key);
  engines.set(key, entry);
  if (engines.size > MAX_CACHED_ENGINES) {
    const oldest = engines.keys().next().value;
    if (oldest !== undefined) engines.delete(oldest);
  }
  return entry;
}

/** La partida, si `address` puede jugarla en vivo. */
function liveMatchFor(id: string, address: string): Match {
  const m = matchRecord(id);
  if (!m) throw new LiveError("match not found");
  if (address !== m.p1 && address !== m.p2) {
    throw new LiveError("not allowed: not a player in this match");
  }
  if (!isLiveMatch(m.game, m.rulesV)) {
    throw new LiveError(`live play not allowed: ${m.game} is not a live game`);
  }
  // Una partida en vivo nace con su secreto (matchmaking.ts): sin él no hay azar.
  if (!m.liveSecret) throw new LiveError("live play not allowed: this match has no live secret");
  const currentV = RULES_V[m.game] ?? 1;
  if ((m.rulesV ?? 1) !== currentV) {
    throw new LiveError(
      `rules version mismatch (match v${m.rulesV ?? 1}, arbiter v${currentV}) — update @arcade1v1/mcp`,
    );
  }
  return m;
}

function assertOpen(m: Match): void {
  if (m.status === "settled" || m.status === "draw") throw new LiveError("match already decided");
  if (Date.now() - m.createdAt > SUBMIT_WINDOW_MS) throw new LiveError("match expired");
}

/** Revela lo que el motor va a consumir en los próximos LIVE_LEAD_TICKS y
 *  devuelve los valores desde `have`. */
function reveal(a: LiveAttempt, e: { eng: FlappyEngine; src: SecretSource }, have: number) {
  a.revealed = Math.max(a.revealed, e.src.consumed + e.eng.drawsWithin(LIVE_LEAD_TICKS));
  const from = Math.min(Math.max(0, have), a.revealed);
  return { reveal: e.src.slice(from, a.revealed), revealed: a.revealed };
}

/** Abre (o retoma) el intento en vivo de `address`. Nunca lo reinicia: si ya
 *  existe devuelve su progreso y un token nuevo que invalida el anterior. */
export async function liveStart(
  id: string,
  address: string,
  auth?: { signature: string; ts: number },
): Promise<LiveStartView> {
  address = address.toLowerCase();
  const m = liveMatchFor(id, address);
  if (auth?.signature) {
    const ts = Number(auth.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MATCHMAKE_AUTH_TTL_MS) {
      throw new LiveError("auth expired");
    }
    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: liveStartAuthMessage(m.id, address, ts),
        signature: auth.signature as Hex,
      });
    } catch {
      throw new LiveError("bad signature");
    }
    if (signer.toLowerCase() !== address) throw new LiveError("bad signature");
  } else if (AUTH_REQUIRED) {
    throw new LiveError("signature required");
  }
  const earlier = m.live?.[address];
  if (earlier?.over) return { over: true, score: earlier.score ?? 0, tick: earlier.tick };
  assertOpen(m);
  try {
    await assertDepositOnchain(m, address);
  } catch (e) {
    throw new LiveError((e as Error).message);
  }

  // Desde acá, sin awaits: dos aperturas a la vez no pueden pisarse el intento.
  const now = m.live?.[address];
  if (now?.over) return { over: true, score: now.score ?? 0, tick: now.tick };
  assertOpen(m);
  m.live ??= {};
  const a: LiveAttempt = now ?? {
    tokenHash: "",
    startedAt: Date.now(),
    tick: 0,
    flaps: [],
    revealed: 0,
  };
  m.live[address] = a;
  const token = randomBytes(32).toString("hex");
  a.tokenHash = sha256(token);
  const r = reveal(a, engineFor(m, address, a), 0);
  persistMatches();
  return { over: false, token, tick: a.tick, flaps: [...a.flaps], ...r };
}

/** Compromete los aleteos en `[from, to)` y devuelve el azar de los próximos
 *  LIVE_LEAD_TICKS. Con `final`, al morir o al tope, cierra el intento. */
export async function liveCommit(
  id: string,
  address: string,
  body: LiveCommitBody,
): Promise<LiveCommitView> {
  address = address.toLowerCase();
  const m = liveMatchFor(id, address);
  const a = m.live?.[address];
  if (!a) throw new LiveError("missing live attempt: call /match/:id/live/start first");
  const given = Buffer.from(sha256(String(body.token ?? "")), "hex");
  const stored = Buffer.from(a.tokenHash, "hex");
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
    throw new LiveError("bad token");
  }
  if (a.over) {
    return { over: true, score: a.score ?? 0, tick: a.tick, reveal: [], revealed: a.revealed };
  }
  assertOpen(m);

  const { from, to, have, flaps } = body;
  const final = body.final === true;
  if (![from, to, have].every(Number.isInteger)) {
    throw new LiveError("invalid commit range: from, to and have must be integers");
  }
  if (from !== a.tick) {
    return { conflict: true, tick: a.tick, ...reveal(a, engineFor(m, address, a), have) };
  }
  if (
    to < from ||
    (to === from && !final) ||
    to - from > MAX_COMMIT_TICKS ||
    to > MAX_REPLAY_TICKS
  ) {
    throw new LiveError(`invalid commit range [${from}, ${to})`);
  }
  if (
    !Array.isArray(flaps) ||
    flaps.some(
      (f, i) => !Number.isInteger(f) || f < from || f >= to || (i > 0 && f <= flaps[i - 1]),
    )
  ) {
    throw new LiveError("invalid flaps: integer ticks, strictly increasing, inside [from, to)");
  }

  const e = engineFor(m, address, a);
  const flapSet = new Set(flaps);
  let t = from;
  for (; t < to && !e.eng.over; t++) {
    if (flapSet.has(t)) e.eng.flap();
    e.eng.update(FLAPPY_DT);
  }
  // Los aleteos después de morir no se aplicaron: no entran al registro.
  for (const f of flaps) if (f < t) a.flaps.push(f);
  a.tick = t;
  e.tick = t;

  const r = reveal(a, e, have);
  if (e.eng.over || final || a.tick >= MAX_REPLAY_TICKS) {
    a.over = true;
    a.score = e.eng.score;
    engines.delete(`${m.id}:${address}`);
    await finishLiveAttempt(m, address, a.score, {
      ticks: a.tick,
      flaps: [...a.flaps],
      v: RULES_V[m.game] ?? 1,
    });
    return { over: true, score: a.score, tick: a.tick, ...r };
  }
  persistMatches();
  return { over: false, tick: a.tick, ...r };
}
