// Los errores de depósito de una mesa de plata llegan al cliente con su código
// y su motivo, por las rutas de verdad (matchRouter y liveRouter):
//  - si el árbitro no pudo leer la cadena, no se procesó nada: 503 con
//    Retry-After, para que el cliente reintente solo;
//  - si leyó y no hay depósito de esta dirección, es un error del cliente: 400
//    con el motivo.
// Antes, en /match/:id/score los dos salían como "500 internal error" y en
// /live/start el de "no pude leer" salía como un 400 que no se reintentaba.
//
// Correr: node --import tsx --test apps/server/test/deposit-errors-http.test.ts

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

// Escrow "activo". Todo ANTES de importar: onchain.ts y sign.ts leen estas
// variables al cargarse. La clave es la cuenta #1 de anvil, pública y sin valor.
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "31337";
process.env.RPC_URL = "http://127.0.0.1:9";
process.env.ARBITER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const { RULES_V } = await import("@arcade1v1/game-sdk/rules");
RULES_V.flappy = 2;
const { matchRouter } = await import("../src/match-routes.js");
const { liveRouter } = await import("../src/live-routes.js");
const { setEscrowChainForTest } = await import("../src/onchain.js");
await (await import("./escrow-ok.js")).escrowVerified();

/** Qué contesta la cadena falsa al leer una partida. */
let readChain: () => Promise<null> = async () => null;
setEscrowChainForTest({
  read: () => readChain(),
  cancel: async () => {},
  settle: async () => "0x" as `0x${string}`,
});

const pass: express.RequestHandler = (_req, _res, next) => next();
const app = express();
app.use(express.json());
app.use(matchRouter({ score: pass }));
app.use(liveRouter({ start: pass, commit: pass }));
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.close();
  setEscrowChainForTest(undefined);
});

let n = 0;
/** Una partida de plata nueva de flappy, con su p1 (sin depósito en la cadena). */
async function paidMatch(): Promise<{ id: string; p1: string }> {
  const p1 = "0x" + (++n).toString(16).padStart(40, "a");
  readChain = async () => null;
  const r = await fetch(`${BASE}/matchmake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "flappy", stake: 1, address: p1 }),
  });
  assert.equal(r.status, 200);
  return { id: (await r.json()).matchId, p1 };
}

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const surrender = (address: string) => ({
  address,
  score: 0,
  replay: { ticks: 0, flaps: [], v: 2 },
});

beforeEach(() => {
  readChain = async () => null;
});

test("live/start sin poder leer la cadena contesta 503 con Retry-After", async () => {
  const { id, p1 } = await paidMatch();
  readChain = async () => {
    throw new Error("nodo caído");
  };
  const r = await post(`/match/${id}/live/start`, { address: p1 });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("retry-after"), "3");
  assert.match((await r.json()).error, /could not verify your deposit on-chain/);
});

test("score sin poder leer la cadena contesta 503", async () => {
  const { id, p1 } = await paidMatch();
  readChain = async () => {
    throw new Error("nodo caído");
  };
  const r = await post(`/match/${id}/score`, surrender(p1));
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("retry-after"), "3");
  assert.match((await r.json()).error, /could not verify your deposit on-chain/);
});

test("score sin depósito contesta 400 con el motivo", async () => {
  const { id, p1 } = await paidMatch();
  const r = await post(`/match/${id}/score`, surrender(p1));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), {
    error: "no on-chain deposit found for this address in this match",
  });
});

test("live/start sin depósito contesta 400 con el motivo", async () => {
  const { id, p1 } = await paidMatch();
  const r = await post(`/match/${id}/live/start`, { address: p1 });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /no on-chain deposit found for this address/);
});

test("not a player contesta 400", async () => {
  const { id } = await paidMatch();
  const r = await post(`/match/${id}/score`, surrender("0x" + "9".repeat(40)));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not a player/);
});
