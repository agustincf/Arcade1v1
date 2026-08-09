// ANTI-TRAMPA: las acciones de un replay tienen que ENTRAR en su propio reloj.
//
// Antes, `ticks` no acotaba nada: una partida entera de Tetris entraba en
// `ticks: 1`, la gravedad nunca avanzaba y el jugador colocaba pieza tras pieza
// con tiempo infinito. Los dos topes que existían (`MAX_REPLAY_TICKS` y
// `MAX_REPLAY_EVENTS`) miraban cada dimensión por separado y ninguno las cruzaba.
//
// Ahora hay dos capas, y este archivo prueba las dos:
//   1. `replayTooLong` rechaza el replay antes de re-simularlo (barato).
//   2. `groupByTick` descarta las acciones que pasan el tope dentro de un tick,
//      así que aunque un replay se cuele, el puntaje re-simulado no coincide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchmake, submitScore, replayTooLong, MAX_EVENTS_PER_TICK } from "../src/matchmaking.js";
import { MAX_ACTIONS_PER_TICK } from "@arcade1v1/game-sdk/rules";
import { type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { verifyInvaders } from "@arcade1v1/game-sdk/invaders";

const P1 = "0x1111111111111111111111111111111111111111";

/** El ataque real: todas las acciones amontonadas en el tick 0. */
function replayComprimido(seed: number, acciones: number): ReplayTetris {
  const inputs = Array.from({ length: acciones }, () => ({ t: 0, a: "l" as const }));
  return { seed, ticks: 1, inputs };
}

test("replayTooLong: 109 acciones en ticks:1 se rechazan (el ataque medido)", () => {
  assert.equal(replayTooLong(replayComprimido(987654, 109)), true);
});

test("replayTooLong: un replay honesto de Tetris pasa (ratio real ≈ 4,4)", () => {
  // La estrategia oficial llega a 4,65 acciones por tick en el peor de 540
  // casos medidos. Con el tope en 8 tiene 1,7× de aire: esto NO se rechaza.
  const honesto = {
    seed: 42,
    ticks: 600,
    inputs: Array.from({ length: 2660 }, () => ({ t: 0, a: "l" })),
  };
  // (el reparto por tick no importa acá: replayTooLong solo cruza los totales)
  assert.equal(replayTooLong(honesto), false);
});

test("replayTooLong: el borde exacto del presupuesto", () => {
  const enElLimite = {
    seed: 1,
    ticks: 100,
    inputs: Array(100 * MAX_EVENTS_PER_TICK).fill({ t: 0, a: "l" }),
  };
  const unoDeMas = {
    seed: 1,
    ticks: 100,
    inputs: Array(100 * MAX_EVENTS_PER_TICK + 1).fill({ t: 0, a: "l" }),
  };
  assert.equal(replayTooLong(enElLimite), false);
  assert.equal(replayTooLong(unoDeMas), true);
});

test("replayTooLong: 2048 no declara ticks y no se ve afectado", () => {
  assert.equal(replayTooLong({ seed: 1, moves: Array(2000).fill("up") }), false);
});

test("groupByTick: pasado el tope, las acciones sobrantes NO llegan al motor", () => {
  // Segunda capa, y la que de verdad importa: aunque un replay entre por el
  // filtro barato de arriba, el verificador ignora lo que exceda el tope dentro
  // de un mismo tick.
  //
  // Lo probamos en Invaders y no en Tetris a propósito: con 16 piezas soltadas
  // el Tetris ya termina (`g.over` corta el bucle), así que las acciones de más
  // no cambiarían nada AUNQUE se aplicaran — el test habría pasado en falso.
  // Invaders sigue vivo miles de ticks, y cada disparo cambia el puntaje.
  const seed = 987654;
  const ticks = 3000;
  const extras = 200;
  // Las de más son "soltar el disparo" (f0): si llegan al motor, la nave deja
  // de tirar una y otra vez y el puntaje baja. Si se descartan, no pasa nada.
  const enElTope = Array.from({ length: MAX_ACTIONS_PER_TICK }, () => ({
    t: 0,
    a: "f1" as const,
  }));
  const extrasEnElMismoTick = Array.from({ length: extras }, () => ({ t: 0, a: "f0" as const }));
  const conExceso = [...enElTope, ...extrasEnElMismoTick];
  // Control anti-vacuo: las MISMAS acciones de más, pero repartidas en ticks
  // distintos, sí se aplican y tienen que dar OTRO puntaje.
  const repartido = [
    ...enElTope,
    ...Array.from({ length: extras }, (_, i) => ({ t: (i + 1) * 10, a: "f0" as const })),
  ];

  // Los tres pasan el filtro de presupuesto (3000 ticks dan de sobra).
  for (const inputs of [enElTope, conExceso, repartido]) {
    assert.equal(replayTooLong({ seed, ticks, inputs }), false);
  }

  const base = verifyInvaders({ seed, ticks, inputs: enElTope });
  const inflado = verifyInvaders({ seed, ticks, inputs: conExceso });
  const legitimo = verifyInvaders({ seed, ticks, inputs: repartido });

  assert.ok(base > 0, "disparar puntúa: el caso base no es trivial");
  assert.equal(
    inflado,
    base,
    `las ${extras} acciones extra del mismo tick se descartan: el puntaje no cambia`,
  );
  assert.notEqual(
    legitimo,
    base,
    "control: repartidas en ticks distintos SÍ se aplican (si no, el test sería vacuo)",
  );

  // Y el tope tiene que dejar pasar el techo real del juego (9 acciones para
  // colocar una pieza: 3 rotaciones + ~5 desplazamientos + 1 soltada).
  assert.ok(MAX_ACTIONS_PER_TICK >= 9, "el techo medido de Tetris es 9 acciones por tick");
});

test("árbitro: un replay con acciones fuera de presupuesto se rechaza", async () => {
  const m = await matchmake("tetris", 0, P1);
  // Tetris está en reglas v1, así que el replay no lleva campo `v`.
  const inflado = replayComprimido(m.seed, 109);
  await assert.rejects(
    () => submitScore(m.matchId, P1, 99999, inflado),
    (e: Error) => /replay too long/.test(e.message),
  );
});
