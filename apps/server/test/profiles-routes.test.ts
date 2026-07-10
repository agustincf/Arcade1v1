// Tests HTTP de perfiles: firma del dueño obligatoria (REQUIRE_AUTH), address
// ajena rechazada, ts vencido rechazado, y GET que devuelve null sin perfil.
//
// Correr: node --import tsx --test apps/server/test/profiles-routes.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { profileAuthMessage, AGENT_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";

// REQUIRE_AUTH debe estar seteado ANTES de cargar matchmaking (lee el flag al
// importarse). Los import estáticos se izan, así que las rutas van por import
// dinámico, ya con el flag activo.
process.env.REQUIRE_AUTH = "true";
const { profilesRouter } = await import("../src/profiles-routes.js");

const app = express();
app.use(express.json());
app.use(profilesRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const me = privateKeyToAccount(generatePrivateKey());
const ADDR = me.address.toLowerCase();

async function post(body: unknown) {
  const r = await fetch(`${BASE}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

test("POST /profile con firma válida guarda", async () => {
  const ts = Date.now();
  const signature = await me.signMessage({ message: profileAuthMessage("set", ADDR, ts) });
  const r = await post({ address: ADDR, name: "Nico", avatar: "👾", signature, ts });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.name, "Nico");
});

test("POST /profile sin firma es rechazado (REQUIRE_AUTH)", async () => {
  const r = await post({ address: ADDR, name: "X", avatar: "👾" });
  assert.equal(r.status, 400);
});

test("POST /profile con firma de OTRA address es rechazado", async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  const ts = Date.now();
  // Firma el mensaje de la víctima-address, pero con la clave de 'other'.
  const signature = await other.signMessage({ message: profileAuthMessage("set", ADDR, ts) });
  const r = await post({ address: ADDR, name: "Impostor", avatar: "👾", signature, ts });
  assert.equal(r.status, 400);
});

test("POST /profile con ts vencido es rechazado", async () => {
  const ts = Date.now() - AGENT_AUTH_TTL_MS - 1000;
  const signature = await me.signMessage({ message: profileAuthMessage("set", ADDR, ts) });
  const r = await post({ address: ADDR, name: "Tarde", avatar: "👾", signature, ts });
  assert.equal(r.status, 400);
});

test("GET /profile/:address sin perfil devuelve null (200)", async () => {
  const r = await fetch(`${BASE}/profile/0x${"9".repeat(40)}`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).profile, null);
});
