// Cliente HTTP portable del árbitro de Arcade1v1 (sin Next.js: sirve en Node,
// navegador, agentes). Inyectable: se le puede pasar un fetch propio para tests.

export interface MatchView {
  matchId: string;
  game: string;
  stake: number;
  seed: number;
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

  private async post(path: string, body: unknown): Promise<MatchView> {
    const r = await this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`arbiter ${path} ${r.status}: ${await r.text()}`);
    return (await r.json()) as MatchView;
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
}
