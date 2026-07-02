// Cliente del backend "arbitro" para la web. Delega en @arcade1v1/agent-sdk
// (cliente canónico) y conserva los helpers propios de la web (playerId).
import { ArbiterClient, type MatchView } from "@arcade1v1/agent-sdk";

export type { MatchView };

const BASE = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";
const client = new ArbiterClient(BASE);

export function matchmake(
  game: string,
  stake: number,
  address: string,
  auth?: { signature: string; ts: number },
) {
  return client.matchmake(game, stake, address, auth);
}

export function submitScore(
  id: string,
  address: string,
  score: number,
  replay?: unknown,
  signature?: string,
) {
  return client.submitScore(id, address, score, replay, signature);
}

export function getMatch(id: string, address?: string) {
  return client.getMatch(id, address);
}

/** Pide que un bot juegue por el rival (modo práctica). No forma parte del
 * cliente canónico del SDK (es un atajo solo de la web), así que se llama
 * directo al árbitro. */
export async function playBot(id: string): Promise<MatchView> {
  const r = await fetch(`${BASE}/match/${id}/bot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`arbiter /match/${id}/bot ${r.status}`);
  return r.json();
}

export interface LeaderRow {
  address: string;
  rating: number;
}

export async function getLeaderboard(game: string, limit = 20): Promise<LeaderRow[]> {
  try {
    return await client.leaderboard(game, limit);
  } catch {
    return [];
  }
}

/** Identificador del jugador: wallet si esta conectada, o un "invitado" local. */
export function playerId(walletAddress: string | null): string {
  if (walletAddress) return walletAddress;
  let g = localStorage.getItem("arcade.guest");
  if (!g) {
    const hex = "0123456789abcdef";
    g = "0x" + Array.from({ length: 40 }, () => hex[Math.floor(Math.random() * 16)]).join("");
    localStorage.setItem("arcade.guest", g);
  }
  return g;
}
