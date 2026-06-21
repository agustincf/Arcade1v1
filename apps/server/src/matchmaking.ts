// Emparejamiento por orden de llegada + decision del resultado + firma.
// Modelo asincronico: el 2do en llegar se empareja con el 1ro; cada uno juega
// su intento (misma semilla) y al tener los dos puntajes se decide y se firma.

import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import { signResult } from "./sign.js";

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
}

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

export async function submitScore(id: string, address: string, score: number) {
  const m = matches.get(id);
  if (!m) throw new Error("match not found");
  if (address !== m.p1 && address !== m.p2) throw new Error("not a player");
  m.scores[address] = Math.max(0, Math.floor(score));

  const ready =
    m.p2 &&
    m.scores[m.p1] !== undefined &&
    m.scores[m.p2] !== undefined &&
    (m.status === "ready" || m.status === "waiting");

  if (ready) {
    const s1 = m.scores[m.p1];
    const s2 = m.scores[m.p2!];
    if (s1 === s2) {
      m.status = "draw";
      m.outcome = "draw"; // empate -> reembolso (el arbitro cancela en el contrato)
    } else {
      const winner = s1 > s2 ? m.p1 : m.p2!;
      m.winner = winner;
      m.outcome = winner === m.p1 ? "p1" : "p2";
      m.signature = await signResult(m.id, winner as Hex);
      m.status = "settled";
    }
  }
  return view(m, address);
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
  };
}
