// Vistas y rendición de las partidas EN VIVO. Mientras la partida no se decide,
// la semilla no sale en ninguna vista (con ella se simula la partida entera). Un
// juego en vivo no acepta replays armados afuera: solo la rendición.
//
// Correr: node --import tsx --test apps/server/test/live-views.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { matchmake, submitScore, getMatch } from "../src/matchmaking.js";

// Flappy en vivo SOLO en este proceso: en producción RULES_V.flappy sigue en 1.
RULES_V.flappy = 2;

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

const forfeit = { ticks: 0, flaps: [], v: 2 };

async function livePair() {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake("flappy", 0, p1);
  const m2 = await matchmake("flappy", 0, p2);
  assert.equal(m1.matchId, m2.matchId);
  return { id: m1.matchId, p1, p2, m1, m2 };
}

test("en un juego en vivo la vista no trae la semilla y avisa que es en vivo", async () => {
  const { id, p1, m1, m2 } = await livePair();
  for (const v of [m1, m2, getMatch(id, p1)!, getMatch(id)!]) {
    assert.equal(v.seed, undefined, "sin semilla antes de decidir");
    assert.equal(v.live, true);
  }
});

test("un juego que no es en vivo sigue trayendo la semilla", async () => {
  const m = await matchmake("2048", 0, addr());
  assert.equal(typeof m.seed, "number");
  assert.equal(m.live, undefined);
});

test("un juego en vivo rechaza un replay armado afuera, con motivo y sin gastar el intento", async () => {
  const { id, p1 } = await livePair();
  await assert.rejects(
    submitScore(id, p1, 3, { seed: 123, ticks: 600, flaps: [0, 20] }),
    /replay not allowed: flappy is live/,
  );
  // Tampoco sirve una "rendición" con puntaje o con semilla.
  await assert.rejects(submitScore(id, p1, 1, forfeit), /replay not allowed/);
  await assert.rejects(submitScore(id, p1, 0, { ...forfeit, seed: 1 }), /replay not allowed/);
  // El intento sigue disponible: la rendición de verdad entra.
  const v = await submitScore(id, p1, 0, forfeit);
  assert.deepEqual(v.scores, { [p1.toLowerCase()]: 0 });
});

test("rendirse cierra el intento con 0; con los dos rendidos es empate y recién ahí aparece la semilla", async () => {
  const { id, p1, p2 } = await livePair();
  await submitScore(id, p1, 0, forfeit);
  await assert.rejects(submitScore(id, p1, 0, forfeit), /already submitted/);
  const v = await submitScore(id, p2, 0, forfeit);
  assert.equal(v.status, "draw");
  assert.equal(typeof v.seed, "number", "decidida: la semilla ya se puede ver");
});
