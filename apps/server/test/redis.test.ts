// El cliente Upstash de redis.ts contra el Upstash falso.
// Correr: node --import tsx --test apps/server/test/redis.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
// Antes de importar: redis.ts lee estas variables al cargarse.
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
const R = await import("../src/redis.js");

test("GET y SET por ruta: el valor viaja en el body, sin escapar", async () => {
  await R.redisSet("arcade:x", '{"a":"b"}');
  assert.equal(fake.kv.get("arcade:x"), '{"a":"b"}');
  assert.equal(await R.redisGet("arcade:x"), '{"a":"b"}');
  assert.equal(await R.redisGet("arcade:nada"), null);
});

test("un comando chico como arreglo JSON: INCR es atómico y devuelve el número", async () => {
  assert.equal(await R.redisCommand(["INCR", "arcade:n"]), 1);
  assert.equal(await R.redisCommand(["INCR", "arcade:n"]), 2);
  assert.equal(await R.redisCommand(["GET", "arcade:n"]), "2");
});

test("pipeline: varios comandos en un pedido, cada uno con su resultado", async () => {
  const out = await R.redisPipeline([
    ["SET", "arcade:p", "v"],
    ["GET", "arcade:p"],
  ]);
  assert.deepEqual(out, ["OK", "v"]);
});

test("un error de Upstash se propaga: no se traga", async () => {
  fake.failWith = 500;
  try {
    await assert.rejects(R.redisCommand(["GET", "arcade:x"]), /redis GET/);
    await assert.rejects(R.redisSet("arcade:x", "v"), /HTTP 500/);
    await assert.rejects(R.redisGet("arcade:x"), /HTTP 500/);
    await assert.rejects(R.redisPipeline([["GET", "arcade:x"]]), /HTTP 500/);
  } finally {
    fake.failWith = null;
  }
});
