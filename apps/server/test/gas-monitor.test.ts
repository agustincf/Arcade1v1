import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { GasMonitor, type GasAlert, type GasMonitorConfig } from "../src/gas-monitor.js";

const ARBITER = "0x1111111111111111111111111111111111111111" as Address;
const config: GasMonitorConfig = {
  address: ARBITER,
  rpcUrl: "https://rpc.example.test",
  thresholdWei: 10n,
  intervalMs: 60_000,
  alertCooldownMs: 1_000,
};

test("alerta cuando el saldo cae bajo el umbral y respeta el cooldown", async () => {
  let now = 0;
  const alerts: GasAlert[] = [];
  const monitor = new GasMonitor(
    config,
    { getBalance: async () => 9n },
    async (alert) => {
      alerts.push(alert);
    },
    () => now,
  );

  let state = await monitor.check();
  assert.equal(state.low, true);
  assert.equal(state.balanceWei, "9");
  assert.equal(alerts.length, 1);

  now = 999;
  await monitor.check();
  assert.equal(alerts.length, 1, "no repite antes del cooldown");

  now = 1_000;
  state = await monitor.check();
  assert.equal(alerts.length, 2, "vuelve a alertar al vencer el cooldown");
  assert.equal(state.lastAlertAt, 1_000);
});

test("saldo suficiente no alerta y un fallo de RPC no expone detalles", async () => {
  const noAlerts: GasAlert[] = [];
  const healthy = new GasMonitor(config, { getBalance: async () => 10n }, async (alert) => {
    noAlerts.push(alert);
  });
  const healthyState = await healthy.check();
  assert.equal(healthyState.low, false);
  assert.equal(noAlerts.length, 0);

  const failing = new GasMonitor(
    config,
    {
      getBalance: async () => {
        throw new Error("https://secret-rpc.example.test refused");
      },
    },
    async () => undefined,
  );
  const failedState = await failing.check();
  assert.equal(failedState.error, "No se pudo consultar el saldo de gas del árbitro");
  assert.doesNotMatch(JSON.stringify(failedState), /secret-rpc/);
});
