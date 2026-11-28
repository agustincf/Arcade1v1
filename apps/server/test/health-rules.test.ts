// /health publica la versión de reglas de cada juego: así un agente comprueba,
// ANTES de sentarse a una mesa de plata, que juega las mismas reglas que el
// árbitro. Si no coinciden y se entera recién después de emparejar, como p2
// deja a la persona que abrió esperando hasta 10 minutos.
//
// Correr: node --import tsx --test apps/server/test/health-rules.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES_V } from "@arcade1v1/game-sdk/rules";

const { healthBody } = await import("../src/health.js");

test("healthBody publica las reglas vigentes", () => {
  const h = healthBody();
  assert.equal(h.ok, true);
  assert.deepEqual(h.rules, RULES_V);
});
