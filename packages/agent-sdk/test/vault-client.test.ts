// El cliente HTTP de Aleph: rutas, métodos, cuerpos y query string tienen
// que coincidir con lo que espera el árbitro (apps/server/src/vault-routes.ts).
// Correr: node --import tsx --test packages/agent-sdk/test/vault-client.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbiterClient } from "../src/client.ts";

type Captured = { url?: string; init?: RequestInit };
function fakeFetch(cap: Captured, body: unknown, status = 200): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    cap.url = String(url);
    cap.init = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}
const ROOM = "0x" + "ab".repeat(32);
const ADDR = "0x" + "1".repeat(40);
const VIEW = {
  roomId: ROOM,
  stake: 0,
  status: "playing",
  rulesV: 1,
  min: 4,
  max: 8,
  createdAt: 1,
  seats: [],
};

test("vaultLobbies: GET /vault/lobbies y devuelve la lista (vacía si falta)", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test/", {
    fetchImpl: fakeFetch(cap, {
      lobbies: [{ roomId: ROOM, stake: 0, seats: 2, min: 4, max: 8, closesAt: 5 }],
    }),
  });
  const lobbies = await client.vaultLobbies();
  assert.equal(cap.url, "http://arbiter.test/vault/lobbies");
  assert.equal(cap.init, undefined, "un GET simple, sin init");
  assert.equal(lobbies.length, 1);
  assert.equal(lobbies[0].roomId, ROOM);
  const empty = new ArbiterClient("http://arbiter.test", { fetchImpl: fakeFetch({}, {}) });
  assert.deepEqual(await empty.vaultLobbies(), []);
});

test("vaultJoin: POST /vault/join con stake, address y la firma", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { ...VIEW, status: "lobby" }),
  });
  const v = await client.vaultJoin(0, ADDR, { signature: "0xsig", ts: 123 });
  assert.equal(cap.url, "http://arbiter.test/vault/join");
  assert.equal(cap.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(cap.init?.body)), {
    stake: 0,
    address: ADDR,
    signature: "0xsig",
    ts: 123,
  });
  assert.equal(v.status, "lobby");
});

test("vaultView: sin pase es GET /vault/:id; con pase van address, signature y ts en el query", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test", { fetchImpl: fakeFetch(cap, VIEW) });
  const pub = await client.vaultView(ROOM);
  assert.equal(cap.url, `http://arbiter.test/vault/${ROOM}`);
  assert.equal(pub.roomId, ROOM);
  await client.vaultView(ROOM, { address: ADDR, signature: "0xsig", ts: 123 });
  assert.equal(cap.url, `http://arbiter.test/vault/${ROOM}?address=${ADDR}&signature=0xsig&ts=123`);
});

test("vaultAct: POST /vault/:id/act con el cuerpo firmado completo", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test", { fetchImpl: fakeFetch(cap, VIEW) });
  await client.vaultAct(ROOM, ADDR, {
    stage: 2,
    phase: "decide",
    action: { type: "vote", target: ADDR },
    signature: "0xsig",
    ts: 9,
  });
  assert.equal(cap.url, `http://arbiter.test/vault/${ROOM}/act`);
  assert.equal(cap.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(cap.init?.body)), {
    address: ADDR,
    stage: 2,
    phase: "decide",
    action: { type: "vote", target: ADDR },
    signature: "0xsig",
    ts: 9,
  });
});

test("vaultLog: GET /vault/:id/log", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { roomId: ROOM, events: [], payouts: {} }),
  });
  const log = await client.vaultLog(ROOM);
  assert.equal(cap.url, `http://arbiter.test/vault/${ROOM}/log`);
  assert.deepEqual(log.events, []);
});

test("errores: el motivo que da el árbitro (400) viaja en el mensaje, también en los GET", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { error: "stage or phase mismatch (now 1/talk)" }, 400),
  });
  await assert.rejects(
    () =>
      client.vaultAct(ROOM, ADDR, {
        stage: 0,
        phase: "decide",
        action: { type: "keep" },
        signature: "0x",
        ts: 1,
      }),
    /400.*stage or phase mismatch/,
  );
  await assert.rejects(() => client.vaultLog(ROOM), /400.*stage or phase mismatch/);
});

test("vaultView: si falla, el error NO filtra el pase de vista (address/signature/ts) del query", async () => {
  const cap: Captured = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { error: "room not found" }, 502),
  });
  const pass = { address: ADDR, signature: "0x" + "aa".repeat(65), ts: 1757000000000 };
  await assert.rejects(
    () => client.vaultView(ROOM, pass),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      // El motivo del árbitro sigue viajando: es lo único que el agente necesita.
      assert.match(err.message, /502.*room not found/);
      // La firma es una credencial portadora replayable durante la ventana de
      // MATCHMAKE_AUTH_TTL_MS (verifySigned no la consume): no puede aparecer en
      // un mensaje que cualquier logger/runner de agente puede terminar exponiendo.
      assert.doesNotMatch(err.message, /signature=/);
      assert.doesNotMatch(err.message, new RegExp(pass.signature));
      assert.doesNotMatch(err.message, /ts=1757000000000/);
      assert.equal(err.message, `arbiter /vault/${ROOM} 502: {"error":"room not found"}`);
      return true;
    },
  );
});
