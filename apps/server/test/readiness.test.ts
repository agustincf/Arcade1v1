// LOS MODOS DE UNA INSTANCIA y qué atiende en cada uno: la tabla 3.3 del spec
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md, fila por fila.
// Correr: node --import tsx --test apps/server/test/readiness.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { readinessGate, setMode, waitForIdle, HANDOVER_PATH, type Mode } from "../src/readiness.js";

const hold: { release?: () => void } = {};
const app = express();
app.use(readinessGate());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.json({ name: "api" }));
app.post(HANDOVER_PATH, (_req, res) => res.status(202).json({ accepted: true }));
app.get("/aleph/lobbies", (_req, res) => res.json({ lobbies: [] }));
app.post("/matchmake", (_req, res) => res.json({ matched: true }));
app.get("/lento", (_req, res) => {
  hold.release = () => res.json({ ok: true });
});
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const status = async (path: string, method = "GET") =>
  (await fetch(`${BASE}${path}`, { method })).status;

// [modo, /health, todo lo demás]
const TABLA: [Mode, number, number][] = [
  ["starting", 503, 503],
  ["fallback", 200, 503],
  ["ready", 200, 200],
  ["draining", 200, 503],
  ["released", 200, 503],
  ["fenced", 503, 503],
];

for (const [mode, health, rest] of TABLA) {
  test(`modo ${mode}: /health ${health}, lo demás ${rest}; el índice y el timbre, siempre`, async () => {
    setMode(mode);
    assert.equal(await status("/health"), health);
    assert.equal(await status("/matchmake", "POST"), rest);
    assert.equal(await status("/aleph/lobbies"), rest, "leer también cambia el estado");
    assert.equal(await status("/"), 200);
    assert.equal(await status(HANDOVER_PATH, "POST"), 202);
  });
}

test("el 503 lleva Retry-After, para que el cliente reintente", async () => {
  setMode("starting");
  const r = await fetch(`${BASE}/matchmake`, { method: "POST" });
  assert.equal(r.headers.get("retry-after"), "5");
  assert.match(((await r.json()) as { error: string }).error, /restarting/);
});

test("waitForIdle espera los pedidos en curso y se rinde al tope", async () => {
  setMode("ready");
  const pending = fetch(`${BASE}/lento`);
  while (!hold.release) await new Promise((r) => setTimeout(r, 5));
  assert.equal(await waitForIdle(50), false, "con uno en curso, vence el tope");
  hold.release();
  await pending;
  assert.equal(await waitForIdle(1_000), true);
});
