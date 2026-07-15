// Tests HTTP de los agentes BYO por webhook: creación (secreto una sola vez),
// vistas sin secretos, y el endpoint /play (auth por secreto + verificación
// de replay + registro del resultado). REQUIRE_AUTH activado como producción.
//
// Correr: node --import tsx --test apps/server/test/webhook-routes.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentAuthMessage, matchmakeAuthMessage, scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";

// Flags leídos a la carga de los módulos: fijarlos ANTES del import dinámico.
process.env.REQUIRE_AUTH = "true";
process.env.MAX_AGENTS_PER_OWNER = "100";
const { agentsRouter } = await import("../src/agents-routes.js");
const { getAgent, setAgentPending } = await import("../src/agents.js");
const { matchmake, submitScore } = await import("../src/matchmaking.js");

const app = express();
app.use(express.json());
app.use(agentsRouter);
const server = app.listen(0);
const PORT = (server.address() as AddressInfo).port;
const BASE = `http://127.0.0.1:${PORT}`;
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

/** Crea un agente webhook firmado por el dueño y devuelve {id, secret}. */
async function createWebhookAgent(name: string) {
  const ts = Date.now();
  const signature = await owner.signMessage({
    message: agentAuthMessage("create", `2048:webhook:${name}`, OWNER, ts),
  });
  const { status, body } = await post("/agents", {
    owner: OWNER,
    name,
    avatar: "🤖",
    game: "2048",
    strategyId: "webhook",
    webhookUrl: "https://example.com/hook",
    signature,
    ts,
  });
  assert.equal(status, 200, JSON.stringify(body));
  return { id: String(body.id), secret: String(body.webhookSecret), body };
}

/** Empareja al agente BYO con un rival de test; devuelve el estado listo. */
async function pairWithRival(agentId: string) {
  const a = getAgent(agentId)!;
  const agentAccount = privateKeyToAccount(a.privateKey);
  const agentAddr = a.address.toLowerCase();
  let ts = Date.now();
  let signature = await agentAccount.signMessage({
    message: matchmakeAuthMessage("2048", 0, agentAddr, ts),
  });
  const m1 = await matchmake("2048", 0, agentAddr, { signature, ts });
  setAgentPending(a, m1.matchId); // lo que haría el runner al encolar

  const rival = privateKeyToAccount(generatePrivateKey());
  const rivalAddr = rival.address.toLowerCase();
  ts = Date.now();
  signature = await rival.signMessage({
    message: matchmakeAuthMessage("2048", 0, rivalAddr, ts),
  });
  const m2 = await matchmake("2048", 0, rivalAddr, { signature, ts });
  assert.equal(m2.matchId, m1.matchId, "emparejados en la misma partida");
  return { matchId: m1.matchId, seed: m2.seed, rival, rivalAddr, agentAddr };
}

/** Corrida REAL de 2048 sobre la semilla (pasa la verificación del árbitro). */
function realRun(seed: number) {
  const def = getStrategy("2048.priority")!;
  return def.play(seed, defaultParams(def));
}

test("crear: devuelve webhookSecret UNA vez; las vistas nunca lo repiten", async () => {
  const { id, secret, body } = await createWebhookAgent("Secreta");
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(body.byo, true);
  assert.ok(!("privateKey" in body) && !("webhook" in body), "sin objetos internos");

  const r = await fetch(`${BASE}/agents/${id}`);
  const view = (await r.json()) as Record<string, unknown>;
  assert.equal(view.byo, true);
  const json = JSON.stringify(view);
  assert.ok(!json.includes(secret), "GET no repite el secreto");
  assert.ok(!json.includes("example.com"), "GET no publica la URL");
});

test("crear webhook SIN webhookUrl → 400 con mensaje claro", async () => {
  const ts = Date.now();
  const signature = await owner.signMessage({
    message: agentAuthMessage("create", `2048:webhook:SinUrl`, OWNER, ts),
  });
  const { status, body } = await post("/agents", {
    owner: OWNER,
    name: "SinUrl",
    avatar: "🤖",
    game: "2048",
    strategyId: "webhook",
    signature,
    ts,
  });
  assert.equal(status, 400);
  assert.match(String(body.error), /webhookUrl/);
});

test("/play: secreto malo 401; id inexistente 404; sin partida pendiente 409", async () => {
  const { id, secret } = await createWebhookAgent("Guardias");
  const bad = await post(
    `/agents/${id}/play`,
    { matchId: "m_x", score: 1, replay: {} },
    { Authorization: "Bearer nope" },
  );
  assert.equal(bad.status, 401);

  const ghost = await post(
    `/agents/agt_000000000000000/play`,
    { matchId: "m_x", score: 1, replay: {} },
    { Authorization: `Bearer ${secret}` },
  );
  assert.equal(ghost.status, 404);

  const noPending = await post(
    `/agents/${id}/play`,
    { matchId: "m_x", score: 1, replay: {} },
    { Authorization: `Bearer ${secret}` },
  );
  assert.equal(noPending.status, 409);

  // El esquema es case-insensitive (RFC 7235): "bearer" en minúscula con el
  // secreto correcto NO debe rebotar por auth (llega hasta el 409 de pending).
  const lower = await post(
    `/agents/${id}/play`,
    { matchId: "m_x", score: 1, replay: {} },
    { Authorization: `bearer ${secret}` },
  );
  assert.equal(lower.status, 409, "bearer minúscula pasa la auth (no 401)");
});

test("/play feliz: replay real → 200 settled, historial registrado, segundo /play 409", async () => {
  const { id, secret } = await createWebhookAgent("Jugadora");
  const { matchId, seed, rival, rivalAddr } = await pairWithRival(id);

  // El rival juega primero (así el /play del BYO decide la partida).
  const rivalRun = realRun(seed);
  const rs = await rival.signMessage({
    message: scoreAuthMessage(matchId, rivalAddr, rivalRun.score),
  });
  await submitScore(matchId, rivalAddr, rivalRun.score, rivalRun.replay, rs);

  // Replay TRUCHO primero: score inflado → 400 y se puede reintentar.
  const cheat = await post(
    `/agents/${id}/play`,
    { matchId, score: 999999, replay: rivalRun.replay },
    { Authorization: `Bearer ${secret}` },
  );
  assert.equal(cheat.status, 400, "score que el replay no reproduce → rechazado");

  // Corrida real del agente sobre SU semilla → decide la partida.
  const run = realRun(seed);
  const ok = await post(
    `/agents/${id}/play`,
    { matchId, score: run.score, replay: run.replay },
    { Authorization: `Bearer ${secret}` },
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(["settled", "draw"].includes(String(ok.body.status)), "la partida quedó decidida");

  const a = getAgent(id)!;
  assert.equal(a.pendingMatchId, undefined, "pending limpio tras registrar");
  assert.equal(a.stats.matches, 1, "resultado en el historial");

  // Repetir el /play: la partida ya no es la pendiente → 409.
  const again = await post(
    `/agents/${id}/play`,
    { matchId, score: run.score, replay: run.replay },
    { Authorization: `Bearer ${secret}` },
  );
  assert.equal(again.status, 409);
});

test("kill switch: create 400 y /play 403 con WEBHOOK_AGENTS_ENABLED=false", async () => {
  const { id, secret } = await createWebhookAgent("Interruptor");
  process.env.WEBHOOK_AGENTS_ENABLED = "false";
  try {
    const ts = Date.now();
    const signature = await owner.signMessage({
      message: agentAuthMessage("create", `2048:webhook:Apagada`, OWNER, ts),
    });
    const off = await post("/agents", {
      owner: OWNER,
      name: "Apagada",
      avatar: "🤖",
      game: "2048",
      strategyId: "webhook",
      webhookUrl: "https://example.com/hook",
      signature,
      ts,
    });
    assert.equal(off.status, 400);
    assert.match(String(off.body.error), /disabled/);

    const play = await post(
      `/agents/${id}/play`,
      { matchId: "m_x", score: 1, replay: {} },
      { Authorization: `Bearer ${secret}` },
    );
    assert.equal(play.status, 403);
  } finally {
    delete process.env.WEBHOOK_AGENTS_ENABLED;
  }
});

test("update: webhookUrl inválida 400; válida ok; params no explota (regresión)", async () => {
  const { id } = await createWebhookAgent("Editable");
  let ts = Date.now();
  let signature = await owner.signMessage({
    message: agentAuthMessage("update", id, OWNER, ts),
  });
  const bad = await post(`/agents/${id}`, {
    action: "update",
    webhookUrl: "http://plain.example.com/x",
    signature,
    ts,
  });
  assert.equal(bad.status, 400);

  ts = Date.now();
  signature = await owner.signMessage({
    message: agentAuthMessage("update", id, OWNER, ts),
  });
  const good = await post(`/agents/${id}`, {
    action: "update",
    webhookUrl: "https://nuevo.example.com/hook",
    params: { greed: 1 }, // antes esto explotaba con strategyId fuera del registro
    signature,
    ts,
  });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(getAgent(id)!.webhook!.url, "https://nuevo.example.com/hook");
});
