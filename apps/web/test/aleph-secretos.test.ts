// LO QUE PROTEGE AL JUEGO. En vivo la pantalla no puede insinuar un solo
// secreto: solo se sabe quién actuó, nunca qué hizo, y de los susurros no se
// dice ni que existieron.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lineasDeCharla } from "../app/components/aleph/nucleo/charla.js";
import {
  SILUETAS,
  capaDeEstado,
  capaDeIdentidad,
  filasDoradas,
  nodosDe,
  rasgosDe,
} from "../app/components/aleph/nucleo/criatura.js";
import { chipDeAsiento, estadoDeAsiento } from "../app/components/aleph/nucleo/estados.js";
import { A, B, C, direcciones, sala } from "./aleph-ayuda.js";

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

test("17. solo lo cerrado: en fase de decisión no se filtra nada, y hablando pide la fase en curso", () => {
  const enJuego = sala({ stage: { index: 0, kind: "vote", phase: "decide", acted: [A, B] } }, 3);
  for (const asiento of enJuego.seats) {
    const { estado, traidor } = estadoDeAsiento(asiento, enJuego);
    assert.equal(traidor, false, `${asiento.address} salió traidor sin Cerradura cerrada`);
    assert.ok(
      !["ganador", "se_fue", "votado"].includes(estado),
      `${asiento.address} salió ${estado} con results vacío`,
    );
  }
  assert.equal(estadoDeAsiento(enJuego.seats[0], enJuego).estado, "sellado");
  assert.equal(estadoDeAsiento(enJuego.seats[1], enJuego).estado, "sellado");
  assert.equal(estadoDeAsiento(enJuego.seats[2], enJuego).estado, "esperando");

  // El candado de fase: `messages` viene filtrado por ETAPA, no por fase, y al
  // pasar de `talk` a `decide` el motor no lo toca. Sin el recorte, el último
  // que habló se quedaría con el chip "habla" toda la fase de decisión —
  // minutos, con un sondeo de 10 s— tapándole su "sin decidir".
  const viejo = sala(
    {
      stage: { index: 0, kind: "vote", phase: "decide", acted: [] },
      messages: [{ from: A, text: "confíen", stage: 0, phase: "talk" }],
    },
    3,
  );
  for (const asiento of viejo.seats)
    assert.notEqual(estadoDeAsiento(asiento, viejo).estado, "hablando");
  assert.equal(estadoDeAsiento(viejo.seats[0], viejo).estado, "esperando");
  // Y alguien que habla DURANTE `decide` sí está hablando de verdad: `say` no
  // está limitado a la fase de charla.
  const ahora = sala({ messages: [{ from: A, text: "ojo", stage: 0, phase: "decide" }] }, 3);
  assert.equal(estadoDeAsiento(ahora.seats[0], ahora).estado, "hablando");
});

test("17 bis. dissolved sale del estado de la SALA, no del asiento", () => {
  // En lobby, funding y dissolved el árbitro devuelve TODOS los asientos con
  // `status: "alive"` y `pocket: 0`: no hay ningún `abandoned` del que salir.
  const rota = sala(
    { status: "dissolved", stage: undefined, results: undefined, messages: undefined },
    3,
  );
  for (const asiento of rota.seats) {
    assert.equal(estadoDeAsiento(asiento, rota).estado, "abandono");
    assert.equal(chipDeAsiento(asiento, rota), "aleph.seat.dissolved");
  }
});

test("19. en vivo no hay susurros, aunque el árbitro cambie", () => {
  // Hoy es imposible: `viewFor` los filtra. Es defensa en profundidad contra
  // un cambio futuro del árbitro.
  const viva = sala({
    messages: [
      { from: A, text: "público", stage: 0, phase: "talk" },
      { from: B, to: C, text: "esto no se ve", stage: 0, phase: "talk" },
    ],
  });
  const modelo = lineasDeCharla(viva);
  assert.ok(modelo);
  assert.equal(modelo.desclasificada, false);
  assert.equal(modelo.lineas.length, 1);
  assert.deepEqual(modelo.lineas[0], {
    tipo: "mensaje",
    from: A,
    to: undefined,
    texto: "público",
    susurro: false,
  });
  assert.ok(!JSON.stringify(modelo).includes("esto no se ve"));
});

test("20. la charla no inventa: sin mensajes no hay contador de susurros ni marca de canal privado", () => {
  const modelo = lineasDeCharla(sala({ messages: [] }));
  assert.ok(modelo);
  assert.deepEqual(modelo, { desclasificada: false, lineas: [] });
  // Y sin `messages` no se monta nada: en lobby, funding y dissolved el árbitro
  // no manda el campo, y una ventana entera prometería un canal que no se abrió.
  assert.equal(
    lineasDeCharla(sala({ status: "lobby", stage: undefined, messages: undefined })),
    null,
  );
});
