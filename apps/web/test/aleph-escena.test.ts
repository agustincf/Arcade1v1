// LA PUESTA EN ESCENA. Todo contra `modeloDeEscena`, que devuelve datos: los
// componentes solo dibujan lo que hay acá adentro y no deciden nada.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lineasDeCharla } from "../app/components/aleph/nucleo/charla.js";
import {
  ESTADOS,
  filasDoradas,
  nodosDe,
  nodosDeGrieta,
  rasgosDe,
} from "../app/components/aleph/nucleo/criatura.js";
import type { SalaDeAleph } from "../app/components/aleph/nucleo/estados.js";
import { A, B, direcciones } from "./aleph-ayuda.js";

test("los guardas numéricos del oro: ni fraccionarios ni filas de más", () => {
  // Con filas > 8 el oro NO puede subir a la zona de la corona de identidad
  // (y = 3-4) ni a la de estado (y <= 2): la fila más alta que puede pintar es
  // la 7, que es el tope de las ocho.
  for (const filas of [0, 1, 8, 9, 12, 100]) {
    const ys = [...filasDoradas(filas)];
    assert.ok(
      ys.every((y) => y >= 7 && y <= 14),
      `filas=${filas} pintó ${ys}`,
    );
  }
  assert.deepEqual([...filasDoradas(12)], [...filasDoradas(8)]);
  assert.equal(filasDoradas(-3).size, 0);

  // Un no entero indexaba `hw[5.5]` y emitía un rect con x/w en NaN.
  const r = rasgosDe(direcciones(1, 5)[0]);
  for (const filas of [3.5, 0.4, 7.6]) {
    for (const n of nodosDe(r, { estado: "base", filas })) {
      assert.ok(
        Number.isFinite(n.x) &&
          Number.isFinite(n.y) &&
          Number.isFinite(n.w) &&
          Number.isFinite(n.h),
        `filas=${filas} dio ${JSON.stringify(n)}`,
      );
    }
  }
  assert.deepEqual(nodosDe(r, { filas: 3.5 }), nodosDe(r, { filas: 4 }));
});

test("3 bis. la grieta suelta es la misma que dibuja nodosDe", () => {
  // `Criatura.tsx` dibuja el cuerpo con `nodosDe(..., traidor: false)` y la
  // grieta aparte, en su propio <g>, para poder animarla. Si las dos salidas se
  // fueran separando, el traidor se dibujaría distinto según quién lo pida.
  const orden = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.y - b.y || a.x - b.x;
  for (const a of direcciones(50, 77)) {
    const r = rasgosDe(a);
    for (const estado of ESTADOS) {
      for (const filas of [0, 4, 8]) {
        const junto = nodosDe(r, { estado, traidor: true, filas });
        const partido = [
          ...nodosDe(r, { estado, traidor: false, filas }),
          ...nodosDeGrieta(estado),
        ];
        assert.equal(junto.length, partido.length);
        assert.deepEqual([...junto].sort(orden), [...partido].sort(orden));
      }
    }
  }
});

test("13 (mitad de charla). liquidada: los susurros salen marcados, con su to y sus separadores", () => {
  const liquidada: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: A, status: "finished", pocket: 6 },
      { address: B, status: "voted_out", pocket: 2 },
    ],
    results: [
      { index: 0, kind: "share" },
      { index: 1, kind: "vote" },
    ],
    messages: [
      { from: A, text: "aportemos todos", stage: 0, phase: "talk" },
      { from: B, to: A, text: "vos y yo, a los demás no", stage: 0, phase: "talk" },
      { from: A, text: "votemos al que guardó", stage: 1, phase: "talk" },
    ],
  };
  const modelo = lineasDeCharla(liquidada);
  assert.ok(modelo);
  assert.equal(modelo.desclasificada, true);
  // Separador, mensaje, susurro, separador, mensaje: en el orden en que vinieron.
  assert.deepEqual(
    modelo.lineas.map((l) => l.tipo),
    ["etapa", "mensaje", "mensaje", "etapa", "mensaje"],
  );
  assert.deepEqual(modelo.lineas[0], { tipo: "etapa", n: 1, kind: "share" });
  assert.deepEqual(modelo.lineas[3], { tipo: "etapa", n: 2, kind: "vote" });

  // `assert.fail` devuelve `never`, así que TypeScript angosta la unión después
  // de la guarda y el assert no puede pasar de casualidad por el lado que no es.
  const susurro = modelo.lineas[2];
  if (susurro.tipo !== "mensaje") assert.fail("la línea 2 tenía que ser un mensaje");
  assert.equal(susurro.susurro, true);
  assert.equal(susurro.to, A);
  assert.equal(susurro.texto, "vos y yo, a los demás no");

  const publico = modelo.lineas[1];
  if (publico.tipo !== "mensaje") assert.fail("la línea 1 tenía que ser un mensaje");
  assert.equal(publico.susurro, false);
  assert.equal(publico.to, undefined);

  // Una etapa sin resultado no rompe: el separador sale igual, sin `kind`.
  const huerfano = lineasDeCharla({ ...liquidada, results: [] });
  assert.ok(huerfano);
  const separador = huerfano.lineas[0];
  if (separador.tipo !== "etapa") assert.fail("la primera línea tenía que ser un separador");
  assert.equal(separador.kind, undefined);
  assert.equal(separador.n, 1);
});
