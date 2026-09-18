// Piezas puras del modo EN VIVO de la web: la rendición sin semilla, recordar el
// intento abierto para retomarlo al recargar y la fuente de azar de un replay.
//
// Correr: node --import tsx --test apps/web/test/live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { SecretSource } from "@arcade1v1/game-sdk/live";
import {
  forfeitReplay,
  rememberLiveMatch,
  readLiveMatch,
  forgetLiveMatch,
  flappyReplaySource,
} from "../app/lib/live.js";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const MATCH = "0x" + "ab".repeat(32);
const ME = "0x" + "1".repeat(40);

test("la rendición: con semilla como siempre; sin semilla, la de un juego en vivo", () => {
  assert.deepEqual(forfeitReplay("flappy", 7, 1), { seed: 7, ticks: 0, flaps: [] });
  assert.deepEqual(forfeitReplay("flappy", null, 2), { ticks: 0, flaps: [], v: 2 });
  assert.deepEqual(forfeitReplay("2048", 7, 1), { seed: 7, moves: [] });
  assert.deepEqual(forfeitReplay("snake", 7, 2), { seed: 7, ticks: 0, inputs: [], v: 2 });
});

test("recordar, leer y olvidar el intento en vivo, por juego, mesa y jugador", () => {
  const s = fakeStorage();
  assert.equal(readLiveMatch(s, "flappy", 0, ME), null);
  rememberLiveMatch(s, "flappy", 0, ME, MATCH);
  assert.equal(readLiveMatch(s, "flappy", 0, ME), MATCH);
  assert.equal(readLiveMatch(s, "flappy", 1, ME), null, "otra mesa");
  assert.equal(readLiveMatch(s, "flappy", 0, "0x" + "2".repeat(40)), null, "otro jugador");
  forgetLiveMatch(s, "flappy", 0, ME);
  assert.equal(readLiveMatch(s, "flappy", 0, ME), null);
});

test("un valor guardado que no es un matchId no se usa, y un storage que tira no rompe", () => {
  const s = fakeStorage();
  rememberLiveMatch(s, "flappy", 0, ME, MATCH);
  for (const k of s.map.keys()) s.map.set(k, "basura");
  assert.equal(readLiveMatch(s, "flappy", 0, ME), null);
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readLiveMatch(broken, "flappy", 0, ME), null);
  rememberLiveMatch(broken, "flappy", 0, ME, MATCH);
  forgetLiveMatch(broken, "flappy", 0, ME);
});

test("el replay de Flappy se re-juega con el secreto publicado; sin secreto, con su semilla", () => {
  const secret = "7f".repeat(32);
  const liveReplay = { ticks: 10, flaps: [] as number[] };
  const seededReplay = { seed: 42, ticks: 10, flaps: [] as number[] };
  assert.ok(flappyReplaySource(liveReplay, secret) instanceof SecretSource);
  assert.equal(flappyReplaySource(seededReplay), 42);
  assert.throws(() => flappyReplaySource(liveReplay), /secret/);
});
