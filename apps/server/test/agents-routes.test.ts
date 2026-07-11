// Tests HTTP del CRUD de agentes hosteados: la capa de rutas + checkAuth (la
// verificación de firma del dueño), que agents.test.ts no cubre porque llama
// a las funciones in-process directo. Acá levantamos un express real en un
// puerto efímero y pegamos con fetch, con REQUIRE_AUTH activado — el mismo
// modo que producción: sin firma válida del dueño, nada se crea ni se toca.
//
// Correr: node --import tsx --test apps/server/test/agents-routes.test.ts

import "../src/offline-env.js"; // corre offline con clave de prueba (ver el módulo)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentAuthMessage, AGENT_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";

// REQUIRE_AUTH tiene que estar seteado ANTES de que se cargue matchmaking (lee
// el flag al importarse). Los import estáticos se izan por encima de este
// código, así que las rutas se cargan con import dinámico, ya con el flag.
process.env.REQUIRE_AUTH = "true";
const { agentsRouter } = await import("../src/agents-routes.js");
const { getAgent } = await import("../src/agents.js");

const app = express();
app.use(express.json());
app.use(agentsRouter);
const server = app.listen(0);
const PORT = (server.address() as AddressInfo).port;
const BASE = `http://127.0.0.1:${PORT}`;
after(() => server.close());

const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const OWNER = owner.address.toLowerCase();

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

function createBody(name: string, extra?: Record<string, unknown>) {
  return {
    owner: OWNER,
    name,
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
    ...extra,
  };
}

/** Firma de creación: mismo ref que arma el server ("juego:estrategia:nombre"). */
function signCreate(account: typeof owner, name: string, ts: number) {
  return account.signMessage({
    message: agentAuthMessage("create", `2048:2048.priority:${name}`, OWNER, ts),
  });
}

test("GET /strategies expone el catálogo completo (9 estrategias en 6 juegos) y los avatares", async () => {
  const r = await fetch(`${BASE}/strategies`);
  assert.equal(r.status, 200);
  const out = (await r.json()) as { strategies: { game: string }[]; avatars: string[] };
  assert.equal(out.strategies.length, 9);
  assert.equal(new Set(out.strategies.map((s) => s.game)).size, 6, "6 juegos con estrategia");
  assert.ok(out.avatars.includes("🤖"));
});

test("crear SIN firma con REQUIRE_AUTH → rechazado", async () => {
  const { status, body } = await post("/agents", createBody("SinFirma"));
  assert.equal(status, 400);
  assert.match(String(body.error), /signature required/);
});

test("crear con firma de OTRA wallet → rechazado", async () => {
  const ts = Date.now();
  const signature = await signCreate(stranger, "Impostor", ts);
  const { status, body } = await post("/agents", createBody("Impostor", { signature, ts }));
  assert.equal(status, 400);
  assert.match(String(body.error), /bad signature/);
});

test("crear con firma vencida (ts fuera de la ventana) → rechazado", async () => {
  const ts = Date.now() - AGENT_AUTH_TTL_MS - 1000;
  const signature = await signCreate(owner, "Vencido", ts);
  const { status, body } = await post("/agents", createBody("Vencido", { signature, ts }));
  assert.equal(status, 400);
  assert.match(String(body.error), /auth expired/);
});

test("firma válida sobre un nombre DISTINTO al del body → rechazado", async () => {
  // El ref firmado ata el nombre: si difiere del body, la firma no verifica.
  const ts = Date.now();
  const signature = await signCreate(owner, "Nombre A", ts);
  const { status } = await post("/agents", createBody("Nombre B", { signature, ts }));
  assert.equal(status, 400);
});

test("ciclo completo firmado por el dueño: crear → pausar → borrar", async () => {
  // Crear
  let ts = Date.now();
  let signature = await signCreate(owner, "RutaBot", ts);
  const created = await post("/agents", createBody("RutaBot", { signature, ts }));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = String(created.body.id);
  assert.match(id, /^agt_/);
  assert.ok(!("privateKey" in created.body), "la vista pública no filtra la clave");

  // Pausar con firma de un extraño → rechazado y sigue activo
  ts = Date.now();
  signature = await stranger.signMessage({
    message: agentAuthMessage("pause", id, OWNER, ts),
  });
  const badPause = await post(`/agents/${id}`, { action: "pause", signature, ts });
  assert.equal(badPause.status, 400);
  assert.equal(getAgent(id)!.active, true);

  // Pausar con la firma del dueño → ok
  ts = Date.now();
  signature = await owner.signMessage({
    message: agentAuthMessage("pause", id, OWNER, ts),
  });
  const pause = await post(`/agents/${id}`, { action: "pause", signature, ts });
  assert.equal(pause.status, 200);
  assert.equal(pause.body.active, false);

  // Acción inválida → rechazado
  ts = Date.now();
  signature = await owner.signMessage({
    message: agentAuthMessage("hackear", id, OWNER, ts),
  });
  const badAction = await post(`/agents/${id}`, { action: "hackear", signature, ts });
  assert.equal(badAction.status, 400);

  // Borrar con la firma del dueño → ok (y limpia el estado de la corrida)
  ts = Date.now();
  signature = await owner.signMessage({
    message: agentAuthMessage("delete", id, OWNER, ts),
  });
  const del = await post(`/agents/${id}`, { action: "delete", signature, ts });
  assert.equal(del.status, 200);
  assert.equal(getAgent(id), undefined);
});
