import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbiterClient } from "@arcade1v1/agent-sdk";
import { GAMES, listGames, leaderboardTool, ratingTool } from "../src/tools";

function clientReturning(body: unknown): ArbiterClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  return new ArbiterClient("http://arbiter.test", { fetchImpl });
}

test("listGames devuelve los 6 juegos", () => {
  const out = listGames();
  assert.equal(out.games.length, 6);
  assert.ok(out.games.includes("2048"));
  assert.deepEqual([...out.games].sort(), [...GAMES].sort());
});

test("leaderboardTool devuelve el top del juego", async () => {
  const client = clientReturning({ game: "2048", top: [{ address: "0x1", rating: 1200 }] });
  const out = await leaderboardTool(client, "2048", 10);
  assert.equal(out.game, "2048");
  assert.deepEqual(out.top, [{ address: "0x1", rating: 1200 }]);
});

test("ratingTool devuelve los ratings del jugador", async () => {
  const client = clientReturning({ address: "0x9", ratings: { "2048": 1300 } });
  const out = await ratingTool(client, "0x9");
  assert.deepEqual(out.ratings, { "2048": 1300 });
});
