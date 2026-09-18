// El runner con agentes BYO en partidas EN VIVO: la notificación va sin semilla
// (con live: true y el hash del secreto), y al vencer el plazo un intento a medio
// jugar se cierra contando lo alcanzado; solo se rinde con 0 quien nunca lo abrió.
// El "dev" es un express local; nada sale a la red.
//
// Correr: node --import tsx --test apps/server/test/live-webhook-runner.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { privateKeyToAccount } from "viem/accounts";
import { liveStartAuthMessage } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { SecretSource } from "@arcade1v1/game-sdk/live";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";

// Flags leídos a la carga de módulos: ANTES del import dinámico.
process.env.WEBHOOK_ALLOW_PRIVATE = "true"; // el dev falso vive en 127.0.0.1
process.env.WEBHOOK_PLAY_DEADLINE_MS = "150"; // plazo corto para el test
process.env.MAX_AGENTS_PER_OWNER = "100";
process.env.AGENTS_ENABLED = "false"; // sin timer automático: tick manual
process.env.AGENT_PLAY_INTERVAL_MS = "50";
RULES_V.flappy = 2;
const { createHostedAgent, getAgent, listAgents, setAgentActive, WEBHOOK_STRATEGY_ID } =
  await import("../src/agents.js");
const { runAgentsTick } = await import("../src/agent-runner.js");
const { matchRecord } = await import("../src/matchmaking.js");
const { liveStart, liveCommit } = await import("../src/live.js");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const received: Record<string, unknown>[] = [];
const dev = express();
dev.use(express.json());
dev.post("/hook", (req, res) => {
  received.push(req.body as Record<string, unknown>);
  res.status(200).end();
});
const devServer = dev.listen(0);
after(() => devServer.close());
const HOOK = `http://127.0.0.1:${(devServer.address() as AddressInfo).port}/hook`;

/** Un BYO de Flappy y un rival de la casa, emparejados; devuelve la notificación. */
async function byoInLiveMatch(name: string) {
  for (const a of listAgents()) if (a.active) setAgentActive(a.id, false);
  const byo = createHostedAgent({
    owner: "0x00000000000000000000000000000000000000bb",
    name,
    avatar: "🤖",
    game: "flappy",
    strategyId: WEBHOOK_STRATEGY_ID,
    params: undefined,
    webhookUrl: HOOK,
  });
  createHostedAgent({
    owner: "0x00000000000000000000000000000000000000cc",
    name: `Rival ${name}`,
    avatar: "🐦",
    game: "flappy",
    strategyId: "flappy.threshold",
    params: undefined,
  });
  const before = received.length;
  for (let i = 0; i < 4 && received.length === before; i++) await runAgentsTick();
  assert.equal(received.length, before + 1, "llegó la notificación");
  return { byo, note: received[received.length - 1] };
}

test("la notificación de una partida en vivo va sin semilla, con live y el hash del secreto", async () => {
  const { byo, note } = await byoInLiveMatch("Aviso");
  assert.equal(note.agentId, byo.id);
  assert.equal(note.live, true);
  assert.equal("seed" in note, false);
  const m = matchRecord(String(note.matchId))!;
  assert.match(String(note.secretHash), /^[0-9a-f]{64}$/);
  assert.notEqual(note.secretHash, m.liveSecret, "el hash, nunca el secreto");
});

test("plazo vencido sin abrir el intento: se rinde con 0", async () => {
  const { byo, note } = await byoInLiveMatch("Ausente");
  await sleep(200);
  await runAgentsTick();
  const m = matchRecord(String(note.matchId))!;
  const addr = byo.address.toLowerCase();
  assert.equal(m.scores[addr], 0);
  assert.deepEqual(m.replays[addr], { ticks: 0, flaps: [], v: 2 });
});

test("plazo vencido con el intento a medio jugar: se cierra contando lo alcanzado", async () => {
  const { byo, note } = await byoInLiveMatch("Lento");
  const matchId = String(note.matchId);
  const addr = byo.address.toLowerCase();

  // El dev abre y juega 600 ticks con la estrategia de la casa. Los aleteos se
  // sacan con el secreto, cosa que solo puede hacer este test.
  const ts = Date.now();
  const signature = await privateKeyToAccount(getAgent(byo.id)!.privateKey).signMessage({
    message: liveStartAuthMessage(matchId, addr, ts),
  });
  const s = await liveStart(matchId, addr, { signature, ts });
  assert.equal(s.over, false);
  const def = getStrategy("flappy.threshold")!;
  const step = def.step!(defaultParams(def));
  const g = new FlappyEngine(new SecretSource(matchRecord(matchId)!.liveSecret!));
  const flaps: number[] = [];
  for (let t = 0; t < 600; t++) {
    if (step.decide(g, t)) {
      g.flap();
      flaps.push(t);
    }
    g.update(FLAPPY_DT);
  }
  assert.equal(g.over, false, "sigue vivo en el tick 600");
  assert.ok(g.score > 0, "y ya pasó tubos");
  const token = (s as { token: string }).token;
  await liveCommit(matchId, addr, { token, from: 0, to: 600, flaps, have: 0 });

  await sleep(200); // se vence el plazo
  await runAgentsTick();
  const m = matchRecord(matchId)!;
  assert.equal(m.scores[addr], g.score, "cuenta lo alcanzado, no la rendición");
  assert.deepEqual(m.replays[addr], { ticks: 600, flaps, v: 2 });
});
