// Emparejamiento por orden de llegada + decision del resultado + firma.
// Modelo asincronico: el 2do en llegar se empareja con el 1ro; cada uno juega
// su intento (misma semilla) y al tener los dos puntajes se decide y se firma.

import { randomBytes } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { signResult } from "./sign.js";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { verifyTetris, type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { verifyFlappy, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { verifyRacing, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { verifySnake, type ReplaySnake } from "@arcade1v1/game-sdk/snake";
import { verifyInvaders, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { onchainEnabled, createMatchOnchain, cancelMatchOnchain } from "./onchain.js";

type Status = "waiting" | "ready" | "settled" | "draw";

interface Match {
  id: Hex;
  game: string;
  stake: number;
  seed: number;
  p1: string;
  p2?: string;
  scores: Record<string, number>;
  status: Status;
  winner?: string;
  outcome?: "p1" | "p2" | "draw";
  signature?: Hex;
  isBot?: boolean;
  createPromise?: Promise<void>; // creacion de la partida on-chain (si aplica)
  refundPromise?: Promise<void>; // cancelacion/reembolso on-chain en empate
}

const BOT = "0x000000000000000000000000000000000000b07a";

const matches = new Map<string, Match>();
const queue = new Map<string, Hex>(); // "game:stake" -> id de la partida esperando rival

const qkey = (game: string, stake: number) => `${game}:${stake}`;
const randomId = () => ("0x" + randomBytes(32).toString("hex")) as Hex;
const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);

export function matchmake(game: string, stake: number, address: string) {
  const k = qkey(game, stake);
  const waitingId = queue.get(k);

  // Hay alguien esperando: lo emparejamos (orden de llegada).
  if (waitingId) {
    const m = matches.get(waitingId);
    if (m && !m.p2 && m.p1 !== address) {
      m.p2 = address;
      m.status = "ready";
      queue.delete(k);
      // Si hay contrato configurado, el arbitro crea la partida on-chain.
      if (onchainEnabled()) {
        const now = BigInt(Math.floor(Date.now() / 1000));
        m.createPromise = createMatchOnchain(
          m.id,
          m.p1 as Hex,
          m.p2 as Hex,
          BigInt(m.stake) * 1_000_000n,
          now + 3600n,
          now + 7200n,
        ).catch((e) => console.error("createMatch onchain:", (e as Error).message));
      }
      return view(m, address);
    }
  }

  // Nadie esperando: creamos la partida y quedamos a la espera.
  const m: Match = {
    id: randomId(),
    game,
    stake,
    seed: randomSeed(),
    p1: address,
    scores: {},
    status: "waiting",
  };
  matches.set(m.id, m);
  queue.set(k, m.id);
  return view(m, address);
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
  } else if (process.env.REQUIRE_AUTH === "true") {
    throw new Error("signature required");
  }

  let finalScore = Math.max(0, Math.floor(score));

  // ANTI-TRAMPA: para juegos verificables (2048 y Tetris), re-jugamos el replay
  // y confirmamos el puntaje. Si no coincide, es trampa: se rechaza.
  if (m.game === "2048") {
    const r = replay as Replay2048 | undefined;
    if (!r || !Array.isArray(r.moves) || typeof r.seed !== "number") {
      throw new Error("replay required");
    }
    const verified = verify2048(r);
    if (verified !== finalScore) {
      throw new Error(`score mismatch (claimed ${finalScore}, verified ${verified})`);
    }
    finalScore = verified;
  } else if (m.game === "tetris") {
    const r = replay as ReplayTetris | undefined;
    if (!r || !Array.isArray(r.inputs) || typeof r.seed !== "number" || typeof r.ticks !== "number") {
      throw new Error("replay required");
    }
    const verified = verifyTetris(r);
    if (verified !== finalScore) {
      throw new Error(`score mismatch (claimed ${finalScore}, verified ${verified})`);
    }
    finalScore = verified;
  } else if (m.game === "flappy") {
    const r = replay as ReplayFlappy | undefined;
    if (!r || !Array.isArray(r.flaps) || typeof r.seed !== "number" || typeof r.ticks !== "number") {
      throw new Error("replay required");
    }
    const verified = verifyFlappy(r);
    if (verified !== finalScore) {
      throw new Error(`score mismatch (claimed ${finalScore}, verified ${verified})`);
    }
    finalScore = verified;
  } else if (m.game === "racing") {
    const r = replay as ReplayRacing | undefined;
    if (!r || !Array.isArray(r.inputs) || typeof r.seed !== "number" || typeof r.ticks !== "number") {
      throw new Error("replay required");
    }
    const verified = verifyRacing(r);
    if (verified !== finalScore) {
      throw new Error(`score mismatch (claimed ${finalScore}, verified ${verified})`);
    }
    finalScore = verified;
  } else if (m.game === "snake") {
    const r = replay as ReplaySnake | undefined;
    if (!r || !Array.isArray(r.inputs) || typeof r.seed !== "number" || typeof r.ticks !== "number") {
      throw new Error("replay required");
    }
    const verified = verifySnake(r);
    if (verified !== finalScore) {
      throw new Error(`score mismatch (claimed ${finalScore}, verified ${verified})`);
    }
    finalScore = verified;
  } else if (m.game === "invaders") {
    const r = replay as ReplayInvaders | undefined;
    if (!r || !Array.isArray(r.inputs) || typeof r.seed !== "number" || typeof r.ticks !== "number") {
      throw new Error("replay required");
    }
    const verified = verifyInvaders(r);
    if (verified !== finalScore) {
      throw new Error(`score mismatch (claimed ${finalScore}, verified ${verified})`);
    }
    finalScore = verified;
  }

  m.scores[address] = finalScore;
  await settleIfReady(m);
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
  return view(m, m.p1);
}

/** Espera a que la partida exista on-chain (si aplica) antes de depositar. */
export function onchainReady(id: string): Promise<void> {
  return matches.get(id)?.createPromise ?? Promise.resolve();
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

function view(m: Match, address?: string) {
  return {
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
    signature: m.signature, // el ganador la presenta al contrato
    isBot: m.isBot,
  };
}
