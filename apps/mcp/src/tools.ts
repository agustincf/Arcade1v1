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

/** Lo que devuelve cada herramienta de La Bóveda que trae vista: la vista del
 *  motor más tres cosas que el modelo no puede reconstruir por su cuenta. */
export type VaultAgentView = VaultRoomView & {
  /** Acciones legales AHORA: el modelo no tiene que deducirlas de
   *  `stage.phase`, `you.decided` y `you.ready`. */
  legal: string[];
  /** La wallet de ESTE asiento. `you` (viewFor, game-sdk/vault.ts) nunca trae
   *  `address` — es efímera del proceso y no se publica — así que sin esto el
   *  modelo no puede distinguir su propio asiento de los otros 3-7 en
   *  `seats[]` ni sus propios `say` en `messages`: vota o susurra a ciegas,
   *  a veces a sí mismo (el árbitro lo rechaza, o peor, cuenta como ausencia).
   *  En minúsculas: `seats[].address` y `stage.acted` ya lo están (normAddr,
   *  apps/server/src/vault.ts) y así lo compara el propio ejemplo de
   *  referencia (`const me = agent.address.toLowerCase()`,
   *  packages/agent-sdk/examples/play-vault-llm.ts) — mandarlo con la
   *  capitalización checksummed de la wallet rompería una comparación
   *  ingenua `target !== me` del modelo. */
  me: string;
  /** Reloj del servidor MCP en el momento de esta respuesta (epoch ms): con
   *  qué comparar `deadline`. El host MCP a lo sumo le inyecta al modelo la
   *  fecha del día, nunca la hora en milisegundos. */
  now: number;
  /** Milisegundos que quedan de la fase actual (`deadline - now`, nunca
   *  negativo), o `undefined` si la sala no tiene fase con plazo (lobby,
   *  settled). Actuar después de que llega a 0 es una fase que ya cerró. */
  msLeft?: number;
};

function withLegal(agent: Agent, v: VaultRoomView): VaultAgentView {
  const now = Date.now();
  return {
    ...v,
    legal: legalActions(v),
    me: agent.address.toLowerCase(),
    now,
    msLeft: v.deadline === undefined ? undefined : Math.max(0, v.deadline - now),
  };
}

export function vaultRulesTool(): { rulesV: number; rules: string } {
  return { rulesV: VAULT_RULES_V, rules: describeVaultRules() };
}

export async function vaultLobbiesTool(client: ArbiterClient): Promise<{ lobbies: VaultLobby[] }> {
  return { lobbies: await client.vaultLobbies() };
}

export async function vaultJoinTool(agent: Agent, stake = 0): Promise<VaultAgentView> {
  return withLegal(agent, await agent.vaultJoin(stake));
}

export async function vaultViewTool(agent: Agent, roomId: string): Promise<VaultAgentView> {
  return withLegal(agent, await agent.vaultView(roomId));
}

export async function vaultActTool(
  agent: Agent,
  roomId: string,
  action: unknown,
): Promise<VaultAgentView> {
  // Validar la forma ACÁ da un error claro al modelo sin gastar una firma ni un
  // POST del presupuesto (12 cada 10 s). Lo que depende del estado (¿está vivo
  // el destino?, ¿largo del código?) lo dice el árbitro con su 400.
  return withLegal(agent, await agent.vaultAct(roomId, validateAction(action)));
}
