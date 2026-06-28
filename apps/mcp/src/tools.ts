// Lógica de cada herramienta MCP como funciones puras (reciben un ArbiterClient
// inyectable). server.ts solo las envuelve en herramientas MCP. Sin on-chain.
import { ArbiterClient } from "@arcade1v1/agent-sdk";

export const GAMES = ["2048", "tetris", "flappy", "racing", "snake", "invaders"] as const;

export function listGames(): { games: readonly string[] } {
  return { games: GAMES };
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
