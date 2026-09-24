// EL REGISTRO DURABLE DE LOS INTENTOS EN VIVO (live-store.ts) contra el Upstash
// falso, con la posta prendida como en producción: cada intento es un campo del
// hash `arcade:live`, se escribe en UN pedido junto con la lectura de la época,
// y una instancia que perdió la posta no da nada por guardado.
// Corre en su propio proceso: persist.ts captura el backend al importarse.
// Correr: node --import tsx --test apps/server/test/live-store.test.ts
import "../src/offline-env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";
import type { LiveAttempt } from "../src/matchmaking.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.ARCADE_PERSIST = "1";
process.env.ARCADE_PERSIST_HANDOVER = "1";
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
const L = await import("../src/lease.js");
const S = await import("../src/live-store.js");

const MATCH = "0x" + "ab".repeat(32);
const ADDR = "0x" + "c".repeat(40);
const attempt = (tick: number, over = false): LiveAttempt => ({
  tokenHash: "f".repeat(64),
  startedAt: 1,
  tick,
  flaps: [0, 12, 30].filter((f) => f < tick),
  revealed: 3 + Math.floor(tick / 90),
  ...(over ? { over: true, score: 2 } : {}),
});
const stored = () => fake.hashes.get("arcade:live") ?? new Map<string, string>();

beforeEach(async () => {
  fake.kv.clear();
  fake.hashes.clear();
  fake.log.length = 0;
  fake.failWith = null;
  fake.failCommands.clear();
  L.resetLeaseForTests();
  S.__resetLiveStoreForTest();
  await L.acquireLease();
  fake.log.length = 0; // lo que importa empieza después de tomar la posta
});

test("guardar escribe el intento en su campo, confirmando la posta en el MISMO pedido", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.deepEqual(JSON.parse(stored().get(`${MATCH}:${ADDR}`)!), attempt(40));
  // Un solo pedido: la lectura de la época y la escritura, en ese orden.
  assert.deepEqual(fake.log, [
    ["GET", "arcade:lease:epoch"],
    ["HSET", "arcade:live"],
  ]);
});

test("guardar lo mismo dos veces no vuelve a escribir", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  const writes = fake.log.length;
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.equal(fake.log.length, writes, "sin cambios, sin pedido");
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  assert.equal(JSON.parse(stored().get(`${MATCH}:${ADDR}`)!).tick, 95);
});

test("si otra instancia tomó la posta, NO se da por guardado y esta instancia se cerca", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  fake.kv.set("arcade:lease:epoch", String(Number(fake.kv.get("arcade:lease:epoch")) + 1));
  await assert.rejects(
    () => S.saveLiveAttempt(MATCH, ADDR, attempt(95)),
    (e: Error) => e instanceof S.LiveUnavailableError,
  );
  assert.equal(L.isHolder(), false, "se dio por perdida la posta");
  // Y sin la posta ni siquiera sale el pedido.
  const before = fake.log.length;
  await assert.rejects(() => S.saveLiveAttempt(MATCH, ADDR, attempt(120)));
  assert.equal(fake.log.length, before, "sin posta no se escribe nada");
});

test("con Upstash caído, guardar tira LiveUnavailableError (y el siguiente intento reescribe)", async () => {
  fake.failWith = 500;
  await assert.rejects(
    () => S.saveLiveAttempt(MATCH, ADDR, attempt(40)),
    (e: Error) => e instanceof S.LiveUnavailableError && /retry/.test(e.message),
  );
  fake.failWith = null;
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.equal(JSON.parse(stored().get(`${MATCH}:${ADDR}`)!).tick, 40, "lo que falló se reescribe");
});

test("al arrancar se leen todos en un pedido; lo ilegible se descarta y se borra", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  await S.saveLiveAttempt(MATCH, "0x" + "d".repeat(40), attempt(95, true));
  stored().set("roto", "{no es json");
  S.__resetLiveStoreForTest(); // un proceso nuevo: no sabe nada
  const errors: string[] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => void errors.push(a.map(String).join(" "));
  let got;
  try {
    got = await S.loadLiveAttempts();
  } finally {
    console.error = real;
  }
  assert.equal(got.length, 2);
  const mine = got.find((g) => g.address === ADDR)!;
  assert.equal(mine.matchId, MATCH);
  assert.deepEqual(mine.attempt, attempt(40));
  assert.equal(got.find((g) => g.address !== ADDR)!.attempt.over, true);
  assert.equal(stored().has("roto"), false, "el ilegible se borró");
  assert.match(errors.join("\n"), /ilegibles/);
  // Lo leído ya está guardado: guardarlo igual no escribe.
  const writes = fake.log.length;
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.equal(fake.log.length, writes);
});

test("olvidar una partida borra sus campos", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  S.forgetLiveAttempts(MATCH, [ADDR]);
  for (let i = 0; i < 50 && stored().size > 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(stored().size, 0);
});

test("el cerrojo atiende de a un pedido por intento, y no traba intentos distintos", async () => {
  const order: string[] = [];
  let openFirst!: () => void;
  const gate = new Promise<void>((r) => (openFirst = r));
  const first = S.withLiveLock(MATCH, ADDR, async () => {
    order.push("1 empieza");
    await gate;
    order.push("1 termina");
  });
  const second = S.withLiveLock(MATCH, ADDR, async () => {
    order.push("2");
  });
  const other = S.withLiveLock(MATCH, "0x" + "d".repeat(40), async () => {
    order.push("otro intento");
  });
  await other;
  assert.deepEqual(order, ["1 empieza", "otro intento"], "otro intento no espera");
  openFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["1 empieza", "otro intento", "1 termina", "2"]);
});
