// ARRANQUE EN DOS TIEMPOS: el árbitro escucha enseguida (Render lo da por sano
// con /health), pero hasta tener el estado responde 503 a todo lo demás para
// que el cliente reintente, en vez de atender con el estado vacío.
//
// Correr: node --import tsx --test apps/server/test/readiness.test.ts

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { readinessGate, markReady } from "../src/readiness.js";

const app = express();
app.use(readinessGate());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.json({ name: "api" }));
app.post("/matchmake", (_req, res) => res.json({ matched: true }));
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test("antes de tener el estado: /health y el índice responden, lo demás es 503 con reintento", async () => {
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
  assert.equal((await fetch(`${BASE}/`)).status, 200);
  const r = await fetch(`${BASE}/matchmake`, { method: "POST" });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("retry-after"), "5");
  assert.match(String(((await r.json()) as { error: string }).error), /restarting/);
});

test("con el estado cargado atiende todo", async () => {
  markReady();
  const r = await fetch(`${BASE}/matchmake`, { method: "POST" });
  assert.equal(r.status, 200);
});
