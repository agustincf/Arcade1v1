// Emparejamiento por orden de llegada + decision del resultado + firma.
// Modelo asincronico: el 2do en llegar se empareja con el 1ro; cada uno juega
// su intento (misma semilla) y al tener los dos puntajes se decide y se firma.

import { randomBytes, randomInt } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { signResult } from "./sign.js";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { verifyTetris, type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { verifyFlappy, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { verifyRacing, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { verifySnake, type ReplaySnake } from "@arcade1v1/game-sdk/snake";
import { verifyInvaders, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";
import {
  scoreAuthMessage,
  matchmakeAuthMessage,
  MATCHMAKE_AUTH_TTL_MS,
} from "@arcade1v1/game-sdk/auth";
import { onchainEnabled, cancelMatchOnchain } from "./onchain.js";
import { applyResult as applyElo, type RatingUpdate } from "./ratings.js";
import { jsonStore } from "./persist.js";
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

/** ¿El replay pide más trabajo del razonable para re-jugarlo? (corta el DoS). */
export function replayTooLong(replay: unknown): boolean {
  const r = replay as { ticks?: unknown; moves?: unknown; inputs?: unknown; flaps?: unknown };
  if (typeof r.ticks === "number" && (!Number.isFinite(r.ticks) || r.ticks > MAX_REPLAY_TICKS)) {
    return true;
  }
  for (const arr of [r.moves, r.inputs, r.flaps]) {
    if (Array.isArray(arr) && arr.length > MAX_REPLAY_EVENTS) return true;
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

interface Match {
  id: Hex;
  game: string;
  stake: number;
  seed: number;
  p1: string;
  p2?: string;
  target?: string; // desafío directo: solo esta address (un agente) puede aceptar
  scores: Record<string, number>;
  replays: Record<string, unknown>; // replay verificado de cada jugador
  createdAt: number; // para descartar "waiters" abandonados de la cola
  status: Status;
  winner?: string;
  outcome?: "p1" | "p2" | "draw";
  signature?: Hex;
  isBot?: boolean;
  refundPromise?: Promise<void>; // cancelacion/reembolso on-chain en empate
  eloUpdate?: { p1: RatingUpdate; p2: RatingUpdate }; // cambio de rating al liquidar
}

// Comision (basis points) para calcular el PnL neto que se le informa al jugador.
const FEE_BPS = Number(process.env.FEE_BPS ?? 1500);

// AUTENTICACION OBLIGATORIA (secure-by-default): exigir que cada envío venga
// firmado por la wallet del jugador. Sin esto, alguien podría mandar un puntaje
// a nombre del rival (haciéndolo perder). Política:
//   - REQUIRE_AUTH=true  -> obligatoria (cualquier entorno)
//   - REQUIRE_AUTH=false -> desactivada explícitamente (opt-out, p. ej. una demo)
//   - sin setear         -> obligatoria en producción, libre en dev (invitados)
export const AUTH_REQUIRED =
  process.env.REQUIRE_AUTH === "true" ||
  (process.env.REQUIRE_AUTH !== "false" && process.env.NODE_ENV === "production");

const BOT = "0x000000000000000000000000000000000000b07a";

// MESAS PERMITIDAS: deben coincidir con las del contrato (allowedStake). Sin esta
// lista, cualquiera creaba colas basura con montos arbitrarios (NaN, negativos,
// millones) que ensuciaban memoria/disco y el netPnl. Configurable por entorno.
const STAKES_ALLOWED: number[] = (process.env.STAKES_ALLOWED ?? "1,2,5,10")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/** Normaliza una dirección para usarla como clave interna (case-insensitive).
 *  Sin esto, "0xAbC..." y "0xabc..." serían DOS jugadores distintos (doble ELO,
 *  "not a player" al reenviar con otro formato, etc.). */
const normAddr = (a: string) => String(a).toLowerCase();

const matches = new Map<string, Match>();
const queue = new Map<string, Hex>(); // "game:stake" -> id de la partida esperando rival

const qkey = (game: string, stake: number) => `${game}:${stake}`;
const randomId = () => ("0x" + randomBytes(32).toString("hex")) as Hex;
// Semilla con CSPRNG: Math.random es predecible (xorshift128+); un observador
// podría anticipar semillas futuras y practicarlas offline antes de emparejar.
const randomSeed = () => randomInt(0, 2 ** 31 - 1);

const WAIT_TTL = 60 * 60 * 1000; // 1 hora: un "waiter" abandonado se descarta de la cola

// VENTANA DE ENVÍO: alineada al plazo on-chain (la web abre con playDeadline =
// +2h). Pasada la ventana no se aceptan puntajes: corta la "práctica offline"
// ilimitada con la semilla ya conocida y evita liquidar partidas ya reembolsadas.
export const SUBMIT_WINDOW_MS = Number(process.env.SUBMIT_WINDOW_MS ?? 2 * 60 * 60 * 1000);

// PERSISTENCIA vía persist.ts (Redis o archivo; opt-in, ver ese módulo).
// Sobrevive a un reinicio del servidor: las partidas en curso vuelven y un
// ganador puede recuperar su firma para cobrar. El debounce y el flush de
// apagado (SIGTERM/SIGINT) los maneja el adaptador.
const store$ = jsonStore("matches");
const FINISHED_TTL = 2 * 24 * 60 * 60 * 1000; // 2 días: purga partidas terminadas viejas

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
    const arr = JSON.parse(raw) as Match[];
    for (const m of arr) {
      matches.set(m.id, m);
      // Reconstruimos la cola: una partida en espera (sin rival) vuelve a la fila.
      // Un DESAFÍO (target) NUNCA va a la cola general: solo su target lo acepta
      // (lo descubre el runner con pendingChallengesFor). Sin este guard, tras un
      // redeploy un desafío quedaba en la cola gratis y un tercero lo robaba.
      if (m.status === "waiting" && !m.p2 && !m.target) queue.set(qkey(m.game, m.stake), m.id);
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
    p1: address,
    scores: {},
    replays: {},
    createdAt: Date.now(),
    status: "waiting",
  };
  matches.set(m.id, m);
  queue.set(k, m.id);
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
  const waitingId = queue.get(k);
  let waiter = waitingId ? matches.get(waitingId) : undefined;

  // Limpieza: un waiter ya emparejado o abandonado (viejo) no debe trabar la cola.
  if (waiter && (waiter.p2 || Date.now() - waiter.createdAt > WAIT_TTL)) {
    queue.delete(k);
    if (!waiter.p2) matches.delete(waiter.id);
    waiter = undefined;
  }

  // El mismo jugador re-consulta su espera: devolvemos su partida (idempotente).
  if (waiter && waiter.p1 === address) return view(waiter, address);

  // Hay un rival esperando: emparejamos (orden de llegada). Cada jugador abre/se
  // une on-chain por su cuenta -> el arbitro no crea la partida ni paga gas.
  if (waiter) {
    waiter.p2 = address;
    waiter.status = "ready";
    queue.delete(k);
    persist();
    return view(waiter, address);
  }

  // Nadie esperando: creamos la partida y quedamos a la espera.
  return createWaiting(k, game, stake, address);
}

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

  let finalScore = Math.max(0, Math.floor(score));

  // ANTI-TRAMPA (default-deny): TODO juego debe tener verificador. Re-jugamos el
  // replay y exigimos que el puntaje declarado coincida con el verificado. Si el
  // juego es desconocido o el replay no valida/no coincide, se rechaza: nunca se
  // confía en un puntaje sin re-jugarlo. Todo rechazo de este bloque cuenta como
  // "verificación rechazada" en las métricas (el catch incrementa y re-lanza).
  try {
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
    throw e;
  }

  m.scores[address] = finalScore;
  m.replays[address] = replay; // guardamos el replay (feedback para el rival/agente)
  await settleIfReady(m);
  persist();
  return view(m, address);
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
  if (s1 === s2) {
    m.status = "draw";
    m.outcome = "draw"; // empate -> reembolso (el arbitro cancela en el contrato)
    if (onchainEnabled()) {
      m.refundPromise = cancelMatchOnchain(m.id).catch((e) =>
        console.error("cancelMatch onchain:", (e as Error).message),
      );
    }
  } else {
    const winner = s1 > s2 ? m.p1 : m.p2;
    m.winner = winner;
    m.outcome = winner === m.p1 ? "p1" : "p2";
    // El status se marca ANTES del await: durante la firma (async) una
    // invocación concurrente pasaría el guard de arriba y liquidaría dos veces.
    m.status = "settled";
    m.signature = await signResult(m.id, winner as Hex);
  }

  // Rating ELO + métrica de partidas decididas (las de bot de prueba no cuentan,
  // igual criterio que el ELO). settleIfReady corre una sola vez por partida
  // (el guard de arriba corta si ya no está "ready"/"waiting").
  if (!m.isBot && m.p2 && m.outcome) {
    m.eloUpdate = applyElo(m.game, m.p1, m.p2, m.outcome);
    recordMatchSettled();
  }
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
  const k = qkey(m.game, m.stake);
  if (queue.get(k) === m.id) queue.delete(k);
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

/** Espera a que se resuelva el reembolso on-chain del empate (si aplica). */
export function onchainSettled(id: string): Promise<void> {
  return matches.get(id)?.refundPromise ?? Promise.resolve();
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
  const waitingId = queue.get(qkey(game, stake));
  const waiter = waitingId ? matches.get(waitingId) : undefined;
  if (!waiter || waiter.p2 || Date.now() - waiter.createdAt > WAIT_TTL) return null;
  return waiter.p1;
}

/** Descarta una partida EN ESPERA (sin rival). Se usa al pausar/borrar un
 *  agente hosteado que quedó en la cola: sin esto, el próximo en emparejar
 *  se juntaba con un "fantasma" que nunca iba a jugar su intento. */
export function dropWaitingMatch(id: string) {
  const m = matches.get(id);
  if (!m || m.p2 || m.status !== "waiting") return;
  const k = qkey(m.game, m.stake);
  if (queue.get(k) === m.id) queue.delete(k);
  matches.delete(m.id);
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
  seed: number;
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
  signature?: Hex; // el ganador la presenta al contrato
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

function view(m: Match, address?: string): MatchView {
  // ANTI-ESPIONAJE: hasta que la partida se decide, cada jugador ve SOLO su
  // propio puntaje. Sin este filtro, el rival consultaba GET /match/:id y veía
  // tu puntaje ANTES de jugar su intento: sabía exactamente cuánto superar (o
  // directamente no jugaba si no le convenía). Con plata en juego, es letal.
  const decided = m.status === "settled" || m.status === "draw";
  const scores: Record<string, number> = decided
    ? m.scores
    : address !== undefined && m.scores[address] !== undefined
      ? { [address]: m.scores[address] }
      : {};
  const rival = address === m.p1 ? m.p2 : address === m.p2 ? m.p1 : undefined;

  const v: MatchView = {
    matchId: m.id,
    game: m.game,
    stake: m.stake,
    seed: m.seed,
    status: m.status,
    role: address === m.p1 ? "p1" : address === m.p2 ? "p2" : undefined,
    opponent: address === m.p1 ? m.p2 : m.p1,
    scores,
    // Señal de progreso sin filtrar el número: alcanza para la UX de espera.
    rivalSubmitted: rival !== undefined ? m.scores[rival] !== undefined : undefined,
    challengeTarget: m.target !== undefined && address === m.target ? true : undefined,
    outcome: m.outcome,
    winner: m.winner,
    signature: m.signature,
    isBot: m.isBot,
  };

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
  return {
    matchId: m.id,
    game: m.game,
    stake: m.stake,
    seed: m.seed,
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

export function sweepMatches(now = Date.now()) {
  let dirty = false;
  for (const m of [...matches.values()]) {
    const finished = m.status === "settled" || m.status === "draw";
    if (finished) {
      if (now - m.createdAt > FINISHED_TTL) {
        matches.delete(m.id);
      }
      continue;
    }
    if (!m.p2) {
      // Esperando rival: vencido, se descarta. Un desafío dirigido usa su propio
      // TTL (más corto); una espera de cola normal, el WAIT_TTL de siempre.
      const ttl = m.target ? CHALLENGE_TTL : WAIT_TTL;
      if (now - m.createdAt > ttl) {
        const k = qkey(m.game, m.stake);
        if (queue.get(k) === m.id) queue.delete(k);
        matches.delete(m.id);
        dirty = true;
      }
      continue;
    }
    // Emparejada pero sin resultado al vencer la ventana: expira -> reembolso.
    if (now - m.createdAt > SUBMIT_WINDOW_MS + EXPIRE_GRACE_MS) {
      m.status = "draw";
      m.outcome = "draw";
      if (onchainEnabled()) {
        m.refundPromise = cancelMatchOnchain(m.id).catch((e) =>
          console.error("cancelMatch (expirada) onchain:", (e as Error).message),
        );
      }
      dirty = true;
    }
  }
  if (dirty) persist();
}

const sweeper = setInterval(sweepMatches, SWEEP_EVERY_MS);
sweeper.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
