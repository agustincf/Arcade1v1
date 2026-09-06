// Helpers de alto nivel: crear un agente y "jugá y enviá" en una sola llamada.
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  ArbiterClient,
  type MatchView,
  type VaultLobby,
  type VaultRoomView,
  type VaultViewPass,
} from "./client";
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
  /** La Bóveda: pedir asiento en la mesa gratis (firmado). Idempotente. Antes
   *  de sentarse, mira la versión de reglas de la mesa abierta (si hay una) y
   *  corta sin pedir asiento si no coincide. */
  vaultJoin(stake?: number): Promise<VaultRoomView>;
  /** La Bóveda: TU vista privada, con pase de vista firmado (cacheado 8 min).
   *  Si el árbitro rechaza el pase en silencio (200 con la vista pública),
   *  reintenta una vez con uno recién firmado antes de tirar un error claro. */
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

  // El lobby SÍ publica rulesV antes de sentarse: GET /vault/lobbies da el
  // roomId de la mesa abierta y GET /vault/:id sin pase (vista pública, sin
  // costo) trae rulesV para esa sala en cualquier estado (roomView,
  // apps/server/src/vault.ts). Miramos ahí ANTES de pedir asiento: un SDK
  // desactualizado que se sienta igual deja un asiento mudo que estira CADA
  // fase hasta VAULT_PHASE_MS (nadie decide por consenso) y arrastra a los
  // demás 3-7 asientos durante dos etapas, hasta que MAX_ABSENCES lo marca
  // `abandoned`. Es mejor esfuerzo: si el GET falla (red caída) seguimos de
  // largo y confiamos en la red de contención de abajo.
  async function assertCompatibleRules(stake: number): Promise<void> {
    let lobbies: VaultLobby[];
    try {
      lobbies = await client.vaultLobbies();
    } catch {
      return;
    }
    const open = lobbies.find((l) => l.stake === stake);
    if (!open) return; // primera mesa de esta vida del árbitro: nada que mirar todavía.
    let pub: VaultRoomView;
    try {
      pub = await client.vaultView(open.roomId);
    } catch {
      return;
    }
    if (pub.rulesV !== VAULT_RULES_V) {
      throw new Error(
        `rules version mismatch for vault: arbiter v${pub.rulesV}, SDK v${VAULT_RULES_V} — ` +
          `update @arcade1v1 packages (room ${open.roomId})`,
      );
    }
  }

  async function vaultJoin(stake = 0): Promise<VaultRoomView> {
    assertFreeTable(stake);
    await assertCompatibleRules(stake);
    const auth = await signMatchmake({
      game: "vault",
      stake,
      address: wallet.address,
      privateKey: wallet.privateKey,
      ts: clock(),
    });
    const v = await client.vaultJoin(stake, wallet.address, auth);
    // Red de contención: si no había mesa abierta para mirar antes (primera
    // sala) o la versión cambió justo en el medio, igual cortamos acá. No hay
    // endpoint para abandonar la mesa, así que el roomId va en el mensaje: el
    // dueño del agente necesita saber cuál quedó con un asiento mudo.
    if (v.rulesV !== VAULT_RULES_V) {
      throw new Error(
        `rules version mismatch for vault: arbiter v${v.rulesV}, SDK v${VAULT_RULES_V} — ` +
          `update @arcade1v1 packages (room ${v.roomId})`,
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

  // El árbitro NUNCA lanza ante un pase inválido: si verifySigned falla (firma
  // mala, o el `ts` cacheado ya luce vencido para EL RELOJ DEL SERVIDOR, p.ej.
  // un host sin NTP 3 minutos atrasado) responde 200 con la vista PÚBLICA, sin
  // `you` (getVaultRoom, apps/server/src/vault.ts). Si eso pasa mientras
  // tenemos asiento, jugar a ciegas con `you` undefined es peor que fallar
  // claro: acá lo detectamos y reintentamos una vez con un pase recién
  // firmado (ts = ahora, lejos del borde) antes de resignarnos.
  function passWasRejected(v: VaultRoomView): boolean {
    if (v.status !== "playing" && v.status !== "settled") return false;
    if (v.you !== undefined) return false;
    return v.seats.some((s) => s.address.toLowerCase() === wallet.address.toLowerCase());
  }

  async function vaultView(roomId: string): Promise<VaultRoomView> {
    const v = await client.vaultView(roomId, await viewPass(roomId));
    if (!passWasRejected(v)) return v;
    passes.delete(roomId); // el pase cacheado no sirve: forzar uno nuevo, no reusarlo.
    const retry = await client.vaultView(roomId, await viewPass(roomId));
    if (passWasRejected(retry)) {
      throw new Error(
        `view pass rejected for room ${roomId}: check the system clock (address ${wallet.address} ` +
          `has a seat but the arbiter won't grant the private view)`,
      );
    }
    return retry;
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
