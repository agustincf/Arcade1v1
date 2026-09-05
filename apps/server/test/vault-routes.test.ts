// apps/server/test/vault-routes.test.ts
// Rutas HTTP de La Bóveda con REQUIRE_AUTH activado como en producción.
// Correr: node --import tsx --test apps/server/test/vault-routes.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  matchmakeAuthMessage,
  vaultActionAuthMessage,
  vaultViewAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { actionLine, type VaultAction } from "@arcade1v1/game-sdk/vault";

process.env.REQUIRE_AUTH = "true";
const { vaultRouter } = await import("../src/vault-routes.js");
const V = await import("../src/vault.js");

const app = express();
app.use(express.json());
app.use(vaultRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}
async function get(path: string) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}
const low = (a: PrivateKeyAccount) => a.address.toLowerCase();

async function join(acc: PrivateKeyAccount, signer = acc) {
  const ts = Date.now();
  const signature = await signer.signMessage({
    message: matchmakeAuthMessage("vault", 0, low(acc), ts),
  });
  return post("/vault/join", { stake: 0, address: low(acc), signature, ts });
}

/** Pase de vista: query firmado que habilita la vista PRIVADA del asiento. */
async function viewPass(roomId: string, acc: PrivateKeyAccount, signer = acc) {
  const ts = Date.now();
  const signature = await signer.signMessage({
    message: vaultViewAuthMessage(roomId, low(acc), ts),
  });
  return `address=${low(acc)}&signature=${signature}&ts=${ts}`;
}

async function act(
  roomId: string,
  acc: PrivateKeyAccount,
  stage: number,
  phase: string,
  action: VaultAction,
  signer = acc,
) {
  const ts = Date.now();
  const signature = await signer.signMessage({
    message: vaultActionAuthMessage(roomId, stage, phase, actionLine(action), ts),
  });
  return post(`/vault/${roomId}/act`, { address: low(acc), stage, phase, action, signature, ts });
}

test("join: exige firma propia; lobby visible; vista pública; log cerrado; act en lobby rechazado", async () => {
  V.__resetVaultForTest();
  const a = privateKeyToAccount(generatePrivateKey());
  const b = privateKeyToAccount(generatePrivateKey());
  let r = await post("/vault/join", { stake: 0, address: low(a) });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /signature required/);
  r = await join(a, b);
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /bad signature/);
  // join sin ts
  const ts_join = Date.now();
  const sig_join = await a.signMessage({
    message: matchmakeAuthMessage("vault", 0, low(a), ts_join),
  });
  r = await post("/vault/join", { stake: 0, address: low(a), signature: sig_join });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /falta ts/);
  r = await post("/vault/join", { address: low(a) });
  assert.equal(r.status, 400);
  r = await join(a);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "lobby");
  const roomId = String(r.body.roomId);

  r = await get("/vault/lobbies");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.lobbies.map((l: any) => [l.roomId, l.seats, l.min, l.max]),
    [[roomId, 1, 4, 8]],
  );
  r = await get(`/vault/${roomId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.seats[0].address, low(a));
  r = await get("/vault/0xnope");
  assert.equal(r.status, 404);
  r = await get(`/vault/${roomId}/log`);
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /not settled/);
  r = await act(roomId, a, 0, "decide", { type: "keep" });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /room not open/);
});

test("act: con 8 asientos arranca; la acción firmada entra; la ajena y la incompleta no", async () => {
  V.__resetVaultForTest();
  const accs = Array.from({ length: 8 }, () => privateKeyToAccount(generatePrivateKey()));
  let r;
  for (const acc of accs) r = await join(acc);
  assert.equal(r!.body.status, "playing");
  const roomId = String(r!.body.roomId);
  r = await act(roomId, accs[0], 0, "decide", { type: "keep" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.you.decided, true);
  r = await act(roomId, accs[1], 0, "decide", { type: "keep" }, accs[2]);
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /bad signature/);
  // act sin ts
  const ts_act = Date.now();
  const sig_act = await accs[1].signMessage({
    message: vaultActionAuthMessage(roomId, 0, "decide", actionLine({ type: "keep" }), ts_act),
  });
  r = await post(`/vault/${roomId}/act`, {
    address: low(accs[1]),
    stage: 0,
    phase: "decide",
    action: { type: "keep" },
    signature: sig_act,
  });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /falta ts/);
  r = await post(`/vault/${roomId}/act`, { address: low(accs[1]), action: { type: "keep" } });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /faltan/);
  // Un susurro privado de accs[0] a accs[1], para probar que no se filtra.
  r = await act(roomId, accs[0], 0, "decide", {
    type: "whisper",
    to: low(accs[1]),
    text: "mi digito es 7",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // (a) SIN pase de vista, `?address=` ajeno solo trae la vista PÚBLICA.
  r = await get(`/vault/${roomId}?address=${low(accs[1])}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.you, undefined, "sin pase no hay vista privada");
  assert.deepEqual(r.body.stage.acted, [low(accs[0])]);
  assert.ok(
    !(r.body.messages as { to?: string }[]).some((m) => m.to),
    "sin pase no se ven susurros",
  );
  assert.ok(!JSON.stringify(r.body).includes("fragment"), "sin pase no hay fragmento");
  // (b) CON pase firmado por el propio asiento, la vista privada.
  r = await get(`/vault/${roomId}?${await viewPass(roomId, accs[1])}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.you.decided, false);
  assert.equal(r.body.messages.length, 1);
  assert.equal(r.body.messages[0].to, low(accs[1]));
  // (c) CON pase firmado por OTRA wallet, vuelve a ser la vista pública.
  r = await get(`/vault/${roomId}?${await viewPass(roomId, accs[1], accs[2])}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.you, undefined, "un pase ajeno no abre la vista privada");
  assert.ok(!(r.body.messages as { to?: string }[]).some((m) => m.to));
  r = await get("/vault/recent");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rooms, []);
});
