// Cliente del backend "arbitro" para la web. Delega en @arcade1v1/agent-sdk
// (cliente canónico) y conserva los helpers propios de la web (playerId).
import {
  ArbiterClient,
  type MatchView,
  type AlephLobby,
  type AlephRoomView,
  type AlephLog,
} from "@arcade1v1/agent-sdk";

export type { MatchView };

const BASE = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

// Timeout de red: el hosting gratuito duerme el servidor y el primer pedido
// puede tardar ~1 minuto en despertar (arranque en frío medido: 42,4 s). Le
// damos margen, pero NUNCA dejamos un fetch colgado para siempre (la UI quedaba
// en "Conectando…" sin salida).
const FETCH_TIMEOUT_MS = 75_000;
// Este fetch solo pone el tope cuando el init viene SIN signal (los pedidos
// sueltos de acá: `req`, el keep-alive). Los que salen por el ArbiterClient ya
// traen el suyo, y por eso el margen va también en `timeoutMs`: sin eso el SDK
// imponía su default corto (15 s) a TODA la web y el visitante que llegaba con
// el árbitro dormido veía un error en vez de esperar a que despierte.
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) });

const client = new ArbiterClient(BASE, {
  fetchImpl: fetchWithTimeout,
  timeoutMs: FETCH_TIMEOUT_MS,
});

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

/** Crea un duelo directo (ladder gratis) contra un agente. Humano→agente:
 *  { challenger, targetAgentId, signature, ts }. Agente→agente:
 *  { byAgentId, targetAgentId, signature, ts }. Devuelve la partida creada. */
export function createChallenge(
  input:
    | { challenger: string; targetAgentId: string; signature: string; ts: number }
    | { byAgentId: string; targetAgentId: string; signature: string; ts: number },
): Promise<MatchView> {
  return req<MatchView>("/challenge", { method: "POST", body: JSON.stringify(input) });
}

export function getMatch(id: string, address?: string) {
  return client.getMatch(id, address);
}

/** Pide que un bot juegue por el rival (modo práctica). No forma parte del
 * cliente canónico del SDK (es un atajo solo de la web), así que se llama
 * directo al árbitro (con el mismo timeout que el resto: nada queda colgado). */
export function playBot(id: string): Promise<MatchView> {
  return req<MatchView>(`/match/${encodeURIComponent(id)}/bot`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export interface LeaderRow {
  address: string;
  rating: number;
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
  byo?: boolean;
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
  house?: boolean;
  byo?: boolean;
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
  // Display del RIVAL (nombre/avatar), resuelto por el árbitro; el address
  // corto queda de fallback en la UI.
  name?: string;
  avatar?: string;
  house?: boolean;
  byo?: boolean;
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
  players: {
    address: string;
    score?: number;
    name?: string;
    avatar?: string;
    house?: boolean;
    byo?: boolean;
  }[];
  outcome?: "p1" | "p2" | "draw";
  winner?: string;
  createdAt: number;
}

export interface PublicReplay extends RecentMatch {
  seed: number;
  players: {
    address: string;
    score?: number;
    replay?: unknown;
    name?: string;
    avatar?: string;
    house?: boolean;
    byo?: boolean;
  }[];
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
  /** Embudo (v4.1): agentes creados por terceros y partidas por origen. */
  agentsCreated: number;
  settledHouse: number;
  settledMixed: number;
  settledThird: number;
}

/** Snapshot del monitor de gas del árbitro (público y seguro: sin secretos). */
export interface GasView {
  enabled: boolean;
  address?: string;
  balanceEth?: string;
  thresholdEth?: string;
  low?: boolean;
  checkedAt?: number;
  error?: string;
}

export interface StatsView {
  startedAt: number;
  uptimeSeconds: number;
  since: number;
  totals: StatsCounters;
  today: StatsCounters;
  activeAgents: number;
  daily: Array<{ date: string } & StatsCounters>;
  /** Ausente en árbitros viejos; enabled=false cuando el monitor no corre. */
  gas?: GasView;
}

export function getStats(): Promise<StatsView> {
  return req("/stats");
}

// ------------------------------------------------------------------------- //
// PERFILES humanos: nombre + avatar por wallet (editar va FIRMADO por el dueño).
// ------------------------------------------------------------------------- //

export interface Profile {
  name: string;
  avatar: string;
  updatedAt: number;
}

export async function getProfile(address: string): Promise<Profile | null> {
  const out = await req<{ profile: Profile | null }>(`/profile/${encodeURIComponent(address)}`);
  return out.profile;
}

export function setProfile(input: {
  address: string;
  name: string;
  avatar: string;
  signature: string;
  ts: number;
}): Promise<Profile> {
  return req<{ profile: Profile }>("/profile", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((o) => o.profile);
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

// ------------------------------------------------------------------------- //
// ALEPH (formato multi-agente). La web MIRA: siempre la vista pública, nunca
// firma un pase de vista. Tres métodos ya viven en el cliente canónico del
// SDK; `recent` todavía no, así que va por `req` (como /challenge y /bot).
// ------------------------------------------------------------------------- //

export type { AlephLobby, AlephRoomView, AlephLog } from "@arcade1v1/agent-sdk";

/** Una sala ya liquidada, como la lista `GET /aleph/recent`. Espeja
 *  `RecentRoom` de apps/server/src/aleph.ts. */
export interface RecentAlephRoom {
  roomId: string;
  stake: number;
  seats: string[];
  startedAt?: number;
  settledAt?: number;
  stages: number;
  payouts?: Record<string, number>;
}

export function getAlephLobbies(): Promise<AlephLobby[]> {
  return client.alephLobbies();
}

/** Vista pública de una sala. `null` significa "no se pudo traer la sala", no
 *  estrictamente "no existe": el catch de abajo se traga TODO error, así que
 *  un 404 real del árbitro cae en el mismo `null` que una caída de red o un
 *  timeout del host dormido. Es a propósito — la página de sala trata `null`
 *  como "no está" y muestra su propio cartel, sea cual sea la causa — pero si
 *  algún consumidor necesita distinguir un 404 de una caída, tiene que
 *  cambiar esta función: no asumir que `null` es sinónimo de "sala
 *  inexistente". */
export async function getAlephRoom(roomId: string): Promise<AlephRoomView | null> {
  try {
    return await client.alephView(roomId);
  } catch {
    return null;
  }
}

export function getAlephLog(roomId: string): Promise<AlephLog> {
  return client.alephLog(roomId);
}

export async function getRecentAlephRooms(limit = 20): Promise<RecentAlephRoom[]> {
  const out = await req<{ rooms: RecentAlephRoom[] }>(`/aleph/recent?limit=${limit}`);
  return out.rooms ?? [];
}
