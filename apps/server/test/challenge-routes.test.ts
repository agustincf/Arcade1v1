// Tests HTTP de duelos: firma del challenger (humano) / del dueño (agente→agente),
// anti-farming del mismo dueño, y rechazo de firma ajena. REQUIRE_AUTH on.
//
// Correr: node --import tsx --test apps/server/test/challenge-routes.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { challengeAuthMessage, agentAuthMessage } from "@arcade1v1/game-sdk/auth";

process.env.REQUIRE_AUTH = "true";
const { challengeRouter } = await import("../src/challenge-routes.js");
const { createHostedAgent, setAgentPending, setAgentActive } = await import("../src/agents.js");

const app = express();
app.use(express.json());
app.use(challengeRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const suf = Date.now().toString(16).slice(-8);
const mkOwner = (c: string) => "0x" + c.repeat(40 - suf.length) + suf; // 40 hex, único por corrida
const ownerA = mkOwner("a");
const ownerB = mkOwner("b");
const mkAgent = (owner: string, name: string) =>
  createHostedAgent({
    owner,
    name,
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });

async function post(body: unknown) {
  const r = await fetch(`${BASE}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

test("humano→agente con firma válida crea el desafío", async () => {
  const target = mkAgent(ownerB, "Rival");
  const human = privateKeyToAccount(generatePrivateKey());
  const H = human.address.toLowerCase();
  const ts = Date.now();
  const signature = await human.signMessage({
    message: challengeAuthMessage(H, target.address, ts),
  });
  const r = await post({ challenger: H, targetAgentId: target.id, signature, ts });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "waiting");
});

test("humano→agente con firma ajena es rechazado", async () => {
  const target = mkAgent(ownerB, "Rival2");
  const human = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const H = human.address.toLowerCase();
  const ts = Date.now();
  const signature = await other.signMessage({
    message: challengeAuthMessage(H, target.address, ts),
  });
  const r = await post({ challenger: H, targetAgentId: target.id, signature, ts });
  assert.equal(r.status, 400);
});

test("humano→SU PROPIO agente es rechazado (anti-farming)", async () => {
  // El humano dueño intenta desafiar a su propio agente para farmearle ELO.
  const owner = privateKeyToAccount(generatePrivateKey());
  const O = owner.address.toLowerCase();
  const mineTarget = mkAgent(O, "MioTarget");
  const ts = Date.now();
  const signature = await owner.signMessage({
    message: challengeAuthMessage(O, mineTarget.address, ts),
  });
  const r = await post({ challenger: O, targetAgentId: mineTarget.id, signature, ts });
  assert.equal(r.status, 400);
});

test("agente→agente del MISMO dueño es rechazado (anti-farming)", async () => {
  const mine1 = mkAgent(ownerA, "MioUno");
  const mine2 = mkAgent(ownerA, "MioDos");
  const ts = Date.now();
  // Firma cualquiera: el server corta ANTES por mismo dueño (ownerA === ownerA).
  const signer = privateKeyToAccount(generatePrivateKey());
  const signature = await signer.signMessage({
    message: agentAuthMessage("challenge", mine1.id, mine1.owner, ts),
  });
  const r = await post({ byAgentId: mine1.id, targetAgentId: mine2.id, signature, ts });
  assert.equal(r.status, 400);
});

test("agente→agente OCUPADO (partida en curso) es rechazado, no le pisa la partida", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const O = owner.address.toLowerCase();
  const busy = mkAgent(O, "Ocupado");
  const target = mkAgent(ownerB, "RivalBusy");
  setAgentPending(busy, "0xmatch-en-curso"); // ya está jugando otra partida
  const ts = Date.now();
  const signature = await owner.signMessage({
    message: agentAuthMessage("challenge", busy.id, busy.owner, ts),
  });
  const r = await post({ byAgentId: busy.id, targetAgentId: target.id, signature, ts });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /busy/);
  assert.equal(busy.pendingMatchId, "0xmatch-en-curso"); // la partida en curso quedó intacta
});

test("agente→agente PAUSADO es rechazado (no crearía desafíos que nunca juega)", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const O = owner.address.toLowerCase();
  const paused = mkAgent(O, "Pausado");
  // Dueño propio para el target: ownerB ya llegó al tope de agentes por dueño.
  const target = mkAgent(mkOwner("c"), "RivalPaused");
  setAgentActive(paused.id, false);
  const ts = Date.now();
  const signature = await owner.signMessage({
    message: agentAuthMessage("challenge", paused.id, paused.owner, ts),
  });
  const r = await post({ byAgentId: paused.id, targetAgentId: target.id, signature, ts });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /paused/);
});
