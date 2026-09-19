// LA GUARDA DE ESCRITURA de persist.ts: con traspaso, escribe SOLO la dueña de la
// posta, y un guardado que no se pudo hacer RECHAZA. aleph.ts publica on-chain
// DESPUÉS de guardar: un "listo" falso publicaría una tabla sin guardar.
// Correr: node --import tsx --test apps/server/test/persist-guard.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.ARCADE_PERSIST = "1";
process.env.ARCADE_PERSIST_HANDOVER = "1"; // lo que enciende persist-on.ts en el servidor real
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
process.env.PERSIST_DEBOUNCE_MS = "3600000"; // nada se escribe solo
const P = await import("../src/persist.js");
const L = await import("../src/lease.js");

const sets = (key: string) => fake.log.filter((c) => c[0] === "SET" && c[1] === key).length;

beforeEach(() => {
  fake.kv.clear();
  fake.failWith = null;
  L.resetLeaseForTests();
});

test("sin la posta no escribe, y flush RECHAZA: no hace como que guardó", async () => {
  const s = P.jsonStore("g1");
  s.save(() => '{"v":1}');
  await assert.rejects(s.flush(), P.NotHolderError);
  assert.equal(fake.kv.has("arcade:g1"), false);
});

test("lo que quedó pendiente sin la posta se guarda al tenerla", async () => {
  const s = P.jsonStore("g2");
  s.save(() => '{"v":2}');
  await assert.rejects(s.flush());
  await L.acquireLease();
  await s.flush();
  assert.equal(fake.kv.get("arcade:g2"), '{"v":2}');
});

test("si Upstash falla, flush RECHAZA y el próximo flush lo reintenta solo", async () => {
  await L.acquireLease();
  const s = P.jsonStore("g3");
  s.save(() => '{"v":3}');
  fake.failWith = 500;
  await assert.rejects(s.flush());
  fake.failWith = null;
  await s.flush(); // nadie volvió a llamar a save(): igual se reintenta
  assert.equal(fake.kv.get("arcade:g3"), '{"v":3}');
});

test("antes de subir un blob confirma la posta: si otra la tomó, no escribe", async () => {
  await L.acquireLease();
  let lost = 0;
  L.onLeaseLost(() => lost++);
  fake.kv.set("arcade:lease:epoch", "9");
  const s = P.jsonStore("g4");
  s.save(() => '{"v":4}');
  await assert.rejects(s.flush(), P.NotHolderError);
  assert.equal(fake.kv.has("arcade:g4"), false);
  assert.equal(lost, 1);
});

test("un flush sin cambios no vuelve a subir el blob", async () => {
  await L.acquireLease();
  const s = P.jsonStore("g5");
  s.save(() => '{"v":5}');
  await s.flush();
  const antes = sets("arcade:g5");
  s.save(() => '{"v":5}');
  await s.flush();
  assert.equal(sets("arcade:g5"), antes);
});

test("flushAll rechaza si algún store no se pudo guardar", async () => {
  const s = P.jsonStore("g6");
  s.save(() => '{"v":6}');
  await assert.rejects(P.flushAll(), /no se guardaron/);
});
