import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPrivateAddress,
  validateWebhookUrl,
  webhookSignature,
  webhookAgentsEnabled,
} from "../src/webhook-fetch.js";

test("isPrivateAddress: matriz de rangos privados/reservados", () => {
  const privadas = [
    "127.0.0.1", // loopback
    "0.0.0.0",
    "10.1.2.3", // 10/8
    "100.64.0.1", // CGNAT
    "169.254.169.254", // link-local (metadata de cloud)
    "172.16.0.1",
    "172.31.255.255", // bordes de 172.16/12
    "192.168.1.1",
    "198.18.0.1", // benchmarking
    "224.0.0.1", // multicast
    "255.255.255.255", // broadcast
    "::",
    "::1", // IPv6 loopback
    "fe80::1", // link-local
    "fc00::1",
    "fd12::1", // ULA
    "::ffff:10.0.0.1", // IPv4 privada mapeada
    "no-es-una-ip", // basura: rechazar por las dudas
  ];
  for (const ip of privadas) assert.equal(isPrivateAddress(ip), true, `${ip} debe ser privada`);

  const publicas = ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111"];
  for (const ip of publicas) assert.equal(isPrivateAddress(ip), false, `${ip} debe ser pública`);
});

test("validateWebhookUrl: rechaza lo peligroso, acepta https público", () => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
  // Aceptada (y normalizada a string).
  assert.equal(validateWebhookUrl("https://example.com/hook"), "https://example.com/hook");
  // Rechazos.
  assert.throws(() => validateWebhookUrl("http://example.com/hook"), /https/);
  assert.throws(() => validateWebhookUrl("https://user:pass@example.com/"), /credentials/);
  assert.throws(() => validateWebhookUrl("https://127.0.0.1/hook"), /not allowed/);
  assert.throws(() => validateWebhookUrl("https://localhost/hook"), /not allowed/);
  assert.throws(() => validateWebhookUrl("https://mi-server.local/hook"), /not allowed/);
  assert.throws(() => validateWebhookUrl("https://db.internal/hook"), /not allowed/);
  assert.throws(() => validateWebhookUrl("ftp://example.com/hook"), /https/);
  assert.throws(() => validateWebhookUrl(""), /required/);
  assert.throws(() => validateWebhookUrl("no es una url"), /inválida/);
  assert.throws(() => validateWebhookUrl("https://example.com/" + "x".repeat(600)), /too long/);
});

test("validateWebhookUrl: WEBHOOK_ALLOW_PRIVATE habilita http y hosts locales (solo dev)", () => {
  process.env.WEBHOOK_ALLOW_PRIVATE = "true";
  try {
    assert.equal(validateWebhookUrl("http://127.0.0.1:5555/hook"), "http://127.0.0.1:5555/hook");
    assert.equal(validateWebhookUrl("http://localhost:5555/hook"), "http://localhost:5555/hook");
  } finally {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  }
});

test("webhookSignature: HMAC-SHA256 estable contra un vector fijo", () => {
  // Vector calculable con: echo -n '{"a":1}' | openssl dgst -sha256 -hmac "secreto"
  const sig = webhookSignature("secreto", '{"a":1}');
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(sig, webhookSignature("secreto", '{"a":1}'), "determinística");
  assert.notEqual(sig, webhookSignature("otro", '{"a":1}'), "depende del secreto");
  assert.notEqual(sig, webhookSignature("secreto", '{"a":2}'), "depende del body");
});

test("webhookAgentsEnabled: kill switch por llamada", () => {
  delete process.env.WEBHOOK_AGENTS_ENABLED;
  assert.equal(webhookAgentsEnabled(), true, "default: encendido");
  process.env.WEBHOOK_AGENTS_ENABLED = "false";
  try {
    assert.equal(webhookAgentsEnabled(), false);
  } finally {
    delete process.env.WEBHOOK_AGENTS_ENABLED;
  }
});
