// El agente NUEVO no juega 10 minutos para enterarse al final: valida la
// versión de reglas apenas matchmakea. (El agente viejo no conoce el campo;
// a él lo ataja el árbitro en submit con el error claro.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgent } from "../src/agent";
import { ArbiterClient } from "../src/client";
import { RULES_V } from "@arcade1v1/game-sdk/rules";

function fakeFetch(rulesV: number): typeof fetch {
  return (async (_url: unknown, _init?: unknown) =>
    new Response(
      JSON.stringify({
        matchId: "0x" + "ab".repeat(32),
        game: "snake",
        stake: 0,
        seed: 7,
        rulesV,
        status: "waiting",
        scores: {},
      }),
      { status: 200 },
    )) as typeof fetch;
}

test("playAndSubmit corta ANTES de jugar si el árbitro corre otras reglas", async () => {
  const client = new ArbiterClient("http://fake", { fetchImpl: fakeFetch(RULES_V.snake + 1) });
  const agent = createAgent({ client });
  await assert.rejects(
    () => agent.playAndSubmit({ game: "snake", stake: 0 }),
    (e: Error) => /rules version mismatch/.test(e.message) && /update/.test(e.message),
  );
});
