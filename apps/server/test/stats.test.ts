// Tests de las métricas del árbitro: incrementos (total + por día UTC),
// rollover de día, poda del histórico y forma del snapshot. Herméticos: sin
// ARCADE_PERSIST, el store no toca disco ni red.
//
// Correr: node --import tsx --test apps/server/test/stats.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  recordMatchCreated,
  recordMatchSettled,
  recordVerificationRejected,
  statsSnapshot,
  STATS_MAX_DAYS,
  __resetStatsForTest,
} from "../src/stats.js";

// Medianoche UTC de días concretos, para controlar el "día" sin tocar el reloj.
const DAY = 24 * 60 * 60 * 1000;
const d = (iso: string) => Date.parse(iso + "T12:00:00Z");

test("incrementa totales y el día correspondiente", () => {
  __resetStatsForTest(d("2026-07-10"));
  recordMatchCreated(d("2026-07-10"));
  recordMatchCreated(d("2026-07-10"));
  recordMatchSettled(0, d("2026-07-10")); // houseSide primero desde v4.1 (embudo)
  recordVerificationRejected(d("2026-07-10"));

  const s = statsSnapshot(0, d("2026-07-10"));
  assert.equal(s.totals.matchesCreated, 2);
  assert.equal(s.totals.matchesSettled, 1);
  assert.equal(s.totals.verificationsRejected, 1);
  assert.equal(s.today.matchesCreated, 2);
  assert.equal(s.today.matchesSettled, 1);
  assert.equal(s.today.verificationsRejected, 1);
});

test("el día rota: 'hoy' vuelve a cero, el total se mantiene", () => {
  __resetStatsForTest(d("2026-07-10"));
  recordMatchCreated(d("2026-07-10"));
  recordMatchCreated(d("2026-07-11"));

  const s = statsSnapshot(0, d("2026-07-11"));
  assert.equal(s.totals.matchesCreated, 2, "el total acumula entre días");
  assert.equal(s.today.matchesCreated, 1, "'hoy' es solo el día en curso");
});

test("el histórico diario se poda a STATS_MAX_DAYS", () => {
  __resetStatsForTest(d("2026-01-01"));
  // Un evento por día durante bastantes más días que el tope.
  const days = STATS_MAX_DAYS + 20;
  for (let i = 0; i < days; i++) {
    recordMatchCreated(d("2026-01-01") + i * DAY);
  }
  const s = statsSnapshot(0, d("2026-01-01") + (days - 1) * DAY);
  assert.ok(
    s.daily.length <= STATS_MAX_DAYS,
    `daily no debe exceder ${STATS_MAX_DAYS} (fue ${s.daily.length})`,
  );
  // El total NO se pierde al podar el detalle diario.
  assert.equal(s.totals.matchesCreated, days);
});

test("activeAgents se inyecta (no se persiste) y el snapshot trae uptime", () => {
  __resetStatsForTest(d("2026-07-10"));
  const s = statsSnapshot(7, d("2026-07-10"));
  assert.equal(s.activeAgents, 7);
  assert.equal(typeof s.uptimeSeconds, "number");
  assert.ok(s.uptimeSeconds >= 0);
  assert.equal(typeof s.since, "number");
});
