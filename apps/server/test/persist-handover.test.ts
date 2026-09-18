// TRASPASO ENTRE INSTANCIAS: en un deploy sin cortes, la instancia nueva no carga
// el estado hasta que la vieja lo guarda y suelta la "posta" (un registro en
// Redis). Mientras no tiene la posta no escribe nada, así nunca pisa el estado
// real con el suyo vacío. Contra un Upstash falso en memoria.
//
// Correr: node --import tsx --test apps/server/test/persist-handover.test.ts

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

// Upstash por REST, falso: GET /get/:key y POST /set/:key (valor en el body).
const kv = new Map<string, string>();
const fake = express();
fake.get("/get/:key", (req, res) => {
  res.json({ result: kv.get(req.params.key) ?? null });
});
fake.post("/set/:key", express.text({ type: "*/*", limit: "5mb" }), (req, res) => {
  kv.set(req.params.key, String(req.body));
  res.json({ result: "OK" });
});
const server = fake.listen(0);
after(() => server.close());

// Todo ANTES de importar: persist.ts lee estas variables al cargarse.
process.env.ARCADE_PERSIST = "1";
process.env.ARCADE_PERSIST_HANDOVER = "1"; // lo que enciende persist-on.ts en el servidor real
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
const P = await import("../src/persist.js");

const LEASE = "arcade:lease";
const lease = () =>
  JSON.parse(kv.get(LEASE) ?? "null") as {
    id: string;
    at: number;
    released: boolean;
  } | null;
const fast = { pollMs: 20 };

test("sin posta (primer arranque), carga enseguida", async () => {
  kv.delete(LEASE);
  assert.equal(await P.waitForHandover(fast), "none");
});

test("con la posta ya soltada (la anterior guardó y se fue), carga enseguida", async () => {
  kv.set(LEASE, JSON.stringify({ id: "vieja", at: Date.now(), released: true }));
  assert.equal(await P.waitForHandover(fast), "released");
});

test("una posta sin soltar que hace rato no late (una caída) no se espera", async () => {
  kv.set(LEASE, JSON.stringify({ id: "vieja", at: Date.now() - 10 * 60_000, released: false }));
  assert.equal(await P.waitForHandover(fast), "stale");
});

test("con la instancia anterior viva, espera a que guarde y suelte la posta", async () => {
  kv.set(LEASE, JSON.stringify({ id: "vieja", at: Date.now(), released: false }));
  setTimeout(
    () => kv.set(LEASE, JSON.stringify({ id: "vieja", at: Date.now(), released: true })),
    250,
  );
  const t0 = Date.now();
  assert.equal(await P.waitForHandover(fast), "released");
  assert.ok(Date.now() - t0 >= 200, "esperó");
});

test("si la anterior nunca suelta la posta, sigue al vencer el plazo", async () => {
  kv.set(LEASE, JSON.stringify({ id: "colgada", at: Date.now(), released: false }));
  assert.equal(await P.waitForHandover({ ...fast, timeoutMs: 150 }), "timeout");
});

test("no escribe nada antes de tomar la posta; después, sí", async () => {
  const store = P.jsonStore("prueba-traspaso");
  store.save(() => JSON.stringify({ estado: "vacío" }));
  await store.flush();
  assert.equal(kv.has("arcade:prueba-traspaso"), false, "sin la posta no pisa el estado real");

  await P.acquireLease();
  assert.equal(lease()?.id, P.INSTANCE_ID);
  assert.equal(lease()?.released, false);
  store.save(() => JSON.stringify({ estado: "cargado" }));
  await store.flush();
  assert.equal(kv.get("arcade:prueba-traspaso"), JSON.stringify({ estado: "cargado" }));
});

test("el latido mantiene fresca la posta", async () => {
  kv.set(LEASE, JSON.stringify({ id: P.INSTANCE_ID, at: 1, released: false }));
  await P.leaseHeartbeat();
  assert.ok(lease()!.at > 1);
  assert.equal(lease()!.id, P.INSTANCE_ID);
});

test("al apagarse guarda todo y recién después suelta la posta", async () => {
  const store = P.jsonStore("prueba-apagado");
  store.save(() => JSON.stringify({ ultimo: true }));
  await P.shutdownPersistence();
  assert.equal(kv.get("arcade:prueba-apagado"), JSON.stringify({ ultimo: true }));
  assert.deepEqual(
    { id: lease()!.id, released: lease()!.released },
    {
      id: P.INSTANCE_ID,
      released: true,
    },
  );
});

test("si otra instancia tomó la posta, esta deja de escribir y no la toca", async () => {
  await P.acquireLease();
  kv.set(LEASE, JSON.stringify({ id: "nueva", at: Date.now(), released: false }));
  await P.leaseHeartbeat();
  const store = P.jsonStore("prueba-cercada");
  store.save(() => JSON.stringify({ viejo: true }));
  await store.flush();
  assert.equal(kv.has("arcade:prueba-cercada"), false, "ya no escribe");
  await P.shutdownPersistence();
  assert.equal(lease()!.id, "nueva", "no suelta una posta que no es suya");
  assert.equal(lease()!.released, false);
});
