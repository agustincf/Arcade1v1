// Cliente del backend "arbitro" para la web. Delega en @arcade1v1/agent-sdk
// (cliente canónico) y conserva los helpers propios de la web (playerId).
import { ArbiterClient, type MatchView } from "@arcade1v1/agent-sdk";

export type { MatchView };

const BASE = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

// Timeout de red: el hosting gratuito duerme el servidor y el primer pedido
// puede tardar ~1 minuto en despertar. Le damos margen, pero NUNCA dejamos un
// fetch colgado para siempre (la UI quedaba en "Conectando…" sin salida).
const FETCH_TIMEOUT_MS = 75_000;
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) });

const client = new ArbiterClient(BASE, { fetchImpl: fetchWithTimeout });

/** Despierta al árbitro (hosting gratuito que duerme) sin bloquear la UI.
 * Se llama al entrar a la mesa, así el server ya está listo al buscar rival. */
export function warmUpArbiter(): void {
  fetch(`${BASE}/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => {
    /* solo calienta; si falla, el matchmake real mostrará el error */
  });
}

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

// ------------------------------------------------------------------------- //
// AGENTES HOSTEADOS (builder no-code): CRUD + historial + catálogo.
// La administración va FIRMADA por el dueño (agentAuthMessage del game-sdk).
// ------------------------------------------------------------------------- //

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetchWithTimeout(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body?.error || `arbiter ${path} ${r.status}`);
  return body;
}

export interface AgentView {
  id: string;
  owner: string;
  name: string;
  avatar: string;
  game: string;
  strategyId: string;
  params: Record<string, unknown>;
  address: string;
  active: boolean;
  createdAt: number;
  lastPlayedAt?: number;
  stats: { matches: number; wins: number; losses: number; draws: number };
  rating: number;
}

export interface AgentMatchSummary {
  matchId: string;
  game: string;
  opponent?: string;
  yourScore?: number;
  rivalScore?: number;
  outcome: "win" | "loss" | "draw";
  ratingDelta?: number;
  ts: number;
}

export function createAgent(input: {
  owner: string;
  name: string;
  avatar: string;
  game: string;
  strategyId: string;
  params: Record<string, unknown>;
  signature?: string;
  ts?: number;
}): Promise<AgentView> {
  return req("/agents", { method: "POST", body: JSON.stringify(input) });
}

export async function listAgents(owner: string): Promise<AgentView[]> {
  const out = await req<{ agents: AgentView[] }>(`/agents?owner=${encodeURIComponent(owner)}`);
  return out.agents;
}

export function getAgent(id: string): Promise<AgentView> {
  return req(`/agents/${encodeURIComponent(id)}`);
}

export async function getAgentMatches(id: string): Promise<AgentMatchSummary[]> {
  const out = await req<{ matches: AgentMatchSummary[] }>(
    `/agents/${encodeURIComponent(id)}/matches`,
  );
  return out.matches;
}

export function agentAction(
  id: string,
  input: {
    action: "pause" | "resume" | "update" | "delete";
    name?: string;
    avatar?: string;
    params?: Record<string, unknown>;
    signature?: string;
    ts?: number;
  },
): Promise<AgentView | { ok: true }> {
  return req(`/agents/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(input) });
}

// ------------------------------------------------------------------------- //
// ESPECTADOR: partidas recientes decididas + replays públicos.
// ------------------------------------------------------------------------- //

export interface RecentMatch {
  matchId: string;
  game: string;
  stake: number;
  players: { address: string; score?: number }[];
  outcome?: "p1" | "p2" | "draw";
  winner?: string;
  createdAt: number;
}

export interface PublicReplay extends RecentMatch {
  seed: number;
  players: { address: string; score?: number; replay?: unknown }[];
}

export async function getRecentMatches(game?: string, limit = 20): Promise<RecentMatch[]> {
  const q = game ? `?game=${encodeURIComponent(game)}&limit=${limit}` : `?limit=${limit}`;
  const out = await req<{ matches: RecentMatch[] }>(`/matches/recent${q}`);
  return out.matches;
}

export function getPublicReplay(matchId: string): Promise<PublicReplay> {
  return req(`/match/${encodeURIComponent(matchId)}/replay`);
}

// ------------------------------------------------------------------------- //
// MÉTRICAS públicas del árbitro (página /status). Todo real, sin inflar.
// ------------------------------------------------------------------------- //

export interface StatsCounters {
  matchesCreated: number;
  matchesSettled: number;
  verificationsRejected: number;
}

export interface StatsView {
  startedAt: number;
  uptimeSeconds: number;
  since: number;
  totals: StatsCounters;
  today: StatsCounters;
  activeAgents: number;
  daily: Array<{ date: string } & StatsCounters>;
}

export function getStats(): Promise<StatsView> {
  return req("/stats");
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
