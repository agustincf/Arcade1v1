// EL MARCADO ACCESIBLE de la escena. Los demás tests miran datos; este dibuja el
// componente a un string y mira lo que le llega al lector de pantalla.
//
// Una sola regla: el nombre de un <li> cuyo contenido es todo `aria-hidden` va
// como texto oculto (`sr-only`) adentro, nunca como `aria-label` del <li>:
// varios lectores no leen el aria-label de un listitem. El friso ya la sigue
// (6cd22a9); las sillas vacías del lobby tienen que seguir la misma.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Asientos } from "../app/components/aleph/Asientos.js";
import { modeloDeEscena } from "../app/components/aleph/nucleo/escena.js";
import type { AsientoDeSala } from "../app/components/aleph/nucleo/estados.js";
import { direcciones } from "./aleph-ayuda.js";

// El runner corre `.tsx` con el JSX clásico (`React.createElement`), porque el
// `jsx: react-jsx` vive en el tsconfig de la web y no en la raíz. Cada archivo
// de test corre en su propio proceso, así que el global no se filtra a otros.
(globalThis as { React?: unknown }).React = React;

const t = (key: string) => key;

test("lobby: la silla vacía se nombra con texto oculto, no con aria-label del <li>", () => {
  const seats = direcciones(2, 11).map(
    (address): AsientoDeSala => ({ address, status: "alive", pocket: 0 }),
  );
  const modelo = modeloDeEscena({ status: "lobby", seats, min: 4, max: 8, closesAt: 1 });
  assert.equal(modelo.sillas, 2);

  const html = renderToStaticMarkup(
    React.createElement(Asientos, {
      modelo,
      destello: null,
      t,
      etiquetaDe: () => ({ plana: "x", perfil: null, wallet: "w", tag: null }),
    }),
  );

  const sillas = html.match(/<li class="asiento asiento--vacia"[^>]*>.*?<\/li>/g) ?? [];
  assert.equal(sillas.length, 2);
  for (const silla of sillas) {
    // Sin aria-label en el <li>...
    assert.doesNotMatch(silla, /^<li[^>]*aria-label/);
    // ...y el nombre como PRIMER hijo, en texto que el lector sí lee.
    assert.match(silla, /^<li[^>]*><span class="sr-only">aleph\.scene\.emptySeat<\/span>/);
  }
});
