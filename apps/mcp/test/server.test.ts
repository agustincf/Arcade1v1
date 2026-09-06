// El servidor MCP de punta a punta por un transporte en memoria: lo que ve un
// cliente MCP real (lista de herramientas y respuestas), sin stdio ni red.
// Correr: node --import tsx --test apps/mcp/test/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ArbiterClient, createAgent, VAULT_RULES_V } from "@arcade1v1/agent-sdk";
import { buildServer } from "../src/server";

async function connected() {
  const client = new ArbiterClient("http://fake");
  const agent = createAgent({ client });
  const server = buildServer({ agent, client });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientT);
  return {
    mcp,
    close: async () => {
      await mcp.close();
      await server.close();
    },
  };
}

// callTool() devuelve una unión con una variante vieja de compatibilidad sin
// `content`; nuestro server siempre responde con `content`, así que el cast
// (pasando por unknown, como pide TS para una unión sin solapamiento) no
// cambia el runtime, solo destraba el typecheck.
const textOf = (res: unknown) =>
  ((res as { content: unknown }).content as { type: string; text: string }[])[0].text;

test("buildServer publica las 6 herramientas 1v1 y las 5 de Aleph", async () => {
  const { mcp, close } = await connected();
  try {
    const { tools } = await mcp.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "get_result",
      "leaderboard",
      "list_games",
      "matchmake",
      "play_and_submit",
      "rating",
      "vault_act",
      "vault_join",
      "vault_lobbies",
      "vault_rules",
      "vault_view",
    ]);
    const act = tools.find((t) => t.name === "vault_act")!;
    const props = (act.inputSchema as { properties: Record<string, unknown> }).properties;
    assert.ok(props.roomId && props.action, "vault_act pide roomId y action");
  } finally {
    await close();
  }
});

test("vault_rules y list_games responden por el protocolo (sin red)", async () => {
  const { mcp, close } = await connected();
  try {
    const rules = JSON.parse(textOf(await mcp.callTool({ name: "vault_rules", arguments: {} })));
    assert.equal(rules.rulesV, VAULT_RULES_V);
    assert.match(rules.rules, /HOW TO PLAY/);
    const games = JSON.parse(textOf(await mcp.callTool({ name: "list_games", arguments: {} })));
    assert.deepEqual(games.formats, ["vault"]);
    assert.equal(games.games.length, 6);
  } finally {
    await close();
  }
});
