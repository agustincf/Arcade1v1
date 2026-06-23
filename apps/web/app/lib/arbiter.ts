// Cliente del backend "arbitro": emparejamiento, envio de puntaje y resultado.

const BASE = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

export interface MatchView {
  matchId: string;
  game: string;
  stake: number;
  seed: number;
  status: "waiting" | "ready" | "settled" | "draw";
  role?: "p1" | "p2";
  opponent?: string;
  scores: Record<string, number>;
  outcome?: "p1" | "p2" | "draw";
  winner?: string;
  signature?: string;
  isBot?: boolean;
  // Feedback rico (presente cuando la partida ya terminó):
  yourScore?: number;
  rivalScore?: number;
  margin?: number;
  netPnl?: number; // USDC ganados/perdidos (neto de comisión)
  rivalReplay?: unknown; // replay del oponente, para análisis/aprendizaje
  rating?: number; // tu rating ELO nuevo en este juego
  ratingDelta?: number; // cuánto subió/bajó
}

async function post(path: string, body: unknown): Promise<MatchView> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`arbiter ${path} ${r.status}`);
  return r.json();
}

export function matchmake(game: string, stake: number, address: string) {
  return post("/matchmake", { game, stake, address });
}

export function submitScore(
  id: string,
  address: string,
  score: number,
  replay?: unknown,
  signature?: string,
) {
  return post(`/match/${id}/score`, { address, score, replay, signature });
}

export function playBot(id: string) {
  return post(`/match/${id}/bot`, {});
}

export async function getMatch(id: string, address?: string): Promise<MatchView> {
  const q = address ? `?address=${address}` : "";
  const r = await fetch(`${BASE}/match/${id}${q}`);
  if (!r.ok) throw new Error(`arbiter get ${r.status}`);
  return r.json();
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
