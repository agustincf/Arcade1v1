// El cliente del árbitro, en vivo: manda lo que la ruta espera y trata el 409
// como lo que es (un conflicto de tick con el que resincronizar), no como error.
//
// Correr: node --import tsx --test packages/agent-sdk/test/live-client.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { liveStartAuthMessage } from "@arcade1v1/game-sdk/auth";
import { ArbiterClient } from "../src/client.ts";
import { randomWallet, signLiveStart } from "../src/sign.ts";

function clientWith(replies: { status: number; body: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, client: new ArbiterClient("http://arb", { fetchImpl, timeoutMs: 0 }) };
}

test("liveStart manda address y firma a la ruta del intento", async () => {
  const { calls, client } = clientWith([
    {
      status: 200,
      body: { over: false, token: "tk", tick: 0, flaps: [], reveal: [0.5], revealed: 1 },
    },
  ]);
  const start = await client.liveStart("0xmatch", "0xme", { signature: "0xsig", ts: 7 });
  assert.equal(start.over, false);
  assert.deepEqual(calls[0], {
    url: "http://arb/match/0xmatch/live/start",
    body: { address: "0xme", signature: "0xsig", ts: 7 },
  });
});

test("liveCommit: 200 normal, 409 como conflicto y 400 como error", async () => {
  const { calls, client } = clientWith([
    { status: 200, body: { over: false, tick: 30, reveal: [0.1], revealed: 2 } },
    { status: 409, body: { conflict: true, tick: 30, reveal: [], revealed: 2 } },
    { status: 400, body: { error: "bad token" } },
  ]);
  const body = { token: "tk", from: 0, to: 30, flaps: [0], have: 1 };
  const ok = await client.liveCommit("0xmatch", "0xme", body);
  assert.equal(ok.conflict, undefined);
  assert.equal(ok.tick, 30);
  assert.deepEqual(calls[0].body, { address: "0xme", ...body });

  const conflict = await client.liveCommit("0xmatch", "0xme", body);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.tick, 30);

  await assert.rejects(client.liveCommit("0xmatch", "0xme", body), /400.*bad token/);
});

test("un 409 que no es el conflicto del protocolo sigue siendo un error", async () => {
  const { client } = clientWith([{ status: 409, body: { error: "proxy says no" } }]);
  await assert.rejects(
    client.liveCommit("0xmatch", "0xme", { token: "tk", from: 0, to: 30, flaps: [], have: 1 }),
    /409.*proxy says no/,
  );
});

test("signLiveStart firma el mensaje de apertura con la wallet del agente", async () => {
  const w = randomWallet();
  const { signature, ts } = await signLiveStart({
    matchId: "0xmatch",
    address: w.address,
    privateKey: w.privateKey,
  });
  const signer = await recoverMessageAddress({
    message: liveStartAuthMessage("0xmatch", w.address, ts),
    signature,
  });
  assert.equal(signer.toLowerCase(), w.address.toLowerCase());
});

test("los errores del árbitro llevan el código HTTP en `status` (para saber si reintentar)", async () => {
  const { client } = clientWith([
    { status: 400, body: { error: "bad token" } },
    { status: 429, body: { error: "too many requests" } },
    { status: 503, body: { error: "starting" } },
  ]);
  const body = { token: "tk", from: 0, to: 30, flaps: [], have: 1 };
  const statusOf = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (e: { status?: number }) => e.status,
    );
  assert.equal(await statusOf(client.liveCommit("0xmatch", "0xme", body)), 400);
  assert.equal(await statusOf(client.liveCommit("0xmatch", "0xme", body)), 429);
  assert.equal(await statusOf(client.liveStart("0xmatch", "0xme")), 503);
});
