// Emparejamiento por orden de llegada + decision del resultado + firma.
// Modelo asincronico: el 2do en llegar se empareja con el 1ro; cada uno juega
// su intento (misma semilla) y al tener los dos puntajes se decide y se firma.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recoverMessageAddress, type Hex } from "viem";
import { signResult } from "./sign.js";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { verifyTetris, type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { verifyFlappy, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { verifyRacing, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { verifySnake, type ReplaySnake } from "@arcade1v1/game-sdk/snake";
import { verifyInvaders, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { onchainEnabled, cancelMatchOnchain } from "./onchain.js";
import { applyResult as applyElo, type RatingUpdate } from "./ratings.js";

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

const matches = new Map<string, Match>();
const queue = new Map<string, Hex>(); // "game:stake" -> id de la partida esperando rival

const qkey = (game: string, stake: number) => `${game}:${stake}`;
const randomId = () => ("0x" + randomBytes(32).toString("hex")) as Hex;
const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);

const WAIT_TTL = 60 * 60 * 1000; // 1 hora: un "waiter" abandonado se descarta de la cola

// PERSISTENCIA (liviana, archivo JSON con escritura atómica; mismo patrón que el
// ranking). Sobrevive a un reinicio del servidor: las partidas en curso vuelven
// y un ganador puede recuperar su firma para cobrar. Es OPT-IN: solo se activa en
// el servidor real (que importa "./persist-on.js"); en tests/e2e queda apagada
// para no romper la corrida hermética ni cargar estado viejo.
const PERSIST = process.env.ARCADE_PERSIST_MATCHES === "1";
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const MATCHES_FILE = join(DATA_DIR, "matches.json");
const FINISHED_TTL = 2 * 24 * 60 * 60 * 1000; // 2 días: purga partidas terminadas viejas

function persist() {
  if (!PERSIST) return;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const now = Date.now();
    const arr = [...matches.values()].filter((m) => {
      const finished = m.status === "settled" || m.status === "draw";
      return !finished || now - m.createdAt < FINISHED_TTL; // mantené lo vivo y lo reciente
    });
    const tmp = `${MATCHES_FILE}.tmp`;
    // El replacer descarta `refundPromise` (no es serializable; es transitorio).
    writeFileSync(
      tmp,
      JSON.stringify(arr, (k, v) => (k === "refundPromise" ? undefined : v)),
    );
    renameSync(tmp, MATCHES_FILE);
  } catch (e) {
    console.error("matches save:", (e as Error).message);
  }
}

function loadMatches() {
  if (!PERSIST) return;
  try {
    const arr = JSON.parse(readFileSync(MATCHES_FILE, "utf8")) as Match[];
    for (const m of arr) {
      matches.set(m.id, m);
      // Reconstruimos la cola: una partida en espera (sin rival) vuelve a la fila.
      if (m.status === "waiting" && !m.p2) queue.set(qkey(m.game, m.stake), m.id);
    }
    console.log(`Partidas recuperadas de disco: ${arr.length}`);
  } catch {
    /* no hay archivo (o está vacío): arrancamos limpio */
  }
}
loadMatches();

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
  persist();
  return view(m, address);
}

export async function matchmake(game: string, stake: number, address: string) {
  // Default-deny: solo se emparejan juegos que el árbitro sabe verificar.
  if (!isKnownGame(game)) throw new Error(`unknown game: ${game}`);
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
  const m = matches.get(id);
  if (!m) throw new Error("match not found");
  if (address !== m.p1 && address !== m.p2) throw new Error("not a player");

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
  // confía en un puntaje sin re-jugarlo.
  const verifier = VERIFIERS[m.game];
  if (!verifier) throw new Error(`unknown game: ${m.game}`);
  if (!verifier.valid(replay)) throw new Error("replay required");
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
    m.signature = await signResult(m.id, winner as Hex);
    m.status = "settled";
  }

  // Rating ELO por juego (las partidas contra el bot de prueba no cuentan).
  if (!m.isBot && m.p2 && m.outcome) {
    m.eloUpdate = applyElo(m.game, m.p1, m.p2, m.outcome);
  }
}

/** Pruebas en solitario: completa la partida con un "bot" y la liquida. */
export async function addBot(id: string) {
  const m = matches.get(id);
  if (!m) throw new Error("match not found");
  if (m.p2) return view(m, m.p1); // ya tiene rival real
  m.p2 = BOT;
  m.isBot = true;
  queue.delete(qkey(m.game, m.stake));
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
  return view(m, address);
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
  const v: MatchView = {
    matchId: m.id,
    game: m.game,
    stake: m.stake,
    seed: m.seed,
    status: m.status,
    role: address === m.p1 ? "p1" : address === m.p2 ? "p2" : undefined,
    opponent: address === m.p1 ? m.p2 : m.p1,
    scores: m.scores,
    outcome: m.outcome,
    winner: m.winner,
    signature: m.signature,
    isBot: m.isBot,
  };

  // FEEDBACK RICO para jugadores/agentes: solo cuando la partida YA termino,
  // asi nadie ve el puntaje ni el replay del rival antes de jugar (ventaja).
  const decided = m.status === "settled" || m.status === "draw";
  if (decided && address && (address === m.p1 || address === m.p2)) {
    const rival = address === m.p1 ? m.p2 : m.p1;
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
