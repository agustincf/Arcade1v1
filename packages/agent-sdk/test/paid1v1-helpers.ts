// packages/agent-sdk/test/paid1v1-helpers.ts
// Lo que comparten las pruebas del flujo pagado (SDK y MCP): las claves de
// prueba, los asientos firmados por un árbitro de prueba sobre el dominio EIP-712
// real, y un árbitro falso que empareja según un guion y sirve una partida de
// Carrera EN VIVO de verdad (el azar sale de un SecretSource, como en el árbitro).
// No es un *.test.ts: `npm test` no lo corre.
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { SecretSource, liveSecretHash } from "@arcade1v1/game-sdk/live";
import { SEAT_TYPES, seatDomain } from "@arcade1v1/game-sdk/escrow1v1";
import {
  ArbiterClient,
  type LiveCommitBody,
  type LiveCommitView,
  type LiveStartView,
  type MatchView,
} from "../src/client.ts";

// Claves de anvil (públicas, sin valor): el agente, el árbitro y otra cualquiera.
export const AGENT_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
export const ARB_KEY =
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" as const;
export const OTHER_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;
export const ME = privateKeyToAccount(AGENT_KEY).address;
export const ARB = privateKeyToAccount(ARB_KEY).address;
export const ESCROW = ("0x" + "e5".repeat(20)) as Hex;
export const USDC = ("0x" + "5c".repeat(20)) as Hex;
export const HUMAN = ("0x" + "a1".repeat(20)) as Hex;
export const ZERO = ("0x" + "0".repeat(40)) as Hex;
export const UNITS = 1_000_000n;
export const SECRET = "c0ffee".repeat(10) + "abcd";
/** Hasta qué tick se juega en las pruebas: corto, antes del primer choque. */
export const TEST_MAX_TICKS = 30;

let idSeq = 1000;
export const newId = () => ("0x" + (++idSeq).toString(16).padStart(64, "0")) as Hex;

export function seatTerms(nowMs: number) {
  const nowS = Math.floor(nowMs / 1000);
  return { fd: nowS + 70 * 60, pd: nowS + 2 * 3600 };
}

export async function seat(
  matchId: Hex,
  t: { fd: number; pd: number },
  opts: { key?: Hex; chainId?: number; stake?: bigint } = {},
): Promise<Hex> {
  return privateKeyToAccount(opts.key ?? ARB_KEY).signTypedData({
    domain: seatDomain(opts.chainId ?? 31337, ESCROW),
    types: SEAT_TYPES,
    primaryType: "Seat",
    message: {
      matchId,
      player: ME.toLowerCase() as Hex,
      stake: opts.stake ?? UNITS,
      fundDeadline: BigInt(t.fd),
      playDeadline: BigInt(t.pd),
    },
  });
}

/** Una vista de emparejamiento de una mesa de plata de Carrera, con su asiento. */
export async function paidView(
  role: "p1" | "p2",
  nowMs: number,
  over: Partial<MatchView> & { seatKey?: Hex } = {},
): Promise<MatchView> {
  const matchId = (over.matchId as Hex) ?? newId();
  const t = seatTerms(nowMs);
  const { seatKey, ...rest } = over;
  return {
    matchId,
    game: "racing",
    stake: 1,
    live: true,
    secretHash: liveSecretHash(SECRET),
    rulesV: RULES_V.racing,
    status: role === "p1" ? "waiting" : "ready",
    role,
    opponent: role === "p2" ? HUMAN : undefined,
    scores: {},
    seatSig: await seat(matchId, t, { key: seatKey }),
    fundDeadline: t.fd,
    playDeadline: t.pd,
    ...rest,
  } as MatchView;
}

/** Un árbitro falso para el flujo pagado. `script` contesta cada emparejamiento
 *  en orden (el último se repite). Sirve una partida en vivo de verdad: el azar
 *  sale del SecretSource y el intento se cierra con `final` o al llegar a
 *  TEST_MAX_TICKS. `startFailures` hace que los primeros `live/start` contesten
 *  como el árbitro cuando todavía no ve el depósito. */
export class FakePaidArbiter extends ArbiterClient {
  public calls: string[] = [];
  public matchmakes: { game: string; stake: number; ts?: number }[] = [];
  public starts: number[] = [];
  public commits = 0;
  public healthBody: Record<string, unknown> = { ok: true, escrow: "ok", rules: { ...RULES_V } };
  public script: MatchView[] = [];
  public startFailures = 0;
  public startOver?: { score: number; tick: number };
  public finalStatus: MatchView["status"] = "waiting";
  /** Se llama en cada emparejamiento (para ver qué pasó antes en la cadena). */
  public onMatchmake?: () => void;
  private src = new SecretSource(SECRET);
  constructor(private clock: () => number = Date.now) {
    super("http://fake");
  }
  async health() {
    this.calls.push("health");
    return this.healthBody as never;
  }
  async arbiterAddress() {
    this.calls.push("arbiter");
    return ARB as string;
  }
  async matchmake(
    game: string,
    stake: number,
    _address: string,
    auth?: { signature: string; ts: number },
  ): Promise<MatchView> {
    // La ladder gratis: una partida de 2048 con semilla, como siempre.
    if (stake === 0) {
      return {
        matchId: newId(),
        game,
        stake: 0,
        seed: 777,
        status: "waiting",
        scores: {},
      } as MatchView;
    }
    this.calls.push("matchmake");
    this.onMatchmake?.();
    const i = Math.min(this.matchmakes.length, this.script.length - 1);
    this.matchmakes.push({ game, stake, ts: auth?.ts });
    return this.script[i];
  }
  async liveStart(): Promise<LiveStartView> {
    this.calls.push("liveStart");
    this.starts.push(this.clock());
    if (this.startFailures > 0) {
      this.startFailures--;
      throw Object.assign(
        new Error(
          'arbiter /match/x/live/start 400: {"error":"no on-chain deposit found for this address in this match"}',
        ),
        { status: 400 },
      );
    }
    if (this.startOver) return { over: true, ...this.startOver };
    return {
      over: false,
      token: "tk",
      tick: 0,
      reveal: this.src.slice(0, 32),
      revealed: 32,
      inputs: [],
    };
  }
  async liveCommit(_id: string, _address: string, body: LiveCommitBody): Promise<LiveCommitView> {
    this.calls.push("liveCommit");
    this.commits++;
    const over = body.final === true || body.to >= TEST_MAX_TICKS;
    return {
      tick: body.to,
      over,
      ...(over ? { score: 7 } : {}),
      reveal: this.src.slice(body.have, body.have + 32),
      revealed: body.have + 32,
    } as LiveCommitView;
  }
  async submitScore(id: string, address: string, score: number): Promise<MatchView> {
    return {
      matchId: id,
      game: "2048",
      stake: 0,
      status: "settled",
      scores: { [address]: score },
    } as MatchView;
  }
  async getMatch(id: string): Promise<MatchView> {
    this.calls.push("getMatch");
    const v = this.script.find((m) => m.matchId === id) ?? this.script[this.script.length - 1];
    return { ...v, status: this.finalStatus, scores: {} } as MatchView;
  }
}
