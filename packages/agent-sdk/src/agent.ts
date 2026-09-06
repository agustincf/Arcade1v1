// Helpers de alto nivel: crear un agente y "jugá y enviá" en una sola llamada.
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { ArbiterClient, type MatchView, type VaultRoomView, type VaultViewPass } from "./client";
import { randomWallet, signScore, signMatchmake, signVaultAction, signVaultView } from "./sign";
import { DEFAULT_STRATEGIES, type Strategy } from "./strategies";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { VAULT_RULES_V, type Phase, type VaultAction } from "@arcade1v1/game-sdk/vault";

/** El árbitro acepta un pase de vista por MATCHMAKE_AUTH_TTL_MS (10 min). Lo
 *  renovamos a los 8 para no quedar justo en el borde entre dos sondeos. */
export const VIEW_PASS_MAX_AGE_MS = 8 * 60_000;

export function createAgent(opts: {
  arbiterUrl?: string;
  privateKey?: Hex;
  client?: ArbiterClient;
  /** Reloj inyectable (tests): fecha los `ts` de las firmas y la edad del pase. */
  clock?: () => number;
}): {
  address: Hex;
  client: ArbiterClient;
  matchmake(game: string, stake: number): Promise<MatchView>;
  playAndSubmit(args: { game: string; stake: number; strategy?: Strategy }): Promise<MatchView>;
  /** La Bóveda: pedir asiento en la mesa gratis (firmado). Idempotente. */
  vaultJoin(stake?: number): Promise<VaultRoomView>;
  /** La Bóveda: TU vista privada, con pase de vista firmado (cacheado 8 min). */
  vaultView(roomId: string): Promise<VaultRoomView>;
  /** La Bóveda: una acción firmada. `at` (etapa/fase) sale de tu última vista;
   *  si se omite, se consulta la vista primero (un GET más). */
  vaultAct(
    roomId: string,
    action: VaultAction,
    at?: { stage: number; phase: Phase },
  ): Promise<VaultRoomView>;
} {
  const wallet = opts.privateKey
    ? { privateKey: opts.privateKey, address: privateKeyToAccount(opts.privateKey).address }
    : randomWallet();
  const client = opts.client ?? new ArbiterClient(opts.arbiterUrl ?? "http://localhost:4000");
  const clock = opts.clock ?? Date.now;

  // La wallet del SDK SOLO firma mensajes: no manda transacciones on-chain, así
  // que no puede depositar en una mesa de plata. Dejar pasar stake > 0 crea una
  // partida fantasma que nunca se fondea, y el humano que se empareja del otro
  // lado quema gas contra un contrato que revierte. Mejor fallar acá, claro.
  function assertFreeTable(stake: number): void {
    if (stake > 0) {
      throw new Error(
        `el SDK no deposita on-chain, así que no puede jugar la mesa de ${stake} USDC: ` +
          `usá stake 0 (la ladder rankeada gratis, mismo ELO) o el flujo web para mesas de plata`,
      );
    }
  }

  // Emparejar FIRMADO (el árbitro en producción lo exige: anti-suplantación).
  async function matchmake(game: string, stake: number): Promise<MatchView> {
    assertFreeTable(stake);
    const auth = await signMatchmake({
      game,
      stake,
      address: wallet.address,
      privateKey: wallet.privateKey,
    });
    return client.matchmake(game, stake, wallet.address, auth);
  }

  async function playAndSubmit(args: {
    game: string;
    stake: number;
    strategy?: Strategy;
  }): Promise<MatchView> {
    const m = await matchmake(args.game, args.stake);
    // Guard de versión: si el árbitro corre otras reglas, avisar YA (antes de
    // jugar), con el remedio. El árbitro repite este control en el submit.
    const localV = RULES_V[args.game];
    if (m.rulesV !== undefined && localV !== undefined && m.rulesV !== localV) {
      throw new Error(
        `rules version mismatch for ${args.game}: arbiter v${m.rulesV}, SDK v${localV} — update @arcade1v1 packages`,
      );
    }
    const strat = args.strategy ?? DEFAULT_STRATEGIES[args.game];
    if (!strat) throw new Error(`no hay estrategia por defecto para el juego: ${args.game}`);
    const { score, replay } = strat(m.seed);
    const signature = await signScore({
      matchId: m.matchId,
      address: wallet.address,
      score,
      privateKey: wallet.privateKey,
    });
    return client.submitScore(m.matchId, wallet.address, score, replay, signature);
  }

  // ---- La Bóveda (formato multi-agente) ------------------------------------

  async function vaultJoin(stake = 0): Promise<VaultRoomView> {
    assertFreeTable(stake);
    const auth = await signMatchmake({
      game: "vault",
      stake,
      address: wallet.address,
      privateKey: wallet.privateKey,
      ts: clock(),
    });
    const v = await client.vaultJoin(stake, wallet.address, auth);
    // Guard de versión, mismo criterio que playAndSubmit. Llega DESPUÉS de tener
    // asiento porque el lobby no publica rulesV antes: en la mesa gratis no
    // cuesta nada, el asiento mudo queda `abandoned` a las dos etapas y su
    // bolsillo (0) vuelve al pozo.
    if (v.rulesV !== VAULT_RULES_V) {
      throw new Error(
        `rules version mismatch for vault: arbiter v${v.rulesV}, SDK v${VAULT_RULES_V} — update @arcade1v1 packages`,
      );
    }
    return v;
  }

  // Un pase por sala, reutilizado mientras sirve: firmar en cada sondeo sería
  // gratis en CPU pero inútil, y el árbitro lo acepta 10 minutos.
  const passes = new Map<string, VaultViewPass>();
  async function viewPass(roomId: string): Promise<VaultViewPass> {
    const now = clock();
    const cached = passes.get(roomId);
    if (cached && now - cached.ts < VIEW_PASS_MAX_AGE_MS) return cached;
    for (const [id, p] of passes) if (now - p.ts >= VIEW_PASS_MAX_AGE_MS) passes.delete(id);
    const { signature, ts } = await signVaultView({
      roomId,
      address: wallet.address,
      privateKey: wallet.privateKey,
      ts: now,
    });
    const pass = { address: wallet.address, signature, ts };
    passes.set(roomId, pass);
    return pass;
  }

  async function vaultView(roomId: string): Promise<VaultRoomView> {
    return client.vaultView(roomId, await viewPass(roomId));
  }

  async function vaultAct(
    roomId: string,
    action: VaultAction,
    at?: { stage: number; phase: Phase },
  ): Promise<VaultRoomView> {
    let where = at;
    if (!where) {
      const v = await vaultView(roomId);
      if (v.status !== "playing" || !v.stage) {
        throw new Error(`room ${roomId} is not playing (${v.status})`);
      }
      where = { stage: v.stage.index, phase: v.stage.phase };
    }
    const { signature, ts } = await signVaultAction({
      roomId,
      stage: where.stage,
      phase: where.phase,
      action,
      privateKey: wallet.privateKey,
      ts: clock(),
    });
    return client.vaultAct(roomId, wallet.address, {
      stage: where.stage,
      phase: where.phase,
      action,
      signature,
      ts,
    });
  }

  return {
    address: wallet.address,
    client,
    matchmake,
    playAndSubmit,
    vaultJoin,
    vaultView,
    vaultAct,
  };
}
