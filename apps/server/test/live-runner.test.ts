// Un agente de la casa juega Flappy EN VIVO por el mismo camino que un humano:
// abre su intento firmado y compromete jugadas, en proceso. Nunca ve el secreto:
// su vista no lo trae hasta que la partida se decide.
//
// Correr: node --import tsx --test apps/server/test/live-runner.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { matchmakeAuthMessage, scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { SecretSource } from "@arcade1v1/game-sdk/live";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";

process.env.REQUIRE_AUTH = "true";
process.env.AGENTS_ENABLED = "false"; // sin timer: ticks manuales
process.env.MAX_AGENTS_PER_OWNER = "100";
RULES_V.flappy = 2;
const { createHostedAgent, getAgent } = await import("../src/agents.js");
const { runAgentsTick } = await import("../src/agent-runner.js");
const { matchmake, submitScore, getMatch, matchRecord } = await import("../src/matchmaking.js");

/** La estrategia por defecto jugada de un tirón, con todo el azar a la vista. */
function batchWithSecret(secret: string): number {
  const def = getStrategy("flappy.threshold")!;
  const step = def.step!(defaultParams(def));
  const g = new FlappyEngine(new SecretSource(secret));
  for (let t = 0; t < step.maxTicks && !g.over; t++) {
    if (step.decide(g, t)) g.flap();
    g.update(FLAPPY_DT);
  }
  return g.score;
}

test("la casa juega Flappy en vivo sin ver el secreto, y su puntaje es el de su estrategia", async () => {
  const agent = createHostedAgent({
    owner: "0x" + "a".repeat(40),
    name: "VivoCasa",
    avatar: "🤖",
    game: "flappy",
    strategyId: "flappy.threshold",
    params: undefined,
  });
  const agentAddr = agent.address.toLowerCase();

  await runAgentsTick(); // se encola
  const pending = getAgent(agent.id)!.pendingMatchId!;
  assert.ok(pending, "quedó esperando rival");

  const rival = privateKeyToAccount(generatePrivateKey());
  const rivalAddr = rival.address.toLowerCase();
  const ts = Date.now();
  const signature = await rival.signMessage({
    message: matchmakeAuthMessage("flappy", 0, rivalAddr, ts),
  });
  const m = await matchmake("flappy", 0, rivalAddr, { signature, ts });
  assert.equal(m.matchId, pending);
  assert.equal(m.live, true);

  await runAgentsTick(); // juega en vivo
  assert.equal(getMatch(pending, agentAddr)!.secret, undefined, "sin decidir: nada de secreto");
  const houseScore = matchRecord(pending)!.scores[agentAddr];
  assert.equal(typeof houseScore, "number", "el intento cerró con puntaje");

  const sig0 = await rival.signMessage({ message: scoreAuthMessage(pending, rivalAddr, 0) });
  const after = await submitScore(pending, rivalAddr, 0, { ticks: 0, flaps: [], v: 2 }, sig0);
  assert.ok(after.status === "settled" || after.status === "draw");

  const done = getMatch(pending)!;
  assert.equal(houseScore, batchWithSecret(done.secret!));
});
