import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbiterClient } from "../src/client.ts";

function fakeFetch(captured: { url?: string; init?: RequestInit }, body: unknown) {
  return (async (url: string, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

test("matchmake hace POST /matchmake con el body correcto", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, {
      matchId: "0xabc",
      game: "2048",
      stake: 5,
      seed: 42,
      status: "waiting",
      scores: {},
    }),
  });
  const m = await client.matchmake("2048", 5, "0xPLAYER");
  assert.equal(cap.url, "http://arbiter.test/matchmake");
  assert.equal(cap.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(cap.init?.body)), {
    game: "2048",
    stake: 5,
    address: "0xPLAYER",
  });
  assert.equal(m.matchId, "0xabc");
  assert.equal(m.seed, 42);
});

test("leaderboard hace GET y devuelve el top", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { game: "2048", top: [{ address: "0x1", rating: 1200 }] }),
  });
  const top = await client.leaderboard("2048", 10);
  assert.equal(cap.url, "http://arbiter.test/leaderboard/2048?limit=10");
  assert.deepEqual(top, [{ address: "0x1", rating: 1200 }]);
});
