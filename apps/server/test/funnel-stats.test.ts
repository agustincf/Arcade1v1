// Embudo de tracción (v4.1 Frente 4): agentes creados por terceros y partidas
// separadas por origen (casa/mixta/terceros) gracias a la etiqueta CASA.
//
// Correr: node --import tsx --test apps/server/test/funnel-stats.test.ts

import "../src/offline-env.js"; // corre offline con clave de prueba (ver el módulo)
import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  __resetStatsForTest,
  recordAgentCreated,
  recordMatchSettled,
  statsSnapshot,
} from "../src/stats.js";
import { createHostedAgent, deleteAgent, isHouseWallet, hostedAgentByAddress } from "../src/agents.js";
import { setHouseAddressCheck } from "../src/matchmaking.js";
import { runAgentsTick } from "../src/agent-runner.js";

test("embudo: agentes creados y partidas casa/mixta/terceros", () => {
  __resetStatsForTest(1_000);
  recordAgentCreated();
  recordMatchSettled(2); // casa vs casa
  recordMatchSettled(1); // tercero vs casa
  recordMatchSettled(0); // terceros puros
  recordMatchSettled(); // sin clasificar = tercero puro (retro-compat)
  const s = statsSnapshot(0);
  assert.equal(s.totals.agentsCreated, 1);
  assert.equal(s.totals.matchesSettled, 4);
  assert.equal(s.totals.settledHouse, 1);
  assert.equal(s.totals.settledMixed, 1);
  assert.equal(s.today.agentsCreated, 1);
});

// Integrado: dos agentes de la casa juegan de verdad (runner in-process, mismas
// reglas que producción) y el settle los clasifica como casa vs casa.
const suffix = Date.now().toString(16).slice(-10);
const HOUSE = "0x" + ("f4a" + suffix).padStart(40, "0");
process.env.HOUSE_WALLETS = (process.env.HOUSE_WALLETS ?? "") + `,${HOUSE}`;

const created: string[] = [];
after(() => {
  for (const id of created) {
    try {
      deleteAgent(id);
    } catch {
      /* ya borrado */
    }
  }
});

test("integrado: partidas casa vs casa suben settledHouse y no agentsCreated", async () => {
  __resetStatsForTest(1_000);
  // El mismo wiring que hace index.ts al arrancar:
  setHouseAddressCheck((a) => {
    const agent = hostedAgentByAddress(a);
    return !!agent && isHouseWallet(agent.owner);
  });

  for (const name of ["Casa Embudo 1", "Casa Embudo 2"]) {
    const a = createHostedAgent({
      owner: HOUSE,
      name,
      avatar: "🤖",
      game: "2048",
      strategyId: "2048.priority",
      params: {},
    });
    created.push(a.id);
  }
  // Un tick empareja, otro juega los intentos pendientes (margen: hasta 6).
  for (let i = 0; i < 6 && statsSnapshot(0).totals.settledHouse === 0; i++) {
    await runAgentsTick(Date.now() + i * 60_000);
  }
  const s = statsSnapshot(0);
  assert.ok(s.totals.settledHouse >= 1, `esperaba settledHouse >= 1, hay ${s.totals.settledHouse}`);
  assert.equal(s.totals.agentsCreated, 0); // los de la casa no cuentan como tracción
});
