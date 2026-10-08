// Emparejamiento por orden de llegada + decision del resultado + firma.
// Modelo asincronico: el 2do en llegar se empareja con el 1ro; cada uno juega
// su intento (misma semilla) y al tener los dos puntajes se decide y se firma.

import { randomBytes, randomInt } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { arbiterAddress, signResult, signSeat } from "./sign.js";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { verifyTetris, type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { verifyFlappy, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { verifyRacing, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { verifySnake, type ReplaySnake } from "@arcade1v1/game-sdk/snake";
import { verifyInvaders, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { isLiveMatch, liveSecretHash } from "@arcade1v1/game-sdk/live";
import {
  scoreAuthMessage,
  matchmakeAuthMessage,
  MATCHMAKE_AUTH_TTL_MS,
} from "@arcade1v1/game-sdk/auth";
import {
  onchainEnabled,
  escrowAddress,
  chain,
  escrowChain,
  razonRechazoDeposito,
  ONCHAIN_STATUS,
  ESCROW_REFUND_GRACE_S,
  type OnchainMatch,
} from "./onchain.js";
import { applyResult as applyElo, type RatingUpdate } from "./ratings.js";
import { jsonStore } from "./persist.js";
import { authRequiredFor } from "./config-guard.js";
import { paidTableClosed, type EscrowExpect } from "./escrow-check.js";
import { forgetLiveAttempts, saveLiveAttempt, withLiveLock } from "./live-store.js";
import { recordMatchCreated, recordMatchSettled, recordVerificationRejected } from "./stats.js";

type Status = "waiting" | "ready" | "settled" | "draw";

// ANTI-TRAMPA: registro de verificadores por juego. Cada entrada sabe validar la
// forma del replay y RE-JUGARLO de forma determinística para obtener el puntaje
// real. Es la ÚNICA lista de juegos válidos del árbitro: si un juego no está acá,
// no se acepta (default-deny) -> nunca se confía en un puntaje sin verificar.
interface Verifier {
  /** ¿El replay tiene la forma mínima esperada? */
  valid: (r: unknown) => boolean;
  /** Re-juega el replay y devuelve el puntaje real. */
  verify: (r: unknown) => number;
}

// Helpers de forma: todos llevan seed (number); los de tiempo real llevan ticks.
const hasSeed = (r: any) => !!r && typeof r.seed === "number";
const hasTicks = (r: any) => hasSeed(r) && typeof r.ticks === "number";

// ANTI-DoS: re-jugar un replay es O(ticks) y O(eventos). Sin tope, un replay
// chiquito con `ticks: 1e9` haría iterar al árbitro mil millones de veces (caída
// de CPU) aunque el JSON entre en el límite de 256kb. Los topes están muy por
// encima de cualquier partida real (a 60 ticks/s, 200k ticks ≈ 55 minutos).
export const MAX_REPLAY_TICKS = 200_000;
export const MAX_REPLAY_EVENTS = 200_000;

/** ANTI-TRAMPA: cuántas acciones puede declarar un replay POR TICK, en promedio.
 *
 *  `MAX_REPLAY_EVENTS` acota el total y `MAX_REPLAY_TICKS` acota el reloj, pero
 *  hasta acá nada los cruzaba: un replay con `ticks: 1` y 14.000 acciones pasaba
 *  los dos topes. Sin gravedad no hay dificultad, así que era una partida entera
 *  jugada con tiempo infinito por pieza.
 *
 *  El tope sale de medir, no de suponer: la estrategia oficial de Tetris —el
 *  juego más denso en acciones— llega a 4,65 acciones por tick en el peor de 540
 *  casos (60 semillas × 9 combinaciones de parámetros). 8 deja 1,7× de aire.
 *  Los otros juegos no pasan de 0,04.
 *
 *  Ojo: esto saca el caso degenerado, no cierra del todo la compresión de
 *  tiempo. Para eso hace falta la cota inferior de reloj real en `submitScore`
 *  (medir contra `pairedAt`), que va aparte. */
export const MAX_EVENTS_PER_TICK = 8;

/** Cuántas verificaciones FALLIDAS aguanta un jugador en una partida antes de
 *  quedarse sin intento. Un replay honesto verifica a la primera; tres deja
 *  margen para un reintento de red y corta el reenvío infinito. */
export const MAX_FAILED_VERIFICATIONS = 3;

/** ¿El replay pide más trabajo del razonable para re-jugarlo, o declara más
 *  acciones de las que entran en su propio reloj? (corta el DoS y la trampa). */
export function replayTooLong(replay: unknown): boolean {
  const r = replay as { ticks?: unknown; moves?: unknown; inputs?: unknown; flaps?: unknown };
  const ticks = typeof r.ticks === "number" ? r.ticks : undefined;
  if (ticks !== undefined && (!Number.isFinite(ticks) || ticks > MAX_REPLAY_TICKS)) {
    return true;
  }
  for (const arr of [r.moves, r.inputs, r.flaps]) {
    if (!Array.isArray(arr)) continue;
    if (arr.length > MAX_REPLAY_EVENTS) return true;
    // Cota cruzada: las acciones tienen que entrar en los ticks declarados.
    // (Los juegos por turnos —2048— no declaran `ticks` y quedan fuera.)
    if (ticks !== undefined && arr.length > ticks * MAX_EVENTS_PER_TICK) return true;
  }
  return false;
}

const VERIFIERS: Record<string, Verifier> = {
  "2048": {
    valid: (r: any) => hasSeed(r) && Array.isArray(r.moves),
    verify: (r) => verify2048(r as Replay2048),
  },
  tetris: {
    valid: (r: any) => hasTicks(r) && Array.isArray(r.inputs),
    verify: (r) => verifyTetris(r as ReplayTetris),
  },
  flappy: {
    valid: (r: any) => hasTicks(r) && Array.isArray(r.flaps),
    verify: (r) => verifyFlappy(r as ReplayFlappy),
  },
  racing: {
    valid: (r: any) => hasTicks(r) && Array.isArray(r.inputs),
    verify: (r) => verifyRacing(r as ReplayRacing),
  },
  snake: {
    valid: (r: any) => hasTicks(r) && Array.isArray(r.inputs),
    verify: (r) => verifySnake(r as ReplaySnake),
  },
  invaders: {
    valid: (r: any) => hasTicks(r) && Array.isArray(r.inputs),
    verify: (r) => verifyInvaders(r as ReplayInvaders),
  },
};

/** ¿El árbitro conoce (y sabe verificar) este juego? */
export function isKnownGame(game: string): boolean {
  return game in VERIFIERS;
}

/** El intento en vivo de un jugador, tal como se persiste con la partida. */
export interface LiveAttempt {
  /** sha256 (hex) del token vigente. El token en claro solo lo tiene el jugador. */
  tokenHash: string;
  startedAt: number;
  /** Ticks comprometidos: el motor del árbitro va por acá. */
  tick: number;
  /** Aleteos comprometidos, en ticks absolutos. */
  flaps: number[];
  /** Cuántos valores al azar se revelaron. */
  revealed: number;
  over?: boolean;
  score?: number;
}

export interface Match {
  id: Hex;
  game: string;
  stake: number;
  seed: number;
  rulesV?: number; // versión de reglas con la que nació la partida
  p1: string;
  p2?: string;
  target?: string; // desafío directo: solo esta address (un agente) puede aceptar
  scores: Record<string, number>;
  replays: Record<string, unknown>; // replay verificado de cada jugador
  createdAt: number; // para descartar "waiters" abandonados de la cola
  status: Status;
  winner?: string;
  outcome?: "p1" | "p2" | "draw";
  /** Quién no presentó su intento a tiempo, cuando el otro sí: ganó el que
   *  presentó (W2, ver `expireMatch`). */
  noShow?: string;
  signature?: Hex;
  isBot?: boolean;
  /** Verificaciones FALLIDAS por jugador. El candado de "un intento" solo se
   *  armaba cuando la verificación salía BIEN, así que un replay que no
   *  verificaba se podía reenviar infinitas veces: cada intento re-simulaba el
   *  juego entero (~95 ms de JS sincrónico, en el único hilo de Node) y moría en
   *  "score mismatch" sin dejar rastro ni consumir el intento. */
  failedAttempts?: Record<string, number>;
  refundPromise?: Promise<void>; // el reembolso on-chain en curso (transitorio)
  /** Mesa de plata que se reembolsa (empate, vencida, sin rival): "pending"
   *  mientras la cadena no lo confirme, "done" cuando dice Refunded, "none" si
   *  no había nada que devolver (nadie depositó). El árbitro reintenta con
   *  backoff hasta confirmarlo (W4). */
  refund?: "pending" | "done" | "none";
  refundAttempts?: number;
  nextRefundAt?: number;
  /** Mesa de plata: las condiciones que su asiento ata on-chain (segundos,
   *  epoch). Las fija el árbitro al crear la partida: el que abre deposita con
   *  ESTAS, y el asiento del que se une verifica contra las mismas. Una partida
   *  guardada antes de la v2 no las trae: salen de `createdAt` (`termsOf`). */
  fundDeadline?: number;
  playDeadline?: number;
  /** Hasta cuándo vale `signature` (segundos): `playDeadline + REFUND_GRACE`,
   *  justo cuando se abre el reembolso permissionless. */
  signatureDeadline?: number;
  /** Mesa de plata: el hash del `settle` que mandó el árbitro. */
  settleTx?: Hex;
  /** Mesa de plata cerrada sin un `settle` propio: la liquidó otro con la misma
   *  firma ("external"), se reembolsó ("refunded"), o la firma venció sin
   *  haberse podido presentar y el árbitro la canceló ("expired"). */
  settleOutcome?: "external" | "refunded" | "expired";
  /** Intentos fallidos del `settle` y cuándo toca el próximo (backoff). */
  settleAttempts?: number;
  nextSettleAt?: number;
  /** Mesa de plata: cuándo se sentó el p2 actual. Desde ahí corre su plazo
   *  para unirse en la cadena (`JOIN_WINDOW_MS`, W3). */
  pairedAt?: number;
  /** Mesa de plata: la cadena ya mostró el `open` de p1 (se puede emparejar)
   *  o el `join` de p2 (la partida está fondeada). Evitan releer la cadena. */
  openConfirmed?: boolean;
  joinConfirmed?: boolean;
  /** Mesa de plata: los p2 que se sentaron y no se unieron a tiempo (W3). Su
   *  asiento firmado no se puede revocar en el contrato: si uno se une igual
   *  antes de `fundDeadline`, la cadena manda y vuelve a ser el p2. */
  revokedSeats?: string[];
  eloUpdate?: { p1: RatingUpdate; p2: RatingUpdate }; // cambio de rating al liquidar
  /** Intentos EN VIVO por jugador (juegos en vivo; ver live.ts). */
  live?: Record<string, LiveAttempt>;
  /** Juegos EN VIVO: el secreto de 32 bytes (hex) del que sale el azar. No sale
   *  en ninguna vista hasta que la partida se decide; antes, solo su hash. La
   *  semilla numérica no se usa: sus 32 bits se recuperaban por fuerza bruta con
   *  el primer valor revelado. */
  liveSecret?: string;
}

// Comision (basis points) para calcular el PnL neto que se le informa al jugador.
const FEE_BPS = Number(process.env.FEE_BPS ?? 1500);

// AUTENTICACION OBLIGATORIA: la política está en config-guard.ts
// (authRequiredFor), la misma que valida la guarda de arranque.
export const AUTH_REQUIRED = authRequiredFor(process.env);

const BOT = "0x000000000000000000000000000000000000b07a";

// MESAS PERMITIDAS: deben coincidir con las del contrato (allowedStake). Sin esta
// lista, cualquiera creaba colas basura con montos arbitrarios (NaN, negativos,
// millones) que ensuciaban memoria/disco y el netPnl. Configurable por entorno.
const STAKES_ALLOWED: number[] = (process.env.STAKES_ALLOWED ?? "1,2,5,10")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/** Lo que este árbitro espera del escrow, para cruzarlo con la cadena
 *  (escrow-check.ts): la red y la llave con que firma, su comisión y sus mesas. */
export function escrowExpect(): EscrowExpect {
  return {
    chainId: chain().id,
    escrow: escrowAddress(),
    arbiter: arbiterAddress(),
    feeBps: FEE_BPS,
    stakes: STAKES_ALLOWED,
  };
}

/** Normaliza una dirección para usarla como clave interna (case-insensitive).
 *  Sin esto, "0xAbC..." y "0xabc..." serían DOS jugadores distintos (doble ELO,
 *  "not a player" al reenviar con otro formato, etc.). */
const normAddr = (a: string) => String(a).toLowerCase();

const matches = new Map<string, Match>();
/** "game:stake" -> las partidas esperando rival, la más vieja primero. En la
 *  ladder gratis hay a lo sumo una: el que llega se empareja siempre con la
 *  primera. En una mesa de plata puede haber varias, porque solo se empareja
 *  con quien ya depositó (W3): las que todavía no abrieron en la cadena esperan
 *  atrás sin trabar a nadie. */
const queue = new Map<string, Hex[]>();

const qkey = (game: string, stake: number) => `${game}:${stake}`;

/** Las partidas en espera de una mesa, en orden de llegada. */
function queued(k: string): Match[] {
  return (queue.get(k) ?? []).flatMap((id) => matches.get(id) ?? []);
}

/** Pone una partida en la fila de su mesa, por orden de nacimiento. */
function enqueue(k: string, m: Match): void {
  const ids = (queue.get(k) ?? []).filter((id) => id !== m.id);
  const at = ids.findIndex((id) => (matches.get(id)?.createdAt ?? 0) > m.createdAt);
  ids.splice(at === -1 ? ids.length : at, 0, m.id);
  queue.set(k, ids);
}

/** Saca una partida de la fila de su mesa (si estaba). */
function unqueue(k: string, id: string): void {
  const ids = queue.get(k);
  if (!ids) return;
  const rest = ids.filter((x) => x !== id);
  if (rest.length) queue.set(k, rest);
  else queue.delete(k);
}
const randomId = () => ("0x" + randomBytes(32).toString("hex")) as Hex;
// Semilla con CSPRNG: Math.random es predecible (xorshift128+); un observador
// podría anticipar semillas futuras y practicarlas offline antes de emparejar.
const randomSeed = () => randomInt(0, 2 ** 31 - 1);

/** El secreto del azar de una partida EN VIVO. Los demás juegos no lo llevan:
 *  siguen con la semilla de siempre. */
function liveSecretFor(game: string): { liveSecret?: string } {
  return isLiveMatch(game, RULES_V[game] ?? 1)
    ? { liveSecret: randomBytes(32).toString("hex") }
    : {};
}

const WAIT_TTL = 60 * 60 * 1000; // 1 hora: un "waiter" abandonado se descarta de la cola

// VENTANA DE ENVÍO: alineada al plazo on-chain (la web abre con playDeadline =
// +2h). Pasada la ventana no se aceptan puntajes: corta la "práctica offline"
// ilimitada con la semilla ya conocida y evita liquidar partidas ya reembolsadas.
export const SUBMIT_WINDOW_MS = Number(process.env.SUBMIT_WINDOW_MS ?? 2 * 60 * 60 * 1000);

// LAS CONDICIONES DE UNA MESA DE PLATA (v2). Antes las elegía la web al
// depositar (+1 h de fondeo, +2 h de juego, desde la hora de SU depósito), y el
// que se unía solo podía revisar que no fueran raras. Ahora las fija el árbitro
// al crear la partida y van firmadas en el asiento de los dos.
//  - Fondeo: la espera de rival (WAIT_TTL) más 10 minutos para que el último en
//    llegar apruebe y se una.
//  - Juego: la ventana de envío; nunca antes que el fondeo (el contrato exige
//    playDeadline > fundDeadline), por si alguien achica SUBMIT_WINDOW_MS.
// Pasado playDeadline + REFUND_GRACE (30 min), cualquiera reembolsa: el árbitro
// decide a más tardar al cerrar la ventana y tiene esa media hora para liquidar.
const FUND_WINDOW_MS = WAIT_TTL + 10 * 60_000;
const PLAY_WINDOW_MS = Math.max(SUBMIT_WINDOW_MS, FUND_WINDOW_MS + 60_000);

/** Las condiciones on-chain de la partida, en segundos. */
function termsOf(m: Match): { fundDeadline: number; playDeadline: number } {
  const t0 = Math.floor(m.createdAt / 1000);
  return {
    fundDeadline: m.fundDeadline ?? t0 + Math.floor(FUND_WINDOW_MS / 1000),
    playDeadline: m.playDeadline ?? t0 + Math.floor(PLAY_WINDOW_MS / 1000),
  };
}

/** Hasta cuándo vale la firma del ganador (segundos): hasta que se abre el
 *  reembolso permissionless, ni un segundo más. Así en ningún momento valen a
 *  la vez el cobro y el reembolso, y la firma guardada en /recover sirve
 *  mientras cobrar sea posible. */
function resultDeadlineOf(m: Match): number {
  return termsOf(m).playDeadline + ESCROW_REFUND_GRACE_S;
}

/** El stake en micro-USDC, igual que la web (`toUsdcUnits`). */
const stakeUnits = (stake: number) => BigInt(Math.round(stake * 1_000_000));

// PERSISTENCIA vía persist.ts (Redis o archivo; opt-in, ver ese módulo).
// Sobrevive a un reinicio del servidor: las partidas en curso vuelven y un
// ganador puede recuperar su firma para cobrar. El debounce y el guardado
// final al entregar la posta (por timbre o por SIGTERM, ver handover.ts) los
// maneja el adaptador.
const store$ = jsonStore("matches");
const FINISHED_TTL = 2 * 24 * 60 * 60 * 1000; // 2 días: purga partidas terminadas viejas

/** Saca una partida de memoria, y con ella los registros de sus intentos en
 *  vivo (live-store.ts), si tenía: sin esto quedarían en el store para siempre. */
function dropMatch(m: Match): void {
  matches.delete(m.id);
  if (m.live) forgetLiveAttempts(m.id, Object.keys(m.live));
}

function serializeMatches(): string {
  const now = Date.now();
  const arr = [...matches.values()].filter((m) => {
    const finished = m.status === "settled" || m.status === "draw";
    return !finished || now - m.createdAt < FINISHED_TTL; // mantené lo vivo y lo reciente
  });
  // El replacer descarta `refundPromise` (no es serializable; es transitorio).
  return JSON.stringify(arr, (k, v) => (k === "refundPromise" ? undefined : v));
}

function persist() {
  store$.save(serializeMatches);
}

/** Restaura las partidas guardadas. La llama index.ts ANTES de escuchar. */
export async function restoreMatches(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    const arr = (JSON.parse(raw) as Match[]).sort((a, b) => a.createdAt - b.createdAt);
    for (const m of arr) {
      matches.set(m.id, m);
      // Lo que vuelve del store ya estaba guardado: su firma puede mostrarse.
      if (m.signature) decisionSaved.add(m.id);
      // Reconstruimos la cola: una partida en espera (sin rival) vuelve a la fila.
      // Un DESAFÍO (target) NUNCA va a la cola general: solo su target lo acepta
      // (lo descubre el runner con pendingChallengesFor). Sin este guard, tras un
      // redeploy un desafío quedaba en la cola gratis y un tercero lo robaba.
      if (m.status === "waiting" && !m.p2 && !m.target) enqueue(qkey(m.game, m.stake), m);
    }
    console.log(`Partidas recuperadas: ${arr.length}`);
  } catch (e) {
    console.error("matches restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}

/** Crea una partida en espera para `address` y la deja en la cola. */
function createWaiting(k: string, game: string, stake: number, address: string) {
  const m: Match = {
    id: randomId(),
    game,
    stake,
    seed: randomSeed(),
    rulesV: RULES_V[game] ?? 1,
    ...liveSecretFor(game),
    p1: address,
    scores: {},
    replays: {},
    createdAt: Date.now(),
    status: "waiting",
  };
  if (stake > 0) Object.assign(m, termsOf(m)); // congeladas desde el nacimiento
  matches.set(m.id, m);
  enqueue(k, m);
  recordMatchCreated(); // métrica: una partida nueva (unirse a una existente no crea otra)
  persist();
  return view(m, address);
}

// DUELOS DIRECTOS (ladder gratis). Un desafío es una partida stake 0 con `target`
// que NO entra en la cola general: solo el agente objetivo la acepta (su runner),
// y expira por CHALLENGE_TTL si no la toma. Cumple "desafiar a quien vos quieras"
// + "que nadie lo robe" + "expira si no se acepta", sin tocar plata.
export const CHALLENGE_TTL = Number(process.env.CHALLENGE_TTL_MS ?? 30 * 60_000);

/** Crea un desafío apuntado a `target` (address de un agente). Devuelve la vista
 *  para `challenger`. La autorización (firma) se hace en la capa de rutas. */
export function createChallenge(game: string, challenger: string, target: string) {
  challenger = normAddr(challenger);
  target = normAddr(target);
  if (!isKnownGame(game)) throw new Error(`unknown game: ${game}`);
  if (challenger === target) throw new Error("cannot challenge yourself");
  const m: Match = {
    id: randomId(),
    game,
    stake: 0,
    seed: randomSeed(),
    rulesV: RULES_V[game] ?? 1,
    ...liveSecretFor(game),
    p1: challenger,
    target,
    scores: {},
    replays: {},
    createdAt: Date.now(),
    status: "waiting",
  };
  matches.set(m.id, m);
  recordMatchCreated();
  persist();
  return view(m, challenger);
}

/** El agente objetivo acepta un desafío dirigido a él. In-process (lo llama su
 *  runner): solo el target entra, un tercero o el propio challenger es rechazado. */
export function acceptChallenge(matchId: string, joiner: string) {
  joiner = normAddr(joiner);
  const m = matches.get(matchId);
  if (!m) throw new Error("match not found");
  if (!m.target) throw new Error("not a challenge");
  if (m.status !== "waiting" || m.p2) throw new Error("challenge not open");
  if (joiner !== m.target) throw new Error("not the challenged rival");
  if (joiner === m.p1) throw new Error("cannot accept your own challenge");
  m.p2 = joiner;
  m.status = "ready";
  persist();
  return view(m, joiner);
}

/** Desafíos en espera dirigidos a `address` (sin rival aún, no vencidos). */
export function pendingChallengesFor(address: string): { matchId: string; game: string }[] {
  address = normAddr(address);
  const now = Date.now();
  const out: { matchId: string; game: string }[] = [];
  for (const m of matches.values()) {
    if (
      m.target === address &&
      !m.p2 &&
      m.status === "waiting" &&
      now - m.createdAt <= CHALLENGE_TTL
    ) {
      out.push({ matchId: m.id, game: m.game });
    }
  }
  return out;
}

/** Firma opcional del emparejamiento: { signature, ts } (ver matchmakeAuthMessage). */
export interface MatchmakeAuth {
  signature: string;
  ts: number;
}

/** Adjunta el asiento firmado a la vista si es una mesa de plata con escrow
 *  activo y `address` es uno de los jugadores. Firma con la llave del árbitro
 *  (mismo dominio EIP-712 que el resultado) las condiciones que la vista ya
 *  trae (`fundDeadline`, `playDeadline`, el stake); el contrato lo exige en
 *  open/join. En dev/tests sin escrow (onchainEnabled=false) es un no-op: la
 *  vista no cambia y no se toca la llave. */
async function attachSeat(v: MatchView, address: string): Promise<MatchView> {
  if (
    v.stake > 0 &&
    onchainEnabled() &&
    (v.role === "p1" || v.role === "p2") &&
    v.fundDeadline !== undefined &&
    v.playDeadline !== undefined
  ) {
    v.seatSig = await signSeat(v.matchId, address as Hex, {
      stake: stakeUnits(v.stake),
      fundDeadline: BigInt(v.fundDeadline),
      playDeadline: BigInt(v.playDeadline),
    });
  }
  return v;
}

export async function matchmake(
  game: string,
  stake: number,
  address: string,
  auth?: MatchmakeAuth,
) {
  address = normAddr(address);
  // Default-deny: solo se emparejan juegos que el árbitro sabe verificar.
  if (!isKnownGame(game)) throw new Error(`unknown game: ${game}`);
  // Solo mesas permitidas (las mismas que el contrato) o la LADDER GRATIS
  // (stake 0): partidas rankeadas sin depósito, donde juegan los agentes
  // hosteados y cualquier humano que quiera ELO sin arriesgar plata.
  if (stake !== 0 && !STAKES_ALLOWED.includes(stake)) {
    throw new Error(`stake not allowed: ${stake} (mesas: 0, ${STAKES_ALLOWED.join(", ")})`);
  }
  // Ni un asiento firmado mientras el escrow no esté verificado contra la
  // cadena (escrow-check.ts): con la red o el rol equivocados, la gente
  // depositaría y ninguna firma del árbitro serviría para pagarle.
  if (stake !== 0 && onchainEnabled()) {
    const closed = paidTableClosed(stake);
    if (closed) throw new Error(closed);
  }

  // AUTENTICACIÓN del emparejamiento (mismo criterio que el envío de puntaje):
  // el jugador firma "quiero emparejar" con su wallet. Sin esto, cualquiera
  // encola direcciones AJENAS (suplantación) o llena la cola de rivales fantasma
  // que nunca depositan (el rival real deposita y pierde tiempo y gas).
  if (auth?.signature) {
    const ts = Number(auth.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MATCHMAKE_AUTH_TTL_MS) {
      throw new Error("auth expired");
    }
    const signer = await recoverMessageAddress({
      message: matchmakeAuthMessage(game, stake, address, ts),
      signature: auth.signature as Hex,
    });
    if (signer.toLowerCase() !== address) throw new Error("bad signature");
  } else if (AUTH_REQUIRED) {
    throw new Error("signature required");
  }

  const k = qkey(game, stake);
  pruneQueue(k);

  // El mismo jugador re-consulta su espera: devolvemos su partida
  // (idempotente). En una mesa de plata, si todavía no abrió en la cadena y
  // otro ya depositó, mejor sentarlo con ese (abajo): la web vuelve a
  // preguntar justo antes de depositar, así dos que llegan casi a la vez no
  // terminan cada uno en su partida esperando un tercero.
  const mine = queued(k).find((w) => w.p1 === address);
  if (mine) {
    const own = await waiterState(mine);
    if (own === "pairable" || own === "gone") return attachSeat(view(mine, address), address);
  }

  // Hay rivales esperando: emparejamos con el primero (orden de llegada) que
  // se pueda. Cada jugador abre/se une on-chain por su cuenta -> el árbitro no
  // crea la partida ni paga gas.
  const rivals = queued(k)
    .filter((w) => w.p1 !== address)
    .slice(0, MAX_WAITERS_CHECKED);
  for (const w of rivals) {
    const state = await waiterState(w);
    // Mientras se leía la cadena, otro pudo sentarse en esta misma partida.
    if (w.p2 || w.status !== "waiting" || !matches.has(w.id)) continue;
    if (state === "ghost") {
      // Nunca abrió: sale de la fila (y no traba a nadie más). No se borra:
      // si abre tarde, el barrendero la reembolsa al vencer la espera.
      unqueue(k, w.id);
      continue;
    }
    if (state !== "pairable") continue;
    if (mine) unqueue(k, mine.id); // ídem: si abre tarde, el barrendero la reembolsa
    w.p2 = address;
    w.status = "ready";
    w.pairedAt = Date.now();
    unqueue(k, w.id);
    persist();
    return attachSeat(view(w, address), address);
  }

  if (mine) return attachSeat(view(mine, address), address);
  // Nadie con quien sentarse: creamos la partida y quedamos a la espera.
  return attachSeat(createWaiting(k, game, stake, address), address);
}

/** Cuántas esperas mira la cadena por cada pedido de emparejamiento: la fila
 *  de una mesa de plata puede juntar varias sin abrir (W3), y cada una es una
 *  lectura. */
const MAX_WAITERS_CHECKED = 5;

/** RIVAL FANTASMA (W3, pre-auditoría F1): cuánto puede tardar en abrir en la
 *  cadena el que crea una partida en una mesa de plata. Firmar el
 *  emparejamiento es gratis: sin esto, una wallet que nunca depositaba quedaba
 *  primera en la fila, el que llegaba se emparejaba con ella y su `join`
 *  revertía ("not open"). Ahora solo se empareja con quien ya abrió; el que
 *  no abrió en este plazo sale de la fila. */
export const OPEN_GRACE_MS = 10 * 60_000;

/** RIVAL FANTASMA (W3, pre-auditoría F1): cuánto tiene el p2 de una mesa de
 *  plata para unirse en la cadena desde que se sentó. Antes, uno que se sentaba
 *  y no depositaba trababa el stake del que abrió hasta el reembolso (70 min) o
 *  la cancelación (2 h 15 m), con su intento ya jugado. Ahora, pasado este
 *  plazo, se libera su lugar y la partida vuelve a la fila. Cabe en el margen
 *  de `FUND_WINDOW_MS` sobre `WAIT_TTL`: el último p2 posible tiene el mismo
 *  tiempo antes de que venza el fondeo. */
export const JOIN_WINDOW_MS = 10 * 60_000;

/** Limpia la fila de una mesa: lo que ya no puede emparejarse sale. */
function pruneQueue(k: string, now = Date.now()): void {
  for (const w of queued(k)) {
    // Ya emparejada, o la espera venció (WAIT_TTL). Una vencida no se borra
    // acá: el barrendero la cancela en la cadena si hubo depósito (F8).
    if (w.p2 || w.status !== "waiting" || now - w.createdAt > WAIT_TTL) unqueue(k, w.id);
    // Una espera nacida con OTRAS reglas (el deploy que subió la versión del
    // juego la restauró en la fila) ya no puede terminarse: el envío exige las
    // reglas vigentes. Emparejarla haría jugar una partida entera a quien llega
    // para que le rechacen el puntaje. Sale de la fila pero NO se borra: el
    // barrendero la vence al WAIT_TTL y, si hubo depósito, la reembolsa.
    else if ((w.rulesV ?? 1) !== (RULES_V[w.game] ?? 1)) unqueue(k, w.id);
  }
  // Las ids que ya no están en memoria.
  const ids = queue.get(k);
  if (ids?.some((id) => !matches.has(id))) {
    const rest = ids.filter((id) => matches.has(id));
    if (rest.length) queue.set(k, rest);
    else queue.delete(k);
  }
}

/** ¿Se puede emparejar con esta espera? Sin plata, siempre. En una mesa de
 *  plata, solo si su `open` ya está en la cadena:
 *   - "pairable": abrió (o no hay escrow de por medio);
 *   - "pending": todavía no abrió y está a tiempo, o la cadena no contestó;
 *   - "ghost": no abrió en `OPEN_GRACE_MS`, o la partida ya cerró en la cadena;
 *   - "gone": se unió un p2 cuyo lugar se había liberado (W3): vuelve a ser suyo. */
async function waiterState(
  w: Match,
  now = Date.now(),
): Promise<"pairable" | "pending" | "ghost" | "gone"> {
  if (!paidOnchain(w)) return "pairable";
  if (w.openConfirmed && !w.revokedSeats?.length) return "pairable";
  let c: OnchainMatch | null;
  try {
    c = await escrowChain().read(w.id);
  } catch (e) {
    console.error(`[fila] ${w.id}: no se pudo leer la partida:`, (e as Error).message);
    return "pending";
  }
  if (reclaimFromChain(w, c)) return "gone";
  const p1 = (c?.p1 ?? "").toLowerCase();
  if (p1 === w.p1 && (c!.status === ONCHAIN_STATUS.Open || c!.status === ONCHAIN_STATUS.Funded)) {
    w.openConfirmed = true;
    return "pairable";
  }
  if (!c || c.status === ONCHAIN_STATUS.None) {
    return now - w.createdAt < OPEN_GRACE_MS ? "pending" : "ghost";
  }
  return "ghost"; // Settled, Refunded o un p1 que no es el nuestro
}

/** Si en la cadena se unió un p2 cuyo lugar el árbitro había liberado (W3), la
 *  cadena manda: vuelve a ser el p2, aunque ya hubiera otro sentado (ese no
 *  llegó a depositar: su `join` revierte). Devuelve si cambió algo. */
function reclaimFromChain(m: Match, c: OnchainMatch | null): boolean {
  if (!c || c.status !== ONCHAIN_STATUS.Funded) return false;
  const p2 = (c.p2 ?? "").toLowerCase();
  if (p2 === m.p2 || !m.revokedSeats?.includes(p2)) return false;
  console.log(`[fila] ${m.id}: se unió ${p2}, que había perdido su lugar; vuelve a ser el p2`);
  m.p2 = p2;
  m.revokedSeats = m.revokedSeats.filter((a) => a !== p2);
  m.joinConfirmed = true;
  m.pairedAt ??= Date.now();
  if (m.status === "waiting") m.status = "ready";
  unqueue(qkey(m.game, m.stake), m.id);
  persist();
  return true;
}

/** Un p2 al que se le liberó el lugar (W3) y que se unió igual en la cadena
 *  pide jugar: si la cadena lo confirma, vuelve a ser el p2. Lo usan el envío
 *  de puntaje y la apertura de un intento en vivo, antes de "not a player". */
export async function reclaimSeat(id: string, address: string): Promise<void> {
  const m = matches.get(id);
  address = normAddr(address);
  if (!m || !paidOnchain(m) || !m.revokedSeats?.includes(address)) return;
  const c = await escrowChain()
    .read(m.id)
    .catch(() => null);
  reclaimFromChain(m, c);
}

/** LIBERAR AL QUE ABRIÓ (W3): el p2 de una mesa de plata que no se unió en la
 *  cadena en `JOIN_WINDOW_MS` pierde el lugar, y la partida vuelve a la fila
 *  para el próximo. Si la cadena ya la muestra fondeada, queda confirmada. Lo
 *  corre el barrendero; si la cadena no contesta, el próximo barrido reintenta. */
async function checkJoin(m: Match, now: number): Promise<void> {
  const c = await escrowChain().read(m.id);
  if (reclaimFromChain(m, c) || isDecided(m)) return;
  const k = qkey(m.game, m.stake);
  if (m.status === "waiting" && !m.p2) {
    // Ya liberada: solo se miraba si se unió alguno de los que la perdieron.
    return;
  }
  if (!m.p2 || m.status !== "ready") return;
  if (c?.status === ONCHAIN_STATUS.Funded) {
    m.joinConfirmed = true;
    persist();
    return;
  }
  if (c?.status !== ONCHAIN_STATUS.Open || (m.pairedAt ?? now) + JOIN_WINDOW_MS > now) return;
  // Sigue abierta y el p2 no se unió: pierde el lugar. Sin depósito no pudo
  // presentar puntaje ni abrir un intento en vivo (los dos lo exigen).
  if (m.scores[m.p2] !== undefined || m.live?.[m.p2]) return;
  console.log(`[fila] ${m.id}: ${m.p2} no se unió a tiempo; la partida vuelve a la fila`);
  m.revokedSeats = [...(m.revokedSeats ?? []), m.p2];
  m.p2 = undefined;
  m.pairedAt = undefined;
  m.status = "waiting";
  m.openConfirmed = true;
  if (now - m.createdAt <= WAIT_TTL) enqueue(k, m);
  persist();
}

/** ¿Ya se decidió? En función aparte a propósito: después de un `await`, TS
 *  sigue creyendo el estado que vio antes, y justo ese estado pudo cambiar. */
const isDecided = (m: Match) => m.status === "settled" || m.status === "draw";

export async function submitScore(
  id: string,
  address: string,
  score: number,
  replay?: unknown,
  signature?: string,
) {
  address = normAddr(address);
  const m = matches.get(id);
  if (!m) throw new Error("match not found");
  if (address !== m.p1 && address !== m.p2) await reclaimSeat(id, address);
  if (address !== m.p1 && address !== m.p2) throw new Error("not a player");

  // Una partida ya decidida (pagada, empatada o expirada) no acepta más envíos.
  if (m.status === "settled" || m.status === "draw") throw new Error("match already decided");

  // VENTANA DE ENVÍO: pasado el plazo de juego, la partida se reembolsa (igual
  // que on-chain con refundExpired); no se aceptan puntajes tardíos.
  if (Date.now() - m.createdAt > SUBMIT_WINDOW_MS) throw new Error("match expired");

  // AUTENTICACION: el jugador firma su envio con la wallet -> probamos que
  // controla su direccion. Si se exige (REQUIRE_AUTH) y no hay firma, se rechaza.
  if (signature) {
    const signer = await recoverMessageAddress({
      message: scoreAuthMessage(id, address, score),
      signature: signature as Hex,
    });
    if (signer.toLowerCase() !== address.toLowerCase()) {
      throw new Error("bad signature");
    }
  } else if (AUTH_REQUIRED) {
    throw new Error("signature required");
  }

  // UN INTENTO POR JUGADOR: el puntaje se "congela" en el primer envío válido.
  // Sin esto, el primero en enviar podría reintentar hasta sacar su mejor marca
  // (ventaja desleal: el rival, al enviar, cierra la partida y no puede repetir).
  if (m.scores[address] !== undefined) throw new Error("score already submitted");

  // ANTI-FLOOD: el candado de arriba solo se arma cuando la verificación sale
  // BIEN, así que un replay que NO verifica se podía reenviar para siempre —
  // cada intento re-simula el juego entero y bloquea el hilo de Node. Tres
  // fallidas y este jugador se quedó sin intento en esta partida.
  const fallidas = m.failedAttempts?.[address] ?? 0;
  if (fallidas >= MAX_FAILED_VERIFICATIONS) {
    throw new Error("too many failed verifications for this match");
  }

  // ¿DEPOSITÓ DE VERDAD? El árbitro nunca miraba la cadena: emparejaba, aceptaba
  // puntajes y firmaba resultados sin saber si había plata de por medio. Un
  // atacante encolaba wallets recién generadas en las mesas de plata (solo
  // cuesta una firma), no depositaba nunca, y cada humano que sí depositó
  // quedaba con la plata trabada hasta que venciera el plazo.
  //
  // Se chequea que la dirección figure como p1 o p2 EN EL CONTRATO: solo se
  // llega a serlo depositando (open/join transfieren la apuesta). No se exige
  // status Funded porque el modelo es asincrónico — el primero juega y envía su
  // puntaje antes de que exista rival, con la partida todavía en Open.
  await assertDepositOnchain(m, address);

  // SE VUELVE A MIRAR DESPUÉS DE LA CADENA: mientras se leía el depósito, la
  // partida pudo decidirse, o este mismo jugador pudo mandar otro envío o
  // cerrar su intento en vivo. Sin esto, el envío que llegaba tarde pisaba un
  // puntaje ya guardado (y hasta el replay de una victoria ya firmada).
  if (isDecided(m)) throw new Error("match already decided");
  if (m.scores[address] !== undefined) throw new Error("score already submitted");

  // PARTIDA EN VIVO: el puntaje lo pone el árbitro al terminar el intento
  // (live.ts), nunca un replay armado afuera: con la semilla oculta no hay
  // replay honesto que mandar. Solo queda la RENDICIÓN (puntaje 0, sin jugadas y
  // sin semilla), que ya usan la web y el runner, y cierra el intento con 0.
  // `flaps` es de Flappy, el único juego en vivo del piloto.
  if (isLiveMatch(m.game, m.rulesV)) {
    const currentV = RULES_V[m.game] ?? 1;
    if ((m.rulesV ?? 1) !== currentV) {
      throw new Error(
        `rules version mismatch (match v${m.rulesV ?? 1}, arbiter v${currentV}) — update @arcade1v1/mcp`,
      );
    }
    const r = (replay ?? {}) as { seed?: unknown; ticks?: unknown; flaps?: unknown; v?: unknown };
    const isForfeit =
      score === 0 &&
      r.seed === undefined &&
      r.ticks === 0 &&
      Array.isArray(r.flaps) &&
      r.flaps.length === 0 &&
      r.v === currentV;
    if (!isForfeit) {
      throw new Error(
        `replay not allowed: ${m.game} is live — play through /match/:id/live/start and /live/commit`,
      );
    }
    // Mismo cerrojo y mismo guardado que un cierre desde live.ts: la rendición
    // cierra el intento, y un intento cerrado sale guardado (live-store.ts).
    return withLiveLock(m.id, address, async () => {
      if (m.scores[address] !== undefined) throw new Error("score already submitted");
      m.live ??= {};
      const prev = m.live[address];
      if (prev?.over) {
        // Ya lo había cerrado el juego y se cortó antes de anotar el puntaje
        // (no se pudo guardar): vale ese cierre, no la rendición.
        await saveLiveAttempt(m.id, address, prev);
        await finishLiveAttempt(m, address, prev.score ?? 0, {
          ticks: prev.tick,
          flaps: [...prev.flaps],
          v: currentV,
        });
        return view(m, address, { revealOwnScore: true });
      }
      const closed: LiveAttempt = {
        tokenHash: prev?.tokenHash ?? "",
        startedAt: prev?.startedAt ?? Date.now(),
        tick: prev?.tick ?? 0,
        flaps: prev?.flaps ?? [],
        revealed: prev?.revealed ?? 0,
        over: true,
        score: 0,
      };
      await saveLiveAttempt(m.id, address, closed);
      m.live[address] = closed;
      await finishLiveAttempt(m, address, 0, { ticks: 0, flaps: [], v: currentV });
      return view(m, address, { revealOwnScore: true });
    });
  }

  let finalScore = Math.max(0, Math.floor(score));

  // ANTI-TRAMPA (default-deny): TODO juego debe tener verificador. Re-jugamos el
  // replay y exigimos que el puntaje declarado coincida con el verificado. Si el
  // juego es desconocido o el replay no valida/no coincide, se rechaza: nunca se
  // confía en un puntaje sin re-jugarlo. Todo rechazo de este bloque cuenta como
  // "verificación rechazada" en las métricas (el catch incrementa y re-lanza).
  try {
    // VERSIÓN DE REGLAS (corte seco con dignidad): un cliente con el paquete
    // viejo simula OTRAS reglas — su replay jamás verificaría. Rechazamos
    // ANTES de re-simular, con el motivo real y el remedio, nunca un
    // "score mismatch" críptico. Cubre también partidas nacidas pre-deploy.
    const currentV = RULES_V[m.game] ?? 1;
    const matchV = m.rulesV ?? 1;
    const replayV = (replay as { v?: unknown })?.v ?? 1;
    if (matchV !== currentV || replayV !== currentV) {
      throw new Error(
        `rules version mismatch (match v${matchV}, replay v${String(replayV)}, arbiter v${currentV}) — update @arcade1v1/mcp`,
      );
    }
    const verifier = VERIFIERS[m.game];
    if (!verifier) throw new Error(`unknown game: ${m.game}`);
    if (!verifier.valid(replay)) throw new Error("replay required");
    // ANTI-DoS: cortar replays absurdamente largos ANTES de re-jugarlos (ver helper).
    if (replayTooLong(replay)) throw new Error("replay too long");
    // ANTI-TRAMPA (semilla): el replay debe declarar EXACTAMENTE la semilla de la
    // partida. Sin esto, un jugador probaría muchas semillas offline y mandaría una
    // favorable (eligiendo el "azar" a su gusto) -> ganaría con dinero real de forma
    // desleal. Además forzamos la semilla real al re-jugar: el árbitro manda sobre el
    // azar, nunca el cliente.
    const replaySeed = (replay as { seed?: unknown }).seed;
    if (replaySeed !== m.seed) {
      throw new Error(`seed mismatch (expected ${m.seed}, got ${String(replaySeed)})`);
    }
    const verified = verifier.verify({ ...(replay as object), seed: m.seed });
    if (verified !== finalScore) {
      throw new Error(`score mismatch (claimed ${finalScore}, verified ${verified})`);
    }
    finalScore = verified;
  } catch (e) {
    recordVerificationRejected();
    m.failedAttempts ??= {};
    m.failedAttempts[address] = (m.failedAttempts[address] ?? 0) + 1;
    persist();
    throw e;
  }

  m.scores[address] = finalScore;
  m.replays[address] = replay; // guardamos el replay (feedback para el rival/agente)
  await settleIfReady(m);
  persist();
  // El que envía probó ser dueño de `address` (firma verificada arriba en prod):
  // su propia respuesta puede confirmarle su puntaje aunque no se haya decidido.
  return view(m, address, { revealOwnScore: true });
}

/** ¿Depositó de verdad? Solo mesas de plata con escrow activo. Lo usan el envío
 *  de puntaje y la apertura de un intento en vivo. Tira el motivo si no. */
export async function assertDepositOnchain(
  m: { id: string; stake: number },
  address: string,
): Promise<void> {
  if (m.stake <= 0 || !onchainEnabled()) return;
  let enCadena;
  try {
    enCadena = await escrowChain().read(m.id as Hex);
  } catch (e) {
    // El nodo no respondió. No aceptamos a ciegas con plata en juego: se pide
    // reintentar, que es recuperable, en vez de seguir sin poder verificar.
    console.error("[onchain] no se pudo leer la partida:", (e as Error).message);
    throw new Error("could not verify your deposit on-chain — retry in a moment", { cause: e });
  }
  const motivo = razonRechazoDeposito(enCadena, address);
  if (motivo) throw new Error(motivo);
}

/** ¿`address` ya tiene puntaje en la partida? Es para el runner, que no puede
 *  saberlo por la vista: no muestra puntajes hasta decidir (anti-espionaje). */
export function hasSubmittedScore(id: string, address: string): boolean {
  return matches.get(id)?.scores[address.toLowerCase()] !== undefined;
}

// ---- Para live.ts (partidas en vivo) ----------------------------------------

/** La partida en memoria, no una vista: live.ts trabaja sobre su intento. */
export function matchRecord(id: string): Match | undefined {
  return matches.get(id);
}

/** Guarda las partidas (con el debounce de siempre). */
export function persistMatches(): void {
  persist();
}

/** Cierra el intento en vivo de `address` con su puntaje y su replay, y liquida
 *  si ya están los dos. */
export async function finishLiveAttempt(
  m: Match,
  address: string,
  score: number,
  replay: unknown,
): Promise<void> {
  m.scores[address] = score;
  m.replays[address] = replay;
  await settleIfReady(m);
  persist();
}

/** Si ya estan los dos puntajes, decide el ganador y firma (o marca empate). */
async function settleIfReady(m: Match) {
  if (
    !m.p2 ||
    m.scores[m.p1] === undefined ||
    m.scores[m.p2] === undefined ||
    (m.status !== "ready" && m.status !== "waiting")
  ) {
    return;
  }
  const s1 = m.scores[m.p1];
  const s2 = m.scores[m.p2];
  await decide(m, s1 === s2 ? null : s1 > s2 ? m.p1 : m.p2);
}

/** Decide la partida: `winner` null es empate (reembolso). Firma, rating y,
 *  en una mesa de plata, la liquidación. Corre una sola vez por partida: quien
 *  la llama ya comprobó que no estaba decidida. */
async function decide(m: Match, winner: string | null) {
  if (winner === null) {
    m.status = "draw";
    m.outcome = "draw"; // empate -> reembolso (el arbitro cancela en el contrato)
    requestRefund(m);
  } else {
    m.winner = winner;
    m.outcome = winner === m.p1 ? "p1" : "p2";
    // El status se marca ANTES del await: durante la firma (async) una
    // invocación concurrente pasaría el guard de arriba y liquidaría dos veces.
    m.status = "settled";
    m.signatureDeadline = resultDeadlineOf(m);
    m.signature = await signResult(m.id, winner as Hex, BigInt(m.signatureDeadline));
  }

  // Rating ELO + métrica de partidas decididas (las de bot de prueba no cuentan,
  // igual criterio que el ELO). Una sola vez por partida: settleIfReady y
  // expireMatch llegan acá solo si no estaba decidida.
  if (!m.isBot && m.p2 && m.outcome) {
    m.eloUpdate = applyElo(m.game, m.p1, m.p2, m.outcome);
    // Embudo: cuántos de los dos son agentes de la casa (0=terceros puros,
    // 1=tercero vs casa, 2=casa vs casa). El checker lo inyecta index.ts:
    // matchmaking no puede importar agents.ts (agents ya importa de acá).
    const houseSide = (houseAddressCheck(m.p1) ? 1 : 0) + (houseAddressCheck(m.p2) ? 1 : 0);
    recordMatchSettled(houseSide as 0 | 1 | 2);
  }

  // Mesa de plata: la firma recién hecha se guarda antes de salir por ningún
  // lado (vista o transacción), y el árbitro la presenta él mismo.
  if (needsSettle(m)) {
    await saveDecision(m);
    void kickSettle(m);
  }
}

// Checker de "¿esta address es un agente de la casa?" — inyectado desde
// index.ts al arrancar (default: nadie es casa, p. ej. en tests unitarios).
let houseAddressCheck: (address: string) => boolean = () => false;
export function setHouseAddressCheck(fn: (address: string) => boolean) {
  houseAddressCheck = fn;
}

// ------------------------------------------------------------------------- //
// LA PLATA DE UNA PARTIDA DECIDIDA (mesas de plata, v2).
//
// 1) NINGUNA FIRMA SALE ANTES DE QUEDAR GUARDADA. Las partidas se guardan con
//    debounce (persist.ts: hasta 20 s). Si el árbitro mostraba la firma del
//    ganador y se caía antes de guardar, volvía sin la decisión: el último
//    envío se podía repetir con otra corrida y salía OTRA firma, con otro
//    ganador, igual de válida (C5 en docs/MAINNET.md). Ahora la decisión de una
//    mesa de plata se guarda en el acto, y recién entonces la firma aparece en
//    la vista o viaja en una transacción (el mempool es público). Si no se
//    puede guardar, la firma espera: el barrendero lo reintenta.
// 2) LIQUIDA EL ÁRBITRO. Antes cobraba el ganador desde la web; si no lo hacía
//    antes de playDeadline + 30 min, cualquiera —el perdedor incluido— pedía
//    refundExpired y el premio se volvía reembolso (C9). Ahora el árbitro
//    presenta la firma apenas queda guardada, con reintentos y backoff. La web
//    todavía puede presentarla (settle es permissionless): si se adelanta, el
//    árbitro lo ve en la cadena y no insiste.
// ------------------------------------------------------------------------- //

/** Decisiones de mesas de plata que ya quedaron guardadas: su firma puede salir. */
const decisionSaved = new Set<string>();
/** Liquidaciones en vuelo, una por partida (`onchainSettled` las espera). */
const settling = new Map<string, Promise<void>>();

/** ¿Hay escrow de por medio? Solo ahí la firma del resultado vale plata. */
const paidOnchain = (m: Match) => m.stake > 0 && onchainEnabled();

function signatureVisible(m: Match): boolean {
  return !!m.signature && (!paidOnchain(m) || decisionSaved.has(m.id));
}

/** Guarda YA la decisión (el store de partidas es uno solo: van todas). Nunca
 *  tira: si no se pudo guardar, la firma todavía no sale y listo. */
async function saveDecision(m: Match): Promise<boolean> {
  if (decisionSaved.has(m.id)) return true;
  try {
    persist();
    await store$.flush();
    decisionSaved.add(m.id);
    return true;
  } catch (e) {
    console.error(
      `[settle] ${m.id}: la decisión no se pudo guardar, la firma espera:`,
      (e as Error).message,
    );
    return false;
  }
}

/** ¿Es una mesa de plata decidida que el árbitro todavía tiene que liquidar?
 *  Solo las firmadas por este código (llevan `signatureDeadline`): una partida
 *  que decidió el árbitro anterior tiene una firma de la v1 del contrato, que el
 *  v2 no acepta, y la cobró el ganador desde la web. Sin este filtro, el primer
 *  arranque contra el contrato nuevo intentaba liquidar en él las partidas de
 *  los últimos dos días, que no existen ahí. */
function needsSettle(m: Match): boolean {
  return (
    paidOnchain(m) &&
    m.status === "settled" &&
    !!m.winner &&
    !!m.signature &&
    m.signatureDeadline !== undefined &&
    !m.settleTx &&
    !m.settleOutcome
  );
}

/** Espera entre intentos: 15 s, 30 s, 1 min, 2 min, 4 min y de ahí 5 min. */
export function settleBackoffMs(attempts: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

/** Liquida (o reintenta liquidar) una mesa de plata decidida: una sola vez a la
 *  vez por partida, y respetando el backoff. */
function kickSettle(m: Match, now = Date.now()): Promise<void> {
  if (!needsSettle(m)) return Promise.resolve();
  const running = settling.get(m.id);
  if (running) return running;
  if ((m.nextSettleAt ?? 0) > now) return Promise.resolve();
  const p = settleOnchain(m, now).finally(() => settling.delete(m.id));
  settling.set(m.id, p);
  return p;
}

async function settleOnchain(m: Match, now: number): Promise<void> {
  const chain = escrowChain();
  const deadline = m.signatureDeadline!; // needsSettle lo exige
  try {
    if (!(await saveDecision(m))) throw new Error("the decision is not saved yet");
    if (Math.floor(now / 1000) > deadline) {
      await closeExpired(m);
    } else {
      m.settleTx = await chain.settle(m.id, m.winner as Hex, BigInt(deadline), m.signature as Hex);
      m.settleAttempts = undefined;
      m.nextSettleAt = undefined;
      console.log(`[settle] ${m.id}: liquidada por el árbitro (tx ${m.settleTx})`);
    }
  } catch (e) {
    // Qué pasó lo dice la cadena, no el error: si otro presentó la firma (el
    // ganador desde la web) o la partida ya se reembolsó, no queda nada por
    // hacer. Si sigue Funded (RPC caído, árbitro sin gas), se reintenta.
    const c = await chain.read(m.id).catch(() => null);
    if (c?.status === ONCHAIN_STATUS.Settled) m.settleOutcome = "external";
    else if (c?.status === ONCHAIN_STATUS.Refunded) {
      m.settleOutcome = "refunded";
      m.refund = "done";
    } else {
      m.settleAttempts = (m.settleAttempts ?? 0) + 1;
      m.nextSettleAt = now + settleBackoffMs(m.settleAttempts);
      console.error(
        `[settle] ${m.id}: intento ${m.settleAttempts} falló, se reintenta:`,
        (e as Error).message,
      );
    }
  }
  persist();
}

/** La firma venció sin haberse podido presentar. Desde ahí el contrato solo
 *  reembolsa (refundExpired, para cualquiera): si nadie lo hizo todavía, lo
 *  hace el árbitro, como con una partida vencida. Si la lectura falla, tira y
 *  vuelve al backoff. */
async function closeExpired(m: Match): Promise<void> {
  const c = await escrowChain().read(m.id);
  if (c?.status === ONCHAIN_STATUS.Settled) m.settleOutcome = "external";
  else if (c?.status === ONCHAIN_STATUS.Refunded) m.settleOutcome = "refunded";
  else {
    m.settleOutcome = "expired";
    console.error(`[settle] ${m.id}: la firma venció sin presentarse; se reembolsa`);
    requestRefund(m);
  }
}

// ------------------------------------------------------------------------- //
// REEMBOLSOS QUE SE CONFIRMAN (W4; pre-auditoría F2). Antes el reembolso era un
// solo intento (el cancel con sus 3 reintentos de 2 s): si el RPC fallaba unos
// segundos, nadie lo volvía a intentar y la web igual decía "reembolsado". La
// plata no se perdía —`refundUnfunded`/`refundExpired` son permissionless—,
// pero quedaba trabada hasta que alguien descubriera /recover. Ahora se
// reintenta con el mismo backoff que el `settle` hasta que la cadena diga
// Refunded, y la vista dice "done" recién entonces. Solo con plata: una
// partida gratis no tiene nada que cancelar (antes igual simulaba un cancel en
// la cola de los pagos, F11).
// ------------------------------------------------------------------------- //

/** Reembolsos en vuelo, uno por partida (`onchainSettled` los espera). */
const refunding = new Map<string, Promise<void>>();

/** Pide el reembolso de una mesa de plata (una sola vez por partida). */
function requestRefund(m: Match): void {
  if (!paidOnchain(m) || m.refund) return;
  m.refund = "pending";
  m.refundPromise = kickRefund(m);
}

/** Manda (o reintenta) el reembolso: uno a la vez por partida, respetando el
 *  backoff. */
function kickRefund(m: Match, now = Date.now()): Promise<void> {
  if (m.refund !== "pending") return Promise.resolve();
  const running = refunding.get(m.id);
  if (running) return running;
  if ((m.nextRefundAt ?? 0) > now) return Promise.resolve();
  const p = refundOnchain(m, now).finally(() => refunding.delete(m.id));
  refunding.set(m.id, p);
  m.refundPromise = p;
  return p;
}

async function refundOnchain(m: Match, now: number): Promise<void> {
  const chain = escrowChain();
  try {
    await chain.cancel(m.id);
    m.refund = "done";
  } catch (e) {
    // Qué pasó lo dice la cadena, no el error: si ya se reembolsó (otro pidió
    // refundUnfunded/refundExpired, o un cancel anterior que se minó tarde),
    // está hecho; si nadie depositó, no hay nada que devolver; si sigue Open o
    // Funded (RPC caído, árbitro sin gas), se reintenta.
    const c = await chain.read(m.id).catch(() => null);
    if (c?.status === ONCHAIN_STATUS.Refunded) m.refund = "done";
    else if (c?.status === ONCHAIN_STATUS.None) m.refund = "none";
    else if (c?.status === ONCHAIN_STATUS.Settled) {
      // La firma de un ganador entró antes de vencer: la cobró él.
      m.refund = "none";
      if (m.settleOutcome === "expired") m.settleOutcome = "external";
    } else {
      m.refundAttempts = (m.refundAttempts ?? 0) + 1;
      m.nextRefundAt = now + settleBackoffMs(m.refundAttempts);
      console.error(
        `[reembolso] ${m.id}: intento ${m.refundAttempts} falló, se reintenta:`,
        (e as Error).message,
      );
      persist();
      return;
    }
  }
  m.refundAttempts = undefined;
  m.nextRefundAt = undefined;
  persist();
}

/** Pruebas en solitario: completa la partida con un "bot" y la liquida. */
export async function addBot(id: string) {
  const m = matches.get(id);
  if (!m) throw new Error("match not found");
  if (m.p2) return view(m, m.p1); // ya tiene rival real
  m.p2 = BOT;
  m.isBot = true;
  // Sacarla de la cola SOLO si la cola apunta a esta partida (otra podría estar
  // esperando con la misma clave juego:mesa; no hay que desencolarla a ella).
  unqueue(qkey(m.game, m.stake), m.id);
  const p1score = m.scores[m.p1];
  m.scores[BOT] =
    p1score !== undefined
      ? Math.max(0, Math.round(p1score * (0.6 + Math.random() * 0.9)))
      : Math.floor(Math.random() * 1000);
  if (m.status === "waiting") m.status = "ready";
  await settleIfReady(m); // si el jugador ya envio su puntaje, liquida ahora
  persist();
  return view(m, m.p1);
}

/** Espera a que se resuelva lo on-chain que dejó la decisión: el reembolso del
 *  empate o la liquidación que manda el árbitro (si aplica). */
export async function onchainSettled(id: string): Promise<void> {
  await expiring.get(id);
  await Promise.all([matches.get(id)?.refundPromise, settling.get(id), refunding.get(id)]);
}

export function getMatch(id: string, address?: string) {
  const m = matches.get(id);
  if (!m) return null;
  return view(m, address ? normAddr(address) : undefined);
}

/** Quién está esperando rival en (juego, mesa), si hay alguien. Lo usa el
 *  runner de agentes hosteados para NO emparejar dos agentes del mismo dueño
 *  (anti inflado de ELO con un "gemelo sacrificable"). */
export function peekWaiterAddress(game: string, stake: number): string | null {
  const waiter = queued(qkey(game, stake)).find(
    (w) => !w.p2 && Date.now() - w.createdAt <= WAIT_TTL,
  );
  return waiter?.p1 ?? null;
}

/** Descarta una partida EN ESPERA (sin rival). Se usa al pausar/borrar un
 *  agente hosteado que quedó en la cola: sin esto, el próximo en emparejar
 *  se juntaba con un "fantasma" que nunca iba a jugar su intento. */
export function dropWaitingMatch(id: string) {
  const m = matches.get(id);
  if (!m || m.p2 || m.status !== "waiting") return;
  unqueue(qkey(m.game, m.stake), m.id);
  dropMatch(m);
  persist();
}

/** PnL neto (en USDC) para `address` segun el resultado. */
function netPnl(m: Match, address: string): number {
  if (m.outcome === "draw" || !m.outcome) return 0; // empate -> reembolso
  const pot = m.stake * 2;
  const fee = (pot * FEE_BPS) / 10000;
  const prize = pot - fee;
  const won = m.winner === address;
  return Math.round((won ? prize - m.stake : -m.stake) * 100) / 100;
}

export interface MatchView {
  matchId: Hex;
  game: string;
  stake: number;
  /** Ausente en los juegos EN VIVO: no usan semilla (ver `secretHash`). */
  seed?: number;
  /** La partida se juega en vivo: /match/:id/live/start y /live/commit. */
  live?: boolean;
  /** Juegos EN VIVO: el SHA-256 del secreto del azar, público desde que se
   *  empareja. Al decidirse llega `secret` y cualquiera comprueba que es el mismo. */
  secretHash?: string;
  /** Juegos EN VIVO, solo con la partida decidida: el secreto del azar, para
   *  re-verificar cada intento con verifyFlappyLive. */
  secret?: string;
  /** Versión de reglas del juego en esta partida (clientes nuevos la validan). */
  rulesV?: number;
  status: Status;
  role?: "p1" | "p2";
  opponent?: string;
  scores: Record<string, number>;
  /** ¿El rival ya envió su intento? (sin revelar el puntaje hasta decidir). */
  rivalSubmitted?: boolean;
  /** ¿Soy el agente DESAFIADO en un duelo directo? (para que el runner no se
   *  comprometa hasta que el retador jugó, evitando la denegación de juego). */
  challengeTarget?: boolean;
  outcome?: "p1" | "p2" | "draw";
  winner?: string;
  /** Quién no presentó su intento a tiempo: ganó el otro, el que sí presentó. */
  noShow?: string;
  /** Firma del resultado. En una mesa de plata la presenta el árbitro (y si
   *  no, el ganador); sale recién cuando la decisión quedó guardada. */
  signature?: Hex;
  /** Hasta cuándo vale `signature` (segundos): va como `deadline` en `settle`. */
  signatureDeadline?: number;
  /** Asiento firmado por el árbitro: autoriza a ESTE jugador a depositar
   *  (open/join) en esta partida, con ESTAS condiciones. Solo presente en mesas
   *  de plata con escrow activo. Ata al rival on-chain: sin él, un tercero
   *  secuestra el slot. */
  seatSig?: Hex;
  /** Mesa de plata: los plazos on-chain que ata el asiento (segundos). `open`
   *  va con estos; `join` los verifica contra los que quedaron guardados. */
  fundDeadline?: number;
  playDeadline?: number;
  /** Mesa de plata: el `settle` que mandó el árbitro. */
  settleTx?: Hex;
  /** Mesa de plata cerrada sin `settle` propio (ver `Match.settleOutcome`). */
  settleOutcome?: "external" | "refunded" | "expired";
  /** Mesa de plata que se reembolsa: "pending" hasta que la cadena lo
   *  confirme, "done" cuando la plata volvió, "none" si no había nada que
   *  devolver. */
  refund?: "pending" | "done" | "none";
  isBot?: boolean;
  // Feedback rico (presente solo cuando la partida ya termino):
  yourScore?: number;
  rivalScore?: number;
  margin?: number;
  netPnl?: number; // recompensa del agente (USDC)
  rivalReplay?: unknown; // replay del oponente, para aprender
  rating?: number; // tu rating ELO nuevo en este juego
  ratingDelta?: number; // cuanto subio/bajo
}

function view(m: Match, address?: string, opts?: { revealOwnScore?: boolean }): MatchView {
  // ANTI-ESPIONAJE: hasta que la partida se decide, NADIE ve un puntaje por esta
  // vista. Antes filtrábamos "mostrar solo el puntaje de `address`", pero el GET
  // /match/:id toma esa address de un query SIN AUTENTICAR: bastaba pedir la
  // partida con la address del rival (que la propia respuesta revela en
  // `opponent`) para leer su puntaje ANTES de jugar tu intento — sabías cuánto
  // superar, o no jugabas si no te convenía. Con plata en juego, es letal.
  //   - GET /match/:id  -> revealOwnScore=false (default): jamás filtra puntajes.
  //   - submitScore     -> revealOwnScore=true: el que ENVÍA probó ser él (firma
  //     obligatoria en prod), así que su propia respuesta sí puede confirmarle su
  //     puntaje. El cliente igual lo tiene local; es solo confirmación.
  // La señal `rivalSubmitted` (booleana, sin el número) alcanza para la UX de espera.
  const decided = m.status === "settled" || m.status === "draw";
  const scores: Record<string, number> = decided
    ? m.scores
    : opts?.revealOwnScore && address !== undefined && m.scores[address] !== undefined
      ? { [address]: m.scores[address] }
      : {};
  const rival = address === m.p1 ? m.p2 : address === m.p2 ? m.p1 : undefined;
  const live = isLiveMatch(m.game, m.rulesV);

  const v: MatchView = {
    matchId: m.id,
    game: m.game,
    stake: m.stake,
    seed: live ? undefined : m.seed,
    live: live || undefined,
    secretHash: live && m.liveSecret ? liveSecretHash(m.liveSecret) : undefined,
    secret: live && decided ? m.liveSecret : undefined,
    rulesV: m.rulesV,
    status: m.status,
    role: address === m.p1 ? "p1" : address === m.p2 ? "p2" : undefined,
    opponent: address === m.p1 ? m.p2 : m.p1,
    scores,
    // Señal de progreso sin filtrar el número: alcanza para la UX de espera.
    rivalSubmitted: rival !== undefined ? m.scores[rival] !== undefined : undefined,
    challengeTarget: m.target !== undefined && address === m.target ? true : undefined,
    outcome: m.outcome,
    winner: m.winner,
    noShow: m.noShow,
    signature: signatureVisible(m) ? m.signature : undefined,
    signatureDeadline: signatureVisible(m) ? m.signatureDeadline : undefined,
    isBot: m.isBot,
  };
  if (paidOnchain(m)) {
    Object.assign(v, termsOf(m));
    v.settleTx = m.settleTx;
    v.settleOutcome = m.settleOutcome;
    v.refund = m.refund;
  }

  // FEEDBACK RICO para jugadores/agentes: solo cuando la partida YA termino,
  // asi nadie ve el puntaje ni el replay del rival antes de jugar (ventaja).
  if (decided && address && (address === m.p1 || address === m.p2)) {
    const yourScore = m.scores[address];
    const rivalScore = rival ? m.scores[rival] : undefined;
    v.yourScore = yourScore;
    v.rivalScore = rivalScore;
    v.margin =
      yourScore !== undefined && rivalScore !== undefined ? yourScore - rivalScore : undefined;
    v.netPnl = netPnl(m, address);
    v.rivalReplay = rival ? m.replays[rival] : undefined;
    const myElo = address === m.p1 ? m.eloUpdate?.p1 : m.eloUpdate?.p2;
    if (myElo) {
      v.rating = myElo.after;
      v.ratingDelta = myElo.delta;
    }
  }
  return v;
}

// ------------------------------------------------------------------------- //
// ESPECTADOR: partidas ya decididas, para mirar. Una partida decidida ya
// reveló ambos puntajes y replays a sus jugadores (la semilla está "gastada"),
// así que hacerla pública no filtra nada explotable.
// ------------------------------------------------------------------------- //

export function recentMatches(game?: string, limit = 20) {
  const lim = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 20));
  return [...matches.values()]
    .filter(
      (m) =>
        (m.status === "settled" || m.status === "draw") &&
        !m.isBot &&
        m.p2 !== undefined &&
        // Solo partidas mirables: con los dos replays (una expirada no los tiene).
        m.replays[m.p1] !== undefined &&
        m.replays[m.p2] !== undefined,
    )
    .filter((m) => !game || m.game === game)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, lim)
    .map((m) => ({
      matchId: m.id,
      game: m.game,
      stake: m.stake,
      players: [
        { address: m.p1, score: m.scores[m.p1] },
        { address: m.p2!, score: m.scores[m.p2!] },
      ],
      outcome: m.outcome,
      winner: m.winner,
      createdAt: m.createdAt,
    }));
}

/** Replays completos de una partida YA decidida. Antes de decidirse devuelve
 *  null: nadie puede ver el intento (ni la semilla en uso) de otro jugador. */
export function publicReplay(id: string) {
  const m = matches.get(id);
  if (!m || !m.p2) return null;
  if (m.status !== "settled" && m.status !== "draw") return null;
  // En vivo no hay semilla: cada intento se re-verifica con el secreto.
  const live = isLiveMatch(m.game, m.rulesV);
  return {
    matchId: m.id,
    game: m.game,
    stake: m.stake,
    seed: live ? undefined : m.seed,
    secret: live ? m.liveSecret : undefined,
    secretHash: live && m.liveSecret ? liveSecretHash(m.liveSecret) : undefined,
    outcome: m.outcome,
    winner: m.winner,
    createdAt: m.createdAt,
    players: [m.p1, m.p2].map((p) => ({
      address: p,
      score: m.scores[p],
      replay: m.replays[p],
    })),
  };
}

// ------------------------------------------------------------------------- //
// BARRENDERO: sin esto, las partidas se acumulaban en memoria PARA SIEMPRE
// (waiters huérfanos, partidas "ready" que nadie terminó) -> fuga de memoria y
// fondos colgados. Cada minuto:
//   - borra waiters vencidos (WAIT_TTL) y terminadas viejas (FINISHED_TTL);
//   - una partida emparejada SIN resultado al vencer la ventana de juego se
//     marca expirada (draw) y, si hay escrow, se CANCELA on-chain -> el contrato
//     reembolsa a ambos YA, sin que nadie tenga que esperar plazos eternos
//     (defensa extra si un rival malicioso abrió con playDeadline lejano).
// Margen de 15 min sobre la ventana de envío para no pisar un envío al límite.
// ------------------------------------------------------------------------- //
const SWEEP_EVERY_MS = 60_000;
const EXPIRE_GRACE_MS = 15 * 60_000;

/** UN CIERRE EN VIVO QUE SE CORTÓ. El intento se cierra en memoria y recién
 *  después se guarda y se anota el puntaje (live.ts); si el store falló justo
 *  ahí, el jugador recibió un 503 y lo normal es que reintente. Si no reintenta
 *  (cerró la pestaña, o fue el cierre por plazo de un agente BYO, que no tiene a
 *  quién reintentarle), el intento queda cerrado y la partida sin su puntaje:
 *  vencería como empate. El barrendero lo completa apenas el store vuelve,
 *  guardando primero, como cualquier cierre. */
function healUnfinishedLiveAttempts(m: Match): void {
  if (!m.live || isDecided(m)) return;
  for (const [address, a] of Object.entries(m.live)) {
    if (!a.over || m.scores[address] !== undefined) continue;
    void withLiveLock(m.id, address, async () => {
      if (m.scores[address] !== undefined || isDecided(m)) return;
      await saveLiveAttempt(m.id, address, a);
      await finishLiveAttempt(m, address, a.score ?? 0, {
        ticks: a.tick,
        flaps: [...a.flaps],
        v: RULES_V[m.game] ?? 1,
      });
    }).catch(() => {}); // saveLiveAttempt ya lo logueó; el próximo barrido reintenta
  }
}

export function sweepMatches(now = Date.now()): Promise<void> {
  let dirty = false;
  const expirations: Promise<void>[] = [];
  const checks: Promise<void>[] = [];
  for (const m of [...matches.values()]) {
    const finished = m.status === "settled" || m.status === "draw";
    if (!finished) healUnfinishedLiveAttempts(m);
    if (finished) {
      if (now - m.createdAt > FINISHED_TTL) {
        dropMatch(m);
      } else {
        // Mesa de plata decidida que el árbitro todavía no pudo liquidar, o
        // un reembolso que la cadena todavía no confirmó: el reintento, con su
        // backoff (ver `kickSettle` y `kickRefund`).
        void kickSettle(m, now);
        void kickRefund(m, now);
      }
      continue;
    }
    // Mesa de plata: ¿el p2 se unió a tiempo, o se unió uno de los que habían
    // perdido el lugar? (W3, ver `checkJoin`.)
    if (needsJoinCheck(m, now)) checks.push(runJoinCheck(m, now));
    if (!m.p2) {
      // Esperando rival: vencido, se descarta. Un desafío dirigido usa su propio
      // TTL (más corto); una espera de cola normal, el WAIT_TTL de siempre.
      const ttl = m.target ? CHALLENGE_TTL : WAIT_TTL;
      // Si alguno de los que perdieron el lugar se unió en la cadena, primero
      // se mira eso (arriba): la partida es suya, no se cancela.
      if (now - m.createdAt > ttl && !joinChecks.has(m.id)) {
        unqueue(qkey(m.game, m.stake), m.id);
        // ABRISTE LA MESA Y NADIE APARECIÓ. Antes esto solo borraba la partida
        // de la memoria del árbitro: el USDC quedaba en el contrato y el
        // reembolso pasaba a ser manual, desde /recover —un link perdido entre
        // once del footer que la pantalla de la partida nunca menciona—, y
        // pagando gas. Encima, después `getMatch` devolvía 404, así que ni
        // rastro quedaba. Es EXACTAMENTE el caso del recién llegado en una
        // testnet vacía, y la copy le promete que "el escrow te devuelve todo".
        //
        // El contrato acepta cancelar en estado Open (Escrow1v1.sol) y el
        // árbitro ya paga ese gas en el caso del empate: no hay motivo para no
        // hacerlo también acá.
        //
        // Con plata, la partida queda (como un empate sin rival) hasta que la
        // cadena confirme el reembolso: si el primer intento falla, se reintenta
        // (W4). Sin plata, no hay nada que devolver y se borra como siempre.
        if (paidOnchain(m)) {
          m.status = "draw";
          m.outcome = "draw";
          requestRefund(m);
        } else {
          dropMatch(m);
        }
        dirty = true;
      }
      continue;
    }
    // Emparejada pero sin resultado al vencer la ventana (ver expireMatch).
    if (now - m.createdAt > SUBMIT_WINDOW_MS + EXPIRE_GRACE_MS && !expiring.has(m.id)) {
      const p = expireMatch(m, now)
        .catch((e) =>
          console.error(
            `[vencida] ${m.id}: se reintenta en el próximo barrido:`,
            (e as Error).message,
          ),
        )
        .finally(() => expiring.delete(m.id));
      expiring.set(m.id, p);
      expirations.push(p);
    }
  }
  if (dirty) persist();
  return Promise.all([...expirations, ...checks]).then(() => undefined);
}

/** Chequeos de unión en curso (uno por partida: la lectura es async). */
const joinChecks = new Map<string, Promise<void>>();

/** ¿Hay que mirar en la cadena si el p2 se unió? Una mesa de plata emparejada
 *  cuyo p2 no se confirmó y ya se pasó de `JOIN_WINDOW_MS`, o una liberada que
 *  todavía puede recuperar alguno de los que perdieron el lugar (antes de que
 *  venza el fondeo). */
function needsJoinCheck(m: Match, now: number): boolean {
  if (!paidOnchain(m) || isDecided(m) || joinChecks.has(m.id)) return false;
  if (m.p2) {
    return (
      m.status === "ready" &&
      !m.joinConfirmed &&
      m.pairedAt !== undefined &&
      now - m.pairedAt > JOIN_WINDOW_MS
    );
  }
  return !!m.revokedSeats?.length && Math.floor(now / 1000) <= termsOf(m).fundDeadline;
}

function runJoinCheck(m: Match, now: number): Promise<void> {
  const p = checkJoin(m, now)
    .catch((e) =>
      console.error(`[fila] ${m.id}: se reintenta en el próximo barrido:`, (e as Error).message),
    )
    .finally(() => joinChecks.delete(m.id));
  joinChecks.set(m.id, p);
  return p;
}

/** Vencimientos en curso (uno por partida: la lectura de la cadena es async). */
const expiring = new Map<string, Promise<void>>();

/** Lo que falta, como mínimo, para que venza la firma de un resultado que se
 *  decide al vencer: si queda menos, el árbitro no llega a cobrarlo. */
const FORFEIT_MARGIN_S = 5 * 60;

/** Cierra los intentos en vivo a medio jugar de una partida que vence. Lo
 *  registra live.ts al cargarse (matchmaking no puede importarlo). */
let expiredLiveCloser: ((m: Match) => Promise<void>) | undefined;
export function setExpiredLiveCloser(fn: (m: Match) => Promise<void>): void {
  expiredLiveCloser = fn;
}

/** NO PRESENTAR YA NO ES GRATIS (W2; pre-auditoría F3). Antes, al vencer, la
 *  partida se cancelaba y los dos recuperaban su stake: el que jugaba mal no
 *  presentaba, y con la semilla anticipada hasta jugaba antes de depositar.
 *  Ahora, al vencer la ventana de envío:
 *   - En vivo, un intento a medio jugar se cierra con lo que alcanzó y cuenta
 *     como presentado (la regla que ya tenían los agentes BYO).
 *   - Si presentó uno solo, gana ese, y el otro pierde rating. Con plata, solo
 *     si los dos depositaron (Funded) y la firma todavía llega a cobrarse antes
 *     de que se abra el reembolso. Si el rival nunca depositó, o ya no da el
 *     tiempo, se reembolsa como antes. Si la cadena no contesta, tira: el
 *     próximo barrido reintenta.
 *   - Si no presentó nadie, empate: reembolso y sin cambio de rating. */
async function expireMatch(m: Match, now: number): Promise<void> {
  if (m.live && expiredLiveCloser) await expiredLiveCloser(m);
  if (isDecided(m) || !m.p2) return; // el cierre en vivo pudo decidirla
  const p2 = m.p2;
  const submitted = [m.p1, p2].filter((p) => m.scores[p] !== undefined);
  if (submitted.length === 2) return settleIfReady(m);

  let refunded = false;
  if (submitted.length === 1) {
    const winner = submitted[0];
    let forfeit = !paidOnchain(m);
    if (!forfeit) {
      const c = await escrowChain().read(m.id);
      forfeit =
        c?.status === ONCHAIN_STATUS.Funded &&
        Math.floor(now / 1000) < resultDeadlineOf(m) - FORFEIT_MARGIN_S;
      refunded = c?.status === ONCHAIN_STATUS.Refunded;
    }
    if (forfeit) {
      m.noShow = winner === m.p1 ? p2 : m.p1;
      await decide(m, winner);
      persist();
      return;
    }
  }

  m.status = "draw";
  m.outcome = "draw";
  if (refunded) {
    m.settleOutcome = "refunded";
    m.refund = "done";
  } else requestRefund(m);
  persist();
}

let sweeper: NodeJS.Timeout | undefined;

/** El barrido periódico. Lo arranca index.ts DESPUÉS de cargar el estado (antes
 *  arrancaba al importar el módulo) y lo frena la entrega de la posta. Los tests
 *  llaman a sweepMatches con su propio reloj. */
export function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => sweepMatches(), SWEEP_EVERY_MS);
  sweeper.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
}

export async function stopSweeper(): Promise<void> {
  if (sweeper) clearInterval(sweeper);
  sweeper = undefined;
  // La vuelta en curso: un vencimiento que esperaba la cadena (ver expireMatch).
  await Promise.all(expiring.values());
}
