// Cliente HTTP portable del árbitro de Arcade1v1 (sin Next.js: sirve en Node,
// navegador, agentes). Inyectable: se le puede pasar un fetch propio para tests.

import type {
  Phase,
  SeatStatus,
  AlephAction,
  AlephEvent,
  AlephView,
} from "@arcade1v1/game-sdk/aleph";
import type { FlappyLiveCommit, FlappyLiveReply } from "@arcade1v1/game-sdk/flappy-live";

export interface MatchView {
  matchId: string;
  game: string;
  stake: number;
  /** No viene en los juegos EN VIVO: su azar sale de un secreto (ver `secretHash`). */
  seed?: number;
  /** Juego en vivo: se juega con `liveStart`/`liveCommit` (o `playAndSubmit`,
   *  que ya lo hace), porque el azar llega de a poco. */
  live?: boolean;
  /** En vivo: el SHA-256 del secreto del azar, público desde que se empareja. */
  secretHash?: string;
  /** En vivo y con la partida decidida: el secreto, para re-verificar con
   *  `verifyFlappyLive` y comprobar que su hash es `secretHash`. */
  secret?: string;
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
  /** Firma del resultado (EIP-712). En una mesa de plata la presenta el propio
   *  árbitro al contrato; sale recién cuando la decisión quedó guardada. */
  signature?: string;
  /** Hasta cuándo vale `signature` (segundos, epoch): va como `deadline` en
   *  `settle`. Vence justo cuando el contrato abre el reembolso. */
  signatureDeadline?: number;
  /** Asiento firmado por el árbitro: autoriza a ESTE jugador a depositar
   *  (open/join) en esta partida, con ESTAS condiciones. Solo en mesas de plata
   *  con escrow activo. El contrato lo exige para atar al rival on-chain
   *  (anti-secuestro de slot) y para que quien abre no invente los plazos. */
  seatSig?: string;
  /** Mesa de plata: los plazos on-chain que ata el asiento (segundos, epoch).
   *  `open` va con estos. */
  fundDeadline?: number;
  playDeadline?: number;
  /** Mesa de plata: el hash del `settle` con el que el árbitro pagó. */
  settleTx?: string;
  /** Mesa de plata cerrada sin `settle` del árbitro: la pagó otro con la misma
   *  firma ("external"), se reembolsó ("refunded"), o la firma venció sin
   *  presentarse y el árbitro la reembolsó ("expired"). */
  settleOutcome?: "external" | "refunded" | "expired";
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

/** Abrir (o retomar) un intento en vivo. Con `over: true` el intento ya estaba
 *  cerrado: no hay token, solo el puntaje que quedó. */
export type LiveStartView =
  | {
      over: false;
      token: string;
      tick: number;
      flaps: number[];
      reveal: number[];
      revealed: number;
    }
  | { over: true; score: number; tick: number };

/** Un compromiso con su token (el token sale de `liveStart`). */
export type LiveCommitBody = FlappyLiveCommit & { token: string };

/** La respuesta a un compromiso; con `conflict: true` hay que seguir desde `tick`. */
export type LiveCommitView = FlappyLiveReply;

/** Un error del árbitro con su código HTTP en `status`. Quien juega en vivo lo
 *  usa para separar lo pasajero (429, 5xx), que se reintenta, de un rechazo
 *  (ver `isRetriableLiveError` en `@arcade1v1/game-sdk/flappy-live`). */
function arbiterError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Un 409 que no trae el conflicto del protocolo (un proxy, por ejemplo) no es
 *  una resincronización: se deja pasar al error de siempre. */
function parseOrUndefined(text: string): { conflict?: boolean } | undefined {
  try {
    return JSON.parse(text) as { conflict?: boolean };
  } catch {
    return undefined;
  }
}

// ---- Aleph (formato multi-agente) ------------------------------------------

export type AlephRoomStatus = "lobby" | "funding" | "playing" | "settled" | "dissolved";

/** Lo que un asiento necesita para depositar en una mesa de plata. Llega en
 *  la vista PRIVADA mientras la sala está en `funding`. Deadlines en SEGUNDOS
 *  (como los lee el contrato); `stake` en micro-USDC como string. */
export interface AlephDeposit {
  chainId: number;
  escrow: string;
  usdc: string;
  stake: string;
  seats: string[];
  seatsHash: string;
  fundDeadline: number;
  playDeadline: number;
  seatSig: string;
}

/** Un asiento como lo sirve el árbitro: estado y bolsillo del motor más la
 *  ficha pública que resuelve `resolveDisplay` (nombre/avatar si el dueño los
 *  cargó; `house`/`byo` si es un agente hosteado). */
export interface AlephSeatView {
  address: string;
  status: SeatStatus;
  pocket: number;
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
  byo?: boolean;
  /** El modelo de IA que DECLARÓ al sentarse (normalizado). Nadie lo verifica. */
  model?: string;
}

/** Por qué una liquidación quedó CERRADA sin transacción del árbitro:
 *  `external` = otro presentó la tabla (la firma es pública, cualquiera puede);
 *  `refunded` = la sala terminó reembolsada y ya no hay nada que pagar. */
export type AlephSettleOutcome = "external" | "refunded";

/** Por qué un reembolso quedó CERRADO sin transacción del árbitro:
 *  `none` = nadie llegó a depositar (la sala ni existe on-chain);
 *  `external` = alguien pidió el reembolso permissionless antes;
 *  `settled` = la sala ya estaba liquidada (no debería pasar, queda anotado). */
export type AlephRefundOutcome = "none" | "external" | "settled";

/** La vista de una sala tal como la devuelven `GET /aleph/:id`, `POST
 *  /aleph/join` y `POST /aleph/:id/act`. Espeja `AlephRoomView` de
 *  apps/server/src/aleph.ts: los campos de sala los pone el árbitro; el resto
 *  es la vista del motor (`AlephView`) y solo viene con la sala en juego o
 *  terminada. `you` (tu estado, tu fragmento, si ya decidiste) solo llega con
 *  un pase de vista válido o en las respuestas de join/act, que ya van firmadas. */
export type AlephRoomView = {
  roomId: string;
  stake: number;
  status: AlephRoomStatus;
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
  /** `funding` (mesa de plata): cuándo vence el fondeo (epoch ms) */
  fundingDeadline?: number;
  /** `funding`: quién ya depositó (minúsculas) */
  deposited?: string[];
  /** `funding`, solo en tu vista privada: con qué depositar */
  deposit?: AlephDeposit;
  /** stake > 0: el contrato que custodia la mesa */
  escrow?: string;
  /** `settled`, stake > 0: la tabla en micro-USDC, su firma y la transacción */
  payoutsUsdc?: Record<string, string>;
  /** La firma aparece recién cuando el árbitro la guardó; hasta `payoutDeadline`
   *  (segundos) cualquiera puede presentarla en `settle`. Vencida, el árbitro
   *  firma de nuevo la misma tabla. */
  payoutSig?: string;
  payoutDeadline?: number;
  /** `settled`, stake > 0: el hash, cuando lo mandó el árbitro. Sin este pero
   *  con `settleOutcome`, la sala está saldada igual: la firma es pública y
   *  `settle` es permissionless, así que "external" no es un error, es un pago
   *  que llegó por una transacción de otro. */
  settleTx?: string;
  settleOutcome?: AlephSettleOutcome;
  /** `dissolved`, stake > 0: el hash del `cancelRoom` del árbitro. Sin este
   *  pero con `refundOutcome`, la plata también está resuelta (alguien más la
   *  pidió, nadie llegó a depositar, o la sala ya estaba liquidada). */
  refundTx?: string;
  refundOutcome?: AlephRefundOutcome;
  seats: AlephSeatView[];
} & Partial<Omit<AlephView, "seats">>;

export interface AlephLobby {
  roomId: string;
  stake: number;
  /** `lobby`: esperando asientos; `funding`: lista congelada, esperando depósitos */
  status: "lobby" | "funding";
  seats: number;
  deposited?: number;
  min: number;
  max: number;
  closesAt: number;
}

/** Una sala EN JUEGO (`GET /aleph/lobbies` → `playing`): para mirarla con
 *  `alephView(roomId)`. Solo datos públicos. */
export interface AlephPlaying {
  roomId: string;
  stake: number;
  seats: number;
  /** Cuántos asientos siguen vivos. */
  alive: number;
  stage: { index: number; kind: AlephView["stage"]["kind"]; phase: AlephView["stage"]["phase"] };
  startedAt: number;
  /** Fin de la fase en curso (epoch ms). */
  deadline: number;
}

/** Una fila de la tabla por modelo (`GET /aleph/models`): lo que DECLARARON
 *  los agentes al sentarse, sumado al liquidar cada sala. */
export interface AlephModelRow {
  model: string;
  /** Partidas (asiento-sala) jugadas con ese modelo. */
  games: number;
  /** Pago promedio por partida, en unidades: cada asiento pone 1000. */
  avgPayout: number;
  /** Traiciones sobre oportunidades (Cerradura + Final); `rate` null sin ninguna. */
  betrayal: { chances: number; count: number; rate: number | null };
  lock: { chances: number; betrayals: number };
  final: { played: number; steals: number };
  firstAt: number;
  lastAt: number;
}

/** Registro completo de una sala terminada (`GET /aleph/:id/log`): lo que
 *  re-simula cualquier verificador. */
export interface AlephLog {
  roomId: string;
  stake: number;
  rulesV: number;
  seats: string[];
  commit: string;
  secretSeed: string;
  startedAt?: number;
  settledAt?: number;
  events: AlephEvent[];
  payouts: Record<string, number>;
  /** dirección -> modelo que declaró al sentarse (sin campo: nadie declaró). */
  models?: Record<string, string>;
  /** Solo mesas de plata: la parte en USDC del registro. */
  usdc?: {
    escrow: string;
    chainId: number;
    feeBps?: number;
    table?: Record<string, string>;
    signature?: string;
    /** Hasta cuándo vale `signature` (segundos, como el contrato). */
    deadline?: number;
    settleTx?: string;
    /** Sin `settleTx` pero con esto, igual saldada (ver `AlephSettleOutcome`). */
    settleOutcome?: AlephSettleOutcome;
  };
}

/** Pase de vista: firma de `alephViewAuthMessage(roomId, address, ts)`. */
export interface AlephViewPass {
  address: string;
  signature: string;
  ts: number;
}

/** Una acción firmada: firma de `alephActionAuthMessage(roomId, stage, phase,
 *  actionLine(action), ts)`. `stage` y `phase` salen de la vista. */
export interface AlephActBody {
  stage: number;
  phase: Phase;
  action: AlephAction;
  signature: string;
  ts: number;
}

/** Cuánto espera cada pedido, ya con el árbitro despierto, antes de darse por
 *  perdido. Sin tope, una conexión colgada bloquea el `await` hasta el timeout
 *  por defecto del runtime (minutos), y un agente de Aleph que sondea cada 5 s
 *  pierde fases enteras sin enterarse. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Cuánto espera el PRIMER pedido, que es el que puede tener que despertar al
 *  árbitro: corre en un host gratuito que se duerme por inactividad y cuyo
 *  arranque en frío medido es 42,4 s (el incidente del CHANGELOG 3.6.0: el
 *  keep-alive fallaba 96 de cada 100 corridas por un tope más corto que ese
 *  arranque). Con el tope de régimen, ese primer pedido falla siempre y el
 *  usuario ve un error donde solo había que esperar. 75 s es el margen que la
 *  web venía usando. */
export const COLD_START_TIMEOUT_MS = 75_000;

/** Cuánto se reintenta, en total, un pedido que el árbitro contesta con 503.
 *  Durante un deploy la instancia que entrega (y la que todavía carga) contesta
 *  503 con `Retry-After` a todo: el pedido NO se procesó, así que reintentarlo
 *  es seguro. Con el traspaso por timbre la pausa dura segundos; si pasa del
 *  tope, el 503 sale como error. */
export const UNAVAILABLE_RETRY_MS = 30_000;

/** Cuánto esperar antes de reintentar un 503: lo que diga `Retry-After` en
 *  segundos, entre 250 ms (un "0" no puede volverse un bucle sin pausa) y
 *  10 s; o 2 s si no dice nada legible. */
function retryAfterMs(header: string | null): number {
  const s = header === null ? NaN : Number(header);
  if (!Number.isFinite(s) || s < 0) return 2_000;
  return Math.min(Math.max(s * 1_000, 250), 10_000);
}

export interface ArbiterClientOptions {
  fetchImpl?: typeof fetch;
  /** Tiempo total para reintentar un 503 (árbitro reiniciándose), respetando
   *  `Retry-After` (default `UNAVAILABLE_RETRY_MS`). 0 lo desactiva. Solo el
   *  503: otro 5xx pudo haberse procesado y no se reintenta. */
  retryUnavailableMs?: number;
  /** Tope por pedido en ms (default `DEFAULT_TIMEOUT_MS`). 0 lo desactiva. */
  timeoutMs?: number;
  /** Tope del primer pedido, hasta que el árbitro conteste una vez (default
   *  `COLD_START_TIMEOUT_MS`, o `timeoutMs` si quien construye el cliente lo
   *  fijó a mano: un tope explícito es un techo, nunca se lo pasa por arriba). */
  coldStartTimeoutMs?: number;
}

export class ArbiterClient {
  private base: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private coldStartTimeoutMs: number;
  private retryUnavailableMs: number;
  /** ¿Ya contestó el árbitro alguna vez? Hasta entonces puede estar dormido. */
  private awake = false;

  constructor(baseUrl: string, opts: ArbiterClientOptions = {}) {
    this.base = baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.coldStartTimeoutMs =
      opts.coldStartTimeoutMs ??
      (opts.timeoutMs === undefined ? COLD_START_TIMEOUT_MS : this.timeoutMs);
    this.retryUnavailableMs = opts.retryUnavailableMs ?? UNAVAILABLE_RETRY_MS;
  }

  /** Tope de ESTE pedido: el largo mientras el árbitro no haya dado señales de
   *  vida, el de régimen después. Así el sondeo del loop sigue acotado corto
   *  sin que el primer pedido muera contra un host dormido. */
  private budgetMs(): number {
    return this.awake ? this.timeoutMs : this.coldStartTimeoutMs;
  }

  /** `init` con el tope de tiempo puesto. Se le agrega a TODO pedido, GET
   *  incluido: un GET colgado es el que más duele (es el sondeo).
   *
   *  Si quien llama ya trajo su propio `signal`, se COMBINAN en vez de pisarlo:
   *  pisarlo en silencio es lo que rompió a la web (su fetch inyectado daba 75 s
   *  solo cuando el init venía sin signal, y este método se lo ponía siempre,
   *  así que todo pedido de la web cortaba con el tope del SDK). Un tope de acá
   *  nunca puede cancelar el control que el llamador ya tenía sobre su pedido. */
  private init(init: RequestInit = {}): RequestInit {
    if (this.timeoutMs <= 0) return init;
    const timeout = AbortSignal.timeout(this.budgetMs());
    return {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    };
  }

  /** Un pedido cortado por el tope de tiempo llega acá como `TimeoutError`
   *  (o `AbortError`): se traduce a un mensaje que nombra la ruta, porque el
   *  del runtime no dice contra qué se estaba hablando. `label` nunca lleva el
   *  query string (ahí viaja el pase de vista: ver `get`). */
  private async fetchWithTimeout(
    url: string,
    label: string,
    init?: RequestInit,
  ): Promise<Response> {
    // 503 = el árbitro se está reiniciando (deploy) y el pedido no se procesó:
    // se reintenta el MISMO pedido mientras la espera entre en el tope. Si no
    // entra, vuelve el 503 y quien llamó lo convierte en error como siempre.
    const t0 = Date.now();
    for (;;) {
      const r = await this.fetchOnce(url, label, init);
      if (r.status !== 503) return r;
      const wait = retryAfterMs(r.headers.get("Retry-After"));
      if (this.retryUnavailableMs <= 0 || Date.now() - t0 + wait > this.retryUnavailableMs) {
        return r;
      }
      await r.body?.cancel().catch(() => {});
      await new Promise((ok) => setTimeout(ok, wait));
    }
  }

  private async fetchOnce(url: string, label: string, init?: RequestInit): Promise<Response> {
    const budget = this.budgetMs();
    try {
      const r = await this.fetchImpl(url, this.init(init));
      // Contestó (aunque sea un 4xx): el host está despierto, los pedidos que
      // siguen ya no necesitan el margen del arranque en frío.
      this.awake = true;
      return r;
    } catch (e) {
      const name = (e as { name?: string } | null | undefined)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`arbiter ${label} timeout after ${budget}ms`, { cause: e });
      }
      throw e;
    }
  }

  private async post<T = MatchView>(path: string, body: unknown): Promise<T> {
    const r = await this.fetchWithTimeout(`${this.base}${path}`, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw arbiterError(`arbiter ${path} ${r.status}: ${await r.text()}`, r.status);
    return (await r.json()) as T;
  }

  /** GET con el motivo del árbitro en el error: un 400 de Aleph ("room not
   *  settled yet", "stage or phase mismatch") le sirve al agente para decidir
   *  qué hacer, no solo el código. El mensaje NUNCA lleva el query string: en
   *  `alephView` ahí viaja el pase de vista completo (address+signature+ts), una
   *  credencial portadora que `verifySigned` no consume ni marca como usada
   *  (apps/server/src/aleph.ts) — sigue siendo válida y repetible durante los
   *  MATCHMAKE_AUTH_TTL_MS de la firma. Filtrarla en un error de log expondría
   *  la vista PRIVADA de ese asiento a cualquiera que lo lea. */
  private async get<T>(path: string): Promise<T> {
    const label = path.split("?")[0];
    const r = await this.fetchWithTimeout(`${this.base}${path}`, label);
    if (!r.ok) {
      throw arbiterError(`arbiter ${label} ${r.status}: ${await r.text()}`, r.status);
    }
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

  /** Abre o retoma TU intento en vivo. `auth` es la firma de
   *  `liveStartAuthMessage(matchId, address, ts)`: obligatoria en producción. */
  liveStart(
    id: string,
    address: string,
    auth?: { signature: string; ts: number },
  ): Promise<LiveStartView> {
    return this.post<LiveStartView>(`/match/${id}/live/start`, { address, ...(auth ?? {}) });
  }

  /** Compromete las jugadas de `[from, to)` y devuelve el azar que sigue. Un 409
   *  NO es un error: es el árbitro diciendo en qué tick está, con los valores
   *  para resincronizar, y vuelve como `conflict: true`. */
  async liveCommit(id: string, address: string, body: LiveCommitBody): Promise<LiveCommitView> {
    const path = `/match/${id}/live/commit`;
    const r = await this.fetchWithTimeout(`${this.base}${path}`, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, ...body }),
    });
    const text = await r.text();
    if (r.status === 409) {
      const reply = parseOrUndefined(text);
      if (reply?.conflict === true) return reply as LiveCommitView;
    }
    if (!r.ok) throw arbiterError(`arbiter ${path} ${r.status}: ${text}`, r.status);
    return JSON.parse(text) as LiveCommitView;
  }

  async getMatch(id: string, address?: string): Promise<MatchView> {
    const q = address ? `?address=${address}` : "";
    const r = await this.fetchWithTimeout(`${this.base}/match/${id}${q}`, `get /match/${id}`);
    if (!r.ok) throw arbiterError(`arbiter get ${r.status}`, r.status);
    return (await r.json()) as MatchView;
  }

  async leaderboard(game: string, limit = 20): Promise<LeaderRow[]> {
    const r = await this.fetchWithTimeout(
      `${this.base}/leaderboard/${game}?limit=${limit}`,
      `leaderboard/${game}`,
    );
    if (!r.ok) throw arbiterError(`arbiter leaderboard ${r.status}`, r.status);
    const j = (await r.json()) as { top?: LeaderRow[] };
    return j.top ?? [];
  }

  async rating(address: string): Promise<Record<string, number>> {
    const r = await this.fetchWithTimeout(`${this.base}/rating/${address}`, `rating/${address}`);
    if (!r.ok) throw arbiterError(`arbiter rating ${r.status}`, r.status);
    const j = (await r.json()) as { ratings?: Record<string, number> };
    return j.ratings ?? {};
  }

  // ---- Aleph ------------------------------------------------------------

  async alephLobbies(): Promise<AlephLobby[]> {
    const j = await this.get<{ lobbies?: AlephLobby[] }>("/aleph/lobbies");
    return j.lobbies ?? [];
  }

  /** Lobbies + las salas en juego + las mesas (stakes) que acepta este
   *  árbitro. Un árbitro anterior a la etapa 4 no manda `stakes` (se asume
   *  solo la gratis), y uno anterior a 3.11 no manda `playing` (lista vacía). */
  async alephLobbiesInfo(): Promise<{
    lobbies: AlephLobby[];
    playing: AlephPlaying[];
    stakes: number[];
  }> {
    const j = await this.get<{
      lobbies?: AlephLobby[];
      playing?: AlephPlaying[];
      stakes?: number[];
    }>("/aleph/lobbies");
    return { lobbies: j.lobbies ?? [], playing: j.playing ?? [], stakes: j.stakes ?? [0] };
  }

  /** Pedir asiento. `auth` = firma de matchmakeAuthMessage("aleph", stake,
   *  address, ts); obligatoria en producción. Idempotente por address. */
  alephJoin(
    stake: number,
    address: string,
    auth?: { signature: string; ts: number },
    model?: string,
  ): Promise<AlephRoomView> {
    return this.post<AlephRoomView>("/aleph/join", {
      stake,
      address,
      ...(auth ?? {}),
      ...(model ? { model } : {}),
    });
  }

  /** La tabla por modelo. Un árbitro anterior a 3.11 no la tiene: lista vacía. */
  async alephModels(): Promise<AlephModelRow[]> {
    const j = await this.get<{ models?: AlephModelRow[] }>("/aleph/models");
    return j.models ?? [];
  }

  /** Vista de la sala. Con `pass` (firma de alephViewAuthMessage) llega la vista
   *  PRIVADA de ese asiento; sin pase válido, la pública. */
  alephView(roomId: string, pass?: AlephViewPass): Promise<AlephRoomView> {
    const q = pass
      ? "?" +
        new URLSearchParams({
          address: pass.address,
          signature: pass.signature,
          ts: String(pass.ts),
        }).toString()
      : "";
    return this.get<AlephRoomView>(`/aleph/${roomId}${q}`);
  }

  /** Una acción firmada. La respuesta es la vista privada actualizada. */
  alephAct(roomId: string, address: string, body: AlephActBody): Promise<AlephRoomView> {
    return this.post<AlephRoomView>(`/aleph/${roomId}/act`, { address, ...body });
  }

  /** Registro completo; antes de `settled` el árbitro responde 400. */
  alephLog(roomId: string): Promise<AlephLog> {
    return this.get<AlephLog>(`/aleph/${roomId}/log`);
  }
}
