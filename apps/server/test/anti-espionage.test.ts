// ANTI-ESPIONAJE: GET /match/:id no debe filtrar el puntaje de NINGÚN jugador
// antes de que la partida se decida, sin importar qué address se pase por el
// query. La fuga original: el filtro de `scores` confiaba en la address del
// query (que NO está autenticada en el GET), así que pedir la partida pasando la
// address del rival devolvía su puntaje antes de jugar tu turno — ventaja letal
// con plata en juego.
//
// Correr: node --import tsx --test apps/server/test/anti-espionage.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchmake, submitScore, getMatch } from "../src/matchmaking.js";
import { runStrategy, getStrategy, defaultParams } from "@arcade1v1/strategies";

// Addresses hex válidas y únicas por corrida.
const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

const play2048 = (seed: number) =>
  runStrategy(
    {
      game: "2048",
      strategyId: "2048.priority",
      params: defaultParams(getStrategy("2048.priority")!),
    },
    seed,
  );

test("getMatch no revela el puntaje del rival antes de decidir (aunque pases su address)", async () => {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake("2048", 0, p1);
  const m2 = await matchmake("2048", 0, p2);
  assert.equal(m1.matchId, m2.matchId, "p1 y p2 deben quedar en la misma partida");
  const id = m1.matchId;

  // p1 juega y envía un puntaje real (verificado por replay).
  const run = play2048(m1.seed);
  assert.ok(run.score > 0, "el puntaje sembrado debe ser > 0 para que la prueba tenga sentido");
  await submitScore(id, p1, run.score, run.replay);

  // ATAQUE: un tercero (o el propio p2 antes de jugar) consulta la partida
  // pasando la address de p1. NO debe ver el puntaje de p1: no se decidió.
  const spy = getMatch(id, p1)!;
  assert.equal(spy.status, "ready");
  assert.deepEqual(spy.scores, {}, "FUGA: no debe verse ningún puntaje antes de decidir");

  // La señal de progreso (sin el número) SÍ se mantiene para la UX de espera.
  const p2view = getMatch(id, p2)!;
  assert.equal(p2view.rivalSubmitted, true, "p2 sabe que p1 ya jugó, sin ver su puntaje");
});

test("submitScore SÍ confirma tu propio puntaje a quien lo envió (camino probado)", async () => {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake("2048", 0, p1);
  await matchmake("2048", 0, p2);
  const run = play2048(m1.seed);
  // El que envía prueba que es él (firma obligatoria en prod); su propia
  // respuesta puede confirmarle su puntaje aunque la partida siga sin decidirse.
  const resp = await submitScore(m1.matchId, p1, run.score, run.replay);
  assert.equal(resp.status, "ready", "el rival aún no jugó");
  assert.equal(resp.scores[p1], run.score, "tu propia respuesta confirma tu puntaje");
});
