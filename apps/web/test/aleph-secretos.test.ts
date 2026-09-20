// LO QUE PROTEGE AL JUEGO. En vivo la pantalla no puede insinuar un solo
// secreto: solo se sabe quién actuó, nunca qué hizo, y de los susurros no se
// dice ni que existieron.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SILUETAS,
  capaDeEstado,
  capaDeIdentidad,
  filasDoradas,
  nodosDe,
  rasgosDe,
} from "../app/components/aleph/nucleo/criatura.js";
import { direcciones } from "./aleph-ayuda.js";

test("18. el sello es idéntico para todos y no ve la dirección", () => {
  const referencia = capaDeEstado("sellado", SILUETAS[0]);
  for (const a of direcciones(200, 7)) {
    const hw = SILUETAS[rasgosDe(a).silueta];
    assert.deepEqual(capaDeEstado("sellado", hw), referencia);
  }
  // El tercer argumento de `capaDeEstado` (las filas doradas) no cambia NADA
  // fuera de `votado`/`abandono`: `nodosDe` se lo pasa siempre lleno, pero solo
  // `dorsoDeAleph` lo mira. Es la promesa del desvío 3, comprobada sobre los
  // otros seis estados y las nueve cantidades de filas.
  for (const estado of ["base", "hablando", "esperando", "sellado", "se_fue", "ganador"] as const)
    for (let filas = 0; filas <= 8; filas++)
      assert.deepEqual(
        capaDeEstado(estado, SILUETAS[0], filasDoradas(filas)),
        capaDeEstado(estado, SILUETAS[0]),
        `${estado} filas=${filas}: la capa de estado miró el bolsillo`,
      );
  // Y dos criaturas selladas difieren ÚNICAMENTE en la capa de identidad: se
  // comprueba quitándola (por longitud, que `nodosDe` la pone primero).
  const sinIdentidad = (address: string) => {
    const r = rasgosDe(address);
    const largo = capaDeIdentidad(r, { filas: 0 }).length;
    return nodosDe(r, { estado: "sellado", filas: 0 }).slice(largo);
  };
  const [a, b] = direcciones(2, 1234);
  assert.deepEqual(sinIdentidad(a), sinIdentidad(b));
});
