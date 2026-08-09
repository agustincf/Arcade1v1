// Los reembolsos on-chain en lote chocaban de nonce.
//
// El barrendero disparaba N `cancelMatchOnchain` en paralelo, en el mismo tick
// sincrónico: las N pedían el nonce pendiente antes de que se minara ninguna, así
// que todas salían con el MISMO nonce. Entraba una sola y el resto revertía en el
// RPC, con el error yendo a un console.error que nadie mira y sin ningún
// reintento. Cuando vencían varias mesas juntas se reembolsaba una y los demás
// jugadores tenían que descubrir /recover por su cuenta.
//
// La cola es lo que arregla eso: cada escritura arranca cuando la anterior
// terminó, así que cada una lee el nonce ya actualizado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enCola } from "../src/onchain.js";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("las tareas encoladas NO se solapan, aunque se disparen todas juntas", async () => {
  let enVuelo = 0;
  let maxEnVuelo = 0;
  const orden: number[] = [];

  const tarea = (i: number) =>
    enCola(async () => {
      enVuelo++;
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      await dormir(10);
      orden.push(i);
      enVuelo--;
      return i;
    });

  // Igual que el barrendero: N disparos en el mismo tick, sin await entre ellos.
  const res = await Promise.all([1, 2, 3, 4, 5].map(tarea));

  assert.equal(maxEnVuelo, 1, "nunca hubo dos escrituras on-chain a la vez");
  assert.deepEqual(orden, [1, 2, 3, 4, 5], "se ejecutaron en orden de llegada");
  assert.deepEqual(res, [1, 2, 3, 4, 5]);
});

test("una tarea que falla no corta la cola: las siguientes igual corren", async () => {
  const corrieron: string[] = [];

  const ok1 = enCola(async () => {
    corrieron.push("ok1");
    return "ok1";
  });
  const rota = enCola(async () => {
    corrieron.push("rota");
    throw new Error("el RPC se cayó");
  });
  const ok2 = enCola(async () => {
    corrieron.push("ok2");
    return "ok2";
  });

  assert.equal(await ok1, "ok1");
  await assert.rejects(() => rota, /el RPC se cayó/);
  assert.equal(await ok2, "ok2", "la de después del error igual se ejecutó");
  assert.deepEqual(corrieron, ["ok1", "rota", "ok2"]);
});

test("el error llega al que llamó, no se traga en silencio", async () => {
  // Esto es lo que faltaba antes: el fallo terminaba en un console.error y el
  // llamador nunca se enteraba, así que no había cómo reintentar ni alertar.
  await assert.rejects(
    () =>
      enCola(async () => {
        throw new Error("nonce too low");
      }),
    /nonce too low/,
  );
});
