// El servidor MCP de punta a punta por un transporte en memoria: lo que ve un
// cliente MCP real (lista de herramientas y respuestas), sin stdio ni red.
// Correr: node --import tsx --test apps/mcp/test/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ArbiterClient, createAgent, ALEPH_RULES_V } from "@arcade1v1/agent-sdk";
import { buildServer } from "../src/server";

async function connected(
  opts: { fetchImpl?: typeof fetch; webUrl?: string; fixedWallet?: boolean } = {},
) {
  const client = new ArbiterClient(
    "http://fake",
    opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {},
  );
  const agent = createAgent({ client });
  const server = buildServer({ agent, client, webUrl: opts.webUrl, fixedWallet: opts.fixedWallet });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientT);
  return {
    mcp,
    agent,
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

test("buildServer publica las 6 herramientas 1v1, whoami y las 7 de Aleph", async () => {
  const { mcp, close } = await connected();
  try {
    const { tools } = await mcp.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "aleph_act",
      "aleph_deposit",
      "aleph_join",
      "aleph_lobbies",
      "aleph_rules",
      "aleph_view",
      "aleph_withdraw",
      "get_result",
      "leaderboard",
      "list_games",
      "matchmake",
      "play_and_submit",
      "rating",
      "whoami",
    ]);
    const mm = tools.find((t) => t.name === "matchmake")!;
    assert.match(
      String(mm.description),
      /live: true/,
      "avisa que un juego en vivo no trae semilla",
    );
    const play = tools.find((t) => t.name === "play_and_submit")!;
    assert.match(String(play.description), /en vivo/);
    // play_and_submit empareja por su cuenta: si el agente llama antes a
    // matchmake, la partida de ese matchmake queda sin jugar y la pierde.
    for (const d of [mm.description, play.description]) {
      assert.match(String(d), /no llames a matchmake antes/i);
    }
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

// ---- Lo que ve la persona ----------------------------------------------------

const jsonReply = (body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

test("las herramientas que solo leen lo anuncian; las que firman, no", async () => {
  const { mcp, close } = await connected();
  try {
    const { tools } = await mcp.listTools();
    const ro = tools
      .filter((t) => t.annotations?.readOnlyHint === true)
      .map((t) => t.name)
      .sort();
    assert.deepEqual(ro, [
      "aleph_lobbies",
      "aleph_rules",
      "aleph_view",
      "get_result",
      "leaderboard",
      "list_games",
      "rating",
      "whoami",
    ]);
    for (const t of tools) assert.ok(t.annotations, `${t.name} trae annotations`);
    const dep = tools.find((t) => t.name === "aleph_deposit")!;
    assert.equal(dep.annotations?.destructiveHint, true, "mover plata pide confirmación");
  } finally {
    await close();
  }
});

test("get_result: el JSON sigue primero; después, resumen y link a la repetición", async () => {
  const view = {
    matchId: "0xabc",
    game: "2048",
    stake: 0,
    status: "settled",
    scores: {},
    yourScore: 1240,
    rivalScore: 980,
    rating: 1214,
    ratingDelta: 14,
  };
  const { mcp, close } = await connected({
    fetchImpl: jsonReply(view),
    webUrl: "https://arcade1v1.com",
  });
  try {
    const res = (await mcp.callTool({
      name: "get_result",
      arguments: { matchId: "0xabc" },
    })) as { content: { text: string }[]; structuredContent?: unknown };
    assert.deepEqual(JSON.parse(res.content[0].text), view, "content[0] es el JSON de siempre");
    assert.deepEqual(res.structuredContent, view);
    assert.match(res.content[1].text, /You won .* 1240 to 980/);
    assert.match(res.content[1].text, /\+14/);
    assert.match(res.content[1].text, /https:\/\/arcade1v1\.com\/watch\/0xabc/);
  } finally {
    await close();
  }
});

test("whoami: dirección en minúsculas, rating y aviso de wallet efímera", async () => {
  const { mcp, agent, close } = await connected({
    fetchImpl: jsonReply({ ratings: { snake: 1180 } }),
    webUrl: "https://arcade1v1.com",
  });
  try {
    const res = (await mcp.callTool({ name: "whoami", arguments: {} })) as {
      content: { text: string }[];
    };
    const w = JSON.parse(res.content[0].text);
    assert.equal(w.address, agent.address.toLowerCase());
    assert.equal(w.wallet, "ephemeral");
    assert.deepEqual(w.ratings, { snake: 1180 });
    assert.equal(w.links.leaderboard, "https://arcade1v1.com/leaderboard");
    assert.match(res.content[1].text, /ephemeral.*ARCADE_PRIVATE_KEY/);
  } finally {
    await close();
  }
});
