// El GENERADOR de criaturas. Los tests miran los nodos, que son la única fuente
// de verdad: `Criatura.tsx` mapea esa lista a <rect> y `svgDeCriatura` la
// serializa, así que los dos consumen lo mismo y no pueden divergir.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lineasDeCharla } from "../app/components/aleph/nucleo/charla.js";
import {
  FAMILIAS,
  SECUNDARIOS,
  DESCONOCIDA,
  COLORES_DE_ESTADO,
  SILUETAS,
  CORONAS,
  MARCAS,
  ACCESORIOS,
  OJOS,
  BOCAS,
  ESTADOS,
  rasgosDe,
  capaDeIdentidad,
  capaDeCara,
  capaDeEstado,
  filasDeOro,
  nodosDe,
  svgDeCriatura,
} from "../app/components/aleph/nucleo/criatura.js";
import {
  chipDeAsiento,
  estadoDeAsiento,
  type SalaDeAleph,
} from "../app/components/aleph/nucleo/estados.js";
import { A, B, direcciones, sala } from "./aleph-ayuda.js";

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

test("2. todo adentro de la grilla, cada capa en su zona y el dorso inscripto en el cuerpo", () => {
  const DE_CABEZA: readonly string[] = ["hablando", "esperando", "sellado", "se_fue", "ganador"];
  for (const a of direcciones(2000, 20260920)) {
    const r = rasgosDe(a);
    const hw = SILUETAS[r.silueta];
    for (const estado of ESTADOS) {
      for (const traidor of [false, true]) {
        for (const filas of [0, 1, 4, 8]) {
          for (const n of nodosDe(r, { estado, traidor, filas })) {
            assert.ok(n.w > 0 && n.h > 0, `nodo vacío ${JSON.stringify(n)}`);
            assert.ok(
              n.x >= 0 && n.y >= 0 && n.x + n.w <= 16 && n.y + n.h <= 16,
              `fuera de grilla ${JSON.stringify(n)} · ${estado} traidor=${traidor} filas=${filas}`,
            );
          }
        }
      }
      const overlay = capaDeEstado(estado, hw).overlay;
      if (DE_CABEZA.includes(estado)) {
        // Ningún overlay de cabeza baja de y=2: es lo que impide que la corona
        // dorada del ganador tape la corona de identidad (y 3-4).
        for (const n of overlay)
          assert.ok(n.y + n.h <= 3, `overlay de cabeza de ${estado}: ${JSON.stringify(n)}`);
      }
      if (estado === "votado" || estado === "abandono") {
        // El dorso, inscripto en el rectángulo del cuerpo de ESA silueta.
        const dy = estado === "votado" ? 1 : 0;
        for (const n of overlay) {
          assert.ok(n.y >= 3, `el dorso de ${estado} entró en la zona de cabeza`);
          for (let y = n.y + dy; y < n.y + dy + n.h; y++) {
            const i = y - 5 - dy;
            assert.ok(i >= 0 && i <= 9, `dorso fuera del cuerpo (fila ${y}) en ${estado}`);
            assert.ok(
              n.x >= 8 - hw[i] && n.x + n.w <= 8 + hw[i],
              `dorso fuera del ancho del cuerpo: silueta ${r.silueta}, fila ${i}`,
            );
          }
        }
      }
    }
  }
});

test("3. tope de nodos: nunca más de 40, en cualquier combinación", () => {
  let maximo = 0;
  for (const a of direcciones(2000, 4242)) {
    const r = rasgosDe(a);
    for (const estado of ESTADOS) {
      // De las tres cotas por capa, identidad (<= 24) y cara (<= 9) las mira el
      // test "presupuesto"; esta es la del overlay de estado (<= 9). Hoy el
      // peor da 5, así que sobra margen: el assert está para que un overlay
      // nuevo no se coma el tope de 40 sin que nadie se entere.
      const overlay = capaDeEstado(estado, SILUETAS[r.silueta]).overlay;
      assert.ok(overlay.length <= 9, `overlay de ${estado}: ${overlay.length} nodos`);
    }
    for (const estado of ESTADOS)
      for (const traidor of [false, true])
        for (const filas of [0, 1, 4, 8]) {
          const largo = nodosDe(r, { estado, traidor, filas }).length;
          maximo = Math.max(maximo, largo);
          assert.ok(
            largo <= 40,
            `${largo} nodos · ${a} ${estado} traidor=${traidor} filas=${filas}`,
          );
        }
  }
  assert.ok(maximo >= 30, `el peor caso dio ${maximo}: si bajó tanto, algo dejó de dibujarse`);

  // Los cuatro nodos de la marca del traidor, contados. El barrido de arriba
  // pasa `traidor` pero solo mira la cota, así que un `nodosDe` que ignorara la
  // opción —o una `GRIETA` vacía— dejaría el peor caso en 35, el `maximo >= 30`
  // seguiría verde y nadie se enteraría de que la marca dejó de dibujarse.
  const r = rasgosDe("0x" + "ab".repeat(20));
  for (const estado of ESTADOS) {
    const sinMarca = nodosDe(r, { estado, filas: 0 });
    const conMarca = nodosDe(r, { estado, traidor: true, filas: 0 });
    const marca = conMarca.filter((n) => n.fill === COLORES_DE_ESTADO.coral);
    assert.equal(conMarca.length, sinMarca.length + 4, `${estado}: la marca no sumó sus 4 nodos`);
    assert.equal(marca.length, 4, `${estado}: los 4 nodos de la marca tienen que ser coral`);
    assert.equal(
      sinMarca.filter((n) => n.fill === COLORES_DE_ESTADO.coral).length,
      0,
      `${estado}: sin traidor no se dibuja una sola marca`,
    );
    // La grieta se apoya en el cuerpo: baja con él en el votado (5 -> 6).
    assert.equal(
      Math.min(...marca.map((n) => n.y)),
      estado === "votado" ? 6 : 5,
      `${estado}: la marca no acompañó al cuerpo`,
    );
  }
});

test("9. el oro es proporcional en todo el rango y cuesta un solo nodo", () => {
  assert.equal(filasDeOro(0, 1000), 0);
  assert.equal(filasDeOro(1, 1000), 1); // cualquier bolsillo > 0 muestra al menos una
  assert.equal(filasDeOro(500, 1000), 4);
  assert.equal(filasDeOro(750, 1000), 6); // no 8: el cuarto superior se tiene que distinguir
  // Nunca 10: de las diez filas del cuerpo, las dos de arriba quedan sin oro.
  // Encima del oro va el borde de ink de la regla D, así que con el bolsillo
  // máximo queda UNA sola fila con el color de identidad, no dos (desvío 11).
  assert.equal(filasDeOro(1000, 1000), 8);
  assert.equal(filasDeOro(0, 0), 0);
  assert.equal(filasDeOro(100, 0), 0);

  const r = rasgosDe("0x" + "ab".repeat(20));
  const base = nodosDe(r, { estado: "base", filas: 0 }).length;
  for (let filas = 1; filas <= 8; filas++) {
    const nodos = nodosDe(r, { estado: "base", filas });
    assert.equal(nodos.length, base + 1, `filas=${filas}: el oro agregó más de un nodo`);
    const dorados = nodos.filter((n) => n.fill === COLORES_DE_ESTADO.oro);
    assert.equal(dorados.filter((n) => n.y === 14).length, 1, "la fila 14 tiene que ser oro");
    assert.equal(dorados.filter((n) => n.y === 15).length, 2, "las patas tienen que ser oro");
    // Regla D: el ÚNICO nodo de ink de la identidad es el borde, y cae justo
    // una fila arriba del oro. Se mira sobre `capaDeIdentidad` y no sobre
    // `nodosDe`, porque la cara del estado también pinta en ink.
    const borde = capaDeIdentidad(r, { filas, conPatas: true }).filter(
      (n) => n.fill === COLORES_DE_ESTADO.tinta,
    );
    assert.equal(borde.length, 1, `filas=${filas}: la regla D tiene que poner un solo borde`);
    assert.equal(borde[0].y, 14 - filas, `filas=${filas}: el borde no está pegado al oro`);
  }
  assert.equal(
    nodosDe(r, { estado: "base", filas: 0 }).filter((n) => n.fill === COLORES_DE_ESTADO.oro).length,
    0,
    "con bolsillo 0 no hay una sola fila dorada",
  );

  // El píxel central del dorso pasa a ink cuando su propia fila ya quedó
  // dorada: la comparación es fila a fila, no contra un umbral escrito a mano.
  for (const estado of ["votado", "abandono"] as const) {
    const dy = estado === "votado" ? 1 : 0;
    for (let filas = 0; filas <= 8; filas++) {
      const centro = nodosDe(r, { estado, filas }).find(
        (n) => n.w === 2 && n.h === 2 && n.x === 7 && n.y === 10 + dy,
      );
      assert.ok(centro, `${estado} filas=${filas}: falta el centro del dorso`);
      assert.equal(
        centro.fill,
        filas >= 4 ? COLORES_DE_ESTADO.tinta : COLORES_DE_ESTADO.oro,
        `${estado} filas=${filas}: un punto dorado sobre oro no dice nada`,
      );
    }
  }

  // El votado cae en escalones ortogonales: el cuerpo ENTERO baja una fila
  // (5-14 pasa a 6-15) y pierde las patas; el abandono no baja. Sin estos
  // cuatro asserts, un `nodosDe` que dejara de bajar la capa de identidad
  // dibujaría exactamente el abandono y nadie se enteraría: el test 2 mira el
  // dorso sobre `capaDeEstado`, que no ve el desplazamiento, y el dibujo sin
  // bajar entra igual en la grilla de 16, así que tampoco rompe la cota.
  const votado = nodosDe(r, { estado: "votado", filas: 0 });
  const abandono = nodosDe(r, { estado: "abandono", filas: 0 });
  assert.equal(Math.min(...votado.map((n) => n.y)), 4, "el votado no bajó una fila");
  assert.equal(Math.min(...abandono.map((n) => n.y)), 3, "el abandono no tiene que bajar");
  assert.equal(
    votado.filter((n) => n.y === 15).length,
    1,
    "en y=15 del votado va solo la última fila del cuerpo: no lleva patas",
  );
  assert.equal(abandono.filter((n) => n.y === 15).length, 2, "el abandono conserva sus dos patas");
});

test("1. determinismo: dos llamadas dan el mismo string, y EIP-55 no cambia nada", () => {
  const a = "0x7a3f91c0d4e5b6a7889910aabbccddee0012c91d";
  assert.equal(svgDeCriatura(a), svgDeCriatura(a));
  assert.equal(svgDeCriatura(a.toUpperCase().replace("0X", "0x")), svgDeCriatura(a));
  assert.equal(svgDeCriatura("0x7A3F91C0D4E5B6A7889910AABBCCDDEE0012C91D"), svgDeCriatura(a));
});

test("6. seis direcciones distintas dan seis criaturas distintas", () => {
  // El caso de la casa. Las direcciones de los asientos de la casa NO existen
  // como constantes en el repo: `aleph-house-seats.ts` las genera la primera
  // vez y las guarda en el store del árbitro. Son estables, así que cada
  // asiento de la casa tiene su criatura fija para siempre, pero el test no las
  // puede conocer: comprueba la propiedad sobre seis direcciones cualquiera, y
  // la garantía de fondo la da el test de variedad.
  const seis = direcciones(6, 4242).map((a) => svgDeCriatura(a));
  assert.equal(new Set(seis).size, 6);
});

test("8a. los ocho estados salen con su etiqueta, y nunca hay texto adentro del SVG", () => {
  const a = direcciones(1, 5)[0];
  // La etiqueta se arma desde la MISMA dirección que se dibuja, con el formato
  // de `shortAddress`: un fixture que nombrara otra wallet sería un dato falso.
  const corto = `${a.slice(0, 6)}...${a.slice(-4)}`;
  const etiquetas = ESTADOS.map((estado) => `Criatura de ${corto}, ${estado}`);
  // Lo que este módulo decide de las ocho etiquetas es el DIBUJO, y los ocho
  // tienen que ser distintos: dos estados que colapsen en la misma criatura
  // hacen que el `aria-label` diga una cosa y la pantalla muestre otra. Que los
  // ocho TEXTOS sean distintos sale de i18n y lo mira `i18n.test.ts`; que la
  // clave de chip de cada estado sea distinta lo mira el test 8b bis. Acá no se
  // puede comprobar ninguna de las dos sin fabricarlas, que es una tautología.
  assert.equal(
    new Set(ESTADOS.map((estado) => svgDeCriatura(a, { estado }))).size,
    8,
    "dos estados dibujan lo mismo",
  );
  for (const [i, estado] of ESTADOS.entries()) {
    const svg = svgDeCriatura(a, { estado, etiquetaA11y: etiquetas[i] });
    assert.ok(svg.includes(`aria-label="${etiquetas[i]}"`), `falta el aria-label de ${estado}`);
    assert.ok(svg.includes('role="img"'));
    assert.ok(!svg.includes("aria-hidden"));
    assert.ok(!svg.includes("<text"), "nada de <text> adentro del SVG");
    assert.ok(!svg.includes("<title"), "nada de <title> adentro del SVG");
    assert.ok(!svg.includes("<clipPath") && !svg.includes("Gradient"));
    assert.ok(!svg.includes("var("), "los nodos llevan el fill ya resuelto");
  }
  // Sin etiqueta va `aria-hidden`: es como se monta en la charla.
  const mudo = svgDeCriatura(a);
  assert.ok(mudo.includes('aria-hidden="true"') && !mudo.includes("role="));
  // Las dos opacidades del spec.
  assert.ok(svgDeCriatura(a, { estado: "se_fue" }).includes('opacity="0.8"'));
  assert.ok(svgDeCriatura(a, { estado: "abandono" }).includes('opacity="0.34"'));
  assert.ok(!svgDeCriatura(a, { estado: "base" }).includes("opacity="));
});

test("8b. chipDeAsiento recorre sus siete filas en orden", () => {
  const asiento = (status: SalaDeAleph["seats"][number]["status"]) => ({
    address: A,
    status,
    pocket: 0,
  });

  // 0) `dissolved` gana sobre todo: ahí el árbitro manda `alive` para todos.
  assert.equal(
    chipDeAsiento(asiento("alive"), sala({ status: "dissolved", stage: undefined })),
    "aleph.seat.dissolved",
  );
  // 1) `funding`: depositó o no, aunque el asiento venga `alive`.
  assert.equal(
    chipDeAsiento(asiento("alive"), sala({ status: "funding", stage: undefined, deposited: [A] })),
    "aleph.seat.deposited",
  );
  assert.equal(
    chipDeAsiento(asiento("alive"), sala({ status: "funding", stage: undefined, deposited: [] })),
    "aleph.seat.pending",
  );
  // 2) ganador
  const conFinal = sala({
    status: "settled",
    seats: [
      { address: A, status: "finished", pocket: 9 },
      { address: B, status: "finished", pocket: 1 },
    ],
    results: [{ index: 0, kind: "final", choices: { [A]: "steal", [B]: "split" } }],
    stage: undefined,
  });
  assert.equal(chipDeAsiento(asiento("finished"), conFinal), "aleph.state.ganador");
  // 3) hablando
  assert.equal(
    chipDeAsiento(
      asiento("alive"),
      sala({ messages: [{ from: A, text: "hola", stage: 0, phase: "decide" }] }),
    ),
    "aleph.state.hablando",
  );
  // 4) esperando
  assert.equal(chipDeAsiento(asiento("alive"), sala()), "aleph.state.esperando");
  // 5) sellado, con sus dos textos según la fase
  assert.equal(
    chipDeAsiento(
      asiento("alive"),
      sala({ stage: { index: 0, kind: "vote", phase: "decide", acted: [A] } }),
    ),
    "aleph.state.decidio",
  );
  assert.equal(
    chipDeAsiento(
      asiento("alive"),
      sala({ stage: { index: 0, kind: "vote", phase: "talk", acted: [A] } }),
    ),
    "aleph.state.listo",
  );
  // 6) el resto: `aleph.seat.${seat.status}`, sobre los cinco SeatStatus.
  for (const status of ["alive", "left", "voted_out", "abandoned", "finished"] as const) {
    assert.equal(
      chipDeAsiento(
        asiento(status),
        sala({ stage: { index: 0, kind: "vote", phase: "talk", acted: [] } }),
      ),
      `aleph.seat.${status}`,
      `playing + ${status}`,
    );
  }
  // Un asiento `left` da "aceptó la oferta" también con la sala liquidada, y no
  // "terminó": el chip sale del asiento, no del estado de la sala.
  assert.equal(
    chipDeAsiento(asiento("left"), sala({ status: "settled", stage: undefined })),
    "aleph.seat.left",
  );
});

test("8b bis. la corona de la Final, con y sin Final, y el traidor suma un segundo chip", () => {
  const dos = (s: "finished" | "alive") => [
    { address: A, status: s, pocket: 5 },
    { address: B, status: s, pocket: 5 },
  ];
  const final = (choices: Record<string, "split" | "steal">): SalaDeAleph => ({
    status: "settled",
    seats: dos("finished"),
    results: [{ index: 0, kind: "final", choices }],
  });
  // Un solo steal: ese lleva corona.
  assert.equal(
    estadoDeAsiento(dos("finished")[0], final({ [A]: "steal", [B]: "split" })).estado,
    "ganador",
  );
  assert.equal(
    estadoDeAsiento(dos("finished")[1], final({ [A]: "steal", [B]: "split" })).estado,
    "base",
  );
  // Los dos split: los dos.
  for (const i of [0, 1])
    assert.equal(
      estadoDeAsiento(dos("finished")[i], final({ [A]: "split", [B]: "split" })).estado,
      "ganador",
    );
  // Los dos steal: ninguno (el pozo se quemó).
  for (const i of [0, 1])
    assert.equal(
      estadoDeAsiento(dos("finished")[i], final({ [A]: "steal", [B]: "steal" })).estado,
      "base",
    );
  // Sin Final, con un solo `finished`: ese lleva corona igual (se llevó el pozo).
  const sinFinal: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: A, status: "finished", pocket: 10 },
      { address: B, status: "voted_out", pocket: 0 },
    ],
    results: [{ index: 0, kind: "vote" }],
  };
  assert.equal(estadoDeAsiento(sinFinal.seats[0], sinFinal).estado, "ganador");
  assert.equal(estadoDeAsiento(sinFinal.seats[1], sinFinal).estado, "votado");
  // La marca de traidor NO es un estado: es una marca, y convive con LOS OCHO.
  // El barrido va sobre los ocho a propósito, y no sobre uno solo: los cuatro
  // que cambian cara y overlay (`se_fue`, `votado`, `abandono`, `ganador`) son
  // justo donde la marca se pierde si alguien la mete adentro de `capaDeEstado`
  // en vez de dejarla en `nodosDe`. Y de paso se fija el par (estado, chip) de
  // cada uno: son ocho claves distintas, y los chips nunca pasan de dos — el de
  // `chipDeAsiento` más el del traidor.
  const lock = { index: 0, kind: "lock" as const, traitors: [A] };
  const vivo = { address: A, status: "alive" as const, pocket: 0 };
  const casos: [string, string, SalaDeAleph, SalaDeAleph["seats"][number]][] = [
    [
      "base",
      "aleph.seat.alive",
      sala({ results: [lock], stage: { index: 1, kind: "vote", phase: "talk", acted: [] } }),
      vivo,
    ],
    [
      "hablando",
      "aleph.state.hablando",
      sala({
        results: [lock],
        messages: [{ from: A, text: "eh", stage: 1, phase: "decide" }],
        stage: { index: 1, kind: "vote", phase: "decide", acted: [] },
      }),
      vivo,
    ],
    [
      "esperando",
      "aleph.state.esperando",
      sala({ results: [lock], stage: { index: 1, kind: "vote", phase: "decide", acted: [] } }),
      vivo,
    ],
    [
      "sellado",
      "aleph.state.decidio",
      sala({ results: [lock], stage: { index: 1, kind: "vote", phase: "decide", acted: [A] } }),
      vivo,
    ],
    [
      "se_fue",
      "aleph.seat.left",
      sala({ results: [lock] }),
      { ...vivo, status: "left", pocket: 3 },
    ],
    [
      "votado",
      "aleph.seat.voted_out",
      sala({ results: [lock] }),
      { ...vivo, status: "voted_out", pocket: 1 },
    ],
    [
      "abandono",
      "aleph.seat.abandoned",
      sala({ results: [lock] }),
      { ...vivo, status: "abandoned" },
    ],
    [
      "ganador",
      "aleph.state.ganador",
      sala({
        status: "settled",
        stage: undefined,
        results: [lock, { index: 1, kind: "final", choices: { [A]: "steal", [B]: "split" } }],
        seats: [
          { address: A, status: "finished", pocket: 9 },
          { address: B, status: "finished", pocket: 1 },
        ],
      }),
      { ...vivo, status: "finished", pocket: 9 },
    ],
  ];
  const vistos = new Set<string>();
  const chipsVistos = new Set<string>();
  for (const [esperado, claveDeChip, room, asiento] of casos) {
    const caso = estadoDeAsiento(asiento, room);
    assert.equal(caso.estado, esperado, `caso ${esperado}`);
    assert.equal(caso.traidor, true, `${esperado}: la marca de traidor se perdió`);
    const chips = [chipDeAsiento(asiento, room), ...(caso.traidor ? ["aleph.state.traidor"] : [])];
    assert.equal(chips.length, 2, `${esperado}: tienen que ser exactamente dos chips`);
    assert.equal(chips[0], claveDeChip, `${esperado}: el chip de estado`);
    assert.notEqual(chips[0], chips[1], `${esperado}: el chip del traidor repite al de estado`);
    vistos.add(esperado);
    chipsVistos.add(chips[0]);
  }
  assert.deepEqual([...vistos].sort(), [...ESTADOS].sort(), "faltó un estado en el barrido");
  assert.equal(chipsVistos.size, 8, "dos estados comparten la clave de chip");

  // Y la marca es de quien la tiene: B no la hereda por estar en la misma sala.
  assert.equal(estadoDeAsiento({ ...vivo, address: B }, casos[3][2]).traidor, false);
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
