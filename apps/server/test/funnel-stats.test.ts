// Embudo de tracción (v4.1 Frente 4): agentes creados por terceros y partidas
// separadas por origen (casa/mixta/terceros) gracias a la etiqueta CASA.
//
// Correr: node --import tsx --test apps/server/test/funnel-stats.test.ts

import "../src/offline-env.js"; // corre offline con clave de prueba (ver el módulo)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  __resetStatsForTest,
  recordAgentCreated,
  recordMatchSettled,
  statsSnapshot,
} from "../src/stats.js";

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
