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
  fake.hashes.clear();
  fake.afterCommand = null;
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

// ---- jsonMapStore: un registro por campo, sube solo lo que cambió -------------

const recs = (...pairs: [string, unknown][]) =>
  new Map(pairs.map(([id, v]) => [id, JSON.stringify({ id, v })]));

/** Los comandos HSET/HDEL/DEL que llegaron, con sus argumentos completos. */
function captureWrites(): string[][] {
  const seen: string[][] = [];
  fake.afterCommand = (cmd) => {
    if (["HSET", "HDEL", "DEL"].includes(cmd[0].toUpperCase())) seen.push(cmd);
  };
  return seen;
}

test("mapa: cada guardado sube SOLO los registros que cambiaron y borra los que ya no están", async () => {
  await L.acquireLease();
  const s = P.jsonMapStore("m1");
  let state = recs(["a", 1], ["b", 1], ["c", 1]);
  s.save(() => state);
  await s.flush();
  assert.deepEqual([...fake.hashes.get("arcade:m1:byid")!.keys()].sort(), ["a", "b", "c"]);

  const writes = captureWrites();
  state = recs(["a", 1], ["b", 2]); // b cambió, c se purgó
  s.save(() => state);
  await s.flush();
  assert.deepEqual(writes, [
    ["HSET", "arcade:m1:byid", "b", JSON.stringify({ id: "b", v: 2 })],
    ["HDEL", "arcade:m1:byid", "c"],
  ]);
  assert.deepEqual([...fake.hashes.get("arcade:m1:byid")!.keys()].sort(), ["a", "b"]);
});

test("mapa: sin cambios no escribe ni lee la posta", async () => {
  await L.acquireLease();
  const s = P.jsonMapStore("m2");
  const state = recs(["a", 1]);
  s.save(() => state);
  await s.flush();
  const antes = fake.log.length;
  s.save(() => recs(["a", 1]));
  await s.flush();
  assert.equal(fake.log.length, antes);
});

test("mapa: migra el blob viejo al hash y recién después lo borra", async () => {
  await L.acquireLease();
  fake.kv.set(
    "arcade:m3",
    JSON.stringify([
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ]),
  );
  const s = P.jsonMapStore("m3");
  const loaded = await s.load();
  assert.deepEqual([...loaded!.keys()], ["a", "b"]);
  assert.ok(fake.kv.has("arcade:m3"), "cargar no borra nada");

  s.save(() => loaded!);
  await s.flush();
  assert.equal(fake.hashes.get("arcade:m3:byid")!.get("b"), JSON.stringify({ id: "b", v: 2 }));
  assert.equal(fake.kv.has("arcade:m3"), false, "el blob se borra después de subir todo");

  // La próxima instancia lee el hash.
  const again = await P.jsonMapStore("m3").load();
  assert.deepEqual([...again!.keys()], ["a", "b"]);
});

test("mapa: si la migración falla, el blob viejo queda y el próximo flush la termina", async () => {
  await L.acquireLease();
  fake.kv.set("arcade:m4", JSON.stringify([{ id: "a", v: 1 }]));
  const s = P.jsonMapStore("m4");
  const loaded = await s.load();
  s.save(() => loaded!);
  fake.failCommands.add("HSET");
  try {
    await assert.rejects(s.flush());
  } finally {
    fake.failCommands.delete("HSET");
  }
  assert.ok(fake.kv.has("arcade:m4"), "sin el hash completo, el blob no se toca");
  await s.flush(); // nadie volvió a llamar a save(): igual se reintenta
  assert.ok(fake.hashes.get("arcade:m4:byid")!.has("a"));
  assert.equal(fake.kv.has("arcade:m4"), false);
});

test("mapa: un blob viejo que sobrevivió a la migración se borra, sin volver a leerlo", async () => {
  await L.acquireLease();
  fake.hashes.set("arcade:m5:byid", new Map([["a", JSON.stringify({ id: "a", v: 1 })]]));
  fake.kv.set("arcade:m5", JSON.stringify([{ id: "viejo", v: 0 }]));
  const s = P.jsonMapStore("m5");
  const loaded = await s.load();
  assert.deepEqual([...loaded!.keys()], ["a"], "manda el hash");
  assert.equal(fake.log.filter((c) => c[0] === "GET" && c[1] === "arcade:m5").length, 0);
  s.save(() => loaded!);
  await s.flush();
  assert.equal(fake.kv.has("arcade:m5"), false);
});

test("mapa: sin la posta no escribe, y flush RECHAZA", async () => {
  const s = P.jsonMapStore("m6");
  s.save(() => recs(["a", 1]));
  await assert.rejects(s.flush(), P.NotHolderError);
  assert.equal(fake.hashes.has("arcade:m6:byid"), false);
});

test("mapa: si Upstash falla a mitad, lo que no llegó se reintenta en el próximo flush", async () => {
  await L.acquireLease();
  const s = P.jsonMapStore("m7");
  s.save(() => recs(["a", 1]));
  fake.failWith = 500;
  await assert.rejects(s.flush());
  fake.failWith = null;
  await s.flush();
  assert.ok(fake.hashes.get("arcade:m7:byid")!.has("a"));
});
