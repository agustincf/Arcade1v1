// El servidor MCP de punta a punta por un transporte en memoria: lo que ve un
// cliente MCP real (lista de herramientas y respuestas), sin stdio ni red.
// Correr: node --import tsx --test apps/mcp/test/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ArbiterClient, createAgent, ALEPH_RULES_V } from "@arcade1v1/agent-sdk";
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
      "aleph_act",
      "aleph_join",
      "aleph_lobbies",
      "aleph_rules",
      "aleph_view",
      "get_result",
      "leaderboard",
      "list_games",
      "matchmake",
      "play_and_submit",
      "rating",
    ]);
    const act = tools.find((t) => t.name === "aleph_act")!;
    const schema = act.inputSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    assert.ok(
      schema.properties.roomId && schema.properties.action,
      "aleph_act pide roomId y action",
    );
    // `stage`/`phase` son OBLIGATORIOS: son el ancla de la acción a la vista
    // que el modelo miró. Sin ellos, el SDK re-lee la vista y firma para la
    // fase abierta en el momento del POST — y entre la lectura del modelo y su
    // llamada pasan decenas de segundos de una fase de ~2 minutos.
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      ["action", "phase", "roomId", "stage"],
      "aleph_act exige el ancla stage/phase",
    );
  } finally {
    await close();
  }
});

test("aleph_act por el protocolo: sin stage/phase el servidor rechaza la llamada", async () => {
  const { mcp, close } = await connected();
  try {
    const res = (await mcp.callTool({
      name: "aleph_act",
      arguments: { roomId: "0x" + "ab".repeat(32), action: { type: "ready" } },
    })) as { isError?: boolean; content: { text: string }[] };
    assert.equal(res.isError, true, "una acción sin ancla no llega al árbitro");
    assert.match(res.content[0].text, /stage|phase/i);
  } finally {
    await close();
  }
});

test("aleph_rules y list_games responden por el protocolo (sin red)", async () => {
  const { mcp, close } = await connected();
  try {
    const rules = JSON.parse(textOf(await mcp.callTool({ name: "aleph_rules", arguments: {} })));
    assert.equal(rules.rulesV, ALEPH_RULES_V);
    assert.match(rules.rules, /HOW TO PLAY/);
    const games = JSON.parse(textOf(await mcp.callTool({ name: "list_games", arguments: {} })));
    assert.deepEqual(games.formats, ["aleph"]);
    assert.equal(games.games.length, 6);
  } finally {
    await close();
  }
});
