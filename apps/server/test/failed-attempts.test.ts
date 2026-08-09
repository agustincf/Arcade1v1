// ANTI-FLOOD: un replay que NO verifica no se puede reenviar para siempre.
//
// El candado de "un intento por jugador" (`m.scores[address] !== undefined`)
// solo se armaba cuando la verificación salía BIEN. Un replay inválido moría en
// "score mismatch" sin consumir el intento y sin dejar rastro, así que se podía
// reenviar infinitas veces: cada envío re-simula el juego entero, sincrónico, en
// el único hilo de Node. Con el límite estricto en 12 pedidos cada 10 s por IP,
// alcanzaba para tener al árbitro ocupado gratis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchmake, submitScore, MAX_FAILED_VERIFICATIONS } from "../src/matchmaking.js";
import { Game2048, verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";

const P1 = "0x2222222222222222222222222222222222222222";
const P2 = "0x3333333333333333333333333333333333333333";

/** Juega 2048 de verdad y devuelve un replay que SÍ verifica. */
function jugar2048(seed: number): { score: number; replay: Replay2048 } {
  const g = new Game2048(seed);
  const moves: Replay2048["moves"] = [];
  const dirs = ["up", "left", "down", "right"] as const;
  for (let i = 0; i < 200 && !g.over; i++) {
    const d = dirs[i % dirs.length];
    if (g.move(d)) moves.push(d);
  }
  const replay: Replay2048 = { seed, moves };
  return { score: verify2048(replay), replay };
}

test("un replay que no verifica se corta a las 3 fallidas", async () => {
  const m = await matchmake("2048", 0, P1);
  const { replay } = jugar2048(m.seed);
  const inflado = 999_999; // puntaje que el replay no respalda

  // Las tres primeras fallan por "score mismatch" (y consumen intento).
  for (let i = 1; i <= MAX_FAILED_VERIFICATIONS; i++) {
    await assert.rejects(
      () => submitScore(m.matchId, P1, inflado, replay),
      (e: Error) => /score mismatch/.test(e.message),
      `intento ${i} debería fallar por score mismatch`,
    );
  }

  // La cuarta ni siquiera re-simula: se rechaza por haberse quedado sin intentos.
  await assert.rejects(
    () => submitScore(m.matchId, P1, inflado, replay),
    (e: Error) => /too many failed verifications/.test(e.message),
  );
});

test("gastar los intentos con basura te deja sin envío, aunque después mandes el bueno", async () => {
  const m = await matchmake("2048", 0, P1);
  const { score, replay } = jugar2048(m.seed);

  for (let i = 0; i < MAX_FAILED_VERIFICATIONS; i++) {
    await assert.rejects(() => submitScore(m.matchId, P1, score + 1000, replay));
  }
  // El replay honesto ya no entra: el jugador quemó su intento. Es el precio de
  // reintentar a lo bruto, y es lo que hace que el flood no salga gratis.
  await assert.rejects(
    () => submitScore(m.matchId, P1, score, replay),
    (e: Error) => /too many failed verifications/.test(e.message),
  );
});

test("las fallidas de un jugador no le gastan los intentos al otro", async () => {
  const a = await matchmake("2048", 0, P1);
  const b = await matchmake("2048", 0, P2); // se empareja con la de P1
  assert.equal(b.matchId, a.matchId, "los dos están en la misma partida");

  const { score, replay } = jugar2048(a.seed);
  for (let i = 0; i < MAX_FAILED_VERIFICATIONS; i++) {
    await assert.rejects(() => submitScore(a.matchId, P1, 999_999, replay));
  }
  // P2 no tocó nada: su envío honesto tiene que entrar normal.
  const out = await submitScore(a.matchId, P2, score, replay);
  assert.equal(out.scores[P2.toLowerCase()], score);
});

test("un envío honesto a la primera no consume ninguna fallida", async () => {
  const m = await matchmake("2048", 0, P1);
  const { score, replay } = jugar2048(m.seed);
  const out = await submitScore(m.matchId, P1, score, replay);
  assert.equal(out.scores[P1.toLowerCase()], score);
});
