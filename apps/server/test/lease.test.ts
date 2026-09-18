// LA POSTA POR ÉPOCAS (lease.ts) contra el Upstash falso. La "otra instancia" se
// simula escribiendo sus claves a mano: INSTANCE_ID es uno por proceso.
// Correr: node --import tsx --test apps/server/test/lease.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
process.env.LEASE_HEARTBEAT_MS = "60000";
const L = await import("../src/lease.js");

const rec = (e: number) => JSON.parse(fake.kv.get(`arcade:lease:e:${e}`) ?? "null");
const NOW = Date.now();

beforeEach(() => {
  fake.kv.clear();
  fake.failWith = null;
  L.resetLeaseForTests();
});

test("sin posta: 'none'", async () => {
  assert.equal(L.classifyLease(await L.readLease(), NOW), "none");
});

test("tomar la posta: INCR da la época y su registro queda activo", async () => {
  assert.equal(await L.acquireLease(), 1);
  assert.equal(L.isHolder(), true);
  assert.equal(L.myEpoch(), 1);
  assert.equal(rec(1).id, L.INSTANCE_ID);
  assert.equal(rec(1).state, "active");
  assert.equal(L.classifyLease(await L.readLease()), "held");
});

test("viva es 'held'; soltada, 'released'; sin latir o sin registro, 'stale'", () => {
  const view = (r: object | null) =>
    ({ epoch: 4, record: r, legacy: null }) as Parameters<typeof L.classifyLease>[0];
  assert.equal(L.classifyLease(view({ id: "x", at: NOW, state: "active" }), NOW), "held");
  assert.equal(L.classifyLease(view({ id: "x", at: NOW, state: "released" }), NOW), "released");
  const vieja = NOW - L.LEASE_STALE_MS - 1;
  assert.equal(L.classifyLease(view({ id: "x", at: vieja, state: "active" }), NOW), "stale");
  assert.equal(L.classifyLease(view(null), NOW), "stale");
});

test("posta del #33: viva, 'legacy-held'; soltada, 'released'; vencida, 'stale'", () => {
  const view = (l: object) =>
    ({ epoch: null, record: null, legacy: l }) as Parameters<typeof L.classifyLease>[0];
  assert.equal(L.classifyLease(view({ id: "v", at: NOW, released: false }), NOW), "legacy-held");
  assert.equal(L.classifyLease(view({ id: "v", at: NOW, released: true }), NOW), "released");
  const vieja = NOW - L.LEASE_STALE_MS - 1;
  assert.equal(L.classifyLease(view({ id: "v", at: vieja, released: false }), NOW), "stale");
});

test("al tomarla desde la del #33, la marca como nuestra: la vieja deja de escribir", async () => {
  fake.kv.set("arcade:lease", JSON.stringify({ id: "vieja-33", at: NOW, released: true }));
  const v = await L.readLease();
  assert.equal(v.epoch, null);
  assert.equal(v.legacy?.id, "vieja-33");
  await L.acquireLease(v);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease")!).id, L.INSTANCE_ID);
});

test("si otra instancia sacó una época más alta, confirmar da false y avisa", async () => {
  await L.acquireLease();
  let lost = 0;
  L.onLeaseLost(() => lost++);
  fake.kv.set("arcade:lease:epoch", "2");
  assert.equal(await L.confirmHolder(), false);
  assert.equal(L.isHolder(), false);
  assert.equal(lost, 1);
});

test("un error de red al confirmar TIRA: no es lo mismo que haberla perdido", async () => {
  await L.acquireLease();
  fake.failWith = 500;
  await assert.rejects(L.confirmHolder());
  fake.failWith = null;
  assert.equal(L.isHolder(), true);
});

test("el latido renueva el registro; si la época cambió, se da por perdida", async () => {
  await L.acquireLease();
  fake.kv.set("arcade:lease:e:1", JSON.stringify({ id: L.INSTANCE_ID, at: 1, state: "active" }));
  await L.leaseHeartbeat();
  assert.ok(rec(1).at > 1, "latió");
  let lost = 0;
  L.onLeaseLost(() => lost++);
  fake.kv.set("arcade:lease:epoch", "7");
  await L.leaseHeartbeat();
  assert.equal(lost, 1);
  assert.equal(L.isHolder(), false);
});

test("soltar: el registro dice 'released' y deja de ser dueña", async () => {
  await L.acquireLease();
  await L.releaseLease();
  assert.equal(rec(1).state, "released");
  assert.equal(L.isHolder(), false);
  assert.equal(L.classifyLease(await L.readLease()), "released");
});

test("si Upstash falla al soltar, sigue siendo dueña: no suelta a medias", async () => {
  await L.acquireLease();
  fake.failWith = 500;
  await assert.rejects(L.releaseLease());
  fake.failWith = null;
  assert.equal(L.isHolder(), true);
  assert.equal(rec(1).state, "active");
});

test("pedido de traspaso: la nueva lo escribe y la vieja lo lee", async () => {
  await L.requestHandover(3);
  const r = await L.readHandoverRequest();
  assert.equal(r?.forEpoch, 3);
  assert.equal(r?.by, L.INSTANCE_ID);
  assert.ok(r && Date.now() - r.at < 5_000);
});
