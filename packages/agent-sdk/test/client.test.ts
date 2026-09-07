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

test("un pedido colgado se corta por el tope de tiempo, con la ruta en el mensaje", async () => {
  // Un fetch que NUNCA responde, como el árbitro cuando su host gratuito se
  // duerme o se reinicia en medio de un deploy: solo termina si el cliente
  // manda un signal. Sin tope, este await bloquea al agente por minutos —
  // fases enteras de Aleph— sin que ningún contador de sondeos se entere.
  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
    })) as typeof fetch;
  const client = new ArbiterClient("http://arbiter.test", { fetchImpl: hanging, timeoutMs: 20 });
  await assert.rejects(
    () => client.rating("0x" + "1".repeat(40)),
    /arbiter rating\/0x1+ timeout after 20ms/,
  );
  // El pase de vista viaja en el query string de esta ruta: el mensaje del
  // timeout nombra la ruta, nunca el query (misma regla que el error del GET).
  const room = "0x" + "ab".repeat(32);
  await assert.rejects(
    () => client.vaultView(room, { address: "0x" + "2".repeat(40), signature: "0xSECRET", ts: 1 }),
    (e: Error) => {
      assert.match(e.message, new RegExp(`arbiter /vault/${room} timeout after 20ms`));
      assert.ok(!/0xSECRET/.test(e.message), "el pase no se filtra en el error");
      return true;
    },
  );
});

test("con timeoutMs 0 el cliente no pone signal (tope a cargo de quien lo llame)", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { ratings: { "2048": 1200 } }),
    timeoutMs: 0,
  });
  await client.rating("0xPLAYER");
  assert.equal(cap.init?.signal, undefined);
});
