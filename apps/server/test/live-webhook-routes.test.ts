// Rutas EN VIVO de los agentes BYO por webhook: el dev juega con el secreto de
// su agente (sin firmas de wallet), sobre la partida pendiente que le avisó el
// runner. Mismas guardias que /play.
//
// Correr: node --import tsx --test apps/server/test/live-webhook-routes.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentAuthMessage, matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";

process.env.REQUIRE_AUTH = "true";
process.env.MAX_AGENTS_PER_OWNER = "100";
RULES_V.flappy = 2;
const { agentsRouter, agentsPostLimit } = await import("../src/agents-routes.js");
const { getAgent, setAgentPending } = await import("../src/agents.js");
const { matchmake } = await import("../src/matchmaking.js");

const app = express();
app.use(express.json());
app.use(agentsRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const owner = privateKeyToAccount(generatePrivateKey());
const OWNER = owner.address.toLowerCase();

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

async function flappyWebhookAgentInMatch(name: string) {
  const ts = Date.now();
  const signature = await owner.signMessage({
    message: agentAuthMessage("create", `flappy:webhook:${name}`, OWNER, ts),
  });
  const created = await post("/agents", {
    owner: OWNER,
    name,
    avatar: "🤖",
    game: "flappy",
    strategyId: "webhook",
    webhookUrl: "https://example.com/hook",
    signature,
    ts,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = String(created.body.id);
  const secret = String(created.body.webhookSecret);
  const a = getAgent(id)!;
  const agentAddr = a.address.toLowerCase();
  let t = Date.now();
  const s1 = await privateKeyToAccount(a.privateKey).signMessage({
    message: matchmakeAuthMessage("flappy", 0, agentAddr, t),
  });
  const m = await matchmake("flappy", 0, agentAddr, { signature: s1, ts: t });
  setAgentPending(a, m.matchId);
  const rival = privateKeyToAccount(generatePrivateKey());
  t = Date.now();
  const s2 = await rival.signMessage({
    message: matchmakeAuthMessage("flappy", 0, rival.address.toLowerCase(), t),
  });
  await matchmake("flappy", 0, rival.address.toLowerCase(), { signature: s2, ts: t });
  return { id, secret, matchId: m.matchId };
}

test("BYO en vivo: abre y compromete con el secreto; secreto malo 401 y partida ajena 409", async () => {
  const { id, secret, matchId } = await flappyWebhookAgentInMatch("EnVivo");
  const auth = { Authorization: `Bearer ${secret}` };

  const start = await post(`/agents/${id}/live/start`, { matchId }, auth);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.over, false);
  const token = String(start.body.token);

  const commit = await post(
    `/agents/${id}/live/commit`,
    { matchId, token, from: 0, to: 30, flaps: [0], have: 1 },
    auth,
  );
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.tick, 30);

  const conflict = await post(
    `/agents/${id}/live/commit`,
    { matchId, token, from: 0, to: 40, flaps: [], have: 1 },
    auth,
  );
  assert.equal(conflict.status, 409);

  const badSecret = await post(
    `/agents/${id}/live/start`,
    { matchId },
    { Authorization: "Bearer nope" },
  );
  assert.equal(badSecret.status, 401);

  const otherMatch = await post(
    `/agents/${id}/live/start`,
    { matchId: "0x" + "0".repeat(64) },
    auth,
  );
  assert.equal(otherMatch.status, 409);
});

test("límites de /agents: comprometer en vivo va por el limitador en vivo; los demás POST, por el estricto", async () => {
  const hits = { strict: 0, live: 0 };
  const counting =
    (k: keyof typeof hits): RequestHandler =>
    (_req, _res, next) => {
      hits[k] += 1;
      next();
    };
  const limited = express();
  limited.use("/agents", agentsPostLimit(counting("strict"), counting("live")));
  limited.use((_req, res) => {
    res.json({ ok: true });
  });
  const srv = limited.listen(0);
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const call = (method: string, path: string) => fetch(`${url}${path}`, { method });
    await call("POST", "/agents/a1/live/commit");
    assert.deepEqual(hits, { strict: 0, live: 1 });
    await call("POST", "/agents/a1/live/start");
    await call("POST", "/agents/a1/play");
    await call("POST", "/agents");
    assert.deepEqual(hits, { strict: 3, live: 1 });
    await call("GET", "/agents/a1");
    assert.deepEqual(hits, { strict: 3, live: 1 }, "las lecturas no pasan por ninguno");
  } finally {
    srv.close();
  }
});
