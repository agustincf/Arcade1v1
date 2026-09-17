// Rutas HTTP de las partidas en vivo: la capa fina sobre live.ts traduce los
// errores del protocolo a 400 y el conflicto de tick a 409.
//
// Correr: node --import tsx --test apps/server/test/live-routes.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { matchmake } from "../src/matchmaking.js";
import { liveRouter } from "../src/live-routes.js";

RULES_V.flappy = 2;

const app = express();
app.use(express.json());
app.use(liveRouter((_req, _res, next) => next()));
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

test("abrir 200, comprometer 200, from desfasado 409 y errores del protocolo 400", async () => {
  const p1 = addr();
  const { matchId } = await matchmake("flappy", 0, p1);
  await matchmake("flappy", 0, addr());

  const start = await post(`/match/${matchId}/live/start`, { address: p1 });
  assert.equal(start.status, 200);
  const token = String(start.body.token);

  const ok = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token,
    from: 0,
    to: 20,
    flaps: [0],
    have: 1,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tick, 20);

  const conflict = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token,
    from: 0,
    to: 30,
    flaps: [],
    have: 1,
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.tick, 20);

  const badToken = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token: "nope",
    from: 20,
    to: 30,
    flaps: [],
    have: 1,
  });
  assert.equal(badToken.status, 400);
  assert.match(String(badToken.body.error), /bad token/);

  const missing = await post(`/match/${matchId}/live/start`, {});
  assert.equal(missing.status, 400);

  const notArray = await post(`/match/${matchId}/live/commit`, {
    address: p1,
    token,
    from: 20,
    to: 30,
    flaps: "0",
    have: 1,
  });
  assert.equal(notArray.status, 400);
});
