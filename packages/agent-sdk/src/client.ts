// Cliente HTTP portable del árbitro de Arcade1v1 (sin Next.js: sirve en Node,
// navegador, agentes). Inyectable: se le puede pasar un fetch propio para tests.

import type {
  Phase,
  SeatStatus,
  VaultAction,
  VaultEvent,
  VaultView,
} from "@arcade1v1/game-sdk/vault";

export interface MatchView {
  matchId: string;
  game: string;
  stake: number;
  seed: number;
  /** Versión de reglas del juego en esta partida (el SDK nuevo la valida). */
  rulesV?: number;
  status: "waiting" | "ready" | "settled" | "draw";
  role?: "p1" | "p2";
  opponent?: string;
  /** Hasta que la partida se decide, solo aparece TU puntaje (anti-espionaje). */
  scores: Record<string, number>;
  /** ¿El rival ya envió su intento? (sin revelar el puntaje hasta decidir). */
  rivalSubmitted?: boolean;
  outcome?: "p1" | "p2" | "draw";
  winner?: string;
  signature?: string;
  /** Asiento firmado por el árbitro: autoriza a ESTE jugador a depositar
   *  (open/join) en esta partida. Solo en mesas de plata con escrow activo.
   *  El contrato lo exige para atar al rival on-chain (anti-secuestro de slot). */
  seatSig?: string;
  yourScore?: number;
  rivalScore?: number;
  margin?: number;
  netPnl?: number;
  rivalReplay?: unknown;
  rating?: number;
  ratingDelta?: number;
}

export interface LeaderRow {
  address: string;
  rating: number;
}

// ---- La Bóveda (formato multi-agente) ------------------------------------------

export type VaultRoomStatus = "lobby" | "playing" | "settled" | "dissolved";

/** Un asiento como lo sirve el árbitro: estado y bolsillo del motor más la
 *  ficha pública que resuelve `resolveDisplay` (nombre/avatar si el dueño los
 *  cargó; `house`/`byo` si es un agente hosteado). */
export interface VaultSeatView {
  address: string;
  status: SeatStatus;
  pocket: number;
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
  byo?: boolean;
}

/** La vista de una sala tal como la devuelven `GET /vault/:id`, `POST
 *  /vault/join` y `POST /vault/:id/act`. Espeja `VaultRoomView` de
 *  apps/server/src/vault.ts: los campos de sala los pone el árbitro; el resto
 *  es la vista del motor (`VaultView`) y solo viene con la sala en juego o
 *  terminada. `you` (tu estado, tu fragmento, si ya decidiste) solo llega con
 *  un pase de vista válido o en las respuestas de join/act, que ya van firmadas. */
export type VaultRoomView = {
  roomId: string;
  stake: number;
  status: VaultRoomStatus;
  rulesV: number;
  min: number;
  max: number;
  createdAt: number;
  /** lobby/dissolved: cuándo arranca o se disuelve */
  closesAt?: number;
  startedAt?: number;
  settledAt?: number;
  commit?: string;
  /** solo `settled` */
  secretSeed?: string;
  /** fin de la fase actual (epoch ms) */
  deadline?: number;
  /** `settled`, para el asiento que consulta con pase */
  rating?: { before: number; after: number; delta: number };
  seats: VaultSeatView[];
} & Partial<Omit<VaultView, "seats">>;

export interface VaultLobby {
  roomId: string;
  stake: number;
  seats: number;
  min: number;
  max: number;
  closesAt: number;
}

/** Registro completo de una sala terminada (`GET /vault/:id/log`): lo que
 *  re-simula cualquier verificador. */
export interface VaultLog {
  roomId: string;
  stake: number;
  rulesV: number;
  seats: string[];
  commit: string;
  secretSeed: string;
  startedAt?: number;
  settledAt?: number;
  events: VaultEvent[];
  payouts: Record<string, number>;
}

/** Pase de vista: firma de `vaultViewAuthMessage(roomId, address, ts)`. */
export interface VaultViewPass {
  address: string;
  signature: string;
  ts: number;
}

/** Una acción firmada: firma de `vaultActionAuthMessage(roomId, stage, phase,
 *  actionLine(action), ts)`. `stage` y `phase` salen de la vista. */
export interface VaultActBody {
  stage: number;
  phase: Phase;
  action: VaultAction;
  signature: string;
  ts: number;
}

export interface ArbiterClientOptions {
  fetchImpl?: typeof fetch;
}

export class ArbiterClient {
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(baseUrl: string, opts: ArbiterClientOptions = {}) {
    this.base = baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post<T = MatchView>(path: string, body: unknown): Promise<T> {
    const r = await this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`arbiter ${path} ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }

  /** GET con el motivo del árbitro en el error: un 400 de La Bóveda ("room not
   *  settled yet", "stage or phase mismatch") le sirve al agente para decidir
   *  qué hacer, no solo el código. */
  private async get<T>(path: string): Promise<T> {
    const r = await this.fetchImpl(`${this.base}${path}`);
    if (!r.ok) throw new Error(`arbiter ${path} ${r.status}: ${await r.text()}`);
    return (await r.json()) as T;
  }

  /** `auth` (firma de matchmakeAuthMessage + su ts) es obligatoria cuando el
   *  árbitro corre en producción; en dev puede omitirse. */
  matchmake(
    game: string,
    stake: number,
    address: string,
    auth?: { signature: string; ts: number },
  ): Promise<MatchView> {
    return this.post("/matchmake", { game, stake, address, ...(auth ?? {}) });
  }

  submitScore(
    id: string,
    address: string,
    score: number,
    replay?: unknown,
    signature?: string,
  ): Promise<MatchView> {
    return this.post(`/match/${id}/score`, { address, score, replay, signature });
  }

  async getMatch(id: string, address?: string): Promise<MatchView> {
    const q = address ? `?address=${address}` : "";
    const r = await this.fetchImpl(`${this.base}/match/${id}${q}`);
    if (!r.ok) throw new Error(`arbiter get ${r.status}`);
    return (await r.json()) as MatchView;
  }

  async leaderboard(game: string, limit = 20): Promise<LeaderRow[]> {
    const r = await this.fetchImpl(`${this.base}/leaderboard/${game}?limit=${limit}`);
    if (!r.ok) throw new Error(`arbiter leaderboard ${r.status}`);
    const j = (await r.json()) as { top?: LeaderRow[] };
    return j.top ?? [];
  }

  async rating(address: string): Promise<Record<string, number>> {
    const r = await this.fetchImpl(`${this.base}/rating/${address}`);
    if (!r.ok) throw new Error(`arbiter rating ${r.status}`);
    const j = (await r.json()) as { ratings?: Record<string, number> };
    return j.ratings ?? {};
  }

  // ---- La Bóveda ------------------------------------------------------------

  async vaultLobbies(): Promise<VaultLobby[]> {
    const j = await this.get<{ lobbies?: VaultLobby[] }>("/vault/lobbies");
    return j.lobbies ?? [];
  }

  /** Pedir asiento. `auth` = firma de matchmakeAuthMessage("vault", stake,
   *  address, ts); obligatoria en producción. Idempotente por address. */
  vaultJoin(
    stake: number,
    address: string,
    auth?: { signature: string; ts: number },
  ): Promise<VaultRoomView> {
    return this.post<VaultRoomView>("/vault/join", { stake, address, ...(auth ?? {}) });
  }

  /** Vista de la sala. Con `pass` (firma de vaultViewAuthMessage) llega la vista
   *  PRIVADA de ese asiento; sin pase válido, la pública. */
  vaultView(roomId: string, pass?: VaultViewPass): Promise<VaultRoomView> {
    const q = pass
      ? "?" +
        new URLSearchParams({
          address: pass.address,
          signature: pass.signature,
          ts: String(pass.ts),
        }).toString()
      : "";
    return this.get<VaultRoomView>(`/vault/${roomId}${q}`);
  }

  /** Una acción firmada. La respuesta es la vista privada actualizada. */
  vaultAct(roomId: string, address: string, body: VaultActBody): Promise<VaultRoomView> {
    return this.post<VaultRoomView>(`/vault/${roomId}/act`, { address, ...body });
  }

  /** Registro completo; antes de `settled` el árbitro responde 400. */
  vaultLog(roomId: string): Promise<VaultLog> {
    return this.get<VaultLog>(`/vault/${roomId}/log`);
  }
}
