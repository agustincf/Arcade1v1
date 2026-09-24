// LA CRIATURA de un asiento de Aleph: pixel art de 16x16 que sale de la
// dirección de la wallet y no cambia nunca, en ninguna sala. Misma técnica y
// mismo vocabulario que `Logo.tsx` (un <rect> por píxel, `crispEdges`).
//
// Este módulo es PURO y NO IMPORTA NADA: los tests lo leen sin DOM, y por eso
// los nodos llevan el `fill` ya resuelto como hex literal, nunca `var(...)`.
//
// Dos capas que no se tocan nunca: IDENTIDAD (silueta, color, corona, marca,
// accesorio), que sale de la dirección, y ESTADO (ojos, boca, overlay), que
// sale del estado del asiento y NO ve la dirección. Zonas fijas de la grilla:
//
//   y 0-2   overlays de estado sobre la cabeza (corona dorada, globo, sello…)
//   y 3-4   corona de identidad: dos filas, nunca más
//   y 5-14  cuerpo: diez filas, un <rect> por fila
//   y 7-9   ojos        y 11-12  boca
//   y 14    última fila del cuerpo, en la sombra de la familia
//   y 15    patas: dos rects colgados del hw de la fila 14

/** Un píxel (o una tira de píxeles) de la grilla de 16x16. */
export interface Nodo {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/** Los ocho rasgos que salen de la dirección, más el desfase de la respiración. */
export interface Rasgos {
  silueta: number;
  ojos: number;
  corona: number;
  boca: number;
  marca: number;
  accesorio: number;
  familia: number;
  secundario: number;
  /** Byte 11: el primero que no usa ningún rasgo. Solo mueve la respiración. */
  desfase: number;
  /** La dirección no validó: criatura desconocida, gris y sin adornos. */
  desconocida: boolean;
}

export interface Familia {
  nombre: string;
  cuerpo: string;
  sombra: string;
}

// --- La paleta de identidad -------------------------------------------------
// Regla B: todo cuerpo cae en la ventana de luminancia [0,136 - 0,158]. El piso
// hace que el cuerpo dé 3:1 contra --color-surface; el techo hace que el oro
// del bolsillo dé 3:1 CONTRA el cuerpo. Regla A: ninguno es gold, lima, win ni
// lose. La marca del cuerpo usa la sombra de la propia familia, nunca el
// secundario, así se lee sea cual sea el cuerpo.

export const FAMILIAS: readonly Familia[] = [
  { nombre: "coral apagado", cuerpo: "#935d4c", sombra: "#5c3a2f" },
  { nombre: "cyan apagado", cuerpo: "#3f727c", sombra: "#294a51" },
  { nombre: "ciruela", cuerpo: "#736298", sombra: "#443a5a" },
  { nombre: "marfil apagado", cuerpo: "#706a60", sombra: "#4f4a43" },
  { nombre: "musgo", cuerpo: "#617048", sombra: "#3c452d" },
  { nombre: "óxido", cuerpo: "#935e3e", sombra: "#503322" },
  { nombre: "acero", cuerpo: "#5c6c81", sombra: "#333c48" },
  { nombre: "vino", cuerpo: "#9c5569", sombra: "#4f2b35" },
];

/** Regla C: neutros (saturación <= 0,18) para que la corona se lea contra el
 *  fondo sin competir con ningún color de estado. */
export const SECUNDARIOS: readonly string[] = ["#e4e1da", "#c2bdb3", "#9c97a3", "#7f8a86"];

/** La criatura desconocida. El gris cumple la regla B como cualquier familia
 *  (luminancia 0,147) y tiene saturación 0, así que no se confunde con
 *  ninguna de las ocho. NO se usa el #7a7368 de la maqueta, que está en 0,174:
 *  queda fuera de la ventana y el oro le da 2,79:1. */
export const DESCONOCIDA: Familia = {
  nombre: "desconocida",
  cuerpo: "#6b6b6b",
  sombra: "#3f3f3f",
};

/** Los colores que NO son de identidad: cara y overlays. Las reglas A a C no
 *  los gobiernan, justamente porque no son identidad. Son los mismos hex que
 *  el sitio ya usa en sus tokens. */
export const COLORES_DE_ESTADO = {
  /** --color-ink: contorno de ojos y boca, el borde de la regla D, el anillo del dorso */
  tinta: "#0e0b13",
  /** --color-text-strong: el blanco del ojo */
  ojo: "#fffdf7",
  /** --color-accent-2: los puntitos de `esperando` y el sello de `sellado` */
  cyan: "#6cc9da",
  /** --color-accent: la grieta del traidor y el segundo ojo que asoma */
  coral: "#e8845e",
  /** --color-muted-bright: el globo de `hablando` */
  globo: "#ded8cb",
  /** --color-gold: el oro del bolsillo, la moneda de `se_fue`, la corona de `ganador` */
  oro: "#f2c14e",
  /** La sombra de la corona dorada. Va sobre el fondo de la tarjeta, NUNCA
   *  sobre el cuerpo: contra los ocho cuerpos da entre 1,46:1 y 1,47:1. */
  oroSombra: "#a97f1e",
} as const;

/** La criatura se dibuja más apagada en dos estados. No es un nodo: es el
 *  atributo `opacity` del <svg>. */
export const OPACIDAD_DE_ESTADO: Readonly<Record<string, number>> = {
  se_fue: 0.8,
  abandono: 0.34,
};

// --- La grilla --------------------------------------------------------------

/** Primera fila del cuerpo. */
const Y0 = 5;

/** `y` absoluto de la fila `i` del cuerpo (0 a 9), sin el desplazamiento del votado. */
const fy = (i: number): number => Y0 + i;

const nodo = (x: number, y: number, w: number, h: number, fill: string): Nodo => ({
  x,
  y,
  w,
  h,
  fill,
});

const T = COLORES_DE_ESTADO.tinta;
const O = COLORES_DE_ESTADO.ojo;

/** Siluetas: medio ancho por fila, diez filas. La fila `i` va de `x = 8 - hw[i]`
 *  a `x = 8 + hw[i]`. Máximo 6 (el cuerpo nunca pasa de x=2 a x=13) y nunca
 *  menos de 4 entre los índices 2 y 8: es el piso que hace que el dorso de 8x6
 *  entre inscripto en cualquiera de las ocho, y que `cejudo` (OJOS[4]) y
 *  `saltones` (OJOS[7]), que se apoyan en `hw[2]`, no se salgan del cuerpo. */
export const SILUETAS: readonly (readonly number[])[] = [
  [3, 4, 5, 5, 5, 5, 5, 5, 4, 4], // 0 gota
  [2, 3, 4, 4, 4, 4, 4, 4, 4, 3], // 1 alto
  [3, 4, 5, 5, 5, 5, 5, 4, 4, 3], // 2 redondo
  [4, 5, 6, 6, 6, 6, 6, 6, 5, 4], // 3 ancho
  [2, 3, 4, 4, 5, 6, 6, 6, 5, 4], // 4 pera
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 4], // 5 ladrillo
  [5, 6, 6, 5, 4, 4, 4, 4, 4, 3], // 6 hongo
  [3, 3, 4, 5, 5, 5, 5, 5, 5, 5], // 7 torre
];

/** Coronas de identidad: SOLO y = 3 y 4 (la fila 2 es de la zona de estado, y
 *  sin esa separación la corona dorada del ganador taparía justo el rasgo que
 *  lo hace reconocible). Se cuelgan del borde real del cuerpo (`hw[0]`), no de
 *  una posición fija: es lo que evita que floten afuera de una silueta angosta.
 *  Presupuesto: <= 4 nodos. */
export const CORONAS: readonly ((hw: readonly number[], color: string) => Nodo[])[] = [
  (hw, c) => [nodo(8, 4, 1, 1, c), nodo(7, 3, 2, 1, c)], // 0 antena
  (hw, c) => [
    // 1 cuernos
    nodo(8 - hw[0], 4, 1, 1, c),
    nodo(8 - hw[0] - 1, 3, 1, 1, c),
    nodo(8 + hw[0] - 1, 4, 1, 1, c),
    nodo(8 + hw[0], 3, 1, 1, c),
  ],
  (hw, c) => [nodo(8 - hw[0] - 1, 3, 1, 2, c), nodo(8 + hw[0], 3, 1, 2, c)], // 2 orejas
  (hw, c) => [nodo(7, 3, 2, 2, c), nodo(6, 4, 4, 1, c)], // 3 aleta
  (hw, c) => [nodo(7, 4, 1, 1, c), nodo(8, 3, 1, 1, c), nodo(9, 4, 1, 1, c)], // 4 penacho
  (hw, c) => {
    // 5 pinchos
    const e = Math.max(3, hw[0]);
    return [nodo(8 - e, 4, 1, 1, c), nodo(8, 3, 1, 1, c), nodo(8 + e - 1, 4, 1, 1, c)];
  },
  (hw, c) => [
    // 6 orejas caídas
    nodo(8 - hw[0] - 1, 3, 1, 1, c),
    nodo(8 - hw[0] - 2, 4, 1, 1, c),
    nodo(8 + hw[0], 3, 1, 1, c),
    nodo(8 + hw[0] + 1, 4, 1, 1, c),
  ],
  (hw, c) => [nodo(6, 3, 1, 2, c), nodo(9, 3, 1, 2, c), nodo(7, 4, 2, 1, c)], // 7 cresta doble
];

/** Marcas del cuerpo, en la SOMBRA de la propia familia. Se dibujan DESPUÉS del
 *  oro, así se leen igual sobre las filas doradas. Presupuesto: <= 3 nodos
 *  (bajó de 4: el nodo que pierde se lo lleva el borde de ink de la regla D,
 *  que es el que hace legible el bolsillo). */
export const MARCAS: readonly ((hw: readonly number[], color: string) => Nodo[])[] = [
  () => [], // 0 liso
  (hw, c) => {
    // 1 panza
    const m = Math.min(hw[7], hw[8]);
    return [nodo(8 - (m - 2), fy(7), 2 * (m - 2), 2, c)];
  },
  (hw, c) => [nodo(5, fy(5), 1, 1, c), nodo(10, fy(8), 1, 1, c), nodo(7, fy(1), 1, 1, c)], // 2 lunares
  (hw, c) => [
    // 3 rayas
    nodo(8 - hw[5], fy(5), 2 * hw[5], 1, c),
    nodo(8 - hw[8], fy(8), 2 * hw[8], 1, c),
  ],
  (hw, c) => [nodo(8 - (hw[2] - 1), fy(2), 2 * (hw[2] - 1), 1, c)], // 4 antifaz
  (hw, c) => [
    // 5 cinturón
    nodo(8 - hw[7], fy(7), 2 * hw[7], 1, c),
    nodo(6, fy(6), 4, 1, c),
  ],
  (hw, c) => [nodo(6, fy(5), 4, 1, c), nodo(5, fy(6), 6, 1, c)], // 6 pecho
  (hw, c) => [
    // 7 media cara
    nodo(8 - hw[2], fy(2), hw[2], 1, c),
    nodo(8 - hw[3], fy(3), hw[3], 1, c),
    nodo(8 - hw[4], fy(4), hw[4], 1, c),
  ],
];

/** Accesorios, en el color secundario. Presupuesto: <= 3 nodos. */
export const ACCESORIOS: readonly ((hw: readonly number[], color: string) => Nodo[])[] = [
  () => [], // 0 ninguno
  (hw, c) => [
    // 1 bufanda
    nodo(8 - hw[5], fy(5), 2 * hw[5], 1, c),
    nodo(8 + hw[5] - 3, fy(6), 2, 2, c),
  ],
  (hw, c) => [
    // 2 cola
    nodo(8 + hw[8], fy(8), 1, 1, c),
    nodo(8 + hw[8] + 1, fy(7), 1, 1, c),
    nodo(8 + hw[8] + 1, fy(6), 1, 1, c),
  ],
  (hw, c) => [nodo(8 + hw[3], fy(3), 1, 2, c)], // 3 aro
  (hw, c) => [
    // 4 parche
    nodo(8 - hw[6], fy(6), 2, 2, c),
    nodo(8 - hw[7], fy(8), 2, 1, c),
  ],
  (hw, c) => [
    // 5 mochila
    nodo(8 + hw[6], fy(6), 1, 3, c),
    nodo(8 + hw[6] - 1, fy(6), 2, 1, c),
  ],
  (hw, c) => [
    // 6 flequillo
    nodo(8 - hw[1], fy(1), 2 * hw[1], 1, c),
    nodo(8 - hw[1] + 1, fy(2), 1, 1, c),
    nodo(8 + hw[1] - 2, fy(2), 1, 1, c),
  ],
  (hw, c) => [nodo(6, fy(0), 1, 2, c), nodo(9, fy(0), 1, 2, c), nodo(7, fy(0), 2, 1, c)], // 7 moño
];

/** Ojos de identidad, en y 7-9. Presupuesto: <= 6 nodos. */
export const OJOS: readonly (() => Nodo[])[] = [
  () => [nodo(5, 7, 2, 2, O), nodo(6, 8, 1, 1, T), nodo(9, 7, 2, 2, O), nodo(10, 8, 1, 1, T)], // 0 dos puntos
  () => [nodo(6, 7, 4, 3, O), nodo(7, 8, 2, 2, T)], // 1 ciclope
  () => [
    // 2 tres ojos
    nodo(5, 8, 2, 2, O),
    nodo(5, 9, 1, 1, T),
    nodo(9, 8, 2, 2, O),
    nodo(10, 9, 1, 1, T),
    nodo(7, 7, 2, 1, O),
    nodo(7, 7, 1, 1, T),
  ],
  () => [nodo(5, 8, 3, 1, O), nodo(6, 8, 1, 1, T), nodo(8, 8, 3, 1, O), nodo(9, 8, 1, 1, T)], // 3 rendijas
  () => [
    // 4 cejudo
    nodo(4, 7, 8, 1, T),
    nodo(5, 8, 2, 2, O),
    nodo(6, 9, 1, 1, T),
    nodo(9, 8, 2, 2, O),
    nodo(10, 9, 1, 1, T),
  ],
  () => [nodo(6, 8, 2, 2, O), nodo(6, 9, 1, 1, T), nodo(8, 8, 2, 2, O), nodo(9, 9, 1, 1, T)], // 5 juntos
  () => [nodo(5, 7, 3, 3, O), nodo(6, 8, 1, 1, T), nodo(10, 8, 1, 2, O), nodo(10, 9, 1, 1, T)], // 6 desparejos
  () => [nodo(4, 7, 3, 3, O), nodo(5, 8, 1, 1, T), nodo(9, 7, 3, 3, O), nodo(10, 8, 1, 1, T)], // 7 saltones
];

/** Bocas de identidad, en y 11-12. Presupuesto: <= 3 nodos. */
export const BOCAS: readonly (() => Nodo[])[] = [
  () => [nodo(6, 11, 1, 1, T), nodo(7, 12, 2, 1, T), nodo(9, 11, 1, 1, T)], // 0 sonrisa
  () => [nodo(6, 12, 4, 1, T)], // 1 línea
  () => [nodo(6, 11, 4, 1, T), nodo(7, 12, 1, 1, O), nodo(9, 12, 1, 1, O)], // 2 colmillos
  () => [nodo(7, 11, 2, 2, T)], // 3 o
  () => [nodo(6, 12, 1, 1, T), nodo(7, 11, 2, 1, T), nodo(9, 12, 1, 1, T)], // 4 ondulada
  () => [nodo(6, 11, 4, 1, T), nodo(7, 12, 1, 1, O)], // 5 dientito
  () => [nodo(6, 11, 4, 2, T), nodo(7, 12, 2, 1, O)], // 6 abierta
  () => [nodo(7, 11, 2, 1, T), nodo(6, 12, 4, 1, T)], // 7 fruncida
];

// --- Qué byte decide qué rasgo ---------------------------------------------
// La dirección son 20 bytes ya uniformes (es el hash de una clave pública): no
// hace falta ningún hash extra. Se usan los OCHO ÚLTIMOS bytes y de cada uno
// solo sus bits bajos. Todas las tablas son potencias de dos, así que quedarse
// con los bits bajos no tiene sesgo de resto (con una tabla de 6, `byte % 6` le
// daría 2,4 % más de chance a las cuatro primeras). Los bytes 18 y 19 son los
// dos que se ven en `shortAddress`: los últimos cuatro caracteres que leés
// deciden la silueta y los ojos, que es lo más grande y lo que más se mira.

const DIRECCION = /^0x[0-9a-f]{40}$/;

export function rasgosDe(address: string | null | undefined): Rasgos {
  const s = String(address ?? "").toLowerCase();
  if (!DIRECCION.test(s)) {
    // La criatura desconocida: silueta 0, gris neutro, sin corona ni accesorio,
    // ojos de línea. Nunca tira: una vista rara del árbitro no puede llevarse
    // puesto el árbol de React.
    return {
      silueta: 0,
      ojos: 3,
      corona: 0,
      boca: 1,
      marca: 0,
      accesorio: 0,
      familia: 0,
      secundario: 0,
      desfase: 0,
      desconocida: true,
    };
  }
  const byte = (i: number) => parseInt(s.slice(2 + 2 * i, 4 + 2 * i), 16);
  return {
    silueta: byte(19) & 7,
    ojos: byte(18) & 7,
    corona: byte(17) & 7,
    boca: byte(16) & 7,
    marca: byte(15) & 7,
    accesorio: byte(14) & 7,
    familia: byte(13) & 7,
    secundario: byte(12) & 3,
    desfase: byte(11) & 7,
    desconocida: false,
  };
}

// --- Las dos capas de identidad --------------------------------------------

/** Filas de oro saneadas: entero entre 0 y 8. Las tres puertas que las reciben
 *  pasan por acá, así que un 3,5 no puede indexar `hw` con un fraccionario (y
 *  emitir un rect con x/w en NaN) ni un 12 pintar de oro la fila de la corona
 *  de identidad, que es zona prohibida. */
const filasSanas = (filas: number | undefined): number =>
  Math.max(0, Math.min(8, Math.round(Number(filas) || 0)));

/** Las filas del cuerpo (en `y` absoluto, sin desplazar) que el oro ya pintó.
 *  El oro sube desde abajo: con las ocho filas llega hasta y = 7. */
export function filasDoradas(filas: number): Set<number> {
  const salida = new Set<number>();
  for (let i = 10 - filasSanas(filas); i < 10; i++) salida.add(fy(i));
  return salida;
}

/** La capa de IDENTIDAD: cuerpo con su oro, el borde de ink de la regla D,
 *  patas, marca, accesorio y corona. Sin cara y sin estado.
 *  Presupuesto: 10 + 1 + 2 + 3 + 3 + 4 = <= 24 nodos, y NUNCA con y < 3. */
export function capaDeIdentidad(
  rasgos: Rasgos,
  opts?: { filas?: number; conPatas?: boolean },
): Nodo[] {
  const filas = filasSanas(opts?.filas);
  const conPatas = opts?.conPatas !== false;
  const hw = SILUETAS[rasgos.silueta];
  const familia = rasgos.desconocida ? DESCONOCIDA : FAMILIAS[rasgos.familia];
  const secundario = SECUNDARIOS[rasgos.secundario];
  const doradas = filasDoradas(filas);
  const salida: Nodo[] = [];

  // 1) El cuerpo, con el oro ya aplicado fila por fila. La fila 14 (índice 9)
  //    va en la sombra de la familia, salvo que le toque oro.
  for (let i = 0; i < 10; i++) {
    const fill = doradas.has(fy(i))
      ? COLORES_DE_ESTADO.oro
      : i === 9
        ? familia.sombra
        : familia.cuerpo;
    salida.push(nodo(8 - hw[i], fy(i), 2 * hw[i], 1, fill));
  }

  // 2) Regla D: 1 px de ink ENCIMA de la fila más alta de oro. Hace falta
  //    porque la tarjeta de asiento va sobre --color-surface-2 y ahí los ocho
  //    cuerpos dan 2,84:1, no 3:1: la ventana que cumpliría las dos cosas a la
  //    vez está vacía. Con `filas <= 8` el índice nunca baja de 1.
  if (filas > 0) {
    const borde = 10 - filas - 1;
    salida.push(nodo(8 - hw[borde], fy(borde), 2 * hw[borde], 1, T));
  }

  // 3) Las patas. El votado se cayó y no las lleva. Van en #f2c14e cuando les
  //    toca oro: con `filas === 1` la única fila dorada es la 14, y el dorado
  //    oscuro (#a97f1e) da 1,46:1 contra los ocho cuerpos, o sea que el primer
  //    escalón del bolsillo quedaría invisible.
  if (conPatas) {
    const patas = filas > 0 ? COLORES_DE_ESTADO.oro : familia.sombra;
    salida.push(nodo(8 - hw[9], 15, 2, 1, patas));
    salida.push(nodo(8 + hw[9] - 2, 15, 2, 1, patas));
  }

  // 4, 5, 6) Marca (después del oro, para que se lea sobre las filas doradas),
  //          accesorio y corona. La desconocida no lleva los dos últimos.
  salida.push(...MARCAS[rasgos.marca](hw, familia.sombra));
  if (!rasgos.desconocida) {
    salida.push(...ACCESORIOS[rasgos.accesorio](hw, secundario));
    salida.push(...CORONAS[rasgos.corona](hw, secundario));
  }
  return salida;
}

/** La cara de IDENTIDAD: ojos + boca. Presupuesto: <= 9 nodos. */
export function capaDeCara(rasgos: Rasgos): Nodo[] {
  return [...OJOS[rasgos.ojos](), ...BOCAS[rasgos.boca]()];
}

// --- La capa de estado ------------------------------------------------------
// El estado NUNCA toca la identidad: la silueta, el color, la corona, la marca
// y el accesorio son los mismos vivo, votado o ganador. Lo que cambia son ojos,
// boca y overlay, y esos tres NO ven la dirección: los elige una tabla que
// recibe el estado y los diez medios anchos (que ya se ven dibujados). Es eso,
// y no la cantidad de argumentos, lo que hace imposible filtrar un secreto por
// el dibujo.

export type Estado =
  | "base"
  | "hablando"
  | "esperando"
  | "sellado"
  | "se_fue"
  | "votado"
  | "abandono"
  | "ganador";

export const ESTADOS: readonly Estado[] = [
  "base",
  "hablando",
  "esperando",
  "sellado",
  "se_fue",
  "votado",
  "abandono",
  "ganador",
];

/** `ojos`/`boca` en `null` quieren decir "usá la cara de identidad". */
export interface CapaDeEstado {
  ojos: Nodo[] | null;
  boca: Nodo[] | null;
  overlay: Nodo[];
}

/** Caras fijas de estado. */
const CARA_CERRADOS = (): Nodo[] => [nodo(5, 8, 3, 1, T), nodo(9, 8, 3, 1, T)];
const CARA_FELICES = (): Nodo[] => [
  nodo(5, 8, 1, 1, T),
  nodo(6, 9, 2, 1, T),
  nodo(9, 9, 2, 1, T),
  nodo(11, 8, 1, 1, T),
];

/** El dorso de ALEPH, 8x6 en x = 4-11: la misma idea del ícono del juego (ocho
 *  asientos alrededor de un pozo dorado) redibujada en píxeles. Cuatro rects
 *  arman el anillo de tinta y uno dorado va al centro. `y0 = 8`; el
 *  desplazamiento del votado lo aplica `nodosDe`, así que relativo al cuerpo
 *  cae siempre en los índices 3 a 8, donde el piso de `hw >= 4` garantiza que
 *  entre inscripto en cualquiera de las ocho siluetas.
 *
 *  El anillo de tinta hace que el centro se lea sobre cualquier cuerpo; pero
 *  si alguna de sus dos filas ya quedó dorada por el bolsillo, el centro se
 *  pinta en ink: un punto dorado sobre oro no dice nada. La comparación es
 *  FILA A FILA, nunca contra un umbral escrito a mano. */
function dorsoDeAleph(y0: number, doradas: Set<number>): Nodo[] {
  const centro = y0 + 2;
  const sobreOro = doradas.has(centro) || doradas.has(centro + 1);
  return [
    nodo(4, y0, 8, 1, T),
    nodo(4, y0 + 5, 8, 1, T),
    nodo(4, y0 + 1, 1, 4, T),
    nodo(11, y0 + 1, 1, 4, T),
    nodo(7, centro, 2, 2, sobreOro ? T : COLORES_DE_ESTADO.oro),
  ];
}

/** SOLO ve el estado, los diez medios anchos y qué filas están doradas. Nunca
 *  la dirección, ni la fase, ni el bolsillo crudo. */
export function capaDeEstado(
  estado: Estado,
  hw: readonly number[],
  doradas?: Set<number>,
): CapaDeEstado {
  const oro = doradas ?? new Set<number>();
  switch (estado) {
    case "hablando":
      // Globo de 3x2 en marfil sobre la cabeza, con su cola de 1 px en y = 2.
      return {
        ojos: null,
        boca: BOCAS[6](),
        overlay: [
          nodo(10, 0, 3, 2, COLORES_DE_ESTADO.globo),
          nodo(11, 1, 1, 1, T),
          nodo(9, 2, 1, 1, COLORES_DE_ESTADO.globo),
        ],
      };
    case "esperando":
      // Tres puntitos cyan FIJOS: no se animan. La cara queda la de identidad:
      // es el único estado que trae objeto sin cambiar la cara.
      return {
        ojos: null,
        boca: null,
        overlay: [
          nodo(6, 1, 1, 1, COLORES_DE_ESTADO.cyan),
          nodo(8, 1, 1, 1, COLORES_DE_ESTADO.cyan),
          nodo(10, 1, 1, 1, COLORES_DE_ESTADO.cyan),
        ],
      };
    case "sellado":
      // Actuó y no sabemos qué. Idéntico para todos, a propósito.
      return {
        ojos: CARA_CERRADOS(),
        boca: BOCAS[1](),
        overlay: [nodo(5, 0, 6, 2, COLORES_DE_ESTADO.cyan), nodo(7, 0, 2, 1, T)],
      };
    case "se_fue":
      return {
        ojos: CARA_FELICES(),
        boca: BOCAS[0](),
        overlay: [nodo(13, 0, 3, 3, COLORES_DE_ESTADO.oro), nodo(14, 1, 1, 1, T)],
      };
    case "votado":
    case "abandono":
      // El dorso tapa la CARA, no la criatura: la silueta y el color siguen ahí.
      return { ojos: [], boca: [], overlay: dorsoDeAleph(8, oro) };
    case "ganador": {
      // Piso de ancho: sin él, sobre una silueta angosta (hw[0] = 2) la corona
      // mediría 4 px y el único asiento que todo el mundo va a mirar quedaría
      // con una corona que casi no se ve.
      const ch = Math.max(4, hw[0]);
      return {
        ojos: CARA_FELICES(),
        boca: BOCAS[0](),
        overlay: [
          nodo(8 - ch, 1, 2 * ch, 1, COLORES_DE_ESTADO.oro),
          nodo(8 - ch, 0, 1, 1, COLORES_DE_ESTADO.oro),
          nodo(7, 0, 2, 1, COLORES_DE_ESTADO.oro),
          nodo(8 + ch - 1, 0, 1, 1, COLORES_DE_ESTADO.oro),
          nodo(8 - ch, 2, 2 * ch, 1, COLORES_DE_ESTADO.oroSombra),
        ],
      };
    }
    case "base":
      // `base` es el REPOSO, no un estado vacío: se distingue justamente por no
      // tener nada encima, y es el más frecuente de la pantalla.
      return { ojos: null, boca: null, overlay: [] };
    default: {
      // Un noveno estado tiene que salir en ROJO al compilar, no dibujarse como
      // reposo sin que nadie se entere. El retorno sigue siendo el de reposo:
      // la promesa de este módulo es que nunca tira, y eso no se toca.
      const _exhaustivo: never = estado;
      void _exhaustivo;
      return { ojos: null, boca: null, overlay: [] };
    }
  }
}

/** La marca del traidor no es un estado: convive con cualquiera. Una columna
 *  coral de 1 px con dos escalones y un segundo ojo que asoma en (8,8). La
 *  grieta se DIBUJA encima; lo que no se parte es el CUERPO: separar sus dos
 *  mitades obligaría a dibujarlo dos veces (veinte rects en vez de diez) y a
 *  romper el tope de nodos. La grieta sí se puede pedir sola, con
 *  `nodosDeGrieta` justo abajo. */
const GRIETA = (): Nodo[] => [
  nodo(8, 5, 1, 3, COLORES_DE_ESTADO.coral),
  nodo(9, 8, 1, 2, COLORES_DE_ESTADO.coral),
  nodo(8, 10, 1, 4, COLORES_DE_ESTADO.coral),
  nodo(8, 8, 1, 1, COLORES_DE_ESTADO.coral),
];

/** La grieta sola, ya con el desplazamiento del votado aplicado. La exporta
 *  para que `Criatura.tsx` pueda envolverla en su propio <g> y animarla
 *  (`aleph-grieta` crece de arriba a abajo) sin tocar el resto del dibujo:
 *  un <rect> suelto no se puede seleccionar desde el CSS. `nodosDe` usa esta
 *  misma función, así que las dos salidas no pueden divergir (test 3 bis). */
export function nodosDeGrieta(estado: Estado): Nodo[] {
  const dy = estado === "votado" ? 1 : 0;
  return GRIETA().map((n) => (dy ? { ...n, y: n.y + dy } : n));
}

// --- El oro del bolsillo ----------------------------------------------------

/** Cuántas filas del cuerpo se pintan en oro. Las ocho se reparten sobre TODO
 *  el rango, no sobre el 75 % de abajo: con `round(p * 10)` recortado en 8,
 *  cualquiera entre el 75 % y el 100 % del máximo mostraba las mismas ocho
 *  filas, y el cuarto superior —justo donde se define quién va ganando— quedaba
 *  indistinguible. Y cualquier bolsillo mayor que cero muestra al menos una:
 *  un asiento que ya guardó plata no se puede dibujar igual que uno que no. */
export function filasDeOro(bolsillo: number, maxBolsillo: number): number {
  if (!(bolsillo > 0) || !(maxBolsillo > 0)) return 0;
  return Math.min(8, Math.max(1, Math.round((bolsillo / maxBolsillo) * 8)));
}

// --- El armado --------------------------------------------------------------

export interface OpcionesDeCriatura {
  estado?: Estado;
  traidor?: boolean;
  /** Filas de oro, 0 a 8. Sale de `filasDeOro`. */
  filas?: number;
}

/** La única función que ve las DOS capas, y por eso la única que puede aplicar
 *  el desplazamiento del votado. Orden de dibujo: cuerpo (con el oro ya
 *  aplicado) -> borde de ink -> patas -> marca -> accesorio -> corona -> ojos
 *  -> boca -> overlay de estado -> grieta.
 *
 *  El votado NO se inclina: rotar seis grados una grilla de píxeles la hace
 *  puré antialiaseado, que es justo lo que `crispEdges` fue a evitar. Cae en
 *  escalones ortogonales: el cuerpo entero baja una fila (de 5-14 a 6-15), la
 *  corona baja con él y las patas no se dibujan. Todo sigue adentro de la
 *  grilla y no hace falta un solo nodo de más. */
export function nodosDe(rasgos: Rasgos, opts?: OpcionesDeCriatura): Nodo[] {
  const estado: Estado = opts?.estado ?? "base";
  const filas = filasSanas(opts?.filas);
  const hw = SILUETAS[rasgos.silueta];
  const dy = estado === "votado" ? 1 : 0;
  const doradas = filasDoradas(filas);

  const identidad = capaDeIdentidad(rasgos, { filas, conPatas: estado !== "votado" });
  const capa = capaDeEstado(estado, hw, doradas);
  const cara = [
    ...(capa.ojos === null ? OJOS[rasgos.ojos]() : capa.ojos),
    ...(capa.boca === null ? BOCAS[rasgos.boca]() : capa.boca),
  ];

  // El desplazamiento mueve la identidad, la cara y todo lo que se apoya en el
  // cuerpo (el dorso, la grieta). Nunca los overlays de cabeza, que son los
  // únicos que viven fuera del cuerpo y por eso no se caen con él.
  const enCuerpo = [...identidad, ...cara, ...capa.overlay.filter((n) => n.y > 2)];
  const enCabeza = capa.overlay.filter((n) => n.y <= 2);
  const grieta = opts?.traidor ? nodosDeGrieta(estado) : [];
  const bajar = (n: Nodo): Nodo => (dy ? { ...n, y: n.y + dy } : n);

  return [...enCuerpo.map(bajar), ...grieta, ...enCabeza];
}

// --- El serializador --------------------------------------------------------

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** La criatura como string de SVG. Lo usan los tests y (en PR2) el probador.
 *  `Criatura.tsx` mapea la MISMA lista de `nodosDe` a <rect>, así que los dos
 *  consumen lo mismo y no pueden divergir. Sin <text>, sin <title>, sin
 *  <clipPath> y sin gradientes: todo rótulo es HTML traducible, porque Press
 *  Start 2P no tiene glifos devanagari y el sitio se sirve en hindi. */
export function svgDeCriatura(
  address: string | null | undefined,
  opts?: OpcionesDeCriatura & { etiquetaA11y?: string },
): string {
  const rasgos = rasgosDe(address);
  const nodos = nodosDe(rasgos, opts);
  const opacidad = opts?.estado ? OPACIDAD_DE_ESTADO[opts.estado] : undefined;
  const a11y = opts?.etiquetaA11y
    ? ` role="img" aria-label="${escapar(opts.etiquetaA11y)}"`
    : ' aria-hidden="true"';
  const rects = nodos
    .map((n) => `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${n.fill}"/>`)
    .join("");
  const op = opacidad === undefined ? "" : ` opacity="${opacidad}"`;
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges"${op}${a11y}>${rects}</svg>`;
}
