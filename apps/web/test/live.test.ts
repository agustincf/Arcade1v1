// Piezas puras del modo EN VIVO de la web: la rendición sin semilla, recordar el
// intento abierto para retomarlo al recargar y la fuente de azar de un replay.
//
// Correr: node --import tsx --test apps/web/test/live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { SecretSource, liveSecretHash } from "@arcade1v1/game-sdk/live";
import {
  forfeitReplay,
  rememberLiveMatch,
  readLiveMatch,
  forgetLiveMatch,
  flappyReplaySource,
  liveSecretHolds,
  liveErrorReason,
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

const HASH = "cd".repeat(32);

test("recordar, leer y olvidar el intento en vivo, por juego, mesa y jugador", () => {
  const s = fakeStorage();
  assert.equal(readLiveMatch(s, "flappy", 0, ME), null);
  rememberLiveMatch(s, "flappy", 0, ME, { matchId: MATCH, secretHash: HASH });
  // El hash del secreto se guarda con la partida: al retomar se compara contra
  // lo que el árbitro prometió al emparejar, no contra lo que diga después.
  assert.deepEqual(readLiveMatch(s, "flappy", 0, ME), { matchId: MATCH, secretHash: HASH });
  assert.equal(readLiveMatch(s, "flappy", 1, ME), null, "otra mesa");
  assert.equal(readLiveMatch(s, "flappy", 0, "0x" + "2".repeat(40)), null, "otro jugador");
  forgetLiveMatch(s, "flappy", 0, ME);
  assert.equal(readLiveMatch(s, "flappy", 0, ME), null);
});

test("lo guardado que no es un intento válido no se usa, y un storage que tira no rompe", () => {
  const s = fakeStorage();
  rememberLiveMatch(s, "flappy", 0, ME, { matchId: MATCH, secretHash: HASH });
  const [key] = s.map.keys();
  for (const bad of [
    "basura",
    MATCH, // solo el matchId: sin el hash no se puede comprobar el secreto
    JSON.stringify({ matchId: "0x12", secretHash: HASH }),
    JSON.stringify({ matchId: MATCH, secretHash: "no-es-hex" }),
    JSON.stringify({ matchId: MATCH }),
  ]) {
    s.map.set(key, bad);
    assert.equal(readLiveMatch(s, "flappy", 0, ME), null, bad);
  }
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
  rememberLiveMatch(broken, "flappy", 0, ME, { matchId: MATCH, secretHash: HASH });
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

test("el secreto de una partida en vivo decidida se comprueba cerrado: sin secreto o sin hash, no cumple", () => {
  const secret = "5a".repeat(32);
  const hash = liveSecretHash(secret);
  const reveals = new SecretSource(secret).slice(0, 12);
  assert.equal(liveSecretHolds(secret, hash, reveals), true);
  assert.equal(liveSecretHolds(secret, hash, null), true, "retomado sin lo revelado: solo el hash");
  assert.equal(
    liveSecretHolds(undefined, hash, reveals),
    false,
    "decidida sin publicar el secreto",
  );
  assert.equal(liveSecretHolds(secret, null, reveals), false, "sin el compromiso del árbitro");
  assert.equal(liveSecretHolds("6b".repeat(32), hash, reveals), false, "otro secreto");
  const tampered = [...reveals];
  tampered[3] = 0.5;
  assert.equal(
    liveSecretHolds(secret, hash, tampered),
    false,
    "un valor revelado que no salía del secreto",
  );
});

test("el motivo de un corte en vivo sale corto: lo que dijo el árbitro, sin la ruta ni el id", () => {
  const id = "0x" + "4b".repeat(32);
  assert.equal(
    liveErrorReason(
      `live: the arbiter rejected the commit: arbiter /match/${id}/live/commit 400: {"error":"bad token"}`,
    ),
    "bad token",
  );
  assert.equal(
    liveErrorReason("live desync at tick 12: the arbiter revealed only 3 values"),
    "live desync at tick 12: the arbiter revealed only 3 values",
  );
  assert.equal(liveErrorReason("live: too many commit conflicts"), "too many commit conflicts");
  assert.equal(
    liveErrorReason(`live: the arbiter rejected the commit: arbiter /x 400: {no es json`),
    "the arbiter rejected the commit: arbiter /x 400: {no es json",
  );
});
