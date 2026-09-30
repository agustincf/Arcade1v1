// EL MARCADO de la escena. Los demás tests miran datos; este dibuja el
// componente a un string y mira lo que le llega al lector de pantalla y, en el
// friso, también a quien mira sin lector.
//
// Una sola regla: el nombre de un <li> cuyo contenido es todo `aria-hidden` va
// como texto oculto (`sr-only`) adentro, nunca como `aria-label` del <li>:
// varios lectores no leen el aria-label de un listitem. El friso ya la sigue
// (6cd22a9); las sillas vacías del lobby tienen que seguir la misma.
//
// El friso, además, se explica a la vista: un rótulo que se ve y nombra la
// lista, el nombre de cada carta como tooltip y la leyenda de los dos puntos
// cuando la sala tiene alguno.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Asientos } from "../app/components/aleph/Asientos.js";
import { Friso } from "../app/components/aleph/Friso.js";
import { modeloDeEscena } from "../app/components/aleph/nucleo/escena.js";
import type { AsientoDeSala, SalaDeAleph } from "../app/components/aleph/nucleo/estados.js";
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

/** Como `t`, pero deja ver las variables: el nombre de cada carta del friso se
 *  arma con ellas, y es lo que miran los tests del friso. */
const tv = (key: string, vars?: Record<string, string | number>) =>
  vars
    ? `${key}{${Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")}}`
    : key;

/** El friso de una sala, dibujado. */
function frisoDe(room: SalaDeAleph): string {
  const friso = modeloDeEscena(room).friso;
  assert.ok(friso, "la sala tiene que tener friso");
  return renderToStaticMarkup(React.createElement(Friso, { friso, t: tv }));
}

const [a, b, c, d] = direcciones(4, 21);

/** Liquidada y con las dos marcas: premio en el Reparto, salida en el Voto (uno
 *  eliminado) y en la Oferta (uno aceptó). Es la sala del test 13 de la escena. */
const liquidada: SalaDeAleph = {
  status: "settled",
  seats: [
    { address: a, status: "finished", pocket: 100 },
    { address: b, status: "voted_out", pocket: 40 },
    { address: c, status: "left", pocket: 60 },
    { address: d, status: "abandoned", pocket: 0 },
  ],
  results: [
    { index: 0, kind: "share", bonus: 25 },
    { index: 1, kind: "vote", eliminated: b, votes: { [a]: 0, [b]: 2, [c]: 1 } },
    { index: 2, kind: "offer", accepted: [c], eachGot: 60 },
  ],
  payouts: { [a]: 450, [b]: 90, [c]: 110, [d]: 50 },
  pot: 0,
  box: 200,
  potInitial: 4000,
  cardsLeft: 3,
  messages: [],
};

/** En juego y sin una sola marca: la Oferta se anuló (aceptaron todos, así que
 *  no se fue nadie), el Voto está en curso y quedan cinco cartas sin dar. */
const sinMarcas: SalaDeAleph = {
  status: "playing",
  seats: direcciones(4, 11).map(
    (address): AsientoDeSala => ({ address, status: "alive", pocket: 0 }),
  ),
  stage: { index: 1, kind: "vote", phase: "talk", acted: [] },
  results: [{ index: 0, kind: "offer", accepted: direcciones(4, 11), voided: true }],
  messages: [],
  cardsLeft: 5,
};

/** En juego con una sola de las dos marcas: el Reparto no dio premio y el Voto
 *  sacó a uno. */
const soloSalida: SalaDeAleph = {
  status: "playing",
  seats: [
    { address: a, status: "alive", pocket: 0 },
    { address: b, status: "voted_out", pocket: 0 },
    { address: c, status: "alive", pocket: 0 },
    { address: d, status: "alive", pocket: 0 },
  ],
  stage: { index: 2, kind: "offer", phase: "decide", acted: [] },
  results: [
    { index: 0, kind: "share", bonus: 0 },
    { index: 1, kind: "vote", eliminated: b, votes: { [a]: 1, [b]: 3 } },
  ],
  messages: [],
  cardsLeft: 4,
};

test("friso: el rótulo se ve, y es el nombre de la lista", () => {
  const html = frisoDe(liquidada);
  const rotulo = html.match(/<p\b([^>]*)>aleph\.frieze\.title<\/p>/);
  assert.ok(rotulo, "el rótulo tiene que ser texto que se ve, no solo un aria-label");
  assert.doesNotMatch(rotulo[1], /sr-only|aria-hidden/);
  const id = rotulo[1].match(/\bid="([^"]+)"/)?.[1];
  assert.ok(id, "el rótulo necesita un id para nombrar la lista");
  const ol = html.match(/<ol\b[^>]*>/)?.[0] ?? "";
  assert.ok(ol.includes(`aria-labelledby="${id}"`), "la lista se nombra con el rótulo");
  // Un solo nombre: con un `aria-label` además, habría dos que mantener parejos.
  assert.doesNotMatch(ol, /aria-label=/);
});

test("friso: cada carta dice qué etapa es al pasarle el mouse, con sus marcas", () => {
  const cartas = frisoDe(liquidada).match(/<li\b[^>]*>.*?<\/li>/g) ?? [];
  const nombres = [
    "aleph.frieze.played{n=1,kind=aleph.stage.share}. aleph.frieze.bonus",
    "aleph.frieze.played{n=2,kind=aleph.stage.vote}. aleph.frieze.left",
    "aleph.frieze.played{n=3,kind=aleph.stage.offer}. aleph.frieze.left",
  ];
  assert.equal(cartas.length, nombres.length);
  cartas.forEach((carta, i) => {
    // El lector oye el nombre entero, marcas incluidas, como primer hijo...
    const oculto = carta.match(/^<li\b[^>]*><span class="sr-only">([^<]*)<\/span>/)?.[1];
    assert.equal(oculto, nombres[i]);
    // ...y el mouse ve el mismo texto. El tooltip va en el dibujo, que es
    // `aria-hidden`: puesto en el <li>, el lector diría el nombre dos veces.
    assert.doesNotMatch(carta, /^<li\b[^>]*\btitle=/);
    const dibujo = carta.match(/<span\b[^>]*\btitle="[^"]*"[^>]*>/)?.[0] ?? "";
    assert.ok(dibujo.includes(`title="${nombres[i]}"`), `el tooltip de la carta ${i + 1}`);
    assert.ok(dibujo.includes('aria-hidden="true"'), `el dibujo de la carta ${i + 1}`);
  });
});

test("friso: la carta en curso y los dorsos también se nombran al pasarles el mouse", () => {
  const tooltips = [...frisoDe(sinMarcas).matchAll(/\btitle="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(tooltips, [
    // La Oferta anulada no suma la marca de salida: no se fue nadie.
    "aleph.frieze.played{n=1,kind=aleph.stage.offer}",
    "aleph.frieze.current{n=2,kind=aleph.stage.vote}",
    "aleph.frieze.back",
    "aleph.frieze.back",
    "aleph.frieze.back",
    "aleph.frieze.back",
    "aleph.frieze.back",
  ]);
});

test("friso: la leyenda de los puntos sale solo si hay puntos, y con los que hay", () => {
  // Sin marcas no hay leyenda: explicaría algo que no está en pantalla.
  assert.doesNotMatch(frisoDe(sinMarcas), /friso-leyenda/);

  /** Cada entrada como [la marca de su muestra, el texto que la explica]. */
  const entradas = (html: string) => {
    const leyenda = html.match(/<p class="friso-leyenda\b[^>]*>.*?<\/p>/)?.[0] ?? "";
    // Es la clave de un dibujo: el lector ya oye las marcas en el nombre de cada carta.
    assert.match(leyenda, /aria-hidden="true"/);
    return [...leyenda.matchAll(/friso-(salida|premio)".*?(aleph\.frieze\.\w+)/g)]
      .map((m) => [m[1], m[2]])
      .sort();
  };
  assert.deepEqual(entradas(frisoDe(liquidada)), [
    ["premio", "aleph.frieze.bonus"],
    ["salida", "aleph.frieze.left"],
  ]);
  assert.deepEqual(entradas(frisoDe(soloSalida)), [["salida", "aleph.frieze.left"]]);
});
