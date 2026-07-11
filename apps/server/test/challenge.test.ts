// Desafíos directos (ladder gratis): creación fuera de la cola, aceptación solo
// por el target, listado de pendientes, y que el matchmake normal no los toca.
// Además el runner del agente objetivo acepta y juega un desafío dirigido.
//
// Correr: node --import tsx --test apps/server/test/challenge.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChallenge,
  acceptChallenge,
  pendingChallengesFor,
  matchmake,
  getMatch,
  submitScore,
} from "../src/matchmaking.js";
import { runAgentsTick } from "../src/agent-runner.js";
import { createHostedAgent, deleteAgent, getAgent } from "../src/agents.js";
import { runStrategy, getStrategy, defaultParams } from "@arcade1v1/strategies";

// Addresses hex válidas y únicas por corrida (createHostedAgent valida el owner
// con /^0x[0-9a-f]{40}$/, así que el tag debe ser hex).
const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "000000");
let ctr = 0;
const addr = (_tag?: string) =>
  "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

test("createChallenge no entra en la cola general (matchmake no lo toma)", async () => {
  const chA = addr("c1");
  const target = addr("t1");
  const ch = createChallenge("2048", chA, target);
  assert.equal(ch.status, "waiting");
  // Otro jugador que hace matchmake normal NO debe emparejarse con el desafío.
  const other = await matchmake("2048", 0, addr("o1"));
  assert.notEqual(other.matchId, ch.matchId);
  assert.equal(other.status, "waiting"); // creó su propia espera, no tomó el desafío
});

test("acceptChallenge: solo el target; un tercero es rechazado", () => {
  const chA = addr("c2");
  const target = addr("t2");
  const ch = createChallenge("2048", chA, target);
  // Un tercero cualquiera y el propio challenger (que no es el target) son
  // rechazados: solo el target entra.
  assert.throws(() => acceptChallenge(ch.matchId, addr("x2")), /not the challenged rival/);
  assert.throws(() => acceptChallenge(ch.matchId, chA), /not the challenged rival/);
  const ready = acceptChallenge(ch.matchId, target);
  assert.equal(ready.status, "ready");
});

test("pendingChallengesFor lista solo los dirigidos a esa address", () => {
  const target = addr("t3");
  const ch = createChallenge("2048", addr("c3"), target);
  const list = pendingChallengesFor(target);
  assert.ok(list.some((c) => c.matchId === ch.matchId && c.game === "2048"));
  assert.equal(pendingChallengesFor(addr("z3")).length, 0);
});

test("el runner del agente objetivo acepta un desafío humano y lo toma", async () => {
  const target = createHostedAgent({
    owner: addr("ow"),
    name: "Retado",
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });
  const human = addr("hu");
  const ch = createChallenge("2048", human, target.address);
  await runAgentsTick();
  const after = getAgent(target.id)!;
  assert.equal(after.pendingMatchId, ch.matchId);
  deleteAgent(target.id);
});

test("anti-DoS: el agente desafiado NO juega hasta que el retador jugó, y luego liquida", async () => {
  const target = createHostedAgent({
    owner: addr("ow2"),
    name: "Retado2",
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });
  const H = addr("hu2");
  const ch = createChallenge("2048", H, target.address);

  // Tick 1: el agente acepta pero NO se compromete (el retador aún no jugó).
  await runAgentsTick();
  const v1 = getMatch(ch.matchId, H)!;
  assert.equal(v1.status, "ready", "aceptado");
  assert.equal(v1.rivalSubmitted, false, "el agente NO jugó todavía (espera al retador)");

  // El retador juega su intento (sin firma: en tests AUTH no es obligatoria).
  const run = runStrategy(
    {
      game: "2048",
      strategyId: "2048.priority",
      params: defaultParams(getStrategy("2048.priority")!),
    },
    ch.seed,
  );
  await submitScore(ch.matchId, H, run.score, run.replay);

  // Tick 2: ahora sí el agente juega y la partida se liquida.
  await runAgentsTick();
  const v2 = getMatch(ch.matchId, H)!;
  assert.ok(v2.status === "settled" || v2.status === "draw", "liquidada tras jugar el retador");
  deleteAgent(target.id);
});
