// LOS RELOJES (jobs.ts): arrancan juntos y, al entregar la posta, se frenan
// esperando la vuelta en curso de cada uno, con tope.
// Correr: node --import tsx --test apps/server/test/jobs.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerJob, startJobs, stopJobs, resetJobsForTests } from "../src/jobs.js";

beforeEach(() => resetJobsForTests());

test("arranca todos y, al frenar, espera la vuelta en curso de cada uno", async () => {
  const log: string[] = [];
  let finish!: () => void;
  registerJob({
    name: "a",
    start: () => void log.push("start a"),
    stop: async () => void log.push("stop a"),
  });
  registerJob({
    name: "b",
    start: () => void log.push("start b"),
    stop: () =>
      new Promise<void>((ok) => {
        finish = () => {
          log.push("stop b");
          ok();
        };
      }),
  });
  startJobs();
  assert.deepEqual(log, ["start a", "start b"]);
  const stopping = stopJobs(1_000);
  setTimeout(() => finish(), 20);
  assert.deepEqual(await stopping, []);
  assert.deepEqual(log, ["start a", "start b", "stop a", "stop b"]);
});

test("un reloj que no termina a tiempo no traba la entrega: se informa", async () => {
  registerJob({ name: "colgado", start: () => {}, stop: () => new Promise<void>(() => {}) });
  registerJob({ name: "bien", start: () => {}, stop: async () => {} });
  assert.deepEqual(await stopJobs(30), ["colgado"]);
});

test("un reloj que falla al frenar no traba a los demás", async () => {
  registerJob({
    name: "falla",
    start: () => {},
    stop: async () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(await stopJobs(100), []);
});
