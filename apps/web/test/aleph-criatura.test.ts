// El GENERADOR de criaturas. Los tests miran los nodos, que son la única fuente
// de verdad: `Criatura.tsx` mapea esa lista a <rect> y `svgDeCriatura` la
// serializa, así que los dos consumen lo mismo y no pueden divergir.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAMILIAS,
  SECUNDARIOS,
  DESCONOCIDA,
  SILUETAS,
  CORONAS,
  MARCAS,
  ACCESORIOS,
  OJOS,
  BOCAS,
  rasgosDe,
  capaDeIdentidad,
  capaDeCara,
} from "../app/components/aleph/nucleo/criatura.js";
import { direcciones } from "./aleph-ayuda.js";

const SURFACE = "#1f1a29";
const COLORES_DE_ESTADO_DEL_SITIO = ["#f2c14e", "#b8e08a", "#5fd68a", "#f0716f"];

/** Luminancia relativa de WCAG, escrita acá para no depender de nada. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Contraste de WCAG entre dos hex. */
function contraste(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alto + 0.05) / (bajo + 0.05);
}

/** Saturación HSL. */
function saturacion(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...c);
  const min = Math.min(...c);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

test("las ocho tablas: largo, medios anchos y la franja de hw >= 4", () => {
  assert.equal(SILUETAS.length, 8);
  for (const tabla of [CORONAS, MARCAS, ACCESORIOS, OJOS, BOCAS]) assert.equal(tabla.length, 8);
  assert.equal(FAMILIAS.length, 8);
  assert.equal(SECUNDARIOS.length, 4);
  for (const [i, hw] of SILUETAS.entries()) {
    assert.equal(hw.length, 10, `silueta ${i}`);
    for (const [j, v] of hw.entries()) {
      assert.ok(v >= 2 && v <= 6, `silueta ${i} fila ${j}: hw=${v} fuera de [2, 6]`);
      if (j >= 3 && j <= 8)
        assert.ok(v >= 4, `silueta ${i} fila ${j}: hw=${v} < 4 en la franja 3-8`);
    }
  }
});

test("4. la paleta no toca los colores de estado y el oro se lee sobre los nueve cuerpos", () => {
  for (const cuerpo of [...FAMILIAS.map((f) => f.cuerpo), DESCONOCIDA.cuerpo]) {
    const l = luminancia(cuerpo);
    assert.ok(
      l >= 0.136 && l <= 0.158,
      `${cuerpo}: luminancia ${l.toFixed(4)} fuera de la ventana`,
    );
    const oro = contraste(cuerpo, "#f2c14e");
    assert.ok(oro >= 3, `${cuerpo}: el oro del bolsillo da ${oro.toFixed(2)}:1`);
    const fondo = contraste(cuerpo, SURFACE);
    assert.ok(fondo >= 3, `${cuerpo}: contra --color-surface da ${fondo.toFixed(2)}:1`);
  }
  const paleta = [
    ...FAMILIAS.map((f) => f.cuerpo),
    ...FAMILIAS.map((f) => f.sombra),
    ...SECUNDARIOS,
    DESCONOCIDA.cuerpo,
    DESCONOCIDA.sombra,
  ];
  for (const c of paleta)
    assert.ok(!COLORES_DE_ESTADO_DEL_SITIO.includes(c), `${c} es un color de estado (regla A)`);
  for (const s of SECUNDARIOS) {
    assert.ok(saturacion(s) <= 0.18, `secundario ${s}: saturación ${saturacion(s).toFixed(3)}`);
    assert.ok(contraste(s, SURFACE) >= 4, `secundario ${s}: ${contraste(s, SURFACE).toFixed(2)}:1`);
  }
  assert.equal(saturacion(DESCONOCIDA.cuerpo), 0, "el gris de la desconocida tiene que ser neutro");
});

test("5. variedad: 8.388.608 combinaciones y pocas colisiones sobre 20.000 direcciones", () => {
  const tablas = [SILUETAS, OJOS, CORONAS, BOCAS, MARCAS, ACCESORIOS, FAMILIAS, SECUNDARIOS];
  const combinaciones = tablas.reduce((n, t) => n * t.length, 1);
  assert.equal(combinaciones, 8388608);
  assert.ok(combinaciones >= 1000000);
  const vistos = new Set<string>();
  let colisiones = 0;
  for (const a of direcciones(20000, 99)) {
    const r = rasgosDe(a);
    const clave = [
      r.silueta,
      r.ojos,
      r.corona,
      r.boca,
      r.marca,
      r.accesorio,
      r.familia,
      r.secundario,
    ].join("-");
    if (vistos.has(clave)) colisiones++;
    vistos.add(clave);
  }
  assert.ok(
    colisiones <= 40,
    `colisiones exactas: ${colisiones} (con la semilla 99 son 16; el techo es 40)`,
  );
});

test("7. robustez: cualquier basura da la criatura desconocida y no tira", () => {
  const basuras = ["", "0x", "0x123", "0xZZ", "no soy una address", "0x" + "g".repeat(40)];
  for (const basura of basuras) {
    const r = rasgosDe(basura);
    assert.equal(r.desconocida, true, `rasgosDe(${JSON.stringify(basura)})`);
    assert.equal(r.silueta, 0);
    assert.doesNotThrow(() => capaDeIdentidad(r, { filas: 8 }));
  }
  assert.equal(rasgosDe(null).desconocida, true);
  assert.equal(rasgosDe(undefined).desconocida, true);
  // Sin corona ni accesorio: no hay un solo nodo arriba del cuerpo (y < 5).
  const nodos = capaDeIdentidad(rasgosDe("0x"), { filas: 0 });
  assert.equal(nodos.filter((n) => n.y < 5).length, 0);
  assert.ok(nodos.every((n) => n.fill === DESCONOCIDA.cuerpo || n.fill === DESCONOCIDA.sombra));
});

test("presupuesto: identidad <= 24 nodos y nunca y < 3; cara <= 9", () => {
  for (const a of direcciones(2000, 31415)) {
    const r = rasgosDe(a);
    for (const filas of [0, 1, 4, 8]) {
      for (const conPatas of [true, false]) {
        const identidad = capaDeIdentidad(r, { filas, conPatas });
        assert.ok(identidad.length <= 24, `capa de identidad: ${identidad.length} nodos`);
        for (const n of identidad) assert.ok(n.y >= 3, `identidad con y=${n.y} (zona de estado)`);
      }
    }
    assert.ok(capaDeCara(r).length <= 9);
  }
});
