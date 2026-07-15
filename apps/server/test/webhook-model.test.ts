// Modelo de agentes BYO por webhook: creación, vista, update y fallas.
// In-process (sin HTTP): prueba agents.ts directo, estilo funnel-stats.
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";

// Estos se leen a la carga del módulo: fijarlos ANTES del import dinámico.
process.env.WEBHOOK_MAX_FAILURES = "3";
process.env.MAX_AGENTS_PER_OWNER = "100"; // los tests crean varios del mismo owner
const {
  createHostedAgent,
  updateAgent,
  toView,
  markWebhookNotified,
  recordWebhookFailure,
  resetWebhookFailures,
  setAgentPending,
  WEBHOOK_STRATEGY_ID,
} = await import("../src/agents.js");

const OWNER = "0x00000000000000000000000000000000000000aa";

function newWebhookAgent(name: string) {
  return createHostedAgent({
    owner: OWNER,
    name,
    avatar: "🤖",
    game: "2048",
    strategyId: WEBHOOK_STRATEGY_ID,
    params: undefined,
    webhookUrl: "https://example.com/hook",
  });
}

test("crear agente webhook: secreto de 64 hex, params vacíos, sin estrategia del registro", () => {
  const a = newWebhookAgent("Cerebro Remoto");
  assert.equal(a.strategyId, "webhook");
  assert.deepEqual(a.params, {});
  assert.ok(a.webhook, "guarda el bloque webhook");
  assert.equal(a.webhook!.url, "https://example.com/hook");
  assert.match(a.webhook!.secret, /^[0-9a-f]{64}$/, "secreto CSPRNG de 32 bytes hex");
  assert.equal(a.webhook!.failures, 0);
});

test("toView: expone byo:true y NUNCA la URL ni el secreto", () => {
  const a = newWebhookAgent("Vista Limpia");
  const v = toView(a) as Record<string, unknown>;
  assert.equal(v.byo, true);
  const json = JSON.stringify(v);
  assert.ok(!json.includes(a.webhook!.secret), "el secreto no viaja en la vista");
  assert.ok(!json.includes("example.com"), "la URL no viaja en la vista");
  assert.ok(!json.includes(a.privateKey), "la clave privada tampoco (regresión)");
});

test("crear webhook agent exige URL válida y respeta el kill switch", () => {
  assert.throws(
    () =>
      createHostedAgent({
        owner: OWNER,
        name: "Sin URL",
        avatar: "🤖",
        game: "2048",
        strategyId: WEBHOOK_STRATEGY_ID,
        params: undefined,
      }),
    /webhookUrl/,
  );
  process.env.WEBHOOK_AGENTS_ENABLED = "false";
  try {
    assert.throws(() => newWebhookAgent("Apagado"), /disabled/);
  } finally {
    delete process.env.WEBHOOK_AGENTS_ENABLED;
  }
});

test("updateAgent: params sobre un webhook agent no explota (regresión) y webhookUrl se re-valida", () => {
  const a = newWebhookAgent("Actualizable");
  // Antes: getStrategy("webhook")! => undefined! => TypeError.
  const updated = updateAgent(a.id, { params: { greed: 1 } });
  assert.deepEqual(updated.params, {}, "params se ignora en BYO");
  // URL nueva válida.
  updateAgent(a.id, { webhookUrl: "https://otro.example.com/hook" });
  assert.equal(a.webhook!.url, "https://otro.example.com/hook");
  // URL nueva inválida: rechaza sin tocar la actual.
  assert.throws(() => updateAgent(a.id, { webhookUrl: "http://example.com/x" }), /https/);
  assert.equal(a.webhook!.url, "https://otro.example.com/hook");
});

test("fallas: 3 consecutivas auto-pausan y sueltan; un éxito resetea la racha", () => {
  const a = newWebhookAgent("Fallador");
  assert.equal(recordWebhookFailure(a), false);
  assert.equal(recordWebhookFailure(a), false);
  resetWebhookFailures(a); // el endpoint revivió
  assert.equal(a.webhook!.failures, 0);
  assert.equal(recordWebhookFailure(a), false);
  assert.equal(recordWebhookFailure(a), false);
  assert.equal(recordWebhookFailure(a), true, "la tercera consecutiva pausa");
  assert.equal(a.active, false);
  assert.equal(a.webhook!.failures, 0, "contador reseteado tras pausar");
});

test("notifiedAt ancla al pending: se limpia al setear/limpiar la partida", () => {
  const a = newWebhookAgent("Reloj");
  setAgentPending(a, "m_test1");
  markWebhookNotified(a);
  assert.ok(a.webhook!.notifiedAt, "notificado");
  setAgentPending(a, undefined); // soltó la partida
  assert.equal(a.webhook!.notifiedAt, undefined, "el ancla muere con el pending");
});
