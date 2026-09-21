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
import {
  bolsilloDe,
  gruposDeVotos,
  modeloDeEscena,
} from "../app/components/aleph/nucleo/escena.js";
import type { EventoDeRegistro } from "../app/components/aleph/nucleo/escena.js";
import type {
  AsientoDeSala,
  EstadoDeAsiento,
  ResultadoDeEtapa,
  SalaDeAleph,
} from "../app/components/aleph/nucleo/estados.js";
import { guardarPreferencia, leerPreferencia } from "../app/components/aleph/nucleo/movimiento.js";
import { A, B, C, direcciones, sala } from "./aleph-ayuda.js";

/** `n` asientos vivos con direcciones estables. */
function asientos(n: number, estado: EstadoDeAsiento = "alive"): AsientoDeSala[] {
  return direcciones(n, 11).map((address) => ({ address, status: estado, pocket: 0 }));
}

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

test("10. mesas de 4, 6 y 8: columnas, etiquetas y el que habla en la fase en curso", () => {
  for (const [n, ancha] of [
    [4, 4],
    [5, 3],
    [6, 3],
    [7, 4],
    [8, 4],
  ] as const) {
    const m = modeloDeEscena(sala({ seats: asientos(n) }));
    assert.equal(m.columnas.ancha, ancha, `mesa de ${n}`);
    assert.equal(m.columnas.angosta, 2, `mesa de ${n}`);
    assert.equal(m.asientos.length, n);
    // Ninguna tarjeta sin etiqueta: la escena pasa el asiento entero, que es
    // lo que `etiquetaDe` necesita para armarla.
    for (const a of m.asientos) {
      assert.equal(a.seat.address, a.address);
      assert.ok(a.chip.startsWith("aleph."), `chip crudo: ${a.chip}`);
    }
  }

  // El que mandó el último mensaje DE LA FASE EN CURSO sale `hablando`: es la
  // única prueba de que el modelo recibe `messages` y no una vista recortada.
  const hablando = modeloDeEscena(
    sala({
      stage: { index: 0, kind: "vote", phase: "talk", acted: [] },
      messages: [{ from: B, text: "votemos al que guardó", stage: 0, phase: "talk" }],
    }),
  );
  assert.equal(hablando.asientos.find((a) => a.address === B)?.estado, "hablando");
  assert.equal(hablando.asientos.find((a) => a.address === B)?.chip, "aleph.state.hablando");
  assert.equal(hablando.asientos.find((a) => a.address === A)?.estado, "base");
});

test("la insignia +{n} sale de la Oferta que NO se anuló, y nunca undefined", () => {
  const room: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: A, status: "left", pocket: 120 },
      { address: B, status: "finished", pocket: 300 },
    ],
    // Dos Ofertas, como el mazo real. La primera se anuló (aceptaron todos) y
    // salió sin tocar `eachGot`; la segunda sí pagó.
    results: [
      { index: 0, kind: "offer", accepted: [A, B], voided: true },
      { index: 1, kind: "offer", accepted: [A], eachGot: 120 },
    ],
    payouts: { [A]: 120, [B]: 300 },
    messages: [],
  };
  const m = modeloDeEscena(room);
  const salido = m.asientos.find((a) => a.address === A);
  assert.equal(salido?.estado, "se_fue");
  assert.equal(salido?.insignia, 120);

  // Sin monto no se inventa un número: la criatura se fue igual.
  const sinMonto = modeloDeEscena({
    ...room,
    results: [{ index: 0, kind: "offer", accepted: [A], voided: true }],
  });
  assert.equal(sinMonto.asientos.find((a) => a.address === A)?.insignia, null);
  // Y el que no se fue nunca lleva insignia.
  assert.equal(m.asientos.find((a) => a.address === B)?.insignia, null);
});

test("11. lobby: las sillas vacías son las que faltan, y una sola si el mínimo ya está", () => {
  const lobby = (n: number, min: number, max: number) =>
    modeloDeEscena({
      status: "lobby",
      seats: asientos(n),
      min,
      max,
      closesAt: 1_700_000_000_000,
    });

  const dosDeCuatro = lobby(2, 4, 8);
  assert.equal(dosDeCuatro.asientos.length, 2);
  assert.equal(dosDeCuatro.sillas, 2);
  assert.equal(lobby(4, 4, 8).sillas, 1);
  assert.equal(lobby(8, 4, 8).sillas, 0);
  // El reloj del lobby es el único que la barra de la escena se queda.
  assert.equal(dosDeCuatro.reloj, 1_700_000_000_000);
  // Y no hay mesa, ni friso, ni carta: el árbitro no manda nada de eso todavía.
  assert.equal(dosDeCuatro.mesa, null);
  assert.equal(dosDeCuatro.friso, null);
  assert.equal(dosDeCuatro.carta, null);

  // En `funding` no se dibuja ninguna silla: la lista ya está congelada.
  const fondeando = modeloDeEscena({
    status: "funding",
    seats: asientos(4),
    min: 4,
    max: 8,
    deposited: [],
  });
  assert.equal(fondeando.sillas, 0);
  assert.equal(fondeando.reloj, null);
  assert.equal(fondeando.asientos[0].chip, "aleph.seat.pending");
});

test("12. dissolved: sin mesa, sin charla y los ocho en abandono", () => {
  // La vista que manda el árbitro en `dissolved`: asientos y nada más.
  const room: SalaDeAleph = { status: "dissolved", seats: asientos(8), min: 4, max: 8 };
  const m = modeloDeEscena(room);
  assert.equal(m.asientos.length, 8);
  for (const a of m.asientos) {
    assert.equal(a.estado, "abandono");
    assert.equal(a.chip, "aleph.seat.dissolved");
    assert.equal(a.respira, false);
    assert.equal(a.bolsillo, 0);
  }
  assert.equal(m.mesa, null);
  assert.equal(m.carta, null);
  assert.equal(m.friso, null);
  assert.equal(m.sillas, 0);
  assert.equal(m.maximo, 0);
  // Sin `messages` la terminal no se monta.
  assert.equal(lineasDeCharla(room), null);
});

test("13. settled: el oro sale de payouts, y el friso no tiene dorsos ni carta actual", () => {
  const [a, b, c, d] = direcciones(4, 21);
  const room: SalaDeAleph = {
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
  const m = modeloDeEscena(room);
  // `payouts` gana sobre `pocket`, en un solo lugar.
  assert.equal(m.asientos.find((x) => x.address === a)?.bolsillo, 450);
  assert.equal(bolsilloDe(room.seats[0], room), 450);
  // Y sin caja: el motor escribe `payouts` en minúsculas y el asiento puede
  // llegar en EIP-55. Indexado directo, el bolsillo caía a `pocket` en silencio.
  const eip55 = `0x${a.slice(2).toUpperCase()}`;
  assert.equal(bolsilloDe({ ...room.seats[0], address: eip55 }, room), 450);
  assert.equal(m.maximo, 450);
  // Ni un dorso ni carta en curso: la Final cortó el mazo.
  assert.equal(m.friso?.dorsos, 0);
  assert.equal(m.friso?.actual, null);
  assert.equal(m.friso?.jugadas.length, 3);
  // Las marcas del friso: salida donde alguien dejó la mesa de verdad, premio
  // donde la caja le devolvió al pozo.
  assert.deepEqual(
    m.friso?.jugadas.map((j) => [j.salida, j.premio]),
    [
      [false, true],
      [true, false],
      [true, false],
    ],
  );
  // El mazo va apagado y el reparto de la caja es `floor(box / N)`, la misma
  // cuenta que hace el motor (acá 200 / 4 = 50, sin sobrante).
  assert.equal(m.mesa?.liquidada, true);
  assert.equal(m.mesa?.reparto, 50);
  assert.equal(m.mesa?.pozo, 0);
});

test("13 bis. la Oferta anulada no marca salida en el friso", () => {
  const m = modeloDeEscena({
    status: "playing",
    seats: asientos(4),
    stage: { index: 1, kind: "vote", phase: "talk", acted: [] },
    results: [{ index: 0, kind: "offer", accepted: direcciones(4, 11), voided: true }],
    messages: [],
    cardsLeft: 5,
  });
  assert.equal(m.friso?.jugadas[0].salida, false);
  assert.equal(m.friso?.dorsos, 5);
  assert.deepEqual(m.friso?.actual, { n: 2, kind: "vote" });
});

test("14. el invariante cierra: pozo + caja + bolsillos = total", () => {
  const m = modeloDeEscena({
    status: "playing",
    seats: [
      { address: A, status: "alive", pocket: 120 },
      { address: B, status: "alive", pocket: 80 },
      { address: C, status: "left", pocket: 300 },
      { address: direcciones(4, 11)[3], status: "alive", pocket: 0 },
    ],
    stage: { index: 3, kind: "share", phase: "decide", acted: [A] },
    results: [],
    messages: [],
    pot: 2600,
    box: 900,
    potInitial: 4000,
    cardsLeft: 6,
  });
  const mesa = m.mesa;
  assert.ok(mesa);
  assert.equal(mesa.bolsillos, 500);
  assert.equal(mesa.pozo + mesa.caja + mesa.bolsillos, mesa.total);
  assert.equal(mesa.liquidada, false);
  assert.equal(mesa.reparto, null);
  // El contador cuenta a los VIVOS que actuaron, no a los que ya salieron.
  assert.deepEqual(m.carta?.contador, { clave: "aleph.scene.acted", k: 1, n: 3 });
  assert.equal(m.carta?.etapa?.n, 4);
});

test("15. sin 'de N': la carta no trae ningún total de etapas", () => {
  const base: SalaDeAleph = {
    status: "playing",
    seats: asientos(4),
    stage: { index: 5, kind: "lock", phase: "talk", acted: [] },
    results: [],
    messages: [],
    cardsLeft: 10,
  };
  const conMazo = modeloDeEscena(base);
  const sinMazo = modeloDeEscena({ ...base, cardsLeft: 0 });
  // La carta dice lo mismo con 10 cartas sin dar y con ninguna: el total de
  // etapas no existe (la Final no sale del mazo y el director puede repartir
  // Votos de más), así que `cardsLeft` no puede filtrarse ahí adentro.
  assert.deepEqual(conMazo.carta, sinMazo.carta);
  assert.deepEqual(Object.keys(conMazo.carta?.etapa ?? {}).sort(), ["fase", "hasta", "kind", "n"]);
  assert.equal(conMazo.carta?.contador?.n, 4);
  assert.equal(conMazo.carta?.etapa?.n, 6);
  // El mazo sigue contando sus cartas, que es otra cosa: "sin dar", no "faltan".
  assert.equal(conMazo.friso?.dorsos, 10);
  assert.equal(sinMazo.friso?.dorsos, 0);
});

test("16. la corona de la Final, con Final y sin ella", () => {
  const [a, b] = [A, B];
  const finalDe = (choices: Record<string, "split" | "steal">): SalaDeAleph => ({
    status: "settled",
    seats: [
      { address: a, status: "finished", pocket: 300 },
      { address: b, status: "finished", pocket: 200 },
    ],
    results: [{ index: 0, kind: "final", choices }],
    payouts: { [a]: 300, [b]: 200 },
    messages: [],
  });

  // Un solo `steal`: la corona es de él.
  const robo = modeloDeEscena(finalDe({ [a]: "steal", [b]: "split" }));
  const dosDe = (m: ReturnType<typeof modeloDeEscena>) => [...m.finalistas, ...m.asientos];
  assert.equal(dosDe(robo).find((x) => x.address === a)?.estado, "ganador");
  // El que dividió mientras el otro robaba NO se pinta de perdedor.
  const perdio = dosDe(robo).find((x) => x.address === b);
  assert.equal(perdio?.estado, "base");
  assert.equal(perdio?.traidor, false);

  // Los dos `split`: los dos con corona.
  const dividieron = dosDe(modeloDeEscena(finalDe({ [a]: "split", [b]: "split" })));
  assert.deepEqual(
    dividieron.map((x) => x.estado),
    ["ganador", "ganador"],
  );
  // Los dos `steal`: ninguno.
  const quemaron = dosDe(modeloDeEscena(finalDe({ [a]: "steal", [b]: "steal" })));
  assert.deepEqual(
    quemaron.map((x) => x.estado),
    ["base", "base"],
  );

  // La grilla se parte en dos: los dos finalistas arriba, el resto abajo.
  const conFinal = modeloDeEscena(finalDe({ [a]: "steal", [b]: "split" }));
  assert.equal(conFinal.finalistas.length, 2);
  assert.equal(conFinal.asientos.length, 0);
  assert.equal(conFinal.carta?.cierre?.clave, "aleph.line.finalSteal");
  assert.equal(conFinal.carta?.cierre?.quien, a);
  assert.equal(
    modeloDeEscena(finalDe({ [a]: "split", [b]: "split" })).carta?.cierre?.clave,
    "aleph.line.finalSplit",
  );
  assert.equal(
    modeloDeEscena(finalDe({ [a]: "steal", [b]: "steal" })).carta?.cierre?.clave,
    "aleph.line.finalBurn",
  );
});

test("16 bis. una sala que liquidó SIN Final: corona al único vivo y carta sin desenlace", () => {
  const sinFinal = (estados: EstadoDeAsiento[]): SalaDeAleph => ({
    status: "settled",
    seats: direcciones(3, 31).map((address, i) => ({
      address,
      status: estados[i],
      pocket: 10 * (i + 1),
    })),
    results: [{ index: 0, kind: "offer", accepted: [], voided: false }],
    messages: [],
  });

  const unVivo = modeloDeEscena(sinFinal(["finished", "left", "voted_out"]));
  assert.deepEqual(
    unVivo.asientos.map((x) => x.estado),
    ["ganador", "se_fue", "votado"],
  );
  assert.equal(unVivo.finalistas.length, 0);
  // Ni intenta una línea de desenlace: no hubo Final que contar.
  assert.deepEqual(unVivo.carta, {
    etapa: null,
    contador: null,
    cierre: { clave: "aleph.scene.settledNoFinal", quien: null },
  });

  const ninguno = modeloDeEscena(sinFinal(["voted_out", "left", "abandoned"]));
  assert.equal(ninguno.asientos.filter((x) => x.estado === "ganador").length, 0);
  assert.equal(ninguno.carta?.cierre?.clave, "aleph.scene.settledNoFinal");
});

test("los grupos de votos: una línea por voto firmado y los ausentes aparte", () => {
  const [a, b, c] = direcciones(3, 41);
  const etapas: ResultadoDeEtapa[] = [
    { index: 0, kind: "share" },
    { index: 1, kind: "vote", votes: { [a]: 0, [b]: 2, [c]: 1 }, eliminated: b },
  ];
  const eventos: EventoDeRegistro[] = [
    { type: "action", stage: 1, address: a, action: { type: "vote", target: b } },
    { type: "action", stage: 1, address: c, action: { type: "say" } },
    { type: "action", stage: 1, address: c, action: { type: "vote", target: b } },
    { type: "phase_end", stage: 1 },
    { type: "action", stage: 0, address: a, action: { type: "keep" } },
  ];
  const grupos = gruposDeVotos(eventos, etapas);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].n, 2);
  assert.deepEqual(grupos[0].votos, [
    { voter: a, target: b },
    { voter: c, target: b },
  ]);
  // B no votó: el motor lo cuenta en contra de sí mismo y eso no deja evento.
  assert.deepEqual(grupos[0].ausentes, [b]);

  // Una sala sin etapa de Voto no arma ningún grupo.
  assert.deepEqual(gruposDeVotos(eventos, [{ index: 0, kind: "share" }]), []);
});

test("la preferencia de movimiento sobrevive a un storage roto", () => {
  const previo = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const poner = (valor: unknown) =>
    Object.defineProperty(globalThis, "localStorage", { value: valor, configurable: true });
  const restaurar = () => {
    if (previo) Object.defineProperty(globalThis, "localStorage", previo);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };

  try {
    // Sin storage: el default es CON movimiento, y guardar no tira.
    poner(undefined);
    assert.equal(leerPreferencia(), true);
    assert.doesNotThrow(() => guardarPreferencia(false));

    // Storage que tira en los dos accesos (ventana privada, cookies
    // bloqueadas): ni leer ni guardar pueden llevarse puesta la página.
    poner({
      getItem() {
        throw new Error("bloqueado");
      },
      setItem() {
        throw new Error("bloqueado");
      },
    });
    assert.equal(leerPreferencia(), true);
    assert.doesNotThrow(() => guardarPreferencia(false));

    // Storage sano: "off" apaga, "on" y cualquier otra cosa prenden.
    const datos: Record<string, string> = {};
    poner({
      getItem: (k: string) => (k in datos ? datos[k] : null),
      setItem: (k: string, v: string) => {
        datos[k] = v;
      },
    });
    assert.equal(leerPreferencia(), true);
    guardarPreferencia(false);
    assert.equal(datos["aleph.movimiento"], "off");
    assert.equal(leerPreferencia(), false);
    guardarPreferencia(true);
    assert.equal(datos["aleph.movimiento"], "on");
    assert.equal(leerPreferencia(), true);
  } finally {
    restaurar();
  }
});
