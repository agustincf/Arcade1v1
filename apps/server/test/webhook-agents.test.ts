// Integración del runner con agentes BYO: notificación con HMAC verificable,
// forfeit al vencer el plazo, auto-pausa por fallas y gating de desafíos.
// El "dev" es un express local; nada sale a la red.
//
// Correr: node --import tsx --test apps/server/test/webhook-agents.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { SNAKE_RULES_V } from "@arcade1v1/game-sdk/snake";
import { RACING_RULES_V } from "@arcade1v1/game-sdk/racing";

// Flags leídos a la carga de módulos: ANTES del import dinámico.
process.env.WEBHOOK_ALLOW_PRIVATE = "true"; // el fake server vive en 127.0.0.1
process.env.WEBHOOK_PLAY_DEADLINE_MS = "150"; // forfeit rápido para el test
process.env.WEBHOOK_MAX_FAILURES = "3";
process.env.MAX_AGENTS_PER_OWNER = "100";
process.env.AGENTS_ENABLED = "false"; // sin timer automático: tick manual
process.env.AGENT_PLAY_INTERVAL_MS = "50"; // re-encolar rápido entre partidas
const { createHostedAgent, listAgents, setAgentActive, WEBHOOK_STRATEGY_ID } =
  await import("../src/agents.js");
const { runAgentsTick, emptyReplay } = await import("../src/agent-runner.js");
const { getMatch, createChallenge } = await import("../src/matchmaking.js");
const { webhookSignature } = await import("../src/webhook-fetch.js");

const OWNER = "0x00000000000000000000000000000000000000bb";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Fake server del "dev": captura las notificaciones y valida el HMAC ---
type Notif = { body: Record<string, unknown>; raw: string; sig: string };
const received: Notif[] = [];
let respondWith = 200; // el test puede simular un endpoint roto

const fake = express();
fake.use(express.text({ type: "*/*" })); // raw body para verificar el HMAC
fake.post("/hook", (req, res) => {
  received.push({
    body: JSON.parse(String(req.body)),
    raw: String(req.body),
    sig: String(req.headers["x-arcade-signature"] ?? ""),
  });
  res.status(respondWith).end();
});
const fakeServer = fake.listen(0);
const FAKE_PORT = (fakeServer.address() as AddressInfo).port;
after(() => fakeServer.close());

function newWebhookAgent(name: string, game = "snake") {
  return createHostedAgent({
    owner: OWNER,
    name,
    avatar: "🤖",
    game,
    strategyId: WEBHOOK_STRATEGY_ID,
    params: undefined,
    webhookUrl: `http://127.0.0.1:${FAKE_PORT}/hook`,
  });
}

const RIVAL_STRATEGIES: Record<string, string> = {
  snake: "snake.greedy",
  flappy: "flappy.threshold",
  racing: "racing.dodger",
  invaders: "invaders.hunter",
};

function newHostedRival(name: string, game = "snake") {
  return createHostedAgent({
    owner: "0x00000000000000000000000000000000000000cc",
    name,
    avatar: "🐍",
    game,
    strategyId: RIVAL_STRATEGIES[game],
    params: undefined,
  });
}

/** Aislamiento entre tests: pausa TODO lo creado antes (el estado del módulo
 *  es compartido y los ticks procesan a todos los agentes activos). */
function pauseAll() {
  for (const a of listAgents()) if (a.active) setAgentActive(a.id, false);
}

test("emparejar → notificar con HMAC verificable → forfeit al vencer el plazo", async () => {
  // v2: las estrategias hosteadas de snake/racing ya declaran `v`, así que este
  // test de protocolo vuelve a ejercer el juego real (antes reroteado a flappy
  // porque el rival hosteado quedaba trabado por versión de reglas).
  const byo = newWebhookAgent("Remota", "snake");
  newHostedRival("Rival Local", "snake");

  // Tick 1: ambos se encolan y quedan emparejados. Tick 2: el hosteado juega
  // y al BYO se lo notifica. (El orden dentro del tick no importa: iteramos
  // hasta que llegue la notificación.)
  for (let i = 0; i < 4 && received.length === 0; i++) await runAgentsTick();
  assert.equal(received.length, 1, "llegó exactamente una notificación");

  const n = received[0];
  assert.equal(n.body.agentId, byo.id);
  assert.equal(n.body.game, "snake");
  assert.equal(typeof n.body.seed, "number");
  assert.equal(typeof n.body.deadline, "number");
  // El dev verifica la autenticidad con su secreto: HMAC del body crudo.
  assert.equal(n.sig, `sha256=${webhookSignature(byo.webhook!.secret, n.raw)}`);

  // Sin /play dentro del plazo → el runner rinde por él (score 0 verificable).
  const matchId = String(n.body.matchId);
  await sleep(200); // > WEBHOOK_PLAY_DEADLINE_MS del test
  await runAgentsTick();
  const m = getMatch(matchId, byo.address.toLowerCase());
  assert.ok(m, "la partida sigue viva");
  assert.equal(m!.scores[byo.address.toLowerCase()], 0, "forfeit con score 0");
  assert.equal(byo.webhook!.failures, 1, "el forfeit cuenta como falla");
});

test("endpoint roto (500): el reloj arranca igual; la falla la cuenta el forfeit, no la notificación", async () => {
  pauseAll();
  received.length = 0;
  respondWith = 500;
  try {
    const byo = newWebhookAgent("Rota", "flappy");
    newHostedRival("Rival Flappy", "flappy");
    for (let i = 0; i < 4 && received.length === 0; i++) await runAgentsTick();
    assert.equal(received.length, 1, "se intentó notificar");
    // La notificación fallida NO cuenta falla por sí sola: arranca el reloj y el
    // forfeit al vencer la cuenta (una sola por partida). Así el rival nunca
    // queda colgado y "3 fallas" son 3 partidas sin responder, no partida y media.
    assert.equal(byo.webhook!.failures, 0, "la notificación fallida no cuenta sola");
    assert.ok(byo.webhook!.notifiedAt, "el reloj corre aunque la notificación falle");
    await sleep(200); // > deadline
    await runAgentsTick(); // forfeit
    assert.equal(byo.webhook!.failures, 1, "el forfeit cuenta la única falla de la partida");
  } finally {
    respondWith = 200;
  }
});

test("fallas consecutivas → auto-pausa", async () => {
  pauseAll();
  received.length = 0;
  respondWith = 500;
  try {
    const byo = newWebhookAgent("Muerta", "racing");
    newHostedRival("Rival Racing", "racing");
    // Cada partida con el endpoint roto suma: notificación fallida (+1) y
    // forfeit al vencer el plazo (+1). A la tercera consecutiva se pausa.
    for (let round = 0; round < 30 && byo.active; round++) {
      await runAgentsTick();
      await sleep(80);
    }
    assert.equal(byo.active, false, "auto-pausada tras fallas consecutivas");
  } finally {
    respondWith = 200;
  }
});

test("kill switch a mitad de partida: el runner rinde igual, el rival no queda colgado", async () => {
  pauseAll();
  received.length = 0;
  respondWith = 200;
  const byo = newWebhookAgent("EnVuelo", "snake");
  newHostedRival("Rival EnVuelo", "snake");
  // Emparejar y notificar (partida en vuelo, esperando el /play del dev).
  for (let i = 0; i < 4 && received.length === 0; i++) await runAgentsTick();
  assert.equal(received.length, 1, "notificada");
  const matchId = String(received[0].body.matchId);

  // Apagar el kill switch con la partida ya emparejada. El agente igual debe
  // cerrarla (rendir) — antes, el runner lo salteaba y el rival esperaba ~2h.
  process.env.WEBHOOK_AGENTS_ENABLED = "false";
  try {
    await runAgentsTick();
  } finally {
    delete process.env.WEBHOOK_AGENTS_ENABLED;
  }
  const m = getMatch(matchId, byo.address.toLowerCase());
  assert.ok(m, "la partida sigue viva");
  assert.equal(m!.scores[byo.address.toLowerCase()], 0, "rendida pese al kill switch");
  assert.equal(byo.webhook!.failures, 0, "el forfeit por kill switch no cuenta como falla del dev");
});

test("desafío al BYO: NO se notifica hasta que el retador juegue", async () => {
  pauseAll();
  received.length = 0;
  const byo = newWebhookAgent("Desafiada", "invaders");
  // Desafío dirigido (partida con target) sin que el retador envíe su intento.
  createChallenge("invaders", "0x00000000000000000000000000000000000000dd", byo.address);
  await runAgentsTick();
  await runAgentsTick();
  assert.equal(received.length, 0, "cero requests al dev: el retador no jugó");
});

test("emptyReplay: forma correcta por juego (v1 sin `v`; v2 la declara)", () => {
  assert.deepEqual(emptyReplay("2048", 7), { seed: 7, moves: [] });
  assert.deepEqual(emptyReplay("flappy", 7), { seed: 7, ticks: 0, flaps: [] });
  assert.deepEqual(emptyReplay("snake", 7), { seed: 7, ticks: 0, inputs: [], v: SNAKE_RULES_V });
  assert.deepEqual(emptyReplay("racing", 7), { seed: 7, ticks: 0, inputs: [], v: RACING_RULES_V });
});
