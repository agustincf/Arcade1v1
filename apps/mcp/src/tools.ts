// Lógica de cada herramienta MCP como funciones puras (reciben un ArbiterClient
// inyectable). server.ts solo las envuelve en herramientas MCP. Sin on-chain.
import {
  ArbiterClient,
  createAgent,
  describeVaultRules,
  legalActions,
  validateAction,
  VAULT_RULES_V,
  type MatchView,
  type VaultLobby,
  type VaultRoomView,
} from "@arcade1v1/agent-sdk";

type Agent = ReturnType<typeof createAgent>;

function assertGame(game: string): void {
  if (!GAMES.includes(game as (typeof GAMES)[number])) {
    throw new Error(`unknown game: ${game}. Conocidos: ${GAMES.join(", ")}`);
  }
}

export const GAMES = ["2048", "tetris", "flappy", "racing", "snake", "invaders"] as const;

/** Formatos que no son cartuchos 1v1 (no entran en `GAMES`: las herramientas
 *  1v1 siguen validando contra los seis juegos). */
export const FORMATS = ["vault"] as const;

export function listGames(): { games: readonly string[]; formats: readonly string[] } {
  return { games: GAMES, formats: FORMATS };
}

export async function leaderboardTool(
  client: ArbiterClient,
  game: string,
  limit = 20,
): Promise<{ game: string; top: { address: string; rating: number }[] }> {
  const top = await client.leaderboard(game, limit);
  return { game, top };
}

export async function ratingTool(
  client: ArbiterClient,
  address: string,
): Promise<{ address: string; ratings: Record<string, number> }> {
  const ratings = await client.rating(address);
  return { address, ratings };
}

export async function matchmakeTool(agent: Agent, game: string, stake: number): Promise<MatchView> {
  assertGame(game);
  // Firmado con la wallet del agente (el árbitro en producción lo exige).
  return agent.matchmake(game, stake);
}

export async function playAndSubmitTool(
  agent: Agent,
  game: string,
  stake: number,
): Promise<MatchView> {
  assertGame(game);
  return agent.playAndSubmit({ game, stake });
}

export async function getResultTool(
  client: ArbiterClient,
  matchId: string,
  address?: string,
): Promise<MatchView> {
  return client.getMatch(matchId, address);
}

// ---- La Bóveda (formato multi-agente) ------------------------------------------

/** La vista más las acciones legales AHORA: el modelo no tiene que deducirlas
 *  de `stage.phase`, `you.decided` y `you.ready`. */
function withLegal(v: VaultRoomView): VaultRoomView & { legal: string[] } {
  return { ...v, legal: legalActions(v) };
}

export function vaultRulesTool(): { rulesV: number; rules: string } {
  return { rulesV: VAULT_RULES_V, rules: describeVaultRules() };
}

export async function vaultLobbiesTool(client: ArbiterClient): Promise<{ lobbies: VaultLobby[] }> {
  return { lobbies: await client.vaultLobbies() };
}

export async function vaultJoinTool(
  agent: Agent,
  stake = 0,
): Promise<VaultRoomView & { legal: string[] }> {
  return withLegal(await agent.vaultJoin(stake));
}

export async function vaultViewTool(
  agent: Agent,
  roomId: string,
): Promise<VaultRoomView & { legal: string[] }> {
  return withLegal(await agent.vaultView(roomId));
}

export async function vaultActTool(
  agent: Agent,
  roomId: string,
  action: unknown,
): Promise<VaultRoomView & { legal: string[] }> {
  // Validar la forma ACÁ da un error claro al modelo sin gastar una firma ni un
  // POST del presupuesto (12 cada 10 s). Lo que depende del estado (¿está vivo
  // el destino?, ¿largo del código?) lo dice el árbitro con su 400.
  return withLegal(await agent.vaultAct(roomId, validateAction(action)));
}
