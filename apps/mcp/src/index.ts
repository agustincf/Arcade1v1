// Entrypoint del servidor MCP por stdio. Config: ARBITER_URL (default = árbitro
// publicado). Crea un agente con wallet efímera por sesión (solo firma; Fase 1).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { buildServer } from "./server";

const arbiterUrl = process.env.ARBITER_URL ?? "https://arcade1v1.onrender.com";

async function main() {
  // Calentamiento: el árbitro (Render free) se duerme por inactividad y tarda
  // ~30-50s en despertar — más que el timeout típico de un cliente MCP. Un ping
  // al arrancar lo despierta mientras el usuario todavía está escribiendo.
  fetch(`${arbiterUrl}/health`).catch(() => {});

  const client = new ArbiterClient(arbiterUrl);
  const agent = createAgent({ arbiterUrl, client });
  const server = buildServer({ agent, client });
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error("arcade1v1-mcp error:", (e as Error).message);
  process.exit(1);
});
