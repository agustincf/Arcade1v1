// El cuadro de animación de los aliens en el VISOR de repeticiones. El visor no
// lleva contador propio: saca el cuadro de `offsetX`, y `offsetX` queda
// negativo cuando la formación se corre a la izquierda con las columnas de ese
// lado muertas. El `%` de JS conserva el signo (-1 % 2 === -1): el cuadro daba
// -1, el bitmap salía undefined y la repetición se caía con
// "Cannot read properties of undefined (reading 'length')".

import { test } from "node:test";
import assert from "node:assert/strict";

import { InvadersEngine, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";
import { defaultParams, getStrategy } from "@arcade1v1/strategies";

import { alienBitmap, frameFromOffset } from "../app/games/invaders/sprites";

const esBitmap = (bm: string[] | undefined) =>
  Array.isArray(bm) && bm.length === 9 && bm.every((l) => l.length === 12);

test("el cuadro sale 0 o 1 también con offsetX negativo", () => {
  for (const x of [-0.01, -5, -10, -15, -19.9, -25, -154.96]) {
    const f = frameFromOffset(x);
    assert.ok(f === 0 || f === 1, `offsetX ${x} dio el cuadro ${f}`);
  }
});

test("con offsetX positivo el cuadro no cambia y alterna cada 10 px", () => {
  assert.deepEqual([0, 5, 10, 15, 20, 29.9, 30].map(frameFromOffset), [0, 0, 1, 1, 0, 0, 1]);
  // Del lado negativo sigue alternando cada 10 px, sin saltos en el cero.
  assert.deepEqual([-25, -15, -5, 5].map(frameFromOffset), [1, 0, 1, 0]);
});

test("alienBitmap da un sprite para cualquier cuadro, aun fuera de rango", () => {
  for (const row of [0, 1, 2, 3])
    for (const frame of [-3, -2, -1, 0, 1, 2, 7])
      assert.ok(esBitmap(alienBitmap(row, frame)), `fila ${row}, cuadro ${frame}`);
});

test("una partida real de la casa corre la formación a la izquierda y el visor la dibuja", () => {
  // Semilla 15 de invaders.hunter: offsetX pasa a negativo en el tick 436 y
  // llega a ~-155. Se re-juega como lo hace ReplayPlayer y se pide el sprite de
  // cada alien vivo en cada tick, con la misma cuenta que usa drawInvaders.
  const hunter = getStrategy("invaders.hunter")!;
  const r = hunter.play(15, defaultParams(hunter)).replay as ReplayInvaders;
  const eng = new InvadersEngine(r.seed);
  const porTick = new Map<number, ReplayInvaders["inputs"][number]["a"][]>();
  for (const i of r.inputs) porTick.set(i.t, [...(porTick.get(i.t) ?? []), i.a]);

  let minimo = Infinity;
  for (let t = 0; t < r.ticks && !eng.over; t++) {
    for (const a of porTick.get(t) ?? []) eng.apply(a);
    eng.tick();
    minimo = Math.min(minimo, eng.offsetX);
    const frame = frameFromOffset(eng.offsetX);
    for (const a of eng.aliveAliens())
      assert.ok(esBitmap(alienBitmap(a.row, frame)), `tick ${t}, offsetX ${eng.offsetX}`);
  }
  assert.ok(minimo < 0, `la formación nunca pasó del borde izquierdo (mínimo ${minimo})`);
});
