// PARTIDAS EN VIVO del 1v1 (Flappy y Carrera). El jugador abre un intento con su
// firma, compromete sus jugadas por tramos y recibe el azar que el juego va a
// consumir en los próximos LIVE_LEAD_TICKS. El azar sale del secreto de la
// partida (SecretSource), que no sale de acá hasta que la partida se decide.
// Cada juego en vivo se describe con un `LiveGame` (@arcade1v1/game-sdk): su
// motor, cuánto azar consume y cómo viajan sus jugadas (`flaps` en Flappy,
// `inputs` en los demás).
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md y
// docs/superpowers/specs/2026-10-10-carrera-en-vivo-design.md

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import {
  isLiveMatch,
  SecretSource,
  LIVE_LEAD_TICKS,
  MAX_COMMIT_TICKS,
  decodeLiveInputs,
  encodeLiveInputs,
  liveInputsByTick,
  type LiveGame,
  type LiveInput,
} from "@arcade1v1/game-sdk/live";
import { liveGameFor } from "@arcade1v1/game-sdk/live-games";
import { liveStartAuthMessage, MATCHMAKE_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import {
  AUTH_REQUIRED,
  MAX_REPLAY_TICKS,
  submitDeadlineOf,
  assertDepositOnchain,
  attemptInputs,
  emptyLiveMoves,
  finishLiveAttempt,
  liveReplayOf,
  recordLiveInputs,
  matchRecord,
  persistMatches,
  reclaimSeat,
  setExpiredLiveCloser,
  type LiveAttempt,
  type Match,
} from "./matchmaking.js";
import {
  forgetLiveAttempts,
  loadLiveAttempts,
  saveLiveAttempt,
  withLiveLock,
} from "./live-store.js";

export { LiveUnavailableError } from "./live-store.js";

/** Un error esperable del protocolo: las rutas lo devuelven como 400. */
export class LiveError extends Error {}

export type LiveStartView =
  | {
      over: false;
      token: string;
      tick: number;
      /** Lo ya comprometido, en el formato del juego (`flaps` o `inputs`). */
      flaps?: number[];
      inputs?: LiveInput[];
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

/** Un compromiso. Las jugadas van en el formato del juego: `flaps` (los ticks
 *  de los aleteos de Flappy) o `inputs` (`{ t, a }`, los demás). */
export interface LiveCommitBody {
  token: string;
  from: number;
  to: number;
  flaps?: number[];
  inputs?: LiveInput[];
  have: number;
  final?: boolean;
}

// Motores del árbitro por intento, en memoria. Se reconstruyen repitiendo el
// registro (después de un reinicio, o si quedaron desfasados). El tope evita que
// los intentos abandonados acumulen memoria.
const MAX_CACHED_ENGINES = 500;
interface CachedEngine {
  game: LiveGame<unknown>;
  eng: unknown;
  src: SecretSource;
  tick: number;
}
const engines = new Map<string, CachedEngine>();

/** Tests: simula un reinicio del árbitro (se pierde el caché, no el intento). */
export function __clearLiveEnginesForTest(): void {
  engines.clear();
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function engineFor(m: Match, address: string, a: LiveAttempt) {
  const key = `${m.id}:${address}`;
  const cached = engines.get(key);
  if (cached && cached.tick === a.tick) return cached;
  const game = liveGameFor(m.game)!;
  const src = new SecretSource(m.liveSecret!);
  const eng = game.create(src);
  const done = liveInputsByTick(attemptInputs(m.game, a));
  for (let t = 0; t < a.tick && !game.over(eng); t++) game.step(eng, done.get(t) ?? []);
  const entry: CachedEngine = { game, eng, src, tick: a.tick };
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
  if (!isLiveMatch(m.game, m.rulesV) || !liveGameFor(m.game)) {
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
  if (Date.now() > submitDeadlineOf(m)) throw new LiveError("match expired");
}

/** El replay de un intento cerrado, tal como lo guarda la partida. */
const replayOf = (m: Match, a: LiveAttempt) => liveReplayOf(m.game, a, RULES_V[m.game] ?? 1);

/** Las jugadas del tramo `[from, to)`, validadas. Flappy: ticks enteros,
 *  estrictamente crecientes. Los demás: `{ t, a }` en orden, con acciones del
 *  juego y a lo sumo `maxActionsPerTick` por tick. */
function trancheOf(game: LiveGame<unknown>, body: LiveCommitBody, from: number, to: number) {
  if (game.wire === "flaps") {
    const flaps = body.flaps;
    if (
      !Array.isArray(flaps) ||
      flaps.some(
        (f, i) => !Number.isInteger(f) || f < from || f >= to || (i > 0 && f <= flaps[i - 1]),
      )
    ) {
      throw new LiveError("invalid flaps: integer ticks, strictly increasing, inside [from, to)");
    }
    return decodeLiveInputs(game, { flaps });
  }
  const invalid = () =>
    new LiveError(
      `invalid inputs: { t, a } with integer ticks inside [from, to), in order, ` +
        `actions ${game.actions.join("/")}, at most ${game.maxActionsPerTick} per tick`,
    );
  if (!Array.isArray(body.inputs)) throw invalid();
  const inputs = decodeLiveInputs(game, { inputs: body.inputs });
  let prev = -1;
  let sameTick = 0;
  for (const i of inputs) {
    if (!Number.isInteger(i.t) || i.t < from || i.t >= to || i.t < prev) throw invalid();
    if (!game.actions.includes(i.a)) throw invalid();
    sameTick = i.t === prev ? sameTick + 1 : 1;
    if (sameTick > game.maxActionsPerTick) throw invalid();
    prev = i.t;
  }
  return inputs;
}

/** NADA SALE ANTES DE QUEDAR GUARDADO. Todo lo que una respuesta le muestra al
 *  jugador por primera vez (valores del azar, el final del intento, un token)
 *  sale del estado del intento en memoria, y ese estado tiene que estar en su
 *  registro durable antes de contestar (live-store.ts). Si no se puede guardar,
 *  el pedido sale con 503 y sin revelar nada: el jugador reintenta con lo que ya
 *  sabía. */
async function durable(m: Match, address: string, a: LiveAttempt): Promise<void> {
  await saveLiveAttempt(m.id, address, a);
}

/** Un intento cerrado: guardado, y su puntaje en la partida (que liquida si ya
 *  están los dos). Si el cierre se cortó a mitad (se cerró en memoria y no se
 *  pudo guardar), el reintento del jugador pasa por acá y lo completa. */
async function finishClosed(m: Match, address: string, a: LiveAttempt): Promise<void> {
  await durable(m, address, a);
  if (m.scores[address] === undefined) {
    await finishLiveAttempt(m, address, a.score ?? 0, replayOf(m, a));
  }
}

/** Revela lo que el motor va a consumir en los próximos LIVE_LEAD_TICKS y
 *  devuelve los valores desde `have`. */
function reveal(a: LiveAttempt, e: CachedEngine, have: number) {
  a.revealed = Math.max(a.revealed, e.src.consumed + e.game.drawsWithin(e.eng, LIVE_LEAD_TICKS));
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
  // Un p2 que perdió el lugar por no unirse a tiempo y se unió igual (W3): si
  // la cadena lo confirma, vuelve a ser el p2. Lo dice la cadena, no el pedido.
  await reclaimSeat(id, address);
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
  // De a un pedido por intento (ver withLiveLock): guardar es asíncrono.
  return withLiveLock(m.id, address, async () => {
    const earlier = m.live?.[address];
    if (earlier?.over) {
      await finishClosed(m, address, earlier);
      return { over: true, score: earlier.score ?? 0, tick: earlier.tick };
    }
    assertOpen(m);
    try {
      await assertDepositOnchain(m, address);
    } catch (e) {
      throw new LiveError((e as Error).message);
    }
    assertOpen(m);
    m.live ??= {};
    const a: LiveAttempt = m.live[address] ?? {
      tokenHash: "",
      startedAt: Date.now(),
      tick: 0,
      ...emptyLiveMoves(m.game),
      revealed: 0,
    };
    m.live[address] = a;
    const token = randomBytes(32).toString("hex");
    a.tokenHash = sha256(token);
    const r = reveal(a, engineFor(m, address, a), 0);
    // El token nuevo y los valores que se revelan salen recién guardados: una
    // caída no puede devolver a la vida el token anterior (que este invalida).
    await durable(m, address, a);
    persistMatches();
    const done = encodeLiveInputs(liveGameFor(m.game)!, attemptInputs(m.game, a));
    return { over: false, token, tick: a.tick, ...done, ...r };
  });
}

/** Compromete las jugadas en `[from, to)` y devuelve el azar de los próximos
 *  LIVE_LEAD_TICKS. Con `final`, al terminar o al tope, cierra el intento. */
export async function liveCommit(
  id: string,
  address: string,
  body: LiveCommitBody,
): Promise<LiveCommitView> {
  address = address.toLowerCase();
  const m = liveMatchFor(id, address);
  return withLiveLock(m.id, address, async () => {
    const a = m.live?.[address];
    if (!a) throw new LiveError("missing live attempt: call /match/:id/live/start first");
    const given = Buffer.from(sha256(String(body.token ?? "")), "hex");
    const stored = Buffer.from(a.tokenHash, "hex");
    if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
      throw new LiveError("bad token");
    }
    if (a.over) {
      await finishClosed(m, address, a);
      return { over: true, score: a.score ?? 0, tick: a.tick, reveal: [], revealed: a.revealed };
    }
    assertOpen(m);

    const { from, to, have } = body;
    const final = body.final === true;
    if (![from, to, have].every(Number.isInteger)) {
      throw new LiveError("invalid commit range: from, to and have must be integers");
    }
    if (from !== a.tick) {
      const r = reveal(a, engineFor(m, address, a), have);
      await durable(m, address, a);
      return { conflict: true, tick: a.tick, ...r };
    }
    if (
      to < from ||
      (to === from && !final) ||
      to - from > MAX_COMMIT_TICKS ||
      to > MAX_REPLAY_TICKS
    ) {
      throw new LiveError(`invalid commit range [${from}, ${to})`);
    }
    const game = liveGameFor(m.game)!;
    const tranche = trancheOf(game, body, from, to);
    // Tope del intento (Carrera): sin él, quien sobrevive podría inflar su
    // registro con jugadas que no cambian nada, y se reescribe entero en cada
    // compromiso. Un cliente honesto recorta antes de jugar y nunca llega acá.
    const budget = game.inputBudget(to);
    if (attemptInputs(m.game, a).length + tranche.length > budget) {
      throw new LiveError(`too many inputs: at most ${budget} by tick ${to}`);
    }

    const e = engineFor(m, address, a);
    const byTick = liveInputsByTick(tranche);
    let t = from;
    for (; t < to && !game.over(e.eng); t++) game.step(e.eng, byTick.get(t) ?? []);
    // Lo jugado después de terminar no se aplicó: no entra al registro.
    recordLiveInputs(
      m.game,
      a,
      tranche.filter((i) => i.t < t),
    );
    a.tick = t;
    e.tick = t;

    const r = reveal(a, e, have);
    if (game.over(e.eng) || final || a.tick >= MAX_REPLAY_TICKS) {
      a.over = true;
      a.score = game.score(e.eng);
      engines.delete(`${m.id}:${address}`);
      // El final (y el puntaje) sale guardado: una caída no puede devolverle al
      // jugador un intento que ya vio terminar.
      await finishClosed(m, address, a);
      return { over: true, score: a.score, tick: a.tick, ...r };
    }
    // Sin persistMatches: el tramo ya quedó en el registro del intento, y subir
    // el blob de partidas en cada compromiso es lo que fundió la cuota de ancho
    // de banda de Render. El blob se guarda al abrir y al cerrar el intento.
    await durable(m, address, a);
    return { over: false, tick: a.tick, ...r };
  });
}

/** Cierra un intento abierto en su último tick comprometido y cuenta lo
 *  alcanzado. Es interno del árbitro (sin token): lo usa el runner cuando a un
 *  agente BYO se le vence el plazo con el intento a medio jugar. Devuelve
 *  `false` si no había intento, ya estaba cerrado o la partida ya no admite
 *  puntajes. */
export async function closeLiveAttempt(id: string, address: string): Promise<boolean> {
  address = address.toLowerCase();
  const m = matchRecord(id);
  if (!m?.live?.[address] || !m.liveSecret) return false;
  return withLiveLock(m.id, address, async () => {
    const a = m.live?.[address];
    if (!a || a.over) return false;
    try {
      assertOpen(m);
    } catch {
      return false; // decidida o vencida: el barrendero se encarga
    }
    await closeAtLastTick(m, address, a);
    return true;
  });
}

/** Cierra el intento en su último tick comprometido y cuenta lo alcanzado.
 *  Quien lo llama tiene el candado del intento. */
async function closeAtLastTick(m: Match, address: string, a: LiveAttempt): Promise<void> {
  const e = engineFor(m, address, a);
  a.over = true;
  a.score = e.game.score(e.eng);
  engines.delete(`${m.id}:${address}`);
  await finishClosed(m, address, a);
}

/** AL VENCER LA PARTIDA (W2; lo llama el barrendero, ver expireMatch): cada
 *  intento a medio jugar se cierra con lo que alcanzó, como el de un agente BYO
 *  al que se le vence el plazo, y cuenta como presentado. Ya no se aceptan
 *  compromisos (assertOpen), así que no compite con ninguno. */
async function closeExpiredAttempts(m: Match): Promise<void> {
  for (const address of Object.keys(m.live ?? {})) {
    await withLiveLock(m.id, address, async () => {
      const a = m.live?.[address];
      if (!a || m.status === "settled" || m.status === "draw") return;
      if (!a.over) await closeAtLastTick(m, address, a);
      else if (m.scores[address] === undefined) await finishClosed(m, address, a);
    });
  }
}
setExpiredLiveCloser(closeExpiredAttempts);

/** Al arrancar, DESPUÉS de restaurar las partidas: cada registro guardado manda
 *  sobre la copia del intento que traía el blob (que se guarda cada 20 s y puede
 *  ir atrás), salvo que el blob ya lo tenga cerrado o más avanzado. Un intento
 *  que terminó sin llegar al blob se completa acá: su puntaje entra a la partida
 *  y, si estaban los dos, se liquida. Los registros de partidas que ya no están
 *  se borran. */
export async function restoreLiveAttempts(): Promise<void> {
  const stored = await loadLiveAttempts();
  const gone = new Map<string, string[]>();
  let merged = 0;
  let finished = 0;
  for (const { matchId, address, attempt } of stored) {
    const m = matchRecord(matchId);
    if (!m || !m.liveSecret) {
      gone.set(matchId, [...(gone.get(matchId) ?? []), address]);
      continue;
    }
    m.live ??= {};
    const cur = m.live[address];
    // Nunca se reabre un intento cerrado, y un blob más avanzado (un tramo que
    // no se llegó a guardar ni a revelar) tampoco se pisa: no le dio nada al
    // jugador, y descartarlo le haría repetir un tramo que ya jugó.
    if (!cur || (!cur.over && (attempt.over || attempt.tick >= cur.tick))) {
      m.live[address] = attempt;
      merged++;
    }
    const a = m.live[address];
    if (a.over && m.scores[address] === undefined) {
      await finishLiveAttempt(m, address, a.score ?? 0, replayOf(m, a));
      finished++;
    }
  }
  for (const [matchId, addresses] of gone) forgetLiveAttempts(matchId, addresses);
  if (stored.length) {
    console.log(
      `Intentos en vivo recuperados: ${merged} de ${stored.length}` +
        (finished ? ` (${finished} cerrados que no habían llegado a su partida)` : ""),
    );
  }
}
