// Servidor MCP: registra cada herramienta (con esquema zod) y la cablea a las
// funciones puras de tools.ts. buildServer() es testeable sin stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import {
  GAMES,
  listGames,
  leaderboardTool,
  ratingTool,
  matchmakeTool,
  playAndSubmitTool,
  getResultTool,
} from "./tools";

type Agent = ReturnType<typeof createAgent>;
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function buildServer(deps: { agent: Agent; client: ArbiterClient }): McpServer {
  const { agent, client } = deps;
  const server = new McpServer({ name: "arcade1v1", version: "0.2.0" });

  server.registerTool(
    "list_games",
    { title: "List games", description: "Juegos disponibles en Arcade1v1." },
    async () => ok(listGames()),
  );

  server.registerTool(
    "leaderboard",
    {
      title: "Leaderboard",
      description: "Ranking ELO de un juego.",
      inputSchema: { game: z.string(), limit: z.number().optional() },
    },
    async ({ game, limit }) => ok(await leaderboardTool(client, game, limit)),
  );

  server.registerTool(
    "rating",
    {
      title: "Rating",
      description: "Rating ELO de una dirección por juego.",
      inputSchema: { address: z.string() },
    },
    async ({ address }) => ok(await ratingTool(client, address)),
  );

  server.registerTool(
    "matchmake",
    {
      title: "Matchmake",
      description: `Emparejar para un juego (${GAMES.join(", ")}) en una mesa (stake).`,
      inputSchema: { game: z.string(), stake: z.number() },
    },
    async ({ game, stake }) => ok(await matchmakeTool(agent, game, stake)),
  );

  server.registerTool(
    "play_and_submit",
    {
      title: "Play and submit",
      description:
        "Empareja, juega con la estrategia por defecto y envía el puntaje (por ranking).",
      inputSchema: { game: z.string(), stake: z.number() },
    },
    async ({ game, stake }) => ok(await playAndSubmitTool(agent, game, stake)),
  );

  server.registerTool(
    "get_result",
    {
      title: "Get result",
      description: "Estado/feedback de una partida por matchId.",
      inputSchema: { matchId: z.string(), address: z.string().optional() },
    },
    async ({ matchId, address }) => ok(await getResultTool(client, matchId, address)),
  );

  return server;
}
